// The tool's own `check --live` put to the real binaries (each runs only when its E2E_* variable names a binary, and only on Windows): the command starts the binary in a throwaway
// home against a fake API on 127.0.0.1, reads the shell it gave the model, and compares that with its prediction for the machine. Nothing is spent, and nothing of the user's is read: the
// process runs behind the guard of test/helpers.mjs, with a PATH of the system folders (and the folder of the binary's own node, which the npm shims need). On the other systems the one
// check here is the answer "nothing to check" with exit code 0, from the real command line.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { IS_WIN, runCli, world } from "./helpers.mjs";
import { claude, codex, copilot, gemini, skipReason } from "./agents.mjs";
import { plainWindowsPath } from "./sandbox.mjs";

const ALL = [claude, codex, gemini, copilot];
const SKIPS = Object.fromEntries(await Promise.all(ALL.map(async (a) => [a.id, IS_WIN ? await skipReason(a) : "Windows only"])));
const NUMBERS = Object.fromEntries(await Promise.all(ALL.map(async (a) => [a.id, SKIPS[a.id] ? "" : (await a.info()).number])));

/** A world and an environment for the command: system folders on PATH, the folder of each binary named. */
function setup(label, agents) {
  const w = world(label);
  const env = { ...w.env };
  const key = Object.keys(env).find((k) => k.toLowerCase() === "path") || "Path";
  env[key] = plainWindowsPath().join(";");
  const flags = agents.flatMap((a) => [`--${a.id}`, a.BIN]);
  return { w, env, flags };
}

test("on a system that is not Windows, from the real command line: check says there is nothing to check and exits with 0, and so does check --live, since there is nothing to prove", { skip: IS_WIN && "this runs where there is nothing to check" }, () => {
  const w = world("nothing");
  const r = runCli(["check"], { cwd: w.work, env: w.env });
  assert.equal(r.code, 0, r.all);
  assert.match(r.out, /Nothing to check on /);
  const j = runCli(["check", "--json"], { cwd: w.work, env: w.env });
  assert.equal(j.code, 0, j.all);
  assert.equal(JSON.parse(j.out).applicable, false);
  const live = runCli(["check", "--live"], { cwd: w.work, env: w.env });
  assert.equal(live.code, 0, live.all);
  assert.equal(live.out, r.out, "the answer with --live is the answer without it");
  assert.equal(live.err, "");
  assert.equal(runCli(["agents"], { cwd: w.work, env: w.env }).code, 0);
});

for (const agent of ALL) {
  test(`check --live proves the shell of the real ${agent.label}: it ran the binary, read what it gave the model, and the prediction agrees`, { skip: SKIPS[agent.id], timeout: 600000 }, async (t) => {
    const { w, env, flags } = setup(`live-${agent.id}`, [agent]);
    const r = runCli(["check", "--live", "--agent", agent.id, ...flags, "--json", "--project", w.work], { cwd: w.work, env, timeout: 500000 });
    assert.ok([0, 1].includes(r.code), r.all);
    const doc = JSON.parse(r.out);
    const live = doc.live.agents[agent.id];
    assert.equal(doc.live.ok, true, JSON.stringify(live));
    assert.equal(live.ok, true);
    assert.equal(live.proved, true, JSON.stringify(live.differences));
    assert.deepEqual(live.differences, []);
    assert.equal(live.binary.asked, NUMBERS[agent.id], "the version the binary prints for itself is the one the report states");
    assert.equal(live.binary.source, "named with the option");
    assert.ok(!doc.findings.some((f) => /^\w+\.no-version$/.test(f.id)), "the binary printed a version");
    const text = runCli(["check", "--live", "--agent", agent.id, ...flags, "--project", w.work], { cwd: w.work, env, timeout: 500000 });
    assert.ok([0, 1].includes(text.code), text.all);
    assert.ok(text.out.includes(`proved with the real ${agent.id} ${NUMBERS[agent.id]} (`), text.out.slice(text.out.indexOf("Live")));
    t.diagnostic(`${agent.label} ${NUMBERS[agent.id]}: ${JSON.stringify(live.actual || live.run || {}).slice(0, 220)}`);
  });
}

test("check --live with the four binaries at once, and --markdown never starts a binary", { skip: ALL.every((a) => SKIPS[a.id]) && "no E2E_* variable is set", timeout: 900000 }, async (t) => {
  const present = ALL.filter((a) => !SKIPS[a.id]);
  const { w, env, flags } = setup("live-all", present);
  const r = runCli(["check", "--live", "--agent", present.map((a) => a.id).join(","), ...flags, "--json", "--project", w.work], { cwd: w.work, env, timeout: 800000 });
  assert.ok([0, 1].includes(r.code), r.all);
  const doc = JSON.parse(r.out);
  assert.deepEqual(Object.keys(doc.live.agents), present.map((a) => a.id));
  for (const a of present) assert.equal(doc.live.agents[a.id].proved, true, `${a.id}: ${JSON.stringify(doc.live.agents[a.id].differences)}`);
  assert.equal(doc.live.ok, true);
  // --markdown refuses --live: a short report to paste does not start a program
  const md = runCli(["check", "--markdown", "--live"], { cwd: w.work, env });
  assert.equal(md.code, 2);
  assert.match(md.err, /--markdown/);
  t.diagnostic(`${present.map((a) => `${a.label} ${NUMBERS[a.id]}`).join(", ")}`);
});

test("a path that is not a binary: check --live says it could not start it, and exits with 1", { skip: IS_WIN ? false : "Windows only", timeout: 120000 }, () => {
  const { w, env } = setup("live-bad", []);
  const r = runCli(["check", "--live", "--agent", "codex", "--codex", path.join(w.base, "nope", "codex.exe"), "--json", "--project", w.work], { cwd: w.work, env });
  assert.equal(r.code, 1, r.all);
  const doc = JSON.parse(r.out);
  assert.equal(doc.live.ok, false);
  assert.equal(doc.live.agents.codex.ok, false);
  assert.match(doc.live.agents.codex.error || "", /is not a file/);
});
