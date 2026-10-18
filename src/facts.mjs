// What the machine says about the setup problems behind the common Windows issues: Node and npm, long paths (the registry switch and
// git's core.longpaths), git's core.autocrlf, the PowerShell execution policy, the console code page, and a stale .git\index.lock. Every
// function only reads (a registry value, the output of git config, powershell Get-ExecutionPolicy -List, chcp, tasklist, a file) and
// never throws: what cannot be read is { ok: false, error }.
import * as W from "./winpath.mjs";
import { readRegValue } from "./winenv.mjs";

const FILE_SYSTEM_KEY = "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem";
const NLS_KEY = "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage";

const firstLine = (s) => String(s || "").split(/\r?\n/).find((l) => l.trim()) || "";

/** Node (the one that runs this tool) and npm (the one on PATH). npm is told not to write a log or an update-notifier file: asking its version should leave nothing behind. */
export function nodeFacts(sys) {
  const win = sys.platform === "win32";
  const env = { ...sys.env, npm_config_update_notifier: "false", npm_config_logs_max: "0", npm_config_fund: "false", npm_config_audit: "false" };
  const r = win ? sys.run("cmd.exe", ["/d", "/s", "/c", "\"npm --version\""], { verbatim: true, env, timeout: 30000 }) : sys.run("npm", ["--version"], { env, timeout: 30000 });
  const npm = !r.error && r.status === 0 ? firstLine(r.stdout).trim() : null;
  let prefix = null;
  if (npm) {
    const p = win ? sys.run("cmd.exe", ["/d", "/s", "/c", "\"npm config get prefix\""], { verbatim: true, env, timeout: 30000 }) : sys.run("npm", ["config", "get", "prefix"], { env, timeout: 30000 });
    if (!p.error && p.status === 0) prefix = firstLine(p.stdout).trim() || null;
  }
  return { node: String(sys.nodeVersion || "").replace(/^v/, ""), nodePath: sys.nodePath || null, npm, npmPrefix: prefix, npmFound: npm !== null };
}

/** [{ origin, value }] from `git config --show-origin --get-all <key>`; the last is the one that counts. */
export function parseGitConfigOrigin(text) {
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = /^([^\t]+)\t(.*)$/.exec(line);
    if (m) out.push({ origin: m[1].replace(/^file:/, ""), value: m[2].trim() });
  }
  return out;
}

/** What git says for core.autocrlf and core.longpaths, from the working folder: { ok, version, autocrlf, longpaths } with each as { value, origin } or null. */
export function gitFacts(sys, cwd) {
  const where = cwd && sys.isDir(cwd) ? cwd : undefined;
  const v = sys.run("git", ["--version"], { cwd: where, timeout: 20000 });
  if (v.error || v.status !== 0) return { ok: false, version: null, autocrlf: null, longpaths: null, error: v.error ? `git could not run (${v.error.code || v.error.message})` : `git --version exited ${v.status}` };
  const get = (key) => {
    const r = sys.run("git", ["config", "--show-origin", "--get-all", key], { cwd: where, timeout: 20000 });
    if (r.error || r.status !== 0) return null;
    const all = parseGitConfigOrigin(r.stdout);
    return all.length ? all[all.length - 1] : null;
  };
  return { ok: true, version: (/git version (\S+)/.exec(v.stdout) || [])[1] || null, autocrlf: get("core.autocrlf"), longpaths: get("core.longpaths"), error: null };
}

/** Windows' long path switch: { ok, enabled: true | false | null }. */
export function longPathFacts(sys) {
  if (sys.platform !== "win32") return { ok: true, enabled: null };
  const r = readRegValue(sys, FILE_SYSTEM_KEY, "LongPathsEnabled");
  if (!r.ok) return { ok: false, enabled: null, error: r.error };
  if (!r.exists) return { ok: true, enabled: false, set: false };
  const n = Number(String(r.value).trim());
  return { ok: true, enabled: n === 1, set: true };
}

/** `Get-ExecutionPolicy -List` as [{ scope, policy }] in the order PowerShell gives them (MachinePolicy, UserPolicy, Process, CurrentUser, LocalMachine). */
export function parseExecutionPolicy(text) {
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = /^(MachinePolicy|UserPolicy|Process|CurrentUser|LocalMachine)=(\w+)\s*$/.exec(line.trim());
    if (m) out.push({ scope: m[1], policy: m[2] });
  }
  return out;
}

/**
 * The policy a script run would get: the first scope that is not Undefined, else Restricted (the default of Windows client versions).
 * `byClaude` is what Claude Code adds: it starts PowerShell with -ExecutionPolicy Bypass at process scope unless
 * CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY is on (Group Policy, MachinePolicy and UserPolicy, still wins).
 */
export function effectivePolicy(list, { respect = false } = {}) {
  const get = (scope) => (list.find((x) => x.scope === scope) || {}).policy || "Undefined";
  const order = ["MachinePolicy", "UserPolicy", "Process", "CurrentUser", "LocalMachine"];
  const firstDefined = (scopes) => { for (const s of scopes) { const p = get(s); if (p !== "Undefined") return { scope: s, policy: p }; } return { scope: "default", policy: "Restricted" }; };
  const machine = firstDefined(order);
  if (respect) return { ...machine, bypassed: false };
  const group = firstDefined(["MachinePolicy", "UserPolicy"]);
  if (group.scope !== "default") return { ...group, bypassed: false };
  return { scope: "Process", policy: "Bypass", bypassed: true, underneath: machine };
}

