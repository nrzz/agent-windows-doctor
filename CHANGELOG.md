# Changelog

All notable changes to agent-windows-doctor are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.4.0] - 2026-10-28

- `check --markdown --max <n>` sets how many errors and warnings the short report holds (default 12, minimum 1, whole numbers only). When there are more findings than the cap, the line `- ... and N more (run `agent-windows-doctor check`)` counts against the cap given. Using `--max` without `--markdown` or with a non-positive integer is a usage error (exit 2).
- Contributed by [@yoreva-01](https://github.com/yoreva-01) in [#8](https://github.com/nrzz/agent-windows-doctor/pull/8), for the good first issue [#7](https://github.com/nrzz/agent-windows-doctor/issues/7).

## [1.3.0] - 2026-10-19

- `explain --list <part>` filters the list of findings to every id containing the part, without regard to case and with surrounding whitespace ignored, padded to the longest id shown; `explain --list <agent>.` lists one agent's findings. With `--json`, `{ ok: true, findings: [ { id, title, basis } ] }`. When no id contains the part, exits 1 with a refusal and nearest suggestions (`no finding id contains "<part>"`).
- Contributed by [@yoreva-01](https://github.com/yoreva-01) in [#6](https://github.com/nrzz/agent-windows-doctor/pull/6), for the good first issue [#5](https://github.com/nrzz/agent-windows-doctor/issues/5).

## [1.2.0] - 2026-10-19

- `explain` tells an ambiguous part from an unknown id: a part that several ids contain is refused with every id that contains it, in page order (`explain hook-bash` names the six and says "Give one of them"; `explain .` names all 77), in text and in JSON (`ids` holds those ids and `near` is empty); an unknown id keeps its message with the nearest ids. Both exit 1.
- Contributed by [@yoreva-01](https://github.com/yoreva-01) in [#4](https://github.com/nrzz/agent-windows-doctor/pull/4), for the good first issue [#3](https://github.com/nrzz/agent-windows-doctor/issues/3).

## [1.1.0] - 2026-10-19

- `explain` takes a part of a finding id when exactly one id contains it: `explain shell-path` prints `codex.shell-path-ignored`, `explain sandbox` prints `codex.sandbox-none`, in any case. A whole id still wins, and a part that several ids contain is refused like an unknown id, with the nearest ids as candidates (`explain hook-bash` names the hook-bash-syntax ids; in `--json` they are `near`). `--json` is otherwise unchanged: the page's `id` is the full id.
- Contributed by [@yoreva-01](https://github.com/yoreva-01) in [#2](https://github.com/nrzz/agent-windows-doctor/pull/2), the first outside pull request, for the good first issue [#1](https://github.com/nrzz/agent-windows-doctor/issues/1).

## [1.0.0] - 2026-10-18

- First release. A read-only CLI that says, on Windows, what Claude Code, Codex CLI, Gemini CLI, GitHub Copilot CLI and Cursor each get and why. On Linux and macOS it says there is nothing to check and exits 0.
- `check [--project <dir>] [--agent claude,codex,gemini,copilot,cursor|all] [--json] [--markdown] [--live] [--claude <path>] [--codex <path>] [--gemini <path>] [--copilot <path>]` reports, in this order: the machine (Windows build, the PowerShell editions with their language mode and execution policy, Git for Windows and every `bash.exe` on PATH including the WSL launcher, long paths, `core.autocrlf`, the code page, WSL, Node and npm); every binary, launcher and shim of each agent with its version and which one a terminal runs first; the shell each agent gives the model and how it chose it; the hooks each agent would run and with which shell; Codex on Windows (`CODEX_HOME`, the sandbox it selects, `windows.shell_path`); and, with `--live`, a proof against the real binaries. Every finding has an id of the form `<agent>.<name>`, a severity, what the agent does, the fix and a basis: verified, documented or not verified.
- `check --live` starts each agent's real binary in a throwaway home against a fake API on 127.0.0.1 (no token is spent, no login is needed), reads the shell it gave the model, and compares that with the prediction: "proved with the real <agent> <version>". Before any binary starts a guard checks that every home folder is inside the throwaway folder and every proxy is a closed port. The Cursor CLI is never run.
- `check --markdown` is the short report to paste into any agent: at most 12 findings, 500 characters a line, and exit 0 always.
- `explain <finding-id>` prints what a finding means, what the agent does (each line marked verified, documented or not verified), the fix and the issue or forum threads; `explain --list` lists the 77 ids. `agents [--json]` is the inventory alone. Exit 0 clean, 1 findings, 2 usage; `--json` on every command.
- What the agents do is what the real binaries did, on Windows 11, and in CI on `windows-latest` with the newest release of each: Claude Code 2.1.302 and 2.1.299, Codex CLI 0.163.0, Gemini CLI 0.64.0 and GitHub Copilot CLI 1.0.98. Found on the way: Codex starts a PowerShell by its full path, the first `pwsh.exe` on PATH, else `C:\Program Files\PowerShell\7\pwsh.exe` when that file exists (a path written into Codex: on `windows-latest` it started PowerShell 7 with a PATH that did not list it), else the first `powershell.exe` on PATH, else the one in `System32`, and has no key to choose its shell (`windows.shell_path` is not a key); a Codex hook that exits with 2 does not block on Windows; Gemini CLI and Copilot CLI find their PowerShell by name on PATH, and Copilot CLI runs a `bash` field only with a working bash; a Copilot CLI hook of `.claude/settings.json` is run through PowerShell with `$CLAUDE_PROJECT_DIR` empty; Gemini CLI ends with a libuv assertion when it cannot start PowerShell, with Node 24 (with Node 22 it ended with exit code 0). The Cursor CLI launcher is read from disk and its hooks are documented, not run.
- The Claude Code part and the machine checks are claude-windows-doctor's (its 27 findings, under the ids `claude.<name>`), copied into this repository: `src/sys.mjs`, `src/winpath.mjs`, `src/gitbash.mjs`, `src/facts.mjs`, `src/wsl.mjs`, `src/userenv.mjs`, `src/winenv.mjs` (its reading part), `src/claude-shell.mjs`, `src/claude-settings.mjs` and `src/jsonfile.mjs`, and the table of 129 cases in `test/shell-table.mjs`, which is held to the prediction on a pretend machine; the real-binary checks here put one row for each claim the pages restate. The TOML reader `src/toml.mjs` is codex-config-doctor's.
- Zero tokens for the tool, no dependencies, no network code except the local connection of `check --live`, and nothing written except the throwaway folders of `check --live`.

[1.4.0]: https://github.com/nrzz/agent-windows-doctor/releases/tag/v1.4.0
[1.3.0]: https://github.com/nrzz/agent-windows-doctor/releases/tag/v1.3.0
[1.2.0]: https://github.com/nrzz/agent-windows-doctor/releases/tag/v1.2.0
[1.1.0]: https://github.com/nrzz/agent-windows-doctor/releases/tag/v1.1.0
[1.0.0]: https://github.com/nrzz/agent-windows-doctor/releases/tag/v1.0.0

[Unreleased]: https://github.com/nrzz/agent-windows-doctor/compare/v1.4.0...HEAD
