// The machine whatever agent runs on it: Windows and its build, the PowerShell editions with their language mode and execution policy, every bash.exe on PATH, and the
// shell that Codex CLI, Gemini CLI, Copilot CLI and Cursor give the model on it.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { fakeMachine } from "./machine.mjs";
import { HOME, PSPROBE, winMachine } from "./win-machine.mjs";
import { MXC_MINIMUM, MXC_TEXT, bashOnPath, classifyBash, collectMachine, mxcSupport, windowsFacts } from "../src/machine.mjs";
import { parseProbe, powerShellFacts, probePowerShell } from "../src/psprobe.mjs";
import { shellFor } from "../src/shells.mjs";

const out = (stdout, status = 0) => ({ status, stdout, stderr: "" });
const PS7 = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
const withPwsh = (o = {}) => winMachine({ ...o, files: [...(o.files || []), PS7], env: { ...(o.env || {}), Path: `C:\\Program Files\\PowerShell\\7;C:\\Program Files\\Git\\cmd;C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\WindowsPowerShell\\v1.0` } });

test("windowsFacts: the build, the update revision and the display version from the registry; a server is told from the name", () => {
  const w = windowsFacts(winMachine({ build: 26300, ubr: 9711 }));
  assert.deepEqual([w.ok, w.build, w.ubr, w.display, w.arch, w.server], [true, 26300, 9711, "25H2", "x64", false]);
  assert.equal(windowsFacts(fakeMachine({ platform: "linux" })).ok, false);
  const server = fakeMachine({ release: "10.0.26100", osVersion: "Windows Server 2025 Datacenter" });
  assert.equal(windowsFacts(server).server, true);
  assert.equal(windowsFacts(server).ubr, null, "no registry value, no revision");
});

test("mxcSupport: 26100.9278 and 26200.9278 are the minimum; older builds cannot, newer builds can, and a missing revision is not guessed", () => {
  assert.deepEqual(MXC_MINIMUM.map((m) => `${m.build}.${m.ubr}`), ["26100.9278", "26200.9278"]);
  assert.equal(MXC_TEXT, "26100.9278 or 26200.9278");
  const at = (build, ubr) => mxcSupport({ build, ubr });
  assert.equal(at(22631, 4000).supported, false);
  assert.match(at(22631, 4000).why, /older than Windows 11 24H2/);
  assert.equal(at(26100, 9277).supported, false);
  assert.equal(at(26100, 9278).supported, true);
  assert.equal(at(26200, 9277).supported, false);
  assert.equal(at(26200, 9278).supported, true);
  assert.equal(at(26100, null).supported, null);
  assert.equal(at(26300, 9711).supported, true);
  assert.match(at(26300, 9711).why, /newer than the documented minimum/);
  assert.equal(mxcSupport({ build: null }).supported, null);
});

test("classifyBash and bashOnPath: Git Bash, the WSL launcher in System32 and in WindowsApps, and a bash that is neither; in PATH order", () => {
  const sys = winMachine({
    files: ["E:\\Das\\Git\\usr\\bin\\bash.exe", "E:\\Das\\Git\\cmd\\git.exe", "D:\\other\\bin\\bash.exe", `${HOME}\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe`],
    env: { Path: `E:\\Das\\Git\\usr\\bin;D:\\other\\bin;${HOME}\\AppData\\Local\\Microsoft\\WindowsApps;C:\\Windows\\System32;C:\\Windows` },
  });
  assert.deepEqual(bashOnPath(sys, {}).map((b) => [b.path, b.kind]), [["E:\\Das\\Git\\usr\\bin\\bash.exe", "git-bash"], ["D:\\other\\bin\\bash.exe", "other"], [`${HOME}\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe`, "wsl-launcher"], ["C:\\Windows\\System32\\bash.exe", "wsl-launcher"]]);
  assert.equal(classifyBash(sys, "C:\\Windows\\System32\\bash.exe"), "wsl-launcher");
  assert.deepEqual(bashOnPath(fakeMachine({ platform: "linux" }), {}), []);
});

test("parseProbe: the lines the probe prints, with the scopes of the execution policy", () => {
  const p = parseProbe(PSPROBE({ languageMode: "ConstrainedLanguage", effective: "AllSigned", machine: "AllSigned" }));
  assert.deepEqual([p.edition, p.version, p.languageMode, p.effective], ["Desktop", "5.1.26100.9711", "ConstrainedLanguage", "AllSigned"]);
  assert.deepEqual(p.list.map((x) => `${x.scope}=${x.policy}`), ["MachinePolicy=AllSigned", "UserPolicy=Undefined", "Process=Undefined", "CurrentUser=RemoteSigned", "LocalMachine=Undefined"]);
  assert.equal(parseProbe("nothing"), null);
});

