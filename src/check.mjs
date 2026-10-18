// `check`: collect what the machine says (everything read only), find every agent on it, predict the shell each gives the model and what runs its hooks,
// and find what is probably not what you meant. On Windows it checks the Windows setup; inside a WSL distribution the WSL side; on Linux and macOS there is
// nothing to check.
import { loadSettingsFiles, shellFacts } from "./claude-settings.mjs";
import { parseSwitch, predictShell, resolveVariable } from "./claude-shell.mjs";
import { executionPolicyFacts, indexLockFacts } from "./facts.mjs";
import { compareUserEnv } from "./userenv.mjs";
import { insideWsl, wslLocations } from "./wsl.mjs";
import { AGENT_IDS, findAgents } from "./inventory.mjs";
import { collectMachine } from "./machine.mjs";
import { shellFor } from "./shells.mjs";
import { nodeWants, ptyOf, readCursorLauncher } from "./agentfacts.mjs";
import { codexOnWindows, codexHome, readCodexLayers } from "./codexwin.mjs";
import { judgeHooks, readHooks } from "./hooks.mjs";
import { countFindings, windowsFindings, wslFindings } from "./findings.mjs";

export const RESPECT_VAR = "CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY";

/** Does the Git Bash that Claude Code would use start? A read only try: `bash.exe -c "exit 0"`. */
export function bashStarts(sys, bashPath, cwd) {
  const r = sys.run(bashPath, ["-c", "exit 0"], { cwd: cwd && sys.isDir(cwd) ? cwd : undefined, timeout: 30000 });
  if (r.error) return { checked: true, ok: false, error: r.timedOut ? "it did not answer in 30 seconds" : `it could not be started: ${r.error.code || r.error.message}` };
  if (r.status !== 0) return { checked: true, ok: false, error: `it exited with code ${r.status}${String(r.stderr || "").trim() ? `: ${String(r.stderr).trim().split(/\r?\n/)[0].slice(0, 120)}` : ""}` };
  return { checked: true, ok: true, error: null };
}

/** The Codex desktop app, as the Microsoft Store package OpenAI.Codex: { installLocation, version } or null. One read-only PowerShell call. */
export function codexDesktopApp(sys) {
  if (sys.platform !== "win32") return null;
  const env = Object.fromEntries(Object.entries(sys.env).filter(([k]) => k.toLowerCase() !== "psmodulepath"));
  const r = sys.run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='SilentlyContinue'; Get-AppxPackage -Name OpenAI.Codex | ForEach-Object { 'APPX|'+$_.InstallLocation+'|'+$_.Version.ToString() }"], { env, timeout: 60000 });
  if (r.error || r.status !== 0) return null;
  const m = /^APPX\|([^|]+)\|(.+)$/m.exec(String(r.stdout));
  return m ? { installLocation: m[1].trim(), version: m[2].trim() } : null;
}

/** The ids that --agent names: a list of ids, or "all". Returns the ids in the order of AGENT_IDS. */
export function selectAgents(value) {
  if (value === undefined || value === null || value === "all") return [...AGENT_IDS];
  const wanted = String(value).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return AGENT_IDS.filter((a) => wanted.includes(a));
}

