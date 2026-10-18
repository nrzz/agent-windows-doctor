// A clean pretend Windows machine for the tests of the findings, the reports and the commands: Git for Windows at C:\Program Files\Git, Windows PowerShell 5.1
// and no PowerShell 7, long paths on, UTF-8 in the console, one ordinary WSL distribution, an empty user environment, and NO agent installed. A test adds
// what it needs (an npm install of an agent, the desktop app's bundle, a hooks file) and spoils one thing, and looks at what is said.
//
// The programs that the tool starts are answered by handlers that read what they are asked: powershell.exe and pwsh.exe answer the probe of src/psprobe.mjs,
// the execution policy of Claude Code's PowerShell, the version resources of src/versions.mjs and Get-AppxPackage (src/check.mjs).
import { fakeMachine, SYSTEM_FILES } from "./machine.mjs";
import { collectWindows } from "../src/check.mjs";
import { REAL_KEY, regUserEnv } from "../src/winenv.mjs";

export const HOME = "C:\\Users\\me";
export const PROJECT = "C:\\work\\shop";
export const utf16 = (text) => Buffer.from(text, "utf16le");
const out = (stdout, status = 0) => ({ status, stdout, stderr: "" });

export const UBUNTU = "  NAME      STATE           VERSION\r\n* Ubuntu    Running         2\r\n";
export const POLICY = (o = {}) => `MachinePolicy=${o.machine || "Undefined"}\r\nUserPolicy=${o.user || "Undefined"}\r\nProcess=Undefined\r\nCurrentUser=${o.currentUser || "RemoteSigned"}\r\nLocalMachine=${o.localMachine || "Undefined"}\r\n`;

/** What the probe of src/psprobe.mjs prints for a PowerShell: edition, version, language mode, effective policy and the scopes. */
export const PSPROBE = (o = {}) => `ED=${o.edition || "Desktop"}\r\nVER=${o.version || "5.1.26100.9711"}\r\nLANG=${o.languageMode || "FullLanguage"}\r\nEFF=${o.effective || o.currentUser || "RemoteSigned"}\r\n${POLICY(o).split("\r\n").filter(Boolean).map((l) => `POL=${l}`).join("\r\n")}\r\n`;

const scriptOf = (args) => String(args[args.length - 1] || "");

/**
 * options (all optional):
 *   env, files, dirs, texts, registry   merged into the clean machine's (registry values are [type, value])
 *   commands        replaces handlers by name (git, cmd, powershell, pwsh, wsl, tasklist, bash)
 *   noGit           true leaves out Git for Windows at C:\Program Files\Git (and git.exe on PATH)
 *   fileVersions    { "C:\\path\\claude.exe": "2.1.299.0" }: the version resource that PowerShell's Get-Item reports
 *   appx            { installLocation, version }: the Store package OpenAI.Codex
 *   ps51, ps7       overrides of PSPROBE for the two editions ({ languageMode, effective, currentUser, machine, ... })
 *   build, ubr      the build of Windows (default 26300) and its update revision (default 9711)
 */
