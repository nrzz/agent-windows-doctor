// `check --live`: prove the shell claim of each agent with the agent's own binary, at zero tokens. A fake API listens on 127.0.0.1; the binary (the first of
// its kind on PATH, or the path of --claude, --codex, --gemini, --copilot) is started with the fake as its endpoint, in a throwaway home, config folder and
// project folder, and the model's one tool call asks the shell to print its own command line:
//   Claude Code     the tools of the first request (Bash, PowerShell) and the bash.exe its debug log says it took
//   Codex CLI       the command line of the command_execution item of `codex exec --json`: the PowerShell it started
//   Gemini CLI      the command line the PowerShell of run_shell_command prints for itself
//   Copilot CLI     the command line the powershell tool prints, or the error it answers with
//   Cursor          not run: its CLI needs a login
// The guard comes first, every time: before a binary starts, assertSandboxed() checks that HOME, USERPROFILE, LOCALAPPDATA, APPDATA, CODEX_HOME,
// COPILOT_HOME, CLAUDE_CONFIG_DIR and GEMINI_CLI_HOME all name a folder inside the throwaway base, and the proxies name a closed port on 127.0.0.1 with
// NO_PROXY=127.0.0.1,localhost: a run cannot touch the real ~/.codex, ~/.copilot, ~/.gemini or ~/.claude, or the network. A probe on 17 October 2026
// wrote into the real ~/.codex before this guard existed.
// What the run copies from your setup: PATH and the rest of the environment (without any variable of an agent), for Claude Code the two shell variables as
// this process has them and the `env` entries of those two variables and the whole-tool deny rules of your settings files. No hook, no helper and no other
// setting is copied, so nothing of yours runs. This file and src/sys.mjs are the only code that starts a program, and this file the only one that opens a
// connection (a server on 127.0.0.1, for the fake API).
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import * as W from "./winpath.mjs";
import { GIT_BASH_VAR, PS_VAR, VAR_SCOPES, expectedTools, predictShell } from "./claude-shell.mjs";
import { wholeToolDeny } from "./claude-settings.mjs";
import { shellFor } from "./shells.mjs";
import { makeLiveWorld, readDebugLog, writeClaudeWorld, writeCodexWorld, writeGeminiWorld } from "./write.mjs";

export const DEAD_PROXY = "http://127.0.0.1:9";
export const NO_PROXY = "127.0.0.1,localhost";
const TIMEOUT_MS = 120000;
export const HOME_VARS = ["HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "CODEX_HOME", "COPILOT_HOME", "CLAUDE_CONFIG_DIR", "GEMINI_CLI_HOME"];
const PROXY_VARS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"];
// the variables of any agent: none of them reaches a live run
const AGENT_VAR = /^(CLAUDE|ANTHROPIC|CLAUDECODE|AI_AGENT|MCP_|ENABLE_TOOL_SEARCH|CODEX|OPENAI|COPILOT|GEMINI|GOOGLE_GEMINI|CURSOR|FAKE_API|__PSLockdownPolicy|GITHUB_SHA|SURFACE)/i;

const getVar = (env, name) => { const k = Object.keys(env).find((x) => x.toLowerCase() === name.toLowerCase()); return k === undefined ? undefined : env[k]; };
function setVar(env, name, value) {
  for (const k of Object.keys(env)) if (k.toLowerCase() === name.toLowerCase()) delete env[k];
  if (value !== undefined) env[name] = value;
}

/** The guard. Throws unless every folder variable names a folder inside `root` and every proxy names the closed port. Returns the env. */
export function assertSandboxed(env, root) {
  if (!root) throw new Error("guard: no sandbox root to compare the environment with");
  for (const name of HOME_VARS) {
    const v = getVar(env, name);
    if (v === undefined || v === "") throw new Error(`guard: ${name} is not set: the agent would use the real folder (refusing to start a binary)`);
    if (!W.isAbsolute(v) || !W.isInside(v, root)) throw new Error(`guard: ${name}=${v} is not inside the sandbox ${root} (refusing to start a binary)`);
  }
  for (const name of PROXY_VARS) if (getVar(env, name) !== DEAD_PROXY) throw new Error(`guard: ${name} is not the closed port ${DEAD_PROXY} (refusing to start a binary)`);
  if (getVar(env, "NO_PROXY") !== NO_PROXY) throw new Error(`guard: NO_PROXY is not ${NO_PROXY} (refusing to start a binary)`);
  return env;
}

/** The environment of a live run: this machine's, without any variable of an agent, every folder inside the world, the proxies on the closed port, then `extra`. */
export function liveEnv(sys, world, extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(sys.env)) if (!AGENT_VAR.test(k) && !HOME_VARS.some((h) => h.toLowerCase() === k.toLowerCase())) env[k] = v;
  const set = {
    HOME: world.home, USERPROFILE: world.home, APPDATA: world.appData, LOCALAPPDATA: world.localAppData,
    CLAUDE_CONFIG_DIR: world.claude, CODEX_HOME: world.codex, COPILOT_HOME: world.copilot, GEMINI_CLI_HOME: world.home,
    NO_COLOR: "1", NO_PROXY, no_proxy: NO_PROXY,
  };
  for (const v of PROXY_VARS) { set[v] = DEAD_PROXY; }
  for (const [k, v] of Object.entries(set)) setVar(env, k, v);
  for (const [k, v] of Object.entries(extra)) setVar(env, k, v);
  return assertSandboxed(env, world.base);
}

