// The pages of `explain`: one for every finding id and for no other, every line marked, every id of the form <agent>.<name>, every issue a link that names its number.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.mjs";
import { AGENT_ORDER, IDS, PAGES, basisOf, listPages, nearIds, pageFor } from "../src/explain.mjs";
import { FINDING_IDS } from "../src/findings.mjs";
import { explainJson, explainListText, explainText } from "../src/report.mjs";

test("a page for every finding the tool can emit, and for none it cannot, in the order of the agents", () => {
  assert.deepEqual([...IDS].sort(), [...FINDING_IDS].sort());
  assert.equal(new Set(IDS).size, IDS.length);
  const agents = IDS.map((id) => AGENT_ORDER.indexOf(id.split(".")[0]));
  assert.deepEqual(agents, [...agents].sort((a, b) => a - b), "the pages of one agent come together, in the order claude, codex, gemini, copilot, cursor");
});

test("every id is <agent>.<name>; every page has a title, a meaning, marked lines, a fix and a basis", () => {
  for (const p of PAGES) {
    assert.match(p.id, /^(claude|codex|gemini|copilot|cursor)\.[a-z0-9]+(-[a-z0-9]+)*$/, p.id);
    assert.ok(p.title.length > 10 && p.means.length > 40, p.id);
    assert.ok(p.does.length >= 1, `${p.id} says what the agent does`);
    for (const line of p.does) assert.match(line, /^[VDN]: \S/, `${p.id}: a line that is not marked V, D or N: ${line.slice(0, 50)}`);
    assert.ok(p.fix.length >= 1 && p.fix.every((x) => x.length > 5), p.id);
    assert.ok(["verified", "documented", "not verified"].includes(p.basis), p.id);
    assert.equal(basisOf(p.id), p.basis);
  }
  assert.equal(basisOf("nope.nothing"), "not verified");
});

test("the basis of a page is honest: verified needs a V line, documented a D line and no V, not verified needs an N line and neither of the others", () => {
  for (const p of PAGES) {
    const marks = new Set(p.does.map((l) => l[0]));
    if (p.basis === "verified") assert.ok(marks.has("V"), `${p.id} is verified and has no V line`);
    if (p.basis === "documented") assert.ok(marks.has("D"), `${p.id} is documented and has no D line`);
    if (p.basis === "not verified") assert.ok(marks.has("N") && !marks.has("V"), `${p.id} is not verified and has a V line or no N line`);
  }
});

test("every issue is a link that carries its number, in a tracker of the agent it is about or the Cursor forum", () => {
  for (const p of PAGES) {
    const agent = p.id.split(".")[0];
    for (const i of p.issues) {
      assert.ok(Number.isInteger(i.number) && i.title.length > 5, `${p.id}: #${i.number}`);
      assert.ok(i.url.endsWith(`/${i.number}`), `${p.id}: ${i.url}`);
      const host = { claude: "github.com/anthropics/claude-code/issues/", codex: "github.com/openai/codex/issues/", gemini: "github.com/google-gemini/gemini-cli/issues/", copilot: "github.com/github/copilot-cli/issues/", cursor: "forum.cursor.com/t/" }[agent];
      assert.ok(i.url.includes(host), `${p.id}: ${i.url} is not in the tracker of ${agent}`);
    }
  }
});

test("every number the pages cite is one the research of 18 October 2026 gave, for its tracker", () => {
  const cited = {};
  for (const p of PAGES) for (const i of p.issues) cited[i.url.replace(/\/\d+$/, "")] = [...(cited[i.url.replace(/\/\d+$/, "")] || []), i.number];
  const known = {
    "https://github.com/openai/codex/issues": [13993, 13762, 16579],
    "https://github.com/google-gemini/gemini-cli/issues": [12678, 21340, 12519, 16003],
    "https://github.com/github/copilot-cli/issues": [411, 2355, 1434, 4001, 3659, 1730],
    "https://forum.cursor.com/t": [168416, 168407, 144940, 168129],
  };
  for (const [tracker, numbers] of Object.entries(known)) for (const n of new Set(cited[tracker] || [])) assert.ok(numbers.includes(n), `${tracker}/${n} is not in the research`);
  for (const [tracker, list] of Object.entries(cited)) if (!known[tracker]) assert.ok(tracker.includes("anthropics/claude-code"), tracker + ": " + list.join(","));
});

test("pageFor takes an id in any case and splits each line into its mark and text; nearIds helps with a part of an id", () => {
  const p = pageFor("  Claude.Git-Bash-Not-Found ");
  assert.equal(p.id, "claude.git-bash-not-found");
  assert.deepEqual(p.does.map((d) => d.source).slice(0, 2), ["verified", "verified"]);
  assert.ok(pageFor("codex.hook-exit-2").does.some((d) => d.source === "documented"));
  assert.ok(pageFor("cursor.msystem").does.some((d) => d.source === "not verified"));
  assert.equal(pageFor("git-bash-not-found"), null, "the old id without the agent is not an id");
  assert.equal(pageFor("nosuch"), null);
  assert.deepEqual(nearIds("git-bash-not-found").slice(0, 1), ["claude.git-bash-not-found"]);
  assert.ok(nearIds("sandbox").includes("codex.sandbox-none"));
  assert.deepEqual(nearIds("zzzz"), []);
  assert.ok(nearIds("hook").length <= 5);
});

test("the text, the list and the JSON of a page", () => {
  const p = pageFor("codex.shell-path-ignored");
  const text = explainText(p);
  assert.match(text, /^codex\.shell-path-ignored {3}windows\.shell_path is set, and Codex does not have that key\n/);
  assert.match(text, /\nWhat Codex CLI does\n {2}- \(verified\) codex exec --strict-config stopped with/);
  assert.match(text, /\nThe fix\n {2}- Remove the key\./);
  assert.match(text, /\nThe issue and forum threads\n {2}#16579 {2}Windows: allow configuring the default session shell via config \(open, 54 reactions\)\n {8}https:\/\/github\.com\/openai\/codex\/issues\/16579\n$/);
  assert.match(explainText(pageFor("claude.launcher-first")), /The issue and forum threads: none found for this/);
  const j = explainJson(p);
  assert.deepEqual(Object.keys(j), ["ok", "id", "agent", "basis", "title", "means", "does", "fix", "issues"]);
  assert.equal(j.agent, "codex");
  const list = explainListText(listPages());
  assert.equal(list.trim().split("\n").length, IDS.length);
  assert.match(list, /^claude\.no-shell-tool +Claude Code will not start/);
});

test("no page uses an emoji or a word the house does not use", () => {
  const all = JSON.stringify(PAGES);
  assert.ok(!/\p{Extended_Pictographic}/u.test(all), "no emoji");
  assert.ok(!/\b(simply|easily|blazing|seamless|powerful|amazing|revolutionary)\b/i.test(all), "plain words");
});

test("the pages and the findings agree on the numbers they quote: every issue number in a finding's text is cited on its page", () => {
  const src = fs.readFileSync(path.join(ROOT, "src", "findings.mjs"), "utf8");
  for (const m of src.matchAll(/f\("([a-z]+\.[a-z0-9-]+)"[^;]*?\b(?:#|issues\/)(\d{3,6})\b/g)) {
    const p = PAGES.find((x) => x.id === m[1]);
    if (p) assert.ok(p.issues.some((i) => String(i.number) === m[2]) || JSON.stringify(p).includes(m[2]), `${m[1]} mentions #${m[2]} and its page does not`);
  }
});
