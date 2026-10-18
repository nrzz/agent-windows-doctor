// The facts behind the setup findings: git's configuration, long paths, the execution policy, the code page, a stale index.lock, Node and npm.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { fakeMachine } from "./machine.mjs";
import { BLOCKING, codePageFacts, effectivePolicy, executionPolicyFacts, gitDirOf, gitFacts, indexLockFacts, longPathFacts, nodeFacts, parseExecutionPolicy, parseGitConfigOrigin } from "../src/facts.mjs";

const out = (stdout, status = 0) => ({ status, stdout, stderr: "" });

test("parseGitConfigOrigin: the origin, a tab, the value; the last one counts", () => {
  const text = "file:E:/Das/Git/etc/gitconfig\ttrue\nfile:C:/Users/me/.gitconfig\tinput\n";
  assert.deepEqual(parseGitConfigOrigin(text), [{ origin: "E:/Das/Git/etc/gitconfig", value: "true" }, { origin: "C:/Users/me/.gitconfig", value: "input" }]);
  assert.deepEqual(parseGitConfigOrigin("command line:\ttrue"), [{ origin: "command line:", value: "true" }]);
  assert.deepEqual(parseGitConfigOrigin(""), []);
});

test("gitFacts: the version, core.autocrlf and core.longpaths with where each is set; a git that is not there is said", () => {
  const sys = fakeMachine({ commands: {
    git: (args) => {
      if (args[0] === "--version") return out("git version 2.55.0.windows.3\n");
      const key = args[args.length - 1];
      if (key === "core.autocrlf") return out("file:E:/Das/Git/etc/gitconfig\ttrue\nfile:C:/Users/me/.gitconfig\tfalse\n");
      return { status: 1, stdout: "", stderr: "" };
    },
  }, dirs: ["C:\\work\\proj"] });
  const g = gitFacts(sys, "C:\\work\\proj");
  assert.equal(g.ok, true);
  assert.equal(g.version, "2.55.0.windows.3");
  assert.deepEqual(g.autocrlf, { origin: "C:/Users/me/.gitconfig", value: "false" });
  assert.equal(g.longpaths, null);
  const none = gitFacts(fakeMachine({}), "C:\\work\\proj");
  assert.equal(none.ok, false);
  assert.match(none.error, /git could not run \(ENOENT\)/);
});

test("longPathFacts: LongPathsEnabled from the registry, 1 is on, a value that is not there is off", () => {
  const key = "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem";
  assert.deepEqual(longPathFacts(fakeMachine({ registry: { [key]: { LongPathsEnabled: ["REG_DWORD", "0x1"] } } })), { ok: true, enabled: true, set: true });
  assert.deepEqual(longPathFacts(fakeMachine({ registry: { [key]: { LongPathsEnabled: ["REG_DWORD", "0x0"] } } })), { ok: true, enabled: false, set: true });
  assert.deepEqual(longPathFacts(fakeMachine({ registry: { [key]: {} } })), { ok: true, enabled: false, set: false });
  assert.deepEqual(longPathFacts(fakeMachine({ platform: "linux" })), { ok: true, enabled: null });
});

test("parseExecutionPolicy and effectivePolicy: Claude Code's Bypass at process scope, Group Policy above it, and the policy of the machine when Claude Code is told not to bypass", () => {
  const text = "MachinePolicy=Undefined\r\nUserPolicy=Undefined\r\nProcess=Undefined\r\nCurrentUser=RemoteSigned\r\nLocalMachine=Undefined\r\n";
  const list = parseExecutionPolicy(text);
  assert.deepEqual(list.map((x) => x.scope), ["MachinePolicy", "UserPolicy", "Process", "CurrentUser", "LocalMachine"]);
  assert.deepEqual(effectivePolicy(list), { scope: "Process", policy: "Bypass", bypassed: true, underneath: { scope: "CurrentUser", policy: "RemoteSigned" } });
  assert.deepEqual(effectivePolicy(list, { respect: true }), { scope: "CurrentUser", policy: "RemoteSigned", bypassed: false });
  const gp = parseExecutionPolicy("MachinePolicy=AllSigned\nUserPolicy=Undefined\nProcess=Undefined\nCurrentUser=Unrestricted\nLocalMachine=Undefined");
  assert.deepEqual(effectivePolicy(gp), { scope: "MachinePolicy", policy: "AllSigned", bypassed: false }, "Group Policy wins over the process scope");
  const empty = parseExecutionPolicy("MachinePolicy=Undefined\nUserPolicy=Undefined\nProcess=Undefined\nCurrentUser=Undefined\nLocalMachine=Undefined");
  assert.deepEqual(effectivePolicy(empty, { respect: true }), { scope: "default", policy: "Restricted", bypassed: false }, "the default of Windows client versions");
  assert.ok(BLOCKING.has("Restricted") && BLOCKING.has("AllSigned") && !BLOCKING.has("RemoteSigned") && !BLOCKING.has("Bypass"));
  assert.deepEqual(parseExecutionPolicy("garbage\nNope=Bypass"), []);
});