function killTree(child) {
  try { spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }); } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } }
}

/** Starts a binary (an .exe, or an npm .cmd shim through cmd.exe) and waits: { code, out, err, timedOut, error }. The guard has passed before this is called. */
function startBinary(binary, args, { cwd, env, root }) {
  assertSandboxed(env, root);
  return new Promise((resolve) => {
    const shim = /\.(cmd|bat)$/i.test(binary);
    const quoted = args.map((a) => (/[\s"]/.test(a) || a === "" ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");
    const child = shim
      ? spawn(env.ComSpec || env.COMSPEC || "cmd.exe", ["/d", "/s", "/c", `""${binary}" ${quoted}"`], { cwd, env, windowsHide: true, windowsVerbatimArguments: true, stdio: ["ignore", "pipe", "pipe"] })
      : spawn(binary, args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let error = null;
    child.on("error", (e) => { error = e; });
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, TIMEOUT_MS);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: timedOut ? null : code, out, err, timedOut, error }); });
  });
}

/** `binary --version` in the live world: { version, note }: the version the program prints for itself, or null with what happened. */
export async function askVersion(sys, binary, world) {
  const env = liveEnv(sys, world, { DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1", COPILOT_AUTO_UPDATE: "false", GEMINI_CLI_NO_RELAUNCH: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" });
  const r = await startBinary(binary, ["--version"], { cwd: world.work, env, root: world.base });
  if (r.error) return { version: null, note: `could not start (${r.error.code || r.error.message})` };
  const m = /(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?)/.exec(r.out || "");
  if (r.code === 0 && m) return { version: m[1].replace(/\.$/, ""), note: null };
  return { version: null, note: r.timedOut ? "no answer in 120 seconds" : `did not print a version (exit ${r.code}${String(r.err || "").trim() ? `: ${String(r.err).trim().split(/\r?\n/)[0].slice(0, 80)}` : ""})` };
}

// ---- the fake APIs -------------------------------------------------------------------------------------------------------------

