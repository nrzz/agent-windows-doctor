// The reports: text for a terminal, one JSON document for --json, and the short markdown to paste into any agent (check --markdown).
// Nothing printed here may be a secret: an environment value is shown only for a path or a switch (src/userenv.mjs), and no settings file is shown whole.
import { VERSION } from "./version.mjs";
import { AGENT_IDS, AGENT_LABEL, COMMANDS, ORIGIN_TEXT } from "./inventory.mjs";
import { HOW, GIT_BASH_VAR } from "./claude-shell.mjs";
import { MXC_TEXT } from "./machine.mjs";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pad = (s, n) => String(s) + " ".repeat(Math.max(0, n - String(s).length));
const cut = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const OS_NAME = { win32: "Windows", linux: "Linux", darwin: "macOS" };

export const NOTHING = (platform) => `Nothing to check on ${OS_NAME[platform] || platform}: agent-windows-doctor checks what Claude Code, Codex CLI, Gemini CLI, GitHub Copilot CLI and Cursor get on Windows, and from inside a WSL distribution the WSL side. Run it on Windows, or in WSL.`;

const header = (title) => `agent-windows-doctor ${VERSION}  ${title}`;
const shortList = (labels) => labels.join(", ");

// ---- Claude Code's shell (claude-windows-doctor's report) ---------------------------------------------------------------------

function bashLine(shell) {
  const g = shell.gitBash;
  if (g.path) return `yes: Git Bash at ${g.path} (${HOW[g.how]}${g.how === "variable" && g.variableSource.source ? `, ${g.variableSource.source}` : ""})`;
  return "no: Git Bash was not found";
}
function psLine(shell) {
  const p = shell.powershell;
  const edition = p.edition ? `, ${p.edition}` : "";
  if (shell.fatal) return "no: the tool is off, so Claude Code does not start";
  if (p.state === "yes") return `yes (${p.why})${edition}`;
  if (p.state === "no") return `no (${p.why})`;
  return `${p.why}${edition}`;
}
const stepText = (t) => {
  if (t.step === "variable") {
    if (t.state === "unset") return `${GIT_BASH_VAR}: not set`;
    const note = t.state === "valid" ? "used" : t.state === "not-found" ? "ignored: no such file" : "ignored: not named bash.exe, sh.exe, bash or sh";
    return `${GIT_BASH_VAR}: ${t.value} (${t.source}): ${note}`;
  }
  if (t.step === "program-files" || t.step === "program-files-x86") return `${t.path}: ${t.exists ? "found" : "not there"}`;
  if (t.step === "where-git") {
    if (t.lines === null) return "where git: where.exe could not run";
    if (!t.lines.length) return "where git: no git.exe on PATH";
    if (!t.chosen) return `where git: ${t.lines.length} line${t.lines.length === 1 ? "" : "s"}, none usable (${(t.skipped || []).map((s) => `${s.line}: ${s.reason}`).join("; ")})`;
    return `where git: ${t.chosen} is the first line${t.lines.length > 1 ? ` (of ${t.lines.length})` : ""}; two folders up, ${t.derived}: ${t.exists ? "found" : "not there"}`;
  }
  return t.step;
};

// ---- the sections -----------------------------------------------------------------------------------------------------------------

function policyText(list) {
  return list.map((x) => `${x.scope} ${x.policy}`).join(", ");
}

