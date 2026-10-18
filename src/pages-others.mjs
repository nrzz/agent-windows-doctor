// The explain pages of the findings that are new here: the generic ones for every agent (the programs of the agent, its hooks) and the ones of Codex
// CLI, Gemini CLI, GitHub Copilot CLI and Cursor. Each line of `does` is marked V (seen in a real run of the binary, Codex CLI 0.163.0, Gemini CLI
// 0.64.0 and Copilot CLI 1.0.98 on Windows 11, Claude Code 2.1.302; test/e2e-*.test.mjs), D (documentation, or the words of a maintainer in a tracker or
// the forum) or N (not verified here).
export const GH = (repo, n, title) => ({ number: n, title, url: `https://github.com/${repo}/issues/${n}` });
const CODEX = (n, title) => GH("openai/codex", n, title);
const GEMINI = (n, title) => GH("google-gemini/gemini-cli", n, title);
const COPILOT = (n, title) => GH("github/copilot-cli", n, title);
const CURSOR = (n, title) => ({ number: n, title, url: `https://forum.cursor.com/t/${n}` });

const LABEL = { claude: "Claude Code", codex: "Codex CLI", gemini: "Gemini CLI", copilot: "GitHub Copilot CLI", cursor: "Cursor" };
const CMD = { claude: "claude", codex: "codex", gemini: "gemini", copilot: "copilot", cursor: "agent" };
const UNINSTALL = {
  codex: "npm uninstall -g @openai/codex, or delete %LOCALAPPDATA%\\Programs\\OpenAI\\Codex for the standalone one",
  gemini: "npm uninstall -g @google/gemini-cli",
  copilot: "npm uninstall -g @github/copilot, or winget uninstall GitHub.Copilot",
  cursor: "the installer that put the second one there",
};
const WHERE = {
  codex: "npm's shim codex.cmd (in the npm prefix, usually %APPDATA%\\npm) and the program it starts in @openai\\codex-win32-x64\\vendor\\<target>\\bin\\codex.exe; the standalone installer's %LOCALAPPDATA%\\Programs\\OpenAI\\Codex\\bin\\codex.exe; the Codex desktop app's copy at <Microsoft Store package OpenAI.Codex>\\app\\resources\\codex.exe",
  gemini: "npm's shim gemini.cmd, which starts bundle\\gemini.js of @google/gemini-cli with node",
  copilot: "npm's shim copilot.cmd, which starts npm-loader.js, which starts copilot.exe of @github/copilot-win32-x64; WinGet's GitHub.Copilot; the package that copilot.exe unpacks for itself under %LOCALAPPDATA%\\copilot\\pkg\\win32-x64\\<version>",
  cursor: "the Cursor CLI installer's %LOCALAPPDATA%\\cursor-agent (agent.cmd, cursor-agent.cmd, their .ps1 files and versions\\<version>), and the editor itself under %LOCALAPPDATA%\\Programs\\cursor",
};

function inventoryPages(agent) {
  const label = LABEL[agent];
  const cmd = CMD[agent];
  return [
    {
      id: `${agent}.not-on-path`, basis: "verified", title: `${label} is installed and its folder is not on PATH`,
      means: `The installer put ${cmd} somewhere that PATH does not list, so a terminal does not know the command.`,
      does: [
        `V: this tool looks for ${label} on PATH in the order a shell looks (each folder in turn, the extensions of PATHEXT in their order) and in the places the installers use: ${WHERE[agent]}.`,
        `D: a program that is not in a PATH folder is found by a full path only.`,
      ],
      fix: ["Add the folder to the user PATH (System Properties, Environment Variables, Path, New), then open a new terminal."],
      issues: [],
    },
    {
      id: `${agent}.multiple`, basis: "documented", title: `More than one ${label} command line is installed`,
      means: `${label} can be installed in more than one way, and the installs do not know of each other.`,
      does: [
        `V: this tool lists them with where each came from, its version (read from the package, the file or the folder name; check --live asks the program) and which one a shell runs first.`,
        `D: each install updates itself, or not, by its own rules; the one a terminal starts is the first on PATH.`,
      ],
      fix: [`Keep one: ${UNINSTALL[agent]}.`],
      issues: agent === "codex" ? [CODEX(13993, "Support standalone Windows installer (`codex-setup.exe`) (open, 265 reactions)")] : [],
    },
    {
      id: `${agent}.older-first`, basis: "verified", title: `The ${cmd} that runs first is older than another one`,
      means: "PATH lists the folder of an older install before the folder of a newer one.",
      does: ["V: the order is that of PATH and PATHEXT, which this tool reads the way where.exe does (test/windows.test.mjs compares the two on the real machine); the versions are read from disk, or asked of the program with --live."],
      fix: ["Put the newer one's folder first, or remove the older install."],
      issues: [],
    },
    {
      id: `${agent}.no-version`, basis: "verified", title: `The ${label} command on PATH does not print a version`,
      means: "With --live, the program was asked for --version and did not answer with one, or does not run.",
      does: ["V: the line says what happened: it could not start, did not answer in 30 seconds, or printed no version."],
      fix: ["Reinstall it, or take its folder off PATH."],
      issues: [],
    },
  ];
}

