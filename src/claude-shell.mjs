// Which shell tools will Claude Code give the model on Windows, and why. Every rule here is one that the real binary was put to
// (claude-windows-doctor put the whole table to Claude Code 2.1.295 and 2.1.299 on Windows 11, and to the newest release on windows-latest in CI):
// test/shell-table.mjs holds the cases, test/claude-shell.test.mjs holds `predictShell` to all of them on a pretend machine, and
// test/e2e-claude.test.mjs puts one row for each claim an explain page restates to the binary through a fake Messages API and reads the tools of
// the first request.
//
// What was seen:
//   * Git Bash is looked for in this order, and the first hit wins:
//       1. CLAUDE_CODE_GIT_BASH_PATH, when its file is named bash.exe, sh.exe, bash or sh (any case) and exists. Otherwise the value
//          is ignored (the debug log says why) and the search goes on as if it were not set. The variable is read from the process
//          environment and from the `env` of the user settings, which wins over the process environment. The `env` of project and
//          local settings is not used for it.
//       2. C:\Program Files\Git\bin\bash.exe, then C:\Program Files (x86)\Git\bin\bash.exe, written out: %ProgramFiles% is not read.
//       3. The first line `where.exe git` prints that exists, is not in the working folder, and ends in .com, .exe, .bat or .cmd:
//          two folders up from that file, bin\bash.exe. It works for ...\Git\cmd\git.exe and fails for ...\Git\mingw64\bin\git.exe,
//          and the line is the first one, so the order of PATH decides (Git Bash itself puts mingw64\bin first).
//   * The PowerShell tool: CLAUDE_CODE_USE_POWERSHELL_TOOL (1, true, yes, on; 0, false, no, off; anything else reads as not set;
//     process environment, then user, project and local settings `env`, the nearest winning) decides when it is set. When it is
//     not set, the tool is on if Git Bash was not found, and otherwise decided by the account (the documentation: on for claude.ai
//     and Console accounts), which a fake API cannot answer: there the tool was off.
//   * With the tool off and no Git Bash Claude Code exits at start (code 1): "requires a shell tool".
//   * A deny rule `Bash` or `Bash(*)` (`PowerShell`, `PowerShell(*)`) takes that tool out of the list, in any settings file.
//   * defaultShell does not change the list: it is the shell for `!` commands typed in the input box.
import * as W from "./winpath.mjs";
import { wholeToolDeny } from "./claude-settings.mjs";

export const GIT_BASH_VAR = "CLAUDE_CODE_GIT_BASH_PATH";
export const PS_VAR = "CLAUDE_CODE_USE_POWERSHELL_TOOL";
export const BASH_NAMES = ["bash.exe", "sh.exe", "bash", "sh"];
export const FIXED_BASH = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"];
// the settings files whose `env` block counts for each variable, highest precedence first (project and local settings do not set the Git Bash path)
export const VAR_SCOPES = {
  [GIT_BASH_VAR]: ["managed", "user"],
  [PS_VAR]: ["managed", "local", "project", "user"],
};

const EXEC_EXT = new Set([".com", ".exe", ".bat", ".cmd"]);
// folders of a virtual environment or a dependency tree: an executable found in one below the working folder is not trusted
const VENV_DIRS = new Set(["node_modules", ".venv", "venv", "env", ".env", "virtualenv", ".tox", ".nox", ".direnv", "__pypackages__"]);
const TRUE_WORDS = new Set(["1", "true", "yes", "on"]);
const FALSE_WORDS = new Set(["0", "false", "no", "off"]);

/** How Claude Code reads a variable that is a switch: true, false, or undefined for anything else (an empty value, "2", "enabled", "y"). */
export function parseSwitch(value) {
  if (value === undefined || value === null) return undefined;
  const v = String(value).trim().toLowerCase();
  if (TRUE_WORDS.has(v)) return true;
  if (FALSE_WORDS.has(v)) return false;
  return undefined;
}

