// The command line: the options and every usage error, the exit codes (0 clean, 1 findings, 2 usage), the three commands on a pretend Windows, Linux, macOS and WSL machine,
// --json on every command, and --live with stand-ins for the runs.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { run, runCli, world } from "./helpers.mjs";
import { fakeMachine } from "./machine.mjs";
import { HOME, npmInstall, winMachine, withNpm } from "./win-machine.mjs";
import { HELP, parseArgs } from "../src/cli.mjs";
import { VERSION } from "../src/version.mjs";
import { IDS, PAGES } from "../src/explain.mjs";

const usage = (argv) => { try { parseArgs(argv); } catch (e) { return e.message; } return null; };
const four = (o = {}) => winMachine(withNpm(o, ["claude", "codex", "gemini", "copilot"]));

test("parseArgs: the commands, the flags, the values, and the defaults", () => {
  const o = parseArgs(["check", "--project", "C:\\p", "--agent", "codex,claude", "--json"]);
  assert.deepEqual([o.command, o.project, o.agent, o.json, o.markdown, o.live], ["check", "C:\\p", "codex,claude", true, false, false], "the names are lower-cased and kept as given");
  assert.equal(parseArgs(["check", "--agent=all"]).agent, "all");
  assert.equal(parseArgs(["check"]).agent, undefined);
  assert.deepEqual(parseArgs(["explain", "--list"]).list, true);
  assert.equal(parseArgs(["explain", "claude.long-paths"]).id, "claude.long-paths");
  assert.equal(parseArgs(["agents", "--json"]).command, "agents");
  const live = parseArgs(["check", "--live", "--claude", "C:\\c\\claude.exe", "--codex=C:\\x\\codex.cmd", "--gemini", "g", "--copilot", "p"]);
  assert.deepEqual([live.claude, live.codex, live.gemini, live.copilot], ["C:\\c\\claude.exe", "C:\\x\\codex.cmd", "g", "p"]);
  assert.equal(parseArgs(["-h"]).help, true);
  assert.equal(parseArgs(["--version"]).version, true);
  assert.equal(parseArgs(["check", "--project", "--odd-folder"]).project, "--odd-folder", "a project folder may start with dashes");
});

test("parseArgs: every usage error says what is wrong", () => {
  assert.equal(usage([]), "no command given");
  assert.equal(usage(["nope"]), 'unknown command "nope"');
  assert.equal(usage(["check", "--nope"]), "unknown option --nope");
  assert.equal(usage(["check", "--project"]), "--project needs a value");
  assert.equal(usage(["check", "--agent"]), "--agent needs a value");
  assert.equal(usage(["check", "--agent", "--json"]), "--agent needs a value");
  assert.match(usage(["check", "--agent", "bard"]), /--agent names "bard", which is not an agent: use claude, codex, gemini, copilot, cursor or all/);
  assert.match(usage(["check", "--agent", "all,codex"]), /--agent all stands alone/);
  assert.match(usage(["check", "--agent", ","]), /--agent names no agent/);
  assert.equal(usage(["check", "--codex", "x"]), "--codex is for --live: it names the codex to run");
  assert.equal(usage(["check", "--claude", "x"]), "--claude is for --live: it names the claude to run");
  assert.equal(usage(["check", "--markdown", "--live"]), "--markdown is the short report to paste and does not run --live");
  assert.equal(usage(["explain"]), "explain needs a finding id or --list (for example claude.git-bash-not-found)");
  assert.equal(usage(["explain", "a", "b"]), 'explain takes one finding id, not "a b"');
  assert.equal(usage(["explain", "--list", "a"]), "explain takes --list or one finding id, not both");
  assert.equal(usage(["agents", "extra"]), 'agents takes no name, not "extra"');
  assert.equal(usage(["agents", "--live"]), "agents does not take --live");
  assert.equal(usage(["explain", "--markdown", "x"]), "explain does not take --markdown");
  assert.equal(usage(["check", "x"]), 'check takes no name, not "x"');
});

