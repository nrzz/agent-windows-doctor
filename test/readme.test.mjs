// The README, held to the code: its sections, the commands and options it names, the usage block, the numbers it quotes, the table of findings, the JSON shapes, the examples (what the code prints, or
// what a real run printed and the code still recognises), the Files table, the toolkit line, and the number of tests, which is the runner's.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, run } from "./helpers.mjs";
import { busyMachine, documents } from "./documents.mjs";
import { CLAIMS, RESTATED } from "./claude-claims.mjs";
import { EDITIONS, ROWS } from "./shell-table.mjs";
import { winMachine } from "./win-machine.mjs";
import { HELP, parseArgs } from "../src/cli.mjs";
import { VERSION } from "../src/version.mjs";
import { FINDING_IDS, FINDING_SEVERITY } from "../src/findings.mjs";
import { IDS, pageFor } from "../src/explain.mjs";
import { MARKDOWN_LINE, MARKDOWN_MAX_FINDINGS } from "../src/report.mjs";

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const readme = read("README.md");
const section = (from, to) => readme.slice(readme.indexOf(`\n${from}\n`), to ? readme.indexOf(`\n${to}\n`) : undefined);
const countTests = (rel) => [...read(rel).matchAll(/^test\(/gm)].length;
const posix = (f) => f.split(path.sep).join("/");
const list = (dir, ext) => fs.readdirSync(path.join(ROOT, dir)).filter((n) => n.endsWith(ext)).map((n) => `${dir}/${n}`);

const README_SECTIONS = ["## What you get", "## What it costs in tokens", "## Install", "## Use", "## How it works", "## What was verified, and how", "## Not verified", "## Files", "## Contributing", "## Also by the same author", "## License"];

test("the README has the sections the house keeps, in order, and Privacy under How it works", () => {
  let at = -1;
  for (const h of README_SECTIONS) {
    const i = readme.indexOf(`\n${h}\n`);
    assert.ok(i > at, `${h} is there, after the one before it`);
    at = i;
  }
  assert.match(readme, /^# agent-windows-doctor\n/);
  assert.ok(readme.indexOf("\n### Privacy\n") > readme.indexOf("\n## How it works\n") && readme.indexOf("\n### Privacy\n") < readme.indexOf("\n## What was verified, and how\n"), "### Privacy sits under How it works");
  assert.ok(!readme.includes("@@"), "a placeholder is still in the README");
  assert.ok(!/\p{Extended_Pictographic}/u.test(readme), "no emoji");
  assert.ok(!/\b(simply|easily|blazing|seamless|powerful|amazing|revolutionary)\b/i.test(readme), "plain words");
});

test("the opening paragraphs name the numbers of the research and what the tool does", () => {
  const opening = readme.slice(0, readme.indexOf("\n## What you get\n"));
  for (const n of ["18 October 2026", "5,253", "23,221", "171", "316", "894", "15,184", "95", "2,213", "740", "#16579", "54 reactions", "windows.shell_path", "#411", "#2355", "#12678", "#21340", "#12519", "168416", "`claude doctor` and `codex doctor`"]) assert.ok(opening.includes(n), n);
  for (const a of ["Claude Code", "Codex CLI", "Gemini CLI", "GitHub Copilot CLI", "Cursor"]) assert.ok(opening.includes(a), a);
  assert.ok(opening.includes("verified (the binary showed it in the tests), documented (the vendor's documentation or a maintainer's words) or not verified"));
  assert.ok(opening.includes("On Linux and macOS it says there is nothing to check and exits 0."));
});

test("the README names every command and every option of the CLI, and the install lines", () => {
  for (const cmd of ["check", "check --live", "check --markdown", "explain", "agents"]) assert.ok(readme.includes(`### \`${cmd}\``), `a heading for ${cmd}`);
  for (const flag of ["--live", "--claude", "--codex", "--gemini", "--copilot", "--project", "--agent", "--json", "--markdown"]) assert.ok(readme.includes(`\`${flag}`), flag);
  for (const flag of [...HELP.matchAll(/^\s+(--[a-z-]+)/gm)].map((m) => m[1])) assert.ok(readme.includes(flag), `${flag} of --help`);
  assert.ok(readme.includes("npx -y github:nrzz/agent-windows-doctor check --project ."));
  assert.ok(readme.includes("git clone https://github.com/nrzz/agent-windows-doctor"));
  for (const cmd of ["agent-windows-doctor check", "agent-windows-doctor agents", "agent-windows-doctor explain"]) assert.ok(readme.includes(cmd), cmd);
  assert.ok(!/\bclaude-windows-doctor fix\b|\bundo\b/.test(section("## Use", "## How it works")), "this tool has no fix and no undo");
});

test("the usage block of the README is the help text of the CLI", async () => {
  const help = (await run(["--help"], { sys: winMachine() })).out;
  assert.equal(help, HELP);
  const usage = help.slice(help.indexOf("Usage: agent-windows-doctor")).trimEnd();
  assert.ok(readme.includes(`\`\`\`text\n${usage}\n\`\`\``), "the README's usage block is out of date: paste the output of agent-windows-doctor --help from its Usage line");
});

test("the 'Also by the same author' section: one sentence, three links, nineteen tools for Claude Code", () => {
  const body = section("## Also by the same author", "## License").split("\n").slice(2).join("\n").trim();
  assert.equal(body, "The [Claude Code toolkit](https://github.com/nrzz/claude-code-toolkit) has nineteen tools for Claude Code, and the two closest to this one are [claude-windows-doctor](https://github.com/nrzz/claude-windows-doctor), which goes deeper on Claude Code alone, and [everyhook](https://github.com/nrzz/everyhook), which writes one hook for every agent.");
});

test("the links in the README that point into the repository go to files that are there", () => {
  for (const m of readme.matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)) assert.ok(exists(m[1].split("#")[0]), `${m[1]} is linked and exists`);
});

// ---- the numbers -------------------------------------------------------------------------------------------------------------------------

test("the numbers the README quotes are the numbers of the code: the table of 129 cases, the rows put to the binary, the findings, the tests of each real-binary file, the cap of the markdown report", async () => {
  const verified = section("## What was verified, and how", "## Not verified");
  assert.ok(ROWS.length >= 129);
  assert.ok(readme.includes(`the table of ${ROWS.length} cases`) && readme.includes(`all ${ROWS.length} rows`), `the table has ${ROWS.length} cases`);
  const restated = ROWS.filter((r) => RESTATED.includes(r.id));
  assert.equal(restated.length, RESTATED.length, "every restated row is in the table");
  const here = restated.filter((r) => r.defaultGit !== "present").length;
  assert.ok(verified.includes(`${here} rows of the table`), `${here} rows run on a machine without Git at C:\\Program Files\\Git`);
  assert.ok(verified.includes(`Two more rows apply only to a machine with Git at \`C:\\Program Files\\Git\``) && restated.length - here === 2);
  assert.ok(verified.includes(`${EDITIONS.length === 6 ? "Six" : EDITIONS.length} PATH layouts`));
  assert.ok(Object.keys(CLAIMS).length >= 6);
  assert.ok(readme.includes(`**${FINDING_IDS.length} ids**`) || readme.includes(`${FINDING_IDS.length} ids of the form`), `the README says ${FINDING_IDS.length} findings`);
  assert.ok(readme.includes(`prints the ${IDS.length} ids`) && IDS.length === FINDING_IDS.length);
  assert.ok(readme.includes(`${FINDING_IDS.length} findings, by agent`));
  assert.ok(verified.includes(`\`test/e2e-codex.test.mjs\` (${countTests("test/e2e-codex.test.mjs")} tests)`), `e2e-codex has ${countTests("test/e2e-codex.test.mjs")} tests`);
  assert.ok(verified.includes(`\`test/e2e-copilot.test.mjs\` (${countTests("test/e2e-copilot.test.mjs")} tests)`), `e2e-copilot has ${countTests("test/e2e-copilot.test.mjs")} tests`);
  assert.ok(verified.includes(`\`test/windows.test.mjs\` (${countTests("test/windows.test.mjs")} tests)`), `windows has ${countTests("test/windows.test.mjs")} tests`);
  // the markdown report: at most 12 findings, 500 characters a line; the worst case here is under the figure the README gives
  assert.equal(MARKDOWN_MAX_FINDINGS, 12);
  assert.equal(MARKDOWN_LINE, 500);
  assert.ok(readme.includes("at most 12 findings") && readme.includes("500 characters"));
  const docs = await documents();
  assert.ok(docs.check.length >= 10);
  const busy = (await run(["check", "--markdown", "--project", "C:\\Users\\me\\proj"], { sys: busyMachine() })).out;
  const lines = busy.trimEnd().split("\n");
  assert.ok(lines.filter((l) => /^- (ERROR|WARNING) /.test(l)).length <= 12);
  for (const l of lines) assert.ok(l.length <= 500, `${l.length} characters in a line`);
  assert.ok(busy.length < 7500, `the busiest report here is ${busy.length} characters`);
  assert.ok(readme.includes("about 7,500 characters, under 2,000 tokens"));
});

test("the number of tests the README states is the runner's total minus the helper files that node --test lists as tests", { skip: process.env.ADW_COUNTING && "this is the run that counts" }, () => {
  const env = { ...process.env, ADW_COUNTING: "1" };
  for (const k of ["E2E_CLAUDE", "E2E_CODEX", "E2E_GEMINI", "E2E_COPILOT", "NODE_TEST_CONTEXT"]) delete env[k];
  const r = spawnSync(process.execPath, ["--test"], { cwd: ROOT, env, encoding: "utf8", timeout: 900000, windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  const total = Number((/^(?:# |ℹ )tests (\d+)$/m.exec(r.stdout) || [])[1]);
  assert.ok(total > 200, `the runner reported ${total} tests:\n${r.stdout.slice(-800)}`);
  const helpers = fs.readdirSync(path.join(ROOT, "test")).filter((n) => n.endsWith(".mjs") && !n.endsWith(".test.mjs")).length;
  const counted = total - helpers;
  const stated = /\*\*(\d+) automated tests\*\*/.exec(readme);
  assert.ok(stated, "the README says how many automated tests there are");
  assert.equal(Number(stated[1]), counted, `the runner reported ${total}, of which ${helpers} are helper files: ${counted} tests`);
  assert.ok(readme.includes(`each of the ${helpers} helper files`), `the README names the ${helpers} helper files`);
  // this test is skipped in the run that counted it, and passes in the run of the README's reader
  const skipped = Number((/^(?:# |ℹ )skipped (\d+)$/m.exec(r.stdout) || [])[1]) - 1;
  const passed = Number((/^(?:# |ℹ )pass (\d+)$/m.exec(r.stdout) || [])[1]) + 1 - helpers;
  assert.equal(passed + skipped, counted, "every test passes or is skipped");
  if (process.platform === "win32") assert.ok(readme.includes(`On Windows ${passed} pass and ${skipped} are skipped`), `the README says "On Windows ${passed} pass and ${skipped} are skipped"`);
  else assert.ok(skipped > 0 && readme.includes(`On Linux and macOS ${passed} pass and ${skipped} are skipped`), `the README says "On Linux and macOS ${passed} pass and ${skipped} are skipped" (fewer pass off Windows: the checks that read the real Windows are skipped)`);
});

// ---- the table of findings ---------------------------------------------------------------------------------------------------------------

test("the README lists every finding id that check can emit, in a table, with the severity, the basis and the title of its page, and no other", () => {
  const start = readme.indexOf("\n| Id | Severity | Basis | What it says |");
  assert.ok(start > 0, "the table of findings is in the README");
  const table = readme.slice(start, readme.indexOf("\n\n", start + 5));
  const rows = [...table.matchAll(/^\| `([a-z0-9.-]+)` \| ([a-z, ]+) \| (verified|documented|not verified) \| (.+) \|$/gm)].map((m) => ({ id: m[1], severity: m[2], basis: m[3], title: m[4] }));
  assert.deepEqual(rows.map((r) => r.id), FINDING_IDS, "the ids of the README and of the code are the same, in the same order");
  for (const r of rows) {
    const page = pageFor(r.id);
    assert.deepEqual({ severity: r.severity, basis: r.basis, title: r.title }, { severity: FINDING_SEVERITY[r.id].length === 1 ? FINDING_SEVERITY[r.id][0] : FINDING_SEVERITY[r.id].join(", "), basis: page.basis, title: page.title }, r.id);
  }
  assert.equal(new Set(IDS).size, IDS.length);
  assert.deepEqual([...IDS].sort(), [...FINDING_IDS].sort(), "and explain has a page for each");
  // every id the sources emit with a literal is in the list
  const emitted = new Set();
  for (const f of list("src", ".mjs")) for (const m of read(f).matchAll(/\bf\("([a-z]+\.[a-z0-9-]+)", /g)) emitted.add(m[1]);
  assert.ok(emitted.size >= 35, `${emitted.size} literal ids`);
  for (const id of emitted) assert.ok(FINDING_IDS.includes(id), `${id} is emitted and is not listed`);
});

// ---- the JSON documents ------------------------------------------------------------------------------------------------------------------

test("the JSON shapes in the README: every field of a document is named there, and every field named is in some document or marked optional", async () => {
  const start = readme.indexOf("\ncheck    {");
  assert.ok(start > 0, "the shapes are in the README");
  const block = readme.slice(start + 1, readme.indexOf("\n```", start));
  // one entry per command; a line that begins with a space belongs to the entry above it, and what follows // is a comment
  const entries = {};
  let current = null;
  for (const raw of block.split("\n")) {
    const line = raw.replace(/\s\/\/.*$/, "");
    const m = /^([a-z]+)\s{2,}\{/.exec(line);
    if (m) { current = m[1]; entries[current] = ""; }
    if (current) entries[current] += `${line}\n`;
  }
  assert.deepEqual(Object.keys(entries), ["check", "agents", "explain", "error"]);
  const docs = await documents();
  const everyKey = (v, out = new Set()) => { if (Array.isArray(v)) v.forEach((x) => everyKey(x, out)); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); everyKey(x, out); } return out; };
  // the tool names in shell.tools and shell.deny are keys that are data, not part of the shape
  const free = new Set(["Bash", "PowerShell"]);
  for (const [command, found] of Object.entries(docs)) {
    const words = [...entries[command].matchAll(/([A-Za-z][A-Za-z0-9]*)(\?)?/g)];
    const named = new Set(words.map((x) => x[1]));
    const anywhere = new Set(found.flatMap((d) => [...everyKey(d)]));
    for (const k of anywhere) if (!free.has(k)) assert.ok(named.has(k), `${command}: the field "${k}" is in a document and not in the README shape`);
    for (const [, name, optional] of words) {
      if (name === command || free.has(name) || ["claude", "codex", "gemini", "copilot", "cursor", "windows", "wsl"].includes(name) && !anywhere.has(name) && optional) continue;
      if (!optional && !["claude", "codex", "gemini", "copilot", "cursor"].includes(name)) assert.ok(anywhere.has(name), `${command}: the README names the field "${name}", which no document has (mark it with ? if it is optional)`);
    }
  }
});

// ---- the examples ------------------------------------------------------------------------------------------------------------------------

const tokens = (line) => [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => (m[1] !== undefined ? m[1] : m[2]));
const fences = [...readme.matchAll(/```text\n\$ (agent-windows-doctor [^\n]+)\n([\s\S]*?)\n```/g)].map((m) => ({ command: m[1], text: m[2] }));

test("every example command parses with the CLI's own parser, and the examples are what the code prints or what a real run printed and the code still recognises", async () => {
  assert.ok(fences.length >= 5, `${fences.length} examples`);
  for (const b of fences) assert.doesNotThrow(() => parseArgs(tokens(b.command).slice(1)), b.command);
  const by = (prefix) => fences.find((b) => b.command.startsWith(prefix));
  // explain prints no fact of the machine: what the README shows is exactly what the code prints
  const ex = by("agent-windows-doctor explain ");
  assert.ok(ex);
  const printed = (await run(["explain", tokens(ex.command)[2]], { sys: winMachine() })).out;
  assert.equal(printed.trimEnd(), ex.text, "the explain example is out of date: paste the output of the command");
  // the check example: the sections in order, the version, the findings of the code with the basis of their pages, and the totals
  const check = by("agent-windows-doctor check --agent codex");
  const lines = check.text.split("\n");
  assert.equal(lines[0], `agent-windows-doctor ${VERSION}  what the coding agents get on this Windows machine`);
  let at = -1;
  for (const h of ["The machine", "Every agent on this machine", "The shell each agent gives the model", "Hooks on Windows", "Codex on Windows", "Findings"]) {
    const i = lines.indexOf(h);
    assert.ok(i > at, `${h} is there, after the one before it`);
    at = i;
  }
  const found = [...check.text.matchAll(/^ {2}(error|warning|note) {1,4}([a-z]+\.[a-z0-9-]+) {3}\[(verified|documented|not verified)\]$/gm)];
  assert.ok(found.length >= 3);
  for (const [, severity, id, basis] of found) {
    assert.ok(FINDING_IDS.includes(id), id);
    assert.ok(FINDING_SEVERITY[id].includes(severity), `${id} is ${severity}`);
    assert.equal(basis, pageFor(id).basis, `${id}: the basis of its page`);
  }
  assert.deepEqual([...check.text.matchAll(/^ {6}more: agent-windows-doctor explain (\S+)$/gm)].map((m) => m[1]), found.map((m) => m[2]));
  const count = (s) => found.filter((m) => m[1] === s).length;
  assert.ok(check.text.endsWith(`${count("error")} errors, ${count("warning")} warnings, ${count("note")} notes`));
  // the live excerpt: one line for each agent
  const live = by("agent-windows-doctor check --live");
  assert.deepEqual([...live.text.matchAll(/proved with the real (\w+) (\d+\.\d+\.\d+) \(/g)].map((m) => m[1]), ["claude", "codex", "gemini", "copilot"]);
  assert.ok(live.text.startsWith("Live: the real binaries, through a fake API on 127.0.0.1 (no token spent)"));
  // the markdown example
  const md = by("agent-windows-doctor check --markdown");
  const mdLines = md.text.split("\n");
  assert.match(mdLines[0], /^## agent-windows-doctor check: /);
  for (const l of mdLines) assert.ok(l.length <= MARKDOWN_LINE, `${l.length} characters in a line`);
  const items = mdLines.filter((l) => /^- (ERROR|WARNING) `/.test(l));
  assert.ok(items.length <= MARKDOWN_MAX_FINDINGS);
  for (const l of items) { const id = /`([^`]+)`/.exec(l)[1]; assert.ok(FINDING_IDS.includes(id), id); assert.ok(FINDING_SEVERITY[id].includes(l.startsWith("- ERROR") ? "error" : "warning"), `${id}: the severity of the line`); }
  assert.ok(readme.includes(`The example below is ${md.text.length.toLocaleString("en-US")} characters`), `the markdown example is ${md.text.length} characters`);
  // the inventory example
  const agents = by("agent-windows-doctor agents");
  assert.equal(agents.text.split("\n")[0], `agent-windows-doctor ${VERSION}  every agent on this machine`);
  for (const label of ["Claude Code", "Codex CLI", "Gemini CLI", "GitHub Copilot CLI", "Cursor"]) assert.ok(agents.text.includes(`\n  ${label}\n`), label);
});

// ---- the files ---------------------------------------------------------------------------------------------------------------------------

test("the Files table of the README names every source file and every helper file of the tests, and every file it names is there", () => {
  const files = section("## Files", "## Contributing");
  assert.ok(files.length > 500, "the section is there");
  for (const f of [...list("src", ".mjs"), ...list("bin", ".mjs")]) assert.ok(files.includes(`\`${posix(f)}\``), `${f} is in the Files table`);
  for (const f of list("test", ".mjs").filter((n) => !n.endsWith(".test.mjs"))) assert.ok(files.includes(`\`${path.basename(f)}\``), `${f} is named in the Files table`);
  for (const f of list("test", ".test.mjs").filter((n) => /^(e2e-[a-z]+|windows|repo|readme)\.test\.mjs$/.test(path.basename(n)))) assert.ok(files.includes(`\`${path.basename(f)}\``), `${f} is named in the Files table`);
  for (const m of files.matchAll(/`((?:src|bin|test|\.github)\/[^`\s]*)`/g)) assert.ok(exists(m[1].replace(/\/$/, "")), `${m[1]} is named in the Files table and exists`);
  for (const m of files.matchAll(/`([A-Z_]+\.md|LICENSE)`/g)) assert.ok(exists(m[1]), `${m[1]} is named in the Files table and exists`);
  assert.ok(files.includes("claude-windows-doctor") && files.includes("codex-config-doctor"), "the Files table says where the copied files came from");
});

test("what the README says it verified is what the test files do: every real-binary file it names exists, and the guard it describes is the one in the code", () => {
  const verified = section("## What was verified, and how", "## Not verified");
  for (const m of verified.matchAll(/`(test\/[\w.-]+\.mjs)`/g)) assert.ok(exists(m[1]), `${m[1]} is named and exists`);
  for (const w of ["HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "CODEX_HOME", "COPILOT_HOME", "CLAUDE_CONFIG_DIR", "GEMINI_CLI_HOME"]) assert.ok(readme.includes(`\`${w}\``), `the README names ${w}`);
  const guard = read("src/live.mjs");
  for (const w of ["HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "CODEX_HOME", "COPILOT_HOME", "CLAUDE_CONFIG_DIR", "GEMINI_CLI_HOME"]) assert.ok(guard.includes(`"${w}"`), `the guard checks ${w}`);
  for (const w of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"]) assert.ok(guard.includes(`"${w}"`) && readme.includes(`\`${w}\``), w);
  assert.ok(guard.includes('"127.0.0.1,localhost"') && readme.includes("NO_PROXY=127.0.0.1,localhost"));
});
