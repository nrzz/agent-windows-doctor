# agent-windows-doctor

On Windows, each coding agent picks a shell for the model by itself, and none of them says which one or why. Windows is where their trackers hurt. On 18 October 2026, at about 07:05 IST, GitHub's search showed 5,253 open issues with "windows" in the title among the 23,221 open issues of openai/codex (171 say "powershell", 8 "git bash", 316 "wsl"); 894 of the 15,184 of anthropics/claude-code (69, 47 and 57); 95 of the 2,213 of github/copilot-cli (20, 2 and 15); and 7 of the 740 of google-gemini/gemini-cli, whose tracker is pruned (1, 0 and 1). Cursor has no public tracker, only a forum. The threads are about the shell. Codex CLI runs the model's commands in PowerShell, and the issue that asks for a setting to change that (#16579, 54 reactions) says so; the key it proposes, `windows.shell_path`, is not a key of the release tested here. Copilot CLI lists PowerShell 6 or newer as a prerequisite and a stock Windows has 5.1: #411 and #2355 are its PowerShell tool failing for want of `pwsh.exe` (the tests below found 1.0.98 falling back to Windows PowerShell 5.1). Gemini CLI runs its shell tool in PowerShell even under Git Bash (#12678, #21340) and fails in Constrained Language Mode (#12519). The launcher of the Cursor CLI hardcodes Windows PowerShell 5.1 and drops quotes (forum thread 168416). `claude doctor` and `codex doctor` check the install and the settings of one agent each, and neither says which shell the model gets or why.

agent-windows-doctor says it, for Claude Code, Codex CLI, Gemini CLI, GitHub Copilot CLI and Cursor together. It is a read-only command line tool: it lists every binary, launcher and shim of each agent with its version and which one a terminal runs first; says which shell each agent gives the model and how it chose it; says which shell runs each agent's hooks and whether your hook commands are bash lines for a PowerShell; reads the machine behind it (the PowerShell editions, the execution policy, Git for Windows, long paths, line endings, the code page, WSL, Node); and, with `--live`, proves the shell claims with the real binaries against a fake API on your own machine, at zero tokens. Every finding says what the agent does about it, the fix, and whether the claim is verified (the binary showed it in the tests), documented (the vendor's documentation or a maintainer's words) or not verified. On Linux and macOS it says there is nothing to check and exits 0.

## What you get

`check` prints, in this order:

- **The machine.** The Windows version and build (and whether Codex's MXC sandbox can run on it), every PowerShell edition found with its language mode and its execution policy per scope, Git for Windows and every `bash.exe` on PATH (Git Bash, the WSL launcher), long paths, `core.autocrlf`, the console code page, WSL distributions, and Node and npm with the Node each installed package asks for.
- **Every agent on the machine.** Each binary, launcher or shim found, with its version (read from `package.json`, the file's version resource or the version folder, and the output says which), how it was installed and which one runs first.
- **The shell each agent gives the model, and how it chose.** The table below.
- **Hooks on Windows.** The hook files each agent reads, what starts each hook command (a shell, and which), and whether the command is a bash line that a PowerShell reads differently.
- **Codex on Windows.** `CODEX_HOME`, the config layers that bear on the shell, the Windows sandbox it selects and why, `windows.shell_path`.
- **Findings.** 77 ids of the form `<agent>.<name>`, each with a severity (error, warning, note), what the agent does, the fix, and a basis mark.
- **With `--live`:** a proof against each real binary, "proved with the real codex 0.163.0".

| Agent | The shell the model gets on Windows | How it is chosen | What runs a hook |
| --- | --- | --- | --- |
| Claude Code 2.1.302 | The Bash tool (Git Bash) when Git Bash is found; the PowerShell tool when it is not, and when `CLAUDE_CODE_USE_POWERSHELL_TOOL` or your account says so | Git Bash: `CLAUDE_CODE_GIT_BASH_PATH`, then `C:\Program Files\Git` and `C:\Program Files (x86)\Git`, then the first `git.exe` that `where.exe` lists. PowerShell: `pwsh` on PATH, then PowerShell 7 under `ProgramW6432`, then `.dotnet\tools`, then `powershell` | Git Bash (`bash.exe -c`) when it was found, else `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command` |
| Codex CLI 0.163.0 | PowerShell | In this order, each started by its full path: `pwsh.exe` on PATH; `C:\Program Files\PowerShell\7\pwsh.exe` (a path written into Codex, used whether or not PATH lists it); `powershell.exe` on PATH; `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`. No key chooses it: `windows.shell_path` is ignored | PowerShell: `-NoProfile -Command` |
| Gemini CLI 0.64.0 | PowerShell | `pwsh.exe` when PATH has one, else `powershell.exe`, both by bare name through PATH; with neither, `spawn powershell.exe ENOENT` | `powershell.exe -NoProfile -NonInteractive -Command "<command>; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }"` |
| GitHub Copilot CLI 1.0.98 | PowerShell (its `powershell` tool) | It tries `pwsh.exe`, then `powershell.exe`, by bare name through PATH; with neither, "PowerShell is not available" | The `powershell` field: `powershell.exe -nop -nol -c`; the `bash` field only through a bash that works |
| Cursor CLI | Not run here. Its launcher starts Windows PowerShell 5.1; the shell it gives the model is not stated (documented) | The launcher, read from disk | Documented from the forum: composed as PowerShell, run with bash when `MSYSTEM` is set |

## What it costs in tokens

| What | Tokens |
| --- | --- |
| The command line tool: `check`, `agents`, `explain`, and `check --live` (a fake API answers; no model is reached) | 0 |
| `check --markdown`, if you paste it into an agent yourself | At most 12 findings of at most 500 characters each and a header of three lines: about 7,500 characters, under 2,000 tokens. The example below is 4,326 characters |

There is no plugin, no skill and no hook: nothing is put in front of a model unless you paste a report.

## Install

Node 18 or newer. No dependencies, nothing to build.

```bash
npx -y github:nrzz/agent-windows-doctor check --project .
```

or

```bash
git clone https://github.com/nrzz/agent-windows-doctor
cd agent-windows-doctor
node bin/agent-windows-doctor.mjs check --project .
```

The examples below call the command `agent-windows-doctor`.

## Use

```text
Usage: agent-windows-doctor <command> [options]

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
C:\Program Files\ClaudeCode) and AGENT_WINDOWS_DOCTOR_USER_ENV_FILE (a JSON file that stands in for HKCU\Environment);
the tests use both. It reads files, the registry and the output of a few Windows programs, and writes nothing. It
starts an agent's binary only with --live, in throwaway folders, and sends nothing to anyone.
```

The examples below were run in a throwaway Windows user, shown as `C:\Users\me`: the real machine (Windows 11, no PowerShell 7, Git for Windows at `E:\Das\Git`, not on PATH), Claude Code 2.1.302 in `.local\bin`, Codex CLI, Gemini CLI and Copilot CLI installed by npm and reached from `AppData\Roaming\npm` (a junction to the install the tests use), the Cursor CLI launcher as an earlier install left it, and a project, `C:\Users\me\shop`, whose hooks were written for bash. `HOME`, `USERPROFILE`, `LOCALAPPDATA`, `APPDATA` and every agent's folder pointed into that user's folder, and PATH held the system folders, Node and the two folders of the agents.

### `check`

All five agents in one run is a long report; this is one agent, whole.

```text
$ agent-windows-doctor check --agent codex --project C:\Users\me\shop
agent-windows-doctor 1.1.0  what the coding agents get on this Windows machine
project   C:\Users\me\shop
system    Windows 11 Home Single Language (10.0.26300), x64
agents    Codex CLI

The machine
  Windows           Windows 11 Home Single Language, build 26300.9711 (26H2), x64
  Codex MXC sandbox can run here: build 26300 is newer than the documented minimum builds (26100.9278 or 26200.9278)
  Windows PowerShell 5.1 C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe  5.1.26100.9711, FullLanguage, execution policy RemoteSigned (MachinePolicy Undefined, UserPolicy Undefined, Process Undefined, CurrentUser RemoteSigned, LocalMachine Undefined)
  PowerShell 7      not found: no pwsh.exe on PATH, in %ProgramFiles%\PowerShell\7, in the Store alias folder or in .dotnet\tools
  Git for Windows   E:\Das\Git\bin\bash.exe; git is not on PATH
  bash.exe on PATH  1  C:\Windows\System32\bash.exe  the WSL launcher (starts the default distribution)
  long paths        Windows LongPathsEnabled on; git core.longpaths not read (git is not on PATH)
  line endings      git core.autocrlf not read (git is not on PATH)
  console           code page 437, system OEM 437, ANSI 1252
  WSL               * docker-desktop     Running    WSL 2  (made by another tool, not one to work in)
  Node              24.19.0, npm 11.17.0; installed packages ask for: Codex CLI >=16 (met)

Every agent on this machine
  Codex CLI
    1  C:\Users\me\AppData\Roaming\npm\codex.cmd
        0.163.0 (package.json of @openai/codex); npm (global); runs first from a terminal
        leads to C:\Users\me\AppData\Roaming\npm\node_modules\@openai\codex\bin\codex.js -> C:\Users\me\AppData\Roaming\npm\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe
    2  C:\Program Files\WindowsApps\OpenAI.Codex_26.1007.9446.0_x64__2p2nqsd0c76g0\app\resources\codex.exe
        26.1007.9446.0 (app package: the version of the app, not of the CLI inside it); bundled by the Codex desktop app (Microsoft Store package OpenAI.Codex); not on PATH

The shell each agent gives the model
  Codex CLI (tool exec_command)
    shell             Windows PowerShell 5.1 (powershell.exe) at C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe, started with -Command [verified]
    - no pwsh.exe on PATH and no PowerShell 7 in C:\Program Files, so the first powershell.exe on PATH, by its full path
    - the order: pwsh.exe on PATH, C:\Program Files\PowerShell\7\pwsh.exe, powershell.exe on PATH, C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
    - a pwsh.exe in the project folder, or in a ProgramFiles folder that an environment variable names, is not used
    - there is no key to choose the shell: windows.shell_path is not a key of Codex CLI 0.163.0

Hooks on Windows
  Codex CLI
    files: user C:\Users\me\.codex\config.toml
    PreToolUse [*]  [ -f package.json ] && node hooks/check.mjs
        in C:\Users\me\.codex\config.toml; run by Windows PowerShell 5.1 [verified]; looks like bash: and-or, test

Codex on Windows
  CODEX_HOME        C:\Users\me\.codex (CODEX_HOME)
  files read        user C:\Users\me\.codex\config.toml
  project trust     not trusted: the project's .codex folder is not read
  sandbox           none selected; sandbox_mode "workspace-write" becomes read-only
  MXC               available (build 26300 is newer than the documented minimum builds (26100.9278 or 26200.9278); no sandbox log yet)
  shell key         windows.shell_path in C:\Users\me\.codex\config.toml: Codex CLI has no such key
  more              codex doctor reports the install, the sign-in, the runtime, Microsoft Defender exclusions and Dev Drive

Findings
  warning codex.sandbox-none   [verified]
      No Windows sandbox is selected for Codex CLI (windows.sandbox and features.prefer_mxc are not set in C:\Users\me\.codex\config.toml), so the sandbox mode "workspace-write" becomes read-only.
      what Codex CLI does: The header of codex exec said "sandbox: read-only" and the sandbox log said "Windows sandbox selection: disabled" (put to Codex 0.163.0). The documentation says that with none selected Codex prefers elevated, whose setup needs an administrator.
      fix: [features] prefer_mxc = true in C:\Users\me\.codex\config.toml (Windows 11 at or above 26100.9278 or 26200.9278), or [windows] sandbox = "unelevated". Run codex doctor for the rest of the install.
      more: agent-windows-doctor explain codex.sandbox-none
  warning codex.shell-path-ignored   [verified]
      windows.shell_path is set in C:\Users\me\.codex\config.toml, and Codex CLI does not have that key.
      what Codex CLI does: codex exec --strict-config stops with: unknown configuration field `windows.shell_path`; without it the key is ignored and the model's commands ran in PowerShell all the same (put to Codex 0.163.0). The key is proposed in openai/codex#16579.
      fix: Remove the key. Codex has no setting for its shell on Windows; to run a command in Git Bash, start Git Bash from PowerShell: & 'C:\Program Files\Git\bin\bash.exe' -lc '...'.
      more: agent-windows-doctor explain codex.shell-path-ignored
  warning codex.hook-bash-syntax   [verified]
      1 hook command looks like bash, and Codex CLI runs it through PowerShell (Codex CLI runs a hook command through the PowerShell it finds for its shell tool): PreToolUse in C:\Users\me\.codex\config.toml: [ -f package.json ] && node hooks/check.mjs (&& and || are not valid in Windows PowerShell 5.1 (they exist from PowerShell 7); [ ... ], [[ ... ]] and test are bash tests).
      what Codex CLI does: Codex CLI ran its hook command through PowerShell (put to the binary), so bash syntax is a PowerShell error or an empty variable.
      fix: Write the hook as one program and its arguments (node "hooks/check.mjs"), which both shells read the same way; use $env:NAME for a variable, and one command per line instead of && in Windows PowerShell 5.1.
      more: agent-windows-doctor explain codex.hook-bash-syntax
  note    codex.hook-exit-2   [verified]
      1 Codex hook can block (PreToolUse in C:\Users\me\.codex\config.toml), and on Windows a hook that exits with code 2 does not.
      what Codex CLI does: The documentation says exit code 2 blocks a PreToolUse call. Codex CLI 0.163.0 on Windows ran the command all the same, for exit codes 2 and 1: PowerShell turns the code into 1. A hook that prints JSON with permissionDecision deny (or decision block) on stdout and exits 0 did block (put to the binary).
      fix: Block with JSON: {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}} on stdout, and exit 0.
      more: agent-windows-doctor explain codex.hook-exit-2
  note    codex.hook-trust   [verified]
      1 Codex hook (PreToolUse in C:\Users\me\.codex\config.toml) run only after you have reviewed and trusted it.
      what Codex CLI does: A hook that had not been trusted did not run, and the command it guarded ran (put to Codex CLI 0.163.0); with --dangerously-bypass-hook-trust it ran. Codex records trust against each hook's hash, so a changed hook is skipped until it is reviewed again.
      fix: Review them in the CLI with /hooks. Managed hooks (requirements.toml) are trusted by policy.
      more: agent-windows-doctor explain codex.hook-trust

0 errors, 3 warnings, 2 notes
```

Without `--agent`, `check` reports the agents it finds on the machine; `--agent claude,codex` (or `all`) names them, found or not. `--project` is the folder the agents start in, for the project's settings and hook files; the default is the folder you are in. The exit code is 1 when there is an error or a warning, and 0 for notes alone.

The other four agents' sections look the same. In the same user, the findings for the other agents and the machine included these, each with its fix and a page for `explain`: `copilot.hook-bash-only` (an error: a `bash` field with no `powershell` field, and the first `bash.exe` on PATH is the WSL launcher, so the hook fails and Copilot CLI denies the tool call), `cursor.launcher-no-version` (the launcher's version pattern does not match the folder the installer made), `claude.git-bash-not-found` (Git for Windows is installed, and `git.exe` is not on PATH), `copilot.claude-hooks` (Copilot CLI also runs the hooks of `.claude/settings.json`, through PowerShell, where `$CLAUDE_PROJECT_DIR` is empty) and `claude.hook-bash-syntax`.

### `check --live`

`--live` starts each agent's real binary (the first of its kind on PATH, or the path that `--claude`, `--codex`, `--gemini` or `--copilot` names) in a throwaway home, against a fake API on 127.0.0.1, and compares what happened with the prediction: for Claude Code the shell tools its first request lists and the `bash.exe` it says it took, for Codex CLI, Gemini CLI and Copilot CLI the PowerShell that ran the one shell command the fake model asks for, which prints its own command line. This is the part of the report that `--live` adds (the other sections are as above):

```text
$ agent-windows-doctor check --live --agent claude,codex,gemini,copilot --project C:\Users\me\shop
Live: the real binaries, through a fake API on 127.0.0.1 (no token spent)
  Claude Code          proved with the real claude 2.1.302 (C:\Users\me\.local\bin\claude.exe; the first on PATH):
                       the first request listed PowerShell; PowerShell edition: Windows PowerShell 5.1 (powershell.exe)
                       the fake API has no account, so the account's default for the PowerShell tool is off there; predicted: PowerShell
  Codex CLI            proved with the real codex 0.163.0 (C:\Users\me\AppData\Roaming\npm\codex.cmd; the first on PATH):
                       the shell command ran in C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe; predicted: C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
                       command line: "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command '[Environment]::CommandLine'
  Gemini CLI           proved with the real gemini 0.64.0 (C:\Users\me\AppData\Roaming\npm\gemini.cmd; the first on PATH):
                       the shell command ran in C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe; predicted: C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
                       command line: C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -Command [Environment]::CommandLine
  GitHub Copilot CLI   proved with the real copilot 1.0.98 (C:\Users\me\AppData\Roaming\npm\copilot.cmd; the first on PATH):
                       the shell command ran in powershell.exe; predicted: C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
                       command line: "powershell.exe" -NoProfile -NoLogo -NonInteractive -Command "try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}; t…
```

Codex prints each backslash of the path in its `command_execution` item twice, as the line shows; the tool compares the path without the doubling. The Cursor CLI is never run (it needs a login), and an agent that is not on the machine is skipped, not failed. On Linux and macOS `check --live` gives the answer of plain `check`, nothing to check and exit code 0: there is nothing to prove there. Inside WSL it is refused with exit code 1, because the proof is of the Windows side. A named path that is not a file, a binary that does not run, or a run that differs from the prediction makes the exit code 1, with the difference in words. Before any binary starts, a guard checks that `HOME`, `USERPROFILE`, `LOCALAPPDATA`, `APPDATA`, `CODEX_HOME`, `COPILOT_HOME`, `CLAUDE_CONFIG_DIR` and `GEMINI_CLI_HOME` are inside the throwaway folder and that `HTTP_PROXY`, `HTTPS_PROXY` and `ALL_PROXY` are a closed port on 127.0.0.1 (see Privacy).

### `check --markdown`

The short report to paste into any agent: at most 12 findings (errors and warnings; the notes stay in `check`), 500 characters a line, and exit code 0 always.

```text
$ agent-windows-doctor check --markdown --project C:\Users\me\shop
## agent-windows-doctor check: C:\Users\me\shop
Windows 11 Home Single Language. Shell the model gets: Claude Code no Git Bash, PowerShell tool; Codex CLI PowerShell 5.1; Gemini CLI PowerShell 5.1; GitHub Copilot CLI PowerShell 5.1; Cursor PowerShell 5.1.
Claude Code 2.1.302 runs first; Codex CLI 0.163.0 runs first; Gemini CLI 0.64.0 runs first; GitHub Copilot CLI 1.0.98 runs first; Cursor 2026.06.16-20-30-07-a07d3ac is not on PATH. 2 errors, 8 warnings, 6 notes.
- ERROR `copilot.hook-bash-only`: 1 hook has a bash field and no powershell field (preToolUse in C:\Users\me\shop\.github\hooks\guard.json); on Windows Copilot CLI starts the first bash on PATH, which is the WSL launcher. Fix: Add a powershell field (or exec and args, which start the program with no shell) beside the bash field.
- ERROR `cursor.launcher-no-version`: The Cursor CLI launcher (C:\Users\me\AppData\Local\cursor-agent\cursor-agent.ps1) picks a version folder whose name matches ^\d{4}\.\d{1,2}\.\d{1,2}-[a-f0-9]+$, and none of the 1 folder in C:\Users\me\AppData\Local\cursor-agent\versions… Fix: Run the node.exe in the newest folder of versions directly: <folder>\node.exe <folder>\index.js, or reinstall the Cursor CLI.
- WARNING `claude.git-bash-not-found`: Git for Windows is installed (E:\Das\Git\bin\bash.exe), but Claude Code does not find it: git.exe is not on PATH. Fix: Set CLAUDE_CODE_GIT_BASH_PATH for every program: setx CLAUDE_CODE_GIT_BASH_PATH "E:\Das\Git\bin\bash.exe". Then open a new terminal.
- WARNING `cursor.not-on-path`: Cursor is installed (C:\Users\me\AppData\Local\cursor-agent\agent.cmd, the Cursor CLI installer, 2026.06.16-20-30-07-a07d3ac), but its folder is not on PATH. Effect: A terminal says "agent is not recognized". Fix: Add C:\Users\me\AppData\Local\cursor-agent to the user PATH (System Properties, Environment Variables), then open a new terminal.
- WARNING `codex.sandbox-none`: No Windows sandbox is selected for Codex CLI (windows.sandbox and features.prefer_mxc are not set in C:\Users\me\.codex\config.toml), so the sandbox mode "workspace-write"… Fix: [features] prefer_mxc = true in C:\Users\me\.codex\config.toml (Windows 11 at or above 26100.9278 or 26200.9278), or [windows] sandbox = "unelevated". Run codex doctor for the rest of the install.
- WARNING `codex.shell-path-ignored`: windows.shell_path is set in C:\Users\me\.codex\config.toml, and Codex CLI does not have that key. Fix: Remove the key. Codex has no setting for its shell on Windows; to run a command in Git Bash, start Git Bash from PowerShell: & 'C:\Program Files\Git\bin\bash.exe' -lc '...'.
- WARNING `copilot.claude-hooks`: Copilot CLI also runs the 1 hook of the project's .claude/settings.json (PreToolUse: $CLAUDE_PROJECT_DIR/hooks/guard.sh), through PowerShell, where $CLAUDE_PROJECT_DIR is empty. Fix: Write the command so that PowerShell and bash both read it (node "hooks/check.mjs", with no shell variable), or use $env:CLAUDE_PROJECT_DIR for PowerShell.
- WARNING `cursor.launcher-quotes`: The Cursor CLI launcher (C:\Users\me\AppData\Local\cursor-agent\agent.cmd) starts Windows PowerShell 5.1 with delayed expansion on and %* for the arguments, which drops a double quote and eats an exclamation mark. Fix: Avoid " and ! in what you pass to agent, or start it the way a staff member suggested: run the node.exe of the newest folder in the versions folder directly with its index.js.
- WARNING `claude.hook-bash-syntax`: 1 hook command looks like bash, and Claude Code runs it through PowerShell (Git Bash was not found, so Claude Code runs a hook command through PowerShell, with -ExecutionPolicy Bypass): PreToolUse in .claude\settings.json:… Fix: Write the hook as one program and its arguments (node "hooks/check.mjs"), which both shells read the same way; use $env:NAME for a variable, and one command per line instead of && in Windows PowerShell 5.1.
- WARNING `codex.hook-bash-syntax`: 1 hook command looks like bash, and Codex CLI runs it through PowerShell (Codex CLI runs a hook command through the PowerShell it finds for its shell tool): PreToolUse in C:\Users\me\.codex\config.toml: [… Fix: Write the hook as one program and its arguments (node "hooks/check.mjs"), which both shells read the same way; use $env:NAME for a variable, and one command per line instead of && in Windows PowerShell 5.1.
```

### `explain`

One page per finding id: what it means, what the agent does (each line marked verified, documented or not verified), the fix, and the issue or forum threads. `explain --list` prints the 77 ids with their titles. An id is matched without regard to case, a unique part of an id matches the page, an ambiguous part lists every matching id in page order, and an unknown id suggests the nearest ids.

```text
$ agent-windows-doctor explain codex.shell-path-ignored
codex.shell-path-ignored   windows.shell_path is set, and Codex does not have that key

Codex runs the model's commands in PowerShell on Windows. A windows.shell_path key was proposed to point it at Git Bash or another shell (issue 16579); Codex CLI 0.163.0 does not have it.

What Codex CLI does
  - (verified) codex exec --strict-config stopped with `unknown configuration field `windows.shell_path`` for the key in config.toml and for -c windows.shell_path=...; without --strict-config the key was ignored and the command ran in PowerShell: the command_execution item of codex exec --json named "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command '...' (it prints each backslash of the path twice).
  - (verified) `shell`, `windows.shell` and `windows.default_shell` are unknown configuration fields as well; `features.powershell_shell_version` is a feature flag (under development).
  - (documented) the configuration reference lists windows.sandbox and, in requirements.toml, windows.allowed_sandbox_implementations and windows.allow_mxc under windows; no key names a shell.

The fix
  - Remove the key. Codex has no setting for its shell on Windows.
  - To run something in Git Bash, start Git Bash from PowerShell: & 'C:\Program Files\Git\bin\bash.exe' -lc '...'.

The issue and forum threads
  #16579  Windows: allow configuring the default session shell via config (open, 54 reactions)
        https://github.com/openai/codex/issues/16579
```

### `agents`

The inventory alone, for "which `claude` runs first": the second section of `check`, with `--agent` to name the agents.

```text
$ agent-windows-doctor agents
agent-windows-doctor 1.1.0  every agent on this machine

  Claude Code
    1  C:\Users\me\.local\bin\claude.exe
        2.1.302 (file version); the native installer; runs first from a terminal
  Codex CLI
    1  C:\Users\me\AppData\Roaming\npm\codex.cmd
        0.163.0 (package.json of @openai/codex); npm (global); runs first from a terminal
        leads to C:\Users\me\AppData\Roaming\npm\node_modules\@openai\codex\bin\codex.js -> C:\Users\me\AppData\Roaming\npm\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe
    2  C:\Program Files\WindowsApps\OpenAI.Codex_26.1007.9446.0_x64__2p2nqsd0c76g0\app\resources\codex.exe
        26.1007.9446.0 (app package: the version of the app, not of the CLI inside it); bundled by the Codex desktop app (Microsoft Store package OpenAI.Codex); not on PATH
  Gemini CLI
    1  C:\Users\me\AppData\Roaming\npm\gemini.cmd
        0.64.0 (package.json of @google/gemini-cli); npm (global); runs first from a terminal
        leads to C:\Users\me\AppData\Roaming\npm\node_modules\@google\gemini-cli\bundle\gemini.js
  GitHub Copilot CLI
    1  C:\Users\me\AppData\Roaming\npm\copilot.cmd
        1.0.98 (package.json of @github/copilot); npm (global); runs first from a terminal
        leads to C:\Users\me\AppData\Roaming\npm\node_modules\@github\copilot\npm-loader.js -> C:\Users\me\AppData\Roaming\npm\node_modules\@github\copilot-win32-x64\copilot.exe
  Cursor
    1  C:\Users\me\AppData\Local\cursor-agent\agent.cmd
        2026.06.16-20-30-07-a07d3ac (versions folder); the Cursor CLI installer; not on PATH
        also answers to cursor-agent.cmd
    2  C:\Program Files\cursor\Cursor.exe
        2.3.34 (file version); the Cursor editor; not on PATH
    none of them is on PATH, so a terminal does not know the command agent
```

### `--json`

Every command takes `--json` and prints one document. A usage error is `{ ok, error }`. `ok` is false when there are findings of severity error or warning, or a proof failed. The shapes (a `?` marks a field that some documents lack; what follows `//` is a comment):

```text
check    { ok, applicable, platform, kind?, project?,             // kind: "windows", "wsl"; on Linux and macOS applicable is false and message says there is nothing to check
           agents?: [ "claude" | "codex" | "gemini" | "copilot" | "cursor" ], asked?: [], notFound?: [],
           system?: { os, release, arch, wsl? },
           machine?: { windows: { ok, caption, release, build, ubr, display, arch, server }, mxc: { supported, why },
             powershell: [ { id, label, path, how, onPath, pathIndex?, probe: { ok, exe, edition, version, languageMode, effective, list: [ { scope, policy } ], error } } ],
             git: { ok, version, autocrlf?: { origin, value }, longpaths?: { origin, value }, error }, gitInstalls: [ { path, via } ], bash: [ { path, kind } ],
             longPaths: { ok, enabled, set }, codePage: { ok, active, oem, ansi, error }, wsl: { available, distros: [ { name, isDefault, state, version, internal } ], defaultName, workable: [], error },
             node: { node, nodePath, npm, npmPrefix, npmFound }, nodeWants: [ { agent, package, version, path, range, ok } ] },
           inventory?: { claude?, codex?, gemini?, copilot?, cursor?: { label, first, entries: [ { path, kind, origin, onPath, runsFirst, leadsTo: [], package: { name, version, engines: { node } }, version, versionFrom, asked, note, skipped } ] } },
           shells?: { claude?: { tools: { Bash, PowerShell }, fatal, gitBash: { found, path, how, variable: { value, source, ignored: [] }, variableState, trail: [ { step, state?, value?, source?, hint?, path?, exists?, lines?: [], skipped?: [], chosen? } ], starts: { checked, ok, error }, onMachine: [ { path, via } ] },
                                  powershell: { setting, state, why, unread, variable: { value, source, ignored: [] }, edition, path, how }, deny: { Bash: [], PowerShell: [] }, defaultShell: [ { scope, display, value, valid } ], why: [], basis },
                      codex?, gemini?, copilot?, cursor?: { tool, state, shell: { label, path, core }, args, how: [], basis } },
           hooks?: { claude?, codex?, gemini?, copilot?, cursor?: { files: [ { scope, path, display, usable, error, applied } ],
                       entries: [ { event, matcher, scope, source, field, command, runner: { via, exe, edition, args, basis, why }, bashReasons: [], policy, ps1, extensionless } ] } },
           userEnv?: { ok, layer, error, entries: [], own },
           findings?: [ { id, severity, agent, basis, message, effect, fix } ], counts?: { error, warning, note },
           codex?: { home: { dir, source, given }, trusted, sandbox: { configured, preferMxc, selection, selectionHow, preferUnavailable, mode: { asked, wanted, effective, downgraded }, mxcAvailable, mxc: { supported, why }, log },
                     shellKeys: [ { key, value, layer, file } ], files: [ { kind, path, ok, error } ] },
           gemini?: { pty: [ { pkgDir, found } ] },
           claude?: { settings: { configDir, configSource, files: [ { scope, label, display, path, exists, usable, error, applied? } ], managedApplied }, executionPolicy: { ok, list: [ { scope, policy } ], respect, effective: { scope, policy, bypassed, underneath: { scope, policy } }, machine: { scope, policy, bypassed } },
                      indexLock: { ok, gitDir, lock }, bashStarts: { checked, ok, error } },
           cursor?: { launcher: { dir, cmdFile, ps1File, powershell, args, delayedExpansion, forwardsArgs, versionPattern, versions: [], matching: [], noVersionFolder }, msystem },
           live?: { ok, agents: { claude?, codex?, gemini?, copilot?: { ok, error?, binary: { path, version, asked, note, source }, proved, predicted: { tools?: [], exit?, bash?, how?, shell?, state? }, actual: { tools?: [], exit?, bash?, shell?, error? }, differences: [], exitCode, requests, line, edition, warning },
                                    cursor?: { ok?, skipped } } },
           locations?: { configDir, configSource, configOnWindows, project, projectOnWindows }, wslInherits?: [], codexHome?: { dir, source }, message?, refused? }
agents   { ok, applicable, platform, agents: [], message?,                                                                       // the same inventory as in check
           inventory?: { claude?, codex?, gemini?, copilot?, cursor?: { label, first, entries: [ { path, kind, origin, onPath, runsFirst, leadsTo: [], package?: { name, version, engines: { node } }, version, versionFrom, asked, note, skipped } ] } },
           firsts?: { claude?, codex?, gemini?, copilot?, cursor? } }
explain  { ok, id?, agent?, basis?, title?, means?, does?: [ { source, text } ], fix?: [], issues?: [ { number, title, url } ],     // one page
           findings?: [ { id, title, basis } ],                                                                                 // --list
           refused?, ids?: [], near?: [] }                                                                                      // an id that is not one
error    { ok, error }
```

### What `check` finds

77 findings, by agent. The severity is the usual one (a few depend on the case: a `bash` field in a Copilot hook is an error where the tool call is denied, a warning where it is not, and a note where a Git Bash runs it). The basis is `verified` when the binary showed it in the tests, `documented` when the vendor's documentation or a maintainer's words say it, and `not verified` when neither; `explain <id>` marks each line of a page the same way. The five machine-wide checks that claude-windows-doctor made (long paths, `core.autocrlf`, the execution policy, the code page, a stale `.git\index.lock`) and its user-environment and WSL checks are under `claude.`, and are reported when Claude Code is among the agents checked.

| Id | Severity | Basis | What it says |
| --- | --- | --- | --- |
| `claude.no-shell-tool` | error | verified | Claude Code will not start: no Git Bash and the PowerShell tool is off |
| `claude.git-bash-not-found` | warning | verified | Git for Windows is installed, but Claude Code does not find its bash.exe |
| `claude.git-bash-path-ignored` | warning | verified | CLAUDE_CODE_GIT_BASH_PATH is set, and Claude Code ignores it |
| `claude.git-bash-path-project-settings` | warning | verified | CLAUDE_CODE_GIT_BASH_PATH is in a project or local settings file, where it is not used |
| `claude.git-bash-broken` | warning | verified | Git Bash is found, and does not start |
| `claude.powershell-variable-unread` | warning | verified | CLAUDE_CODE_USE_POWERSHELL_TOOL is set to a value Claude Code does not read |
| `claude.default-shell-scope` | note | verified | defaultShell is not the shell the model gets |
| `claude.powershell-5` | note | verified | The PowerShell tool runs Windows PowerShell 5.1 |
| `claude.wsl-bash-on-path` | note | verified | bash.exe on PATH is the WSL launcher |
| `claude.launcher-first` | warning | not verified | The first claude on PATH is not the command line |
| `claude.not-on-path` | warning | verified | claude is installed and its folder is not on PATH |
| `claude.multiple` | warning | documented | More than one claude command line is installed |
| `claude.older-first` | warning | verified | The claude that runs first is older than another one |
| `claude.no-version` | warning | verified | A claude on PATH does not print a version |
| `claude.node-for-npm` | note | verified | Node is older than the npm package of Claude Code wants |
| `claude.long-paths` | note | verified | Long paths are not switched on |
| `claude.autocrlf` | note | verified | git converts line endings (core.autocrlf is true) |
| `claude.execution-policy` | warning | verified | The PowerShell execution policy blocks scripts |
| `claude.code-page` | note | verified | The console code page is not UTF-8 |
| `claude.index-lock` | warning | not verified | A stale .git\index.lock |
| `claude.user-env-not-in-process` | warning | documented | A variable of the Windows user environment is not in this process |
| `claude.user-env-differs` | warning | documented | A variable differs between the user environment and this process |
| `claude.process-env-not-in-user` | note | documented | A setting exists in this process only |
| `claude.wsl-no-distro` | note | documented | WSL has only the distributions of other tools |
| `claude.wsl-windows-claude` | warning | not verified | In WSL, claude is the Windows one |
| `claude.wsl-config-on-mnt` | warning | documented | In WSL, the config folder or the project is on a Windows drive |
| `claude.wsl-inherits-windows` | note | documented | WSL reads the Windows managed settings |
| `claude.hook-bash-syntax` | warning | verified | A Claude Code hook command is a bash line, and Claude Code runs it through PowerShell |
| `claude.hook-extensionless` | warning | documented | A Claude Code hook starts a file that has no extension |
| `codex.not-on-path` | warning | verified | Codex CLI is installed and its folder is not on PATH |
| `codex.multiple` | warning | documented | More than one Codex CLI command line is installed |
| `codex.older-first` | warning | verified | The codex that runs first is older than another one |
| `codex.no-version` | warning | verified | The Codex CLI command on PATH does not print a version |
| `codex.node-for-npm` | note | verified | Node is older than the npm package of Codex CLI wants |
| `codex.sandbox-none` | warning | verified | Codex has no Windows sandbox selected, and workspace-write becomes read-only |
| `codex.mxc-unavailable` | warning | documented | MXC is selected, and this Windows is too old for it |
| `codex.shell-path-ignored` | warning | verified | windows.shell_path is set, and Codex does not have that key |
| `codex.home-wsl` | note | documented | CODEX_HOME is set on Windows, and WSL can read it |
| `codex.hook-exit-2` | note | verified | A Codex hook that exits with code 2 does not block on Windows |
| `codex.hook-trust` | note | verified | A Codex hook runs only after you have trusted it |
| `codex.hook-bash-syntax` | warning | verified | A Codex CLI hook command is a bash line, and Codex CLI runs it through PowerShell |
| `codex.hook-ps1-policy` | warning | documented | A Codex CLI hook runs a .ps1 script, and the execution policy blocks it |
| `codex.hook-extensionless` | warning | documented | A Codex CLI hook starts a file that has no extension |
| `gemini.not-on-path` | warning | verified | Gemini CLI is installed and its folder is not on PATH |
| `gemini.multiple` | warning | documented | More than one Gemini CLI command line is installed |
| `gemini.older-first` | warning | verified | The gemini that runs first is older than another one |
| `gemini.no-version` | warning | verified | The Gemini CLI command on PATH does not print a version |
| `gemini.node-for-npm` | note | verified | Node is older than the npm package of Gemini CLI wants |
| `gemini.powershell-not-on-path` | error | verified | Gemini CLI finds no PowerShell on PATH |
| `gemini.constrained-language-mode` | error | documented | PowerShell is in Constrained Language Mode, which Gemini CLI cannot work in |
| `gemini.node-pty-missing` | warning | documented | The Gemini CLI install has no node-pty binary |
| `gemini.hook-bash-syntax` | warning | verified | A Gemini CLI hook command is a bash line, and Gemini CLI runs it through PowerShell |
| `gemini.hook-ps1-policy` | warning | documented | A Gemini CLI hook runs a .ps1 script, and the execution policy blocks it |
| `gemini.hook-extensionless` | warning | documented | A Gemini CLI hook starts a file that has no extension |
| `copilot.not-on-path` | warning | verified | GitHub Copilot CLI is installed and its folder is not on PATH |
| `copilot.multiple` | warning | documented | More than one GitHub Copilot CLI command line is installed |
| `copilot.older-first` | warning | verified | The copilot that runs first is older than another one |
| `copilot.no-version` | warning | verified | The GitHub Copilot CLI command on PATH does not print a version |
| `copilot.node-for-npm` | note | verified | Node is older than the npm package of GitHub Copilot CLI wants |
| `copilot.powershell-not-on-path` | error | verified | Copilot CLI finds neither pwsh.exe nor powershell.exe |
| `copilot.pwsh-missing` | note | verified | Copilot CLI asks for PowerShell 6 or newer, and this machine has only Windows PowerShell 5.1 |
| `copilot.hook-bash-only` | error, warning, note | verified | A Copilot hook has a bash field and no powershell field |
| `copilot.claude-hooks` | warning, note | verified | Copilot CLI also runs the hooks of .claude/settings.json |
| `copilot.hook-bash-syntax` | warning | verified | A GitHub Copilot CLI hook command is a bash line, and GitHub Copilot CLI runs it through PowerShell |
| `copilot.hook-ps1-policy` | warning | verified | A GitHub Copilot CLI hook runs a .ps1 script, and the execution policy blocks it |
| `copilot.hook-extensionless` | warning | documented | A GitHub Copilot CLI hook starts a file that has no extension |
| `cursor.not-on-path` | warning | verified | Cursor is installed and its folder is not on PATH |
| `cursor.multiple` | warning | documented | More than one Cursor command line is installed |
| `cursor.older-first` | warning | verified | The agent that runs first is older than another one |
| `cursor.no-version` | warning | verified | The Cursor command on PATH does not print a version |
| `cursor.launcher-quotes` | warning | documented | The Cursor CLI launcher drops double quotes and eats exclamation marks |
| `cursor.launcher-no-version` | error | verified | The Cursor CLI launcher cannot pick a version folder |
| `cursor.msystem` | warning | documented | MSYSTEM is set, and Cursor runs its hooks with bash |
| `cursor.hook-stdin-bom` | note | documented | A Cursor hook's stdin starts with a byte order mark on Windows |
| `cursor.hook-bash-syntax` | warning | documented | A Cursor hook command is a bash line, and Cursor runs it through PowerShell |
| `cursor.hook-ps1-policy` | warning | documented | A Cursor hook runs a .ps1 script, and the execution policy blocks it |
| `cursor.hook-extensionless` | warning | documented | A Cursor hook starts a file that has no extension |

## How it works

`check` collects the facts first, from the machine, and judges them after; the same facts feed the text, the markdown and the JSON.

1. **The machine.** The release and build of Windows from the operating system, and the update revision (`UBR`) and `DisplayVersion` from the registry; the PowerShell editions: Windows PowerShell 5.1 at `%SystemRoot%\System32\WindowsPowerShell\v1.0` and every `pwsh.exe` that `where.exe` lists or an installer's folder holds, each asked once for its edition, language mode and `Get-ExecutionPolicy -List`; Git for Windows from the registry, `where.exe git` and the usual folders; every `bash.exe` on PATH, told apart (Git Bash, or the WSL launcher in `System32`); `LongPathsEnabled`; `git config` for `core.autocrlf` and `core.longpaths`; `chcp`; `wsl.exe -l -v`; Node and npm.
2. **Every agent.** The folders of PATH in order, trying each name in the order of `PATHEXT` as `cmd.exe` does (`test/windows.test.mjs` starts one command from several folders in `cmd.exe` and compares, and compares the folders and files with `where.exe`), then the places the installers use: npm's global folder, WinGet, the native installers, the desktop apps' bundles under `%APPDATA%\Claude\claude-code` and the Microsoft Store package of Codex, the cache that `copilot.exe` unpacks under `%LOCALAPPDATA%\copilot\pkg`, the Cursor CLI folder `%LOCALAPPDATA%\cursor-agent`. An npm `.cmd` shim is followed to the JavaScript it starts and the program next to it. A version is read from the `package.json` of the package, the version resource of an `.exe`, or the name of a version folder, and the report says which; only `check --live` asks the program (`--version`).
3. **The shell.** For Claude Code, the search it makes for Git Bash, in its order, and the rules for its PowerShell tool (the 129 cases of `test/shell-table.mjs`, put to the binary in claude-windows-doctor and held to the prediction here). For Codex CLI, Gemini CLI and Copilot CLI, how each finds a PowerShell, from the runs described below. For Cursor, the launcher read from disk.
4. **Hooks.** The files each agent reads: Claude Code's settings (user, project, local, managed); Codex's `config.toml` (user, system under `ProgramData`, and a trusted project's) and `hooks.json`, with `command_windows`; Gemini CLI's settings (system, user, project); Copilot CLI's `COPILOT_HOME\hooks`, `.github\hooks`, the policy folder and the project's `.claude\settings.json`; Cursor's `hooks.json` files. Each command is judged: what starts it, whether it looks like bash, whether it starts a `.ps1` under a blocking execution policy, whether it starts a file with no extension.
5. **Codex on Windows.** `CODEX_HOME`, the layers of `config.toml` merged as Codex merges them, the keys `windows.sandbox` and `features.prefer_mxc`, the sandbox log under `CODEX_HOME\.sandbox`, and the build of Windows against the MXC minimum.
6. **Findings.** One function per agent turns facts into findings with an id, a severity, a message, what the agent does, the fix and a basis. The basis comes from the `explain` page of the id, so the report and the page cannot disagree.
7. **`--live`.** The guard, a fake API per agent on 127.0.0.1, the real binary, the shell command that prints its own command line, the comparison with the prediction.

On Linux and macOS, `check` says there is nothing to check and exits 0. Inside a WSL distribution it looks at the WSL side of Claude Code (a Windows `claude` reached through `/mnt`, a config folder or a project on a Windows drive, the Windows managed settings) and at `CODEX_HOME` when it is on a Windows drive. The Windows logic is written against a `sys` object (platform, environment, files, programs), so the tests put a pretend Windows machine in its place and run it on every system; `AGENT_WINDOWS_DOCTOR_MANAGED_DIR` and `AGENT_WINDOWS_DOCTOR_USER_ENV_FILE` let a test (or you) point two reads somewhere else.

### Privacy

It sends nothing anywhere, has no telemetry and no account, and has no network code except the local connection of `check --live` (a server on 127.0.0.1 for the fake API, in `src/live.mjs`, the only file that opens a connection).

- **It reads** the settings and hook files named above (only the keys that matter), the registry (the values of `HKCU\Environment`, `LongPathsEnabled`, the code pages, the build of Windows, the managed settings of Claude Code, where Git for Windows is installed), the folders of PATH and of the installers, the `package.json` of npm packages, the version resource of programs, Codex's sandbox log, and the output of `where.exe`, `reg.exe query`, `git`, `powershell.exe` (and the first `pwsh.exe`), `cmd.exe /c chcp`, `wsl.exe -l -v`, `npm`, and `Get-AppxPackage` for the Codex desktop app. No file is shown whole, and an environment value is printed only when its name says it is a path or a switch: a token in `ANTHROPIC_API_KEY` shows as "set".
- **It writes nothing** of yours. `src/write.mjs` is the only code that writes, and it makes the throwaway folders of `check --live`, under the system temp folder, and removes them afterwards. A test fails if a file other than `src/write.mjs` can write, a file other than `src/sys.mjs` and `src/live.mjs` can start a program, or a file other than `src/live.mjs` can open a connection.
- **It starts an agent only with `--live`.** The binary gets a dummy key, a throwaway home and project folder, and none of your agent variables; your hooks do not run. The guard refuses to start anything unless every home folder is inside the throwaway folder and every proxy is a closed port on 127.0.0.1 (with `NO_PROXY=127.0.0.1,localhost`): a probe on 17 October 2026 wrote into a real `~/.codex` because `HOME` was set and `CODEX_HOME` was not, and the guard exists so that it cannot happen again. The Cursor CLI is never started. See [SECURITY.md](SECURITY.md).

## What was verified, and how

Run on 18 October 2026 on Windows 11 Home Single Language 10.0.26300.9711 (26H2), x64, with Node 24.19.0 and npm 11.17.0, Windows PowerShell 5.1.26100.9711 (this machine has no PowerShell 7) and Git for Windows 2.55.0 at `E:\Das\Git` (not at `C:\Program Files\Git`). Every real binary was started with `spawn`, with its standard input ignored, against a fake API on 127.0.0.1, in a throwaway `HOME`, `USERPROFILE`, `LOCALAPPDATA`, `APPDATA` and agent folder, behind the guard (`test/sandbox.mjs`), with every proxy a closed port: no model was reached and no token was spent. A "stand-in for PowerShell 7" below is a copy of `powershell.exe` named `pwsh.exe` in a folder of its own: those runs show which file an agent starts, not how it behaves in PowerShell 7.

A finding or a line of an `explain` page is marked **verified** only when a test put it to the binary: a test below, or, for the rows of Claude Code's table that none of them restates, the tests of claude-windows-doctor (the same table, put to Claude Code 2.1.295 and 2.1.299). What each binary was asked, and what it answered:

### Claude Code 2.1.302 and 2.1.299

2.1.302 is the npm package `@anthropic-ai/claude-code`, whose bin is a native `claude.exe`; 2.1.299 is the bundle of the Claude desktop app (`%APPDATA%\Claude\claude-code\2.1.299\f0584be0fbaf\claude.exe`). `test/e2e-claude.test.mjs` ran with each, with the same result: every test passed.

- **The shell tools of the first request.** 37 rows of the table of 129 cases (`test/shell-table.mjs`), one for each claim an explain page restates (`test/claude-claims.mjs` names them): no Git Bash, found through `where git` (`cmd\git.exe` yes, `mingw64\bin\git.exe` no, the order of two Gits, a `git.exe` in the project folder skipped), the variable (forward and back slashes, a space in the path, `git-bash.exe`, quotes, `%USERPROFILE%`, a relative path, a missing file, an empty value ignored; a valid value winning over PATH), the variable in user, project and local settings (only the user's is used), `CLAUDE_CODE_USE_POWERSHELL_TOOL` with the values it reads and does not read, and the whole-tool deny rules. For each, the binary listed the tools the table records, exited as it records, named the `bash.exe` the prediction names in its debug log, and `predictShell` agreed. Two more rows apply only to a machine with Git at `C:\Program Files\Git`, which this one does not have; the CI runner has it, and 18 of the 39 rows apply there (the rows that are marked for a machine without Git in its usual folder do not apply there). The full table was put to Claude Code 2.1.295 and 2.1.299 in claude-windows-doctor, and `test/claude-shell.test.mjs` holds all 129 rows to the prediction on a pretend machine.
- **The PowerShell tool's edition.** Six PATH layouts: only `System32`, a `pwsh.exe` on PATH (a stand-in), `PowerShell\7` under the folder `ProgramW6432` names, `.dotnet\tools` in the home folder, a `powershell.exe` first on PATH, and `pwsh` after `powershell`: the second line of the tool's description named the edition the prediction named. With Windows PowerShell 5.1 the description says `&&` and `||` are not available.
- **`defaultShell`** with `bash`, `powershell` and `cmd` (6 runs, two states): the same tools and a request of the same size as without it.
- **The Git of this machine** (`E:\Das\Git`), with `cmd` first on PATH, `mingw64\bin` first and `mingw64\bin` alone: found, not found, not found, as predicted.
- **The words of the debug log** for a variable it ignores (`is not a bash/sh binary` for `git-bash.exe`, `not found` for a missing file, each followed by `falling back to auto-detection`) and for no Git Bash (`Git Bash not found; BashTool will be unavailable`).
- **The execution policy.** A PowerShell hook and the PowerShell tool both saw `Process Bypass` in `Get-ExecutionPolicy -List`; with `CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY` in the environment or in the user settings, `Process Undefined`.
- **Line endings, the code page, long paths.** The Write tool wrote a new file with LF only and the Edit tool kept the CRLF of the file it changed; `cmd.exe /c dir` through the Bash tool printed replacement characters for `café-über.txt` under code page 437 while the PowerShell tool set 65001 and printed it right; the Write tool wrote a file at a path of 392 characters (on this machine `LongPathsEnabled` is on).
- **The words it stops with**, with no Git Bash and `CLAUDE_CODE_USE_POWERSHELL_TOOL=0`: exit 1, no request, "Claude Code on Windows requires a shell tool. Git Bash was not found and the PowerShell tool is disabled".
- **`claude doctor`** names no shell, PowerShell or bash in its 28 lines (36 for 2.1.299); for the desktop bundle it says "Native installation exists but ... is not in your PATH", for the npm package it does not.
- **The npm package.** The inventory read version 2.1.302, `engines.node` `>=22.0.0` and the program of its bin from `package.json`, as the binary prints it.

### Codex CLI 0.163.0

The npm package `@openai/codex`: `codex.cmd` starts `bin\codex.js`, which starts `codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe`; `codex --version` prints `codex-cli 0.163.0`, and the inventory read the same number from `package.json`. `test/e2e-codex.test.mjs` (9 tests) ran `codex exec --json` against a fake Responses API:

- **The shell.** The `command_execution` item names the PowerShell that ran the command, by its full path (Codex prints each backslash of it twice). On this machine, which has no PowerShell 7 in `C:\Program Files`, seven rows: with no `pwsh.exe` on PATH, the `powershell.exe` of `System32`; a stand-in `pwsh.exe` first on PATH, that file; a `pwsh.exe` and a `powershell.exe` in one folder first on PATH, the `pwsh.exe`; a copy of `powershell.exe` first on PATH and no `pwsh.exe`, that copy; and the `powershell.exe` of `System32` again when a `pwsh.exe` was only in a `ProgramFiles` folder that `ProgramFiles` and `ProgramW6432` name, when one was in the project folder, and when the PowerShell folder was off PATH. The same seven rows ran in run 39105519000 of the `e2e` workflow, on `windows-latest` (Windows Server 2025, 10.0.26100, Node 22.23.3), which has PowerShell 7 in `C:\Program Files\PowerShell\7` and starts its own steps with it; the tests expect that file wherever PATH did not list a `pwsh.exe` (run 39103453346 was the first to show it), and they passed. Codex started `C:\Program Files\PowerShell\7\pwsh.exe` in those five rows, among them the one with a copy of `powershell.exe` first on PATH, so the path written into Codex comes before a `powershell.exe` on PATH. That path and `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` are text in `codex.exe`, once each (the first test of the file searches the program for them). The prediction named the same file in each row on both machines.
- **No key chooses it.** `windows.shell_path` (in `config.toml` and as `-c windows.shell_path=...`), `windows.shell`, `windows.default_shell` and `shell` each stopped `codex exec --strict-config` with `unknown configuration field` and no command ran; without `--strict-config` the key was ignored and the command ran in PowerShell. `features.powershell_shell_version` is accepted (a feature flag).
- **Hooks.** A PreToolUse hook that exited with 2, and one that exited with 1, did not stop the command; a hook that printed `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",...}}`, and one that printed `{"decision":"block",...}`, did, and the model got "Command blocked by PreToolUse hook: <reason>". `command_windows` and `commandWindows` replaced `command`; a `hooks.json` in `CODEX_HOME` was read. The parent of the hook process was the file that ran the shell tool, `powershell.exe -NoProfile -Command ...` (the stand-in `pwsh.exe` when PATH had one), and, with Windows PowerShell 5.1, a hook command with `&&` did not run while the command it guarded did (on the `windows-latest` runner, where Codex's shell is PowerShell 7, the same hook ran: PowerShell 7 reads `&&`, and `test/windows.test.mjs` put `node -e "0" && echo done` to its `pwsh.exe` there). Without `--dangerously-bypass-hook-trust` the hook did not run.
- **The Windows sandbox.** With `sandbox_mode = "workspace-write"` and nothing selected, the header of `codex exec` said `sandbox: read-only` and `CODEX_HOME\.sandbox\sandbox.<date>.log` said `Windows sandbox selection: disabled`; `windows.sandbox = "unelevated"` gave `workspace-write` and `unelevated`; `features.prefer_mxc = true` and `windows.sandbox = "mxc"` gave `mxc` (the log said `MXC availability: true` on this build). The tool's reading of the configuration agreed each time. On the `windows-latest` runner (Windows Server 2025, 10.0.26100), where the log said `MXC availability: false`, `features.prefer_mxc = true` selected no sandbox (`disabled`, header `read-only`), `windows.sandbox = "mxc"` was logged as `mxc` all the same, and the tool agreed with the log in each case.
- **`codex doctor`** (174 lines here, 165 on the runner) names no shell, PowerShell or bash.

### Gemini CLI 0.64.0

The npm package `@google/gemini-cli` (`bundle\gemini.js`; `engines.node` `>=20`). `test/e2e-gemini.test.mjs` (7 tests) ran `gemini -p ... --yolo --skip-trust --output-format json` against a fake Gemini API (the requests of its utility router are answered with a document built from the schema they send); seven turns went in parallel, and the file took 15 seconds here:

- **The shell.** With no `pwsh.exe` on PATH, `run_shell_command` ran `C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -Command ...` in Windows PowerShell 5.1; with a stand-in `pwsh.exe` first on PATH, `pwsh.exe -NoProfile -Command ...` (no `-NonInteractive`); `__PSLockdownPolicy=4` in the environment of the process left the language mode at `FullLanguage`. The process also printed the file it was started from (`Get-Process -Id $PID | Select-Object -ExpandProperty Path`): a copy of `powershell.exe` first on PATH was the file that ran, and a `pwsh.exe` in the project folder was not started (the `powershell.exe` of `System32` ran). With the PowerShell folder off PATH, and a `pwsh.exe` in a `ProgramFiles` folder that PATH does not list, the tool answered `{"error":"spawn powershell.exe ENOENT"}`; the model got that, the answer was printed, and then, with Node 24.19.0, the process ended with a libuv assertion and exit code 3221226505 (in every run here; it ended with 0 when a PowerShell was found, and with 0 in both cases with Node 22.23.3 on the `windows-latest` runner). On that runner, which has PowerShell 7 in `C:\Program Files\PowerShell\7`, the other rows gave the same answers, and the row with the PowerShell folder off PATH still ended in `spawn powershell.exe ENOENT`: Gemini CLI does not look in Program Files. On PowerShell the tool refuses a command that holds a parenthesis outside quotes, such as `(Get-Process -Id $PID).Path` or a method call like `[Diagnostics.Process]::GetCurrentProcess()`: it answers "Command injection detected: command substitution syntax ... On PowerShell, @() array subexpressions and $() subexpressions are also blocked" and runs nothing, which is why the test's command has none.
- **Hooks.** The parent of a `BeforeTool` or `SessionStart` hook was `powershell.exe -NoProfile -NonInteractive -Command "<command>; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }"`. A hook with `&&` did not run, and PowerShell's parser error ("not a valid statement separator") was printed as a warning while the tool ran. A hook that exited with 2 blocked the tool call ("Tool execution blocked: <stderr>"); one that exited with 1 did not. `test/windows.test.mjs` shows why this differs from Codex: `powershell.exe -Command "node -e process.exit(2)"` exits with 1, and with the appended check with 2.
- **node-pty.** The package lists `@lydell/node-pty` and `@lydell/node-pty-win32-x64` as optional dependencies, and the install has `conpty.node`.

### GitHub Copilot CLI 1.0.98

The npm package `@github/copilot` (`npm-loader.js`, which starts `copilot-win32-x64\copilot.exe`; the package has no `engines` field; `copilot.exe` unpacks the package it runs under `%LOCALAPPDATA%\copilot\pkg\win32-x64\1.0.98`). `test/e2e-copilot.test.mjs` (9 tests) ran `copilot -p ... --allow-all-tools -s` offline against a fake chat completions API:

- **The shell.** The `powershell` tool printed its own command line: `"powershell.exe" -NoProfile -NoLogo -NonInteractive -Command ...` in Windows PowerShell 5.1 (`$PSHOME` under `WindowsPowerShell\v1.0`) with no `pwsh.exe` anywhere, `"pwsh.exe" ...` with a stand-in on PATH, and `powershell.exe` again when a `pwsh.exe` was only in a `ProgramFiles` folder off PATH. The process also printed the file it was started from: a copy of `powershell.exe` first on PATH was the file that ran, and a `pwsh.exe` in the project folder was not started (the `powershell.exe` of `System32` ran). With neither on PATH the tool was still listed to the model and answered "PowerShell is not available. Tried "pwsh.exe", "powershell.exe". Install PowerShell from https://aka.ms/powershell ...", with `spawn pwsh.exe ENOENT` and `spawn powershell.exe ENOENT`; the same on the `windows-latest` runner, which has PowerShell 7 in `C:\Program Files\PowerShell\7`, so Copilot CLI does not look there either.
- **Hooks.** The `powershell` field ran as `"powershell.exe" -nop -nol -c "<command>"` (`pwsh.exe` when PATH had one); `&&` in it was a parse error of Windows PowerShell 5.1, the hook did not run, and Copilot CLI answered the tool call "Denied by preToolUse hook from ... (hook errored)"; so did a `.ps1` started with `-ExecutionPolicy Restricted`, and with `Bypass` it ran. A `bash` field ran as `bash --norc --noprofile -c ...` through a Git Bash first on PATH, and was denied the same way with no bash on PATH and with the WSL launcher (`C:\Windows\System32\bash.exe`) first. `exec` with `args` started the program with no shell (the parent was `copilot.exe`). A hook in the project's `.claude\settings.json` ran through PowerShell with `CLAUDE_PROJECT_DIR` and `COPILOT_PROJECT_DIR` set and `$CLAUDE_PROJECT_DIR` an empty PowerShell variable; the same hook in `~\.claude\settings.json` did not run; a `powershell` field in `.github\hooks\*.json` ran.

### Cursor

The Cursor CLI was not installed or run: it needs a login, and its installer (`irm 'https://cursor.com/install?win32=true' | iex`) downloads and runs a script, which this build does not do. What is checked is the launcher: the files of a Cursor CLI 2026.06.16 install that was on this machine (`agent.cmd`, the lines of `cursor-agent.ps1` that pick a version folder, the name of the folder the installer made) were read, and `test/cursor-files.mjs` holds them as they were. `agent.cmd` starts `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "...\cursor-agent.ps1" %*` after `setlocal enabledelayedexpansion`; the folder `2026.06.16-20-30-07-a07d3ac` does not match the pattern `^\d{4}\.\d{1,2}\.\d{1,2}-[a-f0-9]+$` that the script uses, which PowerShell's own `-match` confirmed (`test/windows.test.mjs`). What the launcher then does was read from the script, not run. Everything about Cursor's hooks and its shell is documented, from the Cursor documentation and the forum threads, and marked so.

### `check --live`, and the real Windows

- `test/e2e-live.test.mjs` runs the tool's own `check --live` (in a child process, behind the guard, with a PATH of the system folders) against each real binary and against all four: each reported "proved with the real <agent> <version>", the version the binary printed for itself was the one the report states, and a path that is not a file failed with exit code 1.
- `test/windows.test.mjs` (16 tests) reads the real Windows, read only, and cross-checks each answer another way: `HKCU\Environment` through `reg.exe` against .NET's list of user variables; `LongPathsEnabled` and the ANSI code page against PowerShell's registry provider; the build, update revision and release of Windows against .NET and the registry; the execution policy of every scope, the code page, `git config` and Node against PowerShell, `git` and the runner; `wsl.exe -l -v` (UTF-16) against `wsl.exe -l -q`; that every Git Bash found starts; every `bash.exe` on PATH against `where.exe`; each PowerShell edition's version, language mode and execution policy against what PowerShell says of itself; the PATH folders and program files of a command against `where.exe`, and which of the same command in several folders `cmd.exe` starts first (folders in the order of PATH, files in the order of `PATHEXT`: `.bat` before `.cmd`) against the one the tool names; the Cursor version pattern against PowerShell's `-match` on nine folder names; the version resource of `powershell.exe` and `node.exe` against `Get-Item`; the Codex desktop app against `Get-AppxPackage`; the eight kinds of bash syntax the tool names (`&&`, `$VAR`, `/dev/null`, `export`, `[ -f x ]`, `if ...; then`, a here-document, a `.sh` file) against what the real `powershell.exe` 5.1 does with them; the exit codes of `-Command`; and `check`, `agents` and `--markdown` run in a throwaway world, which they leave as it was.
- **The install line.** `npx -y github:nrzz/agent-windows-doctor#5d6350a --version` printed `agent-windows-doctor 1.0.0`, and the line without a commit (`npx -y github:nrzz/agent-windows-doctor explain codex.shell-path-ignored`) printed the page, with npm 11.17.0, a throwaway npm cache and a throwaway home. `check` was not run through it: it reads the machine.

### Tests

- **276 automated tests** (`npm test`, Node's own runner, no dependencies). `node --test` also reports each of the 12 helper files under `test/` as a passing test; those are not counted here (the runner's total was 288). On Windows 232 pass and 44 are skipped when no real binary is named: the skipped ones are the real-binary checks described above, which run only when `E2E_CLAUDE`, `E2E_CODEX`, `E2E_GEMINI` or `E2E_COPILOT` names a binary. On Linux and macOS 215 pass and 61 are skipped, because the tests that read the real Windows are skipped as well; everything else there runs against pretend Windows machines. The test that states these numbers fails if the README's are not the runner's, on each system. The test that states this number runs the suite a second time to count it: one run of the suite takes 35 seconds on the machine this was written on, and `npm test`, with the count, 59. The tests cover:
  - Claude Code's shell: the 129 cases of the table against the prediction on a pretend machine, the settings files, Git Bash, the user environment, WSL (`claude-shell.test.mjs`, `claude-settings.test.mjs`, `gitbash.test.mjs`, `userenv.test.mjs`, `wsl.test.mjs`, `facts.test.mjs`).
  - The inventory of binaries, launchers and shims, and versions read without running anything (`inventory.test.mjs`), the machine and the PowerShell editions (`machine.test.mjs`), Codex on Windows (`codex.test.mjs`), the Cursor launcher, node-pty and the Node each package asks for (`agentfacts.test.mjs`), and the hooks (`hooks.test.mjs`).
  - The findings: each of the 77 ids is produced by some pretend machine, with the severity of its table and the basis of its page (`findings.test.mjs`); the pages of `explain` (`explain.test.mjs`); the text, markdown and JSON reports, the cap of 12 findings and 500 characters, and that a secret in the environment is in none of them (`report.test.mjs`); the options, the exit codes and every usage error (`cli.test.mjs`).
  - `check --live` against stand-ins for the four binaries: the guard refuses a missing, empty, relative or outside folder variable and a proxy that is not the closed port, in every spelling; the fake APIs; what each run reads (`live.test.mjs`). The guard of the tests, the same for the real binaries (`sandbox.test.mjs`).
  - The real Windows, read only (`windows.test.mjs`), and the real binaries (`e2e-claude.test.mjs`, `e2e-codex.test.mjs`, `e2e-gemini.test.mjs`, `e2e-copilot.test.mjs`, `e2e-live.test.mjs`).
  - The repository and the README (`repo.test.mjs`, `readme.test.mjs`): no dependencies, who may start a program, open a connection or write a file, that no agent binary starts outside the guard, LF line endings, the community files and the workflows; the README's sections, usage block, numbers, table of findings, JSON shapes, examples and Files table.

## Not verified

What was not put to a binary, and what the report says about it (each is marked documented or not verified where it comes up):

- **Windows 10, Windows on ARM64, 32-bit Windows, and Windows 11 builds below 26100.9278.** The runs were on Windows 11 on x64. `codex.mxc-unavailable` is documented, not tried on a Windows 11 below the minimum build, because none was at hand (the runner's Windows Server 2025 showed the effect of an unavailable MXC, above).
- **Cursor.** The Cursor CLI was never installed or run (a login is needed, and the installer downloads and runs a script). The launcher was read from disk and its pattern was held to PowerShell's `-match`; the shell the CLI gives the model, the shell that runs its hooks, the `MSYSTEM` behaviour, the byte order mark in a hook's input and the extensionless-launcher dialog are documented from the forum and the documentation. The Cursor editor is only found, with its file version.
- **Other installs.** The agents were installed with npm (Claude Code also as the desktop app's bundle). The WinGet packages, the standalone Codex installer, the editor extensions' copies of Claude Code, the Microsoft Store package of Codex and the Cursor editor are found and listed, with a version where one can be read, and never run. A Microsoft Store alias of `pwsh` is modelled, not tried.
- **PowerShell 7 itself.** This machine has none; the runs with `pwsh.exe` used a copy of `powershell.exe` under that name. What PowerShell 7 itself does (its `&&`, and the PowerShell 7 in `C:\Program Files` that Codex falls back to) was put to a binary only by the `e2e` workflow on `windows-latest`, which has it, and not here.
- **Cygwin and MSYS2.** Git for Windows' `bash.exe` and the WSL launcher are the bashes that are told apart; any other `bash.exe` is "another bash".
- **The desktop apps and the editors.** The shell that the Claude desktop app, the Codex desktop app, VS Code and JetBrains give the model is not checked; their binaries are found, and the environment they read (the user environment, once, at start) is compared with this process, not tried.
- **Codex CLI.** The `elevated` sandbox (its setup needs an administrator), any command run inside a sandbox, managed hooks (`requirements.toml`), the review of hooks in the CLI (`/hooks`, which needs the interactive CLI), project `.codex` layers and their trust (read the way codex-config-doctor put them to the binary), and the WSL mode of the desktop app that reads the Windows `CODEX_HOME` (`codex.home-wsl`, documented from the issue).
- **Gemini CLI** under Constrained Language Mode (documented from the issue; a process cannot be put in the mode from its environment), the system settings file under `ProgramData\gemini-cli`, and an install without the native half of node-pty.
- **Copilot CLI** policy hooks (`ProgramData\GitHub\Copilot\policy.d` and the registry) and the hooks that plugins ship (github/copilot-cli#3659).
- **Claude Code** whether the PowerShell tool is on when Git Bash is found and the variable is not set (an account decides, and a fake API has no account: `check` says so and quotes the documentation), a Group Policy execution policy, `LongPathsEnabled` off, a stale `.git\index.lock` left by the Bash tool (`claude.index-lock`, not verified), what the Bash tool says when its `bash.exe` cannot start, and `claude.launcher-first` (not verified).
- **WSL.** The WSL side of `check` is held to pretend machines only: the one distribution on this machine is Docker Desktop's, which `check` calls another tool's, and the workflows install none.
- **Other versions.** The statements about an agent are about the versions named above. `e2e.yml` installs the newest release of each agent weekly and on every push, so a release that changes how an agent finds its shell shows up there, not here.

## Files

One copy of everything: nothing depends on another repository. The files marked "copied" come from the author's own repositories (MIT), and the CHANGELOG says so.

| Path | What it holds |
| --- | --- |
| `bin/agent-windows-doctor.mjs` | the command line entry |
| `src/cli.mjs` | the options, the help, the exit codes, the three commands |
| `src/check.mjs` | `check`: collects the facts of the Windows machine, or of the WSL side, and hands them to the findings |
| `src/findings.mjs` | the findings: their ids, severities, messages, effects and fixes |
| `src/explain.mjs`, `src/pages-claude.mjs`, `src/pages-others.mjs` | `explain`: the page of every id, each line marked verified, documented or not verified |
| `src/report.mjs` | the text, markdown and JSON reports |
| `src/inventory.mjs`, `src/versions.mjs` | every binary, launcher and shim of each agent, and which runs first; versions read without running the program |
| `src/shells.mjs` | the shell that Codex CLI, Gemini CLI, Copilot CLI and Cursor give the model, and how each finds it |
| `src/claude-shell.mjs`, `src/claude-settings.mjs`, `src/gitbash.mjs` | Claude Code's shell: its search for Git Bash and the rules of its PowerShell tool, the settings files that bear on them, where a Git Bash is (copied from claude-windows-doctor's `shell.mjs`, `settings.mjs` and `gitbash.mjs`) |
| `src/codexwin.mjs`, `src/toml.mjs` | Codex on Windows: `CODEX_HOME`, the config layers, the sandbox it selects and its log; the TOML reader that keeps the line of every key (copied from codex-config-doctor) |
| `src/agentfacts.mjs` | the Cursor launcher chain, the native half of Gemini CLI's node-pty, the Node each npm package asks for |
| `src/hooks.mjs` | the hook files of each agent, what starts each hook, and whether a command is a bash line |
| `src/machine.mjs`, `src/psprobe.mjs` | the Windows build and the MXC minimum, `bash.exe` on PATH, the PowerShell editions with their language mode and execution policy |
| `src/facts.mjs`, `src/userenv.mjs`, `src/wsl.mjs`, `src/winenv.mjs`, `src/winpath.mjs`, `src/jsonfile.mjs`, `src/sys.mjs` | Node and npm, long paths, `core.autocrlf`, the execution policy, the code page, `.git\index.lock`; the user environment against this process; WSL; the registry through `reg.exe` (the reading part only); Windows path rules that behave the same on every system; JSON read the way the agents read it; the machine as the checks see it, and the one place that starts a program for them (copied from claude-windows-doctor and claude-mcp-check) |
| `src/live.mjs` | `check --live`: the guard, the fake APIs on 127.0.0.1, the real binaries; the only code that opens a connection |
| `src/write.mjs` | the only code that writes: the throwaway folders of `check --live` |
| `src/version.mjs` | the version |
| `test/` | `npm test`. The unit tests (`*.test.mjs`, one for each part of `src/`), `repo.test.mjs` (the shape of the repository: no dependencies, who may start a program, open a connection or write a file, LF line endings, the community files, the workflows) and `readme.test.mjs` (the README held to the code and to the runner). `e2e-claude.test.mjs`, `e2e-codex.test.mjs`, `e2e-gemini.test.mjs`, `e2e-copilot.test.mjs` and `e2e-live.test.mjs` put the claims to the real binaries when `E2E_CLAUDE`, `E2E_CODEX`, `E2E_GEMINI` or `E2E_COPILOT` names one; `windows.test.mjs` cross-checks what the tool reads on the real Windows. The helper files: `helpers.mjs` (the throwaway world, and the guard that points every home folder and every proxy of the test process away from the real ones), `sandbox.mjs` (the guard that runs before any binary starts, and the launcher), `agents.mjs` (the fake APIs and recipes of the four agents), `record-hook.mjs` (records what an agent sends a hook and what started it), `machine.mjs` and `win-machine.mjs` (a pretend machine, and a clean pretend Windows machine that a test spoils in one way), `shell-table.mjs`, `table-lib.mjs` and `claude-claims.mjs` (the 129 cases of Claude Code's shell, how a case becomes a pretend machine or real files, and the rows put to the binary), `cursor-files.mjs` (the Cursor CLI launcher files), `fake-agent.mjs` (a stand-in for an agent's binary), `documents.mjs` (one JSON document of every kind) |
| `.github/workflows/test.yml`, `.github/workflows/e2e.yml` | the suite on Windows, macOS and Linux with Node 20, 22 and 24 (and 18 on Linux); the real agents, installed from npm, on the three systems |
| `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/dependabot.yml` | the issue forms, the pull request template, the weekly update of the actions |
| `CONTRIBUTING.md`, `CHANGELOG.md`, `ROADMAP.md`, `SECURITY.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md`, `LICENSE` | the community files and the licence |

## Contributing

Bug reports, a wrong prediction (with the output of `check --json`, and of `check --live` if you can run it) and pull requests are welcome; read [CONTRIBUTING.md](CONTRIBUTING.md) first (the house rules, the guard that every real-binary run goes through, how the tests are laid out). The ideas that are open are in [ROADMAP.md](ROADMAP.md), and the good first issue is [#1](https://github.com/nrzz/agent-windows-doctor/issues/1). Changes are listed in [CHANGELOG.md](CHANGELOG.md); the [Code of Conduct](CODE_OF_CONDUCT.md) applies, and security problems go to [SECURITY.md](SECURITY.md), not to an issue.

## Also by the same author

The [Claude Code toolkit](https://github.com/nrzz/claude-code-toolkit) has nineteen tools for Claude Code, and the two closest to this one are [claude-windows-doctor](https://github.com/nrzz/claude-windows-doctor), which goes deeper on Claude Code alone, and [everyhook](https://github.com/nrzz/everyhook), which writes one hook for every agent.

## License

MIT. See [LICENSE](LICENSE).