test("--help and --version: exit 0, on stdout", async () => {
  const h = await run(["--help"]);
  assert.deepEqual([h.code, h.out, h.err], [0, HELP, ""]);
  assert.match(HELP, /^Usage: agent-windows-doctor <command> \[options\]\n/);
  for (const w of ["check", "agents", "explain", "--agent", "--live", "--markdown", "--json", "--claude", "--codex", "--gemini", "--copilot", "Exit codes: 0 ok; 1 findings"]) assert.ok(HELP.includes(w), w);
  assert.ok(!HELP.includes("--dry-run") && !/\bfix\b.*--git-bash/.test(HELP), "the tool changes nothing: no fix, no undo");
  const v = await run(["-v"]);
  assert.deepEqual([v.code, v.out], [0, `agent-windows-doctor ${VERSION}\n`]);
});

test("a usage error exits 2, on stderr, with a pointer to --help; with --json it is a document", async () => {
  const r = await run(["check", "--agent", "nope"], { sys: winMachine() });
  assert.equal(r.code, 2);
  assert.match(r.err, /^agent-windows-doctor: --agent names "nope"/);
  assert.match(r.err, /Run agent-windows-doctor --help for the commands\.\n$/);
  const j = await run(["check", "--bogus", "--json"], { sys: winMachine() });
  assert.equal(j.code, 2);
  assert.deepEqual(j.json(), { ok: false, error: "unknown option --bogus" });
});

test("check: exit 0 with no finding, 1 with a warning or an error, and a note alone is exit 0; --json prints the same facts", async () => {
  const clean = await run(["check"], { sys: winMachine() });
  assert.equal(clean.code, 0);
  assert.match(clean.out, /No findings\.\n$/);
  const notes = await run(["check", "--json"], { sys: four() });
  assert.equal(notes.code, 0, "notes only");
  assert.deepEqual(notes.json().counts, { error: 0, warning: 0, note: 1 });
  const warn = await run(["check", "--json"], { sys: four({ noGit: true, files: ["E:\\Das\\Git\\cmd\\git.exe", "E:\\Das\\Git\\mingw64\\bin\\git.exe", "E:\\Das\\Git\\bin\\bash.exe"], env: { Path: `${HOME}\\AppData\\Roaming\\npm;E:\\Das\\Git\\mingw64\\bin;C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\WindowsPowerShell\\v1.0` } }) });
  assert.equal(warn.code, 1);
  assert.equal(warn.json().ok, false);
  assert.equal(warn.json().findings[0].id, "claude.git-bash-not-found");
  const err = await run(["check"], { sys: four({ noGit: true, env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } }) });
  assert.equal(err.code, 1);
});

test("check --agent: only the agents named are reported, found or not; an agent not named is not looked at", async () => {
  const sys = four();
  const only = (await run(["check", "--agent", "codex", "--json"], { sys })).json();
  assert.deepEqual(only.agents, ["codex"]);
  assert.deepEqual(Object.keys(only.inventory), ["codex"]);
  assert.deepEqual(Object.keys(only.shells), ["codex"]);
  const forced = (await run(["check", "--agent", "cursor", "--json"], { sys })).json();
  assert.deepEqual(forced.agents, ["cursor"], "named, so reported although it is not found");
  assert.deepEqual(forced.inventory.cursor.entries, []);
  const all = (await run(["check", "--agent", "all", "--json"], { sys })).json();
  assert.deepEqual(all.agents, ["claude", "codex", "gemini", "copilot"], "all: the ones that are found");
});

test("check --markdown always exits 0, whatever it found, and prints the short report", async () => {
  const r = await run(["check", "--markdown"], { sys: four({ noGit: true, env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } }) });
  assert.equal(r.code, 0);
  assert.match(r.out, /^## agent-windows-doctor check: /);
  assert.match(r.out, /- ERROR `claude\.no-shell-tool`: /);
  assert.equal(r.err, "");
});

