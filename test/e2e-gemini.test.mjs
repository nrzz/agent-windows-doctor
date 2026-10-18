// Checks against the real Gemini CLI (they run only when E2E_GEMINI names one, and only on Windows): which PowerShell its run_shell_command starts and how it finds it, the error it answers with
// when it finds none, which shell runs a hook, what a hook with && does, what a PowerShell in another language mode would do (documented only: a process cannot be put in Constrained Language Mode
// from its environment), and whether the native half of node-pty is in the npm install. A fake Gemini API answers on 127.0.0.1 (no token is spent); every run has a throwaway HOME and USERPROFILE
// behind the guard of test/sandbox.mjs. A turn of Gemini CLI takes about 100 seconds on the machine this was written on, so the runs of this file go in parallel. A stand-in for PowerShell 7 is a
// copy of powershell.exe named pwsh.exe.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { IS_WIN, ROOT, tmpDir } from "./helpers.mjs";
import { gemini, skipReason } from "./agents.mjs";
import { plainWindowsPath } from "./sandbox.mjs";
import { makeSys } from "../src/sys.mjs";
import { collectMachine } from "../src/machine.mjs";
import { shellFor } from "../src/shells.mjs";
import { findAgents } from "../src/inventory.mjs";
import { nodeWants, ptyOf } from "../src/agentfacts.mjs";
import * as W from "../src/winpath.mjs";

