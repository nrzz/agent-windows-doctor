// Running the real agents at zero cost: what every agent's sandbox shares (test/agents.mjs has the four agents' recipes).
//
// An agent runs only when its E2E_* variable (E2E_CLAUDE, E2E_CODEX, E2E_GEMINI, E2E_COPILOT) names its binary ("codex" on a CI machine after
// `npm install -g @openai/codex`, or the full path to codex.cmd). Otherwise the check is skipped, and `npm test` needs nothing but Node.
//
// THE GUARD. A probe on 17 October 2026 wrote into the real ~/.codex, because the run set HOME and USERPROFILE and Codex on Windows asks
// Windows for the profile folder when CODEX_HOME is not set. So no binary starts before assertSandboxed() has looked at the environment it
// would get: HOME, USERPROFILE, LOCALAPPDATA, APPDATA, CODEX_HOME, COPILOT_HOME, CLAUDE_CONFIG_DIR and GEMINI_CLI_HOME must all name a folder
// inside the run's own world, and HTTP_PROXY, HTTPS_PROXY and ALL_PROXY must name a closed port on 127.0.0.1 with NO_PROXY=127.0.0.1,localhost
// (the fake APIs are on 127.0.0.1), so that a misconfigured run cannot reach the real ~/.codex, ~/.copilot, ~/.gemini, ~/.claude, or the network.
// launch() is the only function here that starts a binary, and it calls the guard every time.
//
// Each agent runs in a throwaway world (a home folder, its config folder, a project folder) with an environment scrubbed of every variable of
// the machine's agent sessions, and with its API pointed at a tiny server on 127.0.0.1 that answers from a script. No request leaves the
// machine, no token is spent, no login is needed. The binary is started with spawn (asynchronous) and with stdin ignored: a spawnSync would
// block the event loop that the fake server lives in, and `-p`-style runs wait for input on an open stdin.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { DEAD_PROXY, HOME_VARS, IS_WIN, NO_PROXY, PROXY_VARS, homeEnv, isInside, tmpDir } from "./helpers.mjs";

/** The binary a check runs: the variable's value as it is when it is a path, else the first command of that name the PATH finds, as a full path. */
export function resolveBin(name) {
  if (!name) return "";
  if (/[\\/]/.test(name)) return name;
  const found = (IS_WIN ? spawnSync("where.exe", [name], { encoding: "utf8", windowsHide: true }) : spawnSync("which", [name], { encoding: "utf8" })).stdout || "";
  const list = found.split(/\r?\n/).filter(Boolean);
  if (!list.length) return name;
  // on Windows an npm install leaves name, name.cmd and name.ps1 side by side: the file with no extension is a shell script cmd.exe cannot start
  if (IS_WIN) return list.find((f) => /\.exe$/i.test(f)) || list.find((f) => /\.(cmd|bat)$/i.test(f)) || list[0];
  return list[0];
}

export const viaShell = (bin) => IS_WIN && !/\.exe$/i.test(bin);