/** The Windows setup. `dir` is a throwaway folder (for --live). */
export function collectWindows(sys, { project, userEnv, agents = AGENT_IDS }) {
  const sel = AGENT_IDS.filter((a) => agents.includes(a));
  const settings = loadSettingsFiles(sys, { project });
  const settingsFacts = shellFacts(settings);
  const cwd = settings.project;
  const machine = collectMachine(sys, { cwd });
  const ctx = { npmPrefix: machine.node.npmPrefix, codexApp: sel.includes("codex") ? codexDesktopApp(sys) : null };
  const inventory = findAgents(sys, { agents: sel, ctx });

  const shells = {};
  const claude = {};
  if (sel.includes("claude")) {
    const shell = predictShell(sys, { cwd, facts: settingsFacts });
    shells.claude = shell;
    const respect = parseSwitch(resolveVariable(RESPECT_VAR, { processValue: sys.getEnv(RESPECT_VAR), facts: settingsFacts }).value) === true;
    Object.assign(claude, {
      settings: { configDir: settings.configDir, configSource: settings.configSource, files: settings.files.map((f) => ({ scope: f.scope, label: f.label, display: f.display, path: f.path, exists: f.exists, usable: f.usable, error: f.error ? f.error.message : null, applied: f.scope === "managed" ? Boolean(f.applied) : undefined })), managedApplied: settings.managedApplied },
      settingsFacts,
      bashStarts: shell.gitBash.path ? bashStarts(sys, shell.gitBash.path, cwd) : { checked: false, ok: null, error: null },
      policy: executionPolicyFacts(sys, { shell: shell.powershell.path || undefined, respect }),
      indexLock: indexLockFacts(sys, cwd),
      respect,
    });
  }
  const cursor = {};
  if (sel.includes("cursor")) {
    const entries = inventory.agents.cursor.entries.filter((e) => e.origin === "cursor-cli" && /\.cmd$/i.test(e.path));
    const dirs = [...new Set(entries.map((e) => e.dir))];
    const launchers = dirs.map((d) => readCursorLauncher(sys, d)).filter(Boolean);
    Object.assign(cursor, { launchers, launcher: launchers[0] || null, msystem: sys.getEnv("MSYSTEM") || null, installed: inventory.agents.cursor.entries.length > 0 });
  }
  for (const a of ["codex", "gemini", "copilot"]) if (sel.includes(a)) shells[a] = shellFor(a, { machine });
  if (sel.includes("cursor")) shells.cursor = shellFor("cursor", { machine, cursor });

  const gemini = {};
  if (sel.includes("gemini")) {
    const pkgs = inventory.agents.gemini.entries.filter((e) => e.package && e.package.name === "@google/gemini-cli").map((e) => e.package.dir);
    gemini.pty = [...new Set(pkgs)].map((dir) => ptyOf(sys, dir));
  }

  let codex = null;
  if (sel.includes("codex")) {
    const layers = readCodexLayers(sys, { project: cwd });
    codex = { ...codexOnWindows(sys, { layers, machine, userEnv }), layerFiles: layers.layers.filter((l) => l.exists).map((l) => ({ kind: l.kind, path: l.path, ok: l.ok, error: l.error ? l.error.message : l.skipped ? "the project is not trusted: not read" : null })) };
  }

  // the hooks of every agent, with what runs each one
  const hooks = {};
  for (const a of sel) {
    const read = readHooks(sys, a, { project: cwd });
    hooks[a] = { files: read.files, entries: judgeHooks(a, read.entries, { shells, machine, msystem: Boolean(sys.getEnv("MSYSTEM")) }) };
  }
  if (sel.includes("cursor")) cursor.hooksPresent = Boolean((hooks.cursor && hooks.cursor.entries.length) || (hooks.claude && hooks.claude.entries.length));

  const facts = {
    platform: "win32",
    kind: "windows",
    project: cwd,
    agents: sel,
    system: { os: sys.osVersion, release: sys.release, arch: sys.arch },
    machine,
    inventory,
    shells,
    claude,
    codex,
    gemini,
    cursor,
    nodeWants: nodeWants(inventory, sys.nodeVersion),
    hooks,
    userEnv: sel.includes("claude") ? compareUserEnv(sys, userEnv) : null,
  };
  facts.findings = windowsFindings(facts);
  facts.counts = countFindings(facts.findings);
  return facts;
}

/** The WSL side, from inside a distribution. */
export function collectWsl(sys, { project, agents = AGENT_IDS }) {
  const inside = insideWsl(sys);
  const sel = AGENT_IDS.filter((a) => agents.includes(a));
  const settings = loadSettingsFiles(sys, { project });
  const settingsFacts = shellFacts(settings);
  const inventory = findAgents(sys, { agents: sel.includes("claude") ? ["claude"] : [] });
  const locations = wslLocations(sys, project || sys.cwd);
  // the Windows policy, read through /mnt/c, tells whether this side inherits it
  const win = "/mnt/c/Program Files/ClaudeCode/managed-settings.json";
  const text = sys.readText(win);
  const wslInherits = [...settingsFacts.wslInherits];
  if (text) { try { const j = JSON.parse(text); if (j && j.wslInheritsWindowsSettings !== undefined) wslInherits.push({ source: "C:\\Program Files\\ClaudeCode\\managed-settings.json", display: win, value: j.wslInheritsWindowsSettings }); } catch { /* not JSON */ } }
  const facts = {
    platform: "linux", kind: "wsl", project: locations.project, agents: sel,
    system: { os: sys.osVersion, release: sys.release, arch: sys.arch, wsl: inside.version },
    inside, settings: { configDir: settings.configDir, configSource: settings.configSource },
    inventory, locations, wslInherits,
    codexHome: sel.includes("codex") ? { ...(() => { const h = sys.getEnv("CODEX_HOME"); return { dir: h || `${sys.home}/.codex`, source: h ? "CODEX_HOME" : "default" }; })() } : null,
  };
  facts.findings = wslFindings(facts);
  facts.counts = countFindings(facts.findings);
  return facts;
}

/** What `check` reports on a system with nothing to check. */
export function notApplicable(sys) {
  return { platform: sys.platform, kind: "other", applicable: false, system: { os: sys.osVersion, release: sys.release, arch: sys.arch }, findings: [], counts: { error: 0, warning: 0, note: 0 } };
}

/** The kind of system this is: "windows", "wsl" or "other". */
export function kindOf(sys) {
  if (sys.platform === "win32") return "windows";
  if (insideWsl(sys).inside) return "wsl";
  return "other";
}

export { codexHome };
