// Checks against the real GitHub Copilot CLI (they run only when E2E_COPILOT names one, and only on Windows): which PowerShell its powershell tool starts and how it finds it, the words it answers
// with when it finds none, which shell runs a hook and what a hook that fails does, the bash field with and without a bash, the exec form, and the hooks of .claude/settings.json. A fake chat
// completions API answers on 127.0.0.1 (no token is spent, no GitHub login is needed: COPILOT_OFFLINE with a provider of our own); every run has a throwaway COPILOT_HOME, HOME, USERPROFILE and
// LOCALAPPDATA behind the guard of test/sandbox.mjs. A stand-in for PowerShell 7 is a copy of powershell.exe named pwsh.exe.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { IS_WIN, ROOT, put, tmpDir } from "./helpers.mjs";
import { copilot, skipReason } from "./agents.mjs";
import { plainWindowsPath } from "./sandbox.mjs";
import { makeSys } from "../src/sys.mjs";
import { collectMachine } from "../src/machine.mjs";
import { shellFor } from "../src/shells.mjs";
import { discoverGitBash } from "../src/gitbash.mjs";
import { findAgents } from "../src/inventory.mjs";
import * as W from "../src/winpath.mjs";

const SKIP = IS_WIN ? await skipReason(copilot) : "the Copilot CLI checks of Windows run on Windows only";
const INFO = SKIP ? null : await copilot.info();
const NUMBER = INFO ? INFO.number : "";
const HOOK = path.join(ROOT, "test", "record-hook.mjs").replace(/\\/g, "/");
const SYSTEM = process.env.SystemRoot || "C:\\Windows";
const POWERSHELL_51 = path.win32.join(SYSTEM, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const WSL_BASH = path.win32.join(SYSTEM, "System32", "bash.exe");
const GIT_BASH = IS_WIN ? (() => { const found = discoverGitBash(makeSys(), { cwd: process.cwd() }); return found.length ? found[0].path : null; })() : null;
// what the model asks the PowerShell to print: its own command line, and the folder and major version of the PowerShell it is
const WHO = "[Environment]::CommandLine; $PSHOME; $PSVersionTable.PSVersion.Major";

function standIn(name = "pwsh.exe") {
  const dir = tmpDir("adw-ps7-");
  fs.copyFileSync(POWERSHELL_51, path.join(dir, name));
  return { dir, file: path.join(dir, name) };
}
const denied = /Denied by preToolUse hook from "[^"]+" \(hook errored\)/;

/** One run in which the model asks the powershell tool for WHO: { sb, api, r, text (the tool result), tools, prediction }. */
async function shellRun(label, { pathOpts, env = {}, steps = [{ shell: WHO }] } = {}) {
  const sb = copilot.sandbox(label);
  const api = await copilot.fake(steps);
  try {
    const r = await copilot.run(sb, api, { env, path: pathOpts, timeout: 150000 });
    const sys = makeSys({ env: { ...r.env }, cwd: sb.work, home: sb.home });
    const machine = collectMachine(sys, { cwd: sb.work, probe: false });
    return { sb, api, r, text: api.results().map((x) => x.text).join("\n"), tools: api.tools(), prediction: shellFor("copilot", { machine }) };
  } finally { await api.close(); }
}

test("copilot --version prints the number of the npm package; the shim leads through npm-loader.js to the program of @github/copilot-win32-x64", { skip: SKIP, timeout: 300000 }, async (t) => {
  assert.match(INFO.version, /\d+\.\d+\.\d+/);
  const sys = makeSys({ env: { Path: [path.dirname(copilot.BIN), ...plainWindowsPath()].join(";") }, cwd: ROOT, home: ROOT });
  const found = findAgents(sys, { agents: ["copilot"] }).agents.copilot;
  const shim = found.entries.find((e) => /copilot\.cmd$/i.test(e.path));
  if (!shim) { t.diagnostic(`E2E_COPILOT (${copilot.BIN}) is not an npm shim: the shim chain is not read`); return; }
  assert.equal(shim.version, INFO.number, "the version the inventory reads from package.json is the one the binary prints");
  assert.ok(shim.program && fs.existsSync(shim.program), `the shim leads to a program that exists: ${shim.program}`);
  assert.match(shim.program, /@github[\\/]copilot-win32-x64[\\/]copilot\.exe$/i);
  t.diagnostic(`copilot --version: ${INFO.version}; the shim ${shim.path} leads through ${shim.leadsTo.join(" -> ")} to ${shim.program}`);
});