test("powerShellFacts: Windows PowerShell 5.1 at System32, every pwsh.exe on PATH, and the places the installers use; each edition is asked once", () => {
  const five = powerShellFacts(winMachine(), {});
  assert.deepEqual(five.editions.map((e) => [e.id, e.path, e.onPath]), [["5.1", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", true]]);
  assert.deepEqual(five.pwshOnPath, []);
  assert.deepEqual([five.editions[0].probe.ok, five.editions[0].probe.languageMode, five.editions[0].probe.effective], [true, "FullLanguage", "RemoteSigned"]);
  const both = powerShellFacts(withPwsh({ ps7: { effective: "Unrestricted" } }), {});
  assert.deepEqual(both.editions.map((e) => [e.id, e.how]), [["5.1", "System32"], ["7", "pwsh.exe on PATH"]]);
  assert.equal(both.editions[1].probe.effective, "Unrestricted");
  assert.equal(both.editions[1].probe.edition, "Core");
  // PowerShell 7 off PATH, in its installer's folder, in the Store alias folder, and in the .NET tools folder
  const off = powerShellFacts(winMachine({ files: [PS7, `${HOME}\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe`, `${HOME}\\.dotnet\\tools\\pwsh.exe`] }), {});
  assert.deepEqual(off.editions.filter((e) => e.id === "7").map((e) => [e.how, e.onPath]), [["the folder of the PowerShell 7 installer", false], ["a Microsoft Store app alias", false], ["the .NET global tools folder", false]]);
  assert.ok(off.editions.filter((e) => e.id === "7").slice(1).every((e) => !e.probe), "only the first PowerShell 7 is asked");
  // PSModulePath is not given to a PowerShell: each works out its own
  const sys = withPwsh({ env: { PSModulePath: "C:\\Program Files\\PowerShell\\7\\Modules" } });
  powerShellFacts(sys, {});
  assert.ok(sys.runs.filter((r) => /PSEdition/.test(r.args.at(-1))).every((r) => !Object.keys(r.opts.env).some((k) => k.toLowerCase() === "psmodulepath")));
  // without the probe nothing is asked
  const quiet = winMachine();
  powerShellFacts(quiet, { probe: false });
  assert.equal(quiet.runs.filter((r) => /powershell|pwsh/i.test(r.cmd)).length, 0);
});

test("probePowerShell: a PowerShell that does not run, exits with an error or prints nothing is said, never thrown", () => {
  const sys = winMachine({ commands: { powershell: () => ({ status: 1, stdout: "", stderr: "boom: something\nsecond line" }) } });
  assert.deepEqual(probePowerShell(sys, "C:\\x\\powershell.exe"), { ok: false, exe: "C:\\x\\powershell.exe", error: "C:\\x\\powershell.exe exited 1: boom: something" });
  const silent = winMachine({ commands: { powershell: () => out("") } });
  assert.match(probePowerShell(silent, "powershell.exe").error, /printed no answer/);
  const gone = winMachine();
  gone.run = () => ({ status: null, stdout: "", stderr: "", error: Object.assign(new Error("x"), { code: "ENOENT" }), timedOut: false });
  assert.match(probePowerShell(gone, "powershell.exe").error, /could not run \(ENOENT\)/);
});

test("collectMachine: everything the machine section says, from a pretend Windows", () => {
  const m = collectMachine(withPwsh(), { cwd: "C:\\work\\shop" });
  assert.equal(m.windows.build, 26300);
  assert.equal(m.mxc.supported, true);
  assert.deepEqual(m.powershell.editions.map((e) => e.id), ["5.1", "7"]);
  assert.equal(m.git.ok, true);
  assert.equal(m.longPaths.enabled, true);
  assert.equal(m.codePage.active, 65001);
  assert.equal(m.wsl.available, true);
  assert.equal(m.node.node, "24.19.0");
  assert.ok(m.gitInstalls.length >= 1);
});

// ---- the shell each agent gives the model --------------------------------------------------------------------------------------------

test("shellFor codex: pwsh on PATH, then the PowerShell 7 of Program Files, then powershell on PATH, then the Windows PowerShell 5.1 of System32, each by its full path; there is no key to choose", () => {
  const PS51 = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  const five = shellFor("codex", { machine: collectMachine(winMachine(), {}) });
  assert.deepEqual([five.state, five.shell.core, five.shell.path, five.tool, five.basis], ["ok", false, PS51, "exec_command", "verified"]);
  assert.match(five.how[0], /^no pwsh.exe on PATH and no PowerShell 7 in C:\\Program Files, so the first powershell.exe on PATH, by its full path$/);
  assert.match(five.how.join(" "), /windows\.shell_path is not a key of Codex CLI 0\.163\.0/);
  assert.match(five.how.join(" "), /a pwsh.exe in the project folder, or in a ProgramFiles folder that an environment variable names, is not used/);
  // 1: pwsh on PATH
  const seven = shellFor("codex", { machine: collectMachine(withPwsh(), {}) });
  assert.deepEqual([seven.shell.core, seven.shell.path], [true, PS7]);
  assert.match(seven.how[0], /^the first pwsh.exe on PATH, by its full path$/);
  // 2: PowerShell 7 in Program Files that PATH does not list is started all the same (put to Codex on the windows-latest runner)
  const fixed = shellFor("codex", { machine: collectMachine(winMachine({ files: [PS7] }), {}) });
  assert.deepEqual([fixed.shell.core, fixed.shell.path], [true, PS7]);
  assert.match(fixed.how[0], /^no pwsh.exe on PATH, so PowerShell 7 at C:\\Program Files\\PowerShell\\7\\pwsh.exe: Codex has that path written into it/);
  // a pwsh.exe in another folder that no PATH lists, or in the Program Files that an environment variable names, is not used
  const other = shellFor("codex", { machine: collectMachine(winMachine({ files: ["D:\\Program Files\\PowerShell\\7\\pwsh.exe"], env: { ProgramW6432: "D:\\Program Files", ProgramFiles: "D:\\Program Files" } }), {}) });
  assert.equal(other.shell.core, false);
  // 3: a powershell.exe first on PATH is started, wherever it is
  const copy = shellFor("codex", { machine: collectMachine(winMachine({ files: ["C:\\tools\\powershell.exe"], env: { Path: "C:\\tools;C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\WindowsPowerShell\\v1.0" } }), {}) });
  assert.equal(copy.shell.path, "C:\\tools\\powershell.exe");
  // 4: with no PowerShell folder on PATH, the path written into Codex
  const noPath = shellFor("codex", { machine: collectMachine(winMachine({ env: { Path: "C:\\Windows\\System32;C:\\Windows" } }), {}) });
  assert.deepEqual([noPath.state, noPath.shell.path], ["ok", PS51]);
  assert.match(noPath.how[0], /^no PowerShell on PATH and no PowerShell 7 in C:\\Program Files, so Windows PowerShell 5.1 at C:\\Windows\\System32\\WindowsPowerShell\\v1.0, a path written into Codex$/);
});

test("shellFor gemini and copilot: pwsh.exe or powershell.exe through PATH, and nothing when neither is on PATH", () => {
  const five = collectMachine(winMachine(), {});
  assert.equal(shellFor("gemini", { machine: five }).args, "-NoProfile -NonInteractive -Command");
  assert.equal(shellFor("gemini", { machine: collectMachine(withPwsh(), {}) }).args, "-NoProfile -Command");
  assert.equal(shellFor("copilot", { machine: five }).args, "-NoProfile -NoLogo -NonInteractive -Command");
  assert.match(shellFor("copilot", { machine: five }).how[0], /Windows PowerShell 5\.1 ran the tool, although the README of Copilot CLI asks for PowerShell 6 or newer/);
  const noPath = collectMachine(winMachine({ env: { Path: "C:\\Windows\\System32;C:\\Windows" } }), {});
  for (const agent of ["gemini", "copilot"]) {
    const s = shellFor(agent, { machine: noPath });
    assert.deepEqual([s.state, s.shell], ["missing", null], agent);
  }
  assert.match(shellFor("gemini", { machine: noPath }).how.join(" "), /spawn powershell\.exe ENOENT/);
  assert.match(shellFor("copilot", { machine: noPath }).how.join(" "), /PowerShell is not available\. Tried "pwsh\.exe", "powershell\.exe"\./);
  assert.equal(shellFor("copilot", { machine: collectMachine(withPwsh(), {}) }).shell.core, true);
});

test("shellFor cursor: the launcher's Windows PowerShell 5.1 when a launcher was read, and an honest unknown for what the agent gives the model", () => {
  const launcher = { powershell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", args: "-NoProfile -ExecutionPolicy Bypass -File <script>" };
  const s = shellFor("cursor", { machine: collectMachine(winMachine(), {}), cursor: { launcher } });
  assert.deepEqual([s.state, s.basis, s.tool], ["unknown", "documented", null]);
  assert.match(s.how[0], /hardcoded, so installing PowerShell 7 does not change it/);
  assert.match(s.how[1], /not stated in Cursor's documentation/);
  const none = shellFor("cursor", { machine: collectMachine(winMachine(), {}), cursor: {} });
  assert.deepEqual([none.shell, none.basis], [null, "not verified"]);
  assert.equal(shellFor("nope", { machine: collectMachine(winMachine(), {}) }), null);
});
