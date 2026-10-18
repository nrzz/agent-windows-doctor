// Codex CLI on Windows: CODEX_HOME, the configuration layers and the trust of a project, the sandbox that Codex selects and the mode it ends in, the sandbox
// log, and the TOML reader that reads it all. (test/e2e-codex.test.mjs puts the same claims to the real binary.)
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { HOME, PROJECT, winMachine } from "./win-machine.mjs";
import { codexHome, codexOnWindows, codexSystemDir, mergeTables, readCodexLayers, readSandboxLog, readTomlFile } from "../src/codexwin.mjs";
import { collectMachine } from "../src/machine.mjs";
import { parseToml } from "../src/toml.mjs";

const CONFIG = `${HOME}\\.codex\\config.toml`;
const on = (texts, o = {}) => winMachine({ texts, ...o });
const state = (sys, project = PROJECT) => {
  const layers = readCodexLayers(sys, { project });
  return codexOnWindows(sys, { layers, machine: collectMachine(sys, { cwd: project, probe: false }), userEnv: null });
};

test("CODEX_HOME when it is set and not empty, else ~\\.codex; the system folder is under ProgramData", () => {
  assert.deepEqual(codexHome(winMachine()), { dir: `${HOME}\\.codex`, source: "default", given: null });
  assert.deepEqual(codexHome(winMachine({ env: { CODEX_HOME: "D:\\ch" } })), { dir: "D:\\ch", source: "CODEX_HOME", given: "D:\\ch" });
  assert.equal(codexHome(winMachine({ env: { CODEX_HOME: "" } })).source, "default", "an empty value is the same as none");
  assert.equal(codexHome(winMachine({ env: { CODEX_HOME: "rel" } })).dir, "C:\\work\\shop\\rel", "a relative one is read from the working folder");
  assert.equal(codexSystemDir(winMachine()), "C:\\ProgramData\\OpenAI\\Codex");
  assert.equal(codexSystemDir(winMachine({ env: { ProgramData: "D:\\PD" } })), "D:\\PD\\OpenAI\\Codex");
});

test("tables merge key by key and values and arrays are replaced", () => {
  assert.deepEqual(mergeTables({ a: 1, t: { x: 1, y: 2 }, l: [1] }, { a: 2, t: { y: 3 }, l: [2, 3], n: 4 }), { a: 2, t: { x: 1, y: 3 }, l: [2, 3], n: 4 });
});

test("the layers: the system file, the user file, and the project's .codex only when the project is trusted (by its own path or by its Git root)", () => {
  const trust = (p) => `[projects.'${p}']\ntrust_level = "trusted"\n`;
  const sys = on({
    "C:\\ProgramData\\OpenAI\\Codex\\config.toml": 'model = "system-model"\n[windows]\nsandbox = "unelevated"\n',
    [CONFIG]: `model = "user-model"\n${trust("C:\\work\\shop")}`,
    [`${PROJECT}\\.codex\\config.toml`]: 'model = "project-model"\n',
  }, { dirs: [`${PROJECT}\\.codex`, `${PROJECT}\\.git`] });
  const l = readCodexLayers(sys, { project: PROJECT });
  assert.deepEqual(l.layers.map((x) => [x.kind, x.ok, Boolean(x.trusted)]), [["system", true, false], ["user", true, false], ["project", true, true]]);
  assert.equal(l.merged.model, "project-model", "the closest layer wins");
  assert.equal(l.merged.windows.sandbox, "unelevated", "a table of a lower layer survives");
  assert.equal(l.trusted, true);
  // untrusted: the project's file is not opened (even a broken one)
  const untrusted = on({ [CONFIG]: 'model = "user-model"\n', [`${PROJECT}\\.codex\\config.toml`]: "model = ((((" }, { dirs: [`${PROJECT}\\.codex`] });
  const u = readCodexLayers(untrusted, { project: PROJECT });
  assert.equal(u.merged.model, "user-model");
  assert.deepEqual([u.layers.at(-1).skipped, u.layers.at(-1).ok, u.trusted], [true, false, false]);
  // trust by the Git root, project below it
  const sub = `${PROJECT}\\packages\\app`;
  const viaRoot = on({ [CONFIG]: trust(PROJECT), [`${PROJECT}\\.codex\\config.toml`]: 'a = 1\n', [`${sub}\\.codex\\config.toml`]: 'b = 2\n' }, { dirs: [PROJECT, sub, `${PROJECT}\\.git`, `${PROJECT}\\.codex`, `${sub}\\.codex`] });
  const r = readCodexLayers(viaRoot, { project: sub });
  assert.deepEqual([r.merged.a, r.merged.b, r.trusted], [1, 2, true], "both folders from the Git root down to the project are layers, trusted by the root");
  // case does not matter in a trusted path on Windows, and a \\?\ prefix is taken off
  const cased = on({ [CONFIG]: trust("\\\\?\\C:\\WORK\\SHOP") });
  assert.equal(readCodexLayers(cased, { project: PROJECT }).trusted, true);
  // a layer that does not parse is listed with the line
  const broken = on({ [CONFIG]: "a = 1\nb = ((\n" });
  const bl = readCodexLayers(broken, { project: PROJECT }).layers.find((x) => x.kind === "user");
  assert.equal(bl.ok, false);
  assert.match(bl.error.message, /./);
  assert.equal(bl.error.line, 2);
});