export const BLOCKING = new Set(["Restricted", "AllSigned"]);

/** The execution policy: { ok, list, machine, respect, effective }. `shell` is the PowerShell to ask: Claude Code's, else System32's. */
export function executionPolicyFacts(sys, { shell, respect = false } = {}) {
  if (sys.platform !== "win32") return { ok: true, list: [], effective: null };
  const exe = shell || "powershell.exe";
  // a PowerShell started from another one (this tool run from pwsh 7, as on a CI runner) inherits the other's PSModulePath, and Windows PowerShell 5.1
  // then loads the modules of PowerShell 7 and fails; with no PSModulePath each PowerShell works out its own
  const env = Object.fromEntries(Object.entries(sys.env).filter(([k]) => k.toLowerCase() !== "psmodulepath"));
  const r = sys.run(exe, ["-NoProfile", "-NonInteractive", "-Command", "Get-ExecutionPolicy -List | ForEach-Object { $_.Scope.ToString() + '=' + $_.ExecutionPolicy.ToString() }"], { env, timeout: 60000 });
  if (r.error || r.status !== 0) {
    const said = String(r.stderr || r.stdout || "").trim().split(/\r?\n/).find((l) => l.trim());
    return { ok: false, list: [], effective: null, error: r.error ? `${exe} could not run (${r.error.code || r.error.message})` : `${exe} exited ${r.status}${said ? `: ${said.trim().slice(0, 160)}` : ""}` };
  }
  const list = parseExecutionPolicy(r.stdout);
  if (!list.length) return { ok: false, list, effective: null, error: "Get-ExecutionPolicy -List printed no policy" };
  return { ok: true, list, respect, effective: effectivePolicy(list, { respect }), machine: effectivePolicy(list, { respect: true }) };
}

/** The console's code page and the system's two: { ok, active, oem, ansi }. */
export function codePageFacts(sys) {
  if (sys.platform !== "win32") return { ok: true, active: null, oem: null, ansi: null };
  const r = sys.run("cmd.exe", ["/d", "/s", "/c", "\"chcp\""], { verbatim: true, timeout: 20000 });
  // the words of the line are in the language of Windows ("Active code page: 437"); the number is the last thing on it
  const active = !r.error && r.status === 0 ? Number((/(\d{3,5})\s*$/m.exec(String(r.stdout)) || [])[1]) || null : null;
  const num = (name) => { const v = readRegValue(sys, NLS_KEY, name); return v.ok && v.exists ? Number(String(v.value).trim()) || null : null; };
  return { ok: active !== null, active, oem: num("OEMCP"), ansi: num("ACP"), error: active === null ? "chcp printed no code page" : null };
}

/** The git folder that holds the index of the project: the .git folder, or the folder a worktree's .git file names. */
export function gitDirOf(sys, project) {
  const win = sys.platform === "win32";
  let dir = project;
  for (let i = 0; i < 64; i++) {
    const dot = win ? W.join(dir, ".git") : `${dir.replace(/\/$/, "")}/.git`;
    if (sys.isDir(dot)) return { gitDir: dot, root: dir };
    if (sys.isFile(dot)) {
      const m = /^gitdir:\s*(.+)$/m.exec(sys.readText(dot) || "");
      if (m) {
        const g = m[1].trim();
        const abs = win ? (W.isAbsolute(g) ? W.join(g) : W.join(dir, g)) : (g.startsWith("/") ? g : `${dir}/${g}`);
        return { gitDir: abs, root: dir, worktree: true };
      }
    }
    const up = win ? W.dirname(dir) : dir.replace(/\/[^/]*$/, "") || "/";
    if (up === dir || (win ? W.same(up, dir) : false)) return null;
    dir = up;
  }
  return null;
}

/** A leftover .git\index.lock in the project: { ok, lock: { path, ageMs, gitRunning } | null, gitDir }. */
export function indexLockFacts(sys, project) {
  const g = gitDirOf(sys, project);
  if (!g) return { ok: true, gitDir: null, lock: null };
  const lock = sys.platform === "win32" ? W.join(g.gitDir, "index.lock") : `${g.gitDir}/index.lock`;
  if (!sys.isFile(lock)) return { ok: true, gitDir: g.gitDir, lock: null };
  const st = sys.stat(lock);
  let running = null;
  if (sys.platform === "win32") {
    const t = sys.run("tasklist", ["/FI", "IMAGENAME eq git.exe", "/NH"], { timeout: 30000 });
    if (!t.error && t.status === 0) running = /git\.exe\s+\d+/i.test(String(t.stdout));
  } else {
    const t = sys.run("pgrep", ["-x", "git"], { timeout: 10000 });
    if (!t.error) running = t.status === 0;
  }
  return { ok: true, gitDir: g.gitDir, lock: { path: lock, ageMs: st ? Math.max(0, sys.now() - st.mtimeMs) : null, gitRunning: running } };
}