function nodePage(agent, text) {
  return {
    id: `${agent}.node-for-npm`, basis: "verified", title: `Node is older than the npm package of ${LABEL[agent]} wants`,
    means: `The npm package of ${LABEL[agent]} says in its package.json which Node it wants (its engines.node).`,
    does: [`V: this tool reads engines.node from the package.json of the installed package (${text}) and compares it with the Node that runs this tool.`, "D: on an older Node npm prints an EBADENGINE warning when it installs the package; the install completes."],
    fix: ["Use the Node the package asks for."],
    issues: [],
  };
}

const HOOK = {
  claude: {
    shell: "Claude Code runs a hook command through Git Bash when it finds one, and through PowerShell (with -ExecutionPolicy Bypass) when it does not",
    run: [
      'V: with Git Bash found, the command line of the process that started a hook was "...\\usr\\bin\\bash.exe" -c "<command>"; with none, powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "<command>"; a hook with "shell": "powershell" got the second whatever Git Bash was there (Claude Code 2.1.302).',
      'V: without Git Bash, a hook whose command was `node "hook.mjs" PreToolUse && echo done` failed with PowerShell\'s parser error ("The token \'&&\' is not a valid statement separator in this version"), and Claude Code blocked the tool call: "blocking because Git Bash wasn\'t found and this hook doesn\'t set \\"shell\\" to \\"powershell\\", so only exit code 0 or 2 counts as its verdict" (2.1.302).',
    ],
  },
  codex: {
    shell: "Codex CLI runs a hook command through PowerShell",
    run: [
      'V: the command line of the process that started a hook was "<System32>\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -Command "<command>" (Codex CLI 0.163.0).',
      "V: a hook whose command was `node \"hook.mjs\" PreToolUse && echo done` did not run (PowerShell 5.1 does not know &&), and the command it guarded ran.",
    ],
  },
  gemini: {
    shell: "Gemini CLI runs a hook command through PowerShell",
    run: [
      'V: the command line of the process that started a hook was powershell.exe -NoProfile -NonInteractive -Command "<command>; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }" (Gemini CLI 0.64.0).',
      "V: a hook whose command was `node \"hook.mjs\" BeforeTool && echo done` did not run; Gemini CLI printed PowerShell's parser error (\"The token '&&' is not a valid statement separator in this version\") as a hook warning, and the tool ran.",
    ],
  },
  copilot: {
    shell: "Copilot CLI runs the powershell field of a hook through PowerShell",
    run: [
      'V: the command line of the process that started a hook was "powershell.exe" -nop -nol -c "<command>" ("pwsh.exe" when PATH has one) (Copilot CLI 1.0.98).',
      "V: a preToolUse hook whose powershell field was `node \"hook.mjs\" preToolUse && echo done` did not run, and Copilot CLI answered the tool call with: Denied by preToolUse hook from \"<file>\" (hook errored).",
    ],
  },
  cursor: {
    shell: "Cursor composes a hook command as PowerShell",
    run: [
      "D: the forum (thread 168129, reproduced by Cursor staff) says the hook command of the CLI is built as PowerShell, and run through bash when Git Bash markers such as MSYSTEM are present. The documentation does not say which shell runs a hook on Windows.",
      "N: Cursor's CLI needs a login, so no hook was run here.",
    ],
  },
};

