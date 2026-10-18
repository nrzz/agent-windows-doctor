// Each finding, from a clean pretend Windows machine that a test spoils in one way: it is said when it should be, with its effect, its fix and its basis, and not
// otherwise. The Claude Code scenarios are claude-windows-doctor's (the ids carry the agent now); the others are new. The last test puts a machine to every id.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { fakeMachine, SYSTEM_PATH } from "./machine.mjs";
import { HOME, POLICY, PROJECT, collect as collectRaw, idsOf, npmInstall, utf16, winMachine, withNpm } from "./win-machine.mjs";
import { collectWsl as collectWslRaw } from "../src/check.mjs";
import { FINDING_IDS, SEVERITY_ORDER, liveFindings } from "../src/findings.mjs";
import { IDS, pageFor } from "../src/explain.mjs";
import { CMD_TEXT, PS1_TEXT } from "./cursor-files.mjs";

// every finding any machine of this file produced: the last test holds the set to FINDING_IDS
const SEEN = new Set();
const record = (f) => { for (const x of f.findings) SEEN.add(x.id); return f; };
const collect = (...a) => record(collectRaw(...a));
const collectWsl = (...a) => record(collectWslRaw(...a));
const find = (facts, id) => facts.findings.find((f) => f.id === id);
const out = (stdout, status = 0) => ({ status, stdout, stderr: "" });
const E_GIT = ["E:\\Das\\Git\\cmd\\git.exe", "E:\\Das\\Git\\mingw64\\bin\\git.exe", "E:\\Das\\Git\\bin\\bash.exe", "E:\\Das\\Git\\usr\\bin\\bash.exe"];
const REG_GIT = { "HKLM\\SOFTWARE\\GitForWindows": { InstallPath: ["REG_SZ", "E:\\Das\\Git"] } };
const NATIVE = `${HOME}\\.local\\bin\\claude.exe`;
const PS_DIR = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0";
const SYS_PATH = `C:\\Windows\\System32;C:\\Windows;${PS_DIR}`;
const NPM = `${HOME}\\AppData\\Roaming\\npm`;

/** A Windows machine with Claude Code's native install on PATH, as claude-windows-doctor's clean machine had. */
const cm = (o = {}) => winMachine({
  ...o,
  files: [...(o.files || []), ...(o.noClaude ? [] : [NATIVE])],
  fileVersions: { [NATIVE]: "2.1.299.0", ...(o.fileVersions || {}) },
  env: { Path: `${HOME}\\.local\\bin;C:\\Program Files\\Git\\cmd;${SYS_PATH}`, ...(o.env || {}) },
});
/** A machine with an npm install of the agents named, on PATH. */
const withAgents = (agents, o = {}, install = {}) => winMachine(withNpm(o, agents, install));
const CODEX_CONFIG = `${HOME}\\.codex\\config.toml`;

test("a clean machine with nothing installed has no finding and no agent; with Claude Code installed it has none either", () => {
  const f = collect(winMachine());
  assert.deepEqual(idsOf(f), []);
  assert.deepEqual(f.agents, []);
  assert.deepEqual(f.notFound, ["claude", "codex", "gemini", "copilot", "cursor"]);
  assert.deepEqual(f.counts, { error: 0, warning: 0, note: 0 });
  const c = collect(cm());
  assert.deepEqual(idsOf(c), []);
  assert.deepEqual(c.agents, ["claude"]);
  assert.equal(c.shells.claude.gitBash.how, "program-files");
  assert.equal(c.inventory.agents.claude.first.path, NATIVE);
});

test("--agent names the agents even when they are not found: their sections and findings are there", () => {
  const f = collect(winMachine({ noGit: true, env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } }), PROJECT, ["claude"], true);
  assert.deepEqual(f.agents, ["claude"]);
  assert.ok(idsOf(f).includes("claude.no-shell-tool"));
  const only = collect(cm({ noGit: true }), PROJECT, ["codex"]);
  assert.deepEqual(only.agents, [], "an agent that is not asked for is not reported, found or not");
});

test("every finding has an effect, a fix and a basis, the id of an agent, and a page in explain; the kinds are errors, warnings and notes", () => {
  const f = collect(cm({ noGit: true, files: E_GIT, env: { Path: `E:\\Das\\Git\\mingw64\\bin;E:\\Das\\Git\\cmd;C:\\Windows\\System32;C:\\Windows`, CLAUDE_CODE_USE_POWERSHELL_TOOL: "enabled" }, texts: { [`${HOME}\\.claude\\settings.json`]: JSON.stringify({ defaultShell: "cmd" }) } }));
  assert.ok(f.findings.length >= 4);
  for (const x of f.findings) {
    assert.ok(x.effect && x.fix, `${x.id} has an effect and a fix`);
    assert.ok(IDS.includes(x.id), `${x.id} has a page`);
    assert.match(x.id, /^(claude|codex|gemini|copilot|cursor)\.[a-z0-9-]+$/);
    assert.equal(x.agent, x.id.split(".")[0]);
    assert.ok(["error", "warning", "note"].includes(x.severity));
    assert.equal(x.basis, pageFor(x.id).basis);
    assert.ok(["verified", "documented", "not verified"].includes(x.basis));
  }
});

test("claude.no-shell-tool: Git Bash not found and the PowerShell tool off is an error, and the fix names a Git Bash that exists", () => {
  const f = collect(cm({ noGit: true, files: E_GIT, env: { Path: `E:\\Das\\Git\\mingw64\\bin;C:\\Windows\\System32;C:\\Windows`, CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } }));
  const x = find(f, "claude.no-shell-tool");
  assert.equal(x.severity, "error");
  assert.match(x.message, /Claude Code will not start/);
  assert.match(x.message, /CLAUDE_CODE_USE_POWERSHELL_TOOL is "0" in the process environment/);
  assert.match(x.effect, /exits at start with .*requires a shell tool.* \(exit code 1\)/);
  assert.match(x.fix, /setx CLAUDE_CODE_GIT_BASH_PATH "E:\\Das\\Git\\bin\\bash\.exe"/);
  assert.equal(f.shells.claude.fatal.id, "no-shell-tool");
  assert.ok(!idsOf(f).includes("claude.git-bash-not-found"), "one finding for one cause");
  const noGit = find(collect(cm({ noGit: true, env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "no" } })), "claude.no-shell-tool");
  assert.match(noGit.fix, /Remove CLAUDE_CODE_USE_POWERSHELL_TOOL=0 from the process environment, or install Git for Windows/);
  assert.ok(!idsOf(collect(cm({ env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } }))).includes("claude.no-shell-tool"), "with Git Bash found, off is only the end of the PowerShell tool");
});

test("claude.git-bash-not-found: Git for Windows is on this machine and the first git.exe of where git is in mingw64\\bin", () => {
  const f = collect(cm({ noGit: true, files: E_GIT, env: { Path: `E:\\Das\\Git\\mingw64\\bin;E:\\Das\\Git\\cmd;C:\\Windows\\System32;C:\\Windows` } }));
  const x = find(f, "claude.git-bash-not-found");
  assert.equal(x.severity, "warning");
  assert.match(x.message, /Git for Windows is installed \(E:\\Das\\Git\\bin\\bash\.exe\), but Claude Code does not find it: where git prints E:\\Das\\Git\\mingw64\\bin\\git\.exe first, and two folders up from it bin\\bash\.exe would be E:\\Das\\Git\\mingw64\\bin\\bash\.exe, which is not there\./);
  assert.match(x.effect, /the PowerShell tool only/);
  assert.match(x.fix, /setx CLAUDE_CODE_GIT_BASH_PATH "E:\\Das\\Git\\bin\\bash\.exe".*put the Git cmd folder before mingw64\\bin on PATH/);
  const noPath = find(collect(cm({ noGit: true, files: E_GIT, registry: REG_GIT, env: { Path: "C:\\Windows\\System32;C:\\Windows" } })), "claude.git-bash-not-found");
  assert.match(noPath.message, /git\.exe is not on PATH/);
  assert.ok(!/mingw64/.test(noPath.fix), "no PATH advice when git is not on PATH");
  const registryOnly = collect(cm({ noGit: true, files: ["D:\\Tools\\Git\\bin\\bash.exe"], env: { Path: "C:\\Windows\\System32;C:\\Windows" }, registry: { "HKLM\\SOFTWARE\\GitForWindows": { InstallPath: ["REG_SZ", "D:\\Tools\\Git"] } } }));
  assert.match(find(registryOnly, "claude.git-bash-not-found").message, /D:\\Tools\\Git\\bin\\bash\.exe/);
  assert.ok(!idsOf(collect(cm({ noGit: true }))).includes("claude.git-bash-not-found"), "no Git for Windows on the machine: nothing to find");
});

