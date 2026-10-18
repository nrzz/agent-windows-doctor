// The command line: the options, the help, the exit codes. 0 ok, 1 findings or a refusal, 2 a usage error.
import path from "node:path";
import { VERSION } from "./version.mjs";
import { makeSys } from "./sys.mjs";
import { fileUserEnv, regUserEnv } from "./winenv.mjs";
import { makeTempDir, removeTempDir } from "./write.mjs";
import { collectWindows, collectWsl, kindOf, notApplicable, selectAgents, codexDesktopApp } from "./check.mjs";
import { AGENT_IDS, findAgents } from "./inventory.mjs";
import { liveAll } from "./live.mjs";
import { IDS, listPages, nearIds, pageFor } from "./explain.mjs";
import { agentsJson, agentsText, checkJson, checkMarkdown, checkText, explainJson, explainListJson, explainListText, explainText } from "./report.mjs";

export const HELP = `Usage: agent-windows-doctor <command> [options]

Read (they change nothing):
  check    [--project <dir>] [--agent claude,codex,gemini,copilot,cursor|all] [--live] [--markdown]
           [--claude <path>] [--codex <path>] [--gemini <path>] [--copilot <path>]
           on Windows, for Claude Code, Codex CLI, Gemini CLI, GitHub Copilot CLI and Cursor: the machine
           (Windows, PowerShell editions with language mode and execution policy, Git for Windows, every
           bash.exe on PATH, long paths, line endings, code page, WSL, Node); every program of each agent
           with its version, where it came from and which one runs first; the shell each gives the model
           and how it chose; what runs its hooks; Codex's Windows sandbox; and the findings, each with
           its fix and a basis (verified, documented or not verified). Inside a WSL distribution: the WSL
           side. On Linux and macOS: nothing to check. Exit 1 on an error or a warning. --live proves the
           shell choice of each agent with its real binary through a fake API on 127.0.0.1 (no token is
           spent), using the first of its kind on PATH or the path an option names. --markdown is the
           short report to paste into any agent (at most 12 findings); it always exits 0
  agents   [--agent ...]
           every program of each agent, alone: which one runs first
  explain  [--list] <finding-id>
           what a finding means, what the agent does in that case (each line marked verified,
           documented or not verified), the fix, and the issue and forum threads

Options:
  --json            one JSON document on stdout (every command)
  --project <dir>   the folder the agents start in (default: the folder you are in); check
  --agent <list>    which agents: claude, codex, gemini, copilot, cursor, or all (the default); check and agents
  --live            run each agent's real binary against a fake API; check
  -h, --help        this text
  -v, --version     the version

Finding ids are <agent>.<name>, for example claude.git-bash-not-found or codex.sandbox-none.
Exit codes: 0 ok; 1 findings, or a failed proof; 2 a usage error or an unexpected error.
Environment: AGENT_WINDOWS_DOCTOR_MANAGED_DIR (the folder to read Claude Code's managed-settings.json from, instead of
C:\\Program Files\\ClaudeCode) and AGENT_WINDOWS_DOCTOR_USER_ENV_FILE (a JSON file that stands in for HKCU\\Environment);
the tests use both. It reads files, the registry and the output of a few Windows programs, and writes nothing. It
starts an agent's binary only with --live, in throwaway folders, and sends nothing to anyone.
`;

const COMMANDS = {
  check: { options: ["project", "agent", "json", "markdown", "live", "claude", "codex", "gemini", "copilot"], positional: 0 },
  agents: { options: ["agent", "json"], positional: 0 },
  explain: { options: ["json", "list"], positional: 1 },
};

const FLAGS = { "--json": "json", "--markdown": "markdown", "--live": "live", "--list": "list", "-h": "help", "--help": "help", "-v": "version", "--version": "version" };
const VALUES = { "--project": "project", "--agent": "agent", "--claude": "claude", "--codex": "codex", "--gemini": "gemini", "--copilot": "copilot" };

class UsageError extends Error {}

