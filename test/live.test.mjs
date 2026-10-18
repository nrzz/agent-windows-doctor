// check --live, on every system, against stand-ins for the binaries (test/fake-agent.mjs): the guard that runs before a binary starts, the environment a run gets, the fake APIs, what each
// run reads (the tools of Claude Code's first request, the command line of the PowerShell that Codex CLI, Gemini CLI and Copilot CLI started), and the comparison with the prediction.
// test/e2e-live.test.mjs does the same with the real binaries.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEAD_PROXY, HOME_VARS, IS_WIN, NO_PROXY, tmpDir } from "./helpers.mjs";
import { makeSys } from "../src/sys.mjs";
import { DEAD_PROXY as PRODUCT_DEAD, HOME_VARS as PRODUCT_HOME_VARS, NO_PROXY as PRODUCT_NO_PROXY, PROBE_COMMAND, askVersion, assertSandboxed, liveAll, liveEnv, liveSettings, pickBinary, programOf, proveClaude, proveShellOf, runClaude, runCodex, runCopilot, runGemini, startFakeClaude, startFakeCodex, startFakeCopilot, startFakeGemini } from "../src/live.mjs";
import { makeLiveWorld, makeTempDir, removeTempDir } from "../src/write.mjs";
import { collectMachine } from "../src/machine.mjs";
import { winMachine } from "./win-machine.mjs";

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-agent.mjs");
const POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

/** A shim named like the agent that runs the stand-in with a config; returns its path. */
function shim(dir, agent, config) {
  const cfg = path.join(dir, `${agent}.config.json`);
  fs.writeFileSync(cfg, JSON.stringify(config));
  if (IS_WIN) {
    const file = path.join(dir, `${agent}.cmd`);
    fs.writeFileSync(file, `@echo off\r\n"${process.execPath}" "${FAKE}" ${agent} "${cfg}" %*\r\n`);
    return file;
  }
  const file = path.join(dir, agent);
  fs.writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" ${agent} "${cfg}" "$@"\n`);
  fs.chmodSync(file, 0o755);
  return file;
}
const newWorld = () => { const base = tmpDir("adw-livetest-"); return { base, world: makeLiveWorld(base), bin: fs.mkdirSync(path.join(base, "shims"), { recursive: true }) && path.join(base, "shims") }; };
const hostSys = (world, extra = {}) => makeSys({ env: { ...process.env, ...extra }, cwd: world.work, home: world.home });

