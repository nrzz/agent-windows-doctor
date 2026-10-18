// The real Windows, read only: the registry, wsl.exe, PowerShell, chcp, git, where.exe, the Windows Store, the version resource of a program and bash syntax, each cross-checked against
// another way of asking where there is one. Nothing is written (this tool has no command that writes), and the process runs behind the guard of test/helpers.mjs, so LOCALAPPDATA, APPDATA and
// every agent's folder are empty folders of the test: what is read is the machine's, not the user's files. These run on the Windows jobs of `npm test` and skip on the other systems.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { IS_WIN, runCli, tmpDir, world } from "./helpers.mjs";
import { plainWindowsPath } from "./sandbox.mjs";
import { PATTERN } from "./cursor-files.mjs";
import { makeSys } from "../src/sys.mjs";
import { readRegValue, regUserEnv } from "../src/winenv.mjs";
import { codePageFacts, executionPolicyFacts, gitFacts, longPathFacts, nodeFacts } from "../src/facts.mjs";
import { decodeWsl, parseDistros, windowsWslFacts } from "../src/wsl.mjs";
import { discoverGitBash } from "../src/gitbash.mjs";
import { compareUserEnv } from "../src/userenv.mjs";
import { bashOnPath, windowsFacts } from "../src/machine.mjs";
import { powerShellFacts } from "../src/psprobe.mjs";
import { findAgents } from "../src/inventory.mjs";
import { readFileVersions } from "../src/versions.mjs";
import { psMatch } from "../src/agentfacts.mjs";
import { codexDesktopApp } from "../src/check.mjs";
import { bashReasons } from "../src/hooks.mjs";

const skip = !IS_WIN && "this reads the real Windows";
const SYSTEM = process.env.SystemRoot || "C:\\Windows";
const POWERSHELL_51 = path.win32.join(SYSTEM, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
// no PSModulePath: a Windows PowerShell started from PowerShell 7 (as on a CI runner) would otherwise load the modules of 7 and fail
const psEnv = (extra = {}) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== "psmodulepath")), ...extra });
const run = (exe, args, env) => spawnSync(exe, args, { encoding: "utf8", windowsHide: true, input: "", env: env || psEnv(), timeout: 60000 });
const ps = (command, env) => run(POWERSHELL_51, ["-NoProfile", "-NonInteractive", "-Command", command], env).stdout.trim();

test("the user environment: the real HKCU\\Environment is listed through reg.exe, read value by value the same, and has the names that every Windows user has", { skip }, () => {
  const sys = makeSys();
  const env = regUserEnv(sys);
  const all = env.list();
  assert.equal(all.ok, true, all.error);
  const names = all.values.map((v) => v.name.toLowerCase());
  assert.ok(names.includes("temp") && names.includes("tmp"), `TEMP and TMP are in ${names.join(", ")}`);
  for (const v of all.values.slice(0, 6)) {
    const one = env.read(v.name);
    assert.deepEqual([one.exists, one.type, one.value], [true, v.type, v.value], v.name);
  }
  assert.equal(env.read("AGENT_WINDOWS_DOCTOR_NO_SUCH_VALUE").exists, false);
  // the same names, asked of .NET (a second way)
  const dotnet = ps("[Environment]::GetEnvironmentVariables('User').Keys -join ';'").split(";").map((s) => s.toLowerCase()).sort();
  assert.deepEqual(names.sort(), dotnet, "the same names as .NET gives");
  assert.equal(compareUserEnv(sys, env).ok, true);
});

test("a registry value through reg.exe and through PowerShell: the long path switch, and the ANSI code page", { skip }, () => {
  const lp = longPathFacts(makeSys());
  assert.equal(lp.ok, true);
  const viaPs = ps("(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem' -ErrorAction SilentlyContinue).LongPathsEnabled");
  assert.equal(lp.enabled, viaPs === "1", `LongPathsEnabled is ${viaPs || "not set"} for PowerShell`);
  const cp = readRegValue(makeSys(), "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage", "ACP");
  assert.equal(cp.value, ps("(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage').ACP"));
});

