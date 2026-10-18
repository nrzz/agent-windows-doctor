// The hook command line: how it is split, what looks like bash, what a command starts, and what runs a hook of each agent on a pretend machine.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { HOME, PROJECT, winMachine, withNpm } from "./win-machine.mjs";
import { analyzeCommand, bashReasons, claudeHooks, codexHooks, copilotHooks, cursorHooks, geminiHooks, hookRunner, judgeHooks, readHooks, tokenize } from "../src/hooks.mjs";

const ids = (command, edition) => bashReasons(command, { edition }).map((r) => r.id);

test("tokenize: white space outside quotes, quotes taken off, a quote in the middle of a word", () => {
  assert.deepEqual(tokenize('node "C:/a b/x.mjs" --flag \'one two\'').map((t) => t.text), ["node", "C:/a b/x.mjs", "--flag", "one two"]);
  assert.deepEqual(tokenize('  a   b  ').map((t) => t.text), ["a", "b"]);
  assert.deepEqual(tokenize('C:\\Program" "Files\\x.exe arg').map((t) => t.text), ["C:\\Program Files\\x.exe", "arg"]);
  assert.deepEqual(tokenize('say "unterminated').map((t) => t.text), ["say", "unterminated"]);
  assert.deepEqual(tokenize(""), []);
  assert.equal(tokenize('"x y"')[0].quoted, true);
});

test("bashReasons: what a PowerShell does differently from bash, one id for each", () => {
  assert.deepEqual(ids("node a.mjs && node b.mjs", "5.1"), ["and-or"]);
  assert.deepEqual(ids("node a.mjs && node b.mjs", "7"), [], "PowerShell 7 has && and ||");
  assert.deepEqual(ids("node a.mjs || exit 1", "5.1"), ["and-or"]);
  assert.deepEqual(ids('node "a && b.mjs"', "5.1"), [], "inside quotes it is a character");
  assert.deepEqual(ids('node "$CLAUDE_PROJECT_DIR/hook.mjs"'), ["variable"]);
  assert.match(bashReasons('node "$CLAUDE_PROJECT_DIR/hook.mjs"')[0].text, /\$CLAUDE_PROJECT_DIR is an environment variable in bash; PowerShell reads it as an empty variable of its own \(write \$env:CLAUDE_PROJECT_DIR\)/);
  assert.deepEqual(ids("echo ${HOME_DIR}/x"), ["variable"], "the braced form");
  assert.deepEqual(ids("node x.mjs $env:HOME $HOME $PWD $_ $true $null $args $LASTEXITCODE"), [], "$env: and the automatic variables of PowerShell are its own");
  assert.deepEqual(ids("echo '$HOME_DIR in single quotes'"), [], "single quotes expand nothing in either shell");
  assert.deepEqual(ids("node x.mjs 2>/dev/null"), ["dev-null"]);
  assert.deepEqual(ids("export A=1; node x.mjs"), ["builtin"]);
  assert.deepEqual(ids("source ~/.profile && node x.mjs", "7"), ["builtin"]);
  assert.deepEqual(ids("[ -f .env ] && echo blocked", "7"), ["test"]);
  assert.deepEqual(ids("[[ -d x ]]", "7"), ["test"]);
  assert.deepEqual(ids("test -f x", "7"), ["test"]);
  assert.deepEqual(ids("if [ -f x ]; then echo a; fi", "7").sort(), ["if-then", "test"].sort());
  assert.deepEqual(ids("cat <<EOF", "7"), ["heredoc"]);
  assert.deepEqual(ids("./hooks/check.sh arg", "7"), ["sh-file"]);
  assert.deepEqual(ids('node "C:/hooks/check.mjs" --event PreToolUse', "5.1"), []);
  assert.deepEqual(ids("powershell -File x.ps1", "5.1"), []);
  assert.deepEqual(ids("git status; git diff", "5.1"), [], "a semicolon is a separator in both");
  const many = ids('export A=1 && node "$B/x.mjs" 2>/dev/null', "5.1");
  assert.deepEqual(many.sort(), ["and-or", "builtin", "dev-null", "variable"].sort());
});