function machineLines(f) {
  const m = f.machine;
  const w = m.windows;
  const out = ["The machine"];
  out.push(`  Windows           ${w.caption}, build ${w.build === null ? "?" : w.build}${w.ubr !== null ? `.${w.ubr}` : ""}${w.display ? ` (${w.display})` : ""}, ${w.arch}`);
  out.push(`  Codex MXC sandbox ${m.mxc.supported === true ? "can run" : m.mxc.supported === false ? "cannot run" : "not known"} here: ${m.mxc.why}`);
  for (const e of m.powershell.editions) {
    const p = e.probe;
    const what = p && p.ok ? `${p.version}, ${p.languageMode}, execution policy ${p.effective} (${policyText(p.list)})` : p ? `not read: ${p.error}` : "";
    out.push(`  ${pad(e.label, 17)} ${e.path}  ${what}${e.id === "7" ? `  [${e.how}]` : ""}`);
  }
  if (!m.powershell.editions.some((e) => e.id === "7")) out.push(`  ${pad("PowerShell 7", 17)} not found: no pwsh.exe on PATH, in %ProgramFiles%\\PowerShell\\7, in the Store alias folder or in .dotnet\\tools`);
  out.push(`  Git for Windows   ${m.gitInstalls.length ? m.gitInstalls.map((g) => g.path).join(", ") : "none found"}${m.git.ok ? `; git ${m.git.version}` : m.git.error ? `; git: ${m.git.error}` : ""}`);
  if (m.bash.length) m.bash.forEach((b, i) => out.push(`  ${i === 0 ? "bash.exe on PATH  " : "                   "}${i + 1}  ${b.path}  ${b.kind === "git-bash" ? "Git Bash" : b.kind === "wsl-launcher" ? "the WSL launcher (starts the default distribution)" : "another bash"}`));
  else out.push("  bash.exe on PATH  none");
  out.push(`  long paths        Windows LongPathsEnabled ${m.longPaths.ok ? (m.longPaths.enabled ? "on" : "off") : "?"}; git core.longpaths ${m.git.ok ? (m.git.longpaths ? m.git.longpaths.value : "not set") : "?"}`);
  out.push(`  line endings      git core.autocrlf ${m.git.ok ? (m.git.autocrlf ? `${m.git.autocrlf.value} (${m.git.autocrlf.origin})` : "not set") : "?"}`);
  out.push(`  console           code page ${m.codePage.active || "?"}${m.codePage.oem ? `, system OEM ${m.codePage.oem}, ANSI ${m.codePage.ansi || "?"}` : ""}`);
  if (m.wsl.available) m.wsl.distros.forEach((d, i) => out.push(`  ${i === 0 ? "WSL               " : "                   "}${d.isDefault ? "*" : " "} ${pad(d.name, 18)} ${pad(d.state, 10)} WSL ${d.version}${d.internal ? "  (made by another tool, not one to work in)" : ""}`));
  else out.push(`  WSL               none installed${m.wsl.error ? ` (${m.wsl.error})` : ""}`);
  const wants = f.nodeWants || [];
  out.push(`  Node              ${m.node.node}${m.node.npm ? `, npm ${m.node.npm}` : ", no npm on PATH"}${wants.length ? `; installed packages ask for: ${wants.map((x) => `${AGENT_LABEL[x.agent]} ${x.range ? `${x.range} (${x.ok === false ? "not met" : x.ok ? "met" : "?"})` : "not stated"}`).join(", ")}` : "; no npm package of an agent found, so no engines were read"}`);
  return out;
}

function versionText(e) {
  if (e.version) return `${e.version} (${e.versionFrom})`;
  if (e.skipped) return "not run";
  return e.note ? `? ${e.note}` : "not read (check --live asks the program)";
}

export function inventoryLines(f, { title = "Every agent on this machine" } = {}) {
  const out = [title];
  for (const id of f.asked || f.agents) {
    const a = f.inventory.agents[id];
    out.push(`  ${a.label}`);
    if (!a.entries.length) out.push("    none found on PATH or in the places the installers use");
    a.entries.forEach((e, i) => {
      out.push(`    ${i + 1}  ${e.path}`);
      out.push(`        ${versionText(e)}; ${ORIGIN_TEXT[e.origin]}${e.runsFirst ? "; runs first from a terminal" : e.onPath ? "; on PATH" : "; not on PATH"}${e.note ? `; ${e.note}` : ""}`);
      if (e.also && e.also.length) out.push(`        also answers to ${e.also.join(", ")}`);
      if (e.leadsTo && e.leadsTo.length) out.push(`        leads to ${e.leadsTo.join(" -> ")}`);
      if (e.asked) out.push(`        asked: ${e.asked}`);
    });
    if (a.entries.length && !a.first) out.push(`    none of them is on PATH, so a terminal does not know the command ${COMMANDS[id][0]}`);
  }
  return out;
}