function listen(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      let body = {};
      try { body = JSON.parse(raw); } catch { /* empty */ }
      requests.push({ url: req.url, body });
      try { handler(req, body, res, requests.length); } catch (e) { res.writeHead(500); res.end(String(e && e.message ? e.message : e)); }
    });
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.unref();
      resolve({ port: server.address().port, requests, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) });
    });
  });
}
const sseWrite = (res, event, data) => res.write(`${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
export const PROBE_COMMAND = "[Environment]::CommandLine";

const CLAUDE_USAGE = { input_tokens: 1, output_tokens: 1 };
function claudeReply(id, model, text) {
  return [
    ["message_start", { type: "message_start", message: { id, type: "message", role: "assistant", model: model || "x", content: [], stop_reason: null, usage: CLAUDE_USAGE } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }],
    ["message_stop", { type: "message_stop" }],
  ];
}

/** The fake Messages API: every request is recorded, every answer is the text PROBE-DONE. */
export function startFakeClaude() {
  return listen((req, body, res, n) => {
    if (!req.url.includes("/v1/messages")) { res.writeHead(404); res.end("{}"); return; }
    if (body.stream === false) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: `msg_${n}`, type: "message", role: "assistant", model: body.model || "x", content: [{ type: "text", text: "done" }], stop_reason: "end_turn", usage: CLAUDE_USAGE })); return; }
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const [ev, data] of claudeReply(`msg_${n}`, body.model, "PROBE-DONE")) sseWrite(res, ev, data);
    res.end();
  });
}

const CODEX_USAGE = { input_tokens: 1, output_tokens: 1, total_tokens: 2 };
/** The fake Responses API: the first request gets a call of the shell tool, the next (it carries the result) the text PROBE-DONE. */
export function startFakeCodex() {
  return listen((req, body, res, n) => {
    if (!(req.method === "POST" && /\/responses(\?|$)/.test(req.url))) { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: `fake API: no route ${req.url}` } })); return; }
    res.writeHead(200, { "content-type": "text/event-stream" });
    sseWrite(res, "response.created", { type: "response.created", response: { id: `resp_${n}`, status: "in_progress", output: [] } });
    const done = (body.input || []).some((i) => i && i.type === "function_call_output");
    if (!done) {
      const tool = (body.tools || []).map((t) => t.name).find((x) => x === "exec_command" || x === "shell" || x === "shell_command") || "exec_command";
      const item = { type: "function_call", id: `fc_${n}`, call_id: `call_${n}`, name: tool, arguments: JSON.stringify({ cmd: PROBE_COMMAND }), status: "completed" };
      sseWrite(res, "response.output_item.added", { type: "response.output_item.added", output_index: 0, item });
      sseWrite(res, "response.output_item.done", { type: "response.output_item.done", output_index: 0, item });
      sseWrite(res, "response.completed", { type: "response.completed", response: { id: `resp_${n}`, status: "completed", output: [item], usage: CODEX_USAGE } });
    } else {
      const msg = { type: "message", id: `msg_${n}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: "PROBE-DONE", annotations: [] }] };
      sseWrite(res, "response.output_item.added", { type: "response.output_item.added", output_index: 0, item: msg });
      sseWrite(res, "response.output_text.delta", { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "PROBE-DONE" });
      sseWrite(res, "response.output_item.done", { type: "response.output_item.done", output_index: 0, item: msg });
      sseWrite(res, "response.completed", { type: "response.completed", response: { id: `resp_${n}`, status: "completed", output: [msg], usage: CODEX_USAGE } });
    }
    res.end();
  });
}

function fromSchema(s) {
  if (!s || typeof s !== "object") return {};
  const t = String(s.type || (s.properties ? "object" : "")).toLowerCase();
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  if (t === "object" || s.properties) { const o = {}; for (const [k, v] of Object.entries(s.properties || {})) o[k] = fromSchema(v); return o; }
  if (t === "array") return [];
  if (t === "number" || t === "integer") return 1;
  if (t === "boolean") return false;
  return "x";
}
const geminiChunk = (part) => ({ candidates: [{ content: { role: "model", parts: [part] }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }, modelVersion: "fake" });
/**
 * The fake Gemini API. The CLI asks a "utility_router" role to classify the request before the main turn: a request that wants JSON gets a document built
 * from the schema it sends, so the router succeeds at once (an answer that is not JSON makes the CLI retry for about 90 seconds).
 */
export function startFakeGemini() {
  return listen((req, body, res) => {
    const url = req.url;
    if (url.includes(":countTokens")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ totalTokens: 1 })); return; }
    const gc = body.generationConfig || {};
    const wantsJson = gc.responseMimeType === "application/json" || gc.responseJsonSchema || gc.responseSchema;
    if (url.includes(":streamGenerateContent")) {
      const answered = (body.contents || []).some((c) => (c.parts || []).some((p) => p.functionResponse));
      res.writeHead(200, { "content-type": "text/event-stream" });
      sseWrite(res, null, geminiChunk(answered ? { text: "PROBE-DONE" } : { functionCall: { name: "run_shell_command", args: { command: PROBE_COMMAND, description: "probe" } } }));
      res.end();
      return;
    }
    if (url.includes(":generateContent")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(geminiChunk({ text: wantsJson ? JSON.stringify(fromSchema(gc.responseJsonSchema || gc.responseSchema)) : "PROBE-DONE" }))); return; }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `fake API: no route ${url}` } }));
  });
}