test("the powershell tool: pwsh.exe when PATH has one, else powershell.exe (Windows PowerShell 5.1 ran it), both by bare name; a pwsh.exe only in ProgramFiles is not used; the prediction agrees", { skip: SKIP, timeout: 900000 }, async (t) => {
  const ps7 = standIn();
  const pf = tmpDir("adw-pf-");
  fs.mkdirSync(path.join(pf, "PowerShell", "7"), { recursive: true });
  fs.copyFileSync(POWERSHELL_51, path.join(pf, "PowerShell", "7", "pwsh.exe"));
  const rows = [
    { id: "no pwsh anywhere", pathOpts: { only: plainWindowsPath() }, env: {}, program: /"?powershell\.exe"? -NoProfile -NoLogo -NonInteractive -Command/i, major: "5", predicted: "powershell.exe" },
    { id: "a pwsh.exe on PATH", pathOpts: { only: plainWindowsPath(), first: [ps7.dir] }, env: {}, program: /"?pwsh\.exe"? -NoProfile -NoLogo -NonInteractive -Command/i, major: "5", predicted: ps7.file },
    { id: "a pwsh.exe only in ProgramFiles, off PATH", pathOpts: { only: plainWindowsPath() }, env: { ProgramFiles: pf, ProgramW6432: pf }, program: /"?powershell\.exe"? -NoProfile -NoLogo -NonInteractive -Command/i, major: "5", predicted: "powershell.exe" },
  ];
  for (const row of rows) {
    const run = await shellRun("shell", { pathOpts: row.pathOpts, env: row.env });
    assert.equal(run.r.code, 0, `${row.id}: ${run.r.err.slice(0, 300)}`);
    assert.match(run.text, row.program, `${row.id}: ${run.text}`);
    assert.match(run.text, new RegExp(`^${row.major}\\s*$`, "m"), `${row.id}: the shell is PowerShell ${row.major}`);
    assert.match(run.text, /v1\.0/, `${row.id}: $PSHOME`);
    assert.ok(run.tools.includes("powershell"), `${row.id}: the tool is listed`);
    // Copilot CLI starts the program by its bare name; the prediction names the file that the name finds on PATH
    const shell = run.prediction.shell;
    const same = shell && (row.predicted.includes("\\") ? W.same(shell.path, row.predicted) : W.basename(shell.path).toLowerCase() === row.predicted);
    assert.ok(same, `${row.id}: the prediction says ${shell && shell.path}, expected ${row.predicted}`);
  }
  t.diagnostic(`${rows.length} rows on Copilot CLI ${NUMBER}`);
});

test("with neither pwsh.exe nor powershell.exe on PATH the powershell tool is still listed to the model and answers in these words", { skip: SKIP, timeout: 300000 }, async (t) => {
  const run = await shellRun("none", { pathOpts: { only: [path.win32.join(SYSTEM, "System32"), SYSTEM, path.dirname(process.execPath)] } });
  assert.equal(run.r.code, 0, run.r.err.slice(0, 300));
  assert.ok(run.tools.includes("powershell"), "the tool is listed");
  assert.match(run.text, /PowerShell is not available\. Tried "pwsh\.exe", "powershell\.exe"\./);
  assert.match(run.text, /Install PowerShell from https:\/\/aka\.ms\/powershell/);
  assert.match(run.text, /spawn pwsh\.exe ENOENT/);
  assert.match(run.text, /spawn powershell\.exe ENOENT/);
  assert.equal(run.prediction.state, "missing", "the prediction says the shell is missing");
  t.diagnostic(`the answer on Copilot CLI ${NUMBER}: ${run.text.replace(/\s+/g, " ").slice(0, 300)}`);
});