function shellLines(f) {
  const out = ["The shell each agent gives the model"];
  if (!f.agents.length) out.push("  no agent found: nothing to say");
  for (const id of f.agents) {
    const label = AGENT_LABEL[id];
    if (id === "claude") {
      const s = f.shells.claude;
      out.push(`  ${label}`);
      out.push(`    Bash tool         ${bashLine(s)}`);
      out.push(`    PowerShell tool   ${psLine(s)}`);
      if (s.deny.Bash.length) out.push(`    Bash tool         taken away by the deny rule "${s.deny.Bash[0].rule}" (${s.deny.Bash[0].display})`);
      if (s.deny.PowerShell.length) out.push(`    PowerShell tool   taken away by the deny rule "${s.deny.PowerShell[0].rule}" (${s.deny.PowerShell[0].display})`);
      out.push("    how Claude Code looked for Git Bash, in its order:");
      let n = 0;
      for (const t of s.gitBash.trail) out.push(t.step === "program-files-x86" ? `         ${stepText(t)}` : `      ${++n}  ${stepText(t)}`);
      const ds = f.claude.settingsFacts.defaultShell;
      out.push(`    defaultShell      ${ds.length ? ds.map((d) => `"${d.value}" (${d.display})`).join(", ") : "not set"}: the shell for the commands you type after !, not the model's tool`);
      if (f.claude.bashStarts.checked) out.push(`    Git Bash starts   ${f.claude.bashStarts.ok ? "yes" : `no: ${f.claude.bashStarts.error}`}`);
      continue;
    }
    const s = f.shells[id];
    const what = s.shell ? `${s.shell.label} at ${s.shell.path}${s.args ? `, started with ${s.args}` : ""}` : s.state === "missing" ? "none: no PowerShell is on PATH" : "not known";
    out.push(`  ${label}${s.tool ? ` (tool ${s.tool})` : ""}`);
    out.push(`    shell             ${what} [${s.basis}]`);
    for (const h of s.how) out.push(`    - ${h}`);
  }
  return out;
}

function hookLines(f) {
  const out = ["Hooks on Windows"];
  if (!f.agents.length) out.push("  no agent found: nothing to say");
  for (const id of f.agents) {
    const h = f.hooks[id];
    out.push(`  ${AGENT_LABEL[id]}`);
    if (!h.files.length) { out.push("    no hook file found"); continue; }
    out.push(`    files: ${h.files.map((x) => `${x.scope} ${x.display}${x.error ? ` (${x.error})` : ""}`).join("; ")}`);
    if (!h.entries.length) { out.push("    no command hook in them"); continue; }
    for (const e of h.entries) {
      const via = e.runner.via === "git-bash" ? "Git Bash" : e.runner.via === "powershell" ? (e.runner.edition === "7" ? "PowerShell 7" : "Windows PowerShell 5.1") : e.runner.via === "bash" ? (e.runner.bashKind === "none" ? "bash (none on PATH)" : e.runner.bashKind === "wsl-launcher" ? "bash (the WSL launcher)" : "bash") : e.runner.via === "direct" ? "no shell" : "?";
      out.push(`    ${e.event}${e.matcher ? ` [${e.matcher}]` : ""}  ${cut(e.command, 110)}`);
      out.push(`        in ${e.source}; run by ${via} [${e.runner.basis}]${e.field !== "command" ? `; field ${e.field}` : ""}${e.reasons.length ? `; looks like bash: ${e.reasons.map((r) => r.id).join(", ")}` : ""}${e.flags.ps1Blocked ? `; a .ps1 under the ${e.policy} policy` : ""}${e.flags.extensionless ? "; no extension" : ""}`);
    }
  }
  return out;
}

