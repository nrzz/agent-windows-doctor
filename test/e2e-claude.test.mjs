// Checks against the real Claude Code binary (they run only when E2E_CLAUDE names one, and only on Windows): the claims that the Claude explain pages restate, each put to
// the binary through a fake Messages API on 127.0.0.1 (no token is spent) in a throwaway world, behind the guard of test/sandbox.mjs.
// The full table of 129 cases lives in claude-windows-doctor (test/e2e-shell.test.mjs there puts every row to the binary); test/shell-table.mjs holds the same rows and
// test/shell.test.mjs runs all of them against the prediction on a pretend machine. Here one row stands for each claim the explain pages restate (CLAIMS), so a page
// that says "verified" has a run behind it on the Claude Code of this run. test/e2e-live.test.mjs puts the tool's own `check --live` to the binary.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { IS_WIN, put } from "./helpers.mjs";
import { claude, skipReason } from "./agents.mjs";
import { launch } from "./sandbox.mjs";
import { CLAIMS, RESTATED } from "./claude-claims.mjs";
import { EDITIONS, ROWS } from "./shell-table.mjs";
import { envOf, pathDirsOf, rowFiles, settingsOf } from "./table-lib.mjs";
import { makeSys } from "../src/sys.mjs";
import { discoverGitBash } from "../src/gitbash.mjs";
import { effectivePolicy, parseExecutionPolicy } from "../src/facts.mjs";
import { loadSettingsFiles, shellFacts } from "../src/claude-settings.mjs";
import { FIXED_BASH, checkBashValue, expectedTools, predictShell } from "../src/claude-shell.mjs";
import * as W from "../src/winpath.mjs";

const SKIP = IS_WIN ? await skipReason(claude) : "the Claude Code checks of Windows run on Windows only";
const NUMBER = SKIP ? "" : (await claude.info()).number;
const fwd = (p) => String(p).replace(/\\/g, "/");
const root = process.env.SystemRoot || "C:\\Windows";
const SYSTEM_PATH = [path.win32.join(root, "System32"), root, path.win32.join(root, "System32", "Wbem")].join(";");
const HAS_DEFAULT_GIT = IS_WIN && FIXED_BASH.some((p) => fs.existsSync(p));
const pf = process.env.ProgramW6432 || process.env.ProgramFiles || "C:\\Program Files";
const HAS_DEFAULT_PWSH = IS_WIN && fs.existsSync(path.win32.join(pf, "PowerShell", "7", "pwsh.exe"));
// a Git Bash for the runs that use the Bash tool: this machine's
const GIT = (() => {
  if (!IS_WIN) return null;
  const fixed = FIXED_BASH.find((p) => fs.existsSync(p));
  if (fixed) return fixed;
  const found = discoverGitBash(makeSys(), { cwd: process.cwd() });
  return found.length ? found[0].path : null;
})();
const SHELLS = { CLAUDE_CODE_GIT_BASH_PATH: GIT ? fwd(GIT) : "C:/nonexistent/bash.exe", CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" };


/** Builds a row on the real disk and returns what the run needs. */
function build(row, label) {
  const sb = claude.sandbox(label);
  const ctx = { root: fwd(path.join(sb.root, "layouts")), work: fwd(sb.work) };
  const { files, dirs } = rowFiles(row, ctx);
  for (const d of dirs) fs.mkdirSync(d, { recursive: true });
  for (const f of files) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  const s = settingsOf(row, ctx);
  if (s.user) put(sb.settings, s.user);
  if (s.project) put(path.join(sb.work, ".claude", "settings.json"), s.project);
  if (s.local) put(path.join(sb.work, ".claude", "settings.local.json"), s.local);
  const env = envOf(row, ctx);
  env.Path = [...pathDirsOf(row, ctx), SYSTEM_PATH].join(";");
  return { sb, ctx, env };
}

const logOf = (file) => { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } };

/** One run of `claude -p` with no tool call: the tools of the first request, the exit code, what the debug log says about Git Bash. */
async function probe(sb, env, { args = [] } = {}) {
  const api = await claude.fake([]);
  try {
    const r = await claude.run(sb, api, { env, args, timeout: 150000 });
    const main = api.main();
    const tools = main && main.tools ? main.tools.map((t) => t.name) : [];
    const ps = main && main.tools ? main.tools.find((t) => t.name === "PowerShell") : null;
    const log = logOf(sb.debug);
    return {
      r, api, tools, request: main, requests: api.requests.length,
      shellTools: tools.filter((n) => n === "Bash" || n === "PowerShell"),
      edition: ps ? (/PowerShell edition: ([^\n]*)/.exec(ps.description) || [])[1] || null : null,
      using: (/Using bash path: "([^"]*)"/.exec(log) || [])[1] || null,
      warning: (/CLAUDE_CODE_GIT_BASH_PATH "[^\n]*falling back to auto-detection/.exec(log) || [])[0] || null,
      notFound: /Git Bash not found; BashTool will be unavailable/.test(log),
    };
  } finally { await api.close(); }
}

/** What predictShell says for the environment a run had (the real machine, read through the real `sys`). */
function predictOn(sb, runEnv) {
  const sys = makeSys({ env: { ...runEnv }, cwd: sb.work, home: runEnv.USERPROFILE || sb.home });
  const settings = loadSettingsFiles(sys, { project: sb.work, registry: false });
  return predictShell(sys, { cwd: sb.work, facts: shellFacts(settings) });
}

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  }));
  return results;
}

const applies = (row) => !row.defaultGit || (row.defaultGit === "present") === HAS_DEFAULT_GIT;

test("every claim that a Claude page restates as verified has a row in the table, and the table has every row it is held to", () => {
  const ids = new Set(ROWS.map((r) => r.id));
  for (const [claim, rows] of Object.entries(CLAIMS)) {
    assert.ok(rows.length >= 1, claim);
    for (const id of rows) assert.ok(ids.has(id), `${claim} names the row ${id}, which is not in test/shell-table.mjs`);
  }
  assert.ok(RESTATED.length >= 30, `${RESTATED.length} rows`);
  assert.equal(ROWS.length >= 129, true, `${ROWS.length} rows in the table`);
});

test("the restated rows: the binary lists the tools the table records, exits as it records, and took the bash.exe that the prediction names", { skip: SKIP, timeout: 1200000 }, async (t) => {
  const rows = ROWS.filter((r) => RESTATED.includes(r.id)).filter(applies);
  const outcomes = await pool(rows, 4, async (row) => {
    const { sb, env } = build(row, row.id.slice(0, 18));
    const run = await probe(sb, env);
    return { row, run, prediction: predictOn(sb, run.r.env) };
  });
  const failures = [];
  for (const { row, run, prediction } of outcomes) {
    const said = `${row.id}: ${row.about}`;
    const exit = run.r.code === 0 ? 0 : 1;
    if (exit !== row.expect.exit) failures.push(`${said}: exit ${run.r.code}, the table says ${row.expect.exit} (${run.r.err.trim().split("\n")[0]})`);
    if (JSON.stringify(run.shellTools) !== JSON.stringify(row.expect.tools)) failures.push(`${said}: the first request lists ${JSON.stringify(run.shellTools)}, the table says ${JSON.stringify(row.expect.tools)}`);
    if (JSON.stringify(expectedTools(prediction)) !== JSON.stringify(run.shellTools)) failures.push(`${said}: predictShell says ${JSON.stringify(expectedTools(prediction))}, the binary listed ${JSON.stringify(run.shellTools)}`);
    if ((prediction.fatal ? 1 : 0) !== exit) failures.push(`${said}: predictShell says exit ${prediction.fatal ? 1 : 0}, the binary exited ${run.r.code}`);
    if (run.r.code === 0) {
      if (prediction.gitBash.path) {
        if (!run.using || !W.same(run.using, prediction.gitBash.path)) failures.push(`${said}: the binary took ${run.using}, the prediction says ${prediction.gitBash.path}`);
      } else if (run.using) failures.push(`${said}: the binary took ${run.using}, the prediction found no Git Bash`);
      const step = prediction.gitBash.trail.find((s) => s.step === "variable");
      if (step && (step.state === "not-found" || step.state === "not-bash")) {
        const want = step.state === "not-found" ? "not found; falling back to auto-detection" : "is not a bash/sh binary; falling back to auto-detection";
        if (!run.warning || !run.warning.endsWith(want)) failures.push(`${said}: the debug log says ${JSON.stringify(run.warning)}, the prediction says the value ${step.state}`);
      } else if (step && step.state !== "valid" && run.warning) failures.push(`${said}: the binary warned about a variable that is ${step.state}: ${run.warning}`);
    }
  }
  t.diagnostic(`${rows.length} rows (of ${RESTATED.length} that stand for a claim, ${ROWS.length} in the table) on Claude Code ${NUMBER}${HAS_DEFAULT_GIT ? " (Git at C:\\Program Files\\Git)" : " (no Git at C:\\Program Files\\Git)"}`);
  assert.deepEqual(failures, []);
});

