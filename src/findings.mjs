// The findings: what is probably not what you meant, from the facts that src/check.mjs collected. Each has an id of the form <agent>.<name>
// (claude, codex, gemini, copilot or cursor; src/explain.mjs has a page for every id), a severity, a message, what the agent does about it, a fix,
// and a basis:
//   error    the agent does not start, or a tool of it is gone
//   warning  the agent works, but probably not the way you meant
//   note     worth knowing, nothing is lost
//   basis    verified (the real binary showed it in the tests), documented (the vendor's documentation, or a maintainer's words in its tracker or
//            forum), not verified
// "What the agent does" says only what the real binary was seen to do (README, "What was verified, and how"); where it comes from the
// documentation, or from Windows or git, the finding says so or leaves it out. The Claude Code findings are claude-windows-doctor's 27, with the
// agent in front of the id; the others are new.
import { BLOCKING } from "./facts.mjs";
import { AGENT_IDS, AGENT_LABEL, CLI_ORIGINS, COMMANDS, ORIGIN_TEXT, compareVersions } from "./inventory.mjs";
import { CONFIG_NAMES } from "./userenv.mjs";
import { GIT_BASH_VAR, PS_VAR } from "./claude-shell.mjs";
import { basisOf } from "./explain.mjs";
import { MXC_TEXT } from "./machine.mjs";

export const SEVERITY_ORDER = { error: 0, warning: 1, note: 2 };
const f = (id, severity, message, extra = {}) => ({ id, severity, agent: id.split(".")[0], message, effect: null, fix: null, basis: basisOf(id), ...extra });
const shown = (v) => (v === "" ? "(empty)" : v);
const age = (ms) => (ms === null || ms === undefined ? "" : ms < 90000 ? `${Math.round(ms / 1000)} seconds old` : ms < 5400000 ? `${Math.round(ms / 60000)} minutes old` : ms < 129600000 ? `${Math.round(ms / 3600000)} hours old` : `${Math.round(ms / 86400000)} days old`);
const list = (items, max = 3) => (items.length <= max ? items.join("; ") : `${items.slice(0, max).join("; ")}; and ${items.length - max} more`);

// ---- the programs of one agent ----------------------------------------------------------------------------------------------

// how to remove an install of each kind
const UNINSTALL = {
  claude: "winget uninstall Anthropic.ClaudeCode, npm uninstall -g @anthropic-ai/claude-code, or delete .local\\bin\\claude.exe for the native one",
  codex: "npm uninstall -g @openai/codex, or delete %LOCALAPPDATA%\\Programs\\OpenAI\\Codex for the standalone one",
  gemini: "npm uninstall -g @google/gemini-cli",
  copilot: "npm uninstall -g @github/copilot, or winget uninstall GitHub.Copilot",
  cursor: "uninstall one of them",
};

function inventoryFindings(agent, facts) {
  const out = [];
  const a = facts.inventory.agents[agent];
  if (!a) return out;
  const label = AGENT_LABEL[agent];
  const cmd = COMMANDS[agent][0];
  const entries = a.entries;
  const onPath = entries.filter((e) => e.onPath);
  const clis = entries.filter((e) => CLI_ORIGINS.has(e.origin) && e.kind === "program");
  const vtext = (e) => (e.version ? `, ${e.version}` : "");
  if (agent === "claude" && a.first && (a.first.origin === "desktop-launcher" || a.first.origin === "store-alias")) {
    out.push(f("claude.launcher-first", "warning", `The first claude on PATH is ${a.first.path}, ${ORIGIN_TEXT[a.first.origin]}.`, {
      effect: "Typing claude in a terminal starts that, not Claude Code's command line (this tool did not run it).",
      fix: "Put the folder of the claude command line you want before it on PATH, or remove the alias.",
    }));
  }
  if (!onPath.some((e) => e.kind === "program") && clis.length) {
    const e = clis[0];
    out.push(f(`${agent}.not-on-path`, "warning", `${label} is installed (${e.path}, ${ORIGIN_TEXT[e.origin]}${vtext(e)}), but its folder is not on PATH.`, {
      effect: `A terminal says "${cmd} is not recognized".`,
      fix: `Add ${e.dir} to the user PATH (System Properties, Environment Variables), then open a new terminal.`,
    }));
  }
  const distinct = clis.filter((e, i, all) => all.findIndex((x) => x.origin === e.origin && x.dir === e.dir) === i);
  if (distinct.length > 1) {
    out.push(f(`${agent}.multiple`, "warning", `${distinct.length} ${agent === "claude" ? "claude command lines" : `${label} command lines`} are installed: ${distinct.map((e) => `${e.path} (${ORIGIN_TEXT[e.origin]}${vtext(e)}${e.runsFirst ? ", runs first" : ""})`).join("; ")}.`, {
      effect: `A terminal runs ${a.first ? a.first.path : "the first one on PATH"}; each install updates itself, or not, by its own rules.`,
      fix: `Keep one: uninstall the others (${UNINSTALL[agent]}).`,
    }));
  }
  if (a.first && a.first.version) {
    const newer = clis.find((e) => e !== a.first && e.version && compareVersions(e.version, a.first.version) > 0);
    if (newer) {
      out.push(f(`${agent}.older-first`, "warning", `The ${cmd} that runs first on PATH is ${a.first.version} (${a.first.path}), and ${newer.path} is ${newer.version}.`, {
        effect: "A terminal starts the older one.",
        fix: `Put ${newer.dir} before ${a.first.dir} on PATH, or remove the older install.`,
      }));
    }
  }
  for (const e of onPath) {
    if (e.kind === "program" && !e.skipped && e.version === null && e.note) {
      out.push(f(`${agent}.no-version`, "warning", `${e.path} ${e.note}.`, { effect: `That ${cmd} does not run here.`, fix: "Reinstall it, or remove it from PATH." }));
    }
  }
  return out;
}