function codexLines(f) {
  const c = f.codex;
  const out = ["Codex on Windows"];
  out.push(`  CODEX_HOME        ${c.home.dir} (${c.home.source === "CODEX_HOME" ? "CODEX_HOME" : "the default"})${c.homeExists ? "" : "; the folder is not there"}`);
  out.push(`  files read        ${c.layerFiles.length ? c.layerFiles.map((l) => `${l.kind} ${l.path}${l.error ? ` (${l.error})` : ""}`).join("; ") : "no config.toml found"}`);
  out.push(`  project trust     ${c.trusted ? "trusted" : c.trustLevel ? `${c.trustLevel}` : "not trusted: the project's .codex folder is not read"}`);
  const sb = c.sandbox;
  out.push(`  sandbox           ${sb.selection === "none" ? "none selected" : `${sb.selection} selected by ${sb.selectionHow}`}; sandbox_mode ${sb.mode.asked ? `"${sb.mode.asked}"` : `not set (${sb.mode.wanted} for ${c.trusted ? "a trusted" : "an untrusted"} project)`}${sb.mode.downgraded ? ` becomes ${sb.mode.effective}` : ""}`);
  out.push(`  MXC               ${sb.mxcAvailable === true ? "available" : sb.mxcAvailable === false ? "not available" : "not known"}${sb.log ? ` (the sandbox log of ${sb.log.at || "an earlier run"} says ${sb.log.mxcAvailable === null ? "nothing about it" : sb.log.mxcAvailable}; last selection ${sb.log.lastSelection || "?"})` : ` (${sb.mxc.why}; no sandbox log yet)`}`);
  out.push(`  shell key         ${c.shellKeys.length ? c.shellKeys.map((k) => `${k.key} in ${k.file}: Codex CLI has no such key`).join("; ") : "windows.shell_path is not set (Codex has no setting for its shell)"}`);
  out.push("  more              codex doctor reports the install, the sign-in, the runtime, Microsoft Defender exclusions and Dev Drive");
  return out;
}

function liveLines(live) {
  const out = ["Live: the real binaries, through a fake API on 127.0.0.1 (no token spent)"];
  for (const [id, r] of Object.entries(live.agents)) {
    const label = AGENT_LABEL[id];
    if (r.skipped) { out.push(`  ${pad(label, 20)} not run: ${r.skipped}`); continue; }
    if (!r.ok) { out.push(`  ${pad(label, 20)} not run: ${r.error}`); continue; }
    const v = r.binary.asked || r.binary.version || "";
    out.push(`  ${pad(label, 20)} ${r.proved ? "proved" : "DID NOT MATCH"} with the real ${id} ${v} (${r.binary.path}${r.binary.source ? `; ${r.binary.source}` : ""}):`);
    if (id === "claude") {
      out.push(`  ${pad("", 20)} the first request listed ${r.actual.tools.length ? r.actual.tools.join(" and ") : "no shell tool"}${r.run.exitCode ? ` (it exited with code ${r.run.exitCode}${r.run.stderr ? `: ${r.run.stderr}` : ""})` : ""}${r.actual.bash ? `, and it took ${r.actual.bash}` : ""}${r.run.edition ? `; PowerShell edition: ${r.run.edition}` : ""}`);
      if (r.run.warning) out.push(`  ${pad("", 20)} the binary says: ${r.run.warning}`);
      out.push(`  ${pad("", 20)} the fake API has no account, so the account's default for the PowerShell tool is off there; predicted: ${r.predicted.tools.join(" and ") || "no shell tool"}`);
    } else {
      out.push(`  ${pad("", 20)} the shell command ran in ${r.actual.shell || "nothing"}${r.actual.error ? ` (${r.actual.error})` : ""}; predicted: ${r.predicted.shell || "no PowerShell on PATH"}`);
      if (r.run.line) out.push(`  ${pad("", 20)} command line: ${cut(r.run.line, 150)}`);
    }
    for (const d of r.differences) out.push(`  ${pad("", 20)} difference: ${d}`);
  }
  return out;
}

function findingsText(f) {
  const out = [];
  if (!f.findings.length) { out.push("No findings."); return out; }
  out.push("Findings");
  for (const x of f.findings) {
    out.push(`  ${pad(x.severity, 7)} ${x.id}   [${x.basis}]`);
    out.push(`      ${x.message}`);
    if (x.effect) out.push(`      what ${AGENT_LABEL[x.agent]} does: ${x.effect}`);
    if (x.fix) out.push(`      fix: ${x.fix}`);
    out.push(`      more: agent-windows-doctor explain ${x.id}`);
  }
  out.push("");
  out.push(`${plural(f.counts.error, "error")}, ${plural(f.counts.warning, "warning")}, ${plural(f.counts.note, "note")}`);
  return out;
}