/** Reads the argument list. Returns { command, id, project, agent, claude, codex, gemini, copilot, json, markdown, live, list, help, version, given } or throws a UsageError. */
export function parseArgs(argv) {
  const o = { command: null, id: null, project: undefined, agent: undefined, claude: undefined, codex: undefined, gemini: undefined, copilot: undefined, json: false, markdown: false, live: false, list: false, help: false, version: false, given: new Set() };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = /^(--[a-z-]+)=(.*)$/s.exec(a);
    const flag = eq ? eq[1] : a;
    if (Object.prototype.hasOwnProperty.call(VALUES, flag)) {
      const key = VALUES[flag];
      const value = eq ? eq[2] : argv[++i];
      if (value === undefined || (!eq && /^--?[A-Za-z]/.test(value) && key !== "project")) throw new UsageError(`${flag} needs a value`);
      o.given.add(key);
      o[key] = value;
    } else if (Object.prototype.hasOwnProperty.call(FLAGS, flag) && !eq) {
      o[FLAGS[flag]] = true;
      o.given.add(FLAGS[flag]);
    } else if (a.startsWith("-") && a !== "-") {
      throw new UsageError(`unknown option ${a}`);
    } else positional.push(a);
  }
  if (o.help || o.version) return o;
  if (!positional.length) throw new UsageError("no command given");
  o.command = positional[0];
  const spec = COMMANDS[o.command];
  if (!spec) throw new UsageError(`unknown command "${o.command}"`);
  for (const key of o.given) if (key !== "help" && key !== "version" && !spec.options.includes(key)) throw new UsageError(`${o.command} does not take --${key}`);
  const rest = positional.slice(1);
  if (o.command === "explain" && o.list && rest.length) throw new UsageError("explain takes --list or one finding id, not both");
  if (rest.length > spec.positional) throw new UsageError(`${o.command} takes ${spec.positional === 0 ? "no name" : "one finding id"}, not "${rest.join(" ")}"`);
  if (o.command === "explain" && !o.list && rest.length === 0) throw new UsageError("explain needs a finding id or --list (for example claude.git-bash-not-found)");
  o.id = rest[0] || null;
  if (o.agent !== undefined) {
    const names = String(o.agent).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const bad = names.filter((n) => n !== "all" && !AGENT_IDS.includes(n));
    if (!names.length || bad.length) throw new UsageError(`--agent names ${bad.length ? `"${bad.join(", ")}", which is not an agent` : "no agent"}: use ${AGENT_IDS.join(", ")} or all`);
    if (names.includes("all") && names.length > 1) throw new UsageError("--agent all stands alone");
    o.agent = names.includes("all") ? "all" : names.join(",");
  }
  for (const id of ["claude", "codex", "gemini", "copilot"]) if (o.command === "check" && o[id] !== undefined && !o.live) throw new UsageError(`--${id} is for --live: it names the ${id} to run`);
  if (o.command === "check" && o.markdown && o.live) throw new UsageError("--markdown is the short report to paste and does not run --live");
  return o;
}

const errorDoc = (message) => ({ ok: false, error: message });

function pickUserEnv(io, sys) {
  if (io.userEnv) return io.userEnv;
  const file = sys.getEnv("AGENT_WINDOWS_DOCTOR_USER_ENV_FILE");
  if (file) return fileUserEnv(sys, file);
  return regUserEnv(sys);
}

/**
 * Runs the command line. `io` replaces the real machine for the tests:
 *   { sys, userEnv, env, now, stdout: { write }, stderr: { write }, tempDir, liveRunner }
 * `liveRunner` is { claude, codex, gemini, copilot } of stand-ins for the real runs. Returns the exit code.
 */
