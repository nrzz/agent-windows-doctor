// Checks against the real Codex CLI (they run only when E2E_CODEX names one, and only on Windows): which shell it starts for the model's commands and how it finds it, what it does with
// windows.shell_path and the other keys that name a shell, what a hook is run with and what a failing hook does, the hook trust, the Windows sandbox it selects, and what `codex --version`
// prints against what the npm install says. A fake Responses API answers on 127.0.0.1 (no token is spent); every run has a throwaway CODEX_HOME, HOME and USERPROFILE behind the guard of
// test/sandbox.mjs. A stand-in for PowerShell 7 is a copy of powershell.exe named pwsh.exe.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { IS_WIN, ROOT, put, tmpDir } from "./helpers.mjs";
import { codex, skipReason } from "./agents.mjs";
import { launch, plainWindowsPath } from "./sandbox.mjs";
import { makeSys } from "../src/sys.mjs";
import { collectMachine } from "../src/machine.mjs";
import { shellFor } from "../src/shells.mjs";
import { CODEX_FIXED } from "../src/psprobe.mjs";
import { codexOnWindows, readCodexLayers, readSandboxLog } from "../src/codexwin.mjs";
import { findAgents } from "../src/inventory.mjs";
import * as W from "../src/winpath.mjs";

const SKIP = IS_WIN ? await skipReason(codex) : "the Codex checks of Windows run on Windows only";
const INFO = SKIP ? null : await codex.info();
const NUMBER = INFO ? INFO.number : "";
const HOOK = path.join(ROOT, "test", "record-hook.mjs").replace(/\\/g, "/");
const SYSTEM = process.env.SystemRoot || "C:\\Windows";
const POWERSHELL_51 = path.win32.join(SYSTEM, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

/** A copy of powershell.exe under another name, in a folder of its own: it stands in for PowerShell 7. */
function standIn(name = "pwsh.exe") {
  const dir = tmpDir("adw-ps7-");
  fs.copyFileSync(POWERSHELL_51, path.join(dir, name));
  return { dir, file: path.join(dir, name) };
}
/** The program a command line starts: `"C:\a b\x.exe" -Command y` or `C:\a\x.exe -Command y`. */
const programOf = (line) => { const t = String(line || "").trim(); if (t.startsWith('"')) return t.slice(1, t.indexOf('"', 1)); return (/^(\S+)/.exec(t) || [])[1] || null; };
const commandsOf = (events) => events.filter((e) => e.type === "item.completed" && e.item && e.item.type === "command_execution").map((e) => e.item);
const stderrOf = (r) => r.err.split(/\r?\n/).filter((l) => l && !/WARNING: proceeding|Reading additional/.test(l)).join(" | ");
const TOML_HOOK = (event, command, extra = "", key = "command") => `[[hooks.${event}]]\nmatcher = "*"\n[[hooks.${event}.hooks]]\ntype = "command"\n${key} = ${JSON.stringify(command)}\ntimeout = 30\n${extra}\n`;

/** One `codex exec` that asks the shell to echo: { sb, api, r, command (the first command_execution item), prediction }. */
async function shellRun(label, { top = "", tables = "", env = {}, pathOpts, args = [], steps = [{ shell: "echo PROBE-SHELL" }], prep } = {}) {
  const sb = codex.sandbox(label);
  if (prep) prep(sb);
  const api = await codex.fake(steps);
  try {
    codex.writeConfig(sb, api, { top, tables });
    const r = await codex.run(sb, api, { args, env, path: pathOpts, timeout: 150000 });
    const items = commandsOf(r.events);
    const sys = makeSys({ env: { ...r.env }, cwd: sb.work, home: sb.home });
    const machine = collectMachine(sys, { cwd: sb.work, probe: false });
    return { sb, api, r, items, command: items.length ? items[0].command : null, program: items.length ? programOf(items[0].command) : null, prediction: shellFor("codex", { machine }), results: api.results().map((x) => x.text).join("\n") };
  } finally { await api.close(); }
}

test("codex --version prints codex-cli and the number of the npm package; the shim leads to the program the inventory names", { skip: SKIP, timeout: 300000 }, async (t) => {
  assert.match(INFO.version, /^codex-cli \d+\.\d+\.\d+/);
  const bin = codex.BIN;
  const sys = makeSys({ env: { Path: [path.dirname(bin), ...plainWindowsPath()].join(";") }, cwd: ROOT, home: ROOT });
  const found = findAgents(sys, { agents: ["codex"] }).agents.codex;
  const shim = found.entries.find((e) => /codex\.cmd$/i.test(e.path));
  if (!shim) { t.diagnostic(`E2E_CODEX (${bin}) is not an npm shim: the shim chain is not read`); return; }
  assert.equal(shim.version, INFO.number, "the version the inventory reads from package.json is the one the binary prints");
  assert.ok(shim.program && fs.existsSync(shim.program), `the shim leads to a program that exists: ${shim.program}`);
  assert.match(shim.program, /@openai[\\/]codex-win32-x64[\\/]vendor[\\/].*codex\.exe$/i);
  assert.equal(shim.runsFirst, true);
  assert.ok(shim.leadsTo.length >= 1, "the chain has a step");
  const sb = codex.sandbox("version");
  const direct = await launch(sb, shim.program, ["--version"], { cwd: sb.work, timeout: 60000 });
  assert.equal(direct.code, 0, direct.err);
  assert.equal(direct.out.trim(), INFO.version, "the vendored program prints the same");
  // the two paths that the order of the shell ends in (src/shells.mjs, the README's table) are text in the program, once each
  const program = fs.readFileSync(shim.program);
  for (const p of Object.values(CODEX_FIXED)) {
    let n = 0, at = -1;
    while ((at = program.indexOf(p, at + 1, "latin1")) >= 0) n++;
    assert.equal(n, 1, `${p} occurs ${n} times in ${shim.program}`);
  }
  t.diagnostic(`codex --version: ${INFO.version}; the shim ${shim.path} leads through ${shim.leadsTo.join(" -> ")} to ${shim.program}`);
});

const FIXED_PS7 = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
// the PowerShell 7 that Codex has written into it as the second place to look; the machine this was written on has none, the windows-latest runner has one
const HAS_FIXED_PS7 = IS_WIN && fs.existsSync(FIXED_PS7);

test("the shell of the model's commands: pwsh on PATH, then the PowerShell 7 of Program Files, then powershell on PATH, then the Windows PowerShell 5.1 of System32, each started by its full path, and the prediction says the same", { skip: SKIP, timeout: 1200000 }, async (t) => {
  const ps7 = standIn();
  const both = standIn("pwsh.exe");
  fs.copyFileSync(POWERSHELL_51, path.join(both.dir, "powershell.exe"));
  const ps5 = standIn("powershell.exe");
  const pf = tmpDir("adw-pf-");
  fs.mkdirSync(path.join(pf, "PowerShell", "7"), { recursive: true });
  fs.copyFileSync(POWERSHELL_51, path.join(pf, "PowerShell", "7", "pwsh.exe"));
  const noPsFolder = [path.win32.join(SYSTEM, "System32"), SYSTEM, path.dirname(process.execPath)];
  // with no pwsh.exe on PATH, a machine that has the PowerShell 7 of Program Files gets that one, whatever PATH lists; one that has not gets the first powershell.exe on PATH, and with none the path written into Codex
  const fallback = HAS_FIXED_PS7 ? FIXED_PS7 : POWERSHELL_51;
  const rows = [
    { id: "no pwsh.exe on PATH", pathOpts: { only: plainWindowsPath() }, expect: fallback },
    { id: "a pwsh.exe on PATH (a stand-in)", pathOpts: { only: plainWindowsPath(), first: [ps7.dir] }, expect: ps7.file },
    { id: "a pwsh.exe and a powershell.exe in one folder first on PATH", pathOpts: { only: plainWindowsPath(), first: [both.dir] }, expect: both.file },
    { id: "a powershell.exe (a copy) first on PATH, no pwsh.exe", pathOpts: { only: plainWindowsPath(), first: [ps5.dir] }, expect: HAS_FIXED_PS7 ? FIXED_PS7 : ps5.file },
    { id: "a pwsh.exe only in a ProgramFiles folder that ProgramFiles and ProgramW6432 name", pathOpts: { only: plainWindowsPath() }, env: { ProgramFiles: pf, ProgramW6432: pf }, expect: fallback },
    { id: "the PowerShell folder off PATH", pathOpts: { only: noPsFolder }, expect: fallback },
    { id: "a pwsh.exe in the project folder", pathOpts: { only: plainWindowsPath() }, prep: (sb) => fs.copyFileSync(POWERSHELL_51, path.join(sb.work, "pwsh.exe")), expect: fallback },
  ];
  for (const row of rows) {
    const run = await shellRun("shell", { pathOpts: row.pathOpts, env: row.env || {}, prep: row.prep });
    assert.equal(run.r.code, 0, `${row.id}: ${stderrOf(run.r)}`);
    assert.ok(run.command, `${row.id}: Codex ran the command`);
    assert.ok(W.same(run.program, row.expect), `${row.id}: Codex started ${run.program}, expected ${row.expect}`);
    assert.match(run.command, /^"[^"]+" -Command '/, `${row.id}: ${run.command}`);
    assert.ok(run.prediction.shell && W.same(run.prediction.shell.path, run.program), `${row.id}: the prediction says ${run.prediction.shell && run.prediction.shell.path}`);
    assert.match(run.items[0].aggregated_output, /PROBE-SHELL/);
  }
  t.diagnostic(`${rows.length} rows on Codex CLI ${NUMBER}, ${HAS_FIXED_PS7 ? "with" : "without"} a PowerShell 7 in C:\\Program Files: ${rows.map((r) => r.id).join("; ")}`);
});

test("windows.shell_path and the other keys that would name a shell are not keys: --strict-config stops with unknown configuration field, and without it the command runs in PowerShell all the same", { skip: SKIP, timeout: 900000 }, async (t) => {
  const keys = [
    { id: "windows.shell_path", tables: '[windows]\nshell_path = "C:/Windows/System32/cmd.exe"\n', name: "windows.shell_path" },
    { id: "windows.shell", tables: '[windows]\nshell = "cmd"\n', name: "windows.shell" },
    { id: "windows.default_shell", tables: '[windows]\ndefault_shell = "cmd"\n', name: "windows.default_shell" },
    { id: "shell", top: 'shell = "cmd"\n', name: "shell" },
  ];
  for (const k of keys) {
    const strict = await shellRun("strict", { top: k.top || "", tables: k.tables || "", args: ["--strict-config"] });
    assert.notEqual(strict.r.code, 0, `${k.id}: --strict-config stops`);
    assert.match(strict.r.err, new RegExp(`unknown configuration field .?${k.name.replace(".", "\\.")}`), `${k.id}: ${stderrOf(strict.r)}`);
    assert.equal(strict.items.length, 0, `${k.id}: no command ran`);
    const loose = await shellRun("loose", { top: k.top || "", tables: k.tables || "" });
    assert.equal(loose.r.code, 0, `${k.id}: ${stderrOf(loose.r)}`);
    assert.ok(loose.program && /powershell\.exe$|pwsh\.exe$/i.test(loose.program), `${k.id}: ran ${loose.command}`);
  }
  // the flag form of the same key
  const flag = await shellRun("flag", { args: ["--strict-config", "-c", "windows.shell_path=C:/Windows/System32/cmd.exe"] });
  assert.notEqual(flag.r.code, 0);
  assert.match(flag.r.err, /unknown configuration field .?windows\.shell_path/);
  // a key that does exist is a feature flag, not a shell
  const feature = await shellRun("feature", { tables: "[features]\npowershell_shell_version = true\n", args: ["--strict-config"] });
  t.diagnostic(`windows.shell_path under --strict-config on Codex CLI ${NUMBER}: ${stderrOf(flag.r).slice(0, 160)}; features.powershell_shell_version: exit ${feature.r.code}`);
});

// ---- hooks ---------------------------------------------------------------------------------------------------------------------------

const CASES = {
  exit2: { stdout: "", stderr: "blocked-by-hook-stderr", exit: 2 },
  exit1: { stdout: "", stderr: "failed-hook", exit: 1 },
  deny: { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "denied-by-json" } }), exit: 0 },
  denyold: { stdout: JSON.stringify({ decision: "block", reason: "blocked-by-old-json" }), exit: 0 },
};