function windowsText(f) {
  const out = [];
  out.push(header("what the coding agents get on this Windows machine"));
  out.push(`project   ${f.project}`);
  out.push(`system    ${f.system.os} (${f.system.release}), ${f.system.arch}`);
  out.push(`agents    ${f.agents.length ? shortList(f.agents.map((a) => AGENT_LABEL[a])) : "none found on this machine"}${f.agents.length && f.notFound.length ? ` (not found: ${shortList(f.notFound.map((a) => AGENT_LABEL[a]))})` : ""}`);
  out.push("");
  out.push(...machineLines(f));
  out.push("");
  out.push(...inventoryLines(f));
  out.push("");
  out.push(...shellLines(f));
  if (f.live) { out.push(""); out.push(...liveLines(f.live)); }
  out.push("");
  out.push(...hookLines(f));
  if (f.codex) { out.push(""); out.push(...codexLines(f)); }
  if (f.claude.settings) {
    const mf = f.claude.settings.files.filter((s) => s.exists);
    out.push("");
    out.push(`Claude Code settings files read: ${mf.length ? mf.map((s) => `${s.scope} ${s.display}${s.error ? " (ignored: not valid JSON)" : ""}`).join("; ") : "none exist"}`);
  }
  if (f.userEnv) {
    out.push("");
    out.push("Claude Code: user environment (HKCU\\Environment) against this process");
    if (!f.userEnv.ok) out.push(`  not read: ${f.userEnv.error}`);
    else if (!f.userEnv.entries.length) out.push(`  no CLAUDE_ or ANTHROPIC_ variable in either${f.userEnv.own ? ` (${f.userEnv.own} that Claude Code sets for its own programs are left out)` : ""}`);
    else {
      const shownValue = (s) => (s ? (s.value !== undefined ? s.value : "set") : "not set");
      const both = f.userEnv.entries.filter((e) => e.status !== "process-only");
      const only = f.userEnv.entries.filter((e) => e.status === "process-only");
      for (const e of both) out.push(`  ${pad(e.name, 34)} user: ${pad(shownValue(e.user), 8)}  this process: ${shownValue(e.process)}${e.status === "same" ? "" : `   (${e.status.replace("-", " ")})`}`);
      if (!both.length) out.push("  the user environment has no CLAUDE_ or ANTHROPIC_ variable");
      if (only.length) out.push(`  set in this process only: ${only.map((e) => (e.process && e.process.value !== undefined ? `${e.name} (${e.process.value})` : e.name)).join(", ")}`);
      if (f.userEnv.own) out.push(`  (${f.userEnv.own} that Claude Code sets for its own programs are left out)`);
    }
  }
  out.push("");
  out.push(...findingsText(f));
  return `${out.join("\n")}\n`;
}

function wslText(f) {
  const out = [];
  out.push(header("the WSL side of the coding agents"));
  out.push(`project   ${f.project}`);
  out.push(`system    ${f.system.os}; WSL ${f.system.wsl}`);
  out.push("");
  out.push("claude on this distribution");
  const a = f.inventory.agents.claude;
  if (!a || !a.entries.length) out.push("  none found on PATH");
  else a.entries.forEach((e, i) => out.push(`  ${i + 1}  ${e.path}   ${e.version || "?"}   ${ORIGIN_TEXT[e.origin]}${e.runsFirst ? "; runs first" : ""}`));
  out.push("");
  out.push(`config folder   ${f.locations.configDir} (${f.locations.configSource})${f.locations.configOnWindows ? ", on a Windows drive" : ""}`);
  out.push(`project         ${f.locations.project}${f.locations.projectOnWindows ? ", on a Windows drive" : ""}`);
  out.push("");
  out.push(...findingsText(f));
  return `${out.join("\n")}\n`;
}

export function checkText(f) {
  if (f.applicable === false) return `${header("nothing to check")}\n${NOTHING(f.platform)}\n`;
  return f.kind === "wsl" ? wslText(f) : windowsText(f);
}

// ---- the markdown ----------------------------------------------------------------------------------------------------------------

export const MARKDOWN_LINE = 500;
export const MARKDOWN_MAX_FINDINGS = 12;

