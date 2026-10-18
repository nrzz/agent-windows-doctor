// Where is a Git Bash on this machine, whether or not Claude Code finds it? Used to say "Git for Windows is installed, but Claude
// Code does not look where it is", and by `fix --git-bash` to pick the file to point CLAUDE_CODE_GIT_BASH_PATH at. Reads only:
// the git.exe files on PATH, the place Git for Windows records its install in the registry (InstallPath, in HKLM and HKCU), and
// a short list of the folders Git for Windows, scoop and Chocolatey use.
import * as W from "./winpath.mjs";
import { readRegValue } from "./winenv.mjs";

const REG_KEYS = [
  ["HKLM", "HKLM\\SOFTWARE\\GitForWindows"],
  ["HKCU", "HKCU\\SOFTWARE\\GitForWindows"],
  ["HKLM (32-bit)", "HKLM\\SOFTWARE\\WOW6432Node\\GitForWindows"],
];

/**
 * Every bash.exe of a Git for Windows that exists: [{ path, via }] in the order found, each file once.
 * `via` says how it was found: "git.exe on PATH (<file>)", "the registry (<key>)", or "the folder <dir>".
 */
export function discoverGitBash(sys, { cwd } = {}) {
  const found = [];
  const seen = new Set();
  const add = (file, via) => {
    const k = W.key(file);
    if (seen.has(k) || !sys.isFile(file)) return;
    seen.add(k);
    found.push({ path: W.join(file), via });
  };
  // 1. every git.exe on PATH, and the bin\bash.exe one and two folders up from it
  for (const line of sys.where("git", { cwd, env: sys.env }) || []) {
    const dir = W.dirname(line);
    add(W.join(dir, "..", "bin", "bash.exe"), `git.exe on PATH (${line})`);
    add(W.join(dir, "..", "..", "bin", "bash.exe"), `git.exe on PATH (${line})`);
  }
  // 2. where Git for Windows says it was installed
  for (const [label, key] of REG_KEYS) {
    const r = readRegValue(sys, key, "InstallPath");
    if (r.ok && r.exists && r.value) add(W.join(r.value, "bin", "bash.exe"), `the registry (${label}: ${r.value})`);
  }
  // 3. the usual folders
  const pf = sys.getEnv("ProgramW6432") || sys.getEnv("ProgramFiles");
  const pfx86 = sys.getEnv("ProgramFiles(x86)");
  const local = sys.getEnv("LOCALAPPDATA");
  const folders = [];
  if (pf) folders.push(W.join(pf, "Git"));
  if (pfx86) folders.push(W.join(pfx86, "Git"));
  if (local) folders.push(W.join(local, "Programs", "Git"));
  if (sys.home) folders.push(W.join(sys.home, "scoop", "apps", "git", "current"));
  const choco = sys.getEnv("ChocolateyInstall");
  if (choco) folders.push(W.join(choco, "lib", "git", "tools"));
  folders.push("C:\\Git");
  for (const dir of folders) add(W.join(dir, "bin", "bash.exe"), `the folder ${dir}`);
  return found;
}
