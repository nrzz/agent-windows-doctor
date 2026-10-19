// The repository itself: what it says it is, what it imports, which Node it needs, that only the places that must start a program, open a connection or write a file do, that no real agent binary
// is started outside the guard, that no file has a carriage return, that the community files and the workflows are there and say what they promise, and that the version is the same everywhere.
// (test/readme.test.mjs holds the README to the code.)
import { ROOT } from "./helpers.mjs";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { VERSION } from "../src/version.mjs";

// a checkout on Windows may turn line feeds into CRLF
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const json = (rel) => JSON.parse(read(rel));
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const files = (dir, ext) => fs.readdirSync(path.join(ROOT, dir)).filter((n) => n.endsWith(ext)).map((n) => path.join(dir, n));
const posix = (f) => f.split(path.sep).join("/");

const pkg = json("package.json");
const SOURCES = [...files("src", ".mjs"), ...files("bin", ".mjs")];
const TESTS = files("test", ".mjs");

test("package.json: name, version, bin, engines, no dependencies, tests run with node --test, the files that are shipped", () => {
  assert.equal(pkg.name, "agent-windows-doctor");
  assert.equal(pkg.version, VERSION);
  assert.equal(pkg.type, "module");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.private, undefined);
  assert.deepEqual(pkg.bin, { "agent-windows-doctor": "bin/agent-windows-doctor.mjs" });
  assert.equal(pkg.engines.node, ">=18");
  for (const k of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) assert.equal(pkg[k], undefined, k);
  assert.equal(pkg.scripts.test, "node --test");
  assert.deepEqual(pkg.files, ["bin", "src", "README.md", "LICENSE"]);
  for (const f of pkg.files) assert.ok(exists(f), `${f} is listed and exists`);
  assert.match(pkg.description, /^What Claude Code, Codex CLI, Gemini CLI, GitHub Copilot CLI and Cursor each get on Windows and why/);
  assert.match(pkg.description, /Zero tokens\.$/);
  assert.equal(pkg.repository, "github:nrzz/agent-windows-doctor");
  assert.equal(pkg.homepage, "https://nrzz.github.io/claude-code-toolkit/");
  assert.equal(pkg.bugs, "https://github.com/nrzz/agent-windows-doctor/issues");
  assert.equal(pkg.author, "Naresh Prabu");
  for (const k of ["windows", "powershell", "git-bash", "wsl", "claude-code", "codex", "openai-codex", "gemini-cli", "github-copilot", "copilot-cli", "cursor", "doctor", "diagnostics", "cli", "nodejs", "zero-dependency", "developer-tools", "agentic-coding", "ai-coding", "coding-agents"]) assert.ok(pkg.keywords.includes(k), k);
  assert.equal(read("bin/agent-windows-doctor.mjs").split("\n").filter(Boolean).length < 15, true, "a thin entry that calls src/cli.mjs");
});

test("no lock file, no vendored node_modules, no .gitattributes, no plugin and no skill", () => {
  assert.ok(!exists("package-lock.json"));
  assert.ok(!exists("npm-shrinkwrap.json"));
  assert.ok(!exists("yarn.lock"));
  assert.ok(!exists("node_modules") || fs.readdirSync(path.join(ROOT, "node_modules")).length === 0);
  assert.ok(!exists(".gitattributes"));
  assert.ok(!exists(".claude-plugin") && !exists("skills") && !exists("hooks") && !exists("agents") && !exists("commands") && !exists(".mcp.json"), "a command line tool: no plugin, no skill, no hook");
  assert.match(read(".gitignore"), /^node_modules\/$/m);
});

test("no tracked text file has a carriage return: every file is written with LF (the index is read, a checkout on Windows may differ)", { skip: !exists(".git") && "not a git checkout" }, () => {
  const ls = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "buffer", windowsHide: true });
  assert.equal(ls.status, 0, String(ls.stderr));
  const tracked = ls.stdout.toString("utf8").split("\0").filter(Boolean);
  assert.ok(tracked.length > 30, `${tracked.length} tracked files`);
  const withCr = [];
  for (const f of tracked) {
    if (/\.(png|ico|jpg|gif|woff2?)$/i.test(f)) continue;
    const blob = spawnSync("git", ["show", `:${f}`], { cwd: ROOT, encoding: "buffer", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    if (blob.status === 0 && blob.stdout.includes(13)) withCr.push(f);
  }
  assert.deepEqual(withCr, [], "files that hold a carriage return in the index");
});