test("executionPolicyFacts asks the PowerShell Claude Code would run, reads its answer, and says when it cannot", () => {
  const sys = fakeMachine({ commands: { pwsh: () => out("MachinePolicy=Undefined\nUserPolicy=Undefined\nProcess=Undefined\nCurrentUser=Undefined\nLocalMachine=RemoteSigned\n") } });
  const p = executionPolicyFacts(sys, { shell: "C:\\Program Files\\PowerShell\\7\\pwsh.exe" });
  assert.equal(p.ok, true);
  assert.equal(p.effective.policy, "Bypass");
  assert.equal(p.machine.policy, "RemoteSigned");
  assert.deepEqual(sys.runs[0].args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-Command"]);
  assert.equal(executionPolicyFacts(fakeMachine({})).ok, false);
  const bad = fakeMachine({ commands: { powershell: () => out("nothing useful") } });
  assert.match(executionPolicyFacts(bad).error, /printed no policy/);
  assert.deepEqual(executionPolicyFacts(fakeMachine({ platform: "linux" })), { ok: true, list: [], effective: null });
});

test("codePageFacts: the active code page is the last number of chcp's line, in any language, and the system's two come from the registry", () => {
  const nls = { "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage": { OEMCP: ["REG_SZ", "437"], ACP: ["REG_SZ", "1252"] } };
  const en = codePageFacts(fakeMachine({ registry: nls, commands: { cmd: () => out("Active code page: 437\r\n") } }));
  assert.deepEqual([en.active, en.oem, en.ansi, en.ok], [437, 437, 1252, true]);
  const de = codePageFacts(fakeMachine({ registry: nls, commands: { cmd: () => out("Aktive Codepage: 850\r\n") } }));
  assert.equal(de.active, 850);
  const ja = codePageFacts(fakeMachine({ commands: { cmd: () => out("現在のコード ページ: 932\r\n") } }));
  assert.equal(ja.active, 932);
  const none = codePageFacts(fakeMachine({ commands: { cmd: () => out("") } }));
  assert.deepEqual([none.ok, none.active], [false, null]);
});

test("gitDirOf: the .git folder above the project, or the folder that the .git file of a worktree names", () => {
  const sys = fakeMachine({ dirs: ["C:\\src\\shop\\.git"], files: ["C:\\wt\\feature\\x.txt"], texts: { "C:\\wt\\feature\\.git": "gitdir: C:/src/shop/.git/worktrees/feature\n", "C:\\wt\\rel\\.git": "gitdir: ..\\main\\.git\\worktrees\\rel" } });
  assert.deepEqual(gitDirOf(sys, "C:\\src\\shop\\app\\deep"), { gitDir: "C:\\src\\shop\\.git", root: "C:\\src\\shop" });
  assert.deepEqual(gitDirOf(sys, "C:\\wt\\feature"), { gitDir: "C:\\src\\shop\\.git\\worktrees\\feature", root: "C:\\wt\\feature", worktree: true });
  assert.equal(gitDirOf(sys, "C:\\wt\\rel").gitDir, "C:\\wt\\main\\.git\\worktrees\\rel");
  assert.equal(gitDirOf(sys, "C:\\elsewhere\\x"), null);
});

test("indexLockFacts: no lock, a lock with git running, a lock with no git running (stale), with its age", () => {
  const tasks = (running) => ({ tasklist: () => out(running ? "git.exe                      4321 Console                    1     9,876 K\r\n" : "INFO: No tasks are running which match the specified criteria.\r\n") });
  const base = { dirs: ["C:\\p\\.git"], mtimes: { "C:\\p\\.git\\index.lock": Date.parse("2026-10-16T11:30:00Z") } };
  assert.deepEqual(indexLockFacts(fakeMachine({ ...base, commands: tasks(false) }), "C:\\p"), { ok: true, gitDir: "C:\\p\\.git", lock: null });
  const stale = indexLockFacts(fakeMachine({ ...base, files: ["C:\\p\\.git\\index.lock"], commands: tasks(false) }), "C:\\p");
  assert.equal(stale.lock.gitRunning, false);
  assert.equal(stale.lock.ageMs, 30 * 60 * 1000, "the clock of the pretend machine is noon");
  assert.equal(stale.lock.path, "C:\\p\\.git\\index.lock");
  const live = indexLockFacts(fakeMachine({ ...base, files: ["C:\\p\\.git\\index.lock"], commands: tasks(true) }), "C:\\p");
  assert.equal(live.lock.gitRunning, true);
  const unknown = indexLockFacts(fakeMachine({ ...base, files: ["C:\\p\\.git\\index.lock"] }), "C:\\p");
  assert.equal(unknown.lock.gitRunning, null, "tasklist could not run: not known");
  assert.deepEqual(indexLockFacts(fakeMachine({}), "C:\\nowhere"), { ok: true, gitDir: null, lock: null });
});

test("nodeFacts: this Node, the npm on PATH and its prefix; no npm is said", () => {
  const sys = fakeMachine({ nodeVersion: "v22.11.0", commands: { cmd: (args) => (/prefix/.test(args[3]) ? out("C:\\Users\\me\\AppData\\Roaming\\npm\r\n") : out("10.9.0\r\n")) } });
  assert.deepEqual(nodeFacts(sys), { node: "22.11.0", nodePath: "C:\\Program Files\\nodejs\\node.exe", npm: "10.9.0", npmPrefix: "C:\\Users\\me\\AppData\\Roaming\\npm", npmFound: true });
  const none = nodeFacts(fakeMachine({ commands: { cmd: () => ({ status: 1, stdout: "", stderr: "not recognized" }) } }));
  assert.deepEqual([none.npm, none.npmFound, none.npmPrefix], [null, false, null]);
});