function hookPages(agent) {
  const label = LABEL[agent];
  const h = HOOK[agent];
  const verified = h.run.some((x) => x.startsWith("V:"));
  const pages = [
    {
      id: `${agent}.hook-bash-syntax`, basis: verified ? "verified" : "documented", title: `A ${label} hook command is a bash line, and ${label} runs it through PowerShell`,
      means: `A hook is a command line, and on Windows ${label} hands it to a shell. ${h.shell}. A line written for bash ($NAME, &&, /dev/null, [ -f x ], export, a .sh file) means something else in PowerShell, or is an error.`,
      does: [
        ...h.run,
        "V: Windows PowerShell 5.1 does not have && and || (they exist from PowerShell 7); and $NAME is a variable of PowerShell's own, empty unless it was set there: the environment variable is $env:NAME.",
        ...(agent === "copilot" ? ["V: a hook in the project's .claude/settings.json whose command was `$CLAUDE_PROJECT_DIR` got an empty string through Copilot CLI's PowerShell, while the environment variable CLAUDE_PROJECT_DIR was set ($env:CLAUDE_PROJECT_DIR printed the folder)."] : []),
      ],
      fix: ["Write the hook as one program and its arguments, which both shells read the same way: node \"hooks/check.mjs\".", "Use $env:NAME for a variable in PowerShell, and one command per line instead of && for Windows PowerShell 5.1 (PowerShell 7 has &&)."],
      issues: agent === "copilot" ? [COPILOT(4001, ".claude/settings.json hooks fail on Windows: executed via PowerShell (not bash) and $CLAUDE_PROJECT_DIR not set (open)")] : agent === "cursor" ? [CURSOR(168129, "Cursor-agent (Windows): imported Claude Code hooks are composed as PowerShell but executed with bash, silently blocking every tool call")] : [],
    },
    {
      id: `${agent}.hook-extensionless`, basis: "documented", title: `A ${label} hook starts a file that has no extension`,
      means: "On Windows a file with no extension is not a program, and no program is associated with it, so a shell cannot start it.",
      does: [
        "D: Windows starts a file by its extension (PATHEXT for a command name, the file association for a document); an extensionless script is a Unix habit.",
        "D: the forum reports that an extensionless hook launcher opens the Open With dialog (AgentParty #1123, Cursor).",
        "N: not put to the binary.",
      ],
      fix: ["Give the file an extension that Windows knows (.cmd, .bat, .ps1, .exe), or start it with its interpreter: node \"hooks/check.mjs\"."],
      issues: [],
    },
  ];
  if (agent !== "claude") {
    pages.splice(1, 0, {
      id: `${agent}.hook-ps1-policy`, basis: agent === "copilot" ? "verified" : "documented", title: `A ${label} hook runs a .ps1 script, and the execution policy blocks it`,
      means: "A Restricted or AllSigned execution policy stops .ps1 files from running. The agent starts the hook with a PowerShell that does not pass -ExecutionPolicy Bypass.",
      does: [
        agent === "copilot" ? 'V: a preToolUse hook whose powershell field was `powershell -NoProfile -ExecutionPolicy Restricted -File "hook.ps1"` did not run, and Copilot CLI denied the tool call ("hook errored"): a hook that fails is a deny (1.0.98).' : "D: PowerShell refuses a .ps1 under Restricted or AllSigned with \"running scripts is disabled on this system\"; the hook command line shows no -ExecutionPolicy, so the policy of the machine applies.",
        agent === "codex" ? "V: a Codex hook that failed did not stop the command it guarded (0.163.0)." : agent === "cursor" ? "N: Cursor's launcher passes -ExecutionPolicy Bypass for its own script; whether its hooks do was not tried." : "D: the machine policy for PowerShell 5.1 and for PowerShell 7 are separate (check shows both).",
      ],
      fix: ["Start the script with -ExecutionPolicy Bypass in the hook command (powershell -ExecutionPolicy Bypass -File hook.ps1), or set the CurrentUser policy to RemoteSigned (Set-ExecutionPolicy -Scope CurrentUser RemoteSigned).", "A policy from Group Policy is for whoever manages the machine."],
      issues: [],
    });
  }
  return pages;
}