function cutWords(s, n) {
  if (s.length <= n) return s;
  const head = s.slice(0, n - 1);
  const at = head.lastIndexOf(" ");
  return `${(at > n * 0.6 ? head.slice(0, at) : head).trimEnd()}…`;
}

/** One finding as a line of the markdown: the message and the fix always, what the agent does about it when there is room, never more than MARKDOWN_LINE characters. */
function markdownFinding(x) {
  const head = `- ${x.severity.toUpperCase()} \`${x.id}\`: `;
  const fix = x.fix ? ` Fix: ${x.fix}` : "";
  const effect = x.effect ? ` Effect: ${x.effect}` : "";
  for (const line of [`${head}${x.message}${effect}${fix}`, `${head}${x.message}${fix}`]) if (line.length <= MARKDOWN_LINE) return line;
  const room = MARKDOWN_LINE - head.length - fix.length;
  return room >= 80 ? `${head}${cutWords(x.message, room)}${fix}` : cut(`${head}${x.message}${fix}`, MARKDOWN_LINE);
}

const shellWord = (id, f) => {
  if (id === "claude") { const s = f.shells.claude; return s.fatal ? "no shell tool (does not start)" : `${s.gitBash.path ? "Git Bash" : "no Git Bash"}${s.powershell.state === "yes" ? ", PowerShell tool" : ""}`; }
  const s = f.shells[id];
  if (!s) return "?";
  return s.shell ? (s.shell.core ? "PowerShell 7" : "PowerShell 5.1") : s.state === "missing" ? "no PowerShell on PATH" : "not known";
};

/** The short report to paste into any agent: at most MARKDOWN_MAX_FINDINGS findings (errors and warnings), MARKDOWN_LINE characters a line. Exit 0 always. */
export function checkMarkdown(f, { maxFindings = MARKDOWN_MAX_FINDINGS } = {}) {
  if (f.applicable === false) return `## agent-windows-doctor check\n${NOTHING(f.platform)}\n`;
  const out = [];
  if (f.kind === "wsl") {
    out.push(`## agent-windows-doctor check (WSL): ${f.project}`);
    const a = f.inventory.agents.claude;
    out.push(`${a && a.first ? `claude runs from ${a.first.path}${a.first.version ? ` (${a.first.version})` : ""}.` : "No claude on PATH."} ${plural(f.counts.error, "error")}, ${plural(f.counts.warning, "warning")}, ${plural(f.counts.note, "note")}.`);
  } else {
    out.push(`## agent-windows-doctor check: ${f.project}`);
    const here = f.agents.filter((a) => f.inventory.agents[a].entries.length);
    out.push(cut(`${f.system.os}. Shell the model gets: ${here.length ? here.map((a) => `${AGENT_LABEL[a]} ${shellWord(a, f)}`).join("; ") : "no agent found"}.`, 300));
    out.push(cut(`${here.length ? here.map((a) => { const x = f.inventory.agents[a].first; const e = x || f.inventory.agents[a].entries[0]; return `${AGENT_LABEL[a]} ${e.version || "(version not read)"}${x ? " runs first" : " is not on PATH"}`; }).join("; ") : "Nothing to run first."}. ${plural(f.counts.error, "error")}, ${plural(f.counts.warning, "warning")}, ${plural(f.counts.note, "note")}.`, 300));
  }
  const shown = f.findings.filter((x) => x.severity !== "note").slice(0, maxFindings);
  if (!f.findings.length) out.push("No findings.");
  for (const x of shown) out.push(markdownFinding(x));
  const more = f.findings.filter((x) => x.severity !== "note").length - shown.length;
  if (more > 0) out.push(`- ... and ${more} more (run \`agent-windows-doctor check\`)`);
  if (f.counts.note && !shown.length && !more) out.push(`- ${plural(f.counts.note, "note")} not shown (run \`agent-windows-doctor check\`)`);
  return `${out.join("\n")}\n`;
}

// ---- JSON ----------------------------------------------------------------------------------------------------------------------

