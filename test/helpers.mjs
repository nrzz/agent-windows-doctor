// Shared test helpers: throwaway worlds (a home folder with a config folder for every agent, a project folder, stand-in programs, a file
// that stands in for the registry's user environment) and ways to run the CLI.
//
// SAFETY: nothing here reads or writes the real ~/.claude, ~/.codex, ~/.copilot, ~/.gemini or ~/.cursor, the real %LOCALAPPDATA% or
// %APPDATA%, or the real registry. Importing this file points HOME, USERPROFILE, APPDATA, LOCALAPPDATA, CLAUDE_CONFIG_DIR, CODEX_HOME,
// COPILOT_HOME and GEMINI_CLI_HOME of the test process at an empty temporary folder, names a closed port on 127.0.0.1 as the proxy, and
// makes the tool read a file where it would read HKCU\Environment, so even a test that forgets to pass its own environment cannot reach
// them. Every child process gets a world's environment, and runCli refuses to run when one of those folders is outside the OS temp folder.
// test/sandbox.mjs adds the guard that runs before any agent binary starts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { main } from "../src/cli.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CLI = path.join(ROOT, "bin", "agent-windows-doctor.mjs");
export const IS_WIN = process.platform === "win32";
export const NOW = Date.parse("2026-10-18T12:00:00.000Z");

const made = [];
export function tmpDir(prefix = "adw-") {
  // the native real path: on Windows it also turns a short name (RUNNER~1) into the long one, which is what the tool and the agents see
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  return dir;
}
process.on("exit", () => { if (process.env.ADW_KEEP_WORLDS) return; for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* the OS cleans the temp folder eventually */ } } });

// A closed port on this machine. Every run's proxy variables name it, so a request to anything but 127.0.0.1 (which NO_PROXY lets through:
// that is where the fake APIs listen) fails at once, even if a world is built wrong and a run would otherwise reach the real service.
export const DEAD_PROXY = "http://127.0.0.1:9";
export const NO_PROXY = "127.0.0.1,localhost";

// The variables that name a place where an agent, or Windows, keeps files. A child of a test gets every one pointed into its world.
export const HOME_VARS = ["HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "CODEX_HOME", "COPILOT_HOME", "CLAUDE_CONFIG_DIR", "GEMINI_CLI_HOME"];
export const PROXY_VARS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"];

/** The environment of a throwaway home: every variable that names a folder of an agent points into `home`, and every proxy names a closed port. */
export function homeEnv(home) {
  const env = {
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
    CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
    CODEX_HOME: path.join(home, ".codex"),
    COPILOT_HOME: path.join(home, ".copilot"),
    GEMINI_CLI_HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    XDG_STATE_HOME: path.join(home, ".local", "state"),
    // places of machine-wide files the tool reads: nothing there
    ProgramData: path.join(home, "no-program-data"),
    AGENT_WINDOWS_DOCTOR_MANAGED_DIR: path.join(home, "no-managed-settings"),
    AGENT_WINDOWS_DOCTOR_USER_ENV_FILE: path.join(home, "user-env.json"),
    NO_COLOR: "1",
    NO_PROXY,
    no_proxy: NO_PROXY,
  };
  for (const v of PROXY_VARS) { env[v] = DEAD_PROXY; env[v.toLowerCase()] = DEAD_PROXY; }
  if (IS_WIN) { env.HOMEDRIVE = path.parse(home).root.replace(/[\\/]$/, ""); env.HOMEPATH = home.slice(path.parse(home).root.length - 1); }
  return env;
}

// The guard for this process: an empty home, and nothing of the machine's agent sessions in the environment.
const guard = tmpDir("adw-guard-");
export const GUARD = guard;
Object.assign(process.env, homeEnv(guard));
delete process.env.FORCE_COLOR;
// the machine's agent variables go (this suite is often run from inside an agent), except the ones that name a folder (set above) and the E2E_* ones that switch the real-binary checks on
for (const k of Object.keys(process.env)) {
  if (/^(CLAUDE|ANTHROPIC|CLAUDECODE|AI_AGENT|MCP_|ENABLE_TOOL_SEARCH|CODEX|OPENAI|COPILOT|GEMINI|GOOGLE_GEMINI|CURSOR|FAKE_API|ADW_FAKE|__PSLockdownPolicy)/i.test(k) && !HOME_VARS.includes(k)) delete process.env[k];
}

export const realTmp = () => fs.realpathSync.native(os.tmpdir());
const norm = (p) => path.resolve(String(p)).toLowerCase();
export const underTmp = (p) => Boolean(p) && norm(p).startsWith(norm(realTmp()));
/** Is `child` the folder `parent` or inside it? (case-insensitive on Windows, where file names ignore case) */
export function isInside(child, parent) {
  if (!child || !parent) return false;
  const a = IS_WIN ? norm(child) : path.resolve(child);
  const b = IS_WIN ? norm(parent) : path.resolve(parent);
  const rel = path.relative(b, a);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

const asText = (v) => (typeof v === "string" ? v : `${JSON.stringify(v, null, 2)}\n`);
export const put = (file, v) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, asText(v)); return file; };
export const fwd = (p) => String(p).split(path.sep).join("/");
export const read = (file) => fs.readFileSync(file, "utf8");
export const exists = (file) => fs.existsSync(file);

