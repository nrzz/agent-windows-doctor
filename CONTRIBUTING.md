# Contributing to agent-windows-doctor

Thanks for helping. agent-windows-doctor is a CLI, part of the [Claude Code toolkit](https://github.com/nrzz/claude-code-toolkit) and of the tools for the other coding agents next to it. The bar for a change is the bar the code already meets: it is tested, it works on Windows, macOS and Linux (on the last two the tool says it has nothing to check, and its Windows logic runs against a pretend Windows machine), it changes nothing on the computer it runs on, and every claim it makes about an agent was put to the agent's binary or says that it was not.

## Start here

- **Good first issues:** [the issues labelled good first issue](https://github.com/nrzz/agent-windows-doctor/issues?q=is%3Aopen+label%3A%22good+first+issue%22), and the ideas in [ROADMAP.md](ROADMAP.md).
- **Questions and ideas:** [Discussions](https://github.com/nrzz/agent-windows-doctor/discussions).
- **Bugs:** [open an issue](https://github.com/nrzz/agent-windows-doctor/issues/new/choose) with the version of the agent (`claude --version`, `codex --version`, `gemini --version`, `copilot --version`), the Windows version (`winver`), `node --version`, `git --version`, and the exact command and output. For a wrong prediction of a shell, add the output of `agent-windows-doctor check --json` with anything private removed, and if you can run it, `agent-windows-doctor check --live`, which asks the real binary.

## Set up

There is nothing to install: the project has no dependencies.

```bash
git clone https://github.com/nrzz/agent-windows-doctor
cd agent-windows-doctor
npm test
```

- `node bin/agent-windows-doctor.mjs check --project <a project>` is the tool, `explain <id>` explains a finding, `agents` lists the binaries.
- `E2E_CLAUDE=<path> E2E_CODEX=<path> E2E_GEMINI=<path> E2E_COPILOT=<path> node --test --test-concurrency=1 test/e2e-claude.test.mjs test/e2e-codex.test.mjs test/e2e-gemini.test.mjs test/e2e-copilot.test.mjs test/e2e-live.test.mjs test/windows.test.mjs` puts the tool's claims to the real binaries (see below). Each file runs only for the agents whose variable is set, and most need Windows.
- Whenever you run the tool, the tests or an agent by hand, point `HOME`, `USERPROFILE`, `LOCALAPPDATA`, `APPDATA`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `COPILOT_HOME` and `GEMINI_CLI_HOME` at a temporary folder in the same command; the tests do it for themselves. Never test against your real `~/.claude`, `~/.codex`, `~/.copilot`, `~/.gemini` or `%LOCALAPPDATA%`.
- To run the tool without reading the registry, set `AGENT_WINDOWS_DOCTOR_USER_ENV_FILE` to a JSON file: the tool reads that file where it would read `HKCU\Environment`. The tests do this for themselves, the moment `test/helpers.mjs` loads.

## Where things are

| Path | What it holds |
| --- | --- |
| `bin/agent-windows-doctor.mjs` | the CLI entry |
| `src/cli.mjs` | the options, the help, the exit codes |
| `src/sys.mjs` | the machine as the checks see it (platform, environment, files, programs); the one place that starts a program for them |
| `src/winpath.mjs`, `src/jsonfile.mjs`, `src/toml.mjs` | Windows path rules that behave the same on every system; reading JSON the way the agents do; a TOML reader that keeps the line of every key |
| `src/claude-settings.mjs`, `src/claude-shell.mjs`, `src/gitbash.mjs` | the settings files of Claude Code that bear on the shell; which shell tools Claude Code gives the model and why; where a Git Bash is |
| `src/shells.mjs`, `src/codexwin.mjs`, `src/agentfacts.mjs` | the shell of Codex CLI, Gemini CLI, Copilot CLI and Cursor; Codex on Windows (its home, its layers, its sandbox); the Cursor launcher, node-pty, the Node each package asks for |
| `src/inventory.mjs`, `src/versions.mjs` | every binary, launcher and shim of each agent, which runs first; versions read without running the program |
| `src/hooks.mjs` | the hook files of each agent, what runs a hook, and whether a command is a bash line |
| `src/machine.mjs`, `src/psprobe.mjs`, `src/facts.mjs`, `src/userenv.mjs`, `src/wsl.mjs`, `src/winenv.mjs` | the Windows build, the PowerShell editions, long paths, `core.autocrlf`, the execution policy, the code page, the user environment against this process, WSL, the registry through `reg.exe` |
| `src/check.mjs`, `src/findings.mjs`, `src/explain.mjs`, `src/pages-claude.mjs`, `src/pages-others.mjs` | `check`; the findings and their ids; the pages of `explain` |
| `src/live.mjs`, `src/write.mjs` | `check --live`: the guard, the fake APIs on 127.0.0.1 and the real binaries (the only code that opens a connection); the throwaway folders (the only code that writes) |
| `src/report.mjs` | the text, markdown and JSON reports |
| `test/*.test.mjs` | unit tests; the `e2e-*.test.mjs` files and `windows.test.mjs` run against the real binaries and the real Windows when they can |
| `test/helpers.mjs`, `test/sandbox.mjs`, `test/agents.mjs` | the throwaway worlds and the guard of the tests; the guard that runs before any binary starts; the fake APIs and recipes for the four agents |
| `test/machine.mjs`, `test/win-machine.mjs`, `test/fake-agent.mjs` | a pretend machine, a clean pretend Windows machine that a test spoils in one way, and a stand-in for an agent's binary |
| `test/shell-table.mjs`, `test/table-lib.mjs`, `test/claude-claims.mjs` | the 129 cases of the Claude Code shell, how a case becomes a pretend machine or real files, and the rows the real-binary checks put to Claude Code |

## House rules

1. **No dependencies.** Node built-ins only, Node 18 or newer, ES modules (`.mjs`). A pull request that adds a package to `dependencies` will not be merged. Only `src/sys.mjs` and `src/live.mjs` may start a process, only `src/live.mjs` may open a connection, and only `src/write.mjs` may write a file; a test fails otherwise.
2. **Every change comes with a test**, and `npm test` passes. CI runs the suite on Windows, macOS and Linux with Node 20, 22 and 24, and on Linux with Node 18, and the real-binary checks on all three systems; a change that only works on one of them is not done. Windows logic is written with `path.win32` only, so that it runs on a pretend Windows machine on every system.
3. **The binary is right.** A line of an explain page marked verified says what an agent did when it was put to its binary. When one is wrong, add the case to the e2e file of that agent, run it against the binary, fix the code and the page, and say so in the README's "What was verified, and how". Do not change an expectation to make a test pass without running it against the binary. A claim that was not put to a binary is marked documented or not verified.
4. **Token cost is a feature.** The tool runs outside every agent and puts nothing in front of a model. If your change puts anything there, say how many tokens in the pull request and update the README's "What it costs in tokens".
5. **The computer is the user's.** The tool only reads. No test writes the real registry, the real Git configuration or the real execution policy, and none reads the real `~/.claude`, `~/.codex`, `~/.copilot`, `~/.gemini` or `%LOCALAPPDATA%`.
6. **Never start an agent outside the guard.** An agent binary is started only through `launch` in `test/sandbox.mjs` or through `src/live.mjs`, each of which checks the environment first: every home folder inside the throwaway folder, every proxy a closed port. A probe once wrote into a real `~/.codex` because `HOME` was set and `CODEX_HOME` was not; do not add a way to start a binary that skips the guard. Start it with `spawn` (not `spawnSync`, which blocks the fake server) and with standard input ignored.
7. **Nothing secret in the output.** The value of an environment variable is shown only when its name says it is a path or a switch; any other value is shown as "set". A new report needs a test that a secret in the environment is not in it.
8. **LF line endings.** Write every file with LF; a test fails if a tracked file has a carriage return. There is no `.gitattributes`.
9. **Keep the README honest.** Its "What was verified, and how" section says what was checked and what was not. If your change affects either, update it in the same pull request. `test/readme.test.mjs` holds its numbers to the runner.

## The real-binary checks

The `test/e2e-*.test.mjs` files start a fake API on 127.0.0.1 and run a real agent against it, with a throwaway home behind the guard. They put the claims of the README to it: which shell each agent starts and how it finds it, what runs a hook, what a hook that fails does, the Windows sandbox of Codex, and what `check --live` says. No model is reached and nothing leaves your machine.

```bash
E2E_CODEX=/path/to/codex node --test --test-concurrency=1 test/e2e-codex.test.mjs
```

A stand-in for PowerShell 7 is a copy of `powershell.exe` named `pwsh.exe`. The checks that are about Windows skip on other systems; `windows.test.mjs` reads the real registry, `wsl.exe`, PowerShell, `chcp`, git and the Microsoft Store (read only) on the Windows jobs of `npm test`, with or without a binary.

## Pull requests

- One logical change per pull request, with its test. Commit messages in the imperative mood ("Warn when the Git Bash variable holds quotes").
- Fill in the pull request template; CI must be green on every job.
- Signed commits are welcome but not required.
- Plain, specific writing in docs, messages and comments.

## Releases (maintainers)

Bump the version in `src/version.mjs` and `package.json` (`npm test` fails until every copy agrees), add a section to [CHANGELOG.md](CHANGELOG.md), tag `vX.Y.Z` and publish a GitHub release with the changelog section as its notes.

## Conduct and security

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately, as [SECURITY.md](SECURITY.md) describes, never in a public issue.