/** A run with a PreToolUse hook that behaves as case `name`; the model asks for `echo CASE-<name> RAN-OK`. */
async function hookRun(name, { command, key = "command", extra = "", bypass = true, label = "hook", pathOpts, env = {}, parent = false } = {}) {
  const sb = codex.sandbox(label);
  const log = path.join(sb.base, "hook.jsonl");
  const casesFile = path.join(sb.base, "cases.json");
  put(casesFile, CASES);
  const api = await codex.fake([{ shell: `echo CASE-${name} RAN-OK` }]);
  try {
    codex.writeConfig(sb, api, { tables: TOML_HOOK("PreToolUse", command || `node "${HOOK}" PreToolUse act`, extra, key) });
    const r = await codex.run(sb, api, { args: bypass ? ["--dangerously-bypass-hook-trust"] : [], env: { ADW_LOG: log, ADW_CASES: casesFile, ...(parent ? { ADW_PARENT: "1" } : {}), ...env }, path: pathOpts, timeout: 150000 });
    const lines = fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    const items = commandsOf(r.events);
    return { sb, r, api, lines, items, ran: items.some((i) => /RAN-OK/.test(i.aggregated_output || "")), results: api.results().map((x) => x.text).join("\n") };
  } finally { await api.close(); }
}

test("a hook that exits with 2 or 1 does not stop the command on Windows, a hook that prints a deny does; the model gets the reason", { skip: SKIP, timeout: 900000 }, async (t) => {
  const out = {};
  for (const name of ["exit2", "exit1", "deny", "denyold"]) {
    const run = await hookRun(name, { label: `hook-${name}`.slice(0, 20), command: `node "${HOOK}" PreToolUse act` });
    assert.equal(run.r.code, 0, `${name}: ${stderrOf(run.r)}`);
    assert.equal(run.lines.length, 1, `${name}: the hook ran once`);
    assert.equal(run.lines[0].input.tool_name, "Bash");
    assert.equal(run.lines[0].input.hook_event_name, "PreToolUse");
    out[name] = run.ran;
    if (name === "exit2" || name === "exit1") assert.equal(run.ran, true, `${name}: the command ran, so the hook did not stop it`);
    else {
      assert.equal(run.ran, false, `${name}: the command did not run`);
      assert.match(run.results, /Command blocked by PreToolUse hook: (denied-by-json|blocked-by-old-json)/, `${name}: ${run.results}`);
    }
  }
  t.diagnostic(`the command ran after: ${JSON.stringify(out)} on Codex CLI ${NUMBER}`);
});