test("the sandbox: what each setting selects, the mode that results, and the log of an earlier run", () => {
  const run = (cfg, { texts, ...o } = {}) => state(on({ [CONFIG]: cfg, ...(texts || {}) }, o));
  const none = run('sandbox_mode = "workspace-write"\n');
  assert.deepEqual([none.sandbox.selection, none.sandbox.selectionHow, none.sandbox.mode.effective, none.sandbox.mode.downgraded], ["none", "nothing is set", "read-only", true]);
  assert.deepEqual([run('[windows]\nsandbox = "elevated"\n').sandbox.selection, run('[windows]\nsandbox = "unelevated"\n').sandbox.selection, run('[windows]\nsandbox = "mxc"\n').sandbox.selection], ["elevated", "unelevated", "mxc"]);
  const prefer = run("[features]\nprefer_mxc = true\n");
  assert.deepEqual([prefer.sandbox.selection, prefer.sandbox.selectionHow, prefer.sandbox.mxcAvailable], ["mxc", "features.prefer_mxc", true], "build 26300 has MXC");
  const old = run("[features]\nprefer_mxc = true\n", { build: 22631 });
  assert.deepEqual([old.sandbox.selection, old.sandbox.preferUnavailable, old.sandbox.selectionHow], ["none", true, "features.prefer_mxc, with no MXC to pick"]);
  assert.equal(run('[windows]\nsandbox = "unelevated"\n[features]\nprefer_mxc = true\n').sandbox.selection, "unelevated", "windows.sandbox wins over prefer_mxc");
  // the mode: asked, or the default of the trust state
  assert.equal(run("").sandbox.mode.wanted, "read-only");
  assert.equal(run(`[projects.'${PROJECT}']\ntrust_level = "trusted"\n`).sandbox.mode.wanted, "workspace-write");
  assert.deepEqual([run('sandbox_mode = "danger-full-access"\n').sandbox.mode.effective, run('sandbox_mode = "danger-full-access"\n').sandbox.mode.downgraded], ["danger-full-access", false]);
  // the log: the last lines of the newest file win over what the build says
  const log = `${HOME}\\.codex\\.sandbox\\sandbox.2026-10-18.log`;
  const text = "[2026-10-18 09:00:00.100 +05:30 INFO] MXC availability: true\n[2026-10-18 09:00:00.200 +05:30 INFO] Windows sandbox selection: disabled\n[2026-10-18 10:00:00.100 +05:30 INFO] MXC availability: false\n[2026-10-18 10:00:00.200 +05:30 INFO] Windows sandbox selection: unelevated\n";
  const logged = run("[features]\nprefer_mxc = true\n", { texts: { [log]: text } });
  assert.equal(logged.sandbox.log.mxcAvailable, false);
  assert.equal(logged.sandbox.log.lastSelection, "unelevated");
  assert.equal(logged.sandbox.preferUnavailable, true, "the log says there was none, whatever the build");
});

