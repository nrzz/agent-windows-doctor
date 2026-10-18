// The shell prediction, held to the table that the real binary was put to (test/shell-table.mjs), on a pretend Windows machine, so that it
// runs on every system; and the pieces it is made of.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { fakeMachine, gitFiles, SYSTEM_FILES, SYSTEM_PATH } from "./machine.mjs";
import { EDITIONS, ROWS } from "./shell-table.mjs";
import { CTX, fill, machineFor, predictFor } from "./table-lib.mjs";
import { FIXED_BASH, checkBashValue, expectedTools, findGitBash, findPowerShell, parseSwitch, resolveVariable } from "../src/claude-shell.mjs";

const applies = (row, defaultGit) => !row.defaultGit || (row.defaultGit === "present") === defaultGit;

test("the prediction equals what the binary did, in every row of the table, on a machine without Git at C:\\Program Files and on one with it", () => {
  let checked = 0;
  for (const defaultGit of [false, true]) {
    for (const row of ROWS) {
      if (!applies(row, defaultGit)) continue;
      const p = predictFor(machineFor(row, { defaultGit }));
      const where = `${row.id} (default Git ${defaultGit ? "present" : "absent"})`;
      // the account's default is off with a fake API (it has no account): that is what the rows record
      assert.deepEqual(expectedTools(p), row.expect.tools, `${where}: the tools`);
      assert.equal(p.fatal ? 1 : 0, row.expect.exit, `${where}: the exit code`);
      if (row.expect.how !== undefined) assert.equal(p.gitBash.how, row.expect.how, `${where}: how Git Bash was found`);
      checked++;
    }
  }
  assert.ok(checked > ROWS.length, `${checked} runs of ${ROWS.length} rows`);
});

test("the table: ids are unique, a row without a mark on the default Git gives the same answer on both kinds of machine, and the marked rows are the ones that differ", () => {
  const ids = ROWS.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  let marked = 0;
  for (const row of ROWS) {
    const absent = predictFor(machineFor(row, { defaultGit: false }));
    const present = predictFor(machineFor(row, { defaultGit: true }));
    const same = JSON.stringify(expectedTools(absent)) === JSON.stringify(expectedTools(present)) && absent.gitBash.how === present.gitBash.how && Boolean(absent.fatal) === Boolean(present.fatal);
    if (row.defaultGit) marked++;
    else assert.ok(same, `${row.id} differs with Git at C:\\Program Files: mark it absent or present`);
  }
  assert.ok(marked >= 20, `${marked} rows are marked`);
});

test("parseSwitch reads the spellings that the binary read", () => {
  for (const v of ["1", "true", "TRUE", "True", "yes", "YES", "on", "On", "ON", " 1", "1 ", "\ttrue", "true "]) assert.equal(parseSwitch(v), true, JSON.stringify(v));
  for (const v of ["0", "false", "FALSE", "no", "No", "off", "OFF", "Off", " 0"]) assert.equal(parseSwitch(v), false, JSON.stringify(v));
  for (const v of ["", "2", "enabled", "y", "t", "1.0", "-1", "00", "yes please", "null", "undefined", undefined, null]) assert.equal(parseSwitch(v), undefined, JSON.stringify(v));
});

test("checkBashValue: the names, quote marks, an unexpanded %VAR%, a relative path, and a value that is only space", () => {
  const sys = fakeMachine({ files: ["C:\\Git\\bin\\bash.exe", "C:\\Git\\bin\\sh.exe", "C:\\Git\\bin\\bash", "C:\\Git\\git-bash.exe"], dirs: ["C:\\d\\bash.exe"] });
  assert.equal(checkBashValue("C:\\Git\\bin\\bash.exe", sys).state, "valid");
  assert.equal(checkBashValue("C:/Git/bin/BASH.EXE", sys).state, "valid", "a name in capitals, with forward slashes");
  assert.equal(checkBashValue("  C:\\Git\\bin\\sh.exe  ", sys).state, "valid");
  assert.equal(checkBashValue("C:\\Git\\bin\\bash", sys).state, "valid");
  assert.equal(checkBashValue("C:\\d\\bash.exe", sys).state, "valid", "a folder with the name is taken: only the name and that it exists are checked");
  assert.equal(checkBashValue("C:\\Git\\git-bash.exe", sys).state, "not-bash");
  assert.match(checkBashValue("C:\\Git\\git-bash.exe", sys).hint, /must be named bash\.exe, sh\.exe, bash or sh/);
  assert.equal(checkBashValue("\"C:\\Git\\bin\\bash.exe\"", sys).state, "not-bash", "the closing quote is part of the name");
  assert.match(checkBashValue("\"C:\\Git\\bin\\bash.exe\"", sys).hint, /quote marks/);
  assert.equal(checkBashValue("C:\\Git\\nope\\bash.exe", sys).state, "not-found");
  assert.equal(checkBashValue("%USERPROFILE%\\Git\\bin\\bash.exe", sys).state, "not-found");
  assert.match(checkBashValue("%USERPROFILE%\\Git\\bin\\bash.exe", sys).hint, /not expanded/);
  assert.equal(checkBashValue("bin\\bash.exe", sys).state, "not-found");
  assert.match(checkBashValue("bin\\bash.exe", sys).hint, /not an absolute path/);
  assert.equal(checkBashValue("   ", sys).state, "unset");
  assert.equal(checkBashValue(undefined, sys).state, "unset");
});

