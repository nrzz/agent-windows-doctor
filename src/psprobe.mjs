// The PowerShell editions of a Windows machine, and what each says about itself: Windows PowerShell 5.1 (always at System32), PowerShell 7 (`pwsh.exe`
// on PATH, or where its installer puts it), the language mode (Constrained Language Mode, which Gemini CLI cannot run commands in, #12519) and the
// execution policy per scope (which blocks a .ps1 hook of Copilot CLI or Cursor). Each edition is asked once, with -NoProfile -NonInteractive, and
// only reads. Never throws: what cannot be read is { ok: false, error }.
import * as W from "./winpath.mjs";
import { BLOCKING, parseExecutionPolicy } from "./facts.mjs";

export { BLOCKING };

// One script for both editions. In Constrained Language Mode a method call on a type that is not allowed fails, so only properties and ToString are used.
const PROBE = "$ErrorActionPreference='Stop'; 'ED='+$PSVersionTable.PSEdition; 'VER='+$PSVersionTable.PSVersion.ToString(); 'LANG='+$ExecutionContext.SessionState.LanguageMode; 'EFF='+(Get-ExecutionPolicy).ToString(); Get-ExecutionPolicy -List | ForEach-Object { 'POL='+$_.Scope.ToString()+'='+$_.ExecutionPolicy.ToString() }";

/** { edition, version, languageMode, effective, list } from the lines the probe script prints, or null. */
export function parseProbe(text) {
  const t = String(text || "");
  const get = (k) => { const m = new RegExp(`^${k}=(.*)$`, "m").exec(t); return m ? m[1].trim() : null; };
  const ed = get("ED");
  const ver = get("VER");
  if (!ed && !ver) return null;
  const list = parseExecutionPolicy(t.split(/\r?\n/).map((l) => l.replace(/^POL=/, "")).join("\n"));
  return { edition: ed, version: ver, languageMode: get("LANG"), effective: get("EFF"), list };
}

/** Asks one PowerShell about itself: { ok, exe, edition, version, languageMode, effective, list, error }. */
export function probePowerShell(sys, exe) {
  // a PowerShell started from another one (this tool run from pwsh 7, as on a CI runner) inherits the other's PSModulePath, and Windows PowerShell 5.1
  // then loads the modules of PowerShell 7 and fails; with no PSModulePath each PowerShell works out its own
  const env = Object.fromEntries(Object.entries(sys.env).filter(([k]) => k.toLowerCase() !== "psmodulepath"));
  const r = sys.run(exe, ["-NoProfile", "-NonInteractive", "-Command", PROBE], { env, timeout: 60000 });
  if (r.error || r.status !== 0) {
    const said = String(r.stderr || r.stdout || "").trim().split(/\r?\n/).find((l) => l.trim());
    return { ok: false, exe, error: r.error ? `${exe} could not run (${r.error.code || r.error.message})` : `${exe} exited ${r.status}${said ? `: ${said.trim().slice(0, 160)}` : ""}` };
  }
  const p = parseProbe(r.stdout);
  if (!p) return { ok: false, exe, error: "it printed no answer" };
  return { ok: true, exe, ...p, error: null };
}

const firstExisting = (sys, lines) => (lines || []).filter((l) => sys.isFile(l));

// The two paths that Codex CLI 0.163.0 has written into its program as the places to look for PowerShell when PATH has none (strings in codex.exe; put to the
// binary by test/e2e-codex.test.mjs: on a runner that has the first one, Codex started it with a PATH that did not list it)
export const CODEX_FIXED = { pwsh: "C:\\Program Files\\PowerShell\\7\\pwsh.exe", powershell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" };

/**
 * The PowerShell editions of this machine.
 * Returns { editions: [{ id: "5.1" | "7", label, path, how, onPath, probe }], windows, pwshOnPath: [paths], powershellOnPath: [paths], fixed: { pwsh, powershell } }:
 *   Windows PowerShell 5.1 at %SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe
 *   PowerShell 7: every pwsh.exe that where.exe lists, and the places its installers use (%ProgramFiles%\PowerShell\7, the Store alias, .dotnet\tools)
 * Each edition that is found is asked once (the first pwsh.exe on PATH is the one a program that looks for `pwsh` runs).
 */
export function powerShellFacts(sys, { probe = true } = {}) {
  const root = sys.getEnv("SystemRoot") || sys.getEnv("windir") || "C:\\Windows";
  const editions = [];
  const win51 = W.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  // where.exe looks in the working folder first; Codex CLI, Gemini CLI and Copilot CLI do not (a pwsh.exe in the project folder was not started by any of them), so PATH is
  // asked from a folder that holds no PowerShell
  const neutral = W.join(root, "System32");
  const pwshLines = sys.platform === "win32" ? firstExisting(sys, sys.where("pwsh", { cwd: neutral, env: sys.env })) : [];
  const psLines = sys.platform === "win32" ? firstExisting(sys, sys.where("powershell", { cwd: neutral, env: sys.env })) : [];
  if (sys.isFile(win51)) editions.push({ id: "5.1", label: "Windows PowerShell 5.1", path: win51, how: "System32", onPath: psLines.some((l) => W.same(l, win51)), pathIndex: psLines.findIndex((l) => W.same(l, win51)) });
  const seen = new Set();
  const add = (p, how, onPath) => {
    const k = W.key(p);
    if (seen.has(k) || !sys.isFile(p)) return;
    seen.add(k);
    editions.push({ id: "7", label: "PowerShell 7", path: W.join(p), how, onPath });
  };
  for (const l of pwshLines) add(l, "pwsh.exe on PATH", true);
  const pf = [sys.getEnv("ProgramW6432"), sys.getEnv("ProgramFiles")].filter(Boolean);
  for (const p of pf) { add(W.join(p, "PowerShell", "7", "pwsh.exe"), "the folder of the PowerShell 7 installer", false); add(W.join(p, "PowerShell", "7-preview", "pwsh.exe"), "the folder of the PowerShell 7 preview", false); }
  const local = sys.getEnv("LOCALAPPDATA");
  if (local) add(W.join(local, "Microsoft", "WindowsApps", "pwsh.exe"), "a Microsoft Store app alias", false);
  if (sys.home) add(W.join(sys.home, ".dotnet", "tools", "pwsh.exe"), "the .NET global tools folder", false);
  if (probe) {
    const asked = new Set();
    for (const e of editions) {
      // 5.1, and the first PowerShell 7 (the one on PATH if there is one): the others are the same program in another place
      const first7 = editions.find((x) => x.id === "7");
      if (e.id === "7" && e !== first7) continue;
      if (asked.has(e.id)) continue;
      asked.add(e.id);
      e.probe = probePowerShell(sys, e.path);
    }
  }
  const fixed = { pwsh: sys.platform === "win32" && sys.isFile(CODEX_FIXED.pwsh) ? CODEX_FIXED.pwsh : null, powershell: sys.platform === "win32" && sys.isFile(CODEX_FIXED.powershell) ? CODEX_FIXED.powershell : null };
  return { editions, pwshOnPath: pwshLines, powershellOnPath: psLines, fixed };
}

/** The execution policy a PowerShell started with no -ExecutionPolicy has: the probe's own answer. */
export const effectivePolicyOf = (edition) => (edition && edition.probe && edition.probe.ok ? edition.probe.effective : null);