test("the PowerShell tool's edition: the binary and the prediction agree for a pwsh on PATH, in ProgramW6432's PowerShell\\7, in .dotnet\\tools, and for Windows PowerShell", { skip: SKIP, timeout: 600000 }, async (t) => {
  const failures = [];
  for (const e of EDITIONS) {
    const row = { layouts: [], projectFiles: [], settings: {}, files: e.files, env: { ...(e.env || {}), CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, path: e.path || [] };
    const { sb, env } = build(row, `ed-${e.id}`.slice(0, 18));
    const run = await probe(sb, env);
    const prediction = predictOn(sb, run.r.env);
    if (run.edition !== prediction.powershell.edition) failures.push(`${e.id}: the tool says ${run.edition}, the prediction says ${prediction.powershell.edition}`);
    // a PowerShell 7 that the machine has at ProgramW6432 is found when nothing else is first
    const wants = HAS_DEFAULT_PWSH && !e.core && !(e.env && e.env.ProgramW6432) ? "PowerShell 7+ (pwsh)" : e.edition;
    if (e.id === "default" || e.id === "powershell-on-path") { if (run.edition !== wants) failures.push(`${e.id}: the tool says ${run.edition}, expected ${wants}`); } else if (run.edition !== e.edition) failures.push(`${e.id}: the tool says ${run.edition}, expected ${e.edition}`);
  }
  t.diagnostic(`${EDITIONS.length} editions on Claude Code ${NUMBER}${HAS_DEFAULT_PWSH ? " (PowerShell 7 at ProgramW6432)" : ""}`);
  assert.deepEqual(failures, []);
});

test("defaultShell changes nothing in the request: the same tools, the same size, with each value it can have", { skip: SKIP, timeout: 900000 }, async (t) => {
  const plain = (r) => JSON.stringify(r).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>").replace(/\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(\.\d+)?Z?/g, "<time>").replace(/adw-[A-Za-z0-9_-]+/g, "<tmp>").replace(/\\\\/g, "/");
  const states = {
    "both tools": { layouts: ["g1"], env: { CLAUDE_CODE_GIT_BASH_PATH: "{g1}/bin/bash.exe", CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, applies: true },
    "PowerShell only": { layouts: [], env: {}, applies: !HAS_DEFAULT_GIT },
  };
  let compared = 0;
  for (const [name, state] of Object.entries(states)) {
    if (!state.applies) continue;
    const base = build({ layouts: state.layouts, env: state.env, settings: {} }, "dsh");
    const without = await probe(base.sb, base.env);
    for (const value of ["bash", "powershell", "cmd"]) {
      const withSetting = build({ layouts: state.layouts, env: state.env, settings: { user: { defaultShell: value } } }, "dsh");
      const run = await probe(withSetting.sb, withSetting.env);
      assert.deepEqual(run.shellTools, without.shellTools, `${name}, defaultShell ${value}: the shell tools`);
      assert.deepEqual(run.tools, without.tools, `${name}, ${value}: the tool list`);
      assert.equal(plain(run.request).length, plain(without.request).length, `${name}, defaultShell ${value}: the request has the same size`);
      compared++;
    }
  }
  t.diagnostic(`${compared} runs with defaultShell compared with the same state without it, on Claude Code ${NUMBER}`);
  assert.ok(compared >= 3);
});

test("the Git of this machine, as PATH can put it: the binary and the prediction agree for ...\\Git\\cmd first and for ...\\Git\\mingw64\\bin first", { skip: SKIP, timeout: 600000 }, async (t) => {
  const lines = makeSys().where("git", { cwd: process.cwd() }) || [];
  const roots = new Set();
  for (const l of lines) {
    const m = /^(.*)\\(?:cmd|mingw64\\bin|bin|usr\\bin)\\git\.exe$/i.exec(l);
    if (m && fs.existsSync(path.join(m[1], "bin", "bash.exe"))) roots.add(m[1]);
  }
  const realRoot = [...roots][0];
  if (!realRoot) { t.diagnostic("no Git for Windows found through where.exe: skipped"); return; }
  const cases = [
    { id: "cmd-first", dirs: [path.join(realRoot, "cmd")], found: true },
    { id: "mingw-first", dirs: [path.join(realRoot, "mingw64", "bin"), path.join(realRoot, "cmd")], found: HAS_DEFAULT_GIT },
    { id: "mingw-only", dirs: [path.join(realRoot, "mingw64", "bin")], found: HAS_DEFAULT_GIT },
  ];
  for (const c of cases) {
    const sb = claude.sandbox(`real-${c.id}`.slice(0, 18));
    const run = await probe(sb, { Path: [...c.dirs, SYSTEM_PATH].join(";") });
    const prediction = predictOn(sb, run.r.env);
    assert.deepEqual(run.shellTools, expectedTools(prediction), `${c.id}: the binary and the prediction`);
    assert.equal(run.shellTools.includes("Bash"), c.found, `${c.id}: Git Bash at ${realRoot} is ${c.found ? "" : "not "}found`);
  }
  t.diagnostic(`Git for Windows at ${realRoot}${HAS_DEFAULT_GIT ? " (the default place: found through the fixed path whatever PATH says)" : " (not the default place: found only when git.exe is the first line of where git and sits in a folder one below the root)"} on Claude Code ${NUMBER}`);
});

test("the binary says why: a variable it ignores is named in the debug log with its reason, and a missing Git Bash is named", { skip: SKIP, timeout: 300000 }, async () => {
  const none = build({ layouts: [], env: {}, settings: {} }, "dbg-none");
  const a = await probe(none.sb, none.env);
  if (!HAS_DEFAULT_GIT) { assert.equal(a.notFound, true); assert.equal(a.using, null); } else assert.ok(a.using);
  const bad = build({ layouts: ["g1"], env: { CLAUDE_CODE_GIT_BASH_PATH: "{g1}/git-bash.exe" }, settings: {} }, "dbg-bad");
  const b = await probe(bad.sb, bad.env);
  assert.match(b.warning, /is not a bash\/sh binary; falling back to auto-detection$/);
  const missing = build({ layouts: ["g1"], env: { CLAUDE_CODE_GIT_BASH_PATH: "{g1}/nope/bash.exe" }, settings: {} }, "dbg-missing");
  const c = await probe(missing.sb, missing.env);
  assert.match(c.warning, /not found; falling back to auto-detection$/);
  // the value is checked as written: the check of the tool says the same thing for the same value
  assert.equal(checkBashValue(path.join(bad.sb.root, "layouts", "g1", "git-bash.exe"), makeSys()).state, "not-bash");
});

// ---- what Claude Code does about the platform ----------------------------------------------------------------------------------------

/** The text of every tool result of a run, in the order of the tool calls. */
const resultsOf = (api) => api.results().map((x) => x.text);
async function go(sb, steps, { env = {}, args = [] } = {}) {
  const api = await claude.fake(steps);
  try {
    const r = await claude.run(sb, api, { env: { ...SHELLS, ...env }, args: ["--permission-mode", "bypassPermissions", "--max-turns", "8", ...args], timeout: 200000 });
    return { r, api, results: resultsOf(api) };
  } finally { await api.close(); }
}
const hookFor = (file) => ({ hooks: { SessionStart: [{ hooks: [{ type: "command", shell: "powershell", command: `Get-ExecutionPolicy -List | ForEach-Object { $_.Scope.ToString() + '=' + $_.ExecutionPolicy.ToString() } | Set-Content -Path '${file}'` }] }] } });
const LIST_CMD = "Get-ExecutionPolicy -List | ForEach-Object { $_.Scope.ToString() + '=' + $_.ExecutionPolicy.ToString() }";

test("the execution policy: a PowerShell hook and the PowerShell tool both run with -ExecutionPolicy Bypass at process scope; CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY, in the environment or in the user settings, takes it away", { skip: SKIP, timeout: 900000 }, async (t) => {
  const seen = {};
  for (const [label, env, settings] of [["default", {}, null], ["respect, in the environment", { CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY: "1" }, null], ["respect, in the user settings", {}, { env: { CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY: "1" } }]]) {
    const sb = claude.sandbox("policy");
    const file = path.join(sb.root, "policy.txt");
    put(sb.settings, { ...hookFor(file), ...(settings || {}) });
    const run = await go(sb, [{ tool: "PowerShell", input: { command: LIST_CMD } }], { env });
    assert.equal(run.r.code, 0, run.r.err);
    const hook = parseExecutionPolicy(fs.readFileSync(file, "utf8"));
    const tool = parseExecutionPolicy(run.results[0]);
    assert.equal(hook.length, 5, `${label}: the hook ran`);
    assert.deepEqual(tool, hook, `${label}: the hook and the tool see the same policies`);
    const atProcess = hook.find((x) => x.scope === "Process").policy;
    seen[label] = atProcess;
    if (label === "default") {
      assert.equal(atProcess, "Bypass");
      assert.equal(effectivePolicy(hook.map((x) => (x.scope === "Process" ? { ...x, policy: "Undefined" } : x))).policy, "Bypass");
    } else {
      assert.equal(atProcess, "Undefined", `${label}: no bypass`);
      assert.equal(effectivePolicy(hook, { respect: true }).scope === "Process", false);
    }
  }
  t.diagnostic(`Process scope seen by a hook and by the PowerShell tool on Claude Code ${NUMBER}: ${JSON.stringify(seen)}`);
});

test("line endings: the Write tool wrote a new file with LF only, and the Edit tool kept the CRLF of a file it changed", { skip: SKIP, timeout: 300000 }, async () => {
  const sb = claude.sandbox("eol");
  const fresh = path.join(sb.work, "new.txt");
  const old = path.join(sb.work, "crlf.txt");
  fs.writeFileSync(old, "alpha\r\nbeta\r\ngamma\r\n");
  const run = await go(sb, [
    { tool: "Write", input: { file_path: fresh, content: "one\ntwo\nthree\n" } },
    { tool: "Read", input: { file_path: old } },
    { tool: "Edit", input: { file_path: old, old_string: "beta", new_string: "BETA" } },
  ]);
  assert.equal(run.r.code, 0, run.r.err);
  assert.equal(fs.readFileSync(fresh, "latin1"), "one\ntwo\nthree\n");
  assert.equal(fs.readFileSync(old, "latin1"), "alpha\r\nBETA\r\ngamma\r\n");
});

test("the code page: cmd.exe /c dir through the Bash tool prints replacement characters when the console is not UTF-8, and through the PowerShell tool it is right (65001)", { skip: SKIP || (!GIT && "no Git Bash on this machine"), timeout: 300000 }, async (t) => {
  const sb = claude.sandbox("cp");
  fs.writeFileSync(path.join(sb.work, "caf\u00e9-\u00fcber.txt"), "x");
  const run = await go(sb, [
    { shell: "MSYS_NO_PATHCONV=1 cmd.exe /c chcp" },
    { shell: "MSYS_NO_PATHCONV=1 cmd.exe /c dir /b" },
    { shell: "ls" },
  ]);
  assert.equal(run.r.code, 0, run.r.err);
  const [bashChcp, bashDir, bashLs] = run.results;
  const page = Number(/(\d{3,5})\s*$/m.exec(bashChcp)[1]);
  assert.match(bashLs, /caf\u00e9-\u00fcber\.txt/, "a Git program prints UTF-8");
  if (page !== 65001) { assert.ok(bashDir.includes("\ufffd"), "a console that is not UTF-8: replacement characters"); assert.ok(!bashDir.includes("caf\u00e9")); } else assert.match(bashDir, /caf\u00e9-\u00fcber\.txt/);
  // the PowerShell tool, in a run of its own (the first shell tool of a request is Bash when Git Bash is found)
  const sb2 = claude.sandbox("cp2");
  fs.writeFileSync(path.join(sb2.work, "caf\u00e9-\u00fcber.txt"), "x");
  const ps = await go(sb2, [{ tool: "PowerShell", input: { command: "cmd.exe /c dir /b" } }, { tool: "PowerShell", input: { command: "cmd.exe /c chcp" } }]);
  assert.equal(ps.r.code, 0, ps.r.err);
  const [psDir, psChcp] = ps.results;
  assert.match(psDir, /caf\u00e9-\u00fcber\.txt/, "the PowerShell tool prints the file name right");
  assert.equal(Number(/(\d{3,5})\s*$/m.exec(psChcp)[1]), 65001, "the PowerShell tool sets UTF-8");
  t.diagnostic(`code page seen by the Bash tool: ${page}; by the PowerShell tool: 65001; Bash cmd /c dir printed ${JSON.stringify(bashDir.trim())}, on Claude Code ${NUMBER}`);
});

test("long paths: the Write tool wrote a file at a path of more than 300 characters", { skip: SKIP, timeout: 300000 }, async (t) => {
  const sb = claude.sandbox("long");
  const deep = path.join(sb.work, ...Array.from({ length: 6 }, (_, i) => `a-rather-long-directory-name-number-${i}-padding-padding`));
  const file = path.join(deep, "file.txt");
  assert.ok(file.length > 300, `${file.length} characters`);
  const run = await go(sb, [{ tool: "Write", input: { file_path: file, content: "hello\n" } }]);
  assert.equal(run.r.code, 0, run.r.err);
  assert.match(run.results[0], /File created successfully/);
  assert.equal(fs.readFileSync(`\\\\?\\${file}`, "utf8"), "hello\n");
  t.diagnostic(`a path of ${file.length} characters was written on Claude Code ${NUMBER}`);
});

test("with no Git Bash and the PowerShell tool off, Claude Code stops at start and says so in these words", { skip: SKIP || (GIT && FIXED_BASH.some((p) => fs.existsSync(p)) && "Git at C:\\Program Files\\Git is found whatever the variable says"), timeout: 120000 }, async () => {
  const sb = claude.sandbox("stop");
  const api = await claude.fake([]);
  try {
    const r = await claude.run(sb, api, { env: { Path: [path.join(root, "System32"), root].join(";"), CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" }, timeout: 100000 });
    assert.equal(r.code, 1);
    assert.equal(api.requests.length, 0, "no request");
    assert.match(r.err, /Claude Code on Windows requires a shell tool\. Git Bash was not found and the PowerShell tool is disabled \(CLAUDE_CODE_USE_POWERSHELL_TOOL=0\)\./);
    assert.match(r.err, /Install Git for Windows/);
    assert.match(r.err, /Remove CLAUDE_CODE_USE_POWERSHELL_TOOL from your environment or settings/);
  } finally { await api.close(); }
});

test("the PowerShell tool's description says which edition it runs, and what the model may use there", { skip: SKIP, timeout: 300000 }, async () => {
  const sb = claude.sandbox("edition");
  const run = await probe(sb, { Path: [path.join(root, "System32"), root].join(";"), CLAUDE_CODE_USE_POWERSHELL_TOOL: "1", CLAUDE_CODE_GIT_BASH_PATH: SHELLS.CLAUDE_CODE_GIT_BASH_PATH });
  assert.equal(run.r.code, 0, run.r.err);
  const tool = run.request.tools.find((x) => x.name === "PowerShell");
  if (/Windows PowerShell 5\.1/.test(run.edition)) assert.match(tool.description, /Pipeline chain operators `&&` and `\|\|` are NOT available/);
  else { assert.match(run.edition, /^PowerShell 7\+ \(pwsh\)$/); assert.match(tool.description, /Pipeline chain operators `&&` and `\|\|` ARE available/); }
});

test("claude doctor, in a throwaway world: a native install whose folder is not on PATH is said so, and feature flags are said to be off with the variables of the oracle", { skip: SKIP, timeout: 300000 }, async (t) => {
  const sb = claude.sandbox("doctor");
  const r = await launch(sb, claude.BIN, ["doctor"], { env: { DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", NO_COLOR: "1", ANTHROPIC_API_KEY: "sk-ant-probe" }, cwd: sb.work, timeout: 180000 });
  const text = `${r.out}${r.err}`.replace(/\x1b\[[0-9;]*m/g, "");
  t.diagnostic(`claude doctor on ${NUMBER}: ${text.split("\n").filter((l) => /PATH|Feature-flag|flag/i.test(l)).map((l) => l.trim()).join(" | ")}`);
  assert.equal(r.code, 0, text);
  assert.match(text, /Feature-flag evaluation disabled \(disabled by CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC\)/);
  // it reports the install and the settings, and says nothing of which shell the model gets
  assert.doesNotMatch(text, /\b(shell|powershell|pwsh|bash)\b/i, "claude doctor names no shell");
  // only an install that is not from npm (the desktop app's bundle, the native installer) has a folder that doctor wants on PATH
  if (/^Running: npm/m.test(text)) assert.doesNotMatch(text, /not in your PATH/i, "an npm install has no such line");
  else assert.match(text, /Native installation exists but .* is not in your PATH/i);
});

test("the npm package of Claude Code: the inventory reads the version, the Node it asks for and the program of its bin from package.json, and the binary prints the same version", { skip: SKIP, timeout: 120000 }, async (t) => {
  const { resolveBin } = await import("./sandbox.mjs");
  const { findAgents } = await import("../src/inventory.mjs");
  const { nodeWants } = await import("../src/agentfacts.mjs");
  const shimPath = resolveBin(process.env.E2E_CLAUDE || "");
  if (!/\.cmd$/i.test(shimPath)) { t.diagnostic(`E2E_CLAUDE (${shimPath}) is not an npm shim: its package is not read`); return; }
  const sys = makeSys({ env: { Path: [path.dirname(shimPath), SYSTEM_PATH].join(";") }, cwd: path.dirname(shimPath), home: path.dirname(shimPath) });
  const found = findAgents(sys, { agents: ["claude"] });
  const shim = found.agents.claude.entries.find((e) => /claude\.cmd$/i.test(e.path));
  assert.ok(shim && shim.package, "the shim and its package are found");
  assert.equal(shim.package.name, "@anthropic-ai/claude-code");
  assert.equal(shim.version, NUMBER, "the version the inventory reads from package.json is the one the binary prints");
  assert.ok(shim.program && /claude\.exe$/i.test(shim.program) && fs.existsSync(shim.program), `the bin is a program: ${shim.program}`);
  const wants = nodeWants(found, process.versions.node).find((x) => x.agent === "claude");
  assert.match(wants.range, /^>=\d+/);
  t.diagnostic(`Claude Code ${NUMBER}: engines.node ${wants.range}; the shim leads to ${shim.program}`);
});