test("the version and build of Windows: the release, the build and the update revision are those that .NET and the registry give", { skip }, () => {
  const win = windowsFacts(makeSys());
  assert.equal(win.ok, true);
  const dotnet = ps("$v=[Environment]::OSVersion.Version; \"$($v.Major).$($v.Minor).$($v.Build)\"");
  assert.equal(win.release.replace(/^(\d+\.\d+\.\d+).*$/, "$1"), dotnet);
  assert.equal(win.build, Number(dotnet.split(".")[2]));
  const nt = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion";
  assert.equal(String(win.ubr), ps(`(Get-ItemProperty '${nt}').UBR`));
  const display = ps(`(Get-ItemProperty '${nt}').DisplayVersion`);
  assert.equal(win.display || "", display);
});

test("PowerShell's execution policy, the console's code page, git's configuration, Node and npm, read for real", { skip, timeout: 120000 }, () => {
  const sys = makeSys();
  const p = executionPolicyFacts(sys);
  assert.equal(p.ok, true, p.error);
  assert.deepEqual(p.list.map((x) => x.scope), ["MachinePolicy", "UserPolicy", "Process", "CurrentUser", "LocalMachine"]);
  assert.equal(p.list.find((x) => x.scope === "CurrentUser").policy, ps("Get-ExecutionPolicy -Scope CurrentUser"));
  const c = codePageFacts(sys);
  assert.equal(c.ok, true, c.error);
  assert.ok(Number.isInteger(c.active) && c.active > 0);
  assert.equal(c.ansi, Number(ps("(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage').ACP")));
  const g = gitFacts(sys, process.cwd());
  assert.equal(g.ok, true, g.error);
  assert.match(g.version, /^\d+\.\d+/);
  const realAutocrlf = spawnSync("git", ["config", "--get", "core.autocrlf"], { encoding: "utf8", windowsHide: true }).stdout.trim();
  assert.equal(g.autocrlf ? g.autocrlf.value : "", realAutocrlf);
  const n = nodeFacts(sys);
  assert.equal(n.node, process.versions.node);
  assert.match(n.npm || "", /^\d+\.\d+\.\d+/);
});

test("WSL through wsl.exe: the UTF-16 output is decoded, and the names are those that wsl -l -q gives", { skip, timeout: 120000 }, () => {
  const sys = makeSys();
  const facts = windowsWslFacts(sys);
  const q = spawnSync(path.join(SYSTEM, "System32", "wsl.exe"), ["-l", "-q"], { windowsHide: true, input: "", timeout: 30000 });
  if (q.error || q.status !== 0) { assert.equal(facts.available, false, "no WSL, or none installed"); return; }
  const names = decodeWsl(q.stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean).sort();
  assert.deepEqual(facts.distros.map((d) => d.name).sort(), names);
  assert.ok(facts.distros.every((d) => [1, 2].includes(d.version) && d.state));
  assert.ok(facts.distros.filter((d) => d.isDefault).length <= 1);
  const raw = sys.run("wsl.exe", ["-l", "-v"], { binary: true, timeout: 30000 });
  assert.ok(raw.stdout.includes(0), "wsl.exe printed UTF-16: there are NUL bytes between the letters");
  assert.deepEqual(parseDistros(decodeWsl(raw.stdout)).map((d) => d.name).sort(), names);
});

test("Git Bash on this machine: every file that discoverGitBash names exists and starts", { skip, timeout: 120000 }, () => {
  const found = discoverGitBash(makeSys(), { cwd: process.cwd() });
  if (!found.length) return;
  for (const f of found) {
    assert.ok(fs.existsSync(f.path), f.path);
    const r = spawnSync(f.path, ["-c", "echo ok"], { encoding: "utf8", windowsHide: true, input: "", timeout: 30000 });
    assert.equal(r.stdout.trim(), "ok", f.path);
  }
});

test("every bash.exe on PATH: the list is that of where.exe, and System32's is the WSL launcher", { skip, timeout: 60000 }, () => {
  const sys = makeSys();
  const ours = bashOnPath(sys, { cwd: process.cwd() });
  const theirs = run("where.exe", ["bash.exe"]).stdout.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && fs.existsSync(s));
  assert.deepEqual(ours.map((b) => b.path.toLowerCase()), theirs.map((s) => s.toLowerCase()));
  for (const b of ours) if (/\\windows\\system32\\bash\.exe$/i.test(b.path)) assert.equal(b.kind, "wsl-launcher");
  for (const b of ours.filter((x) => x.kind === "git-bash")) assert.ok(fs.existsSync(path.win32.join(path.win32.dirname(b.path), "..", "cmd", "git.exe")) || fs.existsSync(path.win32.join(path.win32.dirname(b.path), "..", "..", "cmd", "git.exe")) || fs.existsSync(path.win32.join(path.win32.dirname(b.path), "..", "git-cmd.exe")) || fs.existsSync(path.win32.join(path.win32.dirname(b.path), "..", "mingw64", "bin", "git.exe")), `${b.path} is next to a Git`);
});