const findingJson = (x) => ({ id: x.id, severity: x.severity, agent: x.agent, basis: x.basis, message: x.message, effect: x.effect, fix: x.fix });
const entryJson = (e) => ({ path: e.path, kind: e.kind, origin: e.origin, onPath: e.onPath, runsFirst: Boolean(e.runsFirst), leadsTo: e.leadsTo || [], package: e.package ? { name: e.package.name, version: e.package.version, engines: e.package.engines } : null, version: e.version, versionFrom: e.versionFrom, asked: e.asked || null, note: e.note, skipped: e.skipped });
export const inventoryJson = (f) => Object.fromEntries(f.agents.map((id) => { const a = f.inventory.agents[id]; return [id, { label: a.label, first: a.first ? a.first.path : null, entries: a.entries.map(entryJson) }]; }));

const liveJson = (l) => ({
  ok: l.ok,
  agents: Object.fromEntries(Object.entries(l.agents).map(([id, r]) => [id, r.skipped ? { ok: true, skipped: r.skipped } : r.ok
    ? { ok: true, binary: r.binary, proved: r.proved, predicted: r.predicted, actual: r.actual, differences: r.differences, exitCode: r.run.exitCode, requests: r.run.requests, line: r.run.line || null, edition: r.run.edition || null, warning: r.run.warning || null }
    : { ok: false, error: r.error, binary: r.binary || null }])),
});

function shellJson(f) {
  const out = {};
  for (const id of f.agents) {
    if (id === "claude") {
      const s = f.shells.claude;
      const variable = (v) => ({ value: v.value, source: v.source, ignored: (v.ignored || []).map((i) => ({ scope: i.scope, file: i.display, value: i.value })) });
      out.claude = {
        tools: s.tools, fatal: s.fatal,
        gitBash: { found: s.gitBash.path !== null, path: s.gitBash.path, how: s.gitBash.how, variable: variable(s.gitBash.variableSource), variableState: (s.gitBash.trail.find((t) => t.step === "variable") || {}).state, trail: s.gitBash.trail, starts: f.claude.bashStarts, onMachine: f.machine.gitInstalls.map((g) => ({ path: g.path, via: g.via })) },
        powershell: { setting: s.powershell.setting, state: s.powershell.state, why: s.powershell.why, unread: s.powershell.unread, variable: variable(s.powershell.variable), edition: s.powershell.edition, path: s.powershell.path, how: s.powershell.how },
        deny: s.deny, defaultShell: f.claude.settingsFacts.defaultShell, why: s.why, basis: "verified",
      };
    } else {
      const s = f.shells[id];
      out[id] = { tool: s.tool, state: s.state, shell: s.shell, args: s.args, how: s.how, basis: s.basis };
    }
  }
  return out;
}

const hookJson = (e) => ({ event: e.event, matcher: e.matcher, scope: e.scope, source: e.source, field: e.field, command: e.command, runner: { via: e.runner.via, exe: e.runner.exe, edition: e.runner.edition, args: e.runner.args, basis: e.runner.basis, why: e.runner.why }, bashReasons: e.reasons.map((r) => r.id), policy: e.policy, ps1: e.analysis.ps1 ? e.analysis.ps1.file : null, extensionless: e.flags.extensionless });