export async function main(argv, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  let o;
  try { o = parseArgs(argv); } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    if (argv.includes("--json")) stdout.write(`${JSON.stringify(errorDoc(e.message))}\n`);
    else stderr.write(`agent-windows-doctor: ${e.message}\nRun agent-windows-doctor --help for the commands.\n`);
    return 2;
  }
  if (o.help) { stdout.write(HELP); return 0; }
  if (o.version) { stdout.write(`agent-windows-doctor ${VERSION}\n`); return 0; }
  const emit = (doc, text) => stdout.write(o.json ? `${JSON.stringify(doc, null, 2)}\n` : text);
  try {
    if (o.command === "explain") {
      if (o.list) {
        const pages = listPages();
        emit(explainListJson(pages), explainListText(pages));
        return 0;
      }
      const page = pageFor(o.id);
      if (!page) {
        const near = nearIds(o.id);
        if (o.json) stdout.write(`${JSON.stringify({ ok: false, refused: `no finding called "${o.id}"`, ids: IDS, near }, null, 2)}\n`);
        else stderr.write(`agent-windows-doctor: no finding called "${o.id}".${near.length ? ` Did you mean ${near.join(", ")}?` : ""}\nThe ids: ${IDS.join(", ")}\n`);
        return 1;
      }
      emit(explainJson(page), explainText(page));
      return 0;
    }

    const sys = io.sys || makeSys(io.env ? { env: io.env } : {});
    const pa = path[sys.platform === "win32" ? "win32" : "posix"];
    const project = o.project === undefined ? undefined : (pa.isAbsolute(o.project) ? o.project : pa.join(sys.cwd, o.project));
    const agents = selectAgents(o.agent);
    const kind = kindOf(sys);

    if (o.command === "agents") {
      if (kind !== "windows") {
        const f = notApplicable(sys);
        emit(agentsJson(f), agentsText(f));
        return 0;
      }
      const machineNpm = sys.run("cmd.exe", ["/d", "/s", "/c", "\"npm config get prefix\""], { verbatim: true, env: { ...sys.env, npm_config_update_notifier: "false", npm_config_logs_max: "0" }, timeout: 30000 });
      const npmPrefix = !machineNpm.error && machineNpm.status === 0 ? (String(machineNpm.stdout).split(/\r?\n/).find((l) => l.trim()) || "").trim() || null : null;
      const inventory = findAgents(sys, { agents, ctx: { npmPrefix, codexApp: agents.includes("codex") ? codexDesktopApp(sys) : null } });
      emit(agentsJson({ platform: "win32", agents, inventory }), agentsText({ platform: "win32", agents, inventory }));
      return 0;
    }

    // check
    if (kind === "other") {
      const f = notApplicable(sys);
      if (o.live) {
        const msg = "check --live proves the shell choice of each agent on Windows: there is nothing to prove here";
        if (o.json) stdout.write(`${JSON.stringify({ ok: false, refused: msg, applicable: false, platform: sys.platform }, null, 2)}\n`); else stderr.write(`${msg}\n`);
        return 1;
      }
      if (o.markdown) stdout.write(checkMarkdown(f)); else emit(checkJson(f), checkText(f));
      return 0;
    }
    if (o.live && kind !== "windows") {
      const msg = "check --live proves the shell choice of each agent on Windows, and works on Windows only";
      if (o.json) stdout.write(`${JSON.stringify({ ok: false, refused: msg, platform: sys.platform }, null, 2)}\n`); else stderr.write(`${msg}\n`);
      return 1;
    }
    const facts = kind === "windows" ? collectWindows(sys, { project, userEnv: pickUserEnv(io, sys), agents }) : collectWsl(sys, { project, agents });
    let liveFailed = false;
    if (o.live) {
      facts.live = await liveAll(sys, { facts, paths: { claude: o.claude, codex: o.codex, gemini: o.gemini, copilot: o.copilot }, runners: io.liveRunner || {}, tmpdir: io.tempDir || sys.tmpdir, makeDir: makeTempDir, removeDir: removeTempDir });
      liveFailed = !facts.live.ok;
    }
    if (o.markdown) { stdout.write(checkMarkdown(facts)); return 0; }
    emit(checkJson(facts), checkText(facts));
    return facts.counts.error + facts.counts.warning > 0 || liveFailed ? 1 : 0;
  } catch (e) {
    if (o.json) stdout.write(`${JSON.stringify(errorDoc(String(e && e.message ? e.message : e)))}\n`);
    else stderr.write(`agent-windows-doctor: ${e && e.message ? e.message : e}\n`);
    return 2;
  }
}
