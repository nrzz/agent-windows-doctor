// The hooks each agent would run on Windows, from the files each one reads, and what runs each hook command. A hook is a command line; on Windows
// the agent hands it to a shell, and the shell decides whether `$HOME/hooks/check.sh && echo ok` works. What was put to the real binaries
// (test/e2e-hooks.test.mjs), by reading the command line of the process that started the hook:
//   * Claude Code 2.1.302: Git Bash when it finds one ("...\usr\bin\bash.exe" -c "<command>"); else powershell.exe -NoProfile -NonInteractive
//     -ExecutionPolicy Bypass -Command "<command>"; a hook with "shell": "powershell" always the second.
//   * Codex CLI 0.163.0: powershell.exe -NoProfile -Command "<command>" (the full path of the first PowerShell it finds, as for its shell tool). A hook that
//     exits 2 does not block (the command ran); JSON on stdout does. command_windows (or commandWindows) replaces command on Windows. A hook that
//     the user has not reviewed (/hooks) is not run.
//   * Gemini CLI 0.64.0: powershell.exe -NoProfile -NonInteractive -Command "<command>; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }".
//   * GitHub Copilot CLI 1.0.98: the `powershell` field with "powershell.exe" -nop -nol -c "<command>" ("pwsh.exe" when PATH has one); the `bash` field
//     with "bash" --norc --noprofile -c, the first bash on PATH, and when that fails (no bash, or the WSL launcher without a distribution) the
//     preToolUse hook errors and the tool call is denied; `exec` and `args` start the program with no shell. A project's .claude/settings.json hooks run
//     through PowerShell too, and there $CLAUDE_PROJECT_DIR is an empty PowerShell variable (the environment variable is set: $env:CLAUDE_PROJECT_DIR).
//   * Cursor: not run here. Documented by its forum: the hook command is composed as PowerShell, and run through bash when MSYSTEM is set (a Git Bash
//     terminal); the documentation does not say which shell runs it.
import * as W from "./winpath.mjs";
import { loadSettingsFiles } from "./claude-settings.mjs";
import { readCodexLayers, readJsonDoc } from "./codexwin.mjs";
import { readJsonFile, isObject } from "./jsonfile.mjs";

// ---- reading the hook files --------------------------------------------------------------------------------------------------

const eachEvent = (events, fn) => { if (isObject(events)) for (const [event, groups] of Object.entries(events)) if (Array.isArray(groups)) fn(event, groups); };

/** The entries of a { Event: [ { matcher, hooks: [ { type, command, ... } ] } ] } document (Claude Code, Codex CLI, Gemini CLI). */
function fromGroups(agent, base, events, pick) {
  const out = [];
  eachEvent(events, (event, groups) => {
    for (const g of groups) {
      if (!isObject(g)) continue;
      const list = Array.isArray(g.hooks) ? g.hooks : [];
      for (const h of list) {
        if (!isObject(h)) continue;
        if (h.type !== undefined && h.type !== "command") continue;
        const command = pick(h);
        if (typeof command !== "string" || !command.trim()) continue;
        out.push({ agent, event, matcher: typeof g.matcher === "string" ? g.matcher : null, command, field: h.__field || "command", timeout: h.timeout ?? h.timeoutSec ?? null, shellField: typeof h.shell === "string" ? h.shell : null, ...base });
      }
    }
  });
  return out;
}

/** Claude Code: the `hooks` of the settings files that apply. Returns { files, entries }. */
export function claudeHooks(sys, { project }) {
  const settings = loadSettingsFiles(sys, { project });
  const files = settings.files.filter((f) => f.exists).map((f) => ({ scope: f.scope, path: f.path, display: f.display, usable: f.usable, error: f.error ? f.error.message : null, applied: f.scope === "managed" ? Boolean(f.applied) : true }));
  const entries = [];
  for (const f of settings.files) {
    if (!f.usable || (f.scope === "managed" && !f.applied) || !isObject(f.data.hooks)) continue;
    entries.push(...fromGroups("claude", { scope: f.scope, source: f.display, sourcePath: f.path }, f.data.hooks, (h) => h.command));
  }
  return { files, entries };
}

