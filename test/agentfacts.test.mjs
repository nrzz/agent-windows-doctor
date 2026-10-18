// Facts read from one agent's files: the Cursor CLI's launcher chain, the native half of node-pty in a Gemini CLI install, and the Node each npm package asks for.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { HOME, winMachine, withNpm, npmInstall } from "./win-machine.mjs";
import { CMD_TEXT, PATTERN, PS1_TEXT, REAL_VERSION_FOLDER } from "./cursor-files.mjs";
import { findAgents } from "../src/inventory.mjs";
import { nodeWants, parseCursorCmd, parseCursorPs1, psMatch, ptyOf, readCursorLauncher } from "../src/agentfacts.mjs";

const DIR = `${HOME}\\AppData\\Local\\cursor-agent`;

test("parseCursorCmd: delayed expansion, the PowerShell 5.1 it hardcodes with its flags, and %* for the arguments", () => {
  const c = parseCursorCmd(CMD_TEXT);
  assert.deepEqual(c, { delayedExpansion: true, powershell: "%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", hardcoded51: true, flags: "-NoProfile -ExecutionPolicy Bypass -File <script>", forwardsArgs: true });
  assert.equal(parseCursorCmd("@echo off\r\nREM powershell is not run here\r\nnode x.js %*\r\n").powershell, null, "a comment is not the command");
  const pwsh = parseCursorCmd("@echo off\r\npwsh -File x.ps1 %*\r\n");
  assert.deepEqual([pwsh.hardcoded51, pwsh.delayedExpansion, pwsh.forwardsArgs, pwsh.powershell], [false, false, true, "pwsh"]);
  assert.equal(parseCursorCmd("@echo off\r\npowershell.exe -File x.ps1\r\n").forwardsArgs, false);
  assert.equal(parseCursorCmd(""). powershell, null);
});

test("parseCursorPs1 and psMatch: the pattern of the version filter, and what PowerShell's -match (case-insensitive) does with it", () => {
  const p = parseCursorPs1(PS1_TEXT);
  assert.deepEqual(p, { versionPattern: PATTERN, runsRootNode: true, picksByDate: true });
  assert.equal(psMatch(PATTERN, "2026.06.16-a07d3ac"), true);
  assert.equal(psMatch(PATTERN, "2026.6.5-ABC123"), true, "-match ignores case");
  assert.equal(psMatch(PATTERN, REAL_VERSION_FOLDER), false, "the folder the installer made on that machine has more parts than the pattern allows");
  assert.equal(psMatch("[unclosed", "x"), null, "a pattern JavaScript cannot read is not judged");
  assert.deepEqual(parseCursorPs1("nothing here"), { versionPattern: null, runsRootNode: false, picksByDate: false });
});

test("readCursorLauncher: the files, the version folders, the ones the pattern takes, and a launcher that cannot pick one", () => {
  const files = [`${DIR}\\agent.cmd`, `${DIR}\\cursor-agent.ps1`];
  const texts = { [`${DIR}\\agent.cmd`]: CMD_TEXT, [`${DIR}\\cursor-agent.ps1`]: PS1_TEXT };
  const stuck = readCursorLauncher(winMachine({ files, texts, dirs: [`${DIR}\\versions\\${REAL_VERSION_FOLDER}`] }), DIR);
  assert.deepEqual([stuck.versions, stuck.matching, stuck.rootNode, stuck.noVersionFolder], [[REAL_VERSION_FOLDER], [], false, true]);
  assert.equal(stuck.powershell, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "%SystemRoot% is expanded");
  assert.equal(stuck.args, "-NoProfile -ExecutionPolicy Bypass -File <script>");
  const fine = readCursorLauncher(winMachine({ files, texts, dirs: [`${DIR}\\versions\\2026.06.16-a07d3ac`, `${DIR}\\versions\\2026.07.01-bbbb`] }), DIR);
  assert.deepEqual([fine.matching.length, fine.noVersionFolder], [2, false]);
  const root = readCursorLauncher(winMachine({ files: [...files, `${DIR}\\node.exe`], texts, dirs: [`${DIR}\\versions\\${REAL_VERSION_FOLDER}`] }), DIR);
  assert.deepEqual([root.rootNode, root.noVersionFolder], [true, false], "a node.exe beside the script is run, and no folder is picked");
  const empty = readCursorLauncher(winMachine({ files, texts, dirs: [`${DIR}\\versions`] }), DIR);
  assert.equal(empty.noVersionFolder, true, "no folder in versions is the same trouble");
  assert.equal(readCursorLauncher(winMachine(), DIR), null, "no launcher, no answer");
  const noPs1 = readCursorLauncher(winMachine({ files: [`${DIR}\\agent.cmd`], texts: { [`${DIR}\\agent.cmd`]: CMD_TEXT } }), DIR);
  assert.deepEqual([noPs1.ps1, noPs1.noVersionFolder], [null, false]);
});

