// The reports: the text of check in its sections, the JSON, the short markdown to paste (at most 12 findings and 500 characters a line), the inventory alone, a system with nothing to
// check, WSL; and that no secret is in any of them.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { fakeMachine } from "./machine.mjs";
import { HOME, collect, winMachine, withNpm } from "./win-machine.mjs";
import { collectWsl, notApplicable } from "../src/check.mjs";
import { MARKDOWN_LINE, MARKDOWN_MAX_FINDINGS, NOTHING, agentsJson, agentsText, checkJson, checkMarkdown, checkText, explainListJson } from "../src/report.mjs";
import { listPages } from "../src/explain.mjs";
import { VERSION } from "../src/version.mjs";
import { CMD_TEXT, PS1_TEXT, REAL_VERSION_FOLDER } from "./cursor-files.mjs";

const DIR = `${HOME}\\AppData\\Local\\cursor-agent`;
const four = (o = {}) => winMachine(withNpm({ ...o }, ["claude", "codex", "gemini", "copilot"]));
const SECTIONS = ["The machine", "Every agent on this machine", "The shell each agent gives the model", "Hooks on Windows", "Codex on Windows", "Findings"];

test("the text of check on Windows has its sections in the order the brief gives, and a header that names the version", () => {
  const text = checkText(collect(four()));
  const at = SECTIONS.map((s) => text.indexOf(`\n${s}\n`));
  assert.ok(at.every((i) => i > 0), `all sections are there: ${at}`);
  assert.deepEqual(at, [...at].sort((a, b) => a - b), "in order");
  assert.match(text, new RegExp(`^agent-windows-doctor ${VERSION.replace(/\./g, "\\.")} {2}what the coding agents get on this Windows machine\\n`));
  assert.match(text, /\nagents {4}Claude Code, Codex CLI, Gemini CLI, GitHub Copilot CLI \(not found: Cursor\)\n/);
  assert.match(text, /\n {2}Windows PowerShell 5\.1 C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe {2}5\.1\.26100\.9711, FullLanguage, execution policy RemoteSigned \(/);
  assert.match(text, /\n {2}PowerShell 7 {6}not found: no pwsh\.exe on PATH/);
  assert.match(text, /\n {2}Codex MXC sandbox can run here: build 26300 is newer than the documented minimum builds/);
  assert.match(text, /\n {2}Node {14}24\.19\.0, npm 10\.9\.0; installed packages ask for: Claude Code >=22\.0\.0 \(met\), Codex CLI >=16 \(met\), Gemini CLI >=20 \(met\), GitHub Copilot CLI not stated\n/);
  assert.match(text, /\n {4}1 {2}C:\\Users\\me\\AppData\\Roaming\\npm\\codex\.cmd\n {8}0\.163\.0 \(package\.json of @openai\/codex\); npm \(global\); runs first from a terminal\n {8}leads to .*codex\.js -> .*codex\.exe\n/);
  assert.match(text, /\n {2}Codex CLI \(tool exec_command\)\n {4}shell {13}Windows PowerShell 5\.1 \(powershell\.exe\) at .*powershell\.exe, started with -Command \[verified\]\n/);
  assert.match(text, /\nHooks on Windows\n {2}Claude Code\n {4}no hook file found\n/);
});

test("the Live section comes after Codex on Windows, as the brief orders the sections, and before the findings", () => {
  const f = collect(four());
  const COMMAND = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  f.live = { ok: true, agents: { codex: { ok: true, proved: true, differences: [], binary: { path: "C:\\x\\codex.cmd", version: "0.163.0", asked: "0.163.0", note: null, source: "the first on PATH" }, predicted: { shell: COMMAND, state: "ok" }, actual: { shell: COMMAND, error: null }, run: { line: `"${COMMAND}" -Command x`, exitCode: 0, stderr: "" } } } };
  const text = checkText(f);
  const order = [...SECTIONS.slice(0, 5), "Live: the real binaries, through a fake API on 127.0.0.1 (no token spent)", "Findings"];
  const at = order.map((s) => text.indexOf(`\n${s}`));
  assert.ok(at.every((i) => i > 0), `all sections are there: ${at}`);
  assert.deepEqual(at, [...at].sort((a, b) => a - b), "in order");
  assert.match(text, /\n {2}Codex CLI {12}proved with the real codex 0\.163\.0 \(C:\\x\\codex\.cmd; the first on PATH\):\n/);
});

test("check on a machine with no agent says so in every section, and the agents that are not found are named", () => {
  const text = checkText(collect(winMachine()));
  assert.match(text, /\nagents {4}none found on this machine\n/);
  assert.match(text, /\nThe shell each agent gives the model\n {2}no agent found: nothing to say\n/);
  assert.match(text, /\nHooks on Windows\n {2}no agent found: nothing to say\n/);
  assert.match(text, /\nNo findings\.\n$/);
  assert.ok(!/Codex on Windows/.test(text), "no Codex section for a machine without Codex");
  const some = checkText(collect(winMachine(withNpm({}, ["codex"]))));
  assert.match(some, /\nagents {4}Codex CLI \(not found: Claude Code, Gemini CLI, GitHub Copilot CLI, Cursor\)\n/);
  assert.match(some, /\nEvery agent on this machine\n {2}Claude Code\n {4}none found on PATH or in the places the installers use\n {2}Codex CLI\n/);
  // an agent that --agent names and that is not found is marked once, not listed again as not found
  const named = checkText(collect(winMachine(withNpm({}, ["codex"])), undefined, ["claude", "codex"], true));
  assert.match(named, /\nagents {4}Claude Code \(not found\), Codex CLI\n/);
  assert.doesNotMatch(named, /\(not found: /);
});

test("the Claude Code block is claude-windows-doctor's: the Bash tool, the PowerShell tool, the three places Git Bash was looked for, defaultShell, whether Git Bash starts", () => {
  const sys = winMachine({ files: [`${HOME}\\.local\\bin\\claude.exe`], env: { Path: `${HOME}\\.local\\bin;C:\\Program Files\\Git\\cmd;C:\\Windows\\System32;C:\\Windows` } });
  const text = checkText(collect(sys));
  assert.match(text, /\n {4}Bash tool {9}yes: Git Bash at C:\\Program Files\\Git\\bin\\bash\.exe \(the fixed path C:\\Program Files\\Git\)\n/);
  assert.match(text, /\n {4}PowerShell tool {3}decided by your account: Claude Code's documentation says on for claude\.ai and Console accounts/);
  assert.match(text, /\n {4}how Claude Code looked for Git Bash, in its order:\n {6}1 {2}CLAUDE_CODE_GIT_BASH_PATH: not set\n {6}2 {2}C:\\Program Files\\Git\\bin\\bash\.exe: found\n {9}C:\\Program Files \(x86\)\\Git\\bin\\bash\.exe: not there\n/);
  assert.match(text, /\n {4}defaultShell {6}not set: the shell for the commands you type after !, not the model's tool\n {4}Git Bash starts {3}yes\n/);
});

test("hooks: each hook with its event, where it is, what runs it and how it was known, and what is wrong with it", () => {
  const sys = winMachine(withNpm({ texts: {
    [`${HOME}\\.codex\\config.toml`]: '[[hooks.PreToolUse]]\nmatcher = "*"\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = "node \\"$X/a.mjs\\" && echo ok"\n',
    [`${HOME}\\.copilot\\hooks\\h.json`]: JSON.stringify({ version: 1, hooks: { preToolUse: [{ type: "command", bash: "./a.sh" }] } }),
  } }, ["codex", "copilot"]));
  const text = checkText(collect(sys));
  assert.match(text, /\n {2}Codex CLI\n {4}files: user C:\\Users\\me\\\.codex\\config\.toml\n {4}PreToolUse \[\*\] {2}node "\$X\/a\.mjs" && echo ok\n {8}in C:\\Users\\me\\\.codex\\config\.toml; run by Windows PowerShell 5\.1 \[verified\]; looks like bash: and-or, variable\n/);
  assert.match(text, /\n {4}preToolUse {2}\.\/a\.sh\n {8}in C:\\Users\\me\\\.copilot\\hooks\\h\.json; run by bash \(the WSL launcher\) \[verified\]; field bash\n/);
});

test("Codex on Windows: CODEX_HOME, the files read, the trust of the project, the sandbox and the mode, MXC, the shell key, and the pointer to codex doctor", () => {
  const sys = winMachine(withNpm({ texts: { [`${HOME}\\.codex\\config.toml`]: 'sandbox_mode = "workspace-write"\n[windows]\nshell_path = "x"\n' } }, ["codex"]));
  const text = checkText(collect(sys));
  assert.match(text, /\nCodex on Windows\n {2}CODEX_HOME {8}C:\\Users\\me\\\.codex \(the default\)\n/);
  assert.match(text, /\n {2}files read {8}user C:\\Users\\me\\\.codex\\config\.toml\n {2}project trust {5}not trusted: the project's \.codex folder is not read\n/);
  assert.match(text, /\n {2}sandbox {11}none selected; sandbox_mode "workspace-write" becomes read-only\n {2}MXC {15}available \(build 26300 is newer than the documented minimum builds \(26100\.9278 or 26200\.9278\); no sandbox log yet\)\n/);
  assert.match(text, /\n {2}shell key {9}windows\.shell_path in C:\\Users\\me\\\.codex\\config\.toml: Codex CLI has no such key\n/);
  assert.match(text, /\n {2}more {14}codex doctor reports the install, the sign-in, the runtime, Microsoft Defender exclusions and Dev Drive\n/);
});

test("findings in the text: severity, id, basis, message, what the agent does, the fix, and how to read more; counts at the end", () => {
  const text = checkText(collect(winMachine({ noGit: true, files: ["E:\\Das\\Git\\cmd\\git.exe", "E:\\Das\\Git\\mingw64\\bin\\git.exe", "E:\\Das\\Git\\bin\\bash.exe", `${HOME}\\.local\\bin\\claude.exe`], env: { Path: "E:\\Das\\Git\\mingw64\\bin;E:\\Das\\Git\\cmd;C:\\Windows\\System32;C:\\Windows", CLAUDE_CODE_USE_POWERSHELL_TOOL: "enabled" } })));
  assert.match(text, /\nFindings\n/);
  assert.match(text, /\n {2}warning claude\.git-bash-not-found {3}\[verified\]\n {6}Git for Windows is installed/);
  assert.match(text, /\n {6}what Claude Code does: The Bash tool is not offered/);
  assert.match(text, /\n {6}fix: Set CLAUDE_CODE_GIT_BASH_PATH for every program: setx CLAUDE_CODE_GIT_BASH_PATH "E:\\Das\\Git\\bin\\bash\.exe"/);
  assert.match(text, /\n {6}more: agent-windows-doctor explain claude\.git-bash-not-found\n/);
  assert.match(text, /\n\n\d+ errors?, \d+ warnings?, \d+ notes?\n$/);
});

test("nothing to check, and the WSL side", () => {
  const mac = notApplicable(fakeMachine({ platform: "darwin" }));
  assert.equal(checkText(mac), `agent-windows-doctor ${VERSION}  nothing to check\n${NOTHING("darwin")}\n`);
  assert.match(NOTHING("linux"), /^Nothing to check on Linux: agent-windows-doctor checks what Claude Code, Codex CLI, Gemini CLI, GitHub Copilot CLI and Cursor get on Windows, and from inside a WSL distribution the WSL side\. Run it on Windows, or in WSL\.$/);
  assert.equal(checkJson(mac).applicable, false);
  assert.equal(checkMarkdown(mac), `## agent-windows-doctor check\n${NOTHING("darwin")}\n`);
  const wsl = collectWsl(fakeMachine({ platform: "linux", env: { PATH: "/mnt/c/Users/me/.local/bin:/usr/bin" }, home: "/home/me", cwd: "/home/me/code", files: ["/mnt/c/Users/me/.local/bin/claude"], texts: { "/proc/version": "Linux version 5.15-microsoft-standard-WSL2" } }), { project: "/home/me/code" });
  const text = checkText(wsl);
  assert.match(text, /^agent-windows-doctor .* {2}the WSL side of the coding agents\nproject {3}\/home\/me\/code\nsystem {4}.*; WSL 2\n\nclaude on this distribution\n {2}1 {2}\/mnt\/c\/Users\/me\/\.local\/bin\/claude/);
  assert.match(text, /\n {2}warning claude\.wsl-windows-claude {3}\[not verified\]\n/);
  assert.match(checkMarkdown(wsl), /^## agent-windows-doctor check \(WSL\): \/home\/me\/code\nclaude runs from \/mnt\/c\/Users\/me\/\.local\/bin\/claude\./);
});

test("the markdown: a header, the system and the shells, the errors and warnings one to a line with the fix, at most 12, none over 500 characters, and a line for the rest", () => {
  const f = collect(four());
  const md = checkMarkdown(f);
  assert.match(md, /^## agent-windows-doctor check: C:\\work\\shop\nWindows 11 Pro\. Shell the model gets: Claude Code Git Bash; Codex CLI PowerShell 5\.1; Gemini CLI PowerShell 5\.1; GitHub Copilot CLI PowerShell 5\.1\.\n/);
  assert.match(md, /Claude Code 2\.1\.302 runs first; Codex CLI 0\.163\.0 runs first; .*0 errors, 0 warnings, 1 note\.\n- 1 note not shown \(run `agent-windows-doctor check`\)\n$/);
  assert.equal(checkMarkdown(collect(winMachine())).includes("No findings."), true);
  // a machine with many problems: 16 variables of the user environment that this process does not have
  const many = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`CLAUDE_X${i}_DIR`, ["REG_SZ", `D:\\data\\${"x".repeat(280)}${i}`]]));
  const capped = checkMarkdown(collect(winMachine({ files: [`${HOME}\\.local\\bin\\claude.exe`], env: { Path: `${HOME}\\.local\\bin;C:\\Program Files\\Git\\cmd;C:\\Windows\\System32;C:\\Windows` }, registry: { "HKCU\\Environment": many } })));
  const lines = capped.trim().split("\n");
  assert.equal(MARKDOWN_MAX_FINDINGS, 12);
  assert.equal(lines.filter((l) => l.startsWith("- WARNING")).length, 12);
  assert.match(lines.at(-1), /^- \.\.\. and 4 more \(run `agent-windows-doctor check`\)$/);
  for (const l of lines) assert.ok(l.length <= MARKDOWN_LINE, `${l.length} characters in a line`);
  assert.ok(lines.length <= 17, `${lines.length} lines: a header, two lines, 12 findings and the line about the rest`);
  // a fix is kept whole when the message is cut
  const long = capped.split("\n").find((l) => l.startsWith("- WARNING"));
  assert.match(long, /Fix: Open a new terminal, or restart the app, and run this again\.$/);
});

test("the JSON of check: the keys, the agents, the machine, every program, the shell of each, the hooks, Codex, the findings with their basis", () => {
  const sys = winMachine(withNpm({ texts: { [`${HOME}\\.codex\\config.toml`]: "x = 1\n" } }, ["claude", "codex", "gemini", "copilot"]));
  const j = checkJson(collect(sys));
  assert.deepEqual(Object.keys(j).slice(0, 8), ["ok", "applicable", "platform", "kind", "project", "agents", "system", "machine"]);
  assert.deepEqual(j.agents, ["claude", "codex", "gemini", "copilot"]);
  assert.deepEqual(Object.keys(j.inventory), ["claude", "codex", "gemini", "copilot"]);
  assert.equal(j.inventory.codex.entries[0].version, "0.163.0");
  assert.deepEqual(Object.keys(j.shells), ["claude", "codex", "gemini", "copilot"]);
  assert.equal(j.shells.codex.shell.path, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.equal(j.machine.windows.build, 26300);
  assert.equal(j.machine.powershell[0].probe.languageMode, "FullLanguage");
  assert.equal(j.codex.sandbox.selection, "none");
  assert.ok(j.hooks.claude && j.hooks.codex.files.length === 1);
  assert.equal(JSON.parse(JSON.stringify(j)).counts.error, 0);
  for (const x of j.findings) assert.deepEqual(Object.keys(x), ["id", "severity", "agent", "basis", "message", "effect", "fix"]);
});

test("agents: the inventory alone, as text and as JSON, with the program that runs first", () => {
  const f = collect(four());
  const text = agentsText({ ...f, asked: f.agents });
  assert.match(text, /^agent-windows-doctor .* {2}every agent on this machine\n\n {2}Claude Code\n {4}1 {2}C:\\Users\\me\\AppData\\Roaming\\npm\\claude\.cmd\n/);
  assert.ok(!/The machine|Findings/.test(text), "only the inventory");
  const j = agentsJson({ platform: "win32", agents: f.agents, asked: f.agents, inventory: f.inventory });
  assert.equal(j.firsts.codex, "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd");
  assert.equal(agentsJson(notApplicable(fakeMachine({ platform: "linux" }))).applicable, false);
  assert.match(agentsText(notApplicable(fakeMachine({ platform: "linux" }))), /Nothing to check on Linux/);
});

test("the Cursor launcher is in the JSON and the text of a machine that has it", () => {
  const sys = winMachine({ files: [`${DIR}\\agent.cmd`, `${DIR}\\cursor-agent.ps1`], dirs: [`${DIR}\\versions\\${REAL_VERSION_FOLDER}`], texts: { [`${DIR}\\agent.cmd`]: CMD_TEXT, [`${DIR}\\cursor-agent.ps1`]: PS1_TEXT }, env: { Path: `${DIR};C:\\Windows\\System32;C:\\Windows` } });
  const f = collect(sys);
  const j = checkJson(f);
  assert.equal(j.cursor.launcher.noVersionFolder, true);
  assert.deepEqual(j.cursor.launcher.versions, [REAL_VERSION_FOLDER]);
  assert.equal(j.cursor.msystem, null);
  assert.match(checkText(f), /\n {2}Cursor\n {4}shell {13}Windows PowerShell 5\.1 \(powershell\.exe\) at C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe, started with -NoProfile -ExecutionPolicy Bypass -File <script> \[documented\]\n/);
});

test("no secret is in any report: a token in the environment, in the registry and in a settings file is set, never its value", () => {
  const secret = "sk-ant-api03-SECRET-VALUE-0123456789";
  const sys = winMachine(withNpm({
    env: { ANTHROPIC_API_KEY: secret, OPENAI_API_KEY: secret, GEMINI_API_KEY: secret, CLAUDE_CODE_OAUTH_TOKEN: secret },
    registry: { "HKCU\\Environment": { ANTHROPIC_AUTH_TOKEN: ["REG_SZ", secret], CLAUDE_CONFIG_DIR: ["REG_SZ", "D:\\cfg"] } },
    texts: { [`${HOME}\\.claude\\settings.json`]: JSON.stringify({ env: { ANTHROPIC_API_KEY: secret, CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } }), [`${HOME}\\.codex\\config.toml`]: `experimental_bearer_token = "${secret}"\n` },
  }, ["claude", "codex", "gemini", "copilot"]));
  const f = collect(sys);
  for (const out of [checkText(f), checkMarkdown(f), JSON.stringify(checkJson(f)), agentsText({ ...f, asked: f.agents })]) assert.ok(!out.includes(secret), "the secret is in a report");
});

test("plain words: no emoji and none of the words the house does not use, in any report", () => {
  const f = collect(four({ env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "enabled" } }));
  const all = [checkText(f), checkMarkdown(f), JSON.stringify(checkJson(f)), JSON.stringify(explainListJson(listPages()))].join("\n");
  assert.ok(!/\p{Extended_Pictographic}/u.test(all));
  assert.ok(!/\b(simply|easily|blazing|seamless|powerful|amazing|revolutionary)\b/i.test(all));
});

test("checkMarkdown with maxFindings: caps the errors and warnings to the cap given, or shows all with a high cap", () => {
  const base = collect(winMachine());
  const findings = Array.from({ length: 5 }, (_, i) => ({ id: `claude.f-${i}`, severity: "warning", message: `Message ${i}.`, effect: null, fix: `Fix ${i}.` }));
  const f = { ...base, findings, counts: { error: 0, warning: 5, note: 0 } };

  const cap1 = checkMarkdown(f, { maxFindings: 1 });
  const lines1 = cap1.trimEnd().split("\n");
  assert.equal(lines1.filter((l) => l.startsWith("- WARNING")).length, 1);
  assert.equal(lines1.at(-1), "- ... and 4 more (run `agent-windows-doctor check`)");

  const cap100 = checkMarkdown(f, { maxFindings: 100 });
  const lines100 = cap100.trimEnd().split("\n");
  assert.equal(lines100.filter((l) => l.startsWith("- WARNING")).length, 5);
  assert.ok(!lines100.some((l) => l.includes("and") && l.includes("more")));
});