test("analyzeCommand: the program, a .ps1, -ExecutionPolicy, and a file with no extension", () => {
  assert.deepEqual(analyzeCommand('node "C:/h/check.mjs" a'), { exe: "node", interpreter: "node", ps1: null, extensionless: null, bypass: false });
  assert.deepEqual(analyzeCommand("C:\\h\\check.ps1 -x").ps1, { file: "C:\\h\\check.ps1", direct: true, bypass: false });
  assert.deepEqual(analyzeCommand('powershell -NoProfile -File "C:\\h\\check.ps1"').ps1, { file: "C:\\h\\check.ps1", direct: false, bypass: false });
  assert.deepEqual(analyzeCommand('powershell -NoProfile -ExecutionPolicy Bypass -File "C:\\h\\check.ps1"').ps1, { file: "C:\\h\\check.ps1", direct: false, bypass: true });
  assert.equal(analyzeCommand("pwsh -ep Unrestricted check.ps1").ps1.bypass, true);
  assert.equal(analyzeCommand("pwsh check.ps1").ps1.file, "check.ps1", "the first argument of pwsh that is a .ps1");
  assert.equal(analyzeCommand("powershell -Command \"echo hi\"").ps1, null);
  assert.equal(analyzeCommand("C:/hooks/pre-tool --strict").extensionless, "C:/hooks/pre-tool");
  assert.equal(analyzeCommand(".\\hooks\\pre-tool").extensionless, ".\\hooks\\pre-tool");
  for (const ok of ["git status", "node x.mjs", "C:/hooks/pre-tool.cmd", "hooks/run.sh", ".", ".."]) assert.equal(analyzeCommand(ok).extensionless, null, ok);
  assert.equal(analyzeCommand("").exe, null);
});