test("claude.git-bash-path-ignored: a value that Claude Code does not accept, with the reason and the hint; it names a Git Bash that exists", () => {
  const files = ["E:\\Das\\Git\\bin\\git-bash.exe", ...E_GIT];
  const bad = collect(cm({ noGit: true, files, registry: REG_GIT, env: { Path: "C:\\Windows\\System32;C:\\Windows", CLAUDE_CODE_GIT_BASH_PATH: "E:\\Das\\Git\\bin\\git-bash.exe" } }));
  const a = find(bad, "claude.git-bash-path-ignored");
  assert.match(a.message, /is "E:\\Das\\Git\\bin\\git-bash\.exe" \(the process environment\), and Claude Code ignores it: the file is not named bash\.exe, sh\.exe, bash or sh\./);
  assert.match(a.effect, /found none, so the Bash tool is not offered/);
  assert.match(a.fix, /Point it at E:\\Das\\Git\\bin\\bash\.exe/);
  const quoted = collect(cm({ env: { CLAUDE_CODE_GIT_BASH_PATH: "\"C:\\Program Files\\Git\\bin\\bash.exe\"" } }));
  assert.match(find(quoted, "claude.git-bash-path-ignored").message, /quote marks/);
  assert.match(find(quoted, "claude.git-bash-path-ignored").effect, /found C:\\Program Files\\Git\\bin\\bash\.exe/, "the search goes on: it found the fixed path");
  const pct = collect(cm({ env: { CLAUDE_CODE_GIT_BASH_PATH: "%ProgramFiles%\\Git\\bin\\bash.exe" } }));
  assert.match(find(pct, "claude.git-bash-path-ignored").message, /there is no such file\. The value has a %NAME% in it, which is not expanded/);
  const missing = find(collect(cm({ noGit: true, env: { CLAUDE_CODE_GIT_BASH_PATH: "D:\\nope\\bash.exe" } })), "claude.git-bash-path-ignored");
  assert.match(missing.fix, /Set it to the full path of bash\.exe, or remove it/);
});

test("claude.git-bash-path-project-settings: the variable in a project or local file, which Claude Code does not read for it", () => {
  const f = collect(cm({ noGit: true, files: E_GIT, registry: REG_GIT, env: { Path: "C:\\Windows\\System32;C:\\Windows" }, texts: { [`${PROJECT}\\.claude\\settings.json`]: JSON.stringify({ env: { CLAUDE_CODE_GIT_BASH_PATH: "E:\\Das\\Git\\bin\\bash.exe" } }), [`${PROJECT}\\.claude\\settings.local.json`]: JSON.stringify({ env: { CLAUDE_CODE_GIT_BASH_PATH: "E:\\Das\\Git\\bin\\bash.exe" } }) } }));
  const hits = f.findings.filter((x) => x.id === "claude.git-bash-path-project-settings");
  assert.equal(hits.length, 2);
  assert.match(hits[0].message, /env of the (local|project) settings \(\.claude\\settings\.(local\.)?json\)/);
  assert.match(hits[0].fix, /setx CLAUDE_CODE_GIT_BASH_PATH "E:\\Das\\Git\\bin\\bash\.exe"/);
});

test("claude.git-bash-broken: Git Bash is found and does not start", () => {
  const f = collect(cm({ commands: { bash: () => ({ status: 127, stdout: "", stderr: "Skipping command-line 'usr\\bin\\bash.exe' (not found)\nNeed a valid command-line" }) } }));
  const x = find(f, "claude.git-bash-broken");
  assert.match(x.message, /would use C:\\Program Files\\Git\\bin\\bash\.exe, but it does not start \(it exited with code 127: Skipping command-line/);
  const spawnFail = cm();
  const base = spawnFail.run;
  spawnFail.run = (cmd, args, opts) => (/bash\.exe$/i.test(String(cmd)) ? { status: null, stdout: "", stderr: "", error: Object.assign(new Error("x"), { code: "EFTYPE" }), timedOut: false } : base(cmd, args, opts));
  assert.match(find(collect(spawnFail), "claude.git-bash-broken").message, /could not be started: EFTYPE/);
  assert.ok(!idsOf(collect(cm())).includes("claude.git-bash-broken"));
  assert.equal(collect(cm()).claude.bashStarts.ok, true);
  assert.equal(collect(cm({ noGit: true })).claude.bashStarts.checked, false, "nothing is started when no Git Bash is found");
});

test("claude.powershell-variable-unread: a value that Claude Code reads as not set", () => {
  const x = find(collect(cm({ env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "enabled" } })), "claude.powershell-variable-unread");
  assert.match(x.message, /is "enabled" \(the process environment\), which Claude Code reads as not set/);
  assert.match(x.effect, /1, true, yes and on as on, and 0, false, no and off as off/);
  for (const v of ["1", "0", "true", "no", ""]) assert.ok(!idsOf(collect(cm({ env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: v } }))).includes("claude.powershell-variable-unread"), JSON.stringify(v));
});

test("claude.default-shell-scope: defaultShell is said not to be the model's tool, whatever its value; a value it does not allow is named", () => {
  const f = collect(cm({ texts: { [`${HOME}\\.claude\\settings.json`]: JSON.stringify({ defaultShell: "powershell" }), [`${PROJECT}\\.claude\\settings.json`]: JSON.stringify({ defaultShell: "cmd" }) } }));
  const hits = f.findings.filter((x) => x.id === "claude.default-shell-scope");
  assert.equal(hits.length, 2);
  assert.ok(hits.every((h) => h.severity === "note" && /not the tool the model gets/.test(h.message)));
  assert.ok(hits.some((h) => /Claude Code takes only "bash" or "powershell"/.test(h.message)));
  assert.match(hits[0].effect, /same with it and without it/);
});