/** The JSON document of `check`. Paths are the paths of the system it ran on. */
export function checkJson(f) {
  if (f.applicable === false) return { ok: true, applicable: false, platform: f.platform, kind: f.kind, system: f.system, message: NOTHING(f.platform), findings: [], counts: f.counts };
  const base = { ok: f.counts.error + f.counts.warning === 0, applicable: true, platform: f.platform, kind: f.kind, project: f.project, agents: f.agents, system: f.system };
  if (f.kind === "wsl") return { ...base, inventory: inventoryJson(f), locations: f.locations, wslInherits: f.wslInherits, findings: f.findings.map(findingJson), counts: f.counts };
  const m = f.machine;
  return {
    ...base,
    machine: {
      windows: m.windows, mxc: m.mxc,
      powershell: m.powershell.editions.map((e) => ({ id: e.id, label: e.label, path: e.path, how: e.how, onPath: e.onPath, probe: e.probe || null })),
      git: m.git, gitInstalls: m.gitInstalls.map((g) => ({ path: g.path, via: g.via })), bash: m.bash,
      longPaths: m.longPaths, codePage: m.codePage, wsl: { available: m.wsl.available, distros: m.wsl.distros, defaultName: m.wsl.defaultName, workable: m.wsl.workable.map((d) => d.name), error: m.wsl.error },
      node: m.node, nodeWants: f.nodeWants,
    },
    inventory: inventoryJson(f),
    shells: shellJson(f),
    hooks: Object.fromEntries(f.agents.map((id) => [id, { files: f.hooks[id].files, entries: f.hooks[id].entries.map(hookJson) }])),
    ...(f.codex ? { codex: { home: f.codex.home, trusted: f.codex.trusted, sandbox: f.codex.sandbox, shellKeys: f.codex.shellKeys, files: f.codex.layerFiles } } : {}),
    ...(f.cursor && f.cursor.launcher ? { cursor: { launcher: { dir: f.cursor.launcher.dir, cmdFile: f.cursor.launcher.cmdFile, ps1File: f.cursor.launcher.ps1File, powershell: f.cursor.launcher.powershell, args: f.cursor.launcher.args, delayedExpansion: f.cursor.launcher.cmd.delayedExpansion, forwardsArgs: f.cursor.launcher.cmd.forwardsArgs, versionPattern: f.cursor.launcher.ps1 ? f.cursor.launcher.ps1.versionPattern : null, versions: f.cursor.launcher.versions, matching: f.cursor.launcher.matching, noVersionFolder: f.cursor.launcher.noVersionFolder }, msystem: f.cursor.msystem } } : {}),
    ...(f.gemini && f.gemini.pty ? { gemini: { pty: f.gemini.pty.map((p) => ({ pkgDir: p.pkgDir, found: p.found })) } } : {}),
    ...(f.claude.settings ? { claude: { settings: f.claude.settings, executionPolicy: f.claude.policy, indexLock: f.claude.indexLock, bashStarts: f.claude.bashStarts } } : {}),
    userEnv: f.userEnv,
    ...(f.live ? { live: liveJson(f.live) } : {}),
    findings: f.findings.map(findingJson),
    counts: f.counts,
  };
}

// ---- agents ------------------------------------------------------------------------------------------------------------------------

/** `agents`: the inventory alone. */
export function agentsText(f) {
  if (f.applicable === false) return `${header("nothing to check")}\n${NOTHING(f.platform)}\n`;
  return `${[header("every agent on this machine"), "", ...inventoryLines(f, { title: "Every agent on this machine" }).slice(1)].join("\n")}\n`;
}
export function agentsJson(f) {
  if (f.applicable === false) return { ok: true, applicable: false, platform: f.platform, message: NOTHING(f.platform), agents: {} };
  return { ok: true, applicable: true, platform: f.platform, agents: f.agents, inventory: inventoryJson(f), firsts: Object.fromEntries(f.agents.map((id) => [id, f.inventory.agents[id].first ? f.inventory.agents[id].first.path : null])) };
}

// ---- explain -----------------------------------------------------------------------------------------------------------------------

export function explainListText(pages) {
  const width = Math.max(...pages.map((p) => p.id.length));
  return `${pages.map((p) => `${p.id.padEnd(width)}   ${p.title}`).join("\n")}\n`;
}
export function explainListJson(pages) {
  return { ok: true, findings: pages };
}
export function explainText(p) {
  const label = AGENT_LABEL[p.id.split(".")[0]];
  const out = [`${p.id}   ${p.title}`, "", p.means, "", `What ${label} does`];
  for (const d of p.does) out.push(`  - ${d.source ? `(${d.source}) ` : ""}${d.text}`);
  out.push("", "The fix");
  for (const x of p.fix) out.push(`  - ${x}`);
  out.push("", p.issues.length ? "The issue and forum threads" : "The issue and forum threads: none found for this");
  for (const i of p.issues) out.push(`  #${i.number}  ${i.title}`, `        ${i.url}`);
  return `${out.join("\n")}\n`;
}
export function explainJson(p) {
  return { ok: true, id: p.id, agent: p.id.split(".")[0], basis: p.basis, title: p.title, means: p.means, does: p.does, fix: p.fix, issues: p.issues };
}

export { AGENT_IDS };