test("the hook files of each agent are read where the agent reads them", () => {
  const claude = winMachine({ texts: {
    [`${HOME}\\.claude\\settings.json`]: JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node a.mjs", timeout: 5 }, { type: "prompt", prompt: "no" }] }] } }),
    [`${PROJECT}\\.claude\\settings.local.json`]: JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: "node b.mjs", shell: "powershell" }] }] } }),
  } });
  const c = claudeHooks(claude, { project: PROJECT });
  assert.deepEqual(c.entries.map((e) => [e.event, e.scope, e.matcher, e.command, e.shellField]).sort(), [["PreToolUse", "user", "Bash", "node a.mjs", null], ["Stop", "local", null, "node b.mjs", "powershell"]].sort());
  assert.equal(c.files.length, 2);

  const gemini = winMachine({ env: { ProgramData: "C:\\ProgramData" }, texts: {
    "C:\\ProgramData\\gemini-cli\\settings.json": JSON.stringify({ hooks: { BeforeTool: [{ hooks: [{ type: "command", command: "system.cmd" }] }] } }),
    [`${HOME}\\.gemini\\settings.json`]: JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "user.cmd", timeout: 30000 }] }] } }),
    [`${PROJECT}\\.gemini\\settings.json`]: JSON.stringify({ hooks: { AfterTool: [{ matcher: "run_shell_command", hooks: [{ type: "command", command: "project.cmd" }] }] } }),
  } });
  assert.deepEqual(geminiHooks(gemini, { project: PROJECT }).entries.map((e) => [e.scope, e.event, e.command]), [["system", "BeforeTool", "system.cmd"], ["user", "SessionStart", "user.cmd"], ["project", "AfterTool", "project.cmd"]]);
  const custom = winMachine({ env: { GEMINI_CLI_SYSTEM_SETTINGS_PATH: "D:\\gemini-system.json", GEMINI_CLI_HOME: "D:\\ghome" }, texts: { "D:\\gemini-system.json": JSON.stringify({ hooks: { BeforeTool: [{ hooks: [{ command: "custom-system" }] }] } }), "D:\\ghome\\.gemini\\settings.json": JSON.stringify({ hooks: { BeforeTool: [{ hooks: [{ command: "custom-home" }] }] } }) } });
  assert.deepEqual(geminiHooks(custom, { project: PROJECT }).entries.map((e) => e.command), ["custom-system", "custom-home"], "GEMINI_CLI_SYSTEM_SETTINGS_PATH and GEMINI_CLI_HOME are honoured");

  const copilot = winMachine({ texts: {
    [`${HOME}\\.copilot\\hooks\\a.json`]: JSON.stringify({ version: 1, hooks: { preToolUse: [{ type: "command", bash: "a.sh", powershell: "a.ps1", timeoutSec: 30 }, { type: "command", exec: "node", args: ["x.mjs", "y"] }] } }),
    [`${PROJECT}\\.github\\hooks\\b.json`]: JSON.stringify({ version: 1, hooks: { sessionStart: [{ type: "command", bash: "b.sh" }] } }),
    "C:\\ProgramData\\GitHub\\Copilot\\policy.d\\p.json": JSON.stringify({ version: 1, hooks: { preToolUse: [{ type: "command", powershell: "policy.ps1" }] } }),
    [`${PROJECT}\\.claude\\settings.json`]: JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "claude-hook" }] }] } }),
  } });
  const cp = copilotHooks(copilot, { project: PROJECT });
  assert.deepEqual(cp.entries.map((e) => [e.scope, e.event, e.field, e.command]), [
    ["user", "preToolUse", "powershell", "a.ps1"], ["user", "preToolUse", "exec", "node x.mjs y"], ["project", "sessionStart", "bash", "b.sh"], ["policy", "preToolUse", "powershell", "policy.ps1"], ["claude-settings", "PreToolUse", "command", "claude-hook"],
  ]);
  assert.equal(cp.entries.find((e) => e.field === "exec").exec, "node");
  assert.equal(cp.entries.at(-1).claudeFormat, true);
  const custom2 = winMachine({ env: { COPILOT_HOME: "D:\\ch" }, texts: { "D:\\ch\\hooks\\z.json": JSON.stringify({ version: 1, hooks: { preToolUse: [{ powershell: "z.ps1" }] } }) } });
  assert.equal(copilotHooks(custom2, { project: PROJECT }).entries[0].command, "z.ps1", "COPILOT_HOME is honoured");

  const cursor = winMachine({ texts: {
    [`${HOME}\\.cursor\\hooks.json`]: JSON.stringify({ version: 1, hooks: { preToolUse: [{ command: "user.mjs", matcher: "Shell", failClosed: true }, { type: "prompt", prompt: "x" }] } }),
    [`${PROJECT}\\.cursor\\hooks.json`]: JSON.stringify({ version: 1, hooks: { stop: [{ command: "stop.mjs" }] } }),
    "C:\\ProgramData\\Cursor\\hooks.json": JSON.stringify({ version: 1, hooks: { beforeShellExecution: [{ command: "enterprise.mjs" }] } }),
  } });
  assert.deepEqual(cursorHooks(cursor, { project: PROJECT }).entries.map((e) => [e.scope, e.event, e.command, e.failClosed]), [["enterprise", "beforeShellExecution", "enterprise.mjs", false], ["project", "stop", "stop.mjs", false], ["user", "preToolUse", "user.mjs", true]]);
  assert.deepEqual(readHooks(winMachine(), "nope", { project: PROJECT }), { files: [], entries: [] });
});

