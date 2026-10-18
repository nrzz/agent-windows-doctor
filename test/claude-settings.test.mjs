// The settings loader: which files it reads, in which order, what it takes from them, and what it does with a file that Claude Code ignores.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { fakeMachine } from "./machine.mjs";
import { claudeJsonOf, configDirOf, loadSettingsFiles, managedDirOf, shellFacts, shortPath, wholeToolDeny } from "../src/claude-settings.mjs";

const HOME = "C:\\Users\\me";
const PROJ = "C:\\work\\proj";
const mk = (texts = {}, extra = {}) => fakeMachine({ env: {}, home: HOME, cwd: PROJ, texts, ...extra });

test("the files, highest precedence first: managed, local, project, user", () => {
  const sys = mk({
    [`${HOME}\\.claude\\settings.json`]: "{}",
    [`${PROJ}\\.claude\\settings.json`]: "{}",
    [`${PROJ}\\.claude\\settings.local.json`]: "{}",
    "C:\\Program Files\\ClaudeCode\\managed-settings.json": JSON.stringify({ env: { A: "1" } }),
  });
  const s = loadSettingsFiles(sys, { project: PROJ });
  const scopes = s.files.filter((f) => f.exists).map((f) => f.scope);
  assert.deepEqual(scopes, ["managed", "local", "project", "user"]);
  assert.equal(s.configDir, `${HOME}\\.claude`);
  assert.equal(s.configSource, "default");
  assert.equal(s.managedApplied, "managed-settings.json");
  assert.equal(s.files.find((f) => f.scope === "user").display, "~\\.claude\\settings.json");
  assert.equal(s.files.find((f) => f.scope === "project").display, ".claude\\settings.json");
});

test("CLAUDE_CONFIG_DIR moves the user file, a relative value is taken from the working folder, and .claude.json is inside the folder only then", () => {
  const sys = mk({ "D:\\cfg\\settings.json": JSON.stringify({ defaultShell: "bash" }) }, { env: { CLAUDE_CONFIG_DIR: "D:\\cfg" } });
  const s = loadSettingsFiles(sys, { project: PROJ });
  assert.equal(s.configDir, "D:\\cfg");
  assert.equal(s.configSource, "CLAUDE_CONFIG_DIR");
  assert.equal(shellFacts(s).defaultShell[0].value, "bash");
  assert.equal(claudeJsonOf(sys), "D:\\cfg\\.claude.json");
  assert.equal(configDirOf(mk({}, { env: { CLAUDE_CONFIG_DIR: "rel\\cfg" } })).dir, `${PROJ}\\rel\\cfg`);
  assert.equal(claudeJsonOf(mk()), `${HOME}\\.claude.json`);
  assert.equal(configDirOf(mk({}, { env: { CLAUDE_CONFIG_DIR: "   " } })).source, "default");
});