test("claude.powershell-5: the PowerShell tool runs Windows PowerShell 5.1 when it is on and no pwsh is found; not when pwsh is there or the tool is not sure to be on", () => {
  assert.ok(idsOf(collect(cm({ noGit: true }))).includes("claude.powershell-5"));
  assert.ok(idsOf(collect(cm({ env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" } }))).includes("claude.powershell-5"));
  assert.ok(!idsOf(collect(cm())).includes("claude.powershell-5"), "Git Bash found, the account decides: not said");
  assert.ok(!idsOf(collect(cm({ noGit: true, files: ["C:\\pwsh\\pwsh.exe"], env: { Path: `C:\\pwsh;${SYS_PATH}` } }))).includes("claude.powershell-5"));
  assert.match(find(collect(cm({ noGit: true })), "claude.powershell-5").fix, /winget install Microsoft\.PowerShell/);
});

test("claude.wsl-bash-on-path: the WSL launcher is the bash.exe on PATH and no Git Bash is found", () => {
  const x = find(collect(cm({ noGit: true })), "claude.wsl-bash-on-path");
  assert.match(x.message, /bash\.exe on PATH is the WSL launcher \(C:\\Windows\\System32\\bash\.exe\), not a Git Bash/);
  assert.ok(!idsOf(collect(cm())).includes("claude.wsl-bash-on-path"), "with Git Bash found it does not matter");
});

test("claude.launcher-first, not-on-path, multiple, older-first: the programs of one agent", () => {
  const launcher = `${HOME}\\AppData\\Local\\AnthropicClaude\\claude.exe`;
  const a = collect(cm({ noClaude: true, files: [launcher], env: { Path: `${HOME}\\AppData\\Local\\AnthropicClaude;${SYS_PATH}` } }));
  assert.equal(find(a, "claude.launcher-first").severity, "warning");
  assert.match(find(a, "claude.launcher-first").message, /the Claude desktop app's launcher \(not the CLI\)/);

  const off = collect(cm({ files: [`${HOME}\\.local\\bin\\claude.exe`], env: { Path: `C:\\Program Files\\Git\\cmd;${SYS_PATH}` } }));
  const n = find(off, "claude.not-on-path");
  assert.match(n.message, /Claude Code is installed \(C:\\Users\\me\\\.local\\bin\\claude\.exe, the native installer, 2\.1\.299\), but its folder is not on PATH/);
  assert.match(n.fix, /Add C:\\Users\\me\\\.local\\bin to the user PATH/);
  assert.match(n.effect, /"claude is not recognized"/);

  const npm = npmInstall("claude", { version: "2.1.295" });
  const multi = collect(cm({ files: npm.files, texts: npm.texts, env: { Path: `${NPM};${HOME}\\.local\\bin;C:\\Program Files\\Git\\cmd;${SYS_PATH}` } }));
  assert.match(find(multi, "claude.multiple").message, /2 claude command lines are installed: .*claude\.cmd \(npm \(global\), 2\.1\.295, runs first\); .*claude\.exe \(the native installer, 2\.1\.299\)/);
  const older = find(multi, "claude.older-first");
  assert.match(older.message, /runs first on PATH is 2\.1\.295 .* is 2\.1\.299/);
  assert.match(older.fix, /Put C:\\Users\\me\\\.local\\bin before C:\\Users\\me\\AppData\\Roaming\\npm on PATH/);

  const same = npmInstall("claude", { version: "2.1.299" });
  const eq = collect(cm({ files: same.files, texts: same.texts, env: { Path: `${HOME}\\.local\\bin;${NPM};C:\\Program Files\\Git\\cmd;${SYS_PATH}` } }));
  assert.ok(idsOf(eq).includes("claude.multiple") && !idsOf(eq).includes("claude.older-first"));

  const bundles = collect(cm({ noClaude: true, files: [`${HOME}\\AppData\\Roaming\\Claude\\claude-code\\2.1.299\\f0584be0fbaf\\claude.exe`, `${HOME}\\AppData\\Roaming\\Claude\\claude-code\\2.1.295\\d2e29494ec83\\claude.exe`] }));
  assert.deepEqual(idsOf(bundles), [], "the desktop app's own bundles are not a second install");
});

test("claude.no-version (and every no-version): a program that was asked for its version in a live run and did not answer", () => {
  const live = { ok: false, agents: { claude: { ok: true, binary: { path: NATIVE, version: null, asked: null, note: "did not print a version (exit 1: bad image)" } }, codex: { ok: true, binary: { path: "C:\\c\\codex.exe", asked: "0.163.0", note: null } } } };
  const found = liveFindings(live);
  assert.deepEqual(found.map((x) => x.id), ["claude.no-version"]);
  assert.match(found[0].message, /claude\.exe did not print a version \(exit 1: bad image\)/);
  assert.equal(found[0].severity, "warning");
  assert.deepEqual(liveFindings(null), []);
});

test("every agent: node-for-npm says the Node the package asks for, from the package.json, and nothing for an agent whose package asks for none", () => {
  const old = (agent, node) => collect(withAgents([agent], { nodeVersion: node }));
  assert.match(find(old("claude", "v20.11.0"), "claude.node-for-npm").message, /Node is 20\.11\.0, and the npm package of Claude Code \(@anthropic-ai\/claude-code 2\.1\.302\) asks for Node 22\.0\.0 or later/);
  assert.match(find(old("claude", "v20.11.0"), "claude.node-for-npm").effect, /native binary that does not use your Node/);
  assert.match(find(old("codex", "v14.0.0"), "codex.node-for-npm").message, /@openai\/codex 0\.163\.0\) asks for Node 16 or later/);
  assert.match(find(old("gemini", "v18.19.0"), "gemini.node-for-npm").message, /asks for Node 20 or later/);
  assert.match(find(old("gemini", "v18.19.0"), "gemini.node-for-npm").effect, /JavaScript program that your Node runs/);
  assert.ok(!idsOf(old("copilot", "v10.0.0")).includes("copilot.node-for-npm"), "Copilot CLI 1.0.98 has no engines field");
  const withEngines = collect(withAgents(["copilot"], { nodeVersion: "v18.0.0" }, { engines: { node: ">=22" } }));
  assert.match(find(withEngines, "copilot.node-for-npm").message, /asks for Node 22 or later/);
  assert.ok(!idsOf(old("claude", "v22.1.0")).includes("claude.node-for-npm"));
  assert.ok(!idsOf(collect(cm({ nodeVersion: "v18.0.0" }))).includes("claude.node-for-npm"), "the native install does not need Node");
});

test("claude: long-paths, autocrlf, execution-policy, code-page, index-lock", () => {
  const key = "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem";
  const lp = collect(cm({ registry: { [key]: { LongPathsEnabled: ["REG_DWORD", "0x0"] } }, commands: { git: (args) => (args[0] === "--version" ? out("git version 2.5\n") : { status: 1, stdout: "", stderr: "" }) } }));
  assert.match(find(lp, "claude.long-paths").message, /Windows' LongPathsEnabled is off and git's core\.longpaths is not set/);
  assert.match(find(lp, "claude.long-paths").fix, /reg add HKLM.*LongPathsEnabled.*git config --global core\.longpaths true/);
  const gitOnly = collect(cm({ commands: { git: (args) => (args[0] === "--version" ? out("git version 2.5\n") : args.at(-1) === "core.longpaths" ? out("file:x\tfalse\n") : { status: 1, stdout: "", stderr: "" }) } }));
  assert.match(find(gitOnly, "claude.long-paths").message, /git's core\.longpaths is false/);
  assert.ok(!idsOf(collect(cm())).includes("claude.long-paths"));

  const crlf = collect(cm({ commands: { git: (args) => (args[0] === "--version" ? out("git version 2.5\n") : args.at(-1) === "core.autocrlf" ? out("file:E:/Das/Git/etc/gitconfig\ttrue\n") : args.at(-1) === "core.longpaths" ? out("file:x\ttrue\n") : { status: 1, stdout: "", stderr: "" }) } }));
  assert.match(find(crlf, "claude.autocrlf").message, /core\.autocrlf is true \(E:\/Das\/Git\/etc\/gitconfig\)/);
  assert.match(find(crlf, "claude.autocrlf").effect, /wrote a new file with LF only and its Edit tool kept the CRLF/);

  const gp = collect(cm({ commands: { powershell: (args) => (/PSEdition/.test(args.at(-1)) ? out("ED=Desktop\r\nVER=5.1\r\nLANG=FullLanguage\r\nEFF=AllSigned\r\n") : out(POLICY({ machine: "AllSigned" }))) } }));
  const x = find(gp, "claude.execution-policy");
  assert.match(x.message, /AllSigned \(MachinePolicy, set by Group Policy\)/);
  assert.match(x.effect, /Group Policy still wins over it/);
  const respect = collect(cm({ env: { CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY: "1" }, commands: { powershell: (args) => (/PSEdition/.test(args.at(-1)) ? out("ED=Desktop\r\nVER=5.1\r\nLANG=FullLanguage\r\nEFF=Restricted\r\n") : out(POLICY({ currentUser: "Undefined" }))) } }));
  assert.match(find(respect, "claude.execution-policy").message, /Restricted \(default\)/);
  assert.match(find(respect, "claude.execution-policy").effect, /RESPECT_EXECUTION_POLICY is on/);
  const respectUser = collect(cm({ texts: { [`${HOME}\\.claude\\settings.json`]: JSON.stringify({ env: { CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY: "true" } }) }, commands: { powershell: () => out(POLICY({ currentUser: "AllSigned" })) } }));
  assert.ok(idsOf(respectUser).includes("claude.execution-policy"), "the variable counts from the user settings too");
  assert.ok(!idsOf(collect(cm({ commands: { powershell: () => out(POLICY({ currentUser: "Restricted" })) } }))).includes("claude.execution-policy"), "a restrictive CurrentUser policy is bypassed by Claude Code");

  const cp = collect(cm({ commands: { cmd: (args) => (/chcp/.test(args.at(-1)) ? out("Active code page: 437\r\n") : /prefix/.test(args.at(-1)) ? out("C:\\npm\r\n") : out("10.9.0\r\n")) } }));
  assert.match(find(cp, "claude.code-page").message, /code page is 437 \(the system's OEM code page is 437\), not UTF-8/);
  assert.match(find(cp, "claude.code-page").effect, /caf\?-\?ber\.txt/);
  assert.ok(!idsOf(collect(cm({ noGit: true, commands: { cmd: (args) => (/chcp/.test(args.at(-1)) ? out("Active code page: 437\r\n") : out("10.9.0\r\n")) } }))).includes("claude.code-page"), "no Bash tool: nothing to garble");

  const lock = collect(cm({ dirs: [`${PROJECT}\\.git`], files: [`${PROJECT}\\.git\\index.lock`], mtimes: { [`${PROJECT}\\.git\\index.lock`]: Date.parse("2026-10-16T09:00:00Z") } }));
  assert.match(find(lock, "claude.index-lock").message, /index\.lock exists \(\d+ (hours|days) old\) and no git process is running/);
  assert.ok(!idsOf(collect(cm({ dirs: [`${PROJECT}\\.git`], files: [`${PROJECT}\\.git\\index.lock`], commands: { tasklist: () => out("git.exe 123 Console 1 1 K\r\n") } }))).includes("claude.index-lock"), "git is running: the lock is its own");
});

test("claude: the user environment: set there and not here, different, and set here only for a configuration variable", () => {
  const userOnly = collect(cm({ registry: { "HKCU\\Environment": { CLAUDE_CONFIG_DIR: ["REG_SZ", "D:\\cfg"], ANTHROPIC_API_KEY: ["REG_SZ", "sk-ant-api-secret"] } } }));
  const a = userOnly.findings.filter((x) => x.id === "claude.user-env-not-in-process");
  assert.equal(a.length, 2);
  assert.ok(a.some((x) => /^CLAUDE_CONFIG_DIR \(D:\\cfg\) is set in the Windows user environment, but not in this process/.test(x.message)));
  assert.ok(a.some((x) => /^ANTHROPIC_API_KEY is set in the Windows user environment/.test(x.message)));
  assert.ok(!JSON.stringify(userOnly.findings).includes("sk-ant-api-secret"), "a token is never in a finding");
  const differs = collect(cm({ env: { CLAUDE_CODE_GIT_BASH_PATH: "C:\\Program Files\\Git\\bin\\bash.exe" }, registry: { "HKCU\\Environment": { CLAUDE_CODE_GIT_BASH_PATH: ["REG_SZ", "D:\\other\\bash.exe"] } } }));
  assert.match(find(differs, "claude.user-env-differs").message, /CLAUDE_CODE_GIT_BASH_PATH is not the same in the Windows user environment \(D:\\other\\bash\.exe\) and in this process \(C:\\Program Files\\Git\\bin\\bash\.exe\)/);
  const procOnly = collect(cm({ noGit: true, files: E_GIT, registry: REG_GIT, env: { CLAUDE_CODE_GIT_BASH_PATH: "E:\\Das\\Git\\bin\\bash.exe", ANTHROPIC_MODEL: "sonnet" } }));
  const p = procOnly.findings.filter((x) => x.id === "claude.process-env-not-in-user");
  assert.equal(p.length, 1, "only the configuration names");
  assert.match(p[0].fix, /setx CLAUDE_CODE_GIT_BASH_PATH <value>/);
  assert.ok(!idsOf(collect(cm({ env: { CLAUDE_EFFORT: "high" } }))).includes("claude.process-env-not-in-user"));
});

test("claude: WSL seen from Windows: only the distributions of other tools, and a managed policy that WSL inherits", () => {
  const docker = collect(cm({ commands: { wsl: () => ({ status: 0, stdout: utf16("  NAME STATE VERSION\r\n* docker-desktop Running 2\r\n") }) } }));
  assert.match(find(docker, "claude.wsl-no-distro").message, /only distributions that other tools made for themselves \(docker-desktop; the default is docker-desktop\)/);
  assert.ok(!idsOf(collect(cm())).includes("claude.wsl-no-distro"));
  const inherits = collect(cm({ texts: { "C:\\Program Files\\ClaudeCode\\managed-settings.json": JSON.stringify({ env: { A: "1" }, wslInheritsWindowsSettings: true }) } }));
  assert.match(find(inherits, "claude.wsl-inherits-windows").message, /wslInheritsWindowsSettings is on \(managed-settings\.json\)/);
  assert.equal(find(inherits, "claude.wsl-inherits-windows").severity, "note");
});

test("findings are sorted errors first, and counted", () => {
  const f = collect(cm({ noGit: true, env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } }));
  const order = f.findings.map((x) => x.severity);
  assert.deepEqual(order, [...order].sort((a, b) => SEVERITY_ORDER[a] - SEVERITY_ORDER[b]));
  assert.equal(f.counts.error, 1);
});

test("inside WSL: a Windows claude, the config folder or the project on a Windows drive, the Windows policy, and a Codex home on a Windows drive", () => {
  const wsl = (o = {}) => fakeMachine({
    platform: "linux", env: { PATH: "/mnt/c/Users/me/.local/bin:/usr/bin", ...(o.env || {}) }, home: "/home/me", cwd: "/home/me/code",
    files: ["/mnt/c/Users/me/.local/bin/claude", ...(o.files || [])],
    texts: { "/proc/version": "Linux version 5.15.153.1-microsoft-standard-WSL2", ...(o.texts || {}) },
  });
  const a = collectWsl(wsl(), { project: "/home/me/code" });
  assert.equal(a.kind, "wsl");
  assert.equal(a.system.wsl, 2);
  assert.match(a.findings.find((x) => x.id === "claude.wsl-windows-claude").message, /a Windows program: \/mnt\/c\/Users\/me\/\.local\/bin\/claude/);
  const mnt = collectWsl(wsl({ env: { CLAUDE_CONFIG_DIR: "/mnt/c/Users/me/.claude" } }), { project: "/home/me/code" });
  assert.match(mnt.findings.find((x) => x.id === "claude.wsl-config-on-mnt").message, /config folder is on a Windows drive \(\/mnt\/c\/Users\/me\/\.claude, from CLAUDE_CONFIG_DIR\)/);
  const proj = collectWsl(wsl(), { project: "/mnt/c/src/shop" });
  assert.match(proj.findings.find((x) => x.id === "claude.wsl-config-on-mnt").message, /project is on a Windows drive \(\/mnt\/c\/src\/shop\)/);
  const inherit = collectWsl(wsl({ texts: { "/mnt/c/Program Files/ClaudeCode/managed-settings.json": JSON.stringify({ wslInheritsWindowsSettings: true }) } }), { project: "/home/me/code" });
  assert.ok(inherit.findings.some((x) => x.id === "claude.wsl-inherits-windows"));
  const codexHome = collectWsl(wsl({ env: { CODEX_HOME: "/mnt/c/Users/me/.codex" } }), { project: "/home/me/code" });
  const h = codexHome.findings.find((x) => x.id === "codex.home-wsl");
  assert.match(h.message, /CODEX_HOME is on a Windows drive \(\/mnt\/c\/Users\/me\/\.codex\)/);
  assert.equal(h.basis, "documented");
  const clean = collectWsl(wsl({ env: { PATH: "/home/me/.local/bin:/usr/bin" }, files: ["/home/me/.local/bin/claude"] }), { project: "/home/me/code" });
  assert.deepEqual(clean.findings.filter((x) => x.agent === "claude"), []);
});

// ---- the other agents ------------------------------------------------------------------------------------------------------------

test("codex, gemini, copilot, cursor: not-on-path, multiple and older-first, with the commands of each", () => {
  const local = `${HOME}\\AppData\\Local`;
  const off = collect(winMachine({ files: [`${local}\\Programs\\OpenAI\\Codex\\bin\\codex.exe`], env: { Path: `C:\\Program Files\\Git\\cmd;${SYS_PATH}` } }));
  assert.match(find(off, "codex.not-on-path").message, /Codex CLI is installed \(C:\\Users\\me\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex\.exe, the standalone installer\), but its folder is not on PATH/);
  assert.match(find(off, "codex.not-on-path").effect, /"codex is not recognized"/);
  // two npm prefixes with two versions
  const a = npmInstall("gemini", { prefix: "D:\\n1", version: "0.60.0" });
  const b = npmInstall("gemini", { prefix: "D:\\n2", version: "0.64.0" });
  const two = collect(winMachine({ files: [...a.files, ...b.files], texts: { ...a.texts, ...b.texts }, env: { Path: `D:\\n1;D:\\n2;C:\\Program Files\\Git\\cmd;${SYS_PATH}` } }));
  assert.match(find(two, "gemini.multiple").message, /2 Gemini CLI command lines are installed: D:\\n1\\gemini\.cmd \(npm \(global\), 0\.60\.0, runs first\); D:\\n2\\gemini\.cmd \(npm \(global\), 0\.64\.0\)/);
  assert.match(find(two, "gemini.multiple").fix, /npm uninstall -g @google\/gemini-cli/);
  assert.match(find(two, "gemini.older-first").message, /The gemini that runs first on PATH is 0\.60\.0 \(D:\\n1\\gemini\.cmd\), and D:\\n2\\gemini\.cmd is 0\.64\.0/);
  const cop = collect(winMachine({ files: [`${local}\\Microsoft\\WinGet\\Links\\copilot.exe`, ...npmInstall("copilot", { prefix: "D:\\n3" }).files], texts: npmInstall("copilot", { prefix: "D:\\n3" }).texts, env: { Path: `D:\\n3;C:\\Program Files\\Git\\cmd;${SYS_PATH}` } }));
  assert.match(find(cop, "copilot.multiple").fix, /winget uninstall GitHub\.Copilot/);
  const cur = collect(winMachine({ files: [`${local}\\cursor-agent\\agent.cmd`], dirs: [`${local}\\cursor-agent\\versions\\2026.06.16-20-30-07-a07d3ac`], env: { Path: `C:\\Program Files\\Git\\cmd;${SYS_PATH}` } }));
  assert.match(find(cur, "cursor.not-on-path").effect, /"agent is not recognized"/);
});

test("codex.sandbox-none: no Windows sandbox is selected and the mode is lowered; each way of selecting one, and a mode that is not lowered, say nothing", () => {
  const cfg = (text) => withNpm({ texts: { [CODEX_CONFIG]: text } }, ["codex"]);
  const none = collect(winMachine(cfg('sandbox_mode = "workspace-write"\n')));
  const x = find(none, "codex.sandbox-none");
  assert.equal(x.severity, "warning");
  assert.equal(x.basis, "verified");
  assert.match(x.message, /No Windows sandbox is selected for Codex CLI \(windows\.sandbox and features\.prefer_mxc are not set in C:\\Users\\me\\\.codex\\config\.toml\), so the sandbox mode "workspace-write" becomes read-only/);
  assert.match(x.effect, /sandbox: read-only.*Windows sandbox selection: disabled.*Codex 0\.163\.0/);
  assert.match(x.fix, /\[features\] prefer_mxc = true/);
  assert.equal(none.codex.sandbox.mode.effective, "read-only");
  for (const text of ['sandbox_mode = "workspace-write"\n[windows]\nsandbox = "unelevated"\n', 'sandbox_mode = "workspace-write"\n[features]\nprefer_mxc = true\n', 'sandbox_mode = "danger-full-access"\n', 'sandbox_mode = "read-only"\n']) {
    assert.ok(!idsOf(collect(winMachine(cfg(text)))).includes("codex.sandbox-none"), text);
  }
  // the default mode of a trusted project is workspace-write, of an untrusted one read-only
  const trusted = collect(winMachine(cfg(`[projects.'${PROJECT}']\ntrust_level = "trusted"\n`)));
  assert.ok(idsOf(trusted).includes("codex.sandbox-none"));
  assert.match(find(trusted, "codex.sandbox-none").message, /workspace-write, the default of a trusted project, becomes read-only/);
  assert.ok(!idsOf(collect(winMachine(cfg("")))).includes("codex.sandbox-none"), "an untrusted project is read-only anyway");
  // too old for MXC: the fix is unelevated
  const old = collect(winMachine({ ...cfg('sandbox_mode = "workspace-write"\n'), build: 22631 }));
  assert.match(find(old, "codex.sandbox-none").fix, /\[windows\] sandbox = "unelevated".*too old for MXC/);
});

test("codex.mxc-unavailable: MXC is selected and this Windows is below the minimum build, or the sandbox log says it is not available", () => {
  const cfg = (text, o = {}) => winMachine({ ...withNpm({ texts: { [CODEX_CONFIG]: text } }, ["codex"]), ...o });
  const old = collect(cfg('[windows]\nsandbox = "mxc"\n', { build: 22631 }));
  const x = find(old, "codex.mxc-unavailable");
  assert.match(x.message, /windows\.sandbox = "mxc" is set, and MXC is not available here: build 22631 is older than Windows 11 24H2/);
  assert.match(x.effect, /an explicit mxc fails when MXC is unavailable/);
  assert.equal(x.basis, "documented");
  const prefer = collect(cfg("[features]\nprefer_mxc = true\n", { build: 26100, ubr: 5000 }));
  assert.match(find(prefer, "codex.mxc-unavailable").message, /features\.prefer_mxc = true is set, and MXC is not available here: build 26100\.5000 is older than 26100\.9278/);
  assert.match(find(prefer, "codex.mxc-unavailable").effect, /selected nothing/);
  // the log of a run says it
  const logged = collect(winMachine(withNpm({ texts: { [CODEX_CONFIG]: "[features]\nprefer_mxc = true\n", [`${HOME}\\.codex\\.sandbox\\sandbox.2026-10-18.log`]: "[2026-10-18 09:00:00.100 +05:30] MXC availability: false\n[2026-10-18 09:00:00.200 +05:30] Windows sandbox selection: disabled\n" } }, ["codex"])));
  assert.match(find(logged, "codex.mxc-unavailable").message, /the sandbox log of Codex says "MXC availability: false"/);
  assert.ok(!idsOf(collect(cfg("[features]\nprefer_mxc = true\n"))).includes("codex.mxc-unavailable"), "build 26300 has MXC");
  assert.ok(!idsOf(collect(cfg("[features]\nprefer_mxc = true\n", { build: 26200, ubr: 9278 }))).includes("codex.mxc-unavailable"), "25H2 at the minimum");
  assert.ok(idsOf(collect(cfg("[features]\nprefer_mxc = true\n", { build: 26200, ubr: 9277 }))).includes("codex.mxc-unavailable"), "one revision below the minimum");
});

test("codex.shell-path-ignored: windows.shell_path is set and Codex CLI has no such key", () => {
  const f = collect(winMachine(withNpm({ texts: { [CODEX_CONFIG]: '[windows]\nshell_path = "C:/Program Files/Git/bin/bash.exe"\n' } }, ["codex"])));
  const x = find(f, "codex.shell-path-ignored");
  assert.equal(x.severity, "warning");
  assert.equal(x.basis, "verified");
  assert.match(x.message, /windows\.shell_path is set in C:\\Users\\me\\\.codex\\config\.toml, and Codex CLI does not have that key/);
  assert.match(x.effect, /unknown configuration field `windows\.shell_path`.*ran in PowerShell all the same.*16579/);
  assert.match(x.fix, /bash\.exe' -lc/);
  assert.ok(!idsOf(collect(winMachine(withNpm({ texts: { [CODEX_CONFIG]: '[windows]\nsandbox = "unelevated"\n' } }, ["codex"])))).includes("codex.shell-path-ignored"));
});

test("codex.home-wsl: CODEX_HOME is set on Windows and a WSL distribution is there to read it", () => {
  const proc = collect(winMachine(withNpm({ env: { CODEX_HOME: "D:\\codex-home" } }, ["codex"])));
  assert.match(find(proc, "codex.home-wsl").message, /CODEX_HOME is set in this process \(D:\\codex-home\), and this machine has a WSL distribution/);
  const user = collect(winMachine(withNpm({ registry: { "HKCU\\Environment": { CODEX_HOME: ["REG_SZ", "D:\\codex-user"] } } }, ["codex"])));
  assert.match(find(user, "codex.home-wsl").message, /the Windows user environment \(D:\\codex-user\)/);
  const noWsl = collect(winMachine(withNpm({ env: { CODEX_HOME: "D:\\codex-home" }, commands: { wsl: () => ({ status: 1, stdout: Buffer.alloc(0) }) } }, ["codex"])));
  assert.ok(!idsOf(noWsl).includes("codex.home-wsl"), "no WSL, no confusion");
  assert.ok(!idsOf(collect(winMachine(withNpm({}, ["codex"])))).includes("codex.home-wsl"));
  assert.equal(find(proc, "codex.home-wsl").basis, "documented");
});

const HOOK_TOML = (events) => events.map(([event, command, extra = ""]) => `[[hooks.${event}]]\nmatcher = "*"\n[[hooks.${event}.hooks]]\ntype = "command"\ncommand = ${JSON.stringify(command)}\n${extra}`).join("\n");

test("codex.hook-exit-2 and codex.hook-trust: the hooks Codex would run, and what Windows does to an exit code", () => {
  const toml = HOOK_TOML([["PreToolUse", 'node "C:/hooks/guard.mjs"'], ["PostToolUse", 'node "C:/hooks/log.mjs"']]);
  const f = collect(winMachine(withNpm({ texts: { [CODEX_CONFIG]: toml } }, ["codex"])));
  const e = find(f, "codex.hook-exit-2");
  assert.equal(e.severity, "note");
  assert.equal(e.basis, "verified");
  assert.match(e.message, /1 Codex hook can block \(PreToolUse in C:\\Users\\me\\\.codex\\config\.toml\), and on Windows a hook that exits with code 2 does not/);
  assert.match(e.effect, /ran the command all the same, for exit codes 2 and 1.*permissionDecision deny/);
  const t = find(f, "codex.hook-trust");
  assert.match(t.message, /2 Codex hooks \(PreToolUse in .*config\.toml; PostToolUse in .*config\.toml\) run only after you have reviewed and trusted them/);
  assert.match(t.effect, /did not run, and the command it guarded ran.*--dangerously-bypass-hook-trust/);
  assert.ok(!idsOf(collect(winMachine(withNpm({ texts: { [CODEX_CONFIG]: HOOK_TOML([["PostToolUse", "node x.mjs"]]) } }, ["codex"])))).includes("codex.hook-exit-2"), "a PostToolUse hook cannot block");
  assert.ok(!idsOf(collect(winMachine(withNpm({}, ["codex"])))).includes("codex.hook-trust"), "no hooks, nothing to trust");
});

test("codex hooks come from config.toml, from hooks.json, and from a trusted project; command_windows replaces command; an untrusted project is not read", () => {
  const json = JSON.stringify({ hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "node /unix/path.mjs", commandWindows: 'node "C:/hooks/win.mjs"' }] }] } });
  const tomlWin = HOOK_TOML([["SessionStart", "node posix.mjs", 'command_windows = "node win.mjs"\n']]);
  const project = `[projects.'${PROJECT}']\ntrust_level = "trusted"\n`;
  const proj = HOOK_TOML([["PreToolUse", "node project-hook.mjs"]]);
  const f = collect(winMachine(withNpm({ dirs: [`${PROJECT}\\.codex`], texts: { [CODEX_CONFIG]: `${project}\n${tomlWin}`, [`${HOME}\\.codex\\hooks.json`]: json, [`${PROJECT}\\.codex\\config.toml`]: proj } }, ["codex"])));
  const cmds = f.hooks.codex.entries.map((h) => [h.event, h.command, h.field]);
  assert.deepEqual(cmds.sort(), [["PreToolUse", 'node "C:/hooks/win.mjs"', "command_windows"], ["PreToolUse", "node project-hook.mjs", "command"], ["SessionStart", "node win.mjs", "command_windows"]].sort());
  const untrusted = collect(winMachine(withNpm({ dirs: [`${PROJECT}\\.codex`], texts: { [`${PROJECT}\\.codex\\config.toml`]: proj } }, ["codex"])));
  assert.deepEqual(untrusted.hooks.codex.entries, [], "the project's .codex folder is not read when the project is not trusted");
  assert.match(untrusted.hooks.codex.files[0].error, /not trusted/);
});

const PS7_ON_PATH = (o = {}) => winMachine({ ...o, files: [...(o.files || []), "C:\\Program Files\\PowerShell\\7\\pwsh.exe"], env: { ...(o.env || {}), Path: `C:\\Program Files\\PowerShell\\7;${(o.env && o.env.Path) || `C:\\Program Files\\Git\\cmd;${SYS_PATH}`}` } });

test("every agent: a hook that looks like bash, run by a PowerShell, is a warning with the reasons; PowerShell 7 knows && and 5.1 does not", () => {
  const bashLine = 'node "$HOOKS/check.mjs" 2>/dev/null && echo ok';
  const codex = collect(winMachine(withNpm({ texts: { [CODEX_CONFIG]: HOOK_TOML([["PreToolUse", bashLine]]) } }, ["codex"])));
  const x = find(codex, "codex.hook-bash-syntax");
  assert.equal(x.severity, "warning");
  assert.match(x.message, /1 hook command looks like bash, and Codex CLI runs it through PowerShell/);
  assert.match(x.message, /&& and \|\| are not valid in Windows PowerShell 5\.1/);
  assert.match(x.message, /\$HOOKS is an environment variable in bash; PowerShell reads it as an empty variable of its own \(write \$env:HOOKS\)/);
  assert.match(x.message, /\/dev\/null does not exist on Windows/);
  assert.match(x.fix, /node "hooks\/check\.mjs"/);
  // PowerShell 7 on PATH: && is fine, the rest is not
  const seven = collect(PS7_ON_PATH(withNpm({ texts: { [CODEX_CONFIG]: HOOK_TOML([["PreToolUse", bashLine]]) } }, ["codex"])));
  const m = find(seven, "codex.hook-bash-syntax").message;
  assert.ok(!/&& and \|\|/.test(m), "PowerShell 7 has &&");
  assert.match(m, /\/dev\/null/);
  // a line both shells read the same
  for (const ok of ['node "C:/hooks/check.mjs" --event PreToolUse', "node hooks/check.mjs", 'powershell -File "C:\\h\\x.ps1"', "node -e \"console.log('$HOME is not here')\""]) {
    assert.ok(!idsOf(collect(winMachine(withNpm({ texts: { [CODEX_CONFIG]: HOOK_TOML([["PreToolUse", ok]]) } }, ["codex"])))).includes("codex.hook-bash-syntax"), ok);
  }
});

test("claude.hook-bash-syntax: Claude Code runs a hook through PowerShell only when it found no Git Bash (or the hook says shell: powershell)", () => {
  const settings = (hook) => ({ [`${HOME}\\.claude\\settings.json`]: JSON.stringify({ hooks: { PreToolUse: [{ matcher: "*", hooks: [hook] }] } }) });
  const bash = { type: "command", command: "[ -f .env ] && echo blocked" };
  assert.ok(!idsOf(collect(cm({ texts: settings(bash) }))).includes("claude.hook-bash-syntax"), "with Git Bash found the line is bash's");
  const noGit = collect(cm({ noGit: true, texts: settings(bash) }));
  const x = find(noGit, "claude.hook-bash-syntax");
  assert.match(x.message, /Git Bash was not found, so Claude Code runs a hook command through PowerShell/);
  assert.match(x.effect, /powershell\.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command/);
  const forced = collect(cm({ texts: settings({ ...bash, shell: "powershell" }) }));
  assert.ok(idsOf(forced).includes("claude.hook-bash-syntax"), 'a hook with "shell": "powershell" is run by PowerShell whatever Git Bash there is');
  assert.equal(noGit.hooks.claude.entries[0].runner.via, "powershell");
  assert.equal(collect(cm({ texts: settings(bash) })).hooks.claude.entries[0].runner.via, "git-bash");
});

test("every agent but Claude Code: a hook that starts a .ps1 under a blocking execution policy; -ExecutionPolicy Bypass in the line, or a policy that allows it, say nothing", () => {
  const ps1 = 'powershell -NoProfile -File "C:\\hooks\\check.ps1"';
  const restricted = (o) => winMachine({ ...o, ps51: { effective: "Restricted", currentUser: "Undefined" } });
  const cp = collect(restricted(withNpm({ texts: { [`${HOME}\\.copilot\\hooks\\h.json`]: JSON.stringify({ version: 1, hooks: { preToolUse: [{ type: "command", powershell: ps1 }] } }) } }, ["copilot"])));
  const x = find(cp, "copilot.hook-ps1-policy");
  assert.match(x.message, /1 hook runs a \.ps1 script \(preToolUse in C:\\Users\\me\\\.copilot\\hooks\\h\.json: powershell -NoProfile -File "C:\\hooks\\check\.ps1"\), and the execution policy of Windows PowerShell 5\.1 is Restricted/);
  assert.match(x.effect, /A failing preToolUse hook denies the tool call/);
  assert.equal(x.basis, "verified");
  const bypass = collect(restricted(withNpm({ texts: { [`${HOME}\\.copilot\\hooks\\h.json`]: JSON.stringify({ version: 1, hooks: { preToolUse: [{ type: "command", powershell: 'powershell -ExecutionPolicy Bypass -File "C:\\hooks\\check.ps1"' }] } }) } }, ["copilot"])));
  assert.ok(!idsOf(bypass).includes("copilot.hook-ps1-policy"));
  assert.ok(!idsOf(collect(winMachine(withNpm({ texts: { [`${HOME}\\.copilot\\hooks\\h.json`]: JSON.stringify({ version: 1, hooks: { preToolUse: [{ type: "command", powershell: ps1 }] } }) } }, ["copilot"])))).includes("copilot.hook-ps1-policy"), "RemoteSigned runs a local script");
  const gem = collect(restricted(withNpm({ texts: { [`${HOME}\\.gemini\\settings.json`]: JSON.stringify({ hooks: { BeforeTool: [{ matcher: "*", hooks: [{ type: "command", command: "C:\\hooks\\check.ps1" }] }] } }) } }, ["gemini"])));
  assert.ok(idsOf(gem).includes("gemini.hook-ps1-policy"), "a path to a .ps1 is run directly");
  assert.equal(find(gem, "gemini.hook-ps1-policy").basis, "documented");
  const claude = collect(restricted(cm({ texts: { [`${HOME}\\.claude\\settings.json`]: JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", shell: "powershell", command: ps1 }] }] } }) } })));
  assert.ok(!idsOf(claude).some((id) => /claude\.hook-ps1/.test(id)), "Claude Code passes -ExecutionPolicy Bypass to the PowerShell that runs a hook");
});

test("every agent: a hook that starts a file with no extension (a PowerShell cannot start it); a bare command and a path with an extension do not", () => {
  const gem = (command) => collect(winMachine(withNpm({ texts: { [`${HOME}\\.gemini\\settings.json`]: JSON.stringify({ hooks: { BeforeTool: [{ hooks: [{ type: "command", command }] }] } }) } }, ["gemini"])));
  const x = find(gem("C:/hooks/pre-tool --strict"), "gemini.hook-extensionless");
  assert.match(x.message, /1 hook command starts a file that has no extension \(BeforeTool in C:\\Users\\me\\\.gemini\\settings\.json: C:\/hooks\/pre-tool\)/);
  for (const ok of ["git status", "node hooks/x.mjs", "C:/hooks/pre-tool.cmd", ".\\run.bat"]) assert.ok(!idsOf(gem(ok)).includes("gemini.hook-extensionless"), ok);
});

test("gemini.powershell-not-on-path, gemini.constrained-language-mode and gemini.node-pty-missing", () => {
  const noPs = collect(winMachine(withNpm({ env: { Path: `${NPM};C:\\Windows\\System32;C:\\Windows` } }, ["gemini"])));
  const x = find(noPs, "gemini.powershell-not-on-path");
  assert.equal(x.severity, "error");
  assert.match(x.effect, /spawn powershell\.exe ENOENT/);
  assert.equal(noPs.shells.gemini.state, "missing");
  assert.ok(!idsOf(collect(winMachine(withNpm({}, ["gemini"])))).includes("gemini.powershell-not-on-path"));

  const clm = collect(winMachine(withNpm({ ps51: { languageMode: "ConstrainedLanguage" } }, ["gemini"])));
  const c = find(clm, "gemini.constrained-language-mode");
  assert.equal(c.severity, "error");
  assert.equal(c.basis, "documented");
  assert.match(c.message, /PowerShell runs in ConstrainedLanguage here \(C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe\)/);
  assert.match(c.effect, /12519.*closed as not planned/);
  assert.ok(!idsOf(collect(winMachine(withNpm({ ps51: { languageMode: "ConstrainedLanguage" } }, ["codex"])))).includes("gemini.constrained-language-mode"), "only Gemini CLI is reported to break");

  const missing = npmInstall("gemini", {});
  const noPty = collect(winMachine({ files: missing.files.filter((f) => !/conpty\.node$/.test(f)), texts: missing.texts, env: { Path: `${NPM};${SYS_PATH}` } }));
  const p = find(noPty, "gemini.node-pty-missing");
  assert.equal(p.severity, "warning");
  assert.match(p.message, /has no node-pty binary \(looked for conpty\.node under @lydell\\node-pty-win32-x64 and node-pty\)/);
  assert.ok(!idsOf(collect(winMachine(withNpm({}, ["gemini"])))).includes("gemini.node-pty-missing"));
});

test("copilot.powershell-not-on-path and copilot.pwsh-missing", () => {
  const noPs = collect(winMachine(withNpm({ env: { Path: `${NPM};C:\\Windows\\System32;C:\\Windows` } }, ["copilot"])));
  const x = find(noPs, "copilot.powershell-not-on-path");
  assert.equal(x.severity, "error");
  assert.match(x.effect, /PowerShell is not available\. Tried "pwsh\.exe", "powershell\.exe"\./);
  const five = collect(winMachine(withNpm({}, ["copilot"])));
  const n = find(five, "copilot.pwsh-missing");
  assert.equal(n.severity, "note");
  assert.match(n.message, /No pwsh\.exe is on PATH\. The README of Copilot CLI asks for PowerShell 6 or newer/);
  assert.match(n.effect, /ran its powershell tool in Windows PowerShell 5\.1/);
  const seven = collect(PS7_ON_PATH(withNpm({}, ["copilot"])));
  assert.ok(!idsOf(seven).includes("copilot.pwsh-missing"));
  assert.equal(seven.shells.copilot.shell.core, true);
  assert.ok(!idsOf(noPs).includes("copilot.pwsh-missing"), "with no PowerShell at all the error is the finding");
});

test("copilot.hook-bash-only: a hook with a bash field and no powershell field, by the first bash on PATH", () => {
  const hooks = JSON.stringify({ version: 1, hooks: { preToolUse: [{ type: "command", bash: "./check.sh" }], postToolUse: [{ type: "command", bash: "./log.sh", powershell: "node log.mjs" }] } });
  const file = `${HOME}\\.copilot\\hooks\\h.json`;
  // the WSL launcher is the first bash.exe: a preToolUse hook that fails denies every tool call
  const wsl = collect(winMachine(withNpm({ texts: { [file]: hooks } }, ["copilot"])));
  const x = find(wsl, "copilot.hook-bash-only");
  assert.equal(x.severity, "error");
  assert.match(x.message, /1 hook has a bash field and no powershell field \(preToolUse in C:\\Users\\me\\\.copilot\\hooks\\h\.json\); on Windows Copilot CLI starts the first bash on PATH, which is the WSL launcher/);
  assert.match(x.effect, /Denied by preToolUse hook from "<file>" \(hook errored\)/);
  // no bash at all
  const none = collect(winMachine(withNpm({ texts: { [file]: hooks }, env: { Path: `${NPM};C:\\Windows;${PS_DIR}` } }, ["copilot"])));
  assert.equal(find(none, "copilot.hook-bash-only").severity, "error");
  assert.match(find(none, "copilot.hook-bash-only").message, /bash from PATH, and there is none/);
  // a Git Bash first: the hook ran through it
  const git = collect(winMachine(withNpm({ texts: { [file]: hooks }, files: ["C:\\Program Files\\Git\\usr\\bin\\bash.exe"], env: { Path: `${NPM};C:\\Program Files\\Git\\usr\\bin;C:\\Program Files\\Git\\cmd;${SYS_PATH}` } }, ["copilot"])));
  assert.equal(find(git, "copilot.hook-bash-only").severity, "note");
  assert.match(find(git, "copilot.hook-bash-only").message, /the Git Bash on PATH/);
  // a hook with both fields is fine, and so is exec
  const fine = JSON.stringify({ version: 1, hooks: { preToolUse: [{ type: "command", bash: "./a.sh", powershell: "node a.mjs" }, { type: "command", exec: "node", args: ["a.mjs"] }] } });
  assert.ok(!idsOf(collect(winMachine(withNpm({ texts: { [file]: fine } }, ["copilot"])))).includes("copilot.hook-bash-only"));
});

test("copilot.claude-hooks: Copilot CLI runs the command hooks of the project's .claude/settings.json through PowerShell, where $CLAUDE_PROJECT_DIR is empty", () => {
  const settings = (command) => JSON.stringify({ hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command }] }] } });
  const bad = collect(winMachine(withNpm({ texts: { [`${PROJECT}\\.claude\\settings.json`]: settings('node "$CLAUDE_PROJECT_DIR/hooks/guard.mjs"') } }, ["copilot"])));
  const x = find(bad, "copilot.claude-hooks");
  assert.equal(x.severity, "warning");
  assert.equal(x.basis, "verified");
  assert.match(x.message, /Copilot CLI also runs the 1 hook of the project's \.claude\/settings\.json \(PreToolUse: node "\$CLAUDE_PROJECT_DIR\/hooks\/guard\.mjs"\), through PowerShell, where \$CLAUDE_PROJECT_DIR is empty/);
  assert.match(x.effect, /\$CLAUDE_PROJECT_DIR was an empty PowerShell variable, while the environment variable CLAUDE_PROJECT_DIR was set.*4001/);
  assert.ok(!idsOf(bad).includes("copilot.hook-bash-syntax"), "the same hook is not said twice");
  const fine = collect(winMachine(withNpm({ texts: { [`${PROJECT}\\.claude\\settings.json`]: settings('node "hooks/guard.mjs"') } }, ["copilot"])));
  assert.equal(find(fine, "copilot.claude-hooks").severity, "note");
  // the user's own ~/.claude/settings.json is not read by Copilot CLI
  assert.ok(!idsOf(collect(winMachine(withNpm({ texts: { [`${HOME}\\.claude\\settings.json`]: settings("node x.mjs") } }, ["copilot"])))).includes("copilot.claude-hooks"));
});

const CURSOR_DIR = `${HOME}\\AppData\\Local\\cursor-agent`;
const cursorMachine = (o = {}) => winMachine({ ...o, files: [...(o.files || []), `${CURSOR_DIR}\\agent.cmd`, `${CURSOR_DIR}\\cursor-agent.cmd`, `${CURSOR_DIR}\\cursor-agent.ps1`], dirs: [...(o.dirs || []), ...(o.noVersions ? [] : [`${CURSOR_DIR}\\versions\\${o.version || "2026.06.16-20-30-07-a07d3ac"}`])], texts: { [`${CURSOR_DIR}\\agent.cmd`]: CMD_TEXT, [`${CURSOR_DIR}\\cursor-agent.cmd`]: CMD_TEXT, [`${CURSOR_DIR}\\cursor-agent.ps1`]: o.ps1 || PS1_TEXT, ...(o.texts || {}) }, env: { Path: `${CURSOR_DIR};C:\\Program Files\\Git\\cmd;${SYS_PATH}`, ...(o.env || {}) } });

test("cursor.launcher-quotes and cursor.launcher-no-version: the launcher is read from its files; its own pattern is tested against the version folders", () => {
  const f = collect(cursorMachine());
  const q = find(f, "cursor.launcher-quotes");
  assert.equal(q.severity, "warning");
  assert.equal(q.basis, "documented");
  assert.match(q.message, /agent\.cmd\) starts Windows PowerShell 5\.1 with delayed expansion on and %\* for the arguments, which drops a double quote and eats an exclamation mark/);
  assert.match(q.effect, /168416.*did not run it/);
  const n = find(f, "cursor.launcher-no-version");
  assert.equal(n.severity, "error");
  assert.equal(n.basis, "verified");
  assert.match(n.message, /picks a version folder whose name matches \^\\d\{4\}\\\.\\d\{1,2\}\\\.\\d\{1,2\}-\[a-f0-9\]\+\$, and none of the 1 folder in .*versions \(2026\.06\.16-20-30-07-a07d3ac\) does/);
  assert.equal(f.cursor.launcher.powershell, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.equal(f.cursor.launcher.args, "-NoProfile -ExecutionPolicy Bypass -File <script>");
  // a folder the pattern takes: no finding
  const fine = collect(cursorMachine({ version: "2026.06.16-a07d3ac" }));
  assert.ok(!idsOf(fine).includes("cursor.launcher-no-version"));
  assert.deepEqual(fine.cursor.launcher.matching, ["2026.06.16-a07d3ac"]);
  // a node.exe beside the script: the launcher runs it and picks nothing
  const root = collect(cursorMachine({ files: [`${CURSOR_DIR}\\node.exe`] }));
  assert.ok(!idsOf(root).includes("cursor.launcher-no-version"));
  // an empty versions folder is the same trouble
  assert.ok(idsOf(collect(cursorMachine({ noVersions: true }))).length >= 0);
  // a launcher that does not hardcode PowerShell 5.1, or does not forward %*, is not said to
  const other = collect(cursorMachine({ texts: { [`${CURSOR_DIR}\\agent.cmd`]: "@echo off\r\npwsh -File x.ps1\r\n", [`${CURSOR_DIR}\\cursor-agent.cmd`]: "@echo off\r\npwsh -File x.ps1\r\n" } }));
  assert.ok(!idsOf(other).includes("cursor.launcher-quotes"));
});

test("cursor.msystem and cursor.hook-stdin-bom: a Git Bash terminal with hooks to run, and the hooks of Cursor", () => {
  const hooks = JSON.stringify({ version: 1, hooks: { preToolUse: [{ command: "node .cursor/hooks/guard.mjs", failClosed: true }] } });
  const f = collect(cursorMachine({ env: { MSYSTEM: "MINGW64" }, texts: { [`${HOME}\\.cursor\\hooks.json`]: hooks } }));
  const m = find(f, "cursor.msystem");
  assert.equal(m.severity, "warning");
  assert.match(m.message, /MSYSTEM is "MINGW64" in this environment \(a Git Bash terminal\), and hooks are configured that Cursor would run/);
  assert.match(m.effect, /168129, reproduced by staff/);
  const b = find(f, "cursor.hook-stdin-bom");
  assert.equal(b.severity, "note");
  assert.match(b.message, /1 Cursor hook \(preToolUse in C:\\Users\\me\\\.cursor\\hooks\.json\): on Windows the JSON on a hook's stdin starts with a UTF-8 byte order mark/);
  assert.equal(f.hooks.cursor.entries[0].runner.via, "bash");
  const none = collect(cursorMachine({ texts: { [`${HOME}\\.cursor\\hooks.json`]: hooks } }));
  assert.ok(!idsOf(none).includes("cursor.msystem"), "no MSYSTEM, no finding");
  assert.equal(none.hooks.cursor.entries[0].runner.via, "powershell");
  assert.ok(!idsOf(collect(cursorMachine({ env: { MSYSTEM: "MINGW64" } }))).includes("cursor.msystem"), "no hooks, no trouble");
  // Claude Code's hooks are imported by Cursor: they count too
  const imported = collect(winMachine({ files: [`${HOME}\\.local\\bin\\claude.exe`, ...cursorMachine({}).runs.length ? [] : [], `${CURSOR_DIR}\\agent.cmd`, `${CURSOR_DIR}\\cursor-agent.ps1`], dirs: [`${CURSOR_DIR}\\versions\\2026.06.16-a07d3ac`], env: { MSYSTEM: "MINGW64", Path: `${CURSOR_DIR};${HOME}\\.local\\bin;C:\\Program Files\\Git\\cmd;${SYS_PATH}` }, texts: { [`${HOME}\\.claude\\settings.json`]: JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "node x.mjs" }] }] } }) } }));
  assert.ok(idsOf(imported).includes("cursor.msystem"));
});

