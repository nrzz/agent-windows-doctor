// The machine, whatever agent runs on it: the version and build of Windows (and whether Codex's MXC sandbox can run on it), the PowerShell
// editions with their language mode and execution policy, the Git for Windows installations and every bash.exe on PATH (Git Bash, the WSL
// launcher), long paths, git's core.autocrlf, the console's code page, WSL, and Node and npm. Everything only reads.
import * as W from "./winpath.mjs";
import { readRegValue } from "./winenv.mjs";
import { codePageFacts, gitFacts, longPathFacts, nodeFacts } from "./facts.mjs";
import { windowsWslFacts } from "./wsl.mjs";
import { discoverGitBash } from "./gitbash.mjs";
import { powerShellFacts } from "./psprobe.mjs";

const NT_KEY = "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion";

// Codex's MXC sandbox needs Windows 11 24H2 build 26100.9278 or 25H2 build 26200.9278 (learn.chatgpt.com/docs/windows/windows-sandbox)
export const MXC_MINIMUM = [{ name: "Windows 11 24H2", build: 26100, ubr: 9278 }, { name: "Windows 11 25H2", build: 26200, ubr: 9278 }];
export const MXC_TEXT = MXC_MINIMUM.map((m) => `${m.build}.${m.ubr}`).join(" or ");

/** Windows: { ok, caption, release, build, ubr, display, arch, server }. */
export function windowsFacts(sys) {
  if (sys.platform !== "win32") return { ok: false, caption: sys.osVersion || sys.platform, release: sys.release, build: null, ubr: null, display: null, arch: sys.arch, server: false };
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(sys.release || ""));
  const ubr = readRegValue(sys, NT_KEY, "UBR");
  const display = readRegValue(sys, NT_KEY, "DisplayVersion");
  const n = ubr.ok && ubr.exists ? Number(String(ubr.value).trim()) : NaN;
  return {
    ok: true,
    caption: sys.osVersion || "Windows",
    release: sys.release,
    build: m ? Number(m[3]) : null,
    ubr: Number.isFinite(n) ? n : null,
    display: display.ok && display.exists ? String(display.value).trim() : null,
    arch: sys.arch,
    server: /server/i.test(String(sys.osVersion || "")),
  };
}

/** Can the MXC sandbox of Codex run here? { supported: true | false | null, why }. The documented builds are 26100.9278 and 26200.9278; a newer build is taken to have it. */
export function mxcSupport(win) {
  if (!win || win.build === null || win.build === undefined) return { supported: null, why: "the build of Windows was not read" };
  if (win.build < 26100) return { supported: false, why: `build ${win.build} is older than Windows 11 24H2 (build 26100)` };
  const exact = MXC_MINIMUM.find((m) => m.build === win.build);
  if (exact) {
    if (win.ubr === null) return { supported: null, why: `build ${win.build}: the update revision was not read, and ${exact.build}.${exact.ubr} is the minimum` };
    return win.ubr >= exact.ubr
      ? { supported: true, why: `build ${win.build}.${win.ubr} is at least ${exact.build}.${exact.ubr}` }
      : { supported: false, why: `build ${win.build}.${win.ubr} is older than ${exact.build}.${exact.ubr}` };
  }
  return { supported: true, why: `build ${win.build} is newer than the documented minimum builds (${MXC_TEXT})` };
}

/** What a bash.exe is: "git-bash" (it sits in a Git for Windows folder), "wsl-launcher" (System32's or the Store's, which starts the default WSL distribution), or "other". */
export function classifyBash(sys, file) {
  const k = W.key(file);
  if (/\\windows\\system32\\bash\.exe$/.test(k) || /\\windowsapps\\bash\.exe$/.test(k)) return "wsl-launcher";
  const dir = W.dirname(file);
  const roots = [W.join(dir, ".."), W.join(dir, "..", "..")];
  for (const root of roots) {
    if (sys.isFile(W.join(root, "cmd", "git.exe")) || sys.isFile(W.join(root, "git-cmd.exe")) || sys.isFile(W.join(root, "mingw64", "bin", "git.exe"))) return "git-bash";
  }
  return "other";
}

/** Every bash.exe on PATH, in the order a program looks: [{ path, kind }]. */
export function bashOnPath(sys, { cwd } = {}) {
  const lines = sys.where("bash.exe", { cwd, env: sys.env }) || [];
  return lines.filter((l) => sys.isFile(l)).map((path) => ({ path, kind: classifyBash(sys, path) }));
}

/** All of it. `probe: false` leaves the questions to PowerShell out. */
export function collectMachine(sys, { cwd, probe = true } = {}) {
  const win = windowsFacts(sys);
  return {
    windows: win,
    mxc: mxcSupport(win),
    powershell: powerShellFacts(sys, { cwd, probe }),
    gitInstalls: discoverGitBash(sys, { cwd }),
    git: gitFacts(sys, cwd),
    bash: bashOnPath(sys, { cwd }),
    longPaths: longPathFacts(sys),
    codePage: codePageFacts(sys),
    wsl: windowsWslFacts(sys),
    node: nodeFacts(sys),
  };
}