test("check on Linux and macOS says there is nothing to check and exits 0, with --live as well: there is nothing to prove", async () => {
  for (const platform of ["linux", "darwin"]) {
    const sys = fakeMachine({ platform });
    const r = await run(["check"], { sys });
    assert.equal(r.code, 0);
    assert.match(r.out, new RegExp(`Nothing to check on ${platform === "linux" ? "Linux" : "macOS"}:`));
    assert.deepEqual((await run(["check", "--json"], { sys })).json().applicable, false);
    assert.match((await run(["check", "--markdown"], { sys })).out, /^## agent-windows-doctor check\nNothing to check/);
    const live = await run(["check", "--live"], { sys });
    assert.equal(live.code, 0);
    assert.equal(live.out, r.out, "the answer with --live is the answer without it");
    assert.equal(live.err, "");
    assert.deepEqual((await run(["check", "--live", "--json"], { sys })).json(), (await run(["check", "--json"], { sys })).json());
    assert.equal((await run(["agents"], { sys })).code, 0);
    assert.equal((await run(["agents", "--json"], { sys })).json().applicable, false);
  }
});

test("inside WSL the WSL side is checked, and --live is refused", async () => {
  const sys = fakeMachine({ platform: "linux", env: { PATH: "/mnt/c/Users/me/.local/bin:/usr/bin" }, home: "/home/me", cwd: "/home/me/code", files: ["/mnt/c/Users/me/.local/bin/claude"], texts: { "/proc/version": "Linux version 5.15-microsoft-standard-WSL2" } });
  const r = await run(["check", "--json"], { sys });
  assert.equal(r.code, 1, "a Windows claude in WSL is a warning");
  assert.equal(r.json().kind, "wsl");
  const live = await run(["check", "--live"], { sys });
  assert.equal(live.code, 1);
  assert.match(live.err, /works on Windows only/);
});

test("agents: the programs of each agent alone, exit 0, text and JSON", async () => {
  const sys = four();
  const text = await run(["agents"], { sys });
  assert.equal(text.code, 0);
  assert.match(text.out, /every agent on this machine\n\n {2}Claude Code\n {4}1 {2}C:\\Users\\me\\AppData\\Roaming\\npm\\claude\.cmd/);
  assert.match(text.out, /\n {2}Cursor\n {4}none found/);
  const j = (await run(["agents", "--json"], { sys })).json();
  assert.equal(j.firsts.gemini, "C:\\Users\\me\\AppData\\Roaming\\npm\\gemini.cmd");
  assert.deepEqual(Object.keys(j.inventory), ["claude", "codex", "gemini", "copilot", "cursor"]);
  const one = (await run(["agents", "--agent", "copilot", "--json"], { sys })).json();
  assert.deepEqual(one.agents, ["copilot"]);
  assert.equal(one.inventory.copilot.entries[0].version, "1.0.98");
});

test("explain: a page by id, the list, and what an id that is not one gets (exit 1, with the nearest ids)", async () => {
  const p = await run(["explain", "codex.sandbox-none"]);
  assert.equal(p.code, 0);
  assert.match(p.out, /^codex\.sandbox-none {3}Codex has no Windows sandbox selected/);
  assert.equal((await run(["explain", "CODEX.SANDBOX-NONE", "--json"])).json().id, "codex.sandbox-none");
  const list = await run(["explain", "--list"]);
  assert.equal(list.out.trim().split("\n").length, IDS.length);
  assert.equal((await run(["explain", "--list", "--json"])).json().findings.length, IDS.length);
  // unique part: shell-path matches codex.shell-path-ignored; sandbox matches codex.sandbox-none
  const part = await run(["explain", "shell-path"]);
  assert.equal(part.code, 0);
  assert.match(part.out, /^codex\.shell-path-ignored /);
  assert.equal((await run(["explain", "shell-path", "--json"])).json().id, "codex.shell-path-ignored");
  const part2 = await run(["explain", "sandbox"]);
  assert.equal(part2.code, 0);
  assert.match(part2.out, /^codex\.sandbox-none /);
  // ambiguous part: hook-bash matches several ids, exits 1, lists all matching ids in page order
  const ambig = await run(["explain", "hook-bash"]);
  assert.equal(ambig.code, 1);
  assert.equal(ambig.out, "");
  assert.equal(ambig.err, 'agent-windows-doctor: "hook-bash" is a part of 6 finding ids: claude.hook-bash-syntax, codex.hook-bash-syntax, gemini.hook-bash-syntax, copilot.hook-bash-only, copilot.hook-bash-syntax, cursor.hook-bash-syntax. Give one of them.\n');
  const ambigJson = (await run(["explain", "hook-bash", "--json"])).json();
  assert.equal(ambigJson.ok, false);
  assert.equal(ambigJson.refused, '"hook-bash" is a part of 6 finding ids');
  assert.deepEqual(ambigJson.ids, ["claude.hook-bash-syntax", "codex.hook-bash-syntax", "gemini.hook-bash-syntax", "copilot.hook-bash-only", "copilot.hook-bash-syntax", "cursor.hook-bash-syntax"]);
  assert.deepEqual(ambigJson.near, []);
  // ambiguous part in more than five ids: "." matches every id
  const dot = await run(["explain", "."]);
  assert.equal(dot.code, 1);
  assert.match(dot.err, /^agent-windows-doctor: "\." is a part of 77 finding ids: /);
  const dotJson = (await run(["explain", ".", "--json"])).json();
  assert.equal(dotJson.ok, false);
  assert.equal(dotJson.refused, '"." is a part of 77 finding ids');
  assert.deepEqual(dotJson.ids, IDS);
  assert.deepEqual(dotJson.near, []);
  // part that matches nothing: exit 1, no near match
  const bad = await run(["explain", "nosuch"]);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /^agent-windows-doctor: no finding called "nosuch"\.\nThe ids: /);
  const badJson = (await run(["explain", "nosuch", "--json"])).json();
  assert.deepEqual([badJson.ok, badJson.refused, badJson.ids.length, badJson.near], [false, 'no finding called "nosuch"', IDS.length, []]);
  // exact id always wins, even when it is also a part of other ids
  const extra = { id: "codex.shell-path-ignored-extra", title: "Extra", means: "Means ".repeat(10), does: ["V: line"], fix: ["fix line"], basis: "verified", issues: [] };
  PAGES.push(extra);
  IDS.push(extra.id);
  try {
    const exact = await run(["explain", "codex.shell-path-ignored"]);
    assert.equal(exact.code, 0);
    assert.match(exact.out, /^codex\.shell-path-ignored /);
  } finally {
    PAGES.pop();
    IDS.pop();
  }
});