test("command_windows and commandWindows replace command on Windows; hooks.json in CODEX_HOME is read the same way", { skip: SKIP, timeout: 600000 }, async () => {
  for (const key of ["command_windows", "commandWindows"]) {
    const sb = codex.sandbox("cmdwin");
    const log = path.join(sb.base, "hook.jsonl");
    const api = await codex.fake([{ shell: "echo hi" }]);
    try {
      codex.writeConfig(sb, api, { tables: `[[hooks.PreToolUse]]\nmatcher = "*"\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = ${JSON.stringify(`node "${HOOK}" POSIXCMD`)}\n${key} = ${JSON.stringify(`node "${HOOK}" WINDOWSCMD`)}\ntimeout = 30\n` });
      const r = await codex.run(sb, api, { args: ["--dangerously-bypass-hook-trust", "--strict-config"], env: { ADW_LOG: log } });
      assert.equal(r.code, 0, `${key}: ${stderrOf(r)}`);
      const lines = fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
      assert.deepEqual(lines.map((l) => l.argv[0]), ["WINDOWSCMD"], `${key} replaced command`);
    } finally { await api.close(); }
  }
  const sb = codex.sandbox("hooksjson");
  const log = path.join(sb.base, "hook.jsonl");
  const api = await codex.fake([{ shell: "echo hi" }]);
  try {
    codex.writeConfig(sb, api, {});
    put(path.join(sb.codex, "hooks.json"), { hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: `node "${HOOK}" JSONFILE`, timeout: 30 }] }] } });
    const r = await codex.run(sb, api, { args: ["--dangerously-bypass-hook-trust"], env: { ADW_LOG: log } });
    assert.equal(r.code, 0, stderrOf(r));
    assert.deepEqual(fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).argv[0]), ["JSONFILE"]);
  } finally { await api.close(); }
});

