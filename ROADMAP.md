# Roadmap

What could come next. None of it is promised; all of it is open to contributors. Comment on an issue or start a [discussion](https://github.com/nrzz/agent-windows-doctor/discussions) before a large change.

- `explain --list <part>`: the ids that contain a part, with their titles, in page order (`--list codex.` as the one-agent view). This is the open good first issue: [#5](https://github.com/nrzz/agent-windows-doctor/issues/5).
- Windows 10 and ARM64: the real-binary checks were run on Windows 11 on x64 and on the `windows-latest` runner (Windows Server 2025, x64) only. A run of `agent-windows-doctor check --live` on Windows 10, or on a Windows on ARM machine, with what it printed, would show whether the PATH search, the registry reads and the shell of each agent behave the same there.
- Gemini CLI in Constrained Language Mode: the finding is documented from the issue (google-gemini/gemini-cli#12519), not put to the binary, because a process cannot be put in that mode from its environment (`__PSLockdownPolicy=4` changed nothing). A machine with an application control policy (WDAC or AppLocker) that sets the mode, and a run of Gemini CLI on it, would turn the note into a verified finding.
- The Cursor CLI: its launcher is read from disk and its hooks are documented, never run, because the CLI needs a login. If a way to start it without one exists, the shell it gives the model and the shell that runs a hook could be put to it the way the other four are.
- Microsoft Defender exclusions for the agent binaries: `codex doctor` warns about them for Codex; `Get-MpPreference` lists the exclusions, but only to an administrator, so the check would have to say "not read" for everyone else.