function nodeFindings(facts) {
  const out = [];
  const node = facts.machine.node;
  for (const w of facts.nodeWants || []) {
    if (w.ok !== false || !node || !node.npmFound) continue;
    const a = w.agent;
    const extra = {
      claude: { effect: "npm prints an EBADENGINE warning when it installs the package; the install completes (Claude Code's documentation), and the program is a native binary that does not use your Node at run time.", fix: "Nothing is needed for a claude that runs. For a clean install, use the Node the package asks for, or the native installer, which needs no Node." },
      codex: { effect: "npm prints an EBADENGINE warning when it installs the package. The shim of Codex CLI starts codex.js with your Node.", fix: "Use the Node that the package asks for, or the standalone installer." },
      gemini: { effect: "npm prints an EBADENGINE warning when it installs the package, and Gemini CLI is a JavaScript program that your Node runs: an older Node can stop on syntax it does not know (not tried here).", fix: "Use the Node that the package asks for." },
      copilot: { effect: "npm prints an EBADENGINE warning when it installs the package.", fix: "Use the Node that the package asks for." },
    }[a];
    if (!extra) continue;
    out.push(f(`${a}.node-for-npm`, "note", `Node is ${node.node}, and the npm package of ${AGENT_LABEL[a]} (${w.package}${w.version ? ` ${w.version}` : ""}) asks for Node ${w.range.replace(/^>=\s*/, "")} or later.`, extra));
  }
  return out;
}

// ---- Claude Code: claude-windows-doctor's findings ------------------------------------------------------------------------