/**
 * A throwaway world on the real disk. base/home is HOME (USERPROFILE, GEMINI_CLI_HOME), with .claude, .codex, .copilot, .gemini and .cursor in
 * it and AppData\Roaming and AppData\Local; base/work/proj is the project folder; base/bin holds stand-in programs.
 */
export function world(name = "w") {
  const base = tmpDir(`adw-${name}-`);
  const home = path.join(base, "home");
  const work = path.join(base, "work", "proj");
  const bin = path.join(base, "bin");
  for (const d of [home, work, bin]) fs.mkdirSync(d, { recursive: true });
  const env = { ...process.env, ...homeEnv(home) };
  delete env.FORCE_COLOR;
  return {
    base, home, work, bin, env, root: base,
    claude: env.CLAUDE_CONFIG_DIR,
    codex: env.CODEX_HOME,
    copilot: env.COPILOT_HOME,
    gemini: path.join(home, ".gemini"),
    cursor: path.join(home, ".cursor"),
    appData: env.APPDATA,
    localAppData: env.LOCALAPPDATA,
    userEnvFile: env.AGENT_WINDOWS_DOCTOR_USER_ENV_FILE,
    write: (file, v) => put(file, v),
    read: (file) => fs.readFileSync(file, "utf8"),
    exists: (file) => fs.existsSync(file),
    readJson: (file) => JSON.parse(fs.readFileSync(file, "utf8")),
    userEnv: () => (fs.existsSync(env.AGENT_WINDOWS_DOCTOR_USER_ENV_FILE) ? JSON.parse(fs.readFileSync(env.AGENT_WINDOWS_DOCTOR_USER_ENV_FILE, "utf8")) : {}),
    setUserEnv: (obj) => put(env.AGENT_WINDOWS_DOCTOR_USER_ENV_FILE, obj),
  };
}

/** Every file under a folder with its bytes, as { relative path: hex digest }, to compare two states of a folder. */
export function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else out[path.relative(dir, p).split(path.sep).join("/")] = fs.readFileSync(p).toString("hex");
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

/** Runs the real CLI in a child process. */
export function runCli(args, { cwd, env, input, timeout = 120000 } = {}) {
  const e = { ...process.env, ...env };
  for (const k of HOME_VARS) {
    if (!underTmp(e[k] || "")) throw new Error(`runCli needs an environment from world(): ${k} must be a temporary folder`);
  }
  if (!e.AGENT_WINDOWS_DOCTOR_USER_ENV_FILE) throw new Error("runCli needs an environment from world(): the user environment must be a file");
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env: e, input: input ?? "", encoding: "utf8", windowsHide: true, timeout });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "", all: `${r.stdout || ""}${r.stderr || ""}` };
}

/**
 * Runs main() in this process, on the machine `sys` (a pretend one from test/machine.mjs, or the real one), and captures what it prints.
 * With a pretend machine the throwaway folders are pretend too (no folder is made on the disk) unless `tempDir` says otherwise.
 */
export async function run(args, { sys, userEnv, tempDir, liveRunner, now = NOW, env } = {}) {
  let out = "";
  let err = "";
  const code = await main(args, {
    sys,
    userEnv,
    liveRunner,
    tempDir: tempDir || (sys && sys.runs ? (sys.platform === "win32" ? "C:\\Temp\\adw-test" : "/tmp/adw-test") : undefined),
    env,
    now,
    stdout: { write: (s) => { out += s; return true; } },
    stderr: { write: (s) => { err += s; return true; } },
  });
  return { code, out, err, all: out + err, json: () => JSON.parse(out) };
}
