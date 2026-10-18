// The shell each agent gives the model on Windows, and how it chose. Claude Code's is claude-windows-doctor's prediction (src/claude-shell.mjs, 129
// cases put to the binary there). The others, put to the real binaries on Windows 11 (Codex CLI 0.163.0, Gemini CLI 0.64.0, GitHub Copilot CLI
// 1.0.98; test/e2e-codex.test.mjs, test/e2e-gemini.test.mjs and test/e2e-copilot.test.mjs):
//   * Codex CLI starts the first pwsh.exe on PATH, by its full path, and else Windows PowerShell 5.1 by its full path under %SystemRoot%: with a
//     pwsh.exe only in %ProgramFiles%\PowerShell\7 (not on PATH) it ran powershell.exe, and with the PowerShell folder off PATH it still found
//     powershell.exe. It has no key to choose the shell: windows.shell_path (proposed in #16579) is "unknown configuration field" under
//     --strict-config and is ignored otherwise; the command ran in PowerShell all the same.
//   * Gemini CLI starts pwsh.exe when PATH has one, else powershell.exe, both by their bare names: PATH decides, and with neither on PATH the
//     tool answers {"error":"spawn powershell.exe ENOENT"}. A pwsh.exe only in %ProgramFiles% was not used.
//   * GitHub Copilot CLI tries "pwsh.exe" and then "powershell.exe", by their bare names. Its README says PowerShell 6 or newer, and on 1.0.98 the
//     powershell tool ran in Windows PowerShell 5.1 when there was no pwsh.exe. With neither on PATH the tool answers "PowerShell is not available.
//     Tried "pwsh.exe", "powershell.exe"."
//   * Cursor: its launcher starts Windows PowerShell 5.1 (read from the files on disk, never run); what shell the agent gives the model is not
//     stated in the documentation.
import * as W from "./winpath.mjs";

const win51 = (machine) => (machine.powershell.editions.find((e) => e.id === "5.1") || {}).path || null;
const pwshOnPath = (machine) => (machine.powershell.pwshOnPath || [])[0] || null;
const ps51OnPath = (machine) => machine.powershell.editions.some((e) => e.id === "5.1" && e.onPath);

const edition = (path) => (path && W.basename(path).toLowerCase() === "pwsh.exe" ? "PowerShell 7+ (pwsh)" : "Windows PowerShell 5.1 (powershell.exe)");

/**
 * The shell of one agent other than Claude Code.
 *   machine   collectMachine's answer
 * Returns { agent, tool, state: "ok" | "missing" | "unknown", shell: { label, path, edition, core } | null, args, how: [lines], basis, note }.
 */
export function shellFor(agent, { machine, cursor } = {}) {
  const pwsh = pwshOnPath(machine);
  const w51 = win51(machine);
  if (agent === "codex") {
    const path = pwsh || w51;
    return {
      agent, tool: "exec_command", state: path ? "ok" : "missing",
      shell: path ? { label: edition(path), path, core: Boolean(pwsh) } : null,
      args: "-Command",
      how: [
        pwsh ? `the first pwsh.exe on PATH, by its full path` : `no pwsh.exe on PATH, so Windows PowerShell 5.1 by its full path under %SystemRoot% (PATH is not used for it)`,
        "a pwsh.exe that is only in %ProgramFiles%\\PowerShell\\7, off PATH, is not used",
        "there is no key to choose the shell: windows.shell_path is not a key of Codex CLI 0.163.0",
      ],
      basis: "verified",
    };
  }
  if (agent === "gemini") {
    const path = pwsh || (ps51OnPath(machine) ? w51 : null);
    return {
      agent, tool: "run_shell_command", state: path ? "ok" : "missing",
      shell: path ? { label: edition(path), path, core: Boolean(pwsh) } : null,
      args: pwsh ? "-NoProfile -Command" : "-NoProfile -NonInteractive -Command",
      how: [
        pwsh ? "pwsh.exe, found on PATH by its bare name" : "no pwsh.exe on PATH, so powershell.exe, found on PATH by its bare name",
        "a pwsh.exe that is only in %ProgramFiles%\\PowerShell\\7, off PATH, is not used",
        path ? "the PowerShell folder of Windows is on PATH" : "with neither pwsh.exe nor powershell.exe on PATH the tool answers spawn powershell.exe ENOENT",
      ],
      basis: "verified",
    };
  }
  if (agent === "copilot") {
    const path = pwsh || (ps51OnPath(machine) ? w51 : null);
    return {
      agent, tool: "powershell", state: path ? "ok" : "missing",
      shell: path ? { label: edition(path), path, core: Boolean(pwsh) } : null,
      args: "-NoProfile -NoLogo -NonInteractive -Command",
      how: [
        pwsh ? "\"pwsh.exe\", the first name it tries, found on PATH" : "no pwsh.exe on PATH, so \"powershell.exe\", the second name it tries, found on PATH: Windows PowerShell 5.1 ran the tool, although the README of Copilot CLI asks for PowerShell 6 or newer",
        "a pwsh.exe that is only in %ProgramFiles%\\PowerShell\\7, off PATH, is not used",
        path ? "the tool is listed to the model in every case; it answers with an error when neither name is on PATH" : "with neither name on PATH the tool answers: PowerShell is not available. Tried \"pwsh.exe\", \"powershell.exe\".",
      ],
      basis: "verified",
    };
  }
  if (agent === "cursor") {
    const launcher = cursor && cursor.launcher;
    return {
      agent, tool: null, state: "unknown", shell: launcher && launcher.powershell ? { label: "Windows PowerShell 5.1 (powershell.exe)", path: launcher.powershell, core: false } : null,
      args: launcher && launcher.args ? launcher.args : null,
      how: [
        launcher ? `the launcher starts Windows PowerShell 5.1 by its full path under %SystemRoot%${launcher.args ? ` (${launcher.args})` : ""}: it is hardcoded, so installing PowerShell 7 does not change it` : "no Cursor CLI launcher was found on this machine",
        "which shell the agent gives the model is not stated in Cursor's documentation, and was not run here",
      ],
      basis: launcher ? "documented" : "not verified",
    };
  }
  return null;
}