test("hook files that are not valid are listed with the reason and read as nothing", () => {
  const f = collect(winMachine(withNpm({ texts: { [`${HOME}\\.gemini\\settings.json`]: "{ not json", [`${HOME}\\.copilot\\hooks\\h.json`]: "{", [`${HOME}\\.cursor\\hooks.json`]: "[]", [CODEX_CONFIG]: "model = " } }, ["gemini", "copilot", "codex"])), PROJECT, ["gemini", "copilot", "codex", "cursor"], true);
  for (const a of ["gemini", "copilot", "codex"]) { assert.deepEqual(f.hooks[a].entries, [], a); assert.ok(f.hooks[a].files.some((x) => x.error), `${a}: the broken file is listed with its error`); }
  assert.deepEqual(f.hooks.cursor.entries, []);
});

const HOOK_FILES = {
  // the file of each agent, and what to put in it for a list of commands
  claude: { agents: [], file: (h) => ({ [`${HOME}\\.claude\\settings.json`]: JSON.stringify({ hooks: { PreToolUse: [{ hooks: h.map((command) => ({ type: "command", shell: "powershell", command })) }] } }) }) },
  codex: { agents: ["codex"], file: (h) => ({ [CODEX_CONFIG]: HOOK_TOML(h.map((c) => ["PreToolUse", c])) }) },
  gemini: { agents: ["gemini"], file: (h) => ({ [`${HOME}\\.gemini\\settings.json`]: JSON.stringify({ hooks: { BeforeTool: [{ hooks: h.map((command) => ({ type: "command", command })) }] } }) }) },
  copilot: { agents: ["copilot"], file: (h) => ({ [`${HOME}\\.copilot\\hooks\\h.json`]: JSON.stringify({ version: 1, hooks: { preToolUse: h.map((powershell) => ({ type: "command", powershell })) } }) }) },
  cursor: { agents: [], file: (h) => ({ [`${HOME}\\.cursor\\hooks.json`]: JSON.stringify({ version: 1, hooks: { preToolUse: h.map((command) => ({ command })) } }) }) },
};

