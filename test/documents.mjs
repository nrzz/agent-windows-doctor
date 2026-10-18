// One document of every kind and shape that the commands print with --json, built on pretend machines (and stand-ins for the live runs): test/readme.test.mjs holds the shapes of the README
// to them. Not a test.
import { run } from "./helpers.mjs";
import { fakeMachine } from "./machine.mjs";
import { HOME, PROJECT, npmInstall, winMachine, withNpm } from "./win-machine.mjs";
import { CMD_TEXT, PS1_TEXT, REAL_VERSION_FOLDER } from "./cursor-files.mjs";

const NPM = `${HOME}\\AppData\\Roaming\\npm`;
const PS_DIR = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0";
const E_GIT = ["E:\\Das\\Git\\cmd\\git.exe", "E:\\Das\\Git\\mingw64\\bin\\git.exe", "E:\\Das\\Git\\bin\\bash.exe", "E:\\Das\\Git\\usr\\bin\\bash.exe"];
const LOCAL = `${HOME}\\AppData\\Local`;

const claudeRun = (o = {}) => async () => ({ ran: true, exitCode: 0, timedOut: false, requests: 1, tools: ["Bash", "Read"], shellTools: ["Bash"], edition: null, using: "C:\\Program Files\\Git\\bin\\bash.exe", warning: null, notFound: false, stderr: "", cwd: "C:\\Temp\\adw-test", ...o });
const shellRun = (program, o = {}) => async () => ({ ran: true, exitCode: 0, timedOut: false, requests: 2, line: program ? `"${program}" -Command x` : null, program, error: null, stderr: "", ...o });
const PS51 = `${PS_DIR}\\powershell.exe`;

/** A Windows machine with the four npm agents, the Cursor CLI launcher, and a user whose setup is wrong in every way that the tool has a finding for. */
export function busyMachine() {
  const cursor = `${LOCAL}\\cursor-agent`;
  const files = [`${cursor}\\agent.cmd`, `${cursor}\\cursor-agent.cmd`, `${cursor}\\cursor-agent.ps1`, `${HOME}\\.local\\bin\\claude.exe`, ...E_GIT, "C:\\Windows\\System32\\bash.exe"];
  const texts = {
    [`${cursor}\\agent.cmd`]: CMD_TEXT,
    [`${cursor}\\cursor-agent.ps1`]: PS1_TEXT,
    [`${HOME}\\.claude\\settings.json`]: JSON.stringify({ defaultShell: "powershell", env: { CLAUDE_CODE_GIT_BASH_PATH: "C:\\nope\\bash.exe" }, permissions: { deny: ["Bash(git push *)"] } }),
    [`${PROJECT}\\.claude\\settings.json`]: JSON.stringify({ env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "enabled" }, hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "$CLAUDE_PROJECT_DIR/hooks/guard.sh" }] }] } }),
    [`${HOME}\\.codex\\config.toml`]: 'model = "gpt-5.5"\nsandbox_mode = "workspace-write"\n\n[windows]\nshell_path = "C:/Program Files/Git/bin/bash.exe"\n\n[[hooks.PreToolUse]]\nmatcher = "*"\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = "[ -f package.json ] && node hooks/check.mjs"\ncommand_windows = "node hooks/check.mjs"\ntimeout = 30\n',
    [`${HOME}\\.gemini\\settings.json`]: JSON.stringify({ hooks: { BeforeTool: [{ matcher: "*", hooks: [{ type: "command", command: "./hooks/check.ps1" }] }] } }),
    [`${PROJECT}\\.github\\hooks\\guard.json`]: JSON.stringify({ version: 1, hooks: { preToolUse: [{ type: "command", bash: "./hooks/guard.sh", timeoutSec: 10 }] } }),
    [`${HOME}\\.cursor\\hooks.json`]: JSON.stringify({ version: 1, hooks: { beforeShellExecution: [{ command: "./hooks/audit" }] } }),
  };
  const installs = ["codex", "gemini", "copilot"].map((a) => npmInstall(a));
  for (const i of installs) { files.push(...i.files); Object.assign(texts, i.texts); }
  return winMachine({
    noGit: true,
    dirs: [`${cursor}\\versions\\${REAL_VERSION_FOLDER}`],
    files,
    texts,
    env: { Path: `${NPM};${HOME}\\.local\\bin;C:\\Windows\\System32;C:\\Windows;${PS_DIR}`, MSYSTEM: "MINGW64", ProgramData: "C:\\ProgramData" },
  });
}

