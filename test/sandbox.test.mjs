// The guard of the tests (test/sandbox.mjs) and the isolation of this process (test/helpers.mjs): no real-binary check starts a program before the guard has looked at the environment it would get,
// and a run that would reach the real ~/.codex, ~/.copilot, ~/.gemini, ~/.claude, %LOCALAPPDATA% or the network is refused. A probe on 17 October 2026 wrote into the real ~/.codex before this existed.
// (src/live.mjs has a guard of its own for `check --live`: test/live.test.mjs holds it.)
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DEAD_PROXY, GUARD, HOME_VARS, NO_PROXY, PROXY_VARS, homeEnv, isInside, tmpDir, underTmp, world } from "./helpers.mjs";
import { agentEnv, assertSandboxed, launch } from "./sandbox.mjs";

const sandbox = (name = "sbx") => { const w = world(name); return { root: w.base, home: w.home, work: w.work, w }; };
const lower = (s) => s.toLowerCase();

test("the process that runs the tests has every agent folder, APPDATA and LOCALAPPDATA inside one throwaway folder, and a closed port as every proxy", () => {
  for (const name of HOME_VARS) {
    assert.ok(process.env[name], `${name} is set`);
    assert.ok(isInside(process.env[name], GUARD), `${name}=${process.env[name]} is inside ${GUARD}`);
  }
  for (const name of PROXY_VARS) assert.equal(process.env[name], DEAD_PROXY, name);
  assert.equal(process.env.NO_PROXY, NO_PROXY);
  assert.ok(underTmp(GUARD));
  assert.match(process.env.AGENT_WINDOWS_DOCTOR_MANAGED_DIR, /no-managed-settings$/);
  assert.match(process.env.AGENT_WINDOWS_DOCTOR_USER_ENV_FILE, /user-env\.json$/);
  // none of the machine's agent sessions is in the environment
  assert.deepEqual(Object.keys(process.env).filter((k) => /^(CLAUDE|ANTHROPIC|CLAUDECODE|OPENAI|CODEX|COPILOT|GEMINI|GOOGLE_GEMINI|CURSOR)/i.test(k) && !HOME_VARS.some((h) => lower(h) === lower(k))), []);
});

test("assertSandboxed passes for the environment of a world and stops each variable that is missing, empty, relative, outside, or a proxy that is not the closed port", () => {
  const sb = sandbox();
  const env = agentEnv(sb);
  assert.equal(assertSandboxed(env, sb.root), env);
  const outside = path.join(tmpDir("adw-outside-"), "x");
  for (const name of HOME_VARS) {
    assert.throws(() => assertSandboxed({ ...env, [name]: outside }, sb.root), new RegExp(`guard: ${name}=.* is not inside the sandbox`), `${name} outside`);
    assert.throws(() => assertSandboxed({ ...env, [name]: "" }, sb.root), new RegExp(`guard: ${name} is not set`), `${name} empty`);
    assert.throws(() => assertSandboxed({ ...env, [name]: "relative" }, sb.root), new RegExp(`guard: ${name}=relative`), `${name} relative`);
    const without = Object.fromEntries(Object.entries(env).filter(([k]) => lower(k) !== lower(name)));
    assert.throws(() => assertSandboxed(without, sb.root), new RegExp(`guard: ${name} is not set`), `${name} missing`);
  }
  for (const name of PROXY_VARS) {
    assert.throws(() => assertSandboxed({ ...env, [name]: "http://127.0.0.1:3128" }, sb.root), /is not the closed port/, `${name} elsewhere`);
    const without = Object.fromEntries(Object.entries(env).filter(([k]) => lower(k) !== lower(name)));
    assert.throws(() => assertSandboxed(without, sb.root), /is not set to the closed port/, `${name} missing`);
    // a right value in one spelling does not hide a wrong one in another
    assert.throws(() => assertSandboxed({ ...env, [name]: "http://corp:8080", [lower(name)]: DEAD_PROXY }, sb.root), /is not the closed port/, `${name} in two spellings`);
  }
  assert.throws(() => assertSandboxed({ ...env, NO_PROXY: "example.com", no_proxy: NO_PROXY }, sb.root), /NO_PROXY is not/);
  assert.throws(() => assertSandboxed(env, ""), /no sandbox root/);
  assert.throws(() => assertSandboxed({ ...env, HOME: `${sb.root}-sibling` }, sb.root), /is not inside the sandbox/, "a sibling whose name begins with the root's is outside it");
});