test("Codex hooks: config.toml tables and hooks.json, command_windows over command, and a hook without a command is skipped", () => {
  const toml = `[[hooks.PreToolUse]]
matcher = "*"
[[hooks.PreToolUse.hooks]]
type = "command"
command = "node posix.mjs"
commandWindows = "node win.mjs"
[[hooks.PreToolUse.hooks]]
type = "command"
[[hooks.Stop]]
[[hooks.Stop.hooks]]
type = "command"
command = "node stop.mjs"
`;
  const sys = winMachine({ texts: { [`${HOME}\\.codex\\config.toml`]: toml } });
  const r = codexHooks(sys, { project: PROJECT });
  assert.deepEqual(r.entries.map((e) => [e.event, e.command, e.field]), [["PreToolUse", "node win.mjs", "command_windows"], ["Stop", "node stop.mjs", "command"]]);
});

test("what runs a hook: each agent's runner, from the shells the tool predicted", () => {
  const ps = { shell: { path: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", core: false } };
  const claude = { gitBash: { path: null }, powershell: { path: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" } };
  const machine = { bash: [{ path: "C:\\Windows\\System32\\bash.exe", kind: "wsl-launcher" }] };
  const tables = { shells: { claude, codex: ps, gemini: ps, copilot: ps, cursor: ps }, machine };
  const run = (agent, entry, t = tables) => hookRunner(agent, entry, t);
  assert.equal(run("claude", { shellField: null }).via, "powershell");
  assert.equal(run("claude", { shellField: null }).bypass, true);
  assert.equal(run("claude", { shellField: "powershell" }).why, 'the hook says "shell": "powershell"');
  assert.equal(run("codex", {}).args, "-NoProfile -Command");
  assert.equal(run("gemini", {}).args, "-NoProfile -NonInteractive -Command");
  assert.equal(run("copilot", { field: "powershell" }).args, "-nop -nol -c");
  assert.equal(run("copilot", { field: "exec", exec: "node" }).via, "direct");
  const bash = run("copilot", { field: "bash" });
  assert.deepEqual([bash.via, bash.bashKind, bash.basis], ["bash", "wsl-launcher", "verified"]);
  const none = run("copilot", { field: "bash" }, { ...tables, machine: { bash: [] } });
  assert.deepEqual([none.bashKind, none.exe], ["none", null]);
  assert.equal(run("cursor", {}).basis, "documented");
  assert.equal(run("cursor", {}, { ...tables, msystem: true }).via, "bash");
  assert.equal(run("claude", { shellField: null }, { shells: { claude: { gitBash: { path: "E:\\Das\\Git\\bin\\bash.exe" }, powershell: { path: null } } }, machine }).via, "git-bash");
  assert.equal(run("nope", {}).via, "unknown");
});

test("judgeHooks: the flags of each entry, from what runs it and the policy of the edition", () => {
  const machine = { powershell: { editions: [{ id: "5.1", path: "ps51", probe: { ok: true, effective: "AllSigned" } }, { id: "7", path: "C:\\p\\pwsh.exe", probe: { ok: true, effective: "RemoteSigned" } }] }, bash: [] };
  const ps51 = { shell: { path: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" } };
  const entries = [
    { event: "e", command: 'node "$X/a.mjs" && b', field: "command", source: "s" },
    { event: "e", command: 'powershell -File "x.ps1"', field: "command", source: "s" },
    { event: "e", command: 'powershell -ExecutionPolicy Bypass -File "x.ps1"', field: "command", source: "s" },
    { event: "e", command: "tools/prehook", field: "command", source: "s" },
  ];
  const judged = judgeHooks("codex", entries, { shells: { codex: ps51 }, machine });
  assert.deepEqual(judged.map((j) => [j.flags.bashSyntax, j.flags.ps1Blocked, j.flags.extensionless]), [[true, false, null], [false, true, null], [false, false, null], [false, false, "tools/prehook"]]);
  assert.equal(judged[1].policy, "AllSigned");
  const seven = judgeHooks("codex", entries.slice(0, 1), { shells: { codex: { shell: { path: "C:\\p\\pwsh.exe" } } }, machine });
  assert.deepEqual(seven[0].reasons.map((r) => r.id), ["variable"], "PowerShell 7 has &&");
});