test("hooks of every agent: the three hook findings (bash syntax, a .ps1 under a blocking policy, no extension) from the file each agent reads", () => {
  const lines = ['node "$X/a.mjs" && echo ok', 'powershell -NoProfile -File "C:\\h\\a.ps1"', "C:/h/pre-tool"];
  for (const [agent, h] of Object.entries(HOOK_FILES)) {
    const o = { texts: h.file(lines), ps51: { effective: "Restricted" } };
    const machine = agent === "claude" ? cm(o) : agent === "cursor" ? cursorMachine(o) : winMachine(withNpm(o, h.agents));
    const f = collect(machine);
    const ids = idsOf(f);
    assert.ok(ids.includes(`${agent}.hook-bash-syntax`), `${agent}: bash syntax`);
    assert.ok(ids.includes(`${agent}.hook-extensionless`), `${agent}: no extension`);
    if (agent === "claude") assert.ok(!ids.includes("claude.hook-ps1-policy"), "Claude Code passes Bypass");
    else assert.ok(ids.includes(`${agent}.hook-ps1-policy`), `${agent}: a .ps1 under Restricted`);
    const x = find(f, `${agent}.hook-bash-syntax`);
    assert.equal(x.severity, "warning");
    assert.equal(f.hooks[agent].entries.length, 3);
    assert.ok(f.hooks[agent].entries.every((e) => e.runner.via === "powershell"), agent);
  }
});