test("agentEnv removes the variables of the machine's agent sessions and the CI variable GITHUB_SHA, puts every folder in the world, and refuses an extra entry that moves one out", () => {
  const sb = sandbox();
  process.env.CLAUDE_FOO = "1"; process.env.ANTHROPIC_API_KEY = "sk-real"; process.env.OPENAI_API_KEY = "sk-openai"; process.env.COPILOT_GITHUB_TOKEN = "ghp"; process.env.GITHUB_SHA = "abc";
  process.env.__PSLockdownPolicy = "4"; process.env.MY_OWN = "kept";
  try {
    const env = agentEnv(sb, { FAKE_API_KEY: "fake" });
    for (const gone of ["CLAUDE_FOO", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "COPILOT_GITHUB_TOKEN", "GITHUB_SHA", "__PSLockdownPolicy"]) assert.equal(env[gone], undefined, gone);
    assert.equal(env.MY_OWN, "kept");
    assert.equal(env.FAKE_API_KEY, "fake");
    for (const [k, v] of Object.entries(homeEnv(sb.home))) if (HOME_VARS.includes(k)) assert.equal(env[k], v, k);
    assert.throws(() => agentEnv(sb, { CODEX_HOME: path.join(tmpDir("adw-out-"), "c") }), /is not inside the sandbox/);
    assert.throws(() => agentEnv(sb, { HTTPS_PROXY: "http://corp:8080" }), /is not the closed port/);
  } finally {
    for (const k of ["CLAUDE_FOO", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "COPILOT_GITHUB_TOKEN", "GITHUB_SHA", "__PSLockdownPolicy", "MY_OWN"]) delete process.env[k];
  }
});

test("launch starts the program only after the guard: with a folder outside the world nothing starts, and with a world's environment the program sees only that world", async () => {
  const sb = sandbox();
  const marker = path.join(sb.root, "started.json");
  const script = path.join(sb.root, "probe.mjs");
  fs.writeFileSync(script, `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ home: process.env.HOME, profile: process.env.USERPROFILE, codex: process.env.CODEX_HOME, copilot: process.env.COPILOT_HOME, claude: process.env.CLAUDE_CONFIG_DIR, gemini: process.env.GEMINI_CLI_HOME, local: process.env.LOCALAPPDATA, app: process.env.APPDATA, http: process.env.HTTP_PROXY, https: process.env.HTTPS_PROXY, all: process.env.ALL_PROXY, no: process.env.NO_PROXY }));\n`);
  const outside = tmpDir("adw-real-");
  // the guard throws before anything is spawned
  assert.throws(() => launch(sb, process.execPath, [script], { env: { CODEX_HOME: path.join(outside, ".codex") } }), /guard: CODEX_HOME=.* is not inside the sandbox/);
  assert.throws(() => launch(sb, process.execPath, [script], { env: { LOCALAPPDATA: outside } }), /guard: LOCALAPPDATA/);
  assert.throws(() => launch(sb, process.execPath, [script], { env: { HTTP_PROXY: "http://proxy.example:8080" } }), /is not the closed port/);
  assert.ok(!fs.existsSync(marker), "no program was started by a refused launch");
  const ok = await launch(sb, process.execPath, [script], { timeout: 60000 });
  assert.equal(ok.code, 0, ok.err);
  const seen = JSON.parse(fs.readFileSync(marker, "utf8"));
  for (const [k, v] of Object.entries({ home: seen.home, profile: seen.profile, codex: seen.codex, copilot: seen.copilot, claude: seen.claude, gemini: seen.gemini, local: seen.local, app: seen.app })) assert.ok(isInside(v, sb.root), `${k}=${v} is inside the world`);
  assert.deepEqual([seen.http, seen.https, seen.all, seen.no], [DEAD_PROXY, DEAD_PROXY, DEAD_PROXY, NO_PROXY]);
});