/** Codex CLI: the [hooks] tables of the config layers and the hooks.json files. On Windows command_windows (commandWindows) replaces command. */
export function codexHooks(sys, { project }) {
  const layers = readCodexLayers(sys, { project });
  const files = [];
  const entries = [];
  const pick = (h) => {
    const win = h.command_windows ?? h.commandWindows;
    if (typeof win === "string" && win.trim()) { h.__field = "command_windows"; return win; }
    h.__field = "command";
    return h.command;
  };
  for (const l of layers.layers) {
    if (l.exists) files.push({ scope: l.kind, path: l.path, display: l.path, usable: l.ok, error: l.error ? l.error.message : l.skipped ? "the project is not trusted: not read" : null, applied: l.ok });
    if (l.ok && isObject(l.value) && isObject(l.value.hooks)) entries.push(...fromGroups("codex", { scope: l.kind, source: l.path, sourcePath: l.path }, l.value.hooks, pick));
  }
  for (const d of layers.hooksJson) {
    if (d.exists) files.push({ scope: d.kind, path: d.path, display: d.path, usable: d.ok, error: d.error ? d.error.message : d.skipped ? "the project is not trusted: not read" : null, applied: d.ok });
    if (d.ok && isObject(d.value) && isObject(d.value.hooks)) entries.push(...fromGroups("codex", { scope: d.kind, source: d.path, sourcePath: d.path }, d.value.hooks, pick));
  }
  return { files, entries, layers };
}

/** Gemini CLI: the `hooks` of the system, user and project settings.json. */
export function geminiHooks(sys, { project }) {
  const home = sys.getEnv("GEMINI_CLI_HOME") || sys.home;
  const pd = sys.getEnv("ProgramData") || sys.getEnv("ALLUSERSPROFILE") || "C:\\ProgramData";
  const systemFile = sys.getEnv("GEMINI_CLI_SYSTEM_SETTINGS_PATH") || W.join(pd, "gemini-cli", "settings.json");
  const sources = [["system", systemFile], ["user", W.join(home, ".gemini", "settings.json")], ["project", W.join(project, ".gemini", "settings.json")]];
  const files = [];
  const entries = [];
  for (const [scope, file] of sources) {
    const r = readJsonFile(sys, file);
    if (!r.exists) continue;
    files.push({ scope, path: file, display: file, usable: !r.error && isObject(r.data), error: r.error ? r.error.message : null, applied: !r.error });
    if (!r.error && isObject(r.data) && isObject(r.data.hooks)) entries.push(...fromGroups("gemini", { scope, source: file, sourcePath: file }, r.data.hooks, (h) => h.command));
  }
  return { files, entries };
}

/** The hook definitions of a Copilot CLI hooks file ({ version, hooks: { event: [ { bash, powershell, exec, args, ... } ] } }). */
function copilotDefs(base, doc) {
  const out = [];
  if (!isObject(doc) || !isObject(doc.hooks)) return out;
  eachEvent(doc.hooks, (event, defs) => {
    for (const d of defs) {
      if (!isObject(d)) continue;
      const has = (k) => typeof d[k] === "string" && d[k].trim() !== "";
      out.push({ agent: "copilot", event, matcher: null, scope: base.scope, source: base.source, sourcePath: base.sourcePath, timeout: d.timeoutSec ?? null,
        bash: has("bash") ? d.bash : null, powershell: has("powershell") ? d.powershell : null, exec: has("exec") ? d.exec : null, args: Array.isArray(d.args) ? d.args.map(String) : [],
        command: has("powershell") ? d.powershell : has("exec") ? [d.exec, ...(Array.isArray(d.args) ? d.args.map(String) : [])].join(" ") : has("bash") ? d.bash : "", field: has("powershell") ? "powershell" : has("exec") ? "exec" : "bash" });
    }
  });
  return out.filter((e) => e.command);
}

