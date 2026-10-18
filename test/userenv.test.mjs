// The user environment against this process: what is the same, what only one side has, what differs, and what is never printed.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { fakeMachine } from "./machine.mjs";
import { CONFIG_NAMES, compareUserEnv, expandPercent, showsValue } from "../src/userenv.mjs";
import { REAL_KEY } from "../src/winenv.mjs";
import { regUserEnv } from "../src/winenv.mjs";

const layer = (values) => regUserEnv(fakeMachine({ registry: { [REAL_KEY]: values } }));

test("every status: same, differs, user-only and process-only, by name in any case, in the order of the names", () => {
  const sys = fakeMachine({ env: { CLAUDE_CONFIG_DIR: "D:\\cfg", Claude_Code_Git_Bash_Path: "C:\\a\\bash.exe", ANTHROPIC_MODEL: "sonnet", PATH: "x" } });
  const r = compareUserEnv(sys, layer({ CLAUDE_CONFIG_DIR: ["REG_SZ", "D:\\cfg"], CLAUDE_CODE_GIT_BASH_PATH: ["REG_SZ", "C:\\b\\bash.exe"], CLAUDE_CODE_USE_POWERSHELL_TOOL: ["REG_SZ", "1"], TEMP: ["REG_SZ", "C:\\t"] }));
  assert.equal(r.ok, true);
  assert.equal(r.layer, "registry");
  assert.deepEqual(r.entries.map((e) => [e.name, e.status]), [["ANTHROPIC_MODEL", "process-only"], ["CLAUDE_CODE_GIT_BASH_PATH", "differs"], ["CLAUDE_CODE_USE_POWERSHELL_TOOL", "user-only"], ["CLAUDE_CONFIG_DIR", "same"]]);
  const git = r.entries.find((e) => e.name === "CLAUDE_CODE_GIT_BASH_PATH");
  assert.deepEqual(git.user, { value: "C:\\b\\bash.exe", type: "REG_SZ" });
  assert.deepEqual(git.process, { value: "C:\\a\\bash.exe" });
});

test("a value is printed for a path and for a switch, and for nothing else: a token is set, never its value", () => {
  const sys = fakeMachine({ env: { ANTHROPIC_API_KEY: "sk-ant-process-secret", ANTHROPIC_BASE_URL: "https://gw.example/v1", CLAUDE_CODE_USE_BEDROCK: "1", CLAUDE_CODE_OAUTH_TOKEN: "oauth-secret" } });
  const r = compareUserEnv(sys, layer({ ANTHROPIC_API_KEY: ["REG_SZ", "sk-ant-user-secret"], ANTHROPIC_BASE_URL: ["REG_SZ", "https://gw.example/v1"], CLAUDE_CODE_TMPDIR: ["REG_SZ", "D:\\tmp"], CLAUDE_CODE_USE_BEDROCK: ["REG_SZ", "true"] }));
  const json = JSON.stringify(r);
  for (const secret of ["sk-ant-process-secret", "sk-ant-user-secret", "oauth-secret", "gw.example"]) assert.ok(!json.includes(secret), `${secret} is not in the result`);
  const key = r.entries.find((e) => e.name === "ANTHROPIC_API_KEY");
  assert.deepEqual([key.status, key.user, key.process], ["differs", { set: true, type: "REG_SZ" }, { set: true }]);
  assert.equal(r.entries.find((e) => e.name === "ANTHROPIC_BASE_URL").status, "same", "equal values are told as equal, and not shown");
  assert.deepEqual(r.entries.find((e) => e.name === "CLAUDE_CODE_TMPDIR").user, { value: "D:\\tmp", type: "REG_SZ" }, "a path is shown");
  assert.deepEqual(r.entries.find((e) => e.name === "CLAUDE_CODE_USE_BEDROCK").process, { value: "1" }, "a switch is shown");
  assert.equal(showsValue("ANTHROPIC_API_KEY", "sk-ant-x"), false);
  assert.equal(showsValue("ANTHROPIC_API_KEY", "1"), true, "a value of 1 is a switch whatever it is for");
  assert.equal(showsValue("CLAUDE_ENV_FILE", "C:\\x.sh"), true);
});

test("a REG_EXPAND_SZ value is compared as the process has it, with %NAME% expanded", () => {
  const sys = fakeMachine({ env: { USERPROFILE: "C:\\Users\\me", CLAUDE_CONFIG_DIR: "C:\\Users\\me\\cfg" } });
  const r = compareUserEnv(sys, layer({ CLAUDE_CONFIG_DIR: ["REG_EXPAND_SZ", "%USERPROFILE%\\cfg"] }));
  assert.equal(r.entries[0].status, "same");
  assert.equal(expandPercent("%userprofile%\\x", { USERPROFILE: "C:\\U" }), "C:\\U\\x", "a name matches in any case");
  assert.equal(expandPercent("%NOPE%\\x", {}), "%NOPE%\\x", "a name that is not there stays as it is");
});

test("the variables that Claude Code sets for its own programs are left out, and counted", () => {
  const sys = fakeMachine({ env: { CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_PROJECT_DIR: "C:\\p", CLAUDE_PLUGIN_ROOT: "C:\\plug", CLAUDE_ENV_FILE: "C:\\e.sh", CLAUDE_CONFIG_DIR: "D:\\cfg" } });
  const r = compareUserEnv(sys, layer({}));
  assert.deepEqual(r.entries.map((e) => e.name), ["CLAUDE_CONFIG_DIR"]);
  assert.equal(r.own, 5);
  assert.deepEqual(CONFIG_NAMES, ["CLAUDE_CONFIG_DIR", "CLAUDE_CODE_GIT_BASH_PATH", "CLAUDE_CODE_USE_POWERSHELL_TOOL"]);
});

test("a user environment that cannot be read is said", () => {
  const sys = fakeMachine({});
  sys.run = () => ({ status: null, stdout: "", stderr: "", error: Object.assign(new Error("x"), { code: "ENOENT" }), timedOut: false });
  const r = compareUserEnv(sys, regUserEnv(sys));
  assert.equal(r.ok, false);
  assert.match(r.error, /reg\.exe could not run/);
  assert.deepEqual(r.entries, []);
});