const SKIP = IS_WIN ? await skipReason(gemini) : "the Gemini CLI checks of Windows run on Windows only";
const INFO = SKIP ? null : await gemini.info();
const NUMBER = INFO ? INFO.number : "";
const HOOK = path.join(ROOT, "test", "record-hook.mjs").replace(/\\/g, "/");
const SYSTEM = process.env.SystemRoot || "C:\\Windows";
const POWERSHELL_51 = path.win32.join(SYSTEM, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
// what the model asks the PowerShell to print: its own command line, its folder, its major version and its language mode
const WHO = "[Environment]::CommandLine; $PSHOME; $PSVersionTable.PSVersion.Major; $ExecutionContext.SessionState.LanguageMode";

function standIn(name = "pwsh.exe") {
  const dir = tmpDir("adw-ps7-");
  fs.copyFileSync(POWERSHELL_51, path.join(dir, name));
  return { dir, file: path.join(dir, name) };
}
const hookEntry = (command) => ({ type: "command", command, timeout: 30000 });
const CASES = { block: { stderr: "blocked-by-hook-stderr", exit: 2 }, fail: { stderr: "failed-hook", exit: 1 } };
const HOOKS = {
  SessionStart: [{ matcher: "*", hooks: [hookEntry(`node "${HOOK}" SessionStart`)] }],
  BeforeTool: [{ matcher: "*", hooks: [hookEntry(`node "${HOOK}" BeforeTool`), hookEntry(`node "${HOOK}" ANDAND && echo done`)] }],
};

/** One headless turn in which the model asks run_shell_command for `command` (WHO unless said). */
async function turn(label, { pathOpts, env = {}, hooks, command = WHO } = {}) {
  const sb = gemini.sandbox(label, hooks ? { hooks } : {});
  const log = path.join(sb.base, "hook.jsonl");
  const cases = path.join(sb.base, "cases.json");
  fs.writeFileSync(cases, JSON.stringify(CASES));
  const api = await gemini.fake([{ shell: command }]);
  try {
    const r = await gemini.run(sb, api, { env: { ADW_LOG: log, ADW_CASES: cases, ADW_PARENT: "1", ...env }, path: pathOpts, timeout: 190000 });
    const lines = fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    const results = api.results().map((x) => x.text).join("\n");
    const sys = makeSys({ env: { ...r.env }, cwd: sb.work, home: sb.home });
    const machine = collectMachine(sys, { cwd: sb.work, probe: false });
    return { sb, r, api, lines, results, tools: api.tools(), prediction: shellFor("gemini", { machine }) };
  } finally { await api.close(); }
}
/** The lines the shell printed, from the tool's answer (<untrusted_context>, Output: ..., then the lines). */
const printed = (text) => {
  const m = /Output:\s*([\s\S]*?)(?:\n(?:Process Group PGID|Error|Exit Code|<\/untrusted_context>)|$)/.exec(text);
  return m ? m[1].split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
};

// a run that nobody awaits yet must not stop the process when it fails: the test that awaits it sees the failure
const early = (p) => { p.catch(() => {}); return p; };
const runs = SKIP ? null : (() => {
  const ps7 = standIn();
  const pf = tmpDir("adw-pf-");
  fs.mkdirSync(path.join(pf, "PowerShell", "7"), { recursive: true });
  fs.copyFileSync(POWERSHELL_51, path.join(pf, "PowerShell", "7", "pwsh.exe"));
  const noPsFolder = [path.win32.join(SYSTEM, "System32"), SYSTEM, path.dirname(process.execPath)];
  return {
    ps7,
    plain: early(turn("g-plain", { pathOpts: { only: plainWindowsPath() }, hooks: HOOKS })),
    withPwsh: early(turn("g-pwsh", { pathOpts: { only: plainWindowsPath(), first: [ps7.dir] }, env: { __PSLockdownPolicy: "4" } })),
    // no PowerShell folder on PATH; a pwsh.exe in a ProgramFiles folder that PATH does not list
    none: early(turn("g-none", { pathOpts: { only: noPsFolder }, env: { ProgramFiles: pf, ProgramW6432: pf } })),
    // a hook that exits with 2 (and one that exits with 1) guarding a command that prints a word
    blocks: early(turn("g-block", { pathOpts: { only: plainWindowsPath() }, command: "echo CASE-block RAN-OK", hooks: { BeforeTool: [{ matcher: "*", hooks: [hookEntry(`node "${HOOK}" BeforeTool act`)] }] } })),
    fails: early(turn("g-fail", { pathOpts: { only: plainWindowsPath() }, command: "echo CASE-fail RAN-OK", hooks: { BeforeTool: [{ matcher: "*", hooks: [hookEntry(`node "${HOOK}" BeforeTool act`)] }] } })),
  };
})();

test("run_shell_command starts powershell.exe -NoProfile -NonInteractive -Command when PATH has no pwsh.exe; the shell is Windows PowerShell 5.1, and the prediction agrees", { skip: SKIP, timeout: 900000 }, async (t) => {
  const run = await runs.plain;
  assert.equal(run.r.code, 0, `${run.r.err.slice(0, 400)}`);
  assert.ok(run.tools.includes("run_shell_command"), `the tool is listed: ${run.tools.join(", ")}`);
  const [line, home, major, mode] = printed(run.results);
  assert.match(line, /powershell\.exe"? -NoProfile -NonInteractive -Command/i, run.results);
  assert.match(home, /WindowsPowerShell[\\/]v1\.0/i);
  assert.equal(major, "5");
  assert.equal(mode, "FullLanguage");
  assert.ok(run.prediction.shell && /powershell\.exe$/i.test(run.prediction.shell.path), `the prediction says ${run.prediction.shell && run.prediction.shell.path}`);
  assert.match(run.prediction.shell.edition || run.prediction.shell.label, /5\.1/);
  t.diagnostic(`Gemini CLI ${NUMBER}, no pwsh on PATH: ${line}`);
});

test("a pwsh.exe on PATH is started instead, with -NoProfile -Command; __PSLockdownPolicy=4 in the environment of the process does not change the language mode", { skip: SKIP, timeout: 900000 }, async (t) => {
  const run = await runs.withPwsh;
  assert.equal(run.r.code, 0, `${run.r.err.slice(0, 400)}`);
  const [line, , , mode] = printed(run.results);
  assert.match(line, /pwsh\.exe"? -NoProfile -Command/i, run.results);
  assert.doesNotMatch(line, /-NonInteractive/, "the pwsh.exe form has no -NonInteractive");
  assert.equal(mode, "FullLanguage", "the switch is read from the machine, not from the environment of a process");
  assert.ok(run.prediction.shell && W.same(run.prediction.shell.path, runs.ps7.file), `the prediction says ${run.prediction.shell && run.prediction.shell.path}`);
  t.diagnostic(`Gemini CLI ${NUMBER}, pwsh.exe on PATH: ${line}; language mode with __PSLockdownPolicy=4: ${mode}`);
});

test("with no PowerShell folder on PATH the tool answers spawn powershell.exe ENOENT, and a pwsh.exe in ProgramFiles is not used", { skip: SKIP, timeout: 900000 }, async (t) => {
  const run = await runs.none;
  // the answer is printed; the process then ends with a libuv assertion (exit code 3221226505, 0xC0000409) on 0.64.0, where it ended with 0 when a PowerShell was found
  assert.ok([0, 3221226505].includes(run.r.code), `exit ${run.r.code}: ${run.r.err.slice(0, 400)}`);
  assert.ok(run.r.result && run.r.result.response === "PROBE-DONE", "the answer was printed");
  assert.match(run.results, /spawn powershell\.exe ENOENT/, run.results);
  assert.equal(printed(run.results).length, 0, "nothing was printed by any shell");
  assert.equal(run.prediction.state, "missing");
  t.diagnostic(`Gemini CLI ${NUMBER}, PowerShell off PATH: ${run.results.replace(/\s+/g, " ").slice(0, 200)}; exit code ${run.r.code}${/Assertion failed: !\(handle->flags & UV_HANDLE_CLOSING\)/.test(run.r.err) ? " after a libuv assertion (src\\win\\async.c)" : ""}`);
});

test("a hook command is run by powershell.exe -NoProfile -NonInteractive -Command with an exit-code check appended; && is a parse error of Windows PowerShell 5.1, shown as a warning, and the tool still runs", { skip: SKIP, timeout: 900000 }, async (t) => {
  const run = await runs.plain;
  const start = run.lines.filter((l) => l.label === "SessionStart");
  const before = run.lines.filter((l) => l.label === "BeforeTool");
  assert.equal(start.length, 1, "SessionStart fired");
  assert.equal(before.length, 1, "BeforeTool fired once for the shell call");
  assert.equal(before[0].input.tool_name, "run_shell_command");
  assert.equal(before[0].input.hook_event_name, "BeforeTool");
  assert.match(before[0].parent.name, /^powershell\.exe$/i);
  assert.ok(W.same(before[0].parent.path, POWERSHELL_51), before[0].parent.path);
  assert.match(before[0].parent.commandLine, /powershell\.exe"? -NoProfile -NonInteractive -Command /i, before[0].parent.commandLine);
  assert.match(before[0].parent.commandLine, /if \(\$LASTEXITCODE -ne 0\) \{ exit \$LASTEXITCODE \}/, before[0].parent.commandLine);
  assert.equal(run.lines.filter((l) => l.label === "ANDAND").length, 0, "the hook with && did not run");
  assert.match(`${run.r.out}\n${run.r.err}`, /not a valid statement separator/, "PowerShell's parser error was shown");
  assert.ok(printed(run.results).length >= 3, "the tool ran");
  t.diagnostic(`parent of a Gemini CLI ${NUMBER} hook: ${before[0].parent.commandLine.slice(0, 200)}`);
});

test("the Gemini CLI install has the native half of node-pty (@lydell/node-pty-win32-x64\\conpty.node), listed as an optional dependency, and says which Node it wants", { skip: SKIP, timeout: 300000 }, async (t) => {
  const sys = makeSys({ env: { Path: [path.dirname(gemini.BIN), ...plainWindowsPath()].join(";") }, cwd: ROOT, home: ROOT });
  const found = findAgents(sys, { agents: ["gemini"] });
  const shim = found.agents.gemini.entries.find((e) => /gemini\.cmd$/i.test(e.path));
  if (!shim || !shim.package) { t.diagnostic(`E2E_GEMINI (${gemini.BIN}) is not an npm shim: node-pty is not read`); return; }
  assert.equal(shim.version, INFO.number, "the version the inventory reads from package.json is the one the binary prints");
  const pkg = JSON.parse(fs.readFileSync(path.join(shim.package.dir, "package.json"), "utf8"));
  assert.ok(pkg.optionalDependencies && Object.keys(pkg.optionalDependencies).some((k) => /@lydell\/node-pty/.test(k)), `optionalDependencies: ${Object.keys(pkg.optionalDependencies || {}).join(", ")}`);
  const pty = ptyOf(sys, shim.package.dir);
  assert.ok(pty.found, `conpty.node was searched in: ${pty.searched.join("; ")}`);
  assert.ok(fs.existsSync(pty.found));
  const wants = nodeWants(found, process.versions.node).find((x) => x.agent === "gemini");
  assert.equal(wants.range, pkg.engines.node);
  t.diagnostic(`Gemini CLI ${NUMBER}: ${pty.found}; engines.node ${pkg.engines.node}`);
});

test("a hook that exits with 2 blocks the tool call, because the command line Gemini CLI builds keeps the exit code; a hook that exits with 1 does not block", { skip: SKIP, timeout: 900000 }, async (t) => {
  const block = await runs.blocks;
  assert.equal(block.lines.filter((l) => l.label === "BeforeTool").length, 1, "the hook ran");
  assert.doesNotMatch(block.results, /RAN-OK/, "the command did not run");
  assert.match(block.results, /blocked-by-hook-stderr/, block.results);
  const fail = await runs.fails;
  assert.equal(fail.lines.filter((l) => l.label === "BeforeTool").length, 1, "the hook ran");
  assert.match(fail.results, /RAN-OK/, `the command ran after a hook that exited with 1: ${fail.results}`);
  t.diagnostic(`Gemini CLI ${NUMBER}: exit 2 gave: ${block.results.replace(/\s+/g, " ").slice(0, 200)}; exit 1: the command ran`);
});