/** The fake OpenAI-style provider of Copilot CLI: the first request gets a call of the shell tool the request lists, the next the text PROBE-DONE. */
export function startFakeCopilot() {
  return listen((req, body, res, n) => {
    if (req.url.includes("/models")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ object: "list", data: [{ id: "gpt-4.1", object: "model" }] })); return; }
    if (!req.url.includes("/chat/completions")) { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: `fake API: no route ${req.url}` } })); return; }
    const names = (body.tools || []).map((t) => (t.function && t.function.name) || t.name);
    const shell = names.find((t) => /^(powershell|bash)$/i.test(t));
    const call = shell && !(body.messages || []).some((m) => m.role === "tool") ? [{ id: `call_${n}`, type: "function", function: { name: shell, arguments: JSON.stringify({ command: PROBE_COMMAND, description: "probe" }) } }] : null;
    const base = { id: `c_${n}`, object: "chat.completion.chunk", created: 0, model: body.model };
    if (body.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      sseWrite(res, null, { ...base, choices: [{ index: 0, delta: call ? { role: "assistant", tool_calls: call.map((tc, i) => ({ index: i, ...tc })) } : { role: "assistant", content: "PROBE-DONE" }, finish_reason: null }] });
      sseWrite(res, null, { ...base, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      sseWrite(res, null, "[DONE]");
      res.end();
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ...base, object: "chat.completion", choices: [{ index: 0, message: call ? { role: "assistant", content: null, tool_calls: call } : { role: "assistant", content: "PROBE-DONE" }, finish_reason: call ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    }
  });
}

// ---- Claude Code ------------------------------------------------------------------------------------------------------------------

const userText = (j) => (j.messages || []).filter((m) => m.role === "user").map((m) => (typeof m.content === "string" ? m.content : (m.content || []).map((b) => b.text || "").join(""))).join("\n");

/** The settings that a live run gets: the `env` of the two shell variables and the whole-tool deny rules, by scope. Managed settings are put in the user file. */
export function liveSettings(facts) {
  const out = { user: { env: {}, permissions: { deny: [] } }, project: { env: {}, permissions: { deny: [] } }, local: { env: {}, permissions: { deny: [] } } };
  for (const scope of ["user", "project", "local", "managed"]) {
    const target = out[scope === "managed" ? "user" : scope];
    for (const name of [GIT_BASH_VAR, PS_VAR]) {
      if (!VAR_SCOPES[name].includes(scope)) continue;
      const block = facts.env[scope] || {};
      if (Object.prototype.hasOwnProperty.call(block, name)) target.env[name] = block[name];
    }
  }
  for (const d of facts.deny) if (wholeToolDeny(d.rule)) out[d.scope === "managed" ? "user" : d.scope].permissions.deny.push(d.rule);
  const clean = {};
  for (const [scope, s] of Object.entries(out)) {
    const o = {};
    if (Object.keys(s.env).length) o.env = s.env;
    if (s.permissions.deny.length) o.permissions = { deny: s.permissions.deny };
    if (Object.keys(o).length) clean[scope] = o;
  }
  return clean;
}

/** Runs Claude Code against the fake Messages API and reads the tools of its first request. Returns { ran, exitCode, tools, shellTools, edition, using, warning, notFound, stderr, requests, cwd } or { ran: false, error }. */
export async function runClaude(sys, { binary, world, facts }) {
  writeClaudeWorld(world, liveSettings(facts));
  const api = await startFakeClaude();
  try {
    const env = liveEnv(sys, world, {
      [GIT_BASH_VAR]: sys.getEnv(GIT_BASH_VAR), [PS_VAR]: sys.getEnv(PS_VAR),
      DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      ANTHROPIC_API_KEY: "sk-ant-probe", ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.port}`,
    });
    const r = await startBinary(binary, ["-p", "PROBE-MAIN hello", "--output-format", "json", "--debug-file", world.debugFile], { cwd: world.work, env, root: world.base });
    if (r.error) return { ran: false, error: `${binary} could not be started (${r.error.code || r.error.message})` };
    const main = api.requests.map((x) => x.body).find((b) => userText(b).includes("PROBE-MAIN")) || (api.requests[0] && api.requests[0].body);
    const tools = main && main.tools ? main.tools.map((t) => t.name) : [];
    const ps = main && main.tools ? main.tools.find((t) => t.name === "PowerShell") : null;
    const log = readDebugLog(world.debugFile);
    return {
      ran: true, exitCode: r.code, timedOut: r.timedOut, requests: api.requests.length, tools,
      shellTools: tools.filter((n) => n === "Bash" || n === "PowerShell"),
      edition: ps ? (/PowerShell edition: ([^\n]*)/.exec(ps.description) || [])[1] || null : null,
      using: (/Using bash path: "([^"]*)"/.exec(log) || [])[1] || null,
      warning: (/CLAUDE_CODE_GIT_BASH_PATH "[^\n]*falling back to auto-detection/.exec(log) || [])[0] || null,
      notFound: /Git Bash not found; BashTool will be unavailable/.test(log),
      stderr: r.err.trim().split(/\r?\n/)[0] || "", cwd: world.work,
    };
  } finally { await api.close(); }
}

/** Claude Code: runs the binary and compares what it listed with the prediction for the same run. */
export async function proveClaude(sys, { binary, world, facts, runner = runClaude }) {
  const run = await runner(sys, { binary, world, facts });
  if (!run.ran) return { ok: false, error: run.error };
  const prediction = predictShell(sys, { cwd: run.cwd, facts });
  const predicted = { tools: expectedTools(prediction), exit: prediction.fatal ? 1 : 0, bash: prediction.gitBash.path, how: prediction.gitBash.how };
  const actual = { tools: run.shellTools, exit: run.exitCode === 0 ? 0 : 1, bash: run.using };
  const differences = [];
  if (JSON.stringify(predicted.tools) !== JSON.stringify(actual.tools)) differences.push(`the binary listed ${actual.tools.join(" and ") || "no shell tool"}; the prediction was ${predicted.tools.join(" and ") || "no shell tool"}`);
  if (predicted.exit !== actual.exit) differences.push(`the binary exited with code ${run.exitCode}; the prediction was ${predicted.exit}`);
  if (actual.exit === 0 && predicted.bash && actual.bash && W.key(predicted.bash) !== W.key(actual.bash)) differences.push(`the binary took ${actual.bash}; the prediction was ${predicted.bash}`);
  if (actual.exit === 0 && !predicted.bash && actual.bash) differences.push(`the binary took ${actual.bash}; the prediction found no Git Bash`);
  return { ok: true, run, predicted, actual, proved: differences.length === 0, differences };
}

// ---- Codex CLI, Gemini CLI and Copilot CLI --------------------------------------------------------------------------------------

/** The program a command line starts: `"C:\a b\pwsh.exe" -Command x` -> C:\a b\pwsh.exe; `C:\x\powershell.exe -NoProfile` -> C:\x\powershell.exe. */
export function programOf(commandLine) {
  const t = String(commandLine || "").trim();
  if (t.startsWith('"')) { const end = t.indexOf('"', 1); return end > 0 ? t.slice(1, end) : null; }
  const m = /^(\S+)/.exec(t);
  return m ? m[1] : null;
}

const samePath = (a, b) => Boolean(a && b) && W.key(a.replace(/\\\\/g, "\\")) === W.key(b.replace(/\\\\/g, "\\"));
const baseName = (p) => (p ? W.basename(p).toLowerCase() : null);

/** Codex: `codex exec --json` against the fake Responses API; the command_execution item says which PowerShell started the command. */
export async function runCodex(sys, { binary, world }) {
  const api = await startFakeCodex();
  try {
    writeCodexWorld(world, api.port);
    const env = liveEnv(sys, world, { FAKE_API_KEY: "fake" });
    const r = await startBinary(binary, ["exec", "--skip-git-repo-check", "-C", world.work, "--json", "hello"], { cwd: world.work, env, root: world.base });
    if (r.error) return { ran: false, error: `${binary} could not be started (${r.error.code || r.error.message})` };
    const events = r.out.split(/\r?\n/).filter((l) => l.startsWith("{")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const item = events.find((e) => e.type === "item.completed" && e.item && e.item.type === "command_execution");
    const line = item ? item.item.command : null;
    return { ran: true, exitCode: r.code, timedOut: r.timedOut, requests: api.requests.length, line, program: programOf(line), output: item ? item.item.aggregated_output : null, stderr: r.err.trim().split(/\r?\n/).filter((l) => !/^WARNING: proceeding|^Reading additional/.test(l))[0] || "" };
  } finally { await api.close(); }
}

/** Gemini: a headless turn whose run_shell_command prints the command line of the PowerShell it started. */
export async function runGemini(sys, { binary, world }) {
  writeGeminiWorld(world);
  const api = await startFakeGemini();
  try {
    const env = liveEnv(sys, world, { GEMINI_API_KEY: "fake", GOOGLE_GEMINI_BASE_URL: `http://127.0.0.1:${api.port}`, GEMINI_CLI_TRUST_WORKSPACE: "true", GEMINI_CLI_NO_RELAUNCH: "1", NO_BROWSER: "1" });
    const r = await startBinary(binary, ["-p", "hello", "--yolo", "--skip-trust", "--output-format", "json"], { cwd: world.work, env, root: world.base });
    if (r.error) return { ran: false, error: `${binary} could not be started (${r.error.code || r.error.message})` };
    let text = "";
    for (let i = api.requests.length - 1; i >= 0 && !text; i--) for (const c of api.requests[i].body.contents || []) for (const p of c.parts || []) if (p.functionResponse) text = JSON.stringify(p.functionResponse.response);
    let decoded = text;
    try { const j = JSON.parse(text); decoded = typeof j === "string" ? j : (j.output !== undefined ? j.output : (j.error !== undefined ? JSON.stringify({ error: j.error }) : text)); } catch { /* keep */ }
    const out = /Output:\s*([^\n]*)/.exec(String(decoded).replace(/\\r\\n|\\n/g, "\n"));
    const error = /spawn (\S+) ENOENT/.exec(String(decoded));
    const line = out ? out[1].trim() : null;
    return { ran: true, exitCode: r.code, timedOut: r.timedOut, requests: api.requests.length, line, program: programOf(line), error: error ? `spawn ${error[1]} ENOENT` : null, stderr: r.err.trim().split(/\r?\n/).filter((l) => !/true color|YOLO|Ripgrep/i.test(l))[0] || "" };
  } finally { await api.close(); }
}

/** Copilot: offline BYOK against the fake provider; the powershell tool prints its own command line, or answers with an error. */
export async function runCopilot(sys, { binary, world }) {
  const api = await startFakeCopilot();
  try {
    const env = liveEnv(sys, world, {
      COPILOT_OFFLINE: "true", COPILOT_PROVIDER_BASE_URL: `http://127.0.0.1:${api.port}/v1`, COPILOT_PROVIDER_TYPE: "openai", COPILOT_PROVIDER_WIRE_API: "completions",
      COPILOT_PROVIDER_API_KEY: "fake", COPILOT_MODEL: "gpt-4.1", COPILOT_PROVIDER_MAX_PROMPT_TOKENS: "100000", COPILOT_PROVIDER_MAX_OUTPUT_TOKENS: "4000", COPILOT_ALLOW_ALL: "true", COPILOT_AUTO_UPDATE: "false",
    });
    const r = await startBinary(binary, ["-p", "hello", "--allow-all-tools", "-s", "-C", world.work], { cwd: world.work, env, root: world.base });
    if (r.error) return { ran: false, error: `${binary} could not be started (${r.error.code || r.error.message})` };
    let text = "";
    for (let i = api.requests.length - 1; i >= 0 && !text; i--) for (const m of api.requests[i].body.messages || []) if (m.role === "tool") text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    const notAvailable = /PowerShell is not available\. Tried [^\n]*/.exec(text);
    const line = notAvailable ? null : (text.split(/\r?\n/).find((l) => /^"?(pwsh|powershell)(\.exe)?"?\s/i.test(l)) || null);
    return { ran: true, exitCode: r.code, timedOut: r.timedOut, requests: api.requests.length, line, program: programOf(line), error: notAvailable ? notAvailable[0].slice(0, 160) : null, stderr: r.err.trim().split(/\r?\n/)[0] || "" };
  } finally { await api.close(); }
}

/** Compares a run with the shell the tool predicted for that agent. Returns { ok, run, predicted, actual, proved, differences }. */
export async function proveShellOf(agent, sys, { binary, world, machine, runner }) {
  const predicted = shellFor(agent, { machine });
  const run = await (runner || { codex: runCodex, gemini: runGemini, copilot: runCopilot }[agent])(sys, { binary, world });
  if (!run.ran) return { ok: false, error: run.error };
  const differences = [];
  const want = predicted.shell ? predicted.shell.path : null;
  const got = run.program;
  const actual = { shell: got, error: run.error || null };
  if (predicted.state === "missing") {
    if (!run.error) differences.push(`no PowerShell was predicted (neither pwsh.exe nor powershell.exe is on PATH), and the binary started ${got || "something"}`);
  } else if (run.error) {
    differences.push(`the binary answered with an error (${run.error}); the prediction was ${want}`);
  } else if (!got) {
    differences.push(`the binary did not print a command line (exit ${run.exitCode}${run.stderr ? `: ${run.stderr}` : ""}); the prediction was ${want}`);
  } else if (agent === "copilot" ? baseName(got) !== baseName(want) : !samePath(got, want)) {
    differences.push(`the binary started ${got}; the prediction was ${agent === "copilot" ? baseName(want) : want}`);
  }
  return { ok: true, run, predicted: { shell: want, state: predicted.state }, actual, proved: differences.length === 0, differences };
}

/** The binary to run for an agent: the path given, else the first runnable program on PATH, else the first runnable program found anywhere. */
export function pickBinary(sys, agent, entries, given) {
  if (given) return { path: given, source: "named with the option" };
  const first = entries.first && !entries.first.skipped ? entries.first : null;
  if (first) return { path: first.path, source: "the first on PATH", entry: first };
  const other = entries.entries.find((e) => !e.skipped && e.kind === "program" && /\.(exe|cmd|bat)$/i.test(e.path) && e.origin !== "editor" && e.origin !== "npm-program");
  return other ? { path: other.path, source: "not on PATH; the first program found", entry: other } : null;
}

export { makeLiveWorld };

/**
 * `check --live` for every agent asked for. `paths` are the --claude, --codex, --gemini and --copilot options; `runners` replace the real runs (the tests put
 * a stand-in there, so that a pretend machine starts nothing). Returns { ok, agents: { <id>: { ok, binary, proved, ... } | { skipped } } }.
 * An agent that is not on the machine is skipped, not failed; a program that is named and is not a file, or does not run, or does not match, fails.
 */
export async function liveAll(sys, { facts, paths = {}, runners = {}, tmpdir, makeDir, removeDir }) {
  const agents = {};
  let failed = false;
  for (const id of facts.agents) {
    if (id === "cursor") { agents.cursor = { skipped: "the Cursor CLI needs a login, so it is not run" }; continue; }
    const pick = pickBinary(sys, id, facts.inventory.agents[id], paths[id]);
    if (!pick) { agents[id] = { skipped: "not found on this machine: nothing to prove" }; continue; }
    if (!sys.isFile(pick.path)) { agents[id] = { ok: false, error: `${pick.path} is not a file`, binary: { path: pick.path, version: null, asked: null, source: pick.source } }; failed = true; continue; }
    const injected = Boolean(runners[id]);
    const base = injected ? tmpdir : makeDir(tmpdir);
    try {
      const world = injected ? { base, home: base, work: base, debugFile: path.join(base, "debug.log") } : makeLiveWorld(base);
      const asked = injected ? { version: null, note: null } : await askVersion(sys, pick.path, world);
      const binary = { path: pick.path, version: pick.entry ? pick.entry.version : null, asked: asked.version, note: asked.note, source: pick.source };
      const r = id === "claude"
        ? await proveClaude(sys, { binary: pick.path, world, facts: facts.claude.settingsFacts, runner: runners.claude })
        : await proveShellOf(id, sys, { binary: pick.path, world, machine: facts.machine, runner: runners[id] });
      agents[id] = { ...r, binary };
      if (!r.ok || !r.proved) failed = true;
    } finally { if (!injected) removeDir(base); }
  }
  return { ok: !failed, agents };
}