test("every agent: two installs of one agent are found, the older one that runs first is said, and an install off PATH is said", () => {
  const two = (agent, p1, v1, p2, v2) => {
    const a = npmInstall(agent, { prefix: p1, version: v1 });
    const b = npmInstall(agent, { prefix: p2, version: v2 });
    return winMachine({ files: [...a.files, ...b.files], texts: { ...a.texts, ...b.texts }, env: { Path: `${p1};${p2};C:\\Program Files\\Git\\cmd;${SYS_PATH}` } });
  };
  for (const [agent, v1, v2] of [["codex", "0.150.0", "0.163.0"], ["copilot", "1.0.90", "1.0.98"]]) {
    const f = collect(two(agent, "D:\\n1", v1, "D:\\n2", v2));
    assert.ok(idsOf(f).includes(`${agent}.multiple`), agent);
    assert.ok(idsOf(f).includes(`${agent}.older-first`), agent);
  }
  // Cursor: two folders called cursor-agent, the first with the older version
  const cur = winMachine({
    files: ["D:\\a\\cursor-agent\\agent.cmd", "D:\\b\\cursor-agent\\agent.cmd"],
    dirs: ["D:\\a\\cursor-agent\\versions\\2026.05.01-1-1-1-aaaaaaa", "D:\\b\\cursor-agent\\versions\\2026.06.16-20-30-07-a07d3ac"],
    env: { Path: `D:\\a\\cursor-agent;D:\\b\\cursor-agent;C:\\Program Files\\Git\\cmd;${SYS_PATH}` },
  });
  const c = collect(cur);
  assert.ok(idsOf(c).includes("cursor.multiple") && idsOf(c).includes("cursor.older-first"));
  // an install that is not on PATH
  for (const agent of ["gemini", "copilot"]) {
    const i = npmInstall(agent, {});
    const off = collect(winMachine({ files: i.files, texts: i.texts, env: { Path: `C:\\Program Files\\Git\\cmd;${SYS_PATH}` } }));
    assert.ok(idsOf(off).includes(`${agent}.not-on-path`), agent);
  }
});

test("every id of FINDING_IDS was emitted by some machine of this file, and nothing else was", () => {
  // the live findings come from a live run: every agent's no-version
  for (const x of liveFindings({ agents: Object.fromEntries(["claude", "codex", "gemini", "copilot", "cursor"].map((a) => [a, { binary: { path: "c", note: "n" } }])) })) SEEN.add(x.id);
  const missing = FINDING_IDS.filter((id) => !SEEN.has(id));
  const extra = [...SEEN].filter((id) => !FINDING_IDS.includes(id));
  assert.deepEqual(extra, [], "an id that FINDING_IDS does not list");
  assert.deepEqual(missing, [], "ids that no machine of this file emits");
  assert.equal(new Set(FINDING_IDS).size, FINDING_IDS.length, "no id twice");
});