/** One argument for a command line that cmd.exe will split. */
export const quote = (a) => (/[\s"&|<>^()%!]/.test(a) || a === "" ? `"${String(a).replace(/"/g, '\\"')}"` : String(a));

export function killTree(child) {
  try {
    if (IS_WIN) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    else process.kill(-child.pid, "SIGKILL");
  } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } }
}

/** Sets a variable; on Windows whatever the case of an existing spelling (it keeps `Path`), elsewhere the exact name. An undefined value removes it. */
export function setVar(env, name, value) {
  const same = (k) => (IS_WIN ? k.toLowerCase() === String(name).toLowerCase() : k === name);
  for (const k of Object.keys(env)) if (same(k)) delete env[k];
  if (value !== undefined && value !== null) env[name] = value;
  return env;
}
export const getVar = (env, name) => { const k = Object.keys(env).find((x) => (IS_WIN ? x.toLowerCase() === String(name).toLowerCase() : x === name)); return k === undefined ? undefined : env[k]; };

/**
 * The guard. Throws unless every variable that names a folder of an agent or of Windows names a folder inside `root` (the run's world), and
 * every proxy names the closed port. Returns the env when it passes.
 */
export function assertSandboxed(env, root) {
  if (!root) throw new Error("guard: no sandbox root to compare the environment with");
  for (const name of HOME_VARS) {
    const v = getVar(env, name);
    if (v === undefined || v === "") throw new Error(`guard: ${name} is not set: the agent would use the real folder (refusing to start a binary)`);
    if (!path.isAbsolute(v) || !isInside(v, root)) throw new Error(`guard: ${name}=${v} is not inside the sandbox ${root} (refusing to start a binary)`);
  }
  for (const name of PROXY_VARS) {
    for (const spelling of [name, name.toLowerCase()]) {
      const v = env[spelling];
      if (v !== undefined && v !== DEAD_PROXY) throw new Error(`guard: ${spelling}=${v} is not the closed port ${DEAD_PROXY} (refusing to start a binary)`);
    }
    if (getVar(env, name) !== DEAD_PROXY) throw new Error(`guard: ${name} is not set to the closed port ${DEAD_PROXY} (refusing to start a binary)`);
  }
  if (getVar(env, "NO_PROXY") !== NO_PROXY) throw new Error(`guard: NO_PROXY is not ${NO_PROXY} (refusing to start a binary)`);
  return env;
}

const AGENT_VARS = /^(CLAUDE|ANTHROPIC|CLAUDECODE|AI_AGENT|MCP_|ENABLE_TOOL_SEARCH|CODEX|OPENAI|COPILOT|GEMINI|GOOGLE_GEMINI|CURSOR|FAKE_API|ADW_FAKE|__PSLockdownPolicy|GITHUB_SHA|SURFACE)/i;

/**
 * The environment of a run in world `sb`: the machine's, without any variable of an agent session, with every folder of an agent inside the
 * world and the proxies on the closed port. `extra` entries win (an undefined value removes the variable), except that the folders may only
 * be changed to another folder inside the world, and the proxies not at all.
 */
export function agentEnv(sb, extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!AGENT_VARS.test(k) && !HOME_VARS.some((h) => h.toLowerCase() === k.toLowerCase())) env[k] = v;
  for (const [k, v] of Object.entries(homeEnv(sb.home))) setVar(env, k, v);
  for (const [k, v] of Object.entries(extra)) setVar(env, k, v);
  return assertSandboxed(env, sb.root);
}

/**
 * PATH with the folders of `first` in front, and every folder that holds one of the programs named in `hide` (a name with or without extension)
 * left out. With `only` the PATH is exactly those folders (and `first` before them): the PATH of a Windows machine that has nothing else.
 */
export function adjustPath(env, { first = [], hide = [], only } = {}) {
  const key = Object.keys(env).find((k) => k.toLowerCase() === "path") || "PATH";
  const names = hide.flatMap((h) => (/\.[a-z]+$/i.test(h) ? [h] : [`${h}.exe`, `${h}.cmd`, `${h}.bat`, `${h}.com`, h]));
  const base = only ? [].concat(only) : String(env[key] || "").split(path.delimiter);
  const kept = base.filter((d) => d && !names.some((n) => fs.existsSync(path.join(d, n))));
  env[key] = [...[].concat(first), ...kept].join(path.delimiter);
  return env;
}

/** The PATH of a plain Windows machine: the system folders and the folder of the Node that runs this (the agents' own shims need it). */
export function plainWindowsPath() {
  const root = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  return [path.win32.join(root, "System32"), root, path.win32.join(root, "System32", "Wbem"), path.win32.join(root, "System32", "WindowsPowerShell", "v1.0"), path.dirname(process.execPath)];
}

/**
 * Starts a binary in world `sb` and waits. Resolves { code, out, err, ms, timedOut, env }. The guard runs first, on the environment the binary
 * would get. `env` entries replace variables of the scrubbed environment; `path` is { first, hide } for PATH.
 */
export function launch(sb, bin, args, { env = {}, cwd, timeout = 120000, path: pathOpts } = {}) {
  const childEnv = agentEnv(sb, env);
  if (pathOpts) adjustPath(childEnv, pathOpts);
  assertSandboxed(childEnv, sb.root);
  return new Promise((resolve) => {
    const started = Date.now();
    const where = cwd || sb.work;
    const child = viaShell(bin)
      ? spawn([quote(bin), ...args.map(quote)].join(" "), [], { cwd: where, env: childEnv, shell: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
      : spawn(bin, args, { cwd: where, env: childEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], detached: !IS_WIN });
    let out = "";
    let err = "";
    let timedOut = false;
    child.on("error", (e) => { err += String(e); });
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeout);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: timedOut ? "timeout" : code, out, err, ms: Date.now() - started, timedOut, env: childEnv }); });
  });
}

/** { ok, version, number, reason } for a binary: whether it runs and prints a version (asked in a world of its own, through the guard). */
export async function binInfo(bin, label, envName, extraEnv = {}) {
  if (!bin) return { ok: false, version: "", number: "", reason: `${envName} is not set (point it at ${label} to run the checks against the real thing)` };
  const sb = { root: tmpDir("adw-probe-"), get home() { return path.join(this.root, "home"); } };
  fs.mkdirSync(sb.home, { recursive: true });
  const r = await launch(sb, bin, ["--version"], { env: { COPILOT_AUTO_UPDATE: "false", DISABLE_AUTOUPDATER: "1", GEMINI_CLI_NO_RELAUNCH: "1", ...extraEnv }, cwd: sb.home, timeout: 90000 });
  const version = `${r.out}`.trim().split(/\r?\n/).filter((l) => /\d+\.\d+\.\d+/.test(l))[0] || "";
  return r.code === 0 && version ? { ok: true, version, number: (/\d+\.\d+\.\d+(?:-[\w.]+)?/.exec(version) || [""])[0], reason: "" } : { ok: false, version: "", number: "", reason: `${envName} (${bin}) did not run: ${(r.err || "").trim().slice(0, 120)}` };
}

// ---- a server on 127.0.0.1 ---------------------------------------------------------------------------------------------------

/**
 * A fake API server on 127.0.0.1. handler(req, body, res, ctx) answers; every request is recorded whole in `requests`
 * ({ method, url, headers, body }). Returns { port, requests, close() }.
 */
export function fakeServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      let body = {};
      try { body = JSON.parse(raw); } catch { /* empty */ }
      const rec = { method: req.method, url: req.url, headers: req.headers, body };
      requests.push(rec);
      try { handler(req, body, res, { n: requests.length, requests, rec }); } catch (e) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: String(e && e.stack ? e.stack : e) } })); }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    server.unref();
    resolve({ port: server.address().port, requests, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) });
  }));
}

export const sse = (res) => {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  return (event, data) => res.write(`${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
};

/** Pretty one-line text of a tool result as a request carries it, from any of the shapes. */
export function textOf(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(textOf).join("\n");
  if (typeof v === "object") {
    if (typeof v.text === "string") return v.text;
    if (v.content !== undefined) return textOf(v.content);
    if (v.output !== undefined) return textOf(v.output);
    if (v.response !== undefined) return textOf(v.response);
    return JSON.stringify(v);
  }
  return String(v);
}

/** Write a file; an object as JSON, a string or a Buffer as it is. */
export function putFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" || Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`);
  return file;
}