export const OTHER_PAGES = [
  ...["codex", "gemini", "copilot", "cursor"].flatMap(inventoryPages),
  nodePage("codex", "@openai/codex 0.163.0 says node >=16"),
  nodePage("gemini", "@google/gemini-cli 0.64.0 says node >=20"),
  nodePage("copilot", "@github/copilot 1.0.98 has no engines field, so it is never reported"),
  // ---- Codex CLI
  {
    id: "codex.sandbox-none", basis: "verified", title: "Codex has no Windows sandbox selected, and workspace-write becomes read-only",
    means: "On Windows Codex runs commands in a native sandbox, of which it has three: mxc, elevated and unelevated. With none selected it has nothing to run a command in, and the sandbox mode it was asked for is lowered.",
    does: [
      'V: with sandbox_mode = "workspace-write" and no windows.sandbox and no features.prefer_mxc, the header of codex exec said "sandbox: read-only" and CODEX_HOME\\.sandbox\\sandbox.<date>.log said "Windows sandbox selection: disabled" (Codex CLI 0.163.0, Windows 11 build 26300, where it also said "MXC availability: true").',
      'V: with [windows] sandbox = "unelevated" the header said workspace-write and the log "Windows sandbox selection: unelevated"; with [features] prefer_mxc = true, "mxc"; with [windows] sandbox = "mxc", "mxc". `codex features list` lists prefer_mxc as "under development".',
      'D: the documentation says that with no mode selected Codex prefers elevated, whose setup needs an administrator; the binary logged "disabled". It also lists mxc as the recommended implementation, which needs Windows 11 24H2 build 26100.9278 or 25H2 build 26200.9278.',
      "N: elevated was not started: its setup needs an administrator, and no test changes the machine. No command was run inside any sandbox.",
    ],
    fix: ["Add [features] prefer_mxc = true to config.toml on Windows 11 24H2 or 25H2 at or above the builds above, or [windows] sandbox = \"unelevated\".", "codex -c windows.sandbox=mxc sandbox --include-managed-config --permission-profile :workspace -- cmd.exe /d /c echo MXC_OK is the documented probe (Codex 0.162.0 or newer).", "codex doctor reports the install, the sign-in, the runtime, Microsoft Defender exclusions and Dev Drive; this tool does not repeat it."],
    issues: [CODEX(13993, "Support standalone Windows installer (`codex-setup.exe`) (open, 265 reactions)")],
  },
  {
    id: "codex.mxc-unavailable", basis: "documented", title: "MXC is selected, and this Windows is too old for it",
    means: "The MXC sandbox of Codex needs Windows 11 24H2 build 26100.9278 or 25H2 build 26200.9278. A build below that has no MXC.",
    does: [
      "D: the documentation: an explicit mxc \"fails if MXC is unavailable or blocked by managed requirements\"; prefer_mxc uses MXC \"when native capabilities and policy allow it\", otherwise keeps the legacy sandbox.",
      'V: the sandbox log says "MXC availability: true" or false; on Windows Server 2025 build 26100 with prefer_mxc, Codex 0.163.0 selected nothing ("Windows sandbox selection: disabled") instead of falling back (codex-config-doctor, which put it to the binary).',
      "N: a build below the minimum was not available here.",
    ],
    fix: ["Update Windows to the minimum build or later, or choose [windows] sandbox = \"unelevated\" (or \"elevated\", for an administrator's setup)."],
    issues: [],
  },
  {
    id: "codex.shell-path-ignored", basis: "verified", title: "windows.shell_path is set, and Codex does not have that key",
    means: "Codex runs the model's commands in PowerShell on Windows. A windows.shell_path key was proposed to point it at Git Bash or another shell (issue 16579); Codex CLI 0.163.0 does not have it.",
    does: [
      "V: codex exec --strict-config stopped with `unknown configuration field `windows.shell_path`` for the key in config.toml and for -c windows.shell_path=...; without --strict-config the key was ignored and the command ran in PowerShell: the command_execution item of codex exec --json named \"C:\\\\WINDOWS\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe\" -Command '...' (it prints each backslash of the path twice).",
      "V: `shell`, `windows.shell` and `windows.default_shell` are unknown configuration fields as well; `features.powershell_shell_version` is a feature flag (under development).",
      "D: the configuration reference lists windows.sandbox and, in requirements.toml, windows.allowed_sandbox_implementations and windows.allow_mxc under windows; no key names a shell.",
    ],
    fix: ["Remove the key. Codex has no setting for its shell on Windows.", "To run something in Git Bash, start Git Bash from PowerShell: & 'C:\\Program Files\\Git\\bin\\bash.exe' -lc '...'."],
    issues: [CODEX(16579, "Windows: allow configuring the default session shell via config (open, 54 reactions)")],
  },
  {
    id: "codex.home-wsl", basis: "documented", title: "CODEX_HOME is set on Windows, and WSL can read it",
    means: "The Codex desktop app has a WSL mode. The issue says that in that mode it uses the Windows CODEX_HOME inside WSL.",
    does: [
      "D: the issue (open): the Windows desktop app in WSL mode uses the Windows CODEX_HOME inside WSL and creates and stores worktrees on /mnt/c instead of the WSL file system.",
      "N: the WSL mode of the app was not driven, and the documentation page about WSL does not mention CODEX_HOME.",
    ],
    fix: ["If you use Codex in WSL mode, check which folder it reads, and give the distribution its own CODEX_HOME if it should not share the Windows one."],
    issues: [CODEX(13762, "Windows desktop in WSL mode uses the Windows CODEX_HOME inside WSL and creates/stores worktrees on /mnt/c instead of the WSL filesystem (open, 61 reactions)")],
  },
  {
    id: "codex.hook-exit-2", basis: "verified", title: "A Codex hook that exits with code 2 does not block on Windows",
    means: "The documentation says exit code 2 blocks a PreToolUse call. Codex runs the hook through PowerShell on Windows, and PowerShell turns every non-zero exit code of the program into 1.",
    does: [
      "V: a PreToolUse hook that exited with code 2 and wrote to stderr did not stop the command: it ran and printed its output. Exit code 1 did not stop it either (Codex CLI 0.163.0).",
      "V: a hook that printed {\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"...\"}} and exited 0 stopped it, and so did {\"decision\":\"block\",\"reason\":\"...\"}: the model got \"Command blocked by PreToolUse hook: <reason>\".",
      "V: command_windows (and commandWindows) replaces command on Windows.",
      "D: the documentation: exit code 2 blocks a PreToolUse call, blocks a prompt on UserPromptSubmit, and the reason goes to stderr; it does not say which shell runs a hook on Windows.",
    ],
    fix: ["Block with JSON on stdout and exit 0: {\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"...\"}}."],
    issues: [],
  },
  {
    id: "codex.hook-trust", basis: "verified", title: "A Codex hook runs only after you have trusted it",
    means: "Codex does not run a hook from config.toml or hooks.json until it has been reviewed. It records trust against each hook's hash, so a new or changed hook is skipped.",
    does: [
      "V: a hook in config.toml did not run when Codex was started without --dangerously-bypass-hook-trust, and the command it guarded ran (Codex CLI 0.163.0). With the flag it ran.",
      "D: /hooks in the CLI reviews, trusts and disables hooks; managed hooks (requirements.toml) are trusted by policy; project hooks load only when the project's .codex layer is trusted.",
      "N: the review itself needs the interactive CLI and was not driven.",
    ],
    fix: ["Review the hooks in the CLI with /hooks."],
    issues: [],
  },
  // ---- Gemini CLI
  {
    id: "gemini.powershell-not-on-path", basis: "verified", title: "Gemini CLI finds no PowerShell on PATH",
    means: "Gemini CLI starts its shell tool as pwsh.exe when PATH has one, and as powershell.exe otherwise, both by their bare names. With neither on PATH it cannot start it.",
    does: [
      "V: with pwsh.exe first on PATH the shell command line was <that file> -NoProfile -Command ...; with only powershell.exe it was C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -NonInteractive -Command ... (Gemini CLI 0.64.0, a copy of powershell.exe named pwsh.exe stood in for PowerShell 7).",
      "V: a pwsh.exe that was only in %ProgramFiles%\\PowerShell\\7 (off PATH) was not used.",
      'V: with the PowerShell folder off PATH, run_shell_command answered {"error":"spawn powershell.exe ENOENT"}; the model got that, the answer was printed, and then the process ended with a libuv assertion (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\\win\\async.c, line 94`) and exit code 3221226505, in 4 of 4 runs (with a PowerShell found it ended with 0).',
    ],
    fix: ["Put C:\\Windows\\System32\\WindowsPowerShell\\v1.0 on PATH, then open a new terminal."],
    issues: [GEMINI(12678, "Windows always runs in PowerShell even under Git Bash (closed as a duplicate)"), GEMINI(21340, "feat: Add configurable shell executable for run_shell_command on Windows (closed as a duplicate)")],
  },
  {
    id: "gemini.constrained-language-mode", basis: "documented", title: "PowerShell is in Constrained Language Mode, which Gemini CLI cannot work in",
    means: "Windows can put PowerShell into Constrained Language Mode (application control such as WDAC or AppLocker). The issue says every Gemini CLI shell command failed in it.",
    does: [
      "D: google-gemini/gemini-cli#12519 (closed as not planned): PowerShell command parsing fails in Constrained Language Mode.",
      "V: this tool asks each PowerShell for $ExecutionContext.SessionState.LanguageMode; it printed FullLanguage here.",
      "V: __PSLockdownPolicy=4 in the environment of the process did not change that (the PowerShell that Gemini CLI started printed FullLanguage with it): the switch is read from the machine's environment, which this tool does not change.",
      "N: Gemini CLI under Constrained Language Mode was not put to the binary.",
    ],
    fix: ["Ask whoever manages the machine about the policy that sets the mode, or run Gemini CLI where PowerShell is in FullLanguage mode (WSL)."],
    issues: [GEMINI(12519, "PowerShell command parsing fails in Constrained Language Mode (CLM) (closed as not planned)")],
  },
  {
    id: "gemini.node-pty-missing", basis: "documented", title: "The Gemini CLI install has no node-pty binary",
    means: "Gemini CLI starts shell commands in a pseudo-terminal when it can. The native half of node-pty (conpty.node) comes as an optional dependency, and an install can end without it.",
    does: [
      "V: Gemini CLI 0.64.0 lists @lydell/node-pty and @lydell/node-pty-win32-x64 as optional dependencies, and the npm install here has conpty.node under @lydell/node-pty-win32-x64.",
      "D: google-gemini/gemini-cli#16003 (closed as completed): run_shell_command fails on Windows with a missing node-pty binary.",
      "N: an install without the binary was not made.",
    ],
    fix: ["Reinstall: npm install -g @google/gemini-cli."],
    issues: [GEMINI(16003, "Bug Report: `run_shell_command` Fails on Windows (Missing `node-pty` Binary) (closed as completed)")],
  },
  // ---- Copilot CLI
  {
    id: "copilot.powershell-not-on-path", basis: "verified", title: "Copilot CLI finds neither pwsh.exe nor powershell.exe",
    means: "The powershell tool of Copilot CLI tries \"pwsh.exe\" and then \"powershell.exe\", by their bare names, through PATH.",
    does: [
      'V: with neither on PATH the tool answered: Error: PowerShell is not available. Tried "pwsh.exe", "powershell.exe". Install PowerShell from https://aka.ms/powershell or ensure Windows PowerShell is available. Errors: pwsh.exe: Error: spawn pwsh.exe ENOENT; powershell.exe: Error: spawn powershell.exe ENOENT (Copilot CLI 1.0.98). The tool was listed to the model all the same.',
    ],
    fix: ["Put C:\\Windows\\System32\\WindowsPowerShell\\v1.0 on PATH, then open a new terminal."],
    issues: [COPILOT(2355, "Copilot CLI internal PowerShell tool fails to spawn pwsh.exe on Windows (ENOENT) (open)")],
  },
  {
    id: "copilot.pwsh-missing", basis: "verified", title: "Copilot CLI asks for PowerShell 6 or newer, and this machine has only Windows PowerShell 5.1",
    means: "The README of Copilot CLI lists \"(On Windows) PowerShell v6 or higher\" as a prerequisite. A Windows machine has Windows PowerShell 5.1 and no pwsh.exe until PowerShell 7 is installed.",
    does: [
      'V: with no pwsh.exe anywhere, the powershell tool ran its command as "powershell.exe" -NoProfile -NoLogo -NonInteractive -Command ... and the shell said it was PowerShell 5.1 ($PSHOME was C:\\Windows\\System32\\WindowsPowerShell\\v1.0) (Copilot CLI 1.0.98).',
      'V: with a pwsh.exe first on PATH it ran "pwsh.exe" -NoProfile -NoLogo -NonInteractive -Command ... (a copy of powershell.exe named pwsh.exe stood in for PowerShell 7); a pwsh.exe only in %ProgramFiles%\\PowerShell\\7, off PATH, was not used.',
      "D: github/copilot-cli#411 \"Support Windows PowerShell 5.1\" (closed as not planned) and #2355 (open) report the tool failing for want of pwsh.exe.",
    ],
    fix: ["winget install Microsoft.PowerShell, then open a new terminal."],
    issues: [COPILOT(411, "Support Windows PowerShell 5.1 (closed as not planned)"), COPILOT(2355, "Copilot CLI internal PowerShell tool fails to spawn pwsh.exe on Windows (ENOENT) (open)"), COPILOT(1434, "PowerShell Tool Hangs Indefinitely on Windows 11 Pro (closed)")],
  },
  {
    id: "copilot.hook-bash-only", basis: "verified", title: "A Copilot hook has a bash field and no powershell field",
    means: "On Windows Copilot CLI runs the powershell field of a hook through PowerShell and the bash field through bash. A hook with only a bash field needs a bash on PATH.",
    does: [
      'V: with a Git Bash first on PATH, a hook with only a bash field ran as "bash" --norc --noprofile -c "<command>" (Copilot CLI 1.0.98).',
      'V: with the WSL launcher (C:\\Windows\\System32\\bash.exe) as the first bash on PATH, and with no bash.exe on PATH, the hook did not run, and Copilot CLI answered the tool call of a preToolUse hook with: Denied by preToolUse hook from "<file>" (hook errored).',
      "V: exec and args start the program with no shell: the parent of the hook process was copilot.exe.",
    ],
    fix: ["Add a powershell field beside the bash field, or use exec and args."],
    issues: [COPILOT(1730, "sessionStart hook in .github/hooks/ does not fire in Copilot CLI (v0.0.420) (open)")],
  },
  {
    id: "copilot.claude-hooks", basis: "verified", title: "Copilot CLI also runs the hooks of .claude/settings.json",
    means: "Copilot CLI reads the command hooks of a project's .claude/settings.json, written for Claude Code, and runs them through PowerShell.",
    does: [
      'V: a PreToolUse command hook in <project>\\.claude\\settings.json ran under Copilot CLI 1.0.98 as "powershell.exe" -nop -nol -c "<command>"; the environment had CLAUDE_PROJECT_DIR and COPILOT_PROJECT_DIR set to the project folder, and $CLAUDE_PROJECT_DIR in the command was an empty PowerShell variable ($env:CLAUDE_PROJECT_DIR printed the folder).',
      "V: a hook in ~\\.claude\\settings.json (the user's file) did not run.",
      "V: a hook in <project>\\.github\\hooks\\*.json with a powershell field ran, as \"powershell.exe\" -nop -nol -c.",
    ],
    fix: ["Write the command so that PowerShell and bash both read it (node \"hooks/check.mjs\", with no shell variable), or use $env:CLAUDE_PROJECT_DIR for PowerShell."],
    issues: [COPILOT(4001, ".claude/settings.json hooks fail on Windows: executed via PowerShell (not bash) and $CLAUDE_PROJECT_DIR not set (open)"), COPILOT(3659, "CLI cannot execute hooks shipped with plugins (open)")],
  },
  // ---- Cursor
  {
    id: "cursor.launcher-quotes", basis: "documented", title: "The Cursor CLI launcher drops double quotes and eats exclamation marks",
    means: "On Windows the Cursor CLI is started by agent.cmd (or cursor-agent.cmd), which hardcodes Windows PowerShell 5.1 and passes the arguments on with %*.",
    does: [
      "V: this tool read the launcher on disk (Cursor CLI 2026.06.16, installed on 16 June 2026): setlocal enabledelayedexpansion, then %SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"...\\cursor-agent.ps1\" %*. It did not run it.",
      "D: the forum thread 168416 (bug report, 14 August 2026): the launcher always starts Windows PowerShell 5.1; PowerShell 5.1's argument passing drops embedded double quotes; cmd.exe removes ! because delayed expansion is on before %* is read. Cursor staff: \"What you're seeing isn't intended behavior\".",
      "D: a staff workaround: run the bundled node.exe in the newest folder of versions directly with its index.js.",
    ],
    fix: ["Avoid \" and ! in what you pass to agent, or run the node.exe of the newest versions folder directly: <folder>\\node.exe <folder>\\index.js <arguments>."],
    issues: [CURSOR(168416, "Windows CLI launcher (agent.cmd) hardcodes PowerShell 5.1; `$args` strips `\"` and can glue the next argument")],
  },
  {
    id: "cursor.launcher-no-version", basis: "verified", title: "The Cursor CLI launcher cannot pick a version folder",
    means: "cursor-agent.ps1 picks the newest folder of versions whose name matches a pattern, and runs the node.exe and index.js in it. When no folder matches, it stops.",
    does: [
      "V: this tool reads the pattern from the launcher file and tests the folder names with the rule of PowerShell's -match (case-insensitive). On this machine the launcher's pattern is ^\\d{4}\\.\\d{1,2}\\.\\d{1,2}-[a-f0-9]+$ and the folder is 2026.06.16-20-30-07-a07d3ac: PowerShell's own -match said False (test/windows.test.mjs compares the two).",
      'V: by its script the launcher then writes "No version directories found in <folder>" and exits 1, unless a node.exe sits next to the script. This was read, not run: running the launcher starts the agent.',
    ],
    fix: ["Run the node.exe in the newest folder of versions directly: <folder>\\node.exe <folder>\\index.js, or reinstall the Cursor CLI (irm 'https://cursor.com/install?win32=true' | iex)."],
    issues: [CURSOR(168416, "Windows CLI launcher (agent.cmd) hardcodes PowerShell 5.1; `$args` strips `\"` and can glue the next argument")],
  },
  {
    id: "cursor.msystem", basis: "documented", title: "MSYSTEM is set, and Cursor runs its hooks with bash",
    means: "MSYSTEM is a variable of Git Bash. The forum says that with it set the Cursor CLI builds the hook command as PowerShell and runs it with bash.",
    does: [
      "D: forum thread 168129 (bug report, 12 August 2026): imported Claude Code hooks are composed as PowerShell but executed with bash, and every tool call is blocked. Cursor staff reproduced it, and a later poster found that the trigger is MSYSTEM.",
      "N: Cursor's CLI needs a login, so this was not put to the binary.",
    ],
    fix: ["Start the Cursor CLI from a terminal that is not Git Bash, or unset MSYSTEM for it (Remove-Item Env:MSYSTEM)."],
    issues: [CURSOR(168129, "Cursor-agent (Windows): imported Claude Code hooks are composed as PowerShell but executed with bash, silently blocking every tool call")],
  },
  {
    id: "cursor.hook-stdin-bom", basis: "documented", title: "A Cursor hook's stdin starts with a byte order mark on Windows",
    means: "The JSON that Cursor writes to a hook's stdin begins with a UTF-8 byte order mark on Windows, and a hook that parses it with a plain JSON.parse fails.",
    does: [
      "D: forum thread 168407 (bug report, 14 August 2026): the poster saw hooks never fire; Cursor staff replied that the hooks run and the stdin starts with a UTF-8 BOM, so JSON.parse fails and a catch block that falls back to allow never blocks. A known issue, no timeline.",
      "D: the hooks page: a permission hook that prints invalid JSON blocks; exit code 2 blocks; other failures let the action go on unless failClosed is true.",
      "N: not put to the binary.",
    ],
    fix: ["Strip the mark before parsing: text.replace(/^\\uFEFF/, \"\")."],
    issues: [CURSOR(168407, "Hooks not firing. Cannot have guardrails"), CURSOR(144940, "Project-Level Hooks Fail to Execute on Windows")],
  },
  ...["claude", "codex", "gemini", "copilot", "cursor"].flatMap(hookPages),
];