/**
 * The value that counts for one of the two variables, and where it came from.
 *   processValue  the variable in the process environment (or undefined)
 *   facts         shellFacts(...) of the settings files
 * Returns { value, source, scope, display, ignored: [{ scope, display, value }], shadowed: [{ source, value }] } with value the text as written ("" when
 * nothing sets it). `ignored` are the entries of files whose `env` Claude Code does not use for this variable.
 */
export function resolveVariable(name, { processValue, facts }) {
  const counts = VAR_SCOPES[name] || ["managed", "local", "project", "user"];
  const order = ["managed", "local", "project", "user"];
  const candidates = [];
  const ignored = [];
  for (const scope of order) {
    const block = facts.env[scope] || {};
    if (!Object.prototype.hasOwnProperty.call(block, name)) continue;
    const entry = { source: `${scope} settings`, scope, display: facts.envFiles[scope] || scope, value: block[name] };
    if (counts.includes(scope)) candidates.push(entry); else ignored.push({ scope, display: entry.display, value: entry.value });
  }
  if (processValue !== undefined) candidates.push({ source: "the process environment", scope: "process", display: "the environment of this process", value: String(processValue) });
  const first = candidates[0];
  if (!first) return { value: "", source: null, scope: null, display: null, ignored, shadowed: [] };
  return { value: first.value, source: first.source, scope: first.scope, display: first.display, ignored, shadowed: candidates.slice(1).map((c) => ({ source: c.source, value: c.value })) };
}

/** What Claude Code makes of a CLAUDE_CODE_GIT_BASH_PATH value: { state: "unset" | "valid" | "not-found" | "not-bash", value, hint }. */
export function checkBashValue(raw, sys) {
  const value = String(raw === undefined || raw === null ? "" : raw).trim();
  if (!value) return { state: "unset", value: "", hint: null };
  const okName = BASH_NAMES.includes(W.basename(value).toLowerCase());
  if (okName && sys.exists(value)) return { state: "valid", value, hint: null };
  let hint = null;
  if (/^["'].*["']$/.test(value) || /["']$/.test(value)) hint = "the value has quote marks in it; write the path without quotes";
  else if (/%[^%]+%/.test(value)) hint = "the value has a %NAME% in it, which is not expanded (a REG_SZ value is taken as written); write the whole path";
  else if (!W.isAbsolute(value)) hint = "the value is not an absolute path; it is looked up from the folder Claude Code starts in";
  else if (!okName) hint = "the file must be named bash.exe, sh.exe, bash or sh";
  return { state: okName ? "not-found" : "not-bash", value, hint };
}

// is this file of the first-found `where` output inside the working folder, as Claude Code counts it? (lexical rules only: the file is in the folder, or in a dependency or virtualenv folder below it, or in the Windows Apps alias folders when the working folder holds them)
function insideWorkingFolder(file, cwd, env, home) {
  if (!cwd) return false;
  const dir = W.key(W.dirname(file));
  const work = W.key(cwd);
  if (dir === work) return true;
  if (dir.startsWith(`${work}\\`) && dir.split("\\").some((seg) => VENV_DIRS.has(seg))) return true;
  const aliases = [];
  if (home) aliases.push(W.key(W.join(home, "AppData", "Local", "Microsoft", "WindowsApps")));
  if (env.LOCALAPPDATA) aliases.push(W.key(W.join(env.LOCALAPPDATA, "Microsoft", "WindowsApps")));
  for (const a of aliases) if ((a === work || a.startsWith(`${work}\\`)) && (dir === a || dir.startsWith(`${a}\\`))) return true;
  return false;
}

// The first line of `where.exe <name>` that Claude Code would use: it exists, it is not in the working folder, and its name ends in an executable extension.
function firstUsable(lines, sys, cwd) {
  const skipped = [];
  for (const line of lines || []) {
    if (!sys.exists(line)) { skipped.push({ line, reason: "it is not there" }); continue; }
    if (insideWorkingFolder(line, cwd, sys.env, sys.home)) { skipped.push({ line, reason: "it is in the working folder" }); continue; }
    const name = W.basename(line).toLowerCase().replace(/[. ]+$/, "");
    const dot = name.lastIndexOf(".");
    if (!(dot > 0 && EXEC_EXT.has(name.slice(dot)))) { skipped.push({ line, reason: "its name does not end in .com, .exe, .bat or .cmd" }); continue; }
    return { line, skipped };
  }
  return { line: null, skipped };
}

