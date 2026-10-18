// The machine, as the checks see it: the platform, the environment, the files, the programs. Everything the checks read goes
// through one `sys` object, so that the tests can put a pretend machine in its place (test/machine.mjs): a Windows machine
// with a Git for Windows in a place of the test's choosing, on Linux and macOS too. This file and src/live.mjs are the only
// code that starts a program.
//
//   sys.platform, sys.arch, sys.release   process.platform, process.arch, os.release()
//   sys.env                               the environment of the process, a plain object
//   sys.getEnv(name)                      one variable (the name is matched in any case on Windows)
//   sys.cwd, sys.home, sys.tmpdir         the working folder, the home folder, the temporary folder
//   sys.exists(p), isFile(p), isDir(p)    what fs.existsSync / statSync say
//   sys.stat(p)                           { mtimeMs, size, isFile, isDir } or null
//   sys.nodeVersion, sys.nodePath         the Node that runs this tool
//   sys.readText(p)                       the text of a file, or null
//   sys.listDir(p)                        the names in a folder, or null
//   sys.run(cmd, args, options)           start a program and wait: { status, signal, stdout, stderr, error, timedOut }
//   sys.where(name, options)              Windows' where.exe: the lines it prints, [] for no match, null when it cannot run
//   sys.now()                             the clock, in ms
//
// The few programs that ship with Windows (reg, where, cmd, chcp, tasklist, setx, powershell, wsl) are started by their full path
// under %SystemRoot%: a bare name is looked for in the working folder first, and the folder a person stands in can hold anything.
// (programPath is claude-relocate's, from src/spawn.mjs there.)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const WINDOWS_PROGRAMS = {
  chcp: ["System32", "chcp.com"],
  cmd: ["System32", "cmd.exe"],
  reg: ["System32", "reg.exe"],
  tasklist: ["System32", "tasklist.exe"],
  setx: ["System32", "setx.exe"],
  where: ["System32", "where.exe"],
  wsl: ["System32", "wsl.exe"],
  powershell: ["System32", "WindowsPowerShell", "v1.0", "powershell.exe"],
};

/** The program to start for `cmd`: its full path for the programs above on Windows (named with or without .exe or .com, in any case), else `cmd` as it is. */
export function programPath(cmd, { platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  const parts = platform === "win32" ? WINDOWS_PROGRAMS[String(cmd).toLowerCase().replace(/\.(exe|com)$/, "")] : undefined;
  if (!parts) return cmd;
  const root = env.SystemRoot || env.SYSTEMROOT || env.windir || `C:${String.fromCharCode(92)}Windows`;
  const full = path.win32.join(root, ...parts);
  return exists(full) ? full : cmd;
}

/** One variable of an environment object; on Windows the name matches in any case. */
export function envGet(env, name, platform = process.platform) {
  if (!env) return undefined;
  if (Object.prototype.hasOwnProperty.call(env, name)) return env[name];
  if (platform !== "win32") return undefined;
  const lower = String(name).toLowerCase();
  for (const k of Object.keys(env)) if (k.toLowerCase() === lower) return env[k];
  return undefined;
}

export function makeSys(over = {}) {
  const platform = over.platform || process.platform;
  const env = over.env || { ...process.env };
  const sys = {
    platform,
    arch: process.arch,
    release: os.release(),
    osVersion: typeof os.version === "function" ? os.version() : "",
    env,
    getEnv: (name) => envGet(sys.env, name, sys.platform),
    cwd: over.cwd || process.cwd(),
    home: over.home || (platform === "win32" ? env.USERPROFILE || env.HOME : env.HOME) || os.homedir(),
    tmpdir: os.tmpdir(),
    exists: (p) => { try { return fs.existsSync(p); } catch { return false; } },
    isFile: (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } },
    isDir: (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
    stat: (p) => { try { const s = fs.statSync(p); return { mtimeMs: s.mtimeMs, size: s.size, isFile: s.isFile(), isDir: s.isDirectory() }; } catch { return null; } },
    nodeVersion: process.version,
    nodePath: process.execPath,
    readText: (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } },
    listDir: (p) => { try { return fs.readdirSync(p); } catch { return null; } },
    run: (cmd, args = [], { cwd, env: runEnv, input = "", timeout = 30000, binary = false, verbatim = false } = {}) => {
      const r = spawnSync(programPath(cmd, { platform: sys.platform, env: sys.env }), args, {
        cwd,
        env: runEnv || sys.env,
        input,
        encoding: binary ? "buffer" : "utf8",
        windowsHide: true,
        windowsVerbatimArguments: verbatim,
        timeout,
        maxBuffer: 16 * 1024 * 1024,
      });
      const empty = binary ? Buffer.alloc(0) : "";
      return { status: r.status, signal: r.signal || null, stdout: r.stdout || empty, stderr: r.stderr || empty, error: r.error || null, timedOut: Boolean(r.error && r.error.code === "ETIMEDOUT") };
    },
    now: () => Date.now(),
    ...over,
  };
  // where.exe looks in the working folder first, then in the PATH folders in order, and prints every match. Claude Code runs it
  // with its own working folder and environment, so this does too.
  if (!over.where) {
    sys.where = (name, { cwd, env: whereEnv } = {}) => {
      if (sys.platform !== "win32") return null;
      const there = cwd && sys.isDir(cwd) ? cwd : undefined;
      const r = sys.run("where.exe", [name], { cwd: there, env: whereEnv || sys.env, timeout: 15000 });
      if (r.error) return null;
      if (r.status !== 0) return [];
      return r.stdout.split(/\r?\n/).filter(Boolean);
    };
  }
  return sys;
}