test("readSandboxLog: the newest file, the last of each line, nothing when there is no folder", () => {
  const dir = `${HOME}\\.codex\\.sandbox`;
  const sys = on({ [`${dir}\\sandbox.2026-10-17.log`]: "[a b] MXC availability: true\n", [`${dir}\\sandbox.2026-10-18.log`]: "[2026-10-18 09:00:00.100 +05:30 INFO] MXC availability: false\r\n[2026-10-18 09:00:00.200 +05:30 INFO] Windows sandbox selection: mxc\r\n", [`${dir}\\notes.txt`]: "x" });
  const r = readSandboxLog(sys, `${HOME}\\.codex`);
  assert.deepEqual([r.mxcAvailable, r.lastSelection, r.path], [false, "mxc", `${dir}\\sandbox.2026-10-18.log`]);
  assert.equal(readSandboxLog(winMachine(), `${HOME}\\.codex`), null);
  assert.deepEqual(readSandboxLog(on({ [`${dir}\\sandbox.2026-10-18.log`]: "nothing useful\n" }), `${HOME}\\.codex`).mxcAvailable, null);
});

test("windows.shell_path is found in the layer that sets it, and nothing else is a shell key", () => {
  const r = state(on({ [CONFIG]: '[windows]\nshell_path = "C:/Git/bin/bash.exe"\nsandbox = "unelevated"\n' }));
  assert.deepEqual(r.shellKeys.map((k) => [k.key, k.value, k.layer]), [["windows.shell_path", "C:/Git/bin/bash.exe", "user config.toml"]]);
  assert.deepEqual(state(on({ [CONFIG]: '[windows]\nsandbox = "unelevated"\n' })).shellKeys, []);
});

test("readTomlFile and the TOML reader: tables, arrays of tables, strings with Windows paths, and an error with its line", () => {
  const ok = parseToml('model = "gpt-5.5"\npath = \'C:\\Users\\me\'\nesc = "C:\\\\Users\\\\me"\n[a.b]\nc = [1, 2]\n[[hooks.PreToolUse]]\nmatcher = "*"\n[[hooks.PreToolUse.hooks]]\ncommand = "node x"\n');
  assert.equal(ok.ok, true);
  assert.deepEqual([ok.value.path, ok.value.esc, ok.value.a.b.c, ok.value.hooks.PreToolUse[0].hooks[0].command], ["C:\\Users\\me", "C:\\Users\\me", [1, 2], "node x"]);
  const bad = parseToml("a = 1\nb = ((\n");
  assert.equal(bad.ok, false);
  assert.equal(bad.error.line, 2);
  const sys = on({ [CONFIG]: "x = 1\n" });
  assert.deepEqual(readTomlFile(sys, CONFIG).value, { x: 1 });
  assert.deepEqual(readTomlFile(sys, "C:\\nope.toml"), { path: "C:\\nope.toml", exists: false, ok: false, value: null, error: null });
  assert.equal(parseToml("﻿a = 1\r\nb = 2\r\n").ok, true, "a byte order mark and CRLF are accepted, as Codex does");
});

test("CODEX_HOME in the user environment and in the process, with a WSL to read it", () => {
  const withUser = state(winMachine({ registry: { "HKCU\\Environment": { CODEX_HOME: ["REG_SZ", "D:\\u"] } } }));
  assert.equal(withUser.wsl.userHome, null, "no user environment layer was given to this call");
  const sys = winMachine({ env: { CODEX_HOME: "D:\\p" }, registry: { "HKCU\\Environment": { CODEX_HOME: ["REG_SZ", "D:\\u"] } } });
  const layers = readCodexLayers(sys, { project: PROJECT });
  const both = codexOnWindows(sys, { layers, machine: collectMachine(sys, { cwd: PROJECT, probe: false }), userEnv: { read: (n) => ({ ok: true, exists: n === "CODEX_HOME", value: "D:\\u" }) } });
  assert.deepEqual([both.wsl.processHome, both.wsl.userHome, both.wsl.workable], ["D:\\p", "D:\\u", 1]);
});