export function winMachine(o = {}) {
  const gitRoot = "C:\\Program Files\\Git";
  const files = [...SYSTEM_FILES, ...(o.noGit ? [] : [`${gitRoot}\\bin\\bash.exe`, `${gitRoot}\\cmd\\git.exe`, `${gitRoot}\\usr\\bin\\bash.exe`]), ...(o.files || [])];
  const registry = {
    "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem": { LongPathsEnabled: ["REG_DWORD", "0x1"] },
    "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage": { OEMCP: ["REG_SZ", "437"], ACP: ["REG_SZ", "1252"] },
    "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion": { UBR: ["REG_DWORD", `0x${(o.ubr ?? 9711).toString(16)}`], DisplayVersion: ["REG_SZ", "25H2"] },
    [REAL_KEY]: {},
    ...(o.registry || {}),
  };
  const versions = o.fileVersions || {};
  const commands = {
    git: (args) => {
      if (args[0] === "--version") return out("git version 2.55.0.windows.3\n");
      const key = args[args.length - 1];
      if (key === "core.autocrlf") return { status: 1, stdout: "", stderr: "" };
      if (key === "core.longpaths") return out("file:C:/Users/me/.gitconfig\ttrue\n");
      return { status: 1, stdout: "", stderr: "" };
    },
    cmd: (args) => {
      const line = String(args[args.length - 1]);
      if (/npm config get prefix/.test(line)) return out(`${HOME}\\AppData\\Roaming\\npm\r\n`);
      if (/npm --version/.test(line)) return out("10.9.0\r\n");
      if (/chcp/.test(line)) return out("Active code page: 65001\r\n");
      return { status: 1, stdout: "", stderr: "" };
    },
    powershell: (args) => {
      const s = scriptOf(args);
      if (/VersionInfo/.test(s)) {
        const paths = [...s.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'")).filter((p) => /\\/.test(p));
        return out(`${paths.map((p, i) => `V|${i}|${versions[p] || ""}|${versions[p] || ""}|${versions[p] ? "Product" : ""}`).join("\r\n")}\r\n`);
      }
      if (/Get-AppxPackage/.test(s)) return out(o.appx ? `APPX|${o.appx.installLocation}|${o.appx.version}\r\n` : "");
      if (/PSEdition/.test(s)) return out(PSPROBE(o.ps51 || {}));
      return out(POLICY(o.ps51 || {}));
    },
    pwsh: (args) => {
      const s = scriptOf(args);
      if (/PSEdition/.test(s)) return out(PSPROBE({ edition: "Core", version: "7.5.3", effective: "RemoteSigned", ...(o.ps7 || {}) }));
      return out(POLICY(o.ps7 || {}));
    },
    wsl: () => ({ status: 0, stdout: utf16(UBUNTU) }),
    tasklist: () => out("INFO: No tasks are running which match the specified criteria.\r\n"),
    bash: () => out(""),
    ...(o.commands || {}),
  };
  return fakeMachine({
    env: { Path: `C:\\Program Files\\Git\\cmd;C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\WindowsPowerShell\\v1.0`, SystemRoot: "C:\\Windows", USERPROFILE: HOME, APPDATA: `${HOME}\\AppData\\Roaming`, LOCALAPPDATA: `${HOME}\\AppData\\Local`, ProgramData: "C:\\ProgramData", ProgramFiles: "C:\\Program Files", ProgramW6432: "C:\\Program Files", ...(o.env || {}) },
    cwd: PROJECT,
    home: HOME,
    release: `10.0.${o.build ?? 26300}`,
    files,
    dirs: [PROJECT, ...(o.dirs || [])],
    texts: o.texts || {},
    versions: {},
    registry,
    commands,
    nodeVersion: o.nodeVersion,
    mtimes: o.mtimes,
  });
}

/** collectWindows on a machine, with the user environment layer of that machine (a file it holds, or the registry). */
export function collect(sys, project = PROJECT, agents, explicit = false) {
  return collectWindows(sys, { project, userEnv: regUserEnv(sys), agents, explicit });
}

export const idsOf = (facts) => facts.findings.map((f) => f.id);

// ---- what an agent install looks like on disk ------------------------------------------------------------------------------------

/** An npm global install of a package: the shims in `prefix`, the package.json, the JavaScript entry and the platform program. Returns { files, texts }. */
export function npmInstall(agent, { prefix = `${HOME}\\AppData\\Roaming\\npm`, version, engines } = {}) {
  const files = [];
  const texts = {};
  const nm = `${prefix}\\node_modules`;
  const add = (p, text) => { if (text === undefined) files.push(p); else texts[p] = text; };
  if (agent === "claude") {
    add(`${prefix}\\claude.cmd`, `@ECHO off\r\nGOTO start\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n`);
    add(`${prefix}\\claude.ps1`, "# shim");
    add(`${nm}\\@anthropic-ai\\claude-code\\package.json`, JSON.stringify({ name: "@anthropic-ai/claude-code", version: version || "2.1.302", engines: engines || { node: ">=22.0.0" }, bin: { claude: "bin/claude.exe" } }));
    add(`${nm}\\@anthropic-ai\\claude-code\\bin\\claude.exe`);
  }
  if (agent === "codex") {
    add(`${prefix}\\codex.cmd`, `@ECHO off\r\nGOTO start\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n`);
    add(`${prefix}\\codex.ps1`, "# shim");
    add(`${nm}\\@openai\\codex\\package.json`, JSON.stringify({ name: "@openai/codex", version: version || "0.163.0", engines: engines || { node: ">=16" } }));
    add(`${nm}\\@openai\\codex\\bin\\codex.js`, "// entry");
    add(`${nm}\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\package.json`, JSON.stringify({ name: "@openai/codex", version: `${version || "0.163.0"}-win32-x64` }));
    add(`${nm}\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`);
  }
  if (agent === "gemini") {
    add(`${prefix}\\gemini.cmd`, `@ECHO off\r\nGOTO start\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@google\\gemini-cli\\bundle\\gemini.js" %*\r\n`);
    add(`${nm}\\@google\\gemini-cli\\package.json`, JSON.stringify({ name: "@google/gemini-cli", version: version || "0.64.0", engines: engines || { node: ">=20" } }));
    add(`${nm}\\@google\\gemini-cli\\bundle\\gemini.js`, "// bundle");
    add(`${nm}\\@google\\gemini-cli\\node_modules\\@lydell\\node-pty-win32-x64\\conpty.node`);
  }
  if (agent === "copilot") {
    add(`${prefix}\\copilot.cmd`, `@ECHO off\r\nGOTO start\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@github\\copilot\\npm-loader.js" %*\r\n`);
    add(`${nm}\\@github\\copilot\\package.json`, JSON.stringify({ name: "@github/copilot", version: version || "1.0.98", ...(engines ? { engines } : {}), bin: { copilot: "npm-loader.js" } }));
    add(`${nm}\\@github\\copilot\\npm-loader.js`, "// loader");
    add(`${nm}\\@github\\copilot\\node_modules\\@github\\copilot-win32-x64\\copilot.exe`);
  }
  return { files, texts };
}

/** The machine's own pieces for an npm install, merged into winMachine's options (files, texts, and the prefix on PATH). */
export function withNpm(options, agents, install = {}) {
  const prefix = install.prefix || `${HOME}\\AppData\\Roaming\\npm`;
  const files = [...(options.files || [])];
  const texts = { ...(options.texts || {}) };
  for (const a of agents) { const r = npmInstall(a, { ...install, prefix }); files.push(...r.files); Object.assign(texts, r.texts); }
  const env = { ...(options.env || {}) };
  if (!env.Path) env.Path = `${prefix};C:\\Program Files\\Git\\cmd;C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\WindowsPowerShell\\v1.0`;
  return { ...options, files, texts, env };
}