test("resolveVariable: settings win over the process environment, the nearest settings file wins, and project and local settings do not count for the Git Bash path", () => {
  const facts = (env, files = {}) => ({ env: { managed: {}, local: {}, project: {}, user: {}, ...env }, envFiles: files, deny: [], defaultShell: [] });
  const ps = "CLAUDE_CODE_USE_POWERSHELL_TOOL";
  const bash = "CLAUDE_CODE_GIT_BASH_PATH";
  assert.equal(resolveVariable(ps, { processValue: "1", facts: facts({}) }).value, "1");
  assert.equal(resolveVariable(ps, { processValue: "1", facts: facts({ user: { [ps]: "0" } }) }).value, "0");
  assert.equal(resolveVariable(ps, { processValue: "1", facts: facts({ user: { [ps]: "0" } }) }).source, "user settings");
  assert.equal(resolveVariable(ps, { facts: facts({ user: { [ps]: "1" }, project: { [ps]: "0" }, local: { [ps]: "1" } }) }).value, "1");
  assert.equal(resolveVariable(ps, { facts: facts({ user: { [ps]: "1" }, project: { [ps]: "0" } }) }).value, "0");
  assert.equal(resolveVariable(ps, { facts: facts({ managed: { [ps]: "0" }, local: { [ps]: "1" } }) }).value, "0", "managed settings are the highest");
  const r = resolveVariable(bash, { processValue: "C:\\a\\bash.exe", facts: facts({ project: { [bash]: "C:\\b\\bash.exe" }, local: { [bash]: "C:\\c\\bash.exe" } }, { project: ".claude/settings.json", local: ".claude/settings.local.json" }) });
  assert.equal(r.value, "C:\\a\\bash.exe", "the process value stands");
  assert.deepEqual(r.ignored.map((i) => i.scope), ["local", "project"], "the two settings files are named as ignored");
  assert.equal(resolveVariable(bash, { facts: facts({ user: { [bash]: "x" }, project: { [bash]: "y" } }) }).value, "x");
  assert.equal(resolveVariable(bash, { facts: facts({}) }).source, null);
});

test("findGitBash: the trail names every step that was tried, in the order of the binary", () => {
  const root = "C:\\t\\g1";
  const sys = fakeMachine({ env: { Path: `${root}\\cmd;${SYSTEM_PATH}` }, files: [...SYSTEM_FILES, ...gitFiles(root)] });
  const r = findGitBash(sys, { variable: { value: "", source: null }, cwd: "C:\\work\\proj" });
  assert.equal(r.how, "where-git");
  assert.deepEqual(r.trail.map((t) => t.step), ["variable", "program-files", "program-files-x86", "where-git"]);
  assert.equal(r.trail[3].chosen, `${root}\\cmd\\git.exe`);
  assert.equal(r.trail[3].derived, `${root}\\bin\\bash.exe`);
  assert.equal(r.path, `${root}\\bin\\bash.exe`);
  // mingw64\bin first: the first line decides
  const sys2 = fakeMachine({ env: { Path: `${root}\\mingw64\\bin;${root}\\cmd;${SYSTEM_PATH}` }, files: [...SYSTEM_FILES, ...gitFiles(root)] });
  const r2 = findGitBash(sys2, { variable: { value: "", source: null }, cwd: "C:\\work\\proj" });
  assert.equal(r2.path, null);
  assert.equal(r2.trail[3].chosen, `${root}\\mingw64\\bin\\git.exe`);
  assert.equal(r2.trail[3].derived, `${root}\\mingw64\\bin\\bash.exe`);
  assert.equal(r2.trail[3].exists, false);
  assert.deepEqual(r2.trail[3].lines, [`${root}\\mingw64\\bin\\git.exe`, `${root}\\cmd\\git.exe`]);
});