test("the package that copilot.exe unpacks for itself is under LOCALAPPDATA\\copilot\\pkg\\win32-x64\\<version>", { skip: SKIP, timeout: 300000 }, async (t) => {
  const run = await shellRun("pkg", { pathOpts: { only: plainWindowsPath() } });
  assert.equal(run.r.code, 0, run.r.err.slice(0, 300));
  const dir = path.join(run.sb.localAppData, "copilot", "pkg", "win32-x64");
  const versions = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  t.diagnostic(`${dir}: ${versions.join(", ") || "(none)"} on Copilot CLI ${NUMBER}`);
  assert.ok(versions.includes(INFO.number), `${INFO.number} is in ${versions.join(", ")}`);
  // the inventory finds it as the cache of that version
  const sys = makeSys({ env: { Path: plainWindowsPath().join(";"), LOCALAPPDATA: run.sb.localAppData, USERPROFILE: run.sb.home, APPDATA: run.sb.appData }, cwd: run.sb.work, home: run.sb.home });
  const entries = findAgents(sys, { agents: ["copilot"] }).agents.copilot.entries;
  const cache = entries.find((e) => e.kind === "cache");
  assert.ok(cache, `the inventory lists the cache: ${entries.map((e) => e.path).join(", ")}`);
  assert.equal(cache.version, INFO.number);
});

// ---- hooks ---------------------------------------------------------------------------------------------------------------------------

const CASES = { allow: {}, fail: { stderr: "failed-hook", exit: 1 } };

/**
 * A run with hooks. `userHooks` is the body of COPILOT_HOME/hooks/h.json; `githubHooks` the body of <project>/.github/hooks/h.json; `projectClaude` and `userClaude` the settings.json of <project>/.claude
 * and of ~/.claude. The model asks for `echo CASE-allow RAN-OK`. Returns { lines (what the hooks recorded), text, ran, denied }.
 */
async function hookRun(label, { userHooks, githubHooks, projectClaude, userClaude, pathOpts, env = {}, name = "allow" } = {}) {
  const sb = copilot.sandbox(label);
  const log = path.join(sb.base, "hook.jsonl");
  const casesFile = path.join(sb.base, "cases.json");
  put(casesFile, CASES);
  if (userHooks) put(path.join(sb.hooksDir, "h.json"), userHooks);
  if (githubHooks) put(path.join(sb.work, ".github", "hooks", "h.json"), githubHooks);
  if (projectClaude) put(path.join(sb.work, ".claude", "settings.json"), projectClaude);
  if (userClaude) put(path.join(sb.home, ".claude", "settings.json"), userClaude);
  const api = await copilot.fake([{ shell: `echo CASE-${name} RAN-OK` }]);
  try {
    const r = await copilot.run(sb, api, { env: { ADW_LOG: log, ADW_CASES: casesFile, ADW_PARENT: "1", ...env }, path: pathOpts, timeout: 150000 });
    const lines = fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    const text = api.results().map((x) => x.text).join("\n");
    // PowerShell's echo prints each argument on a line of its own
    return { sb, r, api, lines, text, ran: /RAN-OK/.test(text), denied: denied.test(text) };
  } finally { await api.close(); }
}
const hook = (fields) => ({ version: 1, hooks: { preToolUse: [{ type: "command", timeoutSec: 30, ...fields }] } });
const node = (event, extra = "") => `node "${HOOK}" ${event} act${extra}`;

