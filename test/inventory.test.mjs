// Every Claude Code, Codex CLI, Gemini CLI, GitHub Copilot CLI and Cursor on a machine: PATH order, the places the installers use, the chain of an npm shim,
// where each version is read from (never by running the program), which one runs first, and the programs that are named and never run.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { fakeMachine, SYSTEM_PATH } from "./machine.mjs";
import { HOME, npmInstall, winMachine, withNpm } from "./win-machine.mjs";
import { AGENT_IDS, COMMANDS, CLI_ORIGINS, compareVersions, findAgents, newestCursorVersion, originOf } from "../src/inventory.mjs";
import { npmShimTarget, readFileVersions, satisfiesNode, trimFileVersion, versionFromFolder, versionIn } from "../src/versions.mjs";

const NPM = `${HOME}\\AppData\\Roaming\\npm`;
const entriesOf = (sys, agent, ctx) => findAgents(sys, { agents: [agent], ctx }).agents[agent];

test("the five agents and their commands", () => {
  assert.deepEqual(AGENT_IDS, ["claude", "codex", "gemini", "copilot", "cursor"]);
  assert.deepEqual(COMMANDS, { claude: ["claude"], codex: ["codex"], gemini: ["gemini"], copilot: ["copilot"], cursor: ["agent", "cursor-agent"] });
  assert.ok(CLI_ORIGINS.has("npm") && CLI_ORIGINS.has("standalone") && !CLI_ORIGINS.has("desktop-app") && !CLI_ORIGINS.has("desktop-bundle"));
});

test("an npm install of each agent: the shim is the entry, the package gives the version, and the chain of what it starts is read from the shim and the folders", () => {
  const sys = winMachine(withNpm({}, ["claude", "codex", "gemini", "copilot"]));
  const inv = findAgents(sys, {}).agents;
  const claude = inv.claude.entries[0];
  assert.equal(claude.path, `${NPM}\\claude.cmd`);
  assert.deepEqual([claude.origin, claude.version, claude.versionFrom, claude.runsFirst, claude.onPath], ["npm", "2.1.302", "package.json of @anthropic-ai/claude-code", true, true]);
  assert.deepEqual(claude.leadsTo, [`${NPM}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`], "the shim starts the program directly");
  assert.equal(claude.package.engines.node, ">=22.0.0");
  const codex = inv.codex.entries[0];
  assert.deepEqual(codex.leadsTo, [`${NPM}\\node_modules\\@openai\\codex\\bin\\codex.js`, `${NPM}\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`], "codex.cmd -> codex.js -> the vendored codex.exe");
  assert.equal(codex.version, "0.163.0");
  assert.equal(inv.gemini.entries[0].version, "0.64.0");
  assert.deepEqual(inv.gemini.entries[0].leadsTo, [`${NPM}\\node_modules\\@google\\gemini-cli\\bundle\\gemini.js`]);
  const copilot = inv.copilot.entries[0];
  assert.equal(copilot.version, "1.0.98");
  assert.equal(copilot.leadsTo[1], `${NPM}\\node_modules\\@github\\copilot\\node_modules\\@github\\copilot-win32-x64\\copilot.exe`);
  assert.deepEqual(inv.cursor.entries, []);
  // nothing was run: no program but where.exe-like lookups and the version resources
  assert.ok(sys.runs.every((r) => !/claude|codex|gemini|copilot/i.test(`${r.cmd} ${r.args.join(" ")}`) || /VersionInfo/.test(r.args.join(" "))), "no agent binary was started");
});

test("the platform package of an npm install may sit next to the package (a local prefix) as well as inside it (a global one)", () => {
  const files = ["C:\\p\\codex.cmd"];
  const texts = {
    "C:\\p\\codex.cmd": '@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n',
    "C:\\p\\node_modules\\@openai\\codex\\package.json": JSON.stringify({ name: "@openai/codex", version: "0.163.0" }),
    "C:\\p\\node_modules\\@openai\\codex\\bin\\codex.js": "x",
  };
  const sys = fakeMachine({ env: { Path: `C:\\p;${SYSTEM_PATH}` }, files: [...files, "C:\\p\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe"], texts });
  const e = entriesOf(sys, "codex").entries[0];
  assert.equal(e.leadsTo.length, 2);
  assert.match(e.leadsTo[1], /node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex\.exe$/);
});