test("the Cursor inventory picks the newest version folder by the launcher's rule, and ignores folders that are not versions", () => {
  const sys = winMachine({ files: [`${DIR}\\agent.cmd`, `${DIR}\\cursor-agent.cmd`], dirs: [`${DIR}\\versions\\2026.05.01-1-1-1-aaa`, `${DIR}\\versions\\2026.06.16-20-30-07-a07d3ac`, `${DIR}\\versions\\tmp`], env: { Path: `${DIR};C:\\Windows\\System32` } });
  const e = findAgents(sys, { agents: ["cursor"] }).agents.cursor.entries[0];
  assert.deepEqual([e.version, e.versionFrom, e.also], ["2026.06.16-20-30-07-a07d3ac", "versions folder", ["cursor-agent.cmd"]]);
  assert.deepEqual(e.versions.sort(), ["2026.05.01-1-1-1-aaa", "2026.06.16-20-30-07-a07d3ac", "tmp"]);
});

test("ptyOf: conpty.node under @lydell/node-pty-win32-x64, hoisted next to the package or inside it, or the older node-pty build; none is none", () => {
  const nm = "C:\\n\\node_modules";
  const pkg = `${nm}\\@google\\gemini-cli`;
  const inside = ptyOf(winMachine({ files: [`${pkg}\\node_modules\\@lydell\\node-pty-win32-x64\\conpty.node`] }), pkg);
  assert.equal(inside.found, `${pkg}\\node_modules\\@lydell\\node-pty-win32-x64\\conpty.node`);
  assert.equal(ptyOf(winMachine({ files: [`${nm}\\@lydell\\node-pty-win32-arm64\\conpty.node`] }), pkg).found, `${nm}\\@lydell\\node-pty-win32-arm64\\conpty.node`, "hoisted, on ARM");
  assert.equal(ptyOf(winMachine({ files: [`${nm}\\node-pty\\build\\Release\\conpty.node`] }), pkg).found, `${nm}\\node-pty\\build\\Release\\conpty.node`);
  const none = ptyOf(winMachine(), pkg);
  assert.equal(none.found, null);
  assert.ok(none.searched.length >= 6);
});

test("nodeWants: the engines.node of each installed package, whether this Node meets it, and nothing for a package that says nothing", () => {
  const sys = winMachine(withNpm({}, ["claude", "codex", "gemini", "copilot"]));
  const inv = findAgents(sys, {});
  const wants = nodeWants(inv, "20.1.0");
  assert.deepEqual(wants.map((w) => [w.agent, w.range, w.ok]), [["claude", ">=22.0.0", false], ["codex", ">=16", true], ["gemini", ">=20", true], ["copilot", null, null]]);
  assert.equal(wants[0].package, "@anthropic-ai/claude-code");
  // the same package found twice is one line
  const a = npmInstall("gemini", { prefix: "D:\\n1" });
  const b = npmInstall("gemini", { prefix: "D:\\n2" });
  const twice = findAgents(winMachine({ files: [...a.files, ...b.files], texts: { ...a.texts, ...b.texts }, env: { Path: "D:\\n1;D:\\n2;C:\\Windows\\System32" } }), {});
  assert.equal(nodeWants(twice, "24.19.0").filter((w) => w.agent === "gemini").length, 1);
});