/**
 * The search for Git Bash. Returns { path, how, trail }: `how` is "variable", "program-files", "program-files-x86", "where-git" or null, and
 * `trail` has one entry for each step that was tried, each with what it found.
 *   variable  the resolved CLAUDE_CODE_GIT_BASH_PATH (resolveVariable)
 *   cwd       the folder Claude Code starts in
 */
export function findGitBash(sys, { variable, cwd }) {
  const trail = [];
  const check = checkBashValue(variable.value, sys);
  trail.push({ step: "variable", state: check.state, value: check.value, source: variable.source, hint: check.hint });
  if (check.state === "valid") return { path: check.value, how: "variable", trail, variable: check };
  FIXED_BASH.forEach((p, i) => {
    const there = sys.exists(p);
    trail.push({ step: i === 0 ? "program-files" : "program-files-x86", path: p, exists: there });
  });
  const fixed = trail.find((t) => (t.step === "program-files" || t.step === "program-files-x86") && t.exists);
  if (fixed) return { path: fixed.path, how: fixed.step, trail, variable: check };
  const lines = sys.where("git", { cwd, env: sys.env });
  if (lines === null) { trail.push({ step: "where-git", lines: null, note: "where.exe could not run" }); return { path: null, how: null, trail, variable: check }; }
  const { line, skipped } = firstUsable(lines, sys, cwd);
  if (!line) { trail.push({ step: "where-git", lines, skipped, chosen: null }); return { path: null, how: null, trail, variable: check }; }
  const derived = W.join(line, "..", "..", "bin", "bash.exe");
  const there = sys.exists(derived);
  trail.push({ step: "where-git", lines, skipped, chosen: line, derived, exists: there });
  return { path: there ? derived : null, how: there ? "where-git" : null, trail, variable: check };
}

/** The PowerShell Claude Code runs commands in: { path, how, edition, trail }. (Put to the binary: pwsh on PATH, ProgramW6432's PowerShell\7, .dotnet\tools, then powershell on PATH, then System32's.) */
export function findPowerShell(sys, { cwd }) {
  const trail = [];
  const pick = (name) => {
    const lines = sys.where(name, { cwd, env: sys.env });
    if (lines === null) { trail.push({ step: `where-${name}`, lines: null }); return null; }
    const { line } = firstUsable(lines, sys, cwd);
    trail.push({ step: `where-${name}`, lines, chosen: line });
    return line;
  };
  let found = pick("pwsh");
  let how = found ? "pwsh-on-path" : null;
  if (!found) {
    const pf = sys.getEnv("ProgramW6432") || sys.getEnv("ProgramFiles");
    const places = [];
    if (pf) places.push(["program-files", W.join(pf, "PowerShell", "7", "pwsh.exe")]);
    const local = sys.getEnv("LOCALAPPDATA");
    if (local) places.push(["store-alias", W.join(local, "Microsoft", "WindowsApps", "pwsh.exe")]);
    if (sys.home) places.push(["dotnet-tool", W.join(sys.home, ".dotnet", "tools", "pwsh.exe")]);
    for (const [step, p] of places) {
      const there = sys.isFile(p);
      trail.push({ step, path: p, exists: there });
      if (there) { found = p; how = step; break; }
    }
  }
  if (!found) { found = pick("powershell"); if (found) how = "powershell-on-path"; }
  if (!found) {
    const root = sys.getEnv("SystemRoot") || sys.getEnv("windir") || "C:\\Windows";
    const p = W.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const there = sys.isFile(p);
    trail.push({ step: "system32", path: p, exists: there });
    if (there) { found = p; how = "system32"; }
  }
  const core = found ? W.basename(found).toLowerCase().replace(/\.exe$/, "") === "pwsh" : false;
  return { path: found, how, edition: found ? (core ? "PowerShell 7+ (pwsh)" : "Windows PowerShell 5.1 (powershell.exe)") : null, core, trail };
}

