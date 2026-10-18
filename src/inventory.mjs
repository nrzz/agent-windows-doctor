// Every Claude Code, Codex CLI, Gemini CLI, GitHub Copilot CLI and Cursor on the machine: the programs and launchers on PATH, in the order a
// shell looks, and the places the installers use (the native installers' folders, npm's global folder, WinGet, the desktop apps' bundles, the
// editors' extensions), each with its version, where it came from, what it leads to, and which one runs first.
//
// The Claude Code part is claude-windows-doctor's src/binaries.mjs. What is new: the same search for the four other agents, the chain of an npm
// shim (codex.cmd -> codex.js -> the program in @openai/codex-win32-x64), and the version read from disk instead of by running the program
// (src/versions.mjs); `check --live` asks the programs itself, in a throwaway home (src/live.mjs).
//
// Two kinds of file are never run: a desktop app's own launcher (it opens the app) and a Microsoft Store alias.
import path from "node:path";
import * as W from "./winpath.mjs";
import { compareVersions, nearestPackage, npmShimTarget, readFileVersions, readPackage, trimFileVersion, versionFromFolder, versionIn } from "./versions.mjs";

export { compareVersions };

export const AGENT_IDS = ["claude", "codex", "gemini", "copilot", "cursor"];
export const AGENT_LABEL = { claude: "Claude Code", codex: "Codex CLI", gemini: "Gemini CLI", copilot: "GitHub Copilot CLI", cursor: "Cursor" };
// the commands each agent answers to
export const COMMANDS = { claude: ["claude"], codex: ["codex"], gemini: ["gemini"], copilot: ["copilot"], cursor: ["agent", "cursor-agent"] };
// the npm packages (the one that npm's shim starts; the program of the platform package is found next to it or inside it)
export const NPM_PACKAGE = { claude: "@anthropic-ai/claude-code", codex: "@openai/codex", gemini: "@google/gemini-cli", copilot: "@github/copilot" };

export const ORIGIN_TEXT = {
  native: "the native installer",
  standalone: "the standalone installer",
  npm: "npm (global)",
  "npm-program": "the program that an npm shim starts",
  winget: "WinGet",
  "desktop-bundle": "bundled by the Claude desktop app",
  "desktop-launcher": "the Claude desktop app's launcher (not the CLI)",
  "desktop-app": "bundled by the Codex desktop app (Microsoft Store package OpenAI.Codex)",
  "store-alias": "a Microsoft Store app alias (not run)",
  vscode: "an editor extension's bundled binary",
  cache: "the package a program unpacked for itself",
  "cursor-cli": "the Cursor CLI installer",
  editor: "the Cursor editor",
  package: "a system package",
  windows: "a Windows program reached through WSL",
  other: "an unknown source",
};
// the origins that are a command-line install of their own (the others belong to an app, or to another install)
export const CLI_ORIGINS = new Set(["native", "standalone", "npm", "winget", "cursor-cli", "package", "other"]);

const PROGRAM_EXT = [".com", ".exe", ".bat", ".cmd"];