test("a hook is run by the PowerShell that runs the model's commands, as powershell.exe -NoProfile -Command, and a bash line with && does not run", { skip: SKIP, timeout: 600000 }, async (t) => {
  const plain = await hookRun("none", { label: "hook-parent", parent: true, pathOpts: { only: plainWindowsPath() }, command: `node "${HOOK}" PreToolUse` });
  assert.equal(plain.r.code, 0, stderrOf(plain.r));
  assert.equal(plain.lines.length, 1);
  assert.ok(plain.items.length >= 1, "the guarded command ran");
  const parent = plain.lines[0].parent;
  assert.match(parent.name, /^(powershell|pwsh)\.exe$/i);
  assert.ok(W.same(parent.path, programOf(plain.items[0].command)), `the hook's parent is ${parent.path}; the shell tool's PowerShell is ${programOf(plain.items[0].command)}`);
  assert.match(parent.commandLine, /(powershell|pwsh)\.exe"? -NoProfile -Command /i, parent.commandLine);
  // && is not a statement separator of Windows PowerShell 5.1: the hook does not run, and the command it guarded does. (PowerShell 7 has &&: the line is a Windows PowerShell 5.1 test.)
  const only51 = !HAS_FIXED_PS7;
  const andand = await hookRun("none", { label: "hook-andand", pathOpts: { only: plainWindowsPath() }, command: `node "${HOOK}" PreToolUse && echo done` });
  assert.equal(andand.lines.length, only51 ? 0 : 1, only51 ? "the hook did not run" : "PowerShell 7 reads &&, so the hook ran");
  assert.equal(andand.ran, true, "the command it guarded ran");
  // a pwsh.exe on PATH runs the hook instead (a stand-in)
  const ps7 = standIn();
  const withPwsh = await hookRun("none", { label: "hook-pwsh", parent: true, pathOpts: { only: plainWindowsPath(), first: [ps7.dir] }, command: `node "${HOOK}" PreToolUse` });
  assert.equal(withPwsh.lines.length, 1);
  assert.ok(W.same(withPwsh.lines[0].parent.path, ps7.file), `the parent is ${withPwsh.lines[0].parent.path}, the stand-in is ${ps7.file}`);
  t.diagnostic(`parent of a hook with pwsh.exe on PATH: ${withPwsh.lines[0].parent.path}; without: ${parent.path}; on Codex CLI ${NUMBER}`);
});

test("a hook runs only after it is trusted: without --dangerously-bypass-hook-trust the hook is skipped and the command runs", { skip: SKIP, timeout: 300000 }, async () => {
  const skipped = await hookRun("none", { label: "hook-trust", bypass: false, command: `node "${HOOK}" PreToolUse` });
  assert.equal(skipped.r.code, 0, stderrOf(skipped.r));
  assert.equal(skipped.lines.length, 0, "the hook did not run");
  assert.equal(skipped.ran, true, "the command ran");
  const trusted = await hookRun("none", { label: "hook-trusted", bypass: true, command: `node "${HOOK}" PreToolUse` });
  assert.equal(trusted.lines.length, 1, "with the flag it ran");
});

// ---- the Windows sandbox -----------------------------------------------------------------------------------------------------------------

test("the Windows sandbox that Codex selects: nothing set selects none and lowers workspace-write to read-only; windows.sandbox or features.prefer_mxc select one; the log and the prediction agree", { skip: SKIP, timeout: 900000 }, async (t) => {
  const MODE = 'sandbox_mode = "workspace-write"\n';
  const cases = [
    { id: "nothing set", tables: "", log: "disabled", header: "read-only", selection: "none" },
    { id: "windows.sandbox = unelevated", tables: '[windows]\nsandbox = "unelevated"\n', log: "unelevated", header: "workspace-write", selection: "unelevated" },
    { id: "features.prefer_mxc = true", tables: "[features]\nprefer_mxc = true\n", log: null, header: null, selection: null },
    { id: "windows.sandbox = mxc", tables: '[windows]\nsandbox = "mxc"\n', log: "mxc", header: null, selection: "mxc" },
  ];
  const seen = [];
  for (const c of cases) {
    const sb = codex.sandbox("sandbox");
    const api = await codex.fake([]);
    try {
      put(sb.config, `model = "gpt-5.5"\nmodel_provider = "fake"\napproval_policy = "never"\n${MODE}\n[model_providers.fake]\nname = "fake"\nbase_url = "http://127.0.0.1:${api.port}/v1"\nenv_key = "FAKE_API_KEY"\nwire_api = "responses"\n\n${c.tables}`);
      const r = await codex.run(sb, api, { json: false, timeout: 150000 });
      const sys = makeSys({ env: { ...r.env }, cwd: sb.work, home: sb.home });
      const log = readSandboxLog(sys, sb.codex);
      const machine = collectMachine(sys, { cwd: sb.work, probe: false });
      const layers = readCodexLayers(sys, { project: sb.work });
      const found = codexOnWindows(sys, { layers, machine, userEnv: null });
      const header = (/^sandbox:\s*(\S+)/m.exec(`${r.out}\n${r.err}`) || [])[1] || null;
      seen.push(`${c.id}: log ${log && log.lastSelection}, MXC ${log && log.mxcAvailable}, header ${header}, tool ${found.sandbox.selection}/${found.sandbox.mode.effective}`);
      assert.ok(log, `${c.id}: the sandbox log was written`);
      assert.equal(typeof log.mxcAvailable, "boolean", `${c.id}: the log says whether MXC is available`);
      // the prediction of this tool, from the configuration, against the line of the log
      const logged = log.lastSelection === "disabled" ? "none" : log.lastSelection;
      assert.equal(found.sandbox.selection, logged, `${c.id}: the tool says ${found.sandbox.selection}, the log says ${log.lastSelection}`);
      if (c.header) assert.equal(header, c.header, `${c.id}: the header`);
      assert.equal(found.sandbox.mode.effective, header, `${c.id}: the tool says the mode is ${found.sandbox.mode.effective}, the header says ${header}`);
      if (c.log) assert.equal(log.lastSelection, c.log, `${c.id}`);
    } finally { await api.close(); }
  }
  t.diagnostic(`on Codex CLI ${NUMBER}: ${seen.join(" | ")}`);
});

test("codex doctor reports the install, the security software and the reachability of the provider, and names no shell", { skip: SKIP, timeout: 300000 }, async (t) => {
  const sb = codex.sandbox("doctor");
  const api = await codex.fake([]);
  try {
    codex.writeConfig(sb, api, {});
    const r = await launch(sb, codex.BIN, ["doctor"], { env: codex.env(sb, api), cwd: sb.work, timeout: 200000 });
    const text = `${r.out}\n${r.err}`;
    assert.ok([0, 1].includes(r.code), text.slice(0, 400));
    assert.match(text, /Codex Doctor v\d+\.\d+\.\d+/);
    assert.match(text, /\binstall\b/);
    assert.doesNotMatch(r.out, /\b(shell|powershell|pwsh|bash)\b/i, "codex doctor names no shell");
    t.diagnostic(`codex doctor ${NUMBER}: exit ${r.code}, ${r.out.split("\n").length} lines, no line names a shell`);
  } finally { await api.close(); }
});