test("the PowerShell editions: Windows PowerShell 5.1 is found at System32 and says what PowerShell says of itself; so does the first pwsh.exe on PATH, when there is one", { skip, timeout: 180000 }, () => {
  const sys = makeSys();
  const facts = powerShellFacts(sys, { cwd: process.cwd() });
  const w51 = facts.editions.find((e) => e.id === "5.1");
  assert.ok(w51 && w51.probe && w51.probe.ok, JSON.stringify(w51));
  assert.equal(w51.probe.edition, "Desktop");
  assert.equal(w51.probe.version, ps("$PSVersionTable.PSVersion.ToString()"));
  assert.equal(w51.probe.languageMode, ps("$ExecutionContext.SessionState.LanguageMode"));
  assert.equal(w51.probe.effective, ps("Get-ExecutionPolicy"));
  const list = ps("Get-ExecutionPolicy -List | ForEach-Object { $_.Scope.ToString() + '=' + $_.ExecutionPolicy.ToString() }").split(/\r?\n/);
  assert.deepEqual(w51.probe.list.map((x) => `${x.scope}=${x.policy}`), list);
  const w7 = facts.editions.find((e) => e.id === "7" && e.onPath);
  if (!w7) return;
  assert.ok(w7.probe && w7.probe.ok, JSON.stringify(w7));
  assert.equal(w7.probe.edition, "Core");
  const direct = run(w7.path, ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.ToString(); $ExecutionContext.SessionState.LanguageMode; Get-ExecutionPolicy"]).stdout.trim().split(/\r?\n/);
  assert.deepEqual([w7.probe.version, w7.probe.languageMode, w7.probe.effective], direct);
});

test("where.exe and the order of the agents on PATH: the commands of one agent in three folders are listed in the order where.exe lists them", { skip, timeout: 60000 }, () => {
  const root = tmpDir("adw-where-");
  const dirs = ["d1", "d2", "d3"].map((d) => path.join(root, d));
  for (const d of dirs) fs.mkdirSync(d, { recursive: true });
  const files = [["d1", "codex.cmd"], ["d1", "codex"], ["d1", "codex.ps1"], ["d2", "codex.exe"], ["d2", "codex.bat"], ["d3", "codex.com"]];
  for (const [d, f] of files) fs.writeFileSync(path.join(root, d, f), "");
  const Path = [...dirs, ...plainWindowsPath()].join(";");
  const sys = makeSys({ env: { ...process.env, Path }, cwd: root, home: root });
  const theirs = run("where.exe", ["codex"], { ...process.env, Path }).stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const ours = findAgents(sys, { agents: ["codex"] }).agents.codex.entries.filter((e) => e.onPath).map((e) => e.path);
  // where.exe does not list .ps1 (it is not in PATHEXT); the tool lists it as a script, after the file it belongs to
  const withoutPs1 = ours.filter((p) => !/\.ps1$/i.test(p));
  assert.deepEqual(withoutPs1.map((p) => p.toLowerCase()), theirs.map((p) => p.toLowerCase()), `ours: ${ours.join(" | ")}`);
});

test("the Cursor launcher's version pattern: the rule that this tool applies to a folder name is the rule of PowerShell's -match", { skip, timeout: 60000 }, () => {
  const names = ["2026.06.16-20-30-07-a07d3ac", "2026.06.16-a07d3ac", "2026.6.1-ABCDEF", "2026.06.16", "x2026.06.16-abc", "2026.06.16-", "2026.06.16-xyz", "1.2.3-4", "2026.06.16-abc\u00e9"];
  for (const name of names) {
    const real = ps(`'${name}' -match '${PATTERN}'`);
    assert.equal(psMatch(PATTERN, name), real === "True", `${name}: PowerShell says ${real}`);
  }
});

test("the version resource of a program: the file versions are those that Get-Item shows for powershell.exe and for the node.exe that runs this", { skip, timeout: 60000 }, () => {
  const files = [POWERSHELL_51, process.execPath];
  const read = readFileVersions(makeSys(), files);
  for (const [i, f] of files.entries()) {
    const real = ps(`$v=(Get-Item -LiteralPath '${f}').VersionInfo; $v.FileVersion + '|' + $v.ProductVersion`).split("|");
    assert.equal(read[i].fileVersion, real[0].trim() || null, f);
    assert.equal(read[i].productVersion, real[1].trim() || null, f);
  }
});

test("the Codex desktop app, as the Microsoft Store package OpenAI.Codex: the tool and Get-AppxPackage agree (or there is none)", { skip, timeout: 120000 }, () => {
  const app = codexDesktopApp(makeSys());
  const real = ps("$p = Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1; if ($p) { $p.InstallLocation + '|' + $p.Version.ToString() }");
  if (!real) { assert.equal(app, null); return; }
  assert.deepEqual([app.installLocation, app.version], real.split("|").map((s) => s.trim()));
});

test("bash syntax in a hook command: what bashReasons says a PowerShell does differently is what Windows PowerShell 5.1 does, put to the real powershell.exe", { skip, timeout: 180000 }, (t) => {
  const dir = tmpDir("adw-bash-");
  const rows = [
    // [reason, the command line, a test of what the real PowerShell printed]
    ["and-or", 'node -e "0" && echo done', (r) => r.status !== 0 && /not a valid statement separator/.test(r.stderr)],
    ["variable", 'echo "[$ADW_VAR]"', (r) => r.stdout.trim() === "[]"],
    ["dev-null", "echo hi > /dev/null", (r) => /Could not find a part of the path|DirectoryNotFound/i.test(r.stderr)],
    ["builtin", "export ADW_X=1", (r) => /The term 'export' is not recognized/.test(r.stderr)],
    ["test", "[ -f package.json ]", (r) => r.status !== 0 && r.stderr.length > 0],
    ["if-then", "if [ -f package.json ]; then echo yes; fi", (r) => r.status !== 0 && r.stderr.length > 0],
    ["heredoc", "cat <<EOF\nx\nEOF", (r) => r.status !== 0 && /Missing file specification after redirection operator|not recognized/i.test(r.stderr)],
    ["sh-file", "./adw-no-such-hook.sh", (r) => /is not recognized/.test(r.stderr)],
  ];
  const env = psEnv({ ADW_VAR: "bar" });
  for (const [id, command, behaves] of rows) {
    const reasons = bashReasons(command, { edition: "5.1" }).map((x) => x.id);
    assert.ok(reasons.includes(id), `${id}: the tool names ${JSON.stringify(reasons)} for ${JSON.stringify(command)}`);
    const r = spawnSync(POWERSHELL_51, ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", windowsHide: true, input: "", cwd: dir, env, timeout: 60000 });
    assert.ok(behaves(r), `${id}: Windows PowerShell 5.1 gave exit ${r.status}, stdout ${JSON.stringify(r.stdout.slice(0, 120))}, stderr ${JSON.stringify(r.stderr.slice(0, 200))}`);
  }
  // a command that both shells read the same way has no reason, and works
  const same = 'node -e "process.stdout.write(\'same\')"';
  assert.deepEqual(bashReasons(same, { edition: "5.1" }), []);
  assert.equal(spawnSync(POWERSHELL_51, ["-NoProfile", "-NonInteractive", "-Command", same], { encoding: "utf8", windowsHide: true, input: "", cwd: dir, env }).stdout, "same");
  // PowerShell 7 reads && and ||: the tool does not name them for edition 7, and a pwsh.exe on PATH (the CI runners have one) runs the line
  const pwsh = run("where.exe", ["pwsh"]).stdout.split(/\r?\n/).map((s) => s.trim()).find((s) => s && fs.existsSync(s));
  assert.equal(bashReasons('node -e "0" && echo done', { edition: "7" }).some((x) => x.id === "and-or"), false);
  if (pwsh) {
    const r = spawnSync(pwsh, ["-NoProfile", "-NonInteractive", "-Command", 'node -e "0" && echo done'], { encoding: "utf8", windowsHide: true, input: "", cwd: dir, env: psEnv(), timeout: 60000 });
    assert.equal(r.stdout.trim(), "done", `PowerShell 7 at ${pwsh}: ${r.stderr}`);
  } else t.diagnostic("no pwsh.exe on PATH: PowerShell 7 was not asked about &&");
});

test("check, agents and --markdown on the real machine, in a throwaway world with a PATH of system folders: they read, and write nothing of their own", { skip, timeout: 240000 }, () => {
  const w = world("checkreal");
  const env = { ...w.env };
  const key = Object.keys(env).find((k) => k.toLowerCase() === "path") || "Path";
  env[key] = plainWindowsPath().join(";");
  const listing = () => fs.readdirSync(w.base, { recursive: true }).map((p) => String(p).replace(/\//g, "\\")).sort();
  const before = listing();
  const r = runCli(["check", "--json", "--project", w.work], { cwd: w.work, env });
  assert.ok([0, 1].includes(r.code), r.all);
  const doc = JSON.parse(r.out);
  assert.equal(doc.kind, "windows");
  assert.ok(Array.isArray(doc.agents) && doc.agents.every((a) => ["claude", "codex", "gemini", "copilot", "cursor"].includes(a)));
  assert.ok(doc.machine.powershell.some((e) => e.id === "5.1"));
  assert.ok(doc.findings.every((f) => /^(claude|codex|gemini|copilot|cursor)\.[a-z0-9-]+$/.test(f.id) && ["verified", "documented", "not verified"].includes(f.basis)), "every finding has an agent-qualified id and a basis");
  const appeared = listing().filter((p) => !before.includes(p));
  // the caches of the programs it starts (Windows PowerShell keeps one under ProgramData and one under AppData) appear in the folders that stand in for those places
  const cacheFolder = (p) => /^home\\(AppData|no-program-data)(\\|$)/.test(p);
  assert.ok(appeared.every(cacheFolder), `check wrote nothing of its own: ${appeared.filter((p) => !cacheFolder(p)).join(", ")}`);
  for (const folder of [w.claude, w.codex, w.copilot, w.gemini, w.cursor]) assert.ok(!fs.existsSync(folder), `${folder} was not made`);
  const agents = runCli(["agents", "--json"], { cwd: w.work, env });
  assert.equal(agents.code, 0, agents.all);
  assert.deepEqual(JSON.parse(agents.out).agents, ["claude", "codex", "gemini", "copilot", "cursor"]);
  assert.deepEqual(Object.keys(JSON.parse(agents.out).inventory), ["claude", "codex", "gemini", "copilot", "cursor"]);
  const md = runCli(["check", "--markdown", "--project", w.work], { cwd: w.work, env });
  assert.equal(md.code, 0);
  assert.ok(md.out.split("\n").length <= 30);
  assert.ok(md.out.split("\n").every((l) => l.length <= 500));
});

test("the exit code of a hook through Windows PowerShell: -Command turns the exit code 2 of a program into 1, and the check that Gemini CLI appends keeps it", { skip, timeout: 60000 }, () => {
  const dir = tmpDir("adw-exit-");
  const hook = "node -e \"process.exit(2)\"";
  const plain = spawnSync(POWERSHELL_51, ["-NoProfile", "-NonInteractive", "-Command", hook], { encoding: "utf8", windowsHide: true, input: "", cwd: dir, env: psEnv() });
  assert.equal(plain.status, 1, "Codex CLI runs a hook like this: its exit code 2 reaches it as 1, which is not a block");
  const kept = spawnSync(POWERSHELL_51, ["-NoProfile", "-NonInteractive", "-Command", `${hook}; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`], { encoding: "utf8", windowsHide: true, input: "", cwd: dir, env: psEnv() });
  assert.equal(kept.status, 2, "Gemini CLI appends this check, and its hook that exits with 2 blocks");
  const ok = spawnSync(POWERSHELL_51, ["-NoProfile", "-NonInteractive", "-Command", 'node -e "process.exit(0)"'], { encoding: "utf8", windowsHide: true, input: "", cwd: dir, env: psEnv() });
  assert.equal(ok.status, 0);
});