/** GitHub Copilot CLI: the hooks files of COPILOT_HOME (user), the project's .github/hooks (repository), the policy folder, and the project's .claude/settings.json. */
export function copilotHooks(sys, { project }) {
  const home = sys.getEnv("COPILOT_HOME") || W.join(sys.home, ".copilot");
  const pd = sys.getEnv("ProgramData") || sys.getEnv("ALLUSERSPROFILE") || "C:\\ProgramData";
  const folders = [["user", W.join(home, "hooks")], ["project", W.join(project, ".github", "hooks")], ["policy", W.join(pd, "GitHub", "Copilot", "policy.d")]];
  const files = [];
  const entries = [];
  for (const [scope, dir] of folders) {
    for (const name of (sys.listDir(dir) || []).filter((n) => n.toLowerCase().endsWith(".json")).sort()) {
      const file = W.join(dir, name);
      const d = readJsonDoc(sys, file);
      files.push({ scope, path: file, display: file, usable: d.ok, error: d.error ? d.error.message : null, applied: d.ok });
      if (d.ok) entries.push(...copilotDefs({ scope, source: file, sourcePath: file }, d.value));
    }
  }
  // Claude Code's project settings: Copilot runs their command hooks too (put to 1.0.98)
  for (const name of ["settings.json", "settings.local.json"]) {
    const file = W.join(project, ".claude", name);
    const r = readJsonFile(sys, file);
    if (!r.exists) continue;
    files.push({ scope: "claude-settings", path: file, display: file, usable: !r.error && isObject(r.data), error: r.error ? r.error.message : null, applied: !r.error });
    if (!r.error && isObject(r.data) && isObject(r.data.hooks)) entries.push(...fromGroups("copilot", { scope: "claude-settings", source: file, sourcePath: file, claudeFormat: true }, r.data.hooks, (h) => h.command).map((e) => ({ ...e, bash: null, powershell: null, exec: null, args: [], field: "command" })));
  }
  return { files, entries };
}

/** Cursor: ~\.cursor\hooks.json, the project's .cursor\hooks.json, and the enterprise file under ProgramData. */
export function cursorHooks(sys, { project }) {
  const pd = sys.getEnv("ProgramData") || sys.getEnv("ALLUSERSPROFILE") || "C:\\ProgramData";
  const sources = [["enterprise", W.join(pd, "Cursor", "hooks.json")], ["project", W.join(project, ".cursor", "hooks.json")], ["user", W.join(sys.home, ".cursor", "hooks.json")]];
  const files = [];
  const entries = [];
  for (const [scope, file] of sources) {
    const d = readJsonDoc(sys, file);
    if (!d.exists) continue;
    files.push({ scope, path: file, display: file, usable: d.ok, error: d.error ? d.error.message : null, applied: d.ok });
    if (!d.ok || !isObject(d.value) || !isObject(d.value.hooks)) continue;
    eachEvent(d.value.hooks, (event, defs) => {
      for (const h of defs) {
        if (!isObject(h) || typeof h.command !== "string" || !h.command.trim()) continue;
        if (h.type !== undefined && h.type !== "command") continue;
        entries.push({ agent: "cursor", event, matcher: typeof h.matcher === "string" ? h.matcher : null, scope, source: file, sourcePath: file, command: h.command, field: "command", timeout: h.timeout ?? null, failClosed: h.failClosed === true });
      }
    });
  }
  return { files, entries };
}

export function readHooks(sys, agent, opts) {
  if (agent === "claude") return claudeHooks(sys, opts);
  if (agent === "codex") return codexHooks(sys, opts);
  if (agent === "gemini") return geminiHooks(sys, opts);
  if (agent === "copilot") return copilotHooks(sys, opts);
  if (agent === "cursor") return cursorHooks(sys, opts);
  return { files: [], entries: [] };
}