test("env blocks, defaultShell and deny rules are taken by scope; a number or a boolean in env reaches Claude Code as text", () => {
  const sys = mk({
    [`${HOME}\\.claude\\settings.json`]: JSON.stringify({ env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: 1, OTHER: true, EMPTY: null }, defaultShell: "powershell", permissions: { deny: ["Bash(git push *)", "PowerShell", 7] } }),
    [`${PROJ}\\.claude\\settings.json`]: JSON.stringify({ env: { CLAUDE_CODE_GIT_BASH_PATH: "C:\\x\\bash.exe" }, permissions: { deny: ["Bash"] } }),
  });
  const f = shellFacts(loadSettingsFiles(sys, { project: PROJ }));
  assert.deepEqual(f.env.user, { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1", OTHER: "true", EMPTY: "" });
  assert.deepEqual(f.env.project, { CLAUDE_CODE_GIT_BASH_PATH: "C:\\x\\bash.exe" });
  assert.equal(f.envFiles.user, "~\\.claude\\settings.json");
  assert.deepEqual(f.defaultShell, [{ scope: "user", display: "~\\.claude\\settings.json", value: "powershell", valid: true }]);
  assert.deepEqual(f.deny.map((d) => [d.scope, d.rule]), [["project", "Bash"], ["user", "Bash(git push *)"], ["user", "PowerShell"]], "a rule that is not text is left out");
});

test("a settings file that is not strict JSON is ignored whole, and is listed as such", () => {
  const sys = mk({ [`${HOME}\\.claude\\settings.json`]: '{ // a comment\n "env": { "CLAUDE_CODE_USE_POWERSHELL_TOOL": "0" } }', [`${PROJ}\\.claude\\settings.local.json`]: '{"env": {"A": "1"},}' });
  const f = shellFacts(loadSettingsFiles(sys, { project: PROJ }));
  assert.deepEqual(f.env.user, {});
  assert.deepEqual(f.env.local, {});
  assert.deepEqual(f.ignored.map((i) => i.scope).sort(), ["local", "user"]);
  assert.match(f.ignored.find((i) => i.scope === "user").message, /JSON/);
});

test("a file with a byte-order mark is read, an empty file is nothing, and a file that holds a list is not settings", () => {
  const sys = mk({ [`${HOME}\\.claude\\settings.json`]: `﻿${JSON.stringify({ defaultShell: "bash" })}`, [`${PROJ}\\.claude\\settings.json`]: "  \n", [`${PROJ}\\.claude\\settings.local.json`]: "[1]" });
  const s = loadSettingsFiles(sys, { project: PROJ });
  assert.equal(s.files.find((f) => f.scope === "user").usable, true);
  assert.equal(s.files.find((f) => f.scope === "project").empty, true);
  assert.equal(s.files.find((f) => f.scope === "local").usable, false);
  assert.match(s.files.find((f) => f.scope === "local").error.message, /does not hold a JSON object/);
});

test("managed settings: the HKLM registry value first, then the folder, then HKCU; the first with a policy key applies, and a document with only the control keys is no policy", () => {
  const reg = (hive, doc) => ({ [`${hive}\\SOFTWARE\\Policies\\ClaudeCode`]: { Settings: ["REG_SZ", JSON.stringify(doc)] } });
  const folder = { "C:\\Program Files\\ClaudeCode\\managed-settings.json": JSON.stringify({ env: { FROM: "folder" } }) };
  let s = loadSettingsFiles(mk(folder, { registry: { ...reg("HKLM", { env: { FROM: "hklm" } }), ...reg("HKCU", { env: { FROM: "hkcu" } }) } }), { project: PROJ });
  assert.equal(s.managedApplied, "HKLM registry");
  assert.deepEqual(shellFacts(s).env.managed, { FROM: "hklm" });
  s = loadSettingsFiles(mk(folder, { registry: reg("HKCU", { env: { FROM: "hkcu" } }) }), { project: PROJ });
  assert.equal(s.managedApplied, "managed-settings.json");
  assert.deepEqual(shellFacts(s).env.managed, { FROM: "folder" });
  s = loadSettingsFiles(mk({}, { registry: reg("HKCU", { env: { FROM: "hkcu" } }) }), { project: PROJ });
  assert.equal(s.managedApplied, "HKCU registry");
  s = loadSettingsFiles(mk({}, { registry: reg("HKLM", { wslInheritsWindowsSettings: true }) }), { project: PROJ });
  assert.equal(s.managedApplied, null, "a document with only wslInheritsWindowsSettings is no policy");
  assert.deepEqual(shellFacts(s).wslInherits.map((w) => [w.source, w.value]), [["HKLM registry", true]]);
  s = loadSettingsFiles(mk(folder, { registry: reg("HKLM", { env: { FROM: "hklm" } }) }), { project: PROJ, registry: false });
  assert.equal(s.managedApplied, "managed-settings.json", "registry: false leaves the registry out");
});

test("wslInheritsWindowsSettings counts from the Windows folder and HKLM, not from HKCU; drop-in files of managed-settings.d are read in order", () => {
  const sys = mk({
    "C:\\Program Files\\ClaudeCode\\managed-settings.json": JSON.stringify({ wslInheritsWindowsSettings: true }),
    "C:\\Program Files\\ClaudeCode\\managed-settings.d\\20-b.json": JSON.stringify({ env: { B: "2" } }),
    "C:\\Program Files\\ClaudeCode\\managed-settings.d\\10-a.json": JSON.stringify({ env: { A: "1" } }),
    "C:\\Program Files\\ClaudeCode\\managed-settings.d\\.hidden.json": JSON.stringify({ env: { H: "1" } }),
  }, { registry: { "HKCU\\SOFTWARE\\Policies\\ClaudeCode": { Settings: ["REG_SZ", JSON.stringify({ wslInheritsWindowsSettings: true })] } } });
  const s = loadSettingsFiles(sys, { project: PROJ });
  const names = s.files.filter((f) => f.scope === "managed" && f.exists && f.via === "file").map((f) => f.label);
  assert.deepEqual(names, ["managed settings (20-b.json)", "managed settings (10-a.json)", "managed settings"], "highest first: a drop-in later in the alphabet wins");
  const f = shellFacts(s);
  assert.deepEqual(f.wslInherits.map((w) => w.source), ["managed-settings.json"], "HKCU does not turn the chain on");
  assert.deepEqual(f.env.managed, { A: "1", B: "2" });
  // the same key in two drop-ins: the one that comes last wins
  const two = loadSettingsFiles(mk({ "C:\\Program Files\\ClaudeCode\\managed-settings.d\\10-a.json": JSON.stringify({ env: { K: "a" } }), "C:\\Program Files\\ClaudeCode\\managed-settings.d\\20-b.json": JSON.stringify({ env: { K: "b" } }) }), { project: PROJ });
  assert.equal(shellFacts(two).env.managed.K, "b");
});

test("AGENT_WINDOWS_DOCTOR_MANAGED_DIR replaces the managed folder; the system folders are those of each system", () => {
  const sys = mk({ "D:\\m\\managed-settings.json": JSON.stringify({ env: { X: "1" } }), "C:\\Program Files\\ClaudeCode\\managed-settings.json": JSON.stringify({ env: { X: "2" } }) }, { env: { AGENT_WINDOWS_DOCTOR_MANAGED_DIR: "D:\\m" } });
  assert.deepEqual(shellFacts(loadSettingsFiles(sys, { project: PROJ })).env.managed, { X: "1" });
  assert.equal(managedDirOf("win32"), "C:\\Program Files\\ClaudeCode");
  assert.equal(managedDirOf("darwin"), "/Library/Application Support/ClaudeCode");
  assert.equal(managedDirOf("linux"), "/etc/claude-code");
});

test("wholeToolDeny: only Bash, Bash(*), PowerShell and PowerShell(*), in exactly that spelling", () => {
  assert.equal(wholeToolDeny("Bash"), "Bash");
  assert.equal(wholeToolDeny("Bash(*)"), "Bash");
  assert.equal(wholeToolDeny("PowerShell"), "PowerShell");
  assert.equal(wholeToolDeny("PowerShell(*)"), "PowerShell");
  for (const r of ["bash", "Bash()", "Bash(git *)", "PowerShell(git *)", "Read", "BashOutput", " Bash", "Bash ", "Bash(*) "]) assert.equal(wholeToolDeny(r), null, r);
});

test("shortPath: inside the project, under the home folder, or the whole path; on Linux with slashes", () => {
  assert.equal(shortPath("C:\\work\\proj\\.claude\\settings.json", { home: HOME, project: PROJ }), ".claude\\settings.json");
  assert.equal(shortPath("c:\\USERS\\me\\.claude\\settings.json", { home: HOME, project: PROJ }), "~\\.claude\\settings.json", "Windows names match in any case");
  assert.equal(shortPath("C:\\Program Files\\ClaudeCode\\managed-settings.json", { home: HOME, project: PROJ }), "C:\\Program Files\\ClaudeCode\\managed-settings.json");
  assert.equal(shortPath("/home/me/.claude/settings.json", { home: "/home/me", project: "/work/p", platform: "linux" }), "~/.claude/settings.json");
});