test("the powershell field of a hook is run by PowerShell with -nop -nol -c; && in it is a parse error of Windows PowerShell 5.1, the hook errors, and Copilot CLI denies the tool call", { skip: SKIP, timeout: 900000 }, async (t) => {
  const plain = { only: plainWindowsPath() };
  const ok = await hookRun("h-ps", { userHooks: hook({ powershell: node("preToolUse") }), pathOpts: plain });
  assert.equal(ok.r.code, 0, ok.r.err.slice(0, 300));
  assert.equal(ok.lines.length, 1);
  assert.equal(ok.lines[0].input.toolName, "powershell");
  assert.match(ok.lines[0].parent.name, /^powershell\.exe$/i);
  assert.match(ok.lines[0].parent.commandLine, /powershell\.exe"? -nop -nol -c /i, ok.lines[0].parent.commandLine);
  assert.equal(ok.ran, true);
  const both = await hookRun("h-andand", { userHooks: hook({ powershell: `${node("preToolUse")} && echo done` }), pathOpts: plain });
  assert.equal(both.lines.length, 0, "the hook did not run");
  assert.equal(both.ran, false, "the tool call was denied");
  assert.match(both.text, denied);
  // pwsh.exe on PATH runs it instead
  const ps7 = standIn();
  const withPwsh = await hookRun("h-pwsh", { userHooks: hook({ powershell: node("preToolUse") }), pathOpts: { only: plainWindowsPath(), first: [ps7.dir] } });
  assert.equal(withPwsh.lines.length, 1);
  assert.ok(W.same(withPwsh.lines[0].parent.path, ps7.file), withPwsh.lines[0].parent.path);
  assert.match(withPwsh.lines[0].parent.commandLine, /pwsh\.exe"? -nop -nol -c /i);
  t.diagnostic(`parent of a hook: ${ok.lines[0].parent.commandLine.slice(0, 120)}; && gave: ${both.text.slice(0, 120)} on Copilot CLI ${NUMBER}`);
});

test("a .ps1 hook under the Restricted execution policy does not run, and Copilot CLI denies the tool call", { skip: SKIP, timeout: 300000 }, async () => {
  const sb0 = copilot.sandbox("h-ps1");
  const ps1 = path.join(sb0.work, "hook.ps1");
  fs.writeFileSync(ps1, `node "${HOOK}" preToolUse\r\n`);
  const run = await hookRun("h-ps1b", { userHooks: hook({ powershell: `powershell -NoProfile -ExecutionPolicy Restricted -File "${ps1}"` }), pathOpts: { only: plainWindowsPath() } });
  assert.equal(run.lines.length, 0, "the script did not run");
  assert.equal(run.denied, true, run.text);
  // with Bypass it runs
  const sb1 = copilot.sandbox("h-ps1c");
  const ps1b = path.join(sb1.work, "hook.ps1");
  fs.writeFileSync(ps1b, `node "${HOOK}" preToolUse\r\n`);
  const ok = await hookRun("h-ps1d", { userHooks: hook({ powershell: `powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1b}"` }), pathOpts: { only: plainWindowsPath() } });
  assert.equal(ok.lines.length, 1);
  assert.equal(ok.ran, true);
});

test("the bash field: with a Git Bash first on PATH it runs as bash --norc --noprofile -c; with no bash, or the WSL launcher first, the hook does not run and the tool call is denied", { skip: SKIP, timeout: 900000 }, async (t) => {
  const none = await hookRun("h-nobash", { userHooks: hook({ bash: node("preToolUse") }), pathOpts: { only: plainWindowsPath() } });
  assert.equal(none.lines.length, 0, "no bash: the hook did not run");
  assert.equal(none.denied, true, none.text);
  if (fs.existsSync(WSL_BASH)) {
    const wsl = await hookRun("h-wslbash", { userHooks: hook({ bash: node("preToolUse") }), pathOpts: { only: [path.win32.join(SYSTEM, "System32"), ...plainWindowsPath()] } });
    assert.equal(wsl.lines.length, 0, "the WSL launcher is not a bash for a hook");
    assert.equal(wsl.denied, true, wsl.text);
  } else t.diagnostic("no C:\\Windows\\System32\\bash.exe (WSL launcher) on this machine: that row is not run");
  if (GIT_BASH) {
    const gitBin = path.win32.dirname(GIT_BASH);
    const git = await hookRun("h-gitbash", { userHooks: hook({ bash: node("preToolUse") }), pathOpts: { only: plainWindowsPath(), first: [gitBin] } });
    assert.equal(git.lines.length, 1, `a Git Bash first on PATH ran the hook (${GIT_BASH}): ${git.text}`);
    assert.match(git.lines[0].parent.commandLine, /bash(\.exe)?"? --norc --noprofile -c /i, git.lines[0].parent.commandLine);
    t.diagnostic(`bash field with ${GIT_BASH}: ${git.lines[0].parent.commandLine.slice(0, 140)}; without bash: ${none.text.slice(0, 100)}`);
  } else t.diagnostic("no Git Bash on this machine: that row is not run");
});

test("exec and args start the program with no shell: the parent of the hook process is copilot.exe", { skip: SKIP, timeout: 300000 }, async () => {
  const run = await hookRun("h-exec", { userHooks: hook({ exec: process.execPath, args: [HOOK, "preToolUse", "act"] }), pathOpts: { only: plainWindowsPath() } });
  assert.equal(run.r.code, 0, run.r.err.slice(0, 300));
  assert.equal(run.lines.length, 1, run.text);
  assert.match(run.lines[0].parent.name, /^copilot\.exe$/i, run.lines[0].parent.name);
  assert.equal(run.ran, true);
});

test("the hooks of .claude/settings.json: the project's run through PowerShell with $CLAUDE_PROJECT_DIR empty and the variable set; the user's file is not read; .github/hooks/*.json with a powershell field run", { skip: SKIP, timeout: 900000 }, async (t) => {
  const settings = (command) => ({ hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command }] }] } });
  const plain = { only: plainWindowsPath() };
  // the command prints nothing of its own: the recorder logs the environment, and the PowerShell variable is passed on as an argument
  const project = await hookRun("h-claude", { projectClaude: settings(`node "${HOOK}" CLAUDEHOOK "$CLAUDE_PROJECT_DIR"`), pathOpts: plain });
  assert.equal(project.r.code, 0, project.r.err.slice(0, 300));
  assert.equal(project.lines.length, 1, `the project's .claude/settings.json hook ran: ${project.text}`);
  const l = project.lines[0];
  assert.match(l.parent.name, /^powershell\.exe$/i);
  assert.match(l.parent.commandLine, /powershell\.exe"? -nop -nol -c /i, l.parent.commandLine);
  assert.ok(W.same(l.env.CLAUDE_PROJECT_DIR, project.sb.work), `CLAUDE_PROJECT_DIR is ${l.env.CLAUDE_PROJECT_DIR}`);
  assert.ok(W.same(l.env.COPILOT_PROJECT_DIR, project.sb.work), `COPILOT_PROJECT_DIR is ${l.env.COPILOT_PROJECT_DIR}`);
  assert.equal(l.argv[1] || "", "", "$CLAUDE_PROJECT_DIR is an empty PowerShell variable");
  // the user's file
  const user = await hookRun("h-userclaude", { userClaude: settings(`node "${HOOK}" USERCLAUDE`), pathOpts: plain });
  assert.equal(user.lines.length, 0, "a hook in ~/.claude/settings.json did not run");
  // .github/hooks
  const github = await hookRun("h-github", { githubHooks: hook({ powershell: node("preToolUse") }), pathOpts: plain });
  assert.equal(github.lines.length, 1, `.github/hooks ran: ${github.text}`);
  assert.match(github.lines[0].parent.commandLine, /powershell\.exe"? -nop -nol -c /i);
  t.diagnostic(`.claude/settings.json hook: ${l.parent.commandLine.slice(0, 120)} on Copilot CLI ${NUMBER}`);
});