/**
 * The tools Claude Code gives the model, from the settings and the machine.
 *   sys    the machine (src/sys.mjs)
 *   cwd    the folder Claude Code starts in
 *   facts  shellFacts(...) of the settings files
 * Returns { gitBash, powershell, deny, fatal, tools, defaultShell, why }.
 */
export function predictShell(sys, { cwd, facts }) {
  const bashVar = resolveVariable(GIT_BASH_VAR, { processValue: sys.getEnv(GIT_BASH_VAR), facts });
  const psVar = resolveVariable(PS_VAR, { processValue: sys.getEnv(PS_VAR), facts });
  const gitBash = { ...findGitBash(sys, { variable: bashVar, cwd }), variableSource: bashVar };
  const parsed = parseSwitch(psVar.value);
  const setting = parsed === undefined ? "unset" : parsed ? "on" : "off";
  const bashFound = gitBash.path !== null;

  let psState;
  let psWhy;
  if (setting === "on") { psState = "yes"; psWhy = `${PS_VAR} is on (${psVar.source})`; }
  else if (setting === "off") { psState = "no"; psWhy = `${PS_VAR} is off (${psVar.source})`; }
  else if (!bashFound) { psState = "yes"; psWhy = "Git Bash was not found, so Claude Code turns the PowerShell tool on"; }
  else { psState = "account"; psWhy = "decided by your account: Claude Code's documentation says on for claude.ai and Console accounts, off in Bedrock, Vertex and Foundry sessions"; }
  const ps = findPowerShell(sys, { cwd });
  const powershell = { variable: psVar, setting, unread: psVar.value.trim() !== "" && parsed === undefined, state: psState, why: psWhy, ...ps };

  const deny = { Bash: [], PowerShell: [] };
  for (const d of facts.deny) {
    const tool = wholeToolDeny(d.rule);
    if (tool) deny[tool].push({ rule: d.rule, scope: d.scope, display: d.display });
  }
  const fatal = !bashFound && psState === "no" ? { id: "no-shell-tool", message: `Git Bash was not found and the PowerShell tool is off (${PS_VAR}=${psVar.value.trim()}): Claude Code stops at start with "requires a shell tool"` } : null;
  const tools = {
    Bash: bashFound && deny.Bash.length === 0,
    PowerShell: psState === "no" || deny.PowerShell.length > 0 ? "no" : psState,
  };
  if (fatal) { tools.Bash = false; tools.PowerShell = "no"; }

  const why = [];
  if (fatal) why.push(fatal.message);
  why.push(bashFound ? `Bash tool: Git Bash at ${gitBash.path} (${HOW[gitBash.how]})` : "Bash tool: Git Bash was not found");
  if (bashFound && deny.Bash.length) why.push(`the Bash tool is taken away by the deny rule ${deny.Bash.map((d) => `"${d.rule}"`).join(", ")} (${deny.Bash[0].display})`);
  why.push(`PowerShell tool: ${psWhy}`);
  if (deny.PowerShell.length) why.push(`the PowerShell tool is taken away by the deny rule ${deny.PowerShell.map((d) => `"${d.rule}"`).join(", ")} (${deny.PowerShell[0].display})`);
  return { gitBash, powershell, deny, fatal, tools, defaultShell: facts.defaultShell, why };
}

export const HOW = {
  variable: "from CLAUDE_CODE_GIT_BASH_PATH",
  "program-files": "the fixed path C:\\Program Files\\Git",
  "program-files-x86": "the fixed path C:\\Program Files (x86)\\Git",
  "where-git": "two folders up from the first git.exe on PATH",
};

/** What the first request of a `claude -p` run lists, from a prediction: the shell tools it holds, as the names the binary uses ("account" stands for the account's default, which a fake API leaves off). */
export function expectedTools(prediction, { account = false } = {}) {
  const names = [];
  if (prediction.tools.Bash) names.push("Bash");
  if (prediction.tools.PowerShell === "yes" || (prediction.tools.PowerShell === "account" && account)) names.push("PowerShell");
  return names;
}