/** Where a claude file came from, from its path. (claude-windows-doctor's originOf.) */
export function claudeOriginOf(file, platform = "win32") {
  const f = String(file);
  if (platform !== "win32") {
    if (/^\/mnt\/[a-z]\//i.test(f)) return "windows";
    if (/\/\.local\/bin\/claude$/.test(f)) return "native";
    if (/node_modules\/(\.bin|@anthropic-ai\/claude-code)/.test(f) || /\/lib\/node_modules\//.test(f)) return "npm";
    if (/^\/usr\/(local\/)?bin\/claude$/.test(f)) return "package";
    return "other";
  }
  const k = W.key(f);
  if (k.includes("\\anthropicclaude\\")) return "desktop-launcher";
  if (k.includes("\\microsoft\\windowsapps\\")) return "store-alias";
  if (/\\claude\\claude-code\\[^\\]+\\[^\\]+\\claude\.exe$/.test(k)) return "desktop-bundle";
  if (/\\\.local\\bin\\claude\.exe$/.test(k)) return "native";
  if (k.includes("\\winget\\")) return "winget";
  if (/\\extensions\\anthropic\.claude-code[^\\]*\\/.test(k)) return "vscode";
  if (/\\node_modules\\@anthropic-ai\\claude-code\\/.test(k) || /\\claude\.(cmd|ps1)$/.test(k)) return "npm";
  return "other";
}

/** Where a file of any of the agents came from, from its path. */
export function originOf(agent, file, platform = "win32") {
  if (agent === "claude") return claudeOriginOf(file, platform);
  if (platform !== "win32") return "other";
  const k = W.key(file);
  if (k.includes("\\microsoft\\windowsapps\\")) return "store-alias";
  if (k.includes("\\winget\\")) return "winget";
  if (agent === "codex") {
    if (/\\programs\\openai\\codex\\/.test(k)) return "standalone";
    if (/\\windowsapps\\openai\.codex_/.test(k)) return "desktop-app";
    if (/\\node_modules\\@openai\\codex-win32-[a-z0-9]+\\/.test(k)) return "npm-program";
    if (/\\node_modules\\@openai\\codex\\/.test(k) || /\\codex\.(cmd|ps1)$/.test(k)) return "npm";
  }
  if (agent === "gemini" && (/\\node_modules\\@google\\gemini-cli\\/.test(k) || /\\gemini\.(cmd|ps1)$/.test(k))) return "npm";
  if (agent === "copilot") {
    if (/\\copilot\\pkg\\[^\\]+\\[^\\]+/.test(k)) return "cache";
    if (/\\node_modules\\@github\\copilot-win32-[a-z0-9]+\\/.test(k)) return "npm-program";
    if (/\\node_modules\\@github\\copilot\\/.test(k) || /\\copilot\.(cmd|ps1)$/.test(k)) return "npm";
  }
  if (agent === "cursor") {
    if (/\\cursor-agent\\/.test(k)) return "cursor-cli";
    if (/\\cursor\\cursor\.exe$/.test(k)) return "editor";
  }
  return "other";
}

/** The program files named `name` in the PATH folders of a Windows machine, in the order cmd.exe and PowerShell look. */
function scanWindowsPath(sys, name) {
  const dirs = W.splitList(sys.getEnv("PATH"));
  const exts = W.pathExt(sys.getEnv("PATHEXT")).filter((e) => PROGRAM_EXT.includes(e));
  const out = [];
  dirs.forEach((dir, pathIndex) => {
    let any = false;
    for (const e of exts) {
      const f = W.join(dir, `${name}${e}`);
      if (sys.isFile(f)) { out.push({ path: f, dir, pathIndex, kind: "program", command: name }); any = true; }
    }
    if (!any) {
      // npm also writes <name>.ps1 and a file with no extension: they only matter when there is no .cmd beside them
      for (const n of [`${name}.ps1`, name]) {
        const f = W.join(dir, n);
        if (sys.isFile(f)) { out.push({ path: f, dir, pathIndex, kind: "script", command: name }); break; }
      }
    }
  });
  return out;
}

function scanPosixPath(sys, name) {
  const dirs = String(sys.getEnv("PATH") || "").split(":").filter(Boolean);
  const out = [];
  dirs.forEach((dir, pathIndex) => {
    const f = path.posix.join(dir, name);
    if (sys.isFile(f)) out.push({ path: f, dir, pathIndex, kind: "program", command: name });
  });
  return out;
}

/** The places to look in besides PATH, on Windows, for one agent: [{ path, kind? }]. Folders that cannot be listed give nothing. */
function knownPlaces(sys, agent, ctx) {
  const out = [];
  const home = sys.home;
  const appdata = sys.getEnv("APPDATA") || (home ? W.join(home, "AppData", "Roaming") : "");
  const local = sys.getEnv("LOCALAPPDATA") || (home ? W.join(home, "AppData", "Local") : "");
  const pf = [sys.getEnv("ProgramW6432"), sys.getEnv("ProgramFiles")].filter(Boolean);
  const npmDirs = [];
  for (const d of [appdata && W.join(appdata, "npm"), ctx.npmPrefix]) if (d && !npmDirs.some((x) => W.same(x, d))) npmDirs.push(d);
  const cmds = COMMANDS[agent];
  for (const dir of npmDirs) for (const c of cmds) out.push({ path: W.join(dir, `${c}.cmd`) });
  if (local) {
    for (const c of cmds) out.push({ path: W.join(local, "Microsoft", "WinGet", "Links", `${c}.exe`) });
    out.push(...[...cmds].map((c) => ({ path: W.join(local, "Microsoft", "WindowsApps", `${c}.exe`) })));
  }
  if (agent === "claude") {
    if (home) out.push({ path: W.join(home, ".local", "bin", "claude.exe") });
    if (local) {
      out.push({ path: W.join(local, "AnthropicClaude", "claude.exe") });
      const pk = W.join(local, "Microsoft", "WinGet", "Packages");
      for (const n of sys.listDir(pk) || []) if (/^Anthropic\.ClaudeCode/i.test(n)) out.push({ path: W.join(pk, n, "claude.exe") });
    }
    if (appdata) {
      const base = W.join(appdata, "Claude", "claude-code");
      for (const v of sys.listDir(base) || []) for (const h of sys.listDir(W.join(base, v)) || []) out.push({ path: W.join(base, v, h, "claude.exe") });
    }
    if (home) {
      for (const ed of [".vscode", ".vscode-insiders", ".cursor", ".windsurf"]) {
        const ext = W.join(home, ed, "extensions");
        for (const n of sys.listDir(ext) || []) if (/^anthropic\.claude-code/i.test(n)) out.push({ path: W.join(ext, n, "resources", "native-binary", "claude.exe") });
      }
    }
  }
  if (agent === "codex") {
    if (local) out.push({ path: W.join(local, "Programs", "OpenAI", "Codex", "bin", "codex.exe") });
    if (ctx.codexApp && ctx.codexApp.installLocation) out.push({ path: W.join(ctx.codexApp.installLocation, "app", "resources", "codex.exe") });
  }
  if (agent === "copilot" && local) {
    const pk = W.join(local, "Microsoft", "WinGet", "Packages");
    for (const n of sys.listDir(pk) || []) if (/^GitHub\.Copilot/i.test(n)) out.push({ path: W.join(pk, n, "copilot.exe") });
    const cache = W.join(local, "copilot", "pkg");
    for (const plat of sys.listDir(cache) || []) for (const v of sys.listDir(W.join(cache, plat)) || []) out.push({ path: W.join(cache, plat, v), kind: "cache", version: versionFromFolder(v) });
  }
  if (agent === "cursor") {
    if (local) for (const c of cmds) out.push({ path: W.join(local, "cursor-agent", `${c}.cmd`) });
    if (local) out.push({ path: W.join(local, "Programs", "cursor", "Cursor.exe"), kind: "editor" });
    for (const p of pf) out.push({ path: W.join(p, "cursor", "Cursor.exe"), kind: "editor" });
  }
  return out;
}

/** The program that an npm shim ends up at, for the agent's package: the .js the shim runs and the platform program next to it or inside it. */
function chainOf(sys, agent, shim) {
  const t = npmShimTarget(sys, shim);
  if (!t) return null;
  const leads = [t.target];
  const pkg = nearestPackage(sys, W.dirname(t.target));
  let program = t.js ? null : t.target;
  if (t.js && pkg) {
    const prefix = agent === "codex" ? "@openai/codex-win32-" : agent === "copilot" ? "@github/copilot-win32-" : null;
    if (prefix) {
      for (const arch of ["x64", "arm64"]) {
        const name = `${prefix}${arch}`;
        const [scope, short] = name.split("/");
        const roots = [W.join(pkg.dir, "node_modules", scope, short), W.join(W.dirname(pkg.dir), short)];
        for (const root of roots) {
          if (!sys.isDir(root)) continue;
          const exe = agent === "copilot" ? W.join(root, "copilot.exe") : findCodexExe(sys, root);
          if (exe && sys.isFile(exe)) { program = exe; break; }
        }
        if (program) break;
      }
    }
  }
  if (program && !W.same(program, t.target)) leads.push(program);
  return { leads, js: t.js ? t.target : null, program, pkg };
}

function findCodexExe(sys, root) {
  const vendor = W.join(root, "vendor");
  for (const triple of sys.listDir(vendor) || []) {
    const exe = W.join(vendor, triple, "bin", "codex.exe");
    if (sys.isFile(exe)) return exe;
  }
  return null;
}

/** The newest folder of Cursor's versions folder by the launcher's own rule (the date at the front of the name), or null. */
export function newestCursorVersion(names) {
  const ok = (names || []).filter((n) => /^\d{4}\.\d{1,2}\.\d{1,2}-/.test(n));
  return ok.sort((a, b) => compareVersions(b.replace(/-.*/, ""), a.replace(/-.*/, "")) || (a < b ? 1 : -1))[0] || null;
}

const stripPlatform = (v) => (v ? String(v).replace(/-(win32|linux|darwin)-(x64|arm64)$/, "") : v);

/**
 * Every program of every agent asked for.
 *   agents   the ids to look for (default: all five)
 *   ctx      { npmPrefix, codexApp: { installLocation, version } }
 * Returns { agents: { <id>: { id, label, entries, first } } } with entries in the order of PATH, then the places the installers use:
 *   { agent, path, dir, kind, origin, onPath, pathIndex, command, runsFirst, leadsTo[], package { name, version, engines }, version, versionFrom, note, skipped }
 * `first` is the entry that a shell runs for the agent's command (the first program on PATH), or null.
 */
export function findAgents(sys, { agents = AGENT_IDS, ctx = {} } = {}) {
  const win = sys.platform === "win32";
  const result = {};
  const needVersions = [];
  for (const agent of agents) {
    const entries = [];
    const seen = new Set();
    const key = (p) => (win ? W.key(p) : p);
    const add = (e) => { if (seen.has(key(e.path))) return; seen.add(key(e.path)); entries.push(e); };
    const onPath = COMMANDS[agent].flatMap((c) => (win ? scanWindowsPath(sys, c) : scanPosixPath(sys, c)));
    // the order of PATH, then the order of the commands
    onPath.sort((a, b) => a.pathIndex - b.pathIndex);
    for (const e of onPath) add({ ...e, agent, onPath: true, origin: originOf(agent, e.path, sys.platform) });
    if (win) {
      for (const p of knownPlaces(sys, agent, ctx)) {
        const exists = p.kind === "cache" ? sys.isDir(p.path) : sys.isFile(p.path);
        if (!exists) continue;
        const dir = p.kind === "cache" ? p.path : W.dirname(p.path);
        add({ path: p.path, dir, pathIndex: null, kind: p.kind || "program", onPath: false, agent, command: null, origin: originOf(agent, p.path, sys.platform), preVersion: p.version || null });
      }
    } else if (agent === "claude") {
      const local = sys.home ? path.posix.join(sys.home, ".local", "bin", "claude") : null;
      if (local && sys.isFile(local) && !seen.has(local)) add({ path: local, dir: path.posix.dirname(local), pathIndex: null, kind: "program", onPath: false, agent, command: "claude", origin: originOf("claude", local, sys.platform) });
    }
    // the Cursor CLI answers to two names (agent and cursor-agent) from one folder: one entry
    if (agent === "cursor") {
      for (let i = entries.length - 1; i > 0; i--) {
        const twin = entries.slice(0, i).find((x) => x.origin === "cursor-cli" && x.kind === "program" && W.same(x.dir, entries[i].dir));
        if (twin && entries[i].origin === "cursor-cli" && entries[i].kind === "program") { twin.also = [...(twin.also || []), W.basename(entries[i].path)]; entries.splice(i, 1); }
      }
    }
    // an npm shim of the same package found twice (on PATH and in the global folder) is one entry; a program that a shim starts is not listed on its own
    const shimTargets = new Set();
    for (const e of entries) {
      e.leadsTo = [];
      e.package = null;
      e.runsFirst = false;
      if (win && /\.(cmd|bat)$/i.test(e.path) && e.kind === "program") {
        const c = chainOf(sys, agent, e.path);
        if (c) {
          e.leadsTo = c.leads;
          if (c.pkg) e.package = { name: c.pkg.name, version: c.pkg.version, engines: c.pkg.engines, dir: c.pkg.dir };
          if (c.program) e.program = c.program;
          if (c.program) shimTargets.add(W.key(c.program));
          if (e.origin === "other" && c.pkg && c.pkg.name === NPM_PACKAGE[agent]) e.origin = "npm";
        }
      }
    }
    const first = entries.find((e) => e.onPath && e.kind === "program") || null;
    for (const e of entries) {
      e.runsFirst = e === first;
      const noRun = e.origin === "desktop-launcher" || e.origin === "store-alias" || e.kind === "script" || e.kind === "cache";
      e.skipped = noRun ? (e.kind === "script" ? `a script, not run (the same install as the .cmd of npm)` : e.kind === "cache" ? `${ORIGIN_TEXT.cache}: not a command` : ORIGIN_TEXT[e.origin]) : null;
      e.version = null;
      e.versionFrom = null;
      e.note = null;
      // the version, from disk
      if (e.preVersion) { e.version = e.preVersion; e.versionFrom = "folder name"; }
      if (!e.version && e.origin === "desktop-bundle") {
        const v = versionFromFolder(W.basename(W.dirname(W.dirname(e.path))));
        if (v) { e.version = v; e.versionFrom = "folder name"; }
      }
      if (!e.version && e.package && e.package.version) { e.version = stripPlatform(e.package.version); e.versionFrom = `package.json of ${e.package.name}`; }
      if (e.kind === "cache") {
        const pj = readPackage(sys, e.path);
        if (pj && pj.version) { e.version = pj.version; e.versionFrom = "package.json in the cache"; }
      }
      if (e.origin === "cursor-cli" && /\.(cmd|ps1)$/i.test(e.path)) {
        const versions = sys.listDir(W.join(e.dir, "versions"));
        const newest = newestCursorVersion(versions || []);
        const any = (versions || []).filter((n) => versionFromFolder(n))[0];
        const pick = newest || any || null;
        e.versions = versions || [];
        if (pick) { e.version = versionFromFolder(pick); e.versionFrom = "versions folder"; }
      }
      if (e.origin === "desktop-app" && ctx.codexApp && ctx.codexApp.version) { e.version = ctx.codexApp.version; e.versionFrom = "app package: the version of the app, not of the CLI inside it"; e.appVersion = true; }
      if (!e.version && win && e.kind !== "script" && e.kind !== "cache" && /\.exe$/i.test(e.path) && !e.skipped) needVersions.push(e);
      if (e.kind === "editor" && !e.version) needVersions.push(e);
    }
    result[agent] = { id: agent, label: AGENT_LABEL[agent], entries, first };
  }
  // the version resource of the programs that have no better source: one call for all of them
  const list = [...new Set(needVersions)];
  if (list.length) {
    const read = readFileVersions(sys, list.map((e) => e.path));
    list.forEach((e, i) => {
      const v = trimFileVersion(read[i].fileVersion) || trimFileVersion(read[i].productVersion);
      if (v) { e.version = v; e.versionFrom = "file version"; }
    });
  }
  return { agents: result };
}

export { versionIn };