test("every source file is .mjs and imports only node built-ins and the package itself", () => {
  assert.ok(SOURCES.length >= 25);
  assert.deepEqual(fs.readdirSync(path.join(ROOT, "src")).filter((n) => !n.endsWith(".mjs")), []);
  const allowed = new Set(["node:child_process", "node:fs", "node:http", "node:os", "node:path"]);
  for (const f of SOURCES) {
    const text = read(f);
    for (const m of text.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gms)) {
      const spec = m[1];
      assert.ok(spec.startsWith("./") || spec.startsWith("../") || allowed.has(spec), `${f} imports ${spec}`);
    }
    assert.doesNotMatch(text, /\brequire\(|\bimport\(/, `${f} has no dynamic loading`);
  }
  // the tests too: node: built-ins and the files of the repository
  for (const f of TESTS) {
    for (const m of read(f).matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gms)) assert.ok(m[1].startsWith("./") || m[1].startsWith("../") || m[1].startsWith("node:"), `${f} imports ${m[1]}`);
  }
});

test("only src/sys.mjs and src/live.mjs start a program, only src/live.mjs opens a connection (to 127.0.0.1), and nothing can run code that was not written here", () => {
  const startsProcess = /node:child_process|(?<![.\w])(spawn|spawnSync|execSync|execFile|execFileSync|fork)\s*\(/;
  const opensConnection = /node:(http|https|http2|net|tls|dns|dgram)\b|(?<![.\w])(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/;
  const runsCode = /node:(worker_threads|cluster|vm)\b|\bprocess\.binding\b|\beval\s*\(|new Function\s*\(/;
  for (const f of SOURCES) {
    const name = posix(f);
    const text = read(f);
    if (name !== "src/sys.mjs" && name !== "src/live.mjs") assert.doesNotMatch(text, startsProcess, `${name} must not start a program: only src/sys.mjs and src/live.mjs do`);
    if (name !== "src/live.mjs") assert.doesNotMatch(text, opensConnection, `${name} must not open a connection: only src/live.mjs does`);
    assert.doesNotMatch(text, runsCode, name);
  }
  const live = read("src/live.mjs");
  assert.match(live, /node:http/);
  assert.match(live, /server\.listen\(0, "127\.0\.0\.1"/, "the fake API listens on the loopback address only");
  assert.doesNotMatch(live, /http\.(request|get)\(|https?:\/\/(?!127\.0\.0\.1|\$\{)/, "live.mjs makes no request of its own and names no other host");
  assert.match(read("src/sys.mjs"), /node:child_process/);
  assert.doesNotMatch(read("src/sys.mjs"), /node:(http|https|net)/);
});

test("only src/write.mjs writes a file, and it writes the throwaway folders of check --live: nothing else calls a function that changes a file, and nothing reads a real home from it", () => {
  const writes = /\b(?:writeFile|appendFile|copyFile|rename|unlink|rmdir|rm|mkdir|mkdtemp|truncate|symlink|link|chmod|utimes)(?:Sync)?\s*\(|\bcreateWriteStream\b|\bfs\.promises\b/;
  for (const f of SOURCES) {
    const name = posix(f);
    const text = read(f);
    if (name !== "src/write.mjs") assert.doesNotMatch(text, writes, `${f} must not write: only src/write.mjs does`);
    if (name !== "src/sys.mjs" && name !== "src/write.mjs") assert.doesNotMatch(text, /node:fs/, `${f} must read through sys: only src/sys.mjs and src/write.mjs import node:fs`);
  }
  const w = read("src/write.mjs");
  assert.doesNotMatch(w.split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n"), /homedir|process\.env|userInfo/, "write.mjs is given the folder it works in and asks the machine for nothing");
  assert.match(w, /startsWith\("adw-"\)/, "it removes only the folders it made");
  assert.doesNotMatch(read("src/sys.mjs"), /writeFile|appendFile|mkdir|rmSync|unlink/, "sys.mjs reads");
});

test("the registry is only read: the code that starts programs never starts reg with add, delete or import, setx, Set-ExecutionPolicy or git config with a value", () => {
  // (the explain pages and the fixes advise `reg add` and `setx` in words; only the files that call sys.run are looked at, and only their code)
  const writesMachine = /\breg(?:\.exe)?\b[^\n]{0,40}\b(add|delete|import|copy|save|restore|load|unload)\b|\bsetx\b|Set-ExecutionPolicy|Set-ItemProperty|New-ItemProperty|git["'`]?\s*,\s*\[\s*["'`]config["'`]\s*,\s*["'`]--(?:global|system|unset|add|replace-all|edit)/i;
  const runners = SOURCES.filter((f) => /\.run\(/.test(read(f)));
  assert.ok(runners.length >= 6, `${runners.length} files start programs through sys.run`);
  for (const f of runners) {
    const text = read(f).split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
    assert.doesNotMatch(text, writesMachine, `${f} could write the machine`);
  }
  // the reading is in one place, through reg query
  const calls = [...read("src/winenv.mjs").matchAll(/reg(?:\.exe)? query/gi)];
  assert.ok(calls.length >= 1, "winenv.mjs reads through reg query");
  assert.match(read("src/winenv.mjs"), /REAL_KEY = "HKCU\\\\Environment"/);
});

test("Windows paths are handled with path.win32 and the helpers of src/winpath.mjs only: no path.resolve and no process.cwd in the Windows logic", () => {
  const windowsLogic = ["claude-shell.mjs", "gitbash.mjs", "claude-settings.mjs", "facts.mjs", "wsl.mjs", "userenv.mjs", "inventory.mjs", "versions.mjs", "hooks.mjs", "shells.mjs", "codexwin.mjs", "agentfacts.mjs", "machine.mjs", "psprobe.mjs", "winenv.mjs"];
  for (const f of windowsLogic) {
    const text = read(`src/${f}`);
    assert.doesNotMatch(text, /path\.resolve\(|process\.cwd\(|os\.homedir\(/, `${f} must ask sys for the working folder and the home folder, and must not use the host's path.resolve`);
  }
});

test("only APIs that exist in Node 18 are used", () => {
  const newer = [
    [/\.toSorted\(|\.toReversed\(|\.toSpliced\(|\.with\(\d/, "Array copy-methods (Node 20)"],
    [/\bObject\.groupBy\b|\bMap\.groupBy\b/, "groupBy (Node 21)"],
    [/\bArray\.fromAsync\b/, "Array.fromAsync (Node 22)"],
    [/\bPromise\.withResolvers\b/, "Promise.withResolvers (Node 22)"],
    [/import\.meta\.(dirname|filename)\b/, "import.meta.dirname/filename (Node 20.11)"],
    [/\bfs\.(glob|globSync)\b/, "fs.glob (Node 22)"],
    [/\.(isWellFormed|toWellFormed)\(/, "String well-formed methods (Node 20)"],
    [/\.(union|intersection|difference|symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom)\(/, "Set methods (Node 22)"],
    [/process\.getBuiltinModule|process\.loadEnvFile|util\.styleText|\bstyleText\b/, "newer process/util APIs"],
    [/\bimport\s[^;]*\swith\s*\{/, "import attributes"],
    [/\bfs\.cpSync\b/, "fs.cpSync is experimental before Node 22"],
  ];
  for (const f of [...SOURCES, ...TESTS]) {
    if (f.endsWith("repo.test.mjs")) continue;
    const text = read(f);
    for (const [re, what] of newer) assert.doesNotMatch(text, re, `${f}: ${what}`);
  }
});

test("a real agent binary is started only through the guard: no test file that names a binary (.BIN) calls spawn, spawnSync, exec or fork itself", () => {
  for (const f of TESTS) {
    const name = posix(f);
    if (name === "test/sandbox.mjs" || name === "test/repo.test.mjs") continue;
    const text = read(f);
    if (/\.BIN\b/.test(text)) assert.doesNotMatch(text, /(?<![.\w])(spawn|spawnSync|execSync|execFile|execFileSync|fork|exec)\s*\(/, `${name} names a binary and starts a program itself: use launch() of test/sandbox.mjs, which runs the guard first`);
  }
  const sandbox = read("test/sandbox.mjs");
  assert.equal([...sandbox.matchAll(/assertSandboxed\(childEnv, sb\.root\)/g)].length >= 1, true, "launch() calls the guard on the environment the binary would get");
  // the guard is called before the spawn in launch(): the call comes first in the text of the function
  const fn = sandbox.slice(sandbox.indexOf("export function launch("));
  assert.ok(fn.indexOf("assertSandboxed(") > 0 && fn.indexOf("assertSandboxed(") < fn.indexOf("spawn("), "launch() asserts before it spawns");
  const live = read("src/live.mjs");
  const start = live.slice(live.indexOf("function startBinary("));
  assert.ok(start.indexOf("assertSandboxed(env, root)") > 0 && start.indexOf("assertSandboxed(") < start.indexOf("spawn("), "startBinary() asserts before it spawns");
});

test("no test asks the machine for its home folder, and no test writes the registry, the Git configuration or the execution policy of the machine", () => {
  const writesMachine = /reg(?:\.exe)?["'`]?\s*,\s*\[\s*["'`](add|delete)|\bsetx\b|Set-ExecutionPolicy|\[\s*["'`]config["'`]\s*,\s*["'`]--(?:global|system|local|unset|unset-all|add|replace-all|edit|rename-section|remove-section)|\[\s*["'`]config["'`]\s*,\s*["'`][a-z]+\.[a-z.]+["'`]\s*,\s*["'`]/;
  for (const f of TESTS) {
    if (f.endsWith("repo.test.mjs")) continue;
    const text = read(f);
    assert.doesNotMatch(text, /os\.homedir\(\)/, `${f} reaches for the real home folder`);
    // pretend machines may record such command lines; a real run may not make them
    if (/fakeMachine|winMachine|machine\.mjs|win-machine\.mjs/.test(text)) continue;
    assert.doesNotMatch(text.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n"), writesMachine, `${f} could write the real machine`);
  }
});

test("the licence, the conduct file, the changelog and the version agree", () => {
  assert.match(read("LICENSE"), /^MIT License/);
  assert.match(read("LICENSE"), /Copyright \(c\) 2026 Naresh Prabu/);
  assert.ok(exists("CODE_OF_CONDUCT.md"));
  const v = VERSION.replace(/\./g, "\\.");
  assert.match(read("CHANGELOG.md"), new RegExp(`^## \\[${v}\\] - 2026-10-19$`, "m"));
  assert.match(read("CHANGELOG.md"), new RegExp(`^\\[${v}\\]: https://github\\.com/nrzz/agent-windows-doctor/releases/tag/v${v}$`, "m"));
  for (const f of ["SECURITY.md", "SUPPORT.md", "ROADMAP.md", "CONTRIBUTING.md"]) assert.ok(exists(f), f);
  assert.match(read("SECURITY.md"), /security\/advisories\/new/);
  const roadmap = read("ROADMAP.md");
  assert.ok((roadmap.match(/^- /gm) || []).length >= 3 && (roadmap.match(/^- /gm) || []).length <= 5, "three to five next steps");
  assert.match(roadmap, /good first issue: \[#3\]\(https:\/\/github\.com\/nrzz\/agent-windows-doctor\/issues\/3\)/, "the roadmap names the good first issue");
  assert.match(read("CONTRIBUTING.md"), /## Where things are/);
  assert.match(read("CONTRIBUTING.md"), /good first issue/);
});

test("the CHANGELOG says what the README says: the commands, the flags, the agents, and where the code came from", () => {
  const changelog = read("CHANGELOG.md");
  for (const word of ["check", "explain", "agents", "--live", "--markdown", "--agent", "--json", "claude-windows-doctor", "codex-config-doctor", "Claude Code", "Codex CLI", "Gemini CLI", "GitHub Copilot CLI", "Cursor"]) assert.ok(changelog.includes(word), `the changelog says ${word}`);
});

test("the issue forms and the pull request template are there", () => {
  for (const f of ["bug_report.yml", "feature_request.yml", "config.yml"]) assert.ok(exists(`.github/ISSUE_TEMPLATE/${f}`), f);
  assert.match(read(".github/ISSUE_TEMPLATE/config.yml"), /blank_issues_enabled: false/);
  assert.match(read(".github/ISSUE_TEMPLATE/config.yml"), /nrzz\/agent-windows-doctor\/discussions/);
  assert.ok(exists(".github/PULL_REQUEST_TEMPLATE.md"));
  assert.match(read(".github/dependabot.yml"), /package-ecosystem: github-actions/);
  for (const f of ["bug_report.yml", "feature_request.yml"]) assert.match(read(`.github/ISSUE_TEMPLATE/${f}`), /agent-windows-doctor/);
  assert.match(read(".github/PULL_REQUEST_TEMPLATE.md"), /guard of `test\/sandbox\.mjs`/);
});

test("the CI workflows: the suite on three systems and four Node versions, and the real agents on all three systems, with no action version pinned here", () => {
  const ci = read(".github/workflows/test.yml");
  assert.match(ci, /os: \[ubuntu-latest, windows-latest, macos-latest\]/);
  assert.match(ci, /node: \[20, 22, 24\]/);
  assert.match(ci, /node: 18/);
  assert.match(ci, /run: npm test/);
  assert.match(ci, /uses: actions\/checkout@/);
  assert.match(ci, /uses: actions\/setup-node@/);
  assert.match(ci, /timeout-minutes: \d+/);
  const e2e = read(".github/workflows/e2e.yml");
  for (const part of ["name: e2e", "ubuntu-latest, macos-latest, windows-latest", "npm install -g @anthropic-ai/claude-code", "npm install -g @openai/codex", "npm install -g @google/gemini-cli", "npm install -g @github/copilot", "continue-on-error: true", "E2E_CLAUDE: claude", "E2E_CODEX: codex", "E2E_GEMINI: gemini", "E2E_COPILOT: copilot", "schedule:", "workflow_dispatch", "--test-concurrency=1", "claude_version", "codex_version", "gemini_version", "copilot_version"]) assert.ok(e2e.includes(part), part);
  for (const file of ["e2e-claude", "e2e-codex", "e2e-gemini", "e2e-copilot", "e2e-live", "windows"]) assert.ok(e2e.includes(`test/${file}.test.mjs`), file);
  assert.match(e2e, /timeout-minutes: \d+/);
  // an install may fail without failing the job; the real-binary checks may not
  const steps = e2e.split(/\n {6}- /);
  const installs = steps.filter((s) => s.includes("npm install -g"));
  assert.equal(installs.length, 4);
  for (const s of installs) assert.match(s, /continue-on-error: true/);
  const binary = steps.find((s) => s.includes("test/e2e-claude.test.mjs"));
  assert.doesNotMatch(binary, /continue-on-error/);
  // every real-binary file that the workflow runs is a file
  for (const m of e2e.matchAll(/test\/[\w.-]+\.test\.mjs/g)) assert.ok(exists(m[0]), m[0]);
});

test("every real-binary test skips when its binary is not named, so that npm test needs nothing but Node", () => {
  for (const [file, env] of [["e2e-claude", "E2E_CLAUDE"], ["e2e-codex", "E2E_CODEX"], ["e2e-gemini", "E2E_GEMINI"], ["e2e-copilot", "E2E_COPILOT"]]) {
    const text = read(`test/${file}.test.mjs`);
    assert.match(text, /skipReason\(/, `${file} asks whether its binary runs`);
    assert.ok(read("test/agents.mjs").includes(`envName: "${env}"`), `${env} names the binary for ${file}`);
  }
  assert.match(read("test/agents.mjs"), /process\.env\.E2E_/);
});