test("findGitBash: the fixed paths come before PATH, C:\\Program Files before C:\\Program Files (x86), and a missing where.exe is said", () => {
  const files = [...SYSTEM_FILES, ...gitFiles("C:\\t\\g1"), FIXED_BASH[1]];
  const sys = fakeMachine({ env: { Path: `C:\\t\\g1\\cmd;${SYSTEM_PATH}` }, files });
  const r = findGitBash(sys, { variable: { value: "", source: null }, cwd: "C:\\work\\proj" });
  assert.equal(r.how, "program-files-x86");
  assert.deepEqual(r.trail.map((t) => t.step), ["variable", "program-files", "program-files-x86"], "where git is not asked when a fixed path has it");
  const none = fakeMachine({ env: { Path: SYSTEM_PATH }, files: SYSTEM_FILES, where: () => null });
  const r2 = findGitBash(none, { variable: { value: "", source: null }, cwd: "C:\\work\\proj" });
  assert.equal(r2.path, null);
  assert.equal(r2.trail.at(-1).note, "where.exe could not run");
});

test("findGitBash: a git.exe in the working folder, or in a dependency folder below it, is skipped, with the reason", () => {
  const sys = fakeMachine({ env: { Path: `C:\\work\\proj\\node_modules\\.bin;${SYSTEM_PATH}` }, files: [...SYSTEM_FILES, "C:\\work\\proj\\git.exe", "C:\\work\\proj\\node_modules\\.bin\\git.exe", "C:\\work\\proj\\node_modules\\bin\\bash.exe", "C:\\work\\proj\\bin\\bash.exe"] });
  const r = findGitBash(sys, { variable: { value: "", source: null }, cwd: "C:\\work\\proj" });
  assert.equal(r.path, null);
  const skipped = r.trail.at(-1).skipped;
  assert.deepEqual(skipped.map((s) => s.reason), ["it is in the working folder", "it is in the working folder"]);
});

test("findPowerShell: pwsh on PATH, ProgramW6432's PowerShell\\7, .dotnet\\tools, powershell on PATH, System32, in that order", () => {
  for (const e of EDITIONS) {
    const files = [...SYSTEM_FILES, ...(e.files || []).map((f) => fill(f, CTX).replace(/\//g, "\\"))];
    const env = { Path: [...(e.path || []).map((p) => fill(p, CTX).replace(/\//g, "\\")), SYSTEM_PATH].join(";"), SystemRoot: "C:\\Windows", ...Object.fromEntries(Object.entries(e.env || {}).map(([k, v]) => [k, fill(v, CTX)])) };
    const sys = fakeMachine({ env, files, home: env.USERPROFILE || "C:\\Users\\me" });
    const r = findPowerShell(sys, { cwd: "C:\\work\\proj" });
    assert.equal(r.edition, e.edition, e.id);
    assert.equal(r.core, e.core, e.id);
  }
});

test("predictShell: the account's default is named, not guessed, when Git Bash is found and the variable is not set", () => {
  const sys = fakeMachine({ env: { Path: SYSTEM_PATH, CLAUDE_CODE_GIT_BASH_PATH: "C:\\t\\g1\\bin\\bash.exe" }, files: [...SYSTEM_FILES, ...gitFiles("C:\\t\\g1")] });
  const p = predictFor(sys);
  assert.equal(p.gitBash.how, "variable");
  assert.equal(p.tools.Bash, true);
  assert.equal(p.tools.PowerShell, "account");
  assert.match(p.powershell.why, /claude\.ai and Console accounts/);
  assert.deepEqual(expectedTools(p), ["Bash"]);
  assert.deepEqual(expectedTools(p, { account: true }), ["Bash", "PowerShell"]);
  assert.ok(p.why.some((l) => /Git Bash at C:\\t\\g1\\bin\\bash\.exe/.test(l)));
});

test("predictShell: a value that reads as not set is noticed, and the deny rules that take a tool away are named", () => {
  const sys = fakeMachine({ env: { Path: SYSTEM_PATH, CLAUDE_CODE_USE_POWERSHELL_TOOL: "enabled" }, files: SYSTEM_FILES, texts: { "C:\\Users\\me\\.claude\\settings.json": JSON.stringify({ permissions: { deny: ["Bash", "PowerShell(git *)", "PowerShell(*)"] } }) } });
  const p = predictFor(sys);
  assert.equal(p.powershell.unread, true);
  assert.equal(p.powershell.setting, "unset");
  assert.equal(p.deny.Bash.length, 1);
  assert.equal(p.deny.PowerShell.length, 1, "only PowerShell(*) is a whole-tool rule");
  assert.equal(p.tools.PowerShell, "no");
  assert.equal(p.fatal, null);
});