test("PATH decides which one runs first: the folders in order, the extensions of PATHEXT, and a .ps1 or a bare file only when there is no program beside it", () => {
  const sys = fakeMachine({
    env: { Path: `D:\\a;D:\\b;D:\\c;${SYSTEM_PATH}`, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
    files: ["D:\\a\\codex.ps1", "D:\\a\\codex", "D:\\b\\codex.cmd", "D:\\b\\codex.exe", "D:\\c\\codex.exe"],
    dirs: ["C:\\work"],
  });
  const a = entriesOf(sys, "codex");
  assert.deepEqual(a.entries.map((e) => [e.path, e.kind]), [["D:\\a\\codex.ps1", "script"], ["D:\\b\\codex.exe", "program"], ["D:\\b\\codex.cmd", "program"], ["D:\\c\\codex.exe", "program"]]);
  assert.equal(a.first.path, "D:\\b\\codex.exe", "the first program on PATH, in the order of PATHEXT within a folder; a script is not the one that runs");
  assert.equal(a.entries[0].skipped, "a script, not run (the same install as the .cmd of npm)");
  assert.deepEqual(a.entries.map((e) => e.runsFirst), [false, true, false, false]);
});

test("names and folders match in any case, and a path with spaces and backslashes is kept as it is", () => {
  const sys = fakeMachine({ env: { Path: `d:\\My Tools\\bin;${SYSTEM_PATH}` }, files: ["D:\\my tools\\BIN\\Gemini.CMD"], texts: {} });
  const e = entriesOf(sys, "gemini").entries;
  assert.equal(e.length, 1);
  assert.equal(e[0].path, "d:\\My Tools\\bin\\gemini.cmd", "the file is found by its name in any case, and named by the folder of PATH");
});

test("the places the installers use are searched even when they are not on PATH, and are said not to be on PATH", () => {
  const local = `${HOME}\\AppData\\Local`;
  const sys = winMachine({
    files: [`${HOME}\\.local\\bin\\claude.exe`, `${local}\\Programs\\OpenAI\\Codex\\bin\\codex.exe`, `${local}\\Microsoft\\WinGet\\Links\\copilot.exe`, `${local}\\cursor-agent\\agent.cmd`, `${local}\\cursor-agent\\cursor-agent.cmd`, `${local}\\Programs\\cursor\\Cursor.exe`],
    dirs: [`${local}\\cursor-agent\\versions\\2026.06.16-20-30-07-a07d3ac`],
    fileVersions: { [`${HOME}\\.local\\bin\\claude.exe`]: "2.1.299.0", [`${local}\\Microsoft\\WinGet\\Links\\copilot.exe`]: "1.0.98", [`${local}\\Programs\\cursor\\Cursor.exe`]: "3.19.19" },
  });
  const inv = findAgents(sys, {}).agents;
  assert.deepEqual([inv.claude.entries[0].origin, inv.claude.entries[0].version, inv.claude.entries[0].versionFrom, inv.claude.entries[0].onPath], ["native", "2.1.299", "file version", false]);
  assert.equal(inv.claude.first, null, "none of them is on PATH");
  assert.equal(inv.codex.entries[0].origin, "standalone");
  assert.equal(inv.codex.entries[0].version, null, "codex.exe has no version resource: not read");
  assert.equal(inv.copilot.entries[0].origin, "winget");
  assert.equal(inv.copilot.entries[0].version, "1.0.98");
  const cursor = inv.cursor.entries;
  assert.equal(cursor.filter((e) => e.origin === "cursor-cli").length, 1, "agent.cmd and cursor-agent.cmd are one install");
  assert.deepEqual(cursor.find((e) => e.origin === "cursor-cli").also, ["cursor-agent.cmd"]);
  assert.deepEqual([cursor.find((e) => e.origin === "cursor-cli").version, cursor.find((e) => e.origin === "cursor-cli").versionFrom], ["2026.06.16-20-30-07-a07d3ac", "versions folder"]);
  const editor = cursor.find((e) => e.origin === "editor");
  assert.deepEqual([editor.kind, editor.version, editor.versionFrom], ["editor", "3.19.19", "file version"]);
});

test("the Claude desktop app's bundles are read from the folder name, and its launcher and a Store alias are named and never run", () => {
  const appdata = `${HOME}\\AppData\\Roaming`;
  const local = `${HOME}\\AppData\\Local`;
  const sys = winMachine({
    env: { Path: `${local}\\Microsoft\\WindowsApps;${local}\\AnthropicClaude;C:\\Windows\\System32;C:\\Windows` },
    files: [`${local}\\Microsoft\\WindowsApps\\claude.exe`, `${local}\\AnthropicClaude\\claude.exe`, `${appdata}\\Claude\\claude-code\\2.1.295\\d2e29494ec83\\claude.exe`, `${appdata}\\Claude\\claude-code\\2.1.299\\f0584be0fbaf\\claude.exe`],
  });
  const a = entriesOf(sys, "claude");
  assert.deepEqual(a.entries.map((e) => [e.origin, e.skipped ? "skipped" : "run", e.version]), [["store-alias", "skipped", null], ["desktop-launcher", "skipped", null], ["desktop-bundle", "run", "2.1.295"], ["desktop-bundle", "run", "2.1.299"]]);
  assert.equal(a.entries[2].versionFrom, "folder name");
  assert.equal(a.first.origin, "store-alias", "the first program on PATH is the alias: a terminal starts that");
  assert.equal(a.first.skipped, "a Microsoft Store app alias (not run)");
});

test("the Codex desktop app's copy is found from the Store package, with the version of the app and not of the CLI", () => {
  const loc = "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.1007.9446.0_x64__2p2nqsd0c76g0";
  const sys = winMachine({ files: [`${loc}\\app\\resources\\codex.exe`] });
  const a = entriesOf(sys, "codex", { codexApp: { installLocation: loc, version: "26.1007.9446.0" } });
  const e = a.entries[0];
  assert.deepEqual([e.origin, e.version, e.appVersion, e.onPath], ["desktop-app", "26.1007.9446.0", true, false]);
  assert.match(e.versionFrom, /^app package: the version of the app, not of the CLI inside it$/);
  assert.equal(e.path, `${loc}\\app\\resources\\codex.exe`);
  assert.equal(a.first, null);
  assert.ok(!CLI_ORIGINS.has(e.origin), "it does not count as a second command line");
});

test("Copilot's cache is a folder the program unpacked for itself: it has a version and is not a command", () => {
  const local = `${HOME}\\AppData\\Local`;
  const sys = winMachine({ dirs: [`${local}\\copilot\\pkg\\win32-x64\\1.0.98`], texts: { [`${local}\\copilot\\pkg\\win32-x64\\1.0.98\\package.json`]: JSON.stringify({ name: "@github/copilot", version: "1.0.98" }) } });
  const e = entriesOf(sys, "copilot").entries[0];
  assert.deepEqual([e.kind, e.origin, e.version, e.versionFrom], ["cache", "cache", "1.0.98", "package.json in the cache"]);
  assert.match(e.skipped, /not a command/);
});

test("originOf: where a file of each agent came from, by its path", () => {
  assert.equal(originOf("claude", "C:\\Users\\me\\.local\\bin\\claude.exe"), "native");
  assert.equal(originOf("claude", "C:\\Users\\me\\AppData\\Roaming\\Claude\\claude-code\\2.1.299\\f0584be0fbaf\\claude.exe"), "desktop-bundle");
  assert.equal(originOf("codex", "C:\\Users\\me\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe"), "standalone");
  assert.equal(originOf("codex", "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.1007.9446.0_x64__2p2nqsd0c76g0\\app\\resources\\codex.exe"), "desktop-app");
  assert.equal(originOf("codex", "C:\\x\\node_modules\\@openai\\codex-win32-x64\\vendor\\t\\bin\\codex.exe"), "npm-program");
  assert.equal(originOf("gemini", "C:\\Users\\me\\AppData\\Roaming\\npm\\gemini.cmd"), "npm");
  assert.equal(originOf("copilot", "C:\\Users\\me\\AppData\\Local\\copilot\\pkg\\win32-x64\\1.0.98"), "cache");
  assert.equal(originOf("copilot", "C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Packages\\GitHub.Copilot_x\\copilot.exe"), "winget");
  assert.equal(originOf("cursor", "C:\\Users\\me\\AppData\\Local\\cursor-agent\\agent.cmd"), "cursor-cli");
  assert.equal(originOf("cursor", "C:\\Users\\me\\AppData\\Local\\Programs\\cursor\\Cursor.exe"), "editor");
  assert.equal(originOf("claude", "/mnt/c/Users/me/.local/bin/claude", "linux"), "windows");
  assert.equal(originOf("claude", "/home/me/.local/bin/claude", "linux"), "native");
});

test("on a system that is not Windows only claude is looked for, on PATH and in ~/.local/bin", () => {
  const sys = fakeMachine({ platform: "linux", env: { PATH: "/usr/bin:/mnt/c/Users/me/.local/bin" }, home: "/home/me", files: ["/mnt/c/Users/me/.local/bin/claude", "/home/me/.local/bin/claude"] });
  const a = findAgents(sys, { agents: ["claude"] }).agents.claude;
  assert.deepEqual(a.entries.map((e) => [e.path, e.origin, e.onPath]), [["/mnt/c/Users/me/.local/bin/claude", "windows", true], ["/home/me/.local/bin/claude", "native", false]]);
  assert.equal(a.first.path, "/mnt/c/Users/me/.local/bin/claude");
});

test("version helpers: the numbers of a file version, folder names, versions in text, order, and the Node range of engines", () => {
  assert.equal(trimFileVersion("2.1.299.0"), "2.1.299");
  assert.equal(trimFileVersion("1.0.98"), "1.0.98");
  assert.equal(trimFileVersion("3.19.19.2"), "3.19.19.2");
  assert.equal(trimFileVersion(""), null);
  assert.equal(trimFileVersion("abc"), null);
  assert.equal(versionFromFolder("2.1.299"), "2.1.299");
  assert.equal(versionFromFolder("2026.06.16-20-30-07-a07d3ac"), "2026.06.16-20-30-07-a07d3ac");
  assert.equal(versionFromFolder("d2e29494ec83"), null);
  assert.equal(versionIn("codex-cli 0.163.0"), "0.163.0");
  assert.equal(versionIn("GitHub Copilot CLI 1.0.98."), "1.0.98", "the full stop of the sentence is not part of the version");
  assert.equal(compareVersions("2.1.302", "2.1.299"), 1);
  assert.equal(compareVersions("2.1.9", "2.1.10"), -1);
  assert.equal(compareVersions(null, "1.0.0"), -1);
  assert.equal(compareVersions("2026.06.17-1-1-1-aaa", "2026.06.16-23-59-59-bbb"), 1);
  assert.equal(newestCursorVersion(["2026.06.16-20-30-07-a07d3ac", "2026.05.01-1-1-1-abc", "junk"]), "2026.06.16-20-30-07-a07d3ac");
  assert.equal(newestCursorVersion([]), null);
  assert.equal(satisfiesNode("24.19.0", ">=22.0.0"), true);
  assert.equal(satisfiesNode("v20.1.0", ">=22"), false);
  assert.equal(satisfiesNode("18.0.0", ">=16"), true);
  assert.equal(satisfiesNode("18.0.0", "^16 || ^18"), null, "a range it cannot read is not judged");
});

test("readFileVersions: one PowerShell call for the files, in order, null for a file with none; nothing on a system that is not Windows", () => {
  const sys = winMachine({ fileVersions: { "C:\\a\\x.exe": "2.1.299.0", "C:\\it's\\y.exe": "1.0.98" } });
  const r = readFileVersions(sys, ["C:\\a\\x.exe", "C:\\none.exe", "C:\\it's\\y.exe"]);
  assert.deepEqual(r.map((x) => x.fileVersion), ["2.1.299.0", null, "1.0.98"]);
  const calls = sys.runs.filter((x) => /powershell/i.test(x.cmd));
  assert.equal(calls.length, 1);
  assert.match(calls[0].args.join(" "), /-NoProfile -NonInteractive -Command/);
  assert.match(calls[0].args.at(-1), /it''s/, "a single quote in a path is doubled");
  assert.deepEqual(readFileVersions(fakeMachine({ platform: "linux" }), ["/a"]), [{ file: "/a", fileVersion: null, productVersion: null, productName: null }]);
});

test("npmShimTarget: the real shims of npm, a program and a JavaScript file, and a file that is not a shim", () => {
  const texts = {
    "C:\\n\\claude.cmd": '@ECHO off\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\..\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n',
    "C:\\n\\gemini.cmd": '@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\..\\@google\\gemini-cli\\bundle\\gemini.js" %*\r\n',
    "C:\\n\\other.cmd": "@echo off\r\necho hello\r\n",
  };
  const sys = fakeMachine({ texts });
  assert.deepEqual(npmShimTarget(sys, "C:\\n\\claude.cmd"), { target: "C:\\@anthropic-ai\\claude-code\\bin\\claude.exe", js: false });
  assert.deepEqual(npmShimTarget(sys, "C:\\n\\gemini.cmd"), { target: "C:\\@google\\gemini-cli\\bundle\\gemini.js", js: true });
  assert.equal(npmShimTarget(sys, "C:\\n\\other.cmd"), null);
  assert.equal(npmShimTarget(sys, "C:\\n\\missing.cmd"), null);
});

test("npmInstall of the test helper is what the real npm writes (the shim lines are those of the real packages)", () => {
  const r = npmInstall("codex", {});
  const shim = r.texts[`${NPM}\\codex.cmd`];
  assert.match(shim, /"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex\.js" %\*/);
});