function claudeFindings(facts) {
  const out = [];
  const c = facts.claude;
  const shell = facts.shells.claude;
  const gitList = facts.machine.gitInstalls || [];
  const { longPaths, git, codePage } = facts.machine;
  const { policy, indexLock, settingsFacts, bashStarts } = c;
  const bashVar = shell.gitBash.variableSource;
  const step = shell.gitBash.trail.find((t) => t.step === "variable");
  const found = gitList[0] ? gitList[0].path : null;
  const wslLauncher = (facts.machine.bash || []).find((b) => b.kind === "wsl-launcher");

  if (shell.fatal) {
    out.push(f("claude.no-shell-tool", "error", `Claude Code will not start: it found no Git Bash, and the PowerShell tool is off (${PS_VAR} is "${shell.powershell.variable.value.trim()}" in ${shell.powershell.variable.source}).`, {
      effect: 'Claude Code exits at start with "Claude Code on Windows requires a shell tool" (exit code 1) and sends nothing.',
      fix: found ? `Remove ${PS_VAR}=0, or point ${GIT_BASH_VAR} at ${found}: setx ${GIT_BASH_VAR} "${found}".` : `Remove ${PS_VAR}=0 from ${shell.powershell.variable.source}, or install Git for Windows.`,
    }));
  }
  if (step && (step.state === "not-found" || step.state === "not-bash")) {
    out.push(f("claude.git-bash-path-ignored", "warning", `${GIT_BASH_VAR} is "${step.value}" (${bashVar.source}), and Claude Code ignores it: ${step.state === "not-found" ? "there is no such file" : "the file is not named bash.exe, sh.exe, bash or sh"}.${step.hint ? ` ${step.hint[0].toUpperCase()}${step.hint.slice(1)}.` : ""}`, {
      effect: `Claude Code looks for Git Bash as if the variable were not set${shell.gitBash.path ? `, and found ${shell.gitBash.path}` : ", and found none, so the Bash tool is not offered"}.`,
      fix: found ? `Point it at ${found}: setx ${GIT_BASH_VAR} "${found}", then open a new terminal.` : "Set it to the full path of bash.exe, or remove it.",
    }));
  }
  for (const ig of bashVar.ignored || []) {
    out.push(f("claude.git-bash-path-project-settings", "warning", `${GIT_BASH_VAR} is set in the env of the ${ig.scope} settings (${ig.display}), which Claude Code does not use for it.`, {
      effect: "Only the process environment and the user settings count for this variable: the value there is not read, and Git Bash is looked for as if it were not set.",
      fix: found ? `Set it in the user environment instead: setx ${GIT_BASH_VAR} "${found}", then open a new terminal.` : "Put it in the env of your user settings.json, or in the user environment.",
    }));
  }
  if (!shell.gitBash.path && !shell.fatal && found && !(step && (step.state === "not-found" || step.state === "not-bash"))) {
    const wh = shell.gitBash.trail.find((t) => t.step === "where-git");
    let why;
    if (!wh || wh.lines === null) why = "where.exe could not look for git";
    else if (!wh.lines.length) why = "git.exe is not on PATH";
    else if (!wh.chosen) why = `no git.exe on PATH can be used (${(wh.skipped || []).map((s) => `${s.line}: ${s.reason}`).join("; ")})`;
    else why = `where git prints ${wh.chosen} first, and two folders up from it bin\\bash.exe would be ${wh.derived}, which is not there`;
    out.push(f("claude.git-bash-not-found", "warning", `Git for Windows is installed (${found}), but Claude Code does not find it: ${why}.`, {
      effect: `The Bash tool is not offered; the model gets ${shell.tools.PowerShell === "yes" ? "the PowerShell tool only" : "no shell tool"}. Claude Code looks at ${GIT_BASH_VAR}, then C:\\Program Files\\Git and C:\\Program Files (x86)\\Git, then the first git.exe that where.exe lists.`,
      fix: `Set ${GIT_BASH_VAR} for every program: setx ${GIT_BASH_VAR} "${found}"${wh && wh.chosen && /\\mingw64\\bin\\git\.exe$/i.test(wh.chosen) ? "; or put the Git cmd folder before mingw64\\bin on PATH" : ""}. Then open a new terminal.`,
    }));
  }
  if (bashStarts && bashStarts.checked && !bashStarts.ok) {
    out.push(f("claude.git-bash-broken", "warning", `Claude Code would use ${shell.gitBash.path}, but it does not start (${bashStarts.error}).`, {
      effect: "The Bash tool is offered, and every command through it fails.",
      fix: "Repair or reinstall Git for Windows (bin\\bash.exe starts usr\\bin\\bash.exe, and one of them is gone or blocked).",
    }));
  }
  if (shell.powershell.unread) {
    out.push(f("claude.powershell-variable-unread", "warning", `${PS_VAR} is "${shell.powershell.variable.value.trim()}" (${shell.powershell.variable.source}), which Claude Code reads as not set.`, {
      effect: "It is the same as not setting it. Claude Code reads 1, true, yes and on as on, and 0, false, no and off as off, in any case; anything else counts for nothing.",
      fix: "Write 1 or 0.",
    }));
  }
  for (const d of settingsFacts.defaultShell) {
    out.push(f("claude.default-shell-scope", "note", `defaultShell is "${d.value}" (${d.display}): it chooses the shell for the commands you type after ! in the prompt, not the tool the model gets.${d.valid ? "" : ' Claude Code takes only "bash" or "powershell" there.'}`, {
      effect: "The tools of the model's first request were the same with it and without it, with every value, in each state (put to the binary).",
      fix: `To change what the model gets, set ${PS_VAR} and ${GIT_BASH_VAR}.`,
    }));
  }
  if (shell.powershell.state === "yes" && shell.powershell.path && !shell.powershell.core) {
    out.push(f("claude.powershell-5", "note", "The PowerShell tool will run Windows PowerShell 5.1: no pwsh (PowerShell 7) was found.", {
      effect: "The tool's own description tells the model that && and || are not available there, and that > and Out-File write the system code page unless told otherwise.",
      fix: "Install PowerShell 7 (winget install Microsoft.PowerShell): Claude Code uses pwsh when it finds it.",
    }));
  }
  if (wslLauncher && !shell.gitBash.path) {
    out.push(f("claude.wsl-bash-on-path", "note", `bash.exe on PATH is the WSL launcher (${wslLauncher.path}), not a Git Bash.`, {
      effect: "Claude Code does not use it: with no variable and no git it offered the PowerShell tool only.",
      fix: "Install Git for Windows for a Bash tool, or leave it: the PowerShell tool does the work.",
    }));
  }
  if (longPaths && ((longPaths.ok && longPaths.enabled === false) || (git && git.ok && !(git.longpaths && git.longpaths.value === "true")))) {
    const parts = [];
    if (longPaths.ok && longPaths.enabled === false) parts.push("Windows' LongPathsEnabled is off");
    if (git && git.ok && !(git.longpaths && git.longpaths.value === "true")) parts.push(`git's core.longpaths is ${git.longpaths ? git.longpaths.value : "not set"}`);
    out.push(f("claude.long-paths", "note", `Paths longer than 260 characters: ${parts.join(" and ")}.`, {
      effect: "From Windows' and git's documentation: a program that does not ask for long paths (git, npm, a compiler run through the shell) fails on a deep node_modules or build folder. Claude Code's own file tools wrote a file at a path of more than 300 characters (put to the binary; LongPathsEnabled was on).",
      fix: `${longPaths.ok && longPaths.enabled === false ? "Turn on LongPathsEnabled (an administrator: reg add HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem /v LongPathsEnabled /t REG_DWORD /d 1 /f). " : ""}${git && git.ok && !(git.longpaths && git.longpaths.value === "true") ? "git config --global core.longpaths true." : ""}`.trim(),
    }));
  }
  if (git && git.ok && git.autocrlf && git.autocrlf.value === "true") {
    out.push(f("claude.autocrlf", "note", `git's core.autocrlf is true (${git.autocrlf.origin}).`, {
      effect: "Claude Code's Write tool wrote a new file with LF only and its Edit tool kept the CRLF of a file it changed (put to the binary). git converts line endings when it adds and checks out files, and warns \"LF will be replaced by CRLF\".",
      fix: "Nothing is wrong. To stop the conversion in a repository, set core.autocrlf false there and a .gitattributes with the endings you want.",
    }));
  }
  if (policy && policy.ok && policy.effective) {
    const eff = policy.effective;
    if (BLOCKING.has(eff.policy) && !eff.bypassed) {
      out.push(f("claude.execution-policy", "warning", `The PowerShell execution policy is ${eff.policy} (${eff.scope}${eff.scope === "MachinePolicy" || eff.scope === "UserPolicy" ? ", set by Group Policy" : ""}), and Claude Code's PowerShell will not run .ps1 scripts.`, {
        effect: policy.respect ? "CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY is on, so Claude Code no longer passes -ExecutionPolicy Bypass (put to the binary)." : "Claude Code starts PowerShell with -ExecutionPolicy Bypass at process scope (put to the binary), and a policy set by Group Policy still wins over it (its documentation).",
        fix: policy.respect ? "Remove CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY, or set a CurrentUser policy of RemoteSigned." : "Ask who manages the policy, or run scripts as commands (pwsh -File needs the policy too).",
      }));
    }
  }
  if (codePage && codePage.ok && codePage.active !== 65001 && shell.tools.Bash) {
    out.push(f("claude.code-page", "note", `The console's code page is ${codePage.active}${codePage.oem ? ` (the system's OEM code page is ${codePage.oem})` : ""}, not UTF-8 (65001).`, {
      effect: "Output of a Windows program that prints in the console's code page, run through the Bash tool, reaches the model with replacement characters for anything that is not ASCII: cmd /c dir printed caf?-?ber.txt for café-über.txt under 437. The PowerShell tool sets 65001 and printed it right (put to the binary).",
      fix: "Run Windows programs through the PowerShell tool, or start Claude Code from a terminal set to UTF-8 (chcp 65001; not tried here).",
    }));
  }
  if (indexLock && indexLock.lock && indexLock.lock.gitRunning === false) {
    out.push(f("claude.index-lock", "warning", `${indexLock.lock.path} exists (${age(indexLock.lock.ageMs)}) and no git process is running.`, {
      effect: 'git commands in this repository fail with "Unable to create index.lock: File exists" until it is removed (git\'s behaviour).',
      fix: `Delete it: del "${indexLock.lock.path}".`,
    }));
  }
  const userEnv = facts.userEnv;
  if (userEnv && userEnv.ok) {
    for (const e of userEnv.entries) {
      const val = (side) => (side && side.value !== undefined ? ` (${shown(side.value)})` : "");
      if (e.status === "user-only") {
        out.push(f("claude.user-env-not-in-process", "warning", `${e.name}${val(e.user)} is set in the Windows user environment, but not in this process.`, {
          effect: "A program reads the user environment once, when it starts: this terminal, and the desktop app or an editor that started before the variable was set, do not have it.",
          fix: "Open a new terminal, or restart the app, and run this again.",
        }));
      } else if (e.status === "differs") {
        out.push(f("claude.user-env-differs", "warning", `${e.name} is not the same in the Windows user environment${val(e.user)} and in this process${val(e.process)}.`, {
          effect: "Programs started from the Start menu get the first, programs started from this terminal the second.",
          fix: "Set it once, in the user environment, and open a new terminal.",
        }));
      } else if (e.status === "process-only" && CONFIG_NAMES.includes(e.name.toUpperCase())) {
        out.push(f("claude.process-env-not-in-user", "note", `${e.name}${val(e.process)} is set in this process only, not in the Windows user environment.`, {
          effect: "Other terminals, the desktop app and the editors do not have it.",
          fix: `Set it in the user environment if you want it everywhere: setx ${e.name} <value>.`,
        }));
      }
    }
  }
  const wsl = facts.machine.wsl;
  if (wsl && wsl.available && wsl.workable.length === 0) {
    out.push(f("claude.wsl-no-distro", "note", `WSL has only distributions that other tools made for themselves (${wsl.distros.map((d) => d.name).join(", ")}${wsl.defaultName ? `; the default is ${wsl.defaultName}` : ""}): there is no Linux distribution to run Claude Code in.`, {
      effect: "The bash.exe launcher in System32 and wsl.exe open the default distribution, which is not one to work in.",
      fix: "wsl --install -d Ubuntu, if you want Claude Code in WSL. Nothing is needed otherwise.",
    }));
  }
  const inherit = (settingsFacts.wslInherits || []).find((w) => w.value === true || w.value === "true");
  if (inherit) {
    out.push(f("claude.wsl-inherits-windows", "note", `wslInheritsWindowsSettings is on (${inherit.source}): Claude Code in WSL reads the managed settings of Windows.`, {
      effect: "From the documentation: WSL reads /etc/claude-code only when no Windows admin document is present. This was not put to the binary.",
      fix: "Nothing, unless a WSL session behaves like the Windows policy.",
    }));
  }
  return out;
}