// ---- the command line of a hook ------------------------------------------------------------------------------------------------

/** Splits a command line into words the way a shell would for this purpose: on white space outside quotes; { text (quotes taken off), quoted }. */
export function tokenize(line) {
  const out = [];
  const s = String(line);
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    let text = "";
    let quoted = false;
    while (i < s.length && !/\s/.test(s[i])) {
      const c = s[i];
      if (c === '"' || c === "'") {
        quoted = true;
        const end = s.indexOf(c, i + 1);
        const stop = end < 0 ? s.length : end;
        text += s.slice(i + 1, stop);
        i = stop + 1;
      } else { text += c; i++; }
    }
    out.push({ text, quoted });
  }
  return out;
}

const PS_AUTOMATIC = new Set(["_", "?", "args", "error", "false", "true", "null", "home", "host", "input", "lastexitcode", "matches", "myinvocation", "pid", "profile", "pshome", "psscriptroot", "pscommandpath", "psversiontable", "pwd", "this", "shellid", "stacktrace", "env", "script", "global", "local", "private", "using", "ofs", "verbosepreference", "erroractionpreference", "executioncontext", "foreach", "psitem", "switch", "event", "sender", "consolefilename", "nestedpromptlevel", "psboundparameters", "psculture", "psuiculture", "pssenderinfo", "psedition", "pscmdlet", "psdebugcontext", "warningpreference", "progresspreference", "confirmpreference", "whatifpreference"]);

// the line with the parts in single quotes cut out (nothing in them is expanded by either shell) and optionally those in double quotes
const withoutSingle = (s) => s.replace(/'[^']*'/g, "''");
const withoutQuotes = (s) => withoutSingle(s).replace(/"(?:[^"\\]|\\.)*"/g, '""');

/**
 * Why a command line looks like bash and not like PowerShell: [{ id, text }]. `edition` is "5.1" or "7" (&& and || exist from 7).
 * Only what a PowerShell does differently is named; the line is not run.
 */
