// Where is a Git Bash on this machine: the git.exe files on PATH, the registry's InstallPath, and the usual folders.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { fakeMachine, gitFiles, SYSTEM_FILES, SYSTEM_PATH } from "./machine.mjs";
import { discoverGitBash } from "../src/gitbash.mjs";

test("every source, in order, each file once, and only files that exist", () => {
  const sys = fakeMachine({
    env: { Path: `E:\\Das\\Git\\mingw64\\bin;E:\\Das\\Git\\cmd;${SYSTEM_PATH}`, LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local", ProgramW6432: "C:\\Program Files" },
    files: [...SYSTEM_FILES, ...gitFiles("E:\\Das\\Git"), "C:\\Users\\me\\AppData\\Local\\Programs\\Git\\bin\\bash.exe", "C:\\Users\\me\\scoop\\apps\\git\\current\\bin\\bash.exe", "C:\\Git\\bin\\bash.exe"],
    registry: { "HKLM\\SOFTWARE\\GitForWindows": { InstallPath: ["REG_SZ", "E:\\Das\\Git"] }, "HKCU\\SOFTWARE\\GitForWindows": { InstallPath: ["REG_SZ", "C:\\Users\\me\\AppData\\Local\\Programs\\Git"] } },
  });
  const found = discoverGitBash(sys, { cwd: "C:\\work\\proj" });
  assert.deepEqual(found.map((f) => f.path), ["E:\\Das\\Git\\bin\\bash.exe", "C:\\Users\\me\\AppData\\Local\\Programs\\Git\\bin\\bash.exe", "C:\\Users\\me\\scoop\\apps\\git\\current\\bin\\bash.exe", "C:\\Git\\bin\\bash.exe"]);
  assert.match(found[0].via, /^git\.exe on PATH \(E:\\Das\\Git\\mingw64\\bin\\git\.exe\)$/);
  assert.match(found[1].via, /^the registry \(HKCU: C:\\Users\\me\\AppData\\Local\\Programs\\Git\)$/);
  assert.match(found[2].via, /^the folder C:\\Users\\me\\scoop\\apps\\git\\current$/);
});

test("a Git that is only in the registry, or only in a usual folder, is found; with none there is none", () => {
  const reg = fakeMachine({ env: { Path: SYSTEM_PATH }, files: [...SYSTEM_FILES, "D:\\Tools\\Git\\bin\\bash.exe"], registry: { "HKLM\\SOFTWARE\\WOW6432Node\\GitForWindows": { InstallPath: ["REG_SZ", "D:\\Tools\\Git"] } } });
  assert.match(discoverGitBash(reg, {})[0].via, /^the registry \(HKLM \(32-bit\)/);
  const folder = fakeMachine({ env: { Path: SYSTEM_PATH, ProgramW6432: "C:\\Program Files" }, files: [...SYSTEM_FILES, "C:\\Program Files\\Git\\bin\\bash.exe"] });
  assert.equal(discoverGitBash(folder, {})[0].path, "C:\\Program Files\\Git\\bin\\bash.exe");
  assert.deepEqual(discoverGitBash(fakeMachine({ env: { Path: SYSTEM_PATH }, files: SYSTEM_FILES }), {}), []);
  const stale = fakeMachine({ env: { Path: SYSTEM_PATH }, files: SYSTEM_FILES, registry: { "HKLM\\SOFTWARE\\GitForWindows": { InstallPath: ["REG_SZ", "Z:\\gone"] } } });
  assert.deepEqual(discoverGitBash(stale, {}), [], "an InstallPath whose bash.exe is gone gives nothing");
});
