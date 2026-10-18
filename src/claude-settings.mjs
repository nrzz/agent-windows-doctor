// Find and read the settings files that bear on the shell: the `env` blocks (CLAUDE_CODE_GIT_BASH_PATH and
// CLAUDE_CODE_USE_POWERSHELL_TOOL can be set there), `defaultShell`, the deny rules that take a shell tool away, and
// `wslInheritsWindowsSettings`. The paths and the order come from claude-settings-doctor's and claude-mcp-check's loaders
// (managed, local, project, user); this one keeps what the shell needs.
//
// Nothing here writes. Claude Code ignores a settings file that is not strict JSON (a comment or a trailing comma is enough),
// so such a file is kept in the list, marked ignored, and its keys are not used. Everything is read through `sys`, and on
// Windows with the path rules of Windows whatever system this runs on.
import path from "node:path";
import { isObject, readJsonFile, parseJson } from "./jsonfile.mjs";
import { readRegValue } from "./winenv.mjs";

export const SCOPES = ["managed", "local", "project", "user"];
// the keys that steer where managed settings come from; a managed document with only these is no policy
const CONTROL_KEYS = new Set(["wslInheritsWindowsSettings", "managedSourcesBehavior"]);

/** The folder Claude Code keeps its settings, plugins and transcripts in. */
export function configDirOf(sys) {
  const p = sys.platform === "win32" ? path.win32 : path.posix;
  const fromEnv = sys.getEnv("CLAUDE_CONFIG_DIR");
  if (fromEnv && String(fromEnv).trim()) {
    const v = String(fromEnv).trim();
    return { dir: p.isAbsolute(v) ? p.normalize(v) : p.join(sys.cwd, v), source: "CLAUDE_CONFIG_DIR" };
  }
  return { dir: p.join(sys.home, ".claude"), source: "default" };
}

/** The .claude.json that holds the account, the project trust and the cached flags: inside the config folder when CLAUDE_CONFIG_DIR is set, else next to ~/.claude. */
export function claudeJsonOf(sys) {
  const p = sys.platform === "win32" ? path.win32 : path.posix;
  const cfg = configDirOf(sys);
  return cfg.source === "CLAUDE_CONFIG_DIR" ? p.join(cfg.dir, ".claude.json") : p.join(sys.home, ".claude.json");
}

/** Where a machine-wide managed-settings.json lives on this system. */
export function managedDirOf(platform) {
  if (platform === "win32") return "C:\\Program Files\\ClaudeCode";
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode";
  return "/etc/claude-code";
}

/** Display form of a path: relative to the project inside it, ~\... under the home folder, else the whole path. */
export function shortPath(file, { home, project, platform = "win32" } = {}) {
  const p = platform === "win32" ? path.win32 : path.posix;
  const sep = platform === "win32" ? "\\" : "/";
  const lower = (s) => (platform === "win32" ? String(s).toLowerCase() : String(s));
  const within = (base) => {
    if (!base) return null;
    const f = lower(p.normalize(file));
    const b = lower(p.normalize(base)).replace(/[\\/]+$/, "");
    return f.startsWith(b + sep) ? p.normalize(file).slice(b.length + 1) : null;
  };
  const inProject = within(project);
  if (inProject) return inProject;
  const inHome = within(home);
  if (inHome) return `~${sep}${inHome}`;
  return p.normalize(file);
}

function makeFile(sys, scope, label, file, rank, ctx) {
  const r = readJsonFile(sys, file);
  const usable = r.exists && !r.error && !r.empty && isObject(r.data);
  const error = r.error || (r.exists && !r.empty && !isObject(r.data) ? { message: "does not hold a JSON object", line: 1, column: 1 } : null);
  return { scope, label, path: file, display: shortPath(file, ctx), rank, exists: r.exists, empty: r.empty, error, data: usable ? r.data : null, usable, via: "file" };
}

// A managed document from the Windows registry: the JSON text of the value `Settings` under HKLM or HKCU \SOFTWARE\Policies\ClaudeCode.
function registryDoc(sys, hive, rank) {
  const key = `${hive}\\SOFTWARE\\Policies\\ClaudeCode`;
  const r = readRegValue(sys, key, "Settings");
  const label = `managed settings (${hive} registry)`;
  const base = { scope: "managed", label, path: `${key}\\Settings`, display: `${hive}\\...\\ClaudeCode\\Settings`, rank, via: "registry", hive };
  if (!r.ok || !r.exists) return { ...base, exists: false, empty: false, error: null, data: null, usable: false };
  const parsed = parseJson(String(r.value));
  if (parsed.error || !isObject(parsed.data)) return { ...base, exists: true, empty: !String(r.value).trim(), error: parsed.error || { message: "does not hold a JSON object", line: 1, column: 1 }, data: null, usable: false };
  return { ...base, exists: true, empty: false, error: null, data: parsed.data, usable: true };
}

const hasPolicyKey = (f) => f.usable && Object.keys(f.data).some((k) => !CONTROL_KEYS.has(k));

/**
 * Reads every settings file that applies. Returns { configDir, configSource, managedDir, files, managedApplied } with files
 * highest precedence first; each file is { scope, label, path, display, rank, exists, empty, error, data, usable, via }.
 * Managed settings come from the first source that carries a policy key (the Windows HKLM registry, then the managed-settings.json
 * folder, then the HKCU registry), as Claude Code's documentation says; the others are listed with `applied: false`.
 *   project   the folder Claude Code starts in
 *   registry  false leaves the registry out (the tests that read the real machine use it to read nothing there)
 */