export function bashReasons(command, { edition = "5.1" } = {}) {
  const cmd = String(command);
  const reasons = [];
  const bare = withoutQuotes(cmd);
  if (edition !== "7" && /(&&|\|\|)/.test(bare)) reasons.push({ id: "and-or", text: "&& and || are not valid in Windows PowerShell 5.1 (they exist from PowerShell 7)" });
  const expandable = withoutSingle(cmd);
  const seen = new Set();
  for (const m of expandable.matchAll(/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g)) {
    const name = m[1] || m[2];
    if (!name || PS_AUTOMATIC.has(name.toLowerCase()) || seen.has(name)) continue;
    // $env:NAME is the PowerShell spelling; a name followed by a colon is a scope or a drive ($script:x, $global:x, $env:X)
    if (!m[1] && expandable[m.index + m[0].length] === ":") continue;
    seen.add(name);
    reasons.push({ id: "variable", text: `$${name} is an environment variable in bash; PowerShell reads it as an empty variable of its own (write $env:${name})` });
  }
  if (/\/dev\/null/.test(expandable)) reasons.push({ id: "dev-null", text: "/dev/null does not exist on Windows (PowerShell has $null)" });
  if (/^\s*(export|source|unset|alias)\s/.test(bare) || /[;&|]\s*(export|source|unset)\s/.test(bare)) reasons.push({ id: "builtin", text: "export, source and unset are bash builtins" });
  if (/(^|[\s;&|(])\[\[?\s+-[a-zA-Z]\s/.test(bare) || /(^|[\s;&|(])test\s+-[a-zA-Z]\s/.test(bare)) reasons.push({ id: "test", text: "[ ... ], [[ ... ]] and test are bash tests" });
  if (/;\s*(then|fi|do|done)\b/.test(bare) || /^\s*if\s+\[/.test(bare)) reasons.push({ id: "if-then", text: "if ...; then ...; fi is bash syntax" });
  if (/<<-?\s*['"]?[A-Za-z_]/.test(bare)) reasons.push({ id: "heredoc", text: "a here-document (<<) is bash syntax" });
  const first = tokenize(cmd)[0];
  if (first && /\.sh$/i.test(first.text)) reasons.push({ id: "sh-file", text: `${first.text} is a shell script: PowerShell cannot start a .sh file` });
  return reasons;
}

const PS_EXE = /^(powershell|pwsh)(\.exe)?$/i;

/**
 * What a hook command line is made of: { exe, interpreter, ps1 { file, direct, bypass } | null, extensionless (the path without an extension) | null }.
 *   ps1          the command starts a .ps1 (directly, or as the file of powershell -File, or as the first argument of powershell/pwsh)
 *   bypass       the line passes -ExecutionPolicy Bypass (or Unrestricted) to the PowerShell it starts
 *   extensionless  the first word is a path to a file with no extension (on Windows nothing starts it by association)
 */
export function analyzeCommand(command) {
  const tokens = tokenize(command);
  const first = tokens[0] ? tokens[0].text : "";
  const base = W.basename(first.replace(/\//g, "\\"));
  const lower = base.toLowerCase();
  const out = { exe: first || null, interpreter: null, ps1: null, extensionless: null, bypass: false };
  if (!first) return out;
  const bypassAt = tokens.findIndex((t) => /^-(executionpolicy|exec|ep)$/i.test(t.text));
  if (bypassAt >= 0 && tokens[bypassAt + 1] && /^(bypass|unrestricted)$/i.test(tokens[bypassAt + 1].text)) out.bypass = true;
  if (PS_EXE.test(base)) {
    out.interpreter = "powershell";
    const fileAt = tokens.findIndex((t) => /^-(file|f)$/i.test(t.text));
    const file = fileAt >= 0 && tokens[fileAt + 1] ? tokens[fileAt + 1].text : (tokens.slice(1).find((t) => /\.ps1$/i.test(t.text)) || {}).text;
    if (file && /\.ps1$/i.test(file)) out.ps1 = { file, direct: false, bypass: out.bypass };
  } else if (/\.ps1$/i.test(lower)) {
    out.ps1 = { file: first, direct: true, bypass: false };
  } else if (/^(node|python3?|py|bash|sh|cmd|deno|bun)(\.exe)?$/i.test(lower)) {
    out.interpreter = lower.replace(/\.exe$/, "");
  } else if (/[\\/]/.test(first) && !/\.[A-Za-z0-9]+$/.test(base) && base !== "." && base !== "..") {
    out.extensionless = first;
  }
  return out;
}

// ---- what runs a hook ---------------------------------------------------------------------------------------------------------

const editionOf = (exe) => (exe && /pwsh(\.exe)?$/i.test(exe) ? "7" : "5.1");

/**
 * What starts a hook on this machine: { via: "git-bash" | "powershell" | "bash" | "direct" | "unknown", exe, edition, args, bypass, basis, why }.
 *   shells   { claude: predictShell's answer, codex/gemini/copilot/cursor: shellFor's }
 *   machine  collectMachine's answer; env is read through sys by the caller (msystem)
 */
export function hookRunner(agent, entry, { shells, machine, msystem = false }) {
  if (agent === "claude") {
    const s = shells.claude;
    if (entry.shellField === "powershell") return { via: "powershell", exe: s.powershell.path, edition: editionOf(s.powershell.path), args: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command", bypass: true, basis: "verified", why: 'the hook says "shell": "powershell"' };
    if (s.gitBash.path) return { via: "git-bash", exe: s.gitBash.path, edition: null, args: "-c", bypass: false, basis: "verified", why: "Git Bash was found, and Claude Code runs a hook command through it" };
    return { via: "powershell", exe: s.powershell.path, edition: editionOf(s.powershell.path), args: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command", bypass: true, basis: "verified", why: "Git Bash was not found, so Claude Code runs a hook command through PowerShell, with -ExecutionPolicy Bypass" };
  }
  if (agent === "codex") {
    const s = shells.codex;
    return { via: "powershell", exe: s.shell ? s.shell.path : null, edition: s.shell ? editionOf(s.shell.path) : null, args: "-NoProfile -Command", bypass: false, basis: "verified", why: "Codex CLI runs a hook command through the PowerShell it finds for its shell tool" };
  }
  if (agent === "gemini") {
    const s = shells.gemini;
    return { via: "powershell", exe: s.shell ? s.shell.path : null, edition: s.shell ? editionOf(s.shell.path) : null, args: "-NoProfile -NonInteractive -Command", bypass: false, basis: "verified", why: "Gemini CLI runs a hook command through powershell.exe (pwsh.exe when PATH has one), and passes the exit code on" };
  }
  if (agent === "copilot") {
    const s = shells.copilot;
    if (entry.field === "exec") return { via: "direct", exe: entry.exec, edition: null, args: "", bypass: false, basis: "verified", why: "exec and args start the program with no shell" };
    if (entry.field === "bash") {
      const bash = (machine.bash || [])[0] || null;
      return { via: "bash", exe: bash ? bash.path : null, edition: null, args: "--norc --noprofile -c", bypass: false, basis: "verified", why: bash ? `the \`bash\` field starts the first bash on PATH (${bash.kind === "git-bash" ? "Git Bash" : bash.kind === "wsl-launcher" ? "the WSL launcher" : "an unknown bash"})` : "the `bash` field starts bash from PATH, and there is none", bashKind: bash ? bash.kind : "none" };
    }
    return { via: "powershell", exe: s.shell ? s.shell.path : null, edition: s.shell ? editionOf(s.shell.path) : null, args: "-nop -nol -c", bypass: false, basis: "verified", why: entry.field === "command" ? "Copilot CLI runs the command hooks of .claude/settings.json through PowerShell" : "the `powershell` field" };
  }
  if (agent === "cursor") {
    return msystem
      ? { via: "bash", exe: null, edition: null, args: "", bypass: false, basis: "documented", why: "MSYSTEM is set (a Git Bash terminal): Cursor composes the hook as PowerShell and runs it through bash (forum thread 168129)" }
      : { via: "powershell", exe: (shells.cursor && shells.cursor.shell && shells.cursor.shell.path) || null, edition: "5.1", args: "", bypass: false, basis: "documented", why: "Cursor composes a hook command as PowerShell (forum thread 168129); its documentation does not say which shell runs it" };
  }
  return { via: "unknown", exe: null, edition: null, args: "", bypass: false, basis: "not verified", why: "" };
}

/**
 * The hook entries of one agent with what runs each and what is wrong with it.
 * Each entry gains: runner, analysis (analyzeCommand), reasons (bashReasons when a PowerShell runs it), and flags { bashSyntax, ps1Blocked, extensionless }.
 */
export function judgeHooks(agent, entries, { shells, machine, msystem = false }) {
  const policies = {};
  for (const e of machine.powershell.editions) policies[e.id] = e.probe && e.probe.ok ? e.probe.effective : null;
  return entries.map((entry) => {
    const runner = hookRunner(agent, entry, { shells, machine, msystem });
    const analysis = analyzeCommand(entry.command);
    const ps = runner.via === "powershell";
    const reasons = ps ? bashReasons(entry.command, { edition: runner.edition || "5.1" }) : [];
    const policy = ps ? policies[runner.edition || "5.1"] || null : null;
    const bypass = runner.bypass || analysis.bypass || (analysis.ps1 && analysis.ps1.bypass);
    const flags = {
      bashSyntax: reasons.length > 0,
      ps1Blocked: Boolean(ps && analysis.ps1 && policy && (policy === "Restricted" || policy === "AllSigned") && !bypass),
      extensionless: ps && analysis.extensionless ? analysis.extensionless : null,
    };
    return { ...entry, runner, analysis, reasons, policy, flags };
  });
}