// ---- --live, with stand-ins for the runs ---------------------------------------------------------------------------------------------

const claudeRun = (o = {}) => async () => ({ ran: true, exitCode: 0, timedOut: false, requests: 1, tools: ["Bash", "Read"], shellTools: ["Bash"], edition: null, using: "C:\\Program Files\\Git\\bin\\bash.exe", warning: null, notFound: false, stderr: "", cwd: "C:\\Temp\\adw-test", ...o });
const shellRun = (program, o = {}) => async () => ({ ran: true, exitCode: 0, timedOut: false, requests: 2, line: program ? `"${program}" -Command x` : null, program, error: null, stderr: "", ...o });

test("check --live: every agent found is run through its stand-in, compared with the prediction, and the report says proved", async () => {
  const sys = four();
  const tmp = "C:\\Temp\\adw-test";
  const r = await run(["check", "--live", "--json"], { sys, tempDir: tmp, liveRunner: {
    claude: claudeRun(),
    codex: shellRun("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"),
    gemini: shellRun("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"),
    copilot: shellRun("powershell.exe"),
  } });
  assert.equal(r.code, 0, r.out);
  const live = r.json().live;
  assert.equal(live.ok, true);
  assert.deepEqual(Object.keys(live.agents), ["claude", "codex", "gemini", "copilot"]);
  assert.ok(Object.values(live.agents).every((a) => a.ok && a.proved), JSON.stringify(live));
  assert.equal(live.agents.codex.binary.path, "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd");
  assert.equal(live.agents.codex.binary.version, "0.163.0");
  const text = (await run(["check", "--live"], { sys, tempDir: tmp, liveRunner: { claude: claudeRun(), codex: shellRun("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"), gemini: shellRun("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"), copilot: shellRun("powershell.exe") } })).out;
  assert.match(text, /\nLive: the real binaries, through a fake API on 127\.0\.0\.1 \(no token spent\)\n {2}Claude Code {10}proved with the real claude 2\.1\.302 \(/);
  assert.match(text, /\n {2}Codex CLI {12}proved with the real codex 0\.163\.0 \(C:\\Users\\me\\AppData\\Roaming\\npm\\codex\.cmd; the first on PATH\):\n/);
  assert.match(text, /the shell command ran in C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe; predicted: C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe/);
});

test("check --live: a run that does not match the prediction is said, with the difference, and the exit code is 1", async () => {
  const sys = four();
  const r = await run(["check", "--live", "--json", "--agent", "codex"], { sys, tempDir: "C:\\Temp\\adw-test", liveRunner: { codex: shellRun("C:\\Program Files\\PowerShell\\7\\pwsh.exe") } });
  assert.equal(r.code, 1);
  const a = r.json().live.agents.codex;
  assert.equal(a.proved, false);
  assert.match(a.differences[0], /the binary started C:\\Program Files\\PowerShell\\7\\pwsh\.exe; the prediction was C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe/);
  const err = await run(["check", "--live", "--json", "--agent", "gemini"], { sys, tempDir: "C:\\Temp\\adw-test", liveRunner: { gemini: shellRun(null, { error: "spawn powershell.exe ENOENT" }) } });
  assert.match(err.json().live.agents.gemini.differences[0], /answered with an error \(spawn powershell\.exe ENOENT\)/);
  const claude = await run(["check", "--live", "--json", "--agent", "claude"], { sys, tempDir: "C:\\Temp\\adw-test", liveRunner: { claude: claudeRun({ shellTools: ["PowerShell"], tools: ["PowerShell"], using: null }) } });
  assert.equal(claude.code, 1);
  assert.match(claude.json().live.agents.claude.differences[0], /the binary listed PowerShell; the prediction was Bash/);
});

test("check --live: an agent that is not on the machine is skipped and does not fail the run; a path that is named and is not a file does", async () => {
  const sys = winMachine(withNpm({}, ["codex"]));
  const ok = await run(["check", "--live", "--json"], { sys, tempDir: "C:\\Temp\\adw-test", liveRunner: { codex: shellRun("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe") } });
  assert.equal(ok.code, 0);
  assert.deepEqual(Object.keys(ok.json().live.agents), ["codex"], "only the agents found are run");
  const named = await run(["check", "--live", "--json", "--agent", "gemini", "--gemini", "C:\\nope\\gemini.cmd"], { sys, tempDir: "C:\\Temp\\adw-test" });
  assert.equal(named.code, 1);
  assert.match(named.json().live.agents.gemini.error, /nope.gemini\.cmd is not a file/);
  const missing = await run(["check", "--live", "--json", "--agent", "gemini"], { sys, tempDir: "C:\\Temp\\adw-test" });
  assert.equal(missing.code, 0, "an agent asked for and not found has nothing to prove");
  assert.match(missing.json().live.agents.gemini.skipped, /not found on this machine/);
  const cursor = await run(["check", "--live", "--json", "--agent", "cursor"], { sys, tempDir: "C:\\Temp\\adw-test" });
  assert.match(cursor.json().live.agents.cursor.skipped, /needs a login/);
});

test("check --live uses the path an option names, over the first on PATH", async () => {
  const i = npmInstall("codex", { prefix: "D:\\other" });
  const sys = winMachine(withNpm({ files: i.files, texts: i.texts }, ["codex"]));
  const r = await run(["check", "--live", "--json", "--agent", "codex", "--codex", "D:\\other\\codex.cmd"], { sys, tempDir: "C:\\Temp\\adw-test", liveRunner: { codex: shellRun("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe") } });
  assert.equal(r.json().live.agents.codex.binary.path, "D:\\other\\codex.cmd");
  assert.equal(r.json().live.agents.codex.binary.source, "named with the option");
});

// ---- a child process ------------------------------------------------------------------------------------------------------------------

test("the real command line in a child process: --version, --help, a usage error and explain, with a throwaway home", () => {
  const w = world("cli");
  const v = runCli(["--version"], { cwd: w.work, env: w.env });
  assert.deepEqual([v.code, v.out], [0, `agent-windows-doctor ${VERSION}\n`]);
  assert.equal(runCli(["--help"], { cwd: w.work, env: w.env }).out, HELP);
  const bad = runCli(["check", "--nope"], { cwd: w.work, env: w.env });
  assert.equal(bad.code, 2);
  assert.match(bad.err, /unknown option --nope/);
  const e = runCli(["explain", "claude.long-paths", "--json"], { cwd: w.work, env: w.env });
  assert.equal(JSON.parse(e.out).id, "claude.long-paths");
  const partChild = runCli(["explain", "shell-path", "--json"], { cwd: w.work, env: w.env });
  assert.equal(JSON.parse(partChild.out).id, "codex.shell-path-ignored");
  const pipe = runCli(["explain", "--list"], { cwd: w.work, env: w.env });
  assert.equal(pipe.code, 0);
});