const four = (o = {}) => winMachine(withNpm(o, ["claude", "codex", "gemini", "copilot"]));

export async function documents() {
  const docs = { check: [], agents: [], explain: [], error: [] };
  const j = async (args, o) => (await run([...args, "--json"], o)).json();
  const tmp = "C:\\Temp\\adw-test";
  // check on Windows: no agent, a clean machine with the four, a machine that is wrong in every way, one agent named, one named and not found
  docs.check.push(await j(["check"], { sys: winMachine() }));
  docs.check.push(await j(["check"], { sys: four() }));
  docs.check.push(await j(["check", "--project", PROJECT], { sys: busyMachine() }));
  docs.check.push(await j(["check", "--agent", "codex"], { sys: four() }));
  docs.check.push(await j(["check", "--agent", "cursor"], { sys: four() }));
  // check --live: proved, a difference, an error, an agent skipped (not found; the Cursor CLI), a path that is not a file
  const runners = { claude: claudeRun(), codex: shellRun(PS51), gemini: shellRun(PS51), copilot: shellRun("powershell.exe") };
  docs.check.push(await j(["check", "--live"], { sys: four(), tempDir: tmp, liveRunner: runners }));
  docs.check.push(await j(["check", "--live", "--agent", "codex"], { sys: four(), tempDir: tmp, liveRunner: { codex: shellRun("C:\\Program Files\\PowerShell\\7\\pwsh.exe") } }));
  docs.check.push(await j(["check", "--live", "--agent", "gemini"], { sys: four(), tempDir: tmp, liveRunner: { gemini: shellRun(null, { error: "spawn powershell.exe ENOENT" }) } }));
  docs.check.push(await j(["check", "--live", "--agent", "cursor,gemini", "--gemini", "C:\\nope\\gemini.cmd"], { sys: winMachine(withNpm({}, ["codex"])), tempDir: tmp }));
  docs.check.push(await j(["check", "--live", "--agent", "claude"], { sys: four(), tempDir: tmp, liveRunner: { claude: claudeRun({ shellTools: ["PowerShell"], tools: ["PowerShell"], using: null }) } }));
  // WSL, Linux and macOS
  const wsl = fakeMachine({ platform: "linux", env: { PATH: "/mnt/c/Users/me/.local/bin:/usr/bin" }, home: "/home/me", cwd: "/home/me/code", files: ["/mnt/c/Users/me/.local/bin/claude"], texts: { "/proc/version": "Linux version 5.15-microsoft-standard-WSL2" }, versions: { "/mnt/c/Users/me/.local/bin/claude": "2.1.299 (Claude Code)" } });
  docs.check.push(await j(["check"], { sys: wsl }));
  docs.check.push(await j(["check", "--agent", "codex"], { sys: fakeMachine({ platform: "linux", env: { CODEX_HOME: "/mnt/c/Users/me/.codex" }, home: "/home/me", cwd: "/home/me/code", texts: { "/proc/version": "Linux version 5.15-microsoft-standard-WSL2" } }) }));
  docs.check.push(await j(["check"], { sys: fakeMachine({ platform: "darwin" }) }));
  docs.check.push(await j(["check", "--live"], { sys: fakeMachine({ platform: "linux" }) }));
  // agents
  docs.agents.push(await j(["agents"], { sys: winMachine() }));
  docs.agents.push(await j(["agents"], { sys: busyMachine() }));
  docs.agents.push(await j(["agents", "--agent", "copilot"], { sys: four() }));
  docs.agents.push(await j(["agents"], { sys: fakeMachine({ platform: "darwin" }) }));
  // explain
  docs.explain.push(await j(["explain", "codex.shell-path-ignored"], {}));
  docs.explain.push(await j(["explain", "claude.git-bash-not-found"], {}));
  docs.explain.push(await j(["explain", "--list"], {}));
  docs.explain.push(await j(["explain", "nosuch"], {}));
  docs.explain.push(await j(["explain", "sandbox"], {}));
  // usage errors
  docs.error.push(await j(["check", "--bogus"], { sys: winMachine() }));
  docs.error.push(await j(["explain"], {}));
  return docs;
}