test("the guard: the same names and the same closed port in the product and in the harness of the tests", () => {
  assert.deepEqual(PRODUCT_HOME_VARS, HOME_VARS);
  assert.equal(PRODUCT_DEAD, DEAD_PROXY);
  assert.equal(PRODUCT_NO_PROXY, NO_PROXY);
  assert.deepEqual(HOME_VARS, ["HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "CODEX_HOME", "COPILOT_HOME", "CLAUDE_CONFIG_DIR", "GEMINI_CLI_HOME"]);
  assert.equal(DEAD_PROXY, "http://127.0.0.1:9");
});

test("assertSandboxed: passes for a world's environment, and stops a run for each variable that is missing, empty, relative, outside the world, or a proxy that is not the closed port", () => {
  const { base, world } = newWorld();
  const env = liveEnv(hostSys(world), world);
  assert.equal(assertSandboxed(env, base), env);
  const outside = path.join(tmpDir("adw-outside-"), "x");
  const win = (v) => v.toLowerCase();
  for (const name of HOME_VARS) {
    assert.throws(() => assertSandboxed({ ...env, [name]: outside }, base), new RegExp(`guard: ${name}=.* is not inside the sandbox`), `${name} outside`);
    assert.throws(() => assertSandboxed({ ...env, [name]: "" }, base), new RegExp(`guard: ${name} is not set`), `${name} empty`);
    assert.throws(() => assertSandboxed({ ...env, [name]: "relative/folder" }, base), new RegExp(`guard: ${name}=relative`), `${name} relative`);
    const without = { ...env };
    for (const k of Object.keys(without)) if (win(k) === win(name)) delete without[k];
    assert.throws(() => assertSandboxed(without, base), new RegExp(`guard: ${name} is not set`), `${name} missing`);
  }
  for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"]) {
    assert.throws(() => assertSandboxed({ ...env, [name]: "http://127.0.0.1:3128" }, base), new RegExp(`guard: ${name} is not the closed port`));
    const without = { ...env };
    for (const k of Object.keys(without)) if (win(k) === win(name)) delete without[k];
    assert.throws(() => assertSandboxed(without, base), new RegExp(`guard: ${name} is not the closed port`), `${name} missing`);
  }
  assert.throws(() => assertSandboxed({ ...env, NO_PROXY: "example.com" }, base), /guard: NO_PROXY is not 127\.0\.0\.1,localhost/);
  // a wrong value in one spelling is not hidden by a right value in another
  assert.throws(() => assertSandboxed({ ...env, no_proxy: "example.com", NO_PROXY: NO_PROXY }, base), /guard: NO_PROXY is not/);
  assert.throws(() => assertSandboxed({ ...env, Http_Proxy: "http://127.0.0.1:3128" }, base), /guard: HTTP_PROXY is not the closed port/);
  assert.throws(() => assertSandboxed({ ...env, Home: outside }, base), /guard: Home=.* is not inside the sandbox/);
  assert.throws(() => assertSandboxed(env, ""), /no sandbox root/);
  // a sibling folder whose name begins with the base's name is not inside it
  assert.throws(() => assertSandboxed({ ...env, HOME: `${base}-sibling` }, base), /is not inside the sandbox/);
});

test("liveEnv: the machine's environment without any variable of an agent, every folder in the world, the closed port for every proxy, and extra entries that win", () => {
  const { base, world } = newWorld();
  const sys = hostSys(world, { CLAUDE_FOO: "1", ANTHROPIC_API_KEY: "sk-real", CLAUDECODE: "1", OPENAI_API_KEY: "sk-openai", CODEX_THING: "x", COPILOT_GITHUB_TOKEN: "ghp", GEMINI_API_KEY: "g", GOOGLE_GEMINI_BASE_URL: "http://x", CURSOR_API_KEY: "c", __PSLockdownPolicy: "4", GITHUB_SHA: "abc", SURFACE: "s", FAKE_API_KEY: "f", MY_OWN: "kept", HTTPS_PROXY: "http://corp:8080" });
  const env = liveEnv(sys, world, { FAKE_API_KEY: "fake", ANTHROPIC_BASE_URL: "http://127.0.0.1:1" });
  for (const gone of ["CLAUDE_FOO", "ANTHROPIC_API_KEY", "CLAUDECODE", "OPENAI_API_KEY", "CODEX_THING", "COPILOT_GITHUB_TOKEN", "GEMINI_API_KEY", "GOOGLE_GEMINI_BASE_URL", "CURSOR_API_KEY", "__PSLockdownPolicy", "GITHUB_SHA", "SURFACE"]) assert.equal(env[gone], undefined, gone);
  assert.equal(env.MY_OWN, "kept");
  assert.equal(env.FAKE_API_KEY, "fake", "extra entries win");
  assert.equal(env.HTTPS_PROXY, DEAD_PROXY, "the proxy of the machine is replaced by the closed port");
  assert.equal(env.NO_PROXY, NO_PROXY);
  assert.equal(env.CODEX_HOME, world.codex);
  assert.equal(env.GEMINI_CLI_HOME, world.home);
  assert.equal(env.COPILOT_HOME, world.copilot);
  assert.equal(env.CLAUDE_CONFIG_DIR, world.claude);
  assert.ok([env.HOME, env.USERPROFILE, env.APPDATA, env.LOCALAPPDATA].every((p) => p.startsWith(base)));
  // the folders may not be moved out of the world, even by extra
  assert.throws(() => liveEnv(sys, world, { CODEX_HOME: path.join(tmpDir("adw-out-"), "c") }), /guard: CODEX_HOME=.* is not inside the sandbox/);
});

test("liveSettings: only the env of the two shell variables that Claude Code reads from that file, and the whole-tool deny rules; managed settings win and go in the user file", () => {
  const facts = {
    env: { managed: { CLAUDE_CODE_GIT_BASH_PATH: "C:/m/bash.exe" }, user: { CLAUDE_CODE_GIT_BASH_PATH: "C:/u/bash.exe", ANTHROPIC_API_KEY: "sk-x", CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, project: { CLAUDE_CODE_GIT_BASH_PATH: "C:/p/bash.exe", CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" }, local: {} },
    deny: [{ rule: "Bash", scope: "user" }, { rule: "Bash(git *)", scope: "user" }, { rule: "PowerShell(*)", scope: "managed" }],
  };
  assert.deepEqual(liveSettings(facts), {
    user: { env: { CLAUDE_CODE_GIT_BASH_PATH: "C:/m/bash.exe", CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, permissions: { deny: ["Bash", "PowerShell(*)"] } },
    project: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } },
  });
});

test("the fake APIs record every request and answer as the agent's protocol wants", async () => {
  const post = async (api, url, body) => { const r = await fetch(`http://127.0.0.1:${api.port}${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, text: await r.text() }; };
  const claude = await startFakeClaude();
  const c = await post(claude, "/v1/messages", { model: "m", stream: true, messages: [{ role: "user", content: "hi" }] });
  assert.match(c.text, /event: message_start[\s\S]*PROBE-DONE[\s\S]*event: message_stop/);
  assert.match((await post(claude, "/v1/messages", { stream: false, messages: [] })).text, /"stop_reason":"end_turn"/);
  assert.equal((await post(claude, "/other", {})).status, 404);
  assert.equal(claude.requests.length, 3);
  await claude.close();

  const codex = await startFakeCodex();
  const first = await post(codex, "/v1/responses", { input: [{ role: "user" }], tools: [{ name: "exec_command" }] });
  assert.match(first.text, /"type":"function_call"[^]*"name":"exec_command"[^]*Environment\]::CommandLine/);
  const second = await post(codex, "/v1/responses", { input: [{ type: "function_call_output", call_id: "c", output: "x" }] });
  assert.match(second.text, /PROBE-DONE/);
  assert.equal((await post(codex, "/v1/models", {})).status, 404);
  await codex.close();

  const gemini = await startFakeGemini();
  const router = await post(gemini, "/v1beta/models/m:generateContent", { generationConfig: { responseMimeType: "application/json", responseJsonSchema: { type: "object", properties: { a: { type: "string" }, n: { type: "integer" }, e: { enum: ["x", "y"] } } } } });
  assert.deepEqual(JSON.parse(JSON.parse(router.text).candidates[0].content.parts[0].text), { a: "x", n: 1, e: "x" }, "the router gets a document built from its schema");
  const turn = await post(gemini, "/v1beta/models/m:streamGenerateContent?alt=sse", { contents: [{ role: "user", parts: [{ text: "hi" }] }] });
  assert.match(turn.text, /"functionCall":\{"name":"run_shell_command","args":\{"command":"\[Environment\]::CommandLine"/);
  const done = await post(gemini, "/v1beta/models/m:streamGenerateContent?alt=sse", { contents: [{ role: "user", parts: [{ functionResponse: { name: "x", response: {} } }] }] });
  assert.match(done.text, /PROBE-DONE/);
  assert.match((await post(gemini, "/v1beta/models/m:countTokens", {})).text, /totalTokens/);
  await gemini.close();

  const copilot = await startFakeCopilot();
  const t1 = await post(copilot, "/v1/chat/completions", { model: "gpt-4.1", stream: true, messages: [{ role: "user", content: "hi" }], tools: [{ type: "function", function: { name: "view" } }, { type: "function", function: { name: "powershell" } }] });
  assert.match(t1.text, /"tool_calls"[^]*"name":"powershell"/);
  const t2 = await post(copilot, "/v1/chat/completions", { stream: false, messages: [{ role: "tool", content: "x" }], tools: [{ type: "function", function: { name: "powershell" } }] });
  assert.equal(JSON.parse(t2.text).choices[0].message.content, "PROBE-DONE");
  assert.match((await post(copilot, "/v1/models", {})).text, /gpt-4\.1/);
  await copilot.close();
  assert.equal(PROBE_COMMAND, "[Environment]::CommandLine");
});

test("programOf: the program of a command line, quoted with spaces or not", () => {
  assert.equal(programOf('"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command x'), "C:\\Program Files\\PowerShell\\7\\pwsh.exe");
  assert.equal(programOf("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -Command x"), "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.equal(programOf('"powershell.exe" -nop'), "powershell.exe");
  assert.equal(programOf(""), null);
  assert.equal(programOf(null), null);
});

test("runClaude: the tools of the first request, the debug log, the exit code, and nothing of the user's hooks; the stand-in saw only the world", async () => {
  const { world, bin, base } = newWorld();
  const dump = path.join(base, "dump.json");
  const claude = shim(bin, "claude", { tools: ["Bash", "PowerShell"], edition: "Windows PowerShell 5.1 (powershell.exe)", debug: ['Using bash path: "C:/Git/bin/bash.exe"', "noise"], dump });
  const sys = hostSys(world, { CLAUDE_CODE_GIT_BASH_PATH: "C:/Git/bin/bash.exe", ANTHROPIC_API_KEY: "sk-real", CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" });
  const facts = { env: { managed: {}, user: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, project: {}, local: {} }, deny: [{ rule: "Bash(git *)", scope: "user" }] };
  const r = await runClaude(sys, { binary: claude, world, facts });
  assert.deepEqual([r.ran, r.exitCode, r.shellTools, r.using, r.edition, r.requests, r.notFound], [true, 0, ["Bash", "PowerShell"], "C:/Git/bin/bash.exe", "Windows PowerShell 5.1 (powershell.exe)", 1, false]);
  assert.deepEqual(r.tools, ["Bash", "PowerShell", "Read"]);
  const seen = JSON.parse(fs.readFileSync(dump, "utf8"));
  for (const name of HOME_VARS) assert.ok(seen.values[name] && seen.values[name].startsWith(base), `${name} was ${seen.values[name]}`);
  for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"]) assert.equal(seen.values[name], DEAD_PROXY, name);
  assert.equal(seen.values.NO_PROXY, NO_PROXY);
  assert.equal(seen.values.ANTHROPIC_API_KEY, "sk-ant-probe", "the key of the machine is replaced by a dummy");
  assert.equal(seen.values.CLAUDE_CODE_GIT_BASH_PATH, "C:/Git/bin/bash.exe", "the two shell variables are copied as they are");
  assert.ok(!seen.names.some((n) => /^(OPENAI|CODEX|COPILOT|GEMINI)/i.test(n) && !HOME_VARS.includes(n)));
  assert.equal(seen.cwd.toLowerCase(), world.work.toLowerCase());
  // the world holds the settings that were copied, and the trust of the project
  const user = JSON.parse(fs.readFileSync(path.join(world.claude, "settings.json"), "utf8"));
  assert.deepEqual(user, { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" } });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(world.claude, ".claude.json"), "utf8")).hasCompletedOnboarding, true);
  // a run that stops at start
  const w2 = newWorld();
  const s = await runClaude(hostSys(w2.world), { binary: shim(w2.bin, "claude", { exit: 1, stderr: "Claude Code on Windows requires a shell tool." }), world: w2.world, facts });
  assert.deepEqual([s.ran, s.exitCode, s.requests, s.tools, s.stderr], [true, 1, 0, [], "Claude Code on Windows requires a shell tool."]);
  // a binary that is not one
  const missing = await runClaude(hostSys(w2.world), { binary: path.join(base, "nope", "claude.exe"), world: w2.world, facts });
  assert.equal(missing.ran, false);
  assert.match(missing.error, /could not be started/);
});

test("runCodex, runGemini and runCopilot: the command line that the PowerShell printed for itself, or the error the tool answered with", async () => {
  const w = newWorld();
  const sys = hostSys(w.world);
  const codex = await runCodex(sys, { binary: shim(w.bin, "codex", { shellLine: `"${POWERSHELL}" -Command '[Environment]::CommandLine'` }), world: w.world });
  assert.deepEqual([codex.ran, codex.exitCode, codex.program, codex.requests], [true, 0, POWERSHELL, 2]);
  assert.match(codex.line, /-Command/);
  assert.match(fs.readFileSync(path.join(w.world.codex, "config.toml"), "utf8"), /base_url = "http:\/\/127\.0\.0\.1:\d+\/v1"/, "Codex got a config that names the fake API");
  // Codex prints each backslash of the path twice in the command_execution item: the line is kept as it printed it, the program is the path
  const w1b = newWorld();
  const doubled = await runCodex(hostSys(w1b.world), { binary: shim(w1b.bin, "codex", { shellLine: `"${POWERSHELL.replace(/\\/g, "\\\\")}" -Command x` }), world: w1b.world });
  assert.equal(doubled.program, POWERSHELL);
  assert.ok(doubled.line.includes("Windows\\\\System32"), doubled.line);

  const w2 = newWorld();
  const gemini = await runGemini(hostSys(w2.world), { binary: shim(w2.bin, "gemini", { shellLine: `${POWERSHELL} -NoProfile -NonInteractive -Command [Environment]::CommandLine` }), world: w2.world });
  assert.deepEqual([gemini.ran, gemini.program, gemini.error], [true, POWERSHELL, null]);
  assert.ok(fs.existsSync(path.join(w2.world.gemini, "settings.json")), "Gemini CLI got its settings in the world");
  const w3 = newWorld();
  const gemErr = await runGemini(hostSys(w3.world), { binary: shim(w3.bin, "gemini", { shellError: "spawn powershell.exe ENOENT" }), world: w3.world });
  assert.deepEqual([gemErr.program, gemErr.error], [null, "spawn powershell.exe ENOENT"]);

  const w4 = newWorld();
  const copilot = await runCopilot(hostSys(w4.world), { binary: shim(w4.bin, "copilot", { shellLine: '"powershell.exe" -NoProfile -NoLogo -NonInteractive -Command "try {}"' }), world: w4.world });
  assert.deepEqual([copilot.ran, copilot.program, copilot.error], [true, "powershell.exe", null]);
  const w5 = newWorld();
  const copErr = await runCopilot(hostSys(w5.world), { binary: shim(w5.bin, "copilot", { shellError: 'Error: PowerShell is not available. Tried "pwsh.exe", "powershell.exe". Install PowerShell from https://aka.ms/powershell' }), world: w5.world });
  assert.deepEqual([copErr.program, copErr.error], [null, 'PowerShell is not available. Tried "pwsh.exe", "powershell.exe". Install PowerShell from https://aka.ms/powershell']);
});

test("proveShellOf: the run is compared with the prediction of the machine; a difference is said in words", async () => {
  const machine = collectMachine(winMachine(), {});
  const w = newWorld();
  const ok = await proveShellOf("codex", hostSys(w.world), { binary: shim(w.bin, "codex", { shellLine: `"${POWERSHELL}" -Command x` }), world: w.world, machine });
  assert.deepEqual([ok.ok, ok.proved, ok.differences], [true, true, []]);
  assert.equal(ok.predicted.shell, POWERSHELL);
  const w2 = newWorld();
  const wrong = await proveShellOf("codex", hostSys(w2.world), { binary: shim(w2.bin, "codex", { shellLine: '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command x' }), world: w2.world, machine });
  assert.equal(wrong.proved, false);
  assert.match(wrong.differences[0], /the binary started C:\\Program Files\\PowerShell\\7\\pwsh\.exe; the prediction was C:\\Windows/);
  // Copilot is compared by the name it tried, Gemini by the path
  const w3 = newWorld();
  const cop = await proveShellOf("copilot", hostSys(w3.world), { binary: shim(w3.bin, "copilot", { shellLine: '"pwsh.exe" -NoProfile' }), world: w3.world, machine });
  assert.match(cop.differences[0], /the binary started pwsh\.exe; the prediction was powershell\.exe/);
  // no PowerShell on PATH: predicted missing, and the error is what is expected
  const none = collectMachine(winMachine({ env: { Path: "C:\\Windows\\System32;C:\\Windows" } }), {});
  const w4 = newWorld();
  const missing = await proveShellOf("gemini", hostSys(w4.world), { binary: shim(w4.bin, "gemini", { shellError: "spawn powershell.exe ENOENT" }), world: w4.world, machine: none });
  assert.deepEqual([missing.proved, missing.predicted.state], [true, "missing"]);
  const w5 = newWorld();
  const surprise = await proveShellOf("gemini", hostSys(w5.world), { binary: shim(w5.bin, "gemini", { shellLine: `${POWERSHELL} -x` }), world: w5.world, machine: none });
  assert.match(surprise.differences[0], /no PowerShell was predicted/);
  // a binary that cannot start
  const bad = await proveShellOf("codex", hostSys(w5.world), { binary: path.join(w5.base, "nope", "codex.exe"), world: w5.world, machine });
  assert.equal(bad.ok, false);
});

test("proveClaude: the tools and the exit code compared with predictShell on the machine of the run", async () => {
  const sys = winMachine({ env: { Path: "C:\\Windows\\System32;C:\\Windows" }, noGit: true });
  const facts = { env: { managed: {}, user: {}, project: {}, local: {} }, deny: [], defaultShell: [], envFiles: {} };
  const runner = (o) => async () => ({ ran: true, exitCode: 0, shellTools: ["PowerShell"], tools: ["PowerShell"], using: null, cwd: "C:\\work\\shop", ...o });
  const same = await proveClaude(sys, { binary: "claude", world: {}, facts, runner: runner({}) });
  assert.deepEqual([same.proved, same.predicted.tools], [true, ["PowerShell"]]);
  const other = await proveClaude(sys, { binary: "claude", world: {}, facts, runner: runner({ shellTools: ["Bash"], using: "C:\\Git\\bin\\bash.exe" }) });
  assert.equal(other.proved, false);
  assert.match(other.differences.join(" "), /the binary listed Bash; the prediction was PowerShell/);
  assert.match(other.differences.join(" "), /the binary took C:\\Git\\bin\\bash\.exe; the prediction found no Git Bash/);
  const stops = await proveClaude(sys, { binary: "claude", world: {}, facts, runner: runner({ exitCode: 1, shellTools: [] }) });
  assert.match(stops.differences[0], /the binary listed no shell tool; the prediction was PowerShell/);
  assert.match(stops.differences[1], /the binary exited with code 1; the prediction was 0/);
  assert.deepEqual(await proveClaude(sys, { binary: "claude", world: {}, facts, runner: async () => ({ ran: false, error: "x" }) }), { ok: false, error: "x" });
});

test("pickBinary: the path an option names, else the first program on PATH, else the first program found anywhere, and never a launcher, an alias or a program an npm shim starts", () => {
  const entries = (list, first) => ({ entries: list, first });
  const e = (p, o = {}) => ({ path: p, kind: "program", origin: "npm", skipped: null, ...o });
  assert.deepEqual(pickBinary(null, "codex", entries([], null), "D:\\x\\codex.exe"), { path: "D:\\x\\codex.exe", source: "named with the option" });
  const first = e("C:\\n\\codex.cmd");
  assert.equal(pickBinary(null, "codex", entries([first], first), undefined).source, "the first on PATH");
  const app = e("C:\\app\\codex.exe", { origin: "desktop-app" });
  assert.equal(pickBinary(null, "codex", entries([e("C:\\a\\x.exe", { origin: "npm-program" }), e("C:\\ed\\Cursor.exe", { origin: "editor" }), app], null), undefined).path, "C:\\app\\codex.exe");
  assert.equal(pickBinary(null, "codex", entries([e("C:\\x\\codex.cmd", { skipped: "a launcher" })], null), undefined), null);
  assert.equal(pickBinary(null, "codex", entries([], null), undefined), null);
});

test("askVersion: the version the program prints for itself, or what happened", async () => {
  const w = newWorld();
  const sys = hostSys(w.world);
  assert.deepEqual(await askVersion(sys, shim(w.bin, "codex", { version: "codex-cli 0.163.0" }), w.world), { version: "0.163.0", note: null });
  assert.deepEqual(await askVersion(sys, shim(w.bin, "copilot", { version: "GitHub Copilot CLI 1.0.98." }), w.world), { version: "1.0.98", note: null });
  const none = await askVersion(sys, shim(w.bin, "gemini", { version: "no number here" }), w.world);
  assert.deepEqual([none.version, /^did not print a version \(exit 0\)$/.test(none.note)], [null, true]);
  const fails = await askVersion(sys, shim(w.bin, "claude", { version: "2.1.0", versionExit: 3 }), w.world);
  assert.match(fails.note, /^did not print a version \(exit 3\)$/);
  const gone = await askVersion(sys, path.join(w.base, "nope", "codex.exe"), w.world);
  assert.match(gone.note, /^could not start \(/);
  const hangs = await askVersion(sys, shim(w.bin, "gemini", { hang: true }), w.world, { timeout: 1500 });
  assert.deepEqual(hangs, { version: null, note: "no answer in 1.5 seconds" });
});

test("liveAll on this machine, through stand-ins on PATH: every agent found is run in its own throwaway folder, which is removed afterwards", { skip: !IS_WIN && "the pretend machine and the host would disagree on PATH" }, async () => {
  const w = newWorld();
  shim(w.bin, "claude", { tools: ["PowerShell"], edition: "Windows PowerShell 5.1 (powershell.exe)", version: "2.1.302 (Claude Code)" });
  for (const a of ["codex", "gemini", "copilot"]) shim(w.bin, a, { shellLine: `"${POWERSHELL}" -Command x`, version: `${a} 1.2.3` });
  const sys = hostSys(w.world, { PATH: `${w.bin};${process.env.PATH || process.env.Path}`, Path: `${w.bin};${process.env.PATH || process.env.Path}`, CLAUDE_CODE_GIT_BASH_PATH: undefined });
  const { findAgents } = await import("../src/inventory.mjs");
  const inventory = findAgents(sys, { agents: ["claude", "codex", "gemini", "copilot"] });
  const made = [];
  const facts = { agents: ["claude", "codex", "gemini", "copilot", "cursor"], inventory: { agents: { ...inventory.agents, cursor: { entries: [], first: null } } }, claude: { settingsFacts: { env: { managed: {}, user: {}, project: {}, local: {} }, deny: [], defaultShell: [], envFiles: {} } }, machine: collectMachine(winMachine(), {}) };
  const live = await liveAll(sys, { facts, tmpdir: w.base, makeDir: (t) => { const d = makeTempDir(t); made.push(d); return d; }, removeDir: removeTempDir });
  assert.equal(made.length, 4, "one throwaway folder for each agent that was run");
  for (const d of made) assert.ok(!fs.existsSync(d), "removed");
  assert.deepEqual(Object.keys(live.agents), ["claude", "codex", "gemini", "copilot", "cursor"]);
  assert.equal(live.agents.cursor.skipped.includes("needs a login"), true);
  for (const id of ["codex", "gemini", "copilot"]) assert.equal(live.agents[id].binary.asked, "1.2.3", `${id} was asked for its version`);
  assert.equal(live.agents.claude.binary.asked, "2.1.302");
});