export function loadSettingsFiles(sys, { project, registry = true } = {}) {
  const p = sys.platform === "win32" ? path.win32 : path.posix;
  const proj = project ? (p.isAbsolute(project) ? p.normalize(project) : p.join(sys.cwd, project)) : sys.cwd;
  const cfg = configDirOf(sys);
  const ctx = { home: sys.home, project: proj, platform: sys.platform };
  const files = [];

  // managed: the registry (Windows), the folder, then the HKCU registry
  const mdir = sys.getEnv("AGENT_WINDOWS_DOCTOR_MANAGED_DIR") || managedDirOf(sys.platform);
  const managedSources = [];
  const useRegistry = registry && sys.platform === "win32";
  if (useRegistry) managedSources.push(registryDoc(sys, "HKLM", 45));
  const folderDocs = [makeFile(sys, "managed", "managed settings", p.join(mdir, "managed-settings.json"), 40, ctx)];
  const drop = p.join(mdir, "managed-settings.d");
  const names = (sys.listDir(drop) || []).filter((n) => n.endsWith(".json") && !n.startsWith(".")).sort();
  names.forEach((name, i) => folderDocs.push(makeFile(sys, "managed", `managed settings (${name})`, p.join(drop, name), 41 + i, ctx)));
  const folderApplies = folderDocs.some(hasPolicyKey);
  managedSources.push(...folderDocs);
  if (useRegistry) managedSources.push(registryDoc(sys, "HKCU", 35));
  const hklm = managedSources.find((f) => f.hive === "HKLM");
  let applied = null;
  if (hklm && hasPolicyKey(hklm)) applied = "HKLM registry";
  else if (folderApplies) applied = "managed-settings.json";
  else if (managedSources.find((f) => f.hive === "HKCU" && hasPolicyKey(f))) applied = "HKCU registry";
  for (const f of managedSources) {
    const sourceName = f.hive ? `${f.hive} registry` : "managed-settings.json";
    f.applied = applied === sourceName;
    files.push(f);
  }

  const local = [p.join(proj, ".claude", "settings.local.json")];
  local.forEach((f, i) => files.push(makeFile(sys, "local", "local settings", f, 30 - i, ctx)));
  files.push(makeFile(sys, "project", "project settings", p.join(proj, ".claude", "settings.json"), 20, ctx));
  files.push(makeFile(sys, "user", "user settings", p.join(cfg.dir, "settings.json"), 10, ctx));
  files.sort((a, b) => b.rank - a.rank);
  return { project: proj, configDir: cfg.dir, configSource: cfg.source, managedDir: mdir, managedApplied: applied, files };
}

const asString = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

/**
 * What the settings files say that bears on the shell. (Within one scope the drop-in files of managed-settings.d are merged from the lowest
 * file up, so that the one that comes last in the alphabet wins a key.)
 *   env          { managed, local, project, user }: each the `env` block of that scope, values as strings (a number or a boolean
 *                reaches Claude Code as String(value))
 *   envFiles     { scope: display } the file each block is from
 *   defaultShell [{ scope, display, value, valid }]
 *   deny         [{ scope, display, rule }] every permissions.deny rule, as written
 *   wslInherits  [{ source, display, value }] wslInheritsWindowsSettings in a managed source that is a Windows admin source
 *   ignored      [{ scope, display, message }] files Claude Code ignores whole
 */
export function shellFacts(settings) {
  const facts = { env: { managed: {}, local: {}, project: {}, user: {} }, envFiles: {}, defaultShell: [], deny: [], wslInherits: [], ignored: [] };
  for (const f of [...settings.files].reverse()) {
    if (!f.usable || (f.scope === "managed" && !f.applied) || !isObject(f.data.env)) continue;
    facts.env[f.scope] = { ...facts.env[f.scope], ...Object.fromEntries(Object.entries(f.data.env).map(([k, v]) => [k, asString(v)])) };
    facts.envFiles[f.scope] = f.display;
  }
  for (const f of settings.files) {
    if (f.exists && f.error) facts.ignored.push({ scope: f.scope, display: f.display, message: f.error.message, line: f.error.line });
    if (!f.usable) continue;
    if (f.scope === "managed" && !f.applied && !(f.data && Object.prototype.hasOwnProperty.call(f.data, "wslInheritsWindowsSettings"))) continue;
    const d = f.data;
    if (f.scope !== "managed" || f.applied) {
      if (d.defaultShell !== undefined) facts.defaultShell.push({ scope: f.scope, display: f.display, value: d.defaultShell, valid: d.defaultShell === "bash" || d.defaultShell === "powershell" });
      if (isObject(d.permissions) && Array.isArray(d.permissions.deny)) for (const rule of d.permissions.deny) if (typeof rule === "string") facts.deny.push({ scope: f.scope, display: f.display, rule });
    }
    if (f.scope === "managed" && Object.prototype.hasOwnProperty.call(d, "wslInheritsWindowsSettings") && f.hive !== "HKCU") {
      facts.wslInherits.push({ source: f.hive ? `${f.hive} registry` : "managed-settings.json", display: f.display, value: d.wslInheritsWindowsSettings });
    }
  }
  return facts;
}

/** Is this deny rule one that takes a whole shell tool away? Only the exact spellings `Bash`, `Bash(*)`, `PowerShell` and `PowerShell(*)` do (put to the binary). */
export function wholeToolDeny(rule) {
  const m = /^(Bash|PowerShell)(?:\(\*\))?$/.exec(String(rule));
  return m ? m[1] : null;
}