/** The findings of a claude run inside WSL, and of Codex's home there. */
export function wslFindings(facts) {
  const out = [];
  const { locations, wslInherits } = facts;
  const claude = facts.inventory && facts.inventory.agents.claude;
  if (claude && claude.first && claude.first.origin === "windows") {
    out.push(f("claude.wsl-windows-claude", "warning", `The claude that runs in this WSL distribution is a Windows program: ${claude.first.path}.`, {
      effect: "It is the Windows Claude Code started through WSL: it sees Windows' folders and settings, not this distribution's, and the Bash tool runs Git Bash on Windows, not this shell.",
      fix: "Install Claude Code inside the distribution (curl -fsSL https://claude.ai/install.sh | bash) and put ~/.local/bin before the /mnt/c folders on PATH.",
    }));
  }
  if (locations) {
    if (locations.configOnWindows) {
      out.push(f("claude.wsl-config-on-mnt", "warning", `The config folder is on a Windows drive (${locations.configDir}, from ${locations.configSource}).`, {
        effect: "Files on /mnt/c go through a network-like bridge, which is much slower for the many small files of transcripts and settings (WSL's documentation; not timed here).",
        fix: "Keep the config folder in the Linux home (~/.claude), and the projects there too.",
      }));
    } else if (locations.projectOnWindows) {
      out.push(f("claude.wsl-config-on-mnt", "warning", `The project is on a Windows drive (${locations.project}).`, {
        effect: "Files on /mnt/c go through a network-like bridge: git, searches and builds are much slower than in the Linux home (WSL's documentation; not timed here).",
        fix: "Clone the project into the Linux home (~/code) and work there.",
      }));
    }
  }
  const inherit = (wslInherits || []).find((w) => w.value === true || w.value === "true");
  if (inherit) {
    out.push(f("claude.wsl-inherits-windows", "note", `wslInheritsWindowsSettings is on (${inherit.source}): Claude Code in WSL reads the managed settings of Windows.`, { effect: "From the documentation; not put to the binary.", fix: "Nothing, unless a session here behaves like the Windows policy." }));
  }
  if (facts.codexHome && /^\/mnt\/[a-z]\//i.test(facts.codexHome.dir)) {
    out.push(f("codex.home-wsl", "note", `CODEX_HOME is on a Windows drive (${facts.codexHome.dir}).`, {
      effect: "From the issue: Codex in WSL mode uses the Windows CODEX_HOME inside WSL (openai/codex#13762), so the Windows configuration, rules and sessions are read through /mnt/c. This was not put to the binary.",
      fix: "Unset CODEX_HOME in the Windows user environment, or give WSL its own (export CODEX_HOME=~/.codex in the distribution).",
    }));
  }
  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

// ---- the other agents ---------------------------------------------------------------------------------------------------------

function codexFindings(facts) {
  const out = [];
  const c = facts.codex;
  if (!c) return out;
  const sb = c.sandbox;
  const cfgFile = `${c.home.dir}\\config.toml`;
  if (sb.selection === "none" && sb.mode.downgraded) {
    out.push(f("codex.sandbox-none", "warning", `No Windows sandbox is selected for Codex CLI (windows.sandbox and features.prefer_mxc are not set in ${cfgFile}), so the sandbox mode ${sb.mode.asked ? `"${sb.mode.asked}"` : "workspace-write, the default of a trusted project,"} becomes read-only.`, {
      effect: `The header of codex exec said "sandbox: read-only" and the sandbox log said "Windows sandbox selection: disabled" (put to Codex 0.163.0). The documentation says that with none selected Codex prefers elevated, whose setup needs an administrator.`,
      fix: sb.mxc.supported === false ? `[windows] sandbox = "unelevated" in ${cfgFile} (this Windows is too old for MXC: ${sb.mxc.why}).` : `[features] prefer_mxc = true in ${cfgFile} (Windows 11 at or above ${MXC_TEXT}), or [windows] sandbox = "unelevated". Run codex doctor for the rest of the install.`,
    }));
  }
  if ((sb.configured === "mxc" || sb.preferMxc) && (sb.mxcAvailable === false || sb.mxc.supported === false)) {
    out.push(f("codex.mxc-unavailable", "warning", `${sb.configured === "mxc" ? 'windows.sandbox = "mxc"' : "features.prefer_mxc = true"} is set, and MXC is not available here: ${sb.mxcAvailable === false && sb.mxc.supported !== false ? "the sandbox log of Codex says \"MXC availability: false\"" : sb.mxc.why}.`, {
      effect: sb.configured === "mxc" ? "From the documentation: an explicit mxc fails when MXC is unavailable." : "From the documentation, prefer_mxc keeps the legacy sandbox when MXC is not available; Codex 0.163.0 selected nothing (\"Windows sandbox selection: disabled\") on a Windows Server 2025 build 26100 (codex-config-doctor).",
      fix: `Update Windows to ${MXC_TEXT} or later, or choose [windows] sandbox = "unelevated" or "elevated".`,
    }));
  }
  for (const k of c.shellKeys) {
    out.push(f("codex.shell-path-ignored", "warning", `${k.key} is set in ${k.file}, and Codex CLI does not have that key.`, {
      effect: "codex exec --strict-config stops with: unknown configuration field `windows.shell_path`; without it the key is ignored and the model's commands ran in PowerShell all the same (put to Codex 0.163.0). The key is proposed in openai/codex#16579.",
      fix: "Remove the key. Codex has no setting for its shell on Windows; to run a command in Git Bash, start Git Bash from PowerShell: & 'C:\\Program Files\\Git\\bin\\bash.exe' -lc '...'.",
    }));
  }
  const home = c.wsl;
  if (home && (home.processHome || home.userHome) && home.workable > 0) {
    const where = home.userHome ? `the Windows user environment (${home.userHome})` : `this process (${home.processHome})`;
    out.push(f("codex.home-wsl", "note", `CODEX_HOME is set in ${where}, and this machine has a WSL distribution.`, {
      effect: "From the issue: Codex in WSL mode uses the Windows CODEX_HOME inside WSL (openai/codex#13762). This was not put to the binary.",
      fix: "If you use Codex in WSL mode, check which folder it reads; give the distribution its own CODEX_HOME if it should not share the Windows one.",
    }));
  }
  return out;
}

function geminiFindings(facts) {
  const out = [];
  const s = facts.shells.gemini;
  if (s && s.state === "missing") {
    out.push(f("gemini.powershell-not-on-path", "error", "Neither pwsh.exe nor powershell.exe is on PATH, and Gemini CLI starts its shell tool through PATH.", {
      effect: 'run_shell_command answered {"error":"spawn powershell.exe ENOENT"} (put to Gemini CLI 0.64.0).',
      fix: "Put C:\\Windows\\System32\\WindowsPowerShell\\v1.0 on PATH, then open a new terminal.",
    }));
  }
  const edition = s && s.shell ? facts.machine.powershell.editions.find((e) => e.path && s.shell.path && e.path.toLowerCase() === s.shell.path.toLowerCase()) : null;
  const mode = edition && edition.probe && edition.probe.ok ? edition.probe.languageMode : null;
  if (mode && mode !== "FullLanguage") {
    out.push(f("gemini.constrained-language-mode", "error", `PowerShell runs in ${mode} here (${s.shell.path}), and Gemini CLI's shell tool starts that PowerShell.`, {
      effect: "From the issue: every command failed under Constrained Language Mode (google-gemini/gemini-cli#12519, closed as not planned). This was not put to the binary: the mode is set by a policy of the machine, which this tool never changes.",
      fix: "Ask who manages the machine about the application control policy (WDAC or AppLocker) that sets the mode, or run Gemini CLI where PowerShell is in FullLanguage mode (WSL).",
    }));
  }
  for (const p of facts.gemini ? facts.gemini.pty : []) {
    if (!p.found) {
      out.push(f("gemini.node-pty-missing", "warning", `The Gemini CLI at ${p.pkgDir} has no node-pty binary (looked for conpty.node under @lydell\\node-pty-win32-x64 and node-pty).`, {
        effect: "From the issue: Gemini CLI cannot open a pseudo-terminal for its shell commands without it (google-gemini/gemini-cli#16003). This was not put to the binary.",
        fix: "Reinstall: npm install -g @google/gemini-cli (the optional dependency @lydell/node-pty-win32-x64 did not install).",
      }));
    }
  }
  return out;
}

function copilotFindings(facts) {
  const out = [];
  const s = facts.shells.copilot;
  if (s && s.state === "missing") {
    out.push(f("copilot.powershell-not-on-path", "error", "Neither pwsh.exe nor powershell.exe is on PATH, and Copilot CLI starts the powershell tool through PATH.", {
      effect: 'The tool answers: PowerShell is not available. Tried "pwsh.exe", "powershell.exe". ... spawn pwsh.exe ENOENT; powershell.exe: Error: spawn powershell.exe ENOENT (put to Copilot CLI 1.0.98). The tool is still listed to the model.',
      fix: "Put C:\\Windows\\System32\\WindowsPowerShell\\v1.0 on PATH, then open a new terminal.",
    }));
  }
  if (s && s.state === "ok" && s.shell && !s.shell.core) {
    out.push(f("copilot.pwsh-missing", "note", "No pwsh.exe is on PATH. The README of Copilot CLI asks for PowerShell 6 or newer on Windows.", {
      effect: "Copilot CLI 1.0.98 ran its powershell tool in Windows PowerShell 5.1 (put to the binary), where && and || do not exist. Issues #411 and #2355 are reports of the tool failing for want of pwsh.exe.",
      fix: "winget install Microsoft.PowerShell, then open a new terminal.",
    }));
  }
  const hooks = (facts.hooks.copilot && facts.hooks.copilot.entries) || [];
  const bashOnly = hooks.filter((h) => h.field === "bash" && !h.powershell);
  if (bashOnly.length) {
    const kind = bashOnly[0].runner.bashKind;
    const blocksCalls = bashOnly.some((h) => /^(preToolUse|PreToolUse|pre_tool_use)$/.test(h.event)) && kind !== "git-bash";
    out.push(f("copilot.hook-bash-only", kind === "git-bash" ? "note" : blocksCalls ? "error" : "warning", `${bashOnly.length} hook${bashOnly.length === 1 ? " has" : "s have"} a bash field and no powershell field (${list(bashOnly.map((h) => `${h.event} in ${h.source}`))}); on Windows Copilot CLI starts ${kind === "git-bash" ? "the Git Bash on PATH" : kind === "wsl-launcher" ? "the first bash on PATH, which is the WSL launcher" : "bash from PATH, and there is none"}.`, {
      effect: kind === "git-bash" ? "The hook ran through that bash (put to Copilot CLI 1.0.98)." : 'The hook errored, did not run, and Copilot CLI answered the tool call with: Denied by preToolUse hook from "<file>" (hook errored) (put to Copilot CLI 1.0.98).',
      fix: "Add a powershell field (or exec and args, which start the program with no shell) beside the bash field.",
    }));
  }
  const claudeHooks = hooks.filter((h) => h.claudeFormat);
  if (claudeHooks.length) {
    const withVar = claudeHooks.filter((h) => h.reasons.some((r) => r.id === "variable"));
    out.push(f("copilot.claude-hooks", withVar.length || claudeHooks.some((h) => h.flags.bashSyntax) ? "warning" : "note", `Copilot CLI also runs the ${claudeHooks.length} hook${claudeHooks.length === 1 ? "" : "s"} of the project's .claude/settings.json (${list(claudeHooks.map((h) => `${h.event}: ${h.command}`))}), through PowerShell${withVar.length ? `, where ${withVar[0].reasons.find((r) => r.id === "variable").text.split(" is ")[0]} is empty` : ""}.`, {
      effect: "It ran the command of a Claude Code hook in .claude/settings.json with \"powershell.exe\" -nop -nol -c, and $CLAUDE_PROJECT_DIR was an empty PowerShell variable, while the environment variable CLAUDE_PROJECT_DIR was set (put to Copilot CLI 1.0.98; github/copilot-cli#4001).",
      fix: "Write the command so that PowerShell and bash both read it (node \"hooks/check.mjs\", with no shell variable), or use $env:CLAUDE_PROJECT_DIR for PowerShell.",
    }));
  }
  return out;
}

function cursorFindings(facts) {
  const out = [];
  const c = facts.cursor;
  if (!c) return out;
  const l = c.launcher;
  if (l && l.cmd.hardcoded51 && l.cmd.forwardsArgs) {
    out.push(f("cursor.launcher-quotes", "warning", `The Cursor CLI launcher (${l.cmdFile}) starts Windows PowerShell 5.1 with ${l.cmd.delayedExpansion ? "delayed expansion on and " : ""}%* for the arguments, which drops a double quote and eats an exclamation mark.`, {
      effect: `From the forum (thread 168416, staff: "What you're seeing isn't intended behavior"): the quotes of an argument are dropped and ! is removed by cmd.exe before PowerShell starts. This tool read the launcher on disk and did not run it.`,
      fix: "Avoid \" and ! in what you pass to agent, or start it the way a staff member suggested: run the node.exe of the newest folder in the versions folder directly with its index.js.",
    }));
  }
  if (l && l.noVersionFolder) {
    out.push(f("cursor.launcher-no-version", "error", `The Cursor CLI launcher (${l.ps1File}) picks a version folder whose name matches ${l.ps1.versionPattern}, and ${l.versions.length ? `none of the ${l.versions.length} folder${l.versions.length === 1 ? "" : "s"} in ${l.dir}\\versions (${list(l.versions)}) does` : "there is no folder in versions"}.`, {
      effect: 'By its own script the launcher stops with "No version directories found" (the pattern from the file, tested against the folder names with the rule of PowerShell\'s -match; the launcher was not run).',
      fix: "Run the node.exe in the newest folder of versions directly: <folder>\\node.exe <folder>\\index.js, or reinstall the Cursor CLI.",
    }));
  }
  if (c.msystem && c.installed && c.hooksPresent) {
    out.push(f("cursor.msystem", "warning", `MSYSTEM is "${c.msystem}" in this environment (a Git Bash terminal), and hooks are configured that Cursor would run.`, {
      effect: "From the forum (thread 168129, reproduced by staff): the Cursor CLI composes a hook command as PowerShell and, when Git Bash markers such as MSYSTEM are present, runs it with bash, so the hook fails and every tool call is blocked without a message.",
      fix: "Start the Cursor CLI from a terminal that is not Git Bash, or unset MSYSTEM for it.",
    }));
  }
  const hooks = (facts.hooks.cursor && facts.hooks.cursor.entries) || [];
  if (hooks.length) {
    out.push(f("cursor.hook-stdin-bom", "note", `${hooks.length} Cursor hook${hooks.length === 1 ? "" : "s"} (${list(hooks.map((h) => `${h.event} in ${h.source}`), 2)}): on Windows the JSON on a hook's stdin starts with a UTF-8 byte order mark.`, {
      effect: "From the forum (thread 168407, staff): a hook that parses stdin with a plain JSON.parse fails, and one that falls back to allow in its catch block never blocks anything. Not put to the binary.",
      fix: "Strip the mark before parsing: text.replace(/^\\uFEFF/, \"\").",
    }));
  }
  return out;
}

// ---- hooks, for every agent ------------------------------------------------------------------------------------------------------

function hookFindings(agent, facts) {
  const out = [];
  const label = AGENT_LABEL[agent];
  const hooks = ((facts.hooks[agent] && facts.hooks[agent].entries) || []).filter((h) => !h.claudeFormat);
  const where = (h) => `${h.event} in ${h.source}`;
  const bash = hooks.filter((h) => h.flags.bashSyntax);
  if (bash.length) {
    out.push(f(`${agent}.hook-bash-syntax`, "warning", `${bash.length} hook command${bash.length === 1 ? " looks" : "s look"} like bash, and ${label} runs ${bash.length === 1 ? "it" : "them"} through PowerShell${bash[0].runner.why ? ` (${bash[0].runner.why})` : ""}: ${list(bash.map((h) => `${where(h)}: ${h.command} (${h.reasons.map((r) => r.text).join("; ")})`), 2)}.`, {
      effect: agent === "claude" ? "Claude Code ran its hook command with powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command when it found no Git Bash (put to the binary), so bash syntax is a PowerShell error." : agent === "copilot" ? "A $NAME in a command was an empty PowerShell variable (put to Copilot CLI 1.0.98), and the other bash constructs are errors in PowerShell." : agent === "cursor" ? "From the forum: Cursor composes the hook as PowerShell. Not put to the binary." : `${label} ran its hook command through PowerShell (put to the binary), so bash syntax is a PowerShell error or an empty variable.`,
      fix: "Write the hook as one program and its arguments (node \"hooks/check.mjs\"), which both shells read the same way; use $env:NAME for a variable, and one command per line instead of && in Windows PowerShell 5.1.",
    }));
  }
  const ps1 = hooks.filter((h) => h.flags.ps1Blocked);
  if (ps1.length) {
    out.push(f(`${agent}.hook-ps1-policy`, "warning", `${ps1.length} hook${ps1.length === 1 ? " runs" : "s run"} a .ps1 script (${list(ps1.map((h) => `${where(h)}: ${h.command}`), 2)}), and the execution policy of ${ps1[0].runner.edition === "7" ? "PowerShell 7" : "Windows PowerShell 5.1"} is ${ps1[0].policy}.`, {
      effect: `${label} starts the hook with a PowerShell that does not pass -ExecutionPolicy Bypass, so the policy applies and the script does not run: "running scripts is disabled on this system". ${agent === "copilot" ? "A failing preToolUse hook denies the tool call (put to Copilot CLI 1.0.98)." : agent === "codex" ? "Codex CLI lets the call run when a hook fails (put to the binary)." : "Not put to the binary."}`,
      fix: `Start the script with -ExecutionPolicy Bypass in the hook command (powershell -ExecutionPolicy Bypass -File hook.ps1), or set the CurrentUser policy to RemoteSigned.`,
    }));
  }
  const bare = hooks.filter((h) => h.flags.extensionless);
  if (bare.length) {
    out.push(f(`${agent}.hook-extensionless`, "warning", `${bare.length} hook command${bare.length === 1 ? " starts" : "s start"} a file that has no extension (${list(bare.map((h) => `${where(h)}: ${h.flags.extensionless}`), 2)}).`, {
      effect: "On Windows PowerShell does not start an extensionless script (it is not a program, and no program is associated with it). From the forum, an extensionless launcher opens the Open With dialog (Cursor, AgentParty #1123). Not put to the binary.",
      fix: "Give the file an extension that Windows knows (.cmd, .bat, .ps1, .exe), or start it with its interpreter: node \"hooks/check.mjs\".",
    }));
  }
  return out;
}

function codexHookFindings(facts) {
  const out = [];
  const hooks = (facts.hooks.codex && facts.hooks.codex.entries) || [];
  if (!hooks.length) return out;
  const blocking = hooks.filter((h) => /^(PreToolUse|PermissionRequest|UserPromptSubmit)$/.test(h.event));
  if (blocking.length) {
    out.push(f("codex.hook-exit-2", "note", `${blocking.length} Codex hook${blocking.length === 1 ? "" : "s"} can block (${list(blocking.map((h) => `${h.event} in ${h.source}`), 2)}), and on Windows a hook that exits with code 2 does not.`, {
      effect: "The documentation says exit code 2 blocks a PreToolUse call. Codex CLI 0.163.0 on Windows ran the command all the same, for exit codes 2 and 1: PowerShell turns the code into 1. A hook that prints JSON with permissionDecision deny (or decision block) on stdout and exits 0 did block (put to the binary).",
      fix: "Block with JSON: {\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"...\"}} on stdout, and exit 0.",
    }));
  }
  const user = hooks.filter((h) => h.scope !== "managed");
  if (user.length) {
    out.push(f("codex.hook-trust", "note", `${user.length} Codex hook${user.length === 1 ? "" : "s"} (${list(user.map((h) => `${h.event} in ${h.source}`), 2)}) run only after you have reviewed and trusted ${user.length === 1 ? "it" : "them"}.`, {
      effect: "A hook that had not been trusted did not run, and the command it guarded ran (put to Codex CLI 0.163.0); with --dangerously-bypass-hook-trust it ran. Codex records trust against each hook's hash, so a changed hook is skipped until it is reviewed again.",
      fix: "Review them in the CLI with /hooks. Managed hooks (requirements.toml) are trusted by policy.",
    }));
  }
  return out;
}

/** The findings of the Windows setup. `facts` is what collectWindows returns. */
export function windowsFindings(facts) {
  const out = [];
  const sel = new Set(facts.agents);
  if (sel.has("claude")) out.push(...claudeFindings(facts));
  for (const a of AGENT_IDS) if (sel.has(a)) out.push(...inventoryFindings(a, facts));
  out.push(...nodeFindings({ ...facts, nodeWants: (facts.nodeWants || []).filter((w) => sel.has(w.agent)) }));
  if (sel.has("codex")) out.push(...codexFindings(facts), ...codexHookFindings(facts));
  if (sel.has("gemini")) out.push(...geminiFindings(facts));
  if (sel.has("copilot")) out.push(...copilotFindings(facts));
  if (sel.has("cursor")) out.push(...cursorFindings(facts));
  for (const a of AGENT_IDS) if (sel.has(a)) out.push(...hookFindings(a, facts));
  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function countFindings(findings) {
  const c = { error: 0, warning: 0, note: 0 };
  for (const x of findings) c[x.severity]++;
  return c;
}
