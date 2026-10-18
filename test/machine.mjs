// A pretend machine for the tests: the `sys` object of src/sys.mjs, built from a description, so that the Windows logic (the Git Bash
// search, the PATH lookups, the registry reads) runs on Linux and macOS too. Nothing here touches the disk or the registry.
//
//   platform     "win32" (default), "linux", "darwin"
//   env          the environment; PATH is a ;-separated string on Windows
//   cwd, home    the working folder and the home folder
//   files        the files that exist (paths as the system writes them; Windows names match in any case)
//   dirs         folders that exist although no file is in them
//   texts        { path: text }: files with content (they exist too)
//   registry     { "HKCU\\Environment": { NAME: ["REG_SZ", "value"] } }: what reg query finds; reg add and reg delete change it
//   versions     { "C:\\path\\claude.exe": "2.1.299 (Claude Code)" }: what `--version` prints for a claude
//   commands     { git: (args, opts) => result, powershell: ..., wsl: ..., tasklist: ..., chcp: ..., node: ..., npm: ... }: other programs,
//                by name without .exe; a function returns { status, stdout, stderr } (stdout may be a Buffer for wsl)
//   where        (name, { cwd, env }) => lines | null: replaces the PATH walk of where.exe
//   mtimes       { path: ms }: the modification times that stat reports (default: an hour before the pretend clock)
//   nodeVersion, nodePath   what sys.nodeVersion and sys.nodePath say
//   runs         a log: every program started, as { cmd, args, opts }
import { envGet } from "../src/sys.mjs";
import * as W from "../src/winpath.mjs";

const HIVES = { HKCU: "HKEY_CURRENT_USER", HKLM: "HKEY_LOCAL_MACHINE" };

export function fakeMachine(d = {}) {
  const platform = d.platform || "win32";
  const win = platform === "win32";
  const norm = (p) => (win ? W.key(p) : String(p));
  const parentOf = (p) => (win ? W.dirname(p) : String(p).replace(/\/[^/]*$/, "") || "/");
  const fileMap = new Map();
  const dirMap = new Map();
  const texts = new Map();
  const addDirs = (p) => {
    let cur = parentOf(p);
    for (let i = 0; i < 40; i++) {
      const k = norm(cur);
      if (dirMap.has(k)) break;
      dirMap.set(k, cur);
      const up = parentOf(cur);
      if (norm(up) === k) break;
      cur = up;
    }
  };
  for (const f of d.files || []) { fileMap.set(norm(f), f); addDirs(f); }
  for (const f of Object.keys(d.texts || {})) { fileMap.set(norm(f), f); texts.set(norm(f), d.texts[f]); addDirs(f); }
  for (const dir of d.dirs || []) { dirMap.set(norm(dir), dir); addDirs(dir); }
  const registry = new Map();
  for (const [key, values] of Object.entries(d.registry || {})) registry.set(key.toLowerCase(), new Map(Object.entries(values).map(([n, v]) => [n.toLowerCase(), { name: n, type: v[0], value: v[1] }])));
  const runs = d.runs || [];
  const versions = new Map(Object.entries(d.versions || {}).map(([p, v]) => [norm(p), v]));
  const env = { ...(d.env || {}) };

  const regKeyText = (key) => key.replace(/^(HKCU|HKLM)/i, (m) => HIVES[m.toUpperCase()]);
  const reg = (key) => registry.get(key.toLowerCase());
  const regQuery = (key, name) => {
    const k = reg(key);
    if (!k) return { status: 1, stdout: "", stderr: "ERROR: The system was unable to find the specified registry key or value.\r\n" };
    const rows = name ? [k.get(name.toLowerCase())].filter(Boolean) : [...k.values()];
    if (name && !rows.length) return { status: 1, stdout: "", stderr: "ERROR: The system was unable to find the specified registry key or value.\r\n" };
    return { status: 0, stdout: `\r\n${regKeyText(key)}\r\n${rows.map((r) => `    ${r.name}    ${r.type}    ${r.value}\r\n`).join("")}\r\n`, stderr: "" };
  };

  const sys = {
    platform,
    arch: "x64",
    release: d.release || "10.0.26300",
    osVersion: d.osVersion || "Windows 11 Pro",
    env,
    getEnv: (name) => envGet(env, name, platform),
    cwd: d.cwd || (win ? "C:\\work\\proj" : "/work/proj"),
    home: d.home || (win ? "C:\\Users\\me" : "/home/me"),
    tmpdir: win ? "C:\\Temp" : "/tmp",
    exists: (p) => fileMap.has(norm(p)) || dirMap.has(norm(p)),
    isFile: (p) => fileMap.has(norm(p)),
    isDir: (p) => dirMap.has(norm(p)),
    stat: (p) => {
      const k = norm(p);
      const mtimeMs = d.mtimes && d.mtimes[p] !== undefined ? d.mtimes[p] : Date.parse("2026-10-16T11:00:00.000Z");
      if (fileMap.has(k)) return { mtimeMs, size: texts.has(k) ? texts.get(k).length : 0, isFile: true, isDir: false };
      if (dirMap.has(k)) return { mtimeMs, size: 0, isFile: false, isDir: true };
      return null;
    },
    nodeVersion: d.nodeVersion || "v24.19.0",
    nodePath: d.nodePath || (win ? "C:\\Program Files\\nodejs\\node.exe" : "/usr/bin/node"),
    readText: (p) => (texts.has(norm(p)) ? texts.get(norm(p)) : null),
    listDir: (p) => {
      const k = norm(p);
      if (!dirMap.has(k)) return null;
      const names = new Set();
      for (const [key, shown] of [...fileMap, ...dirMap]) if (norm(parentOf(shown)) === k && key !== k) names.add(win ? W.basename(shown) : String(shown).split("/").pop());
      return [...names];
    },
    now: () => d.now || Date.parse("2026-10-16T12:00:00.000Z"),
    runs,
    registry,
    run(cmd, args = [], opts = {}) {
      runs.push({ cmd: String(cmd), args: args.map(String), opts });
      const name = String(cmd).replace(/^.*[\\/]/, "").toLowerCase().replace(/\.(exe|com)$/, "");
      // a claude: --version
      if (versions.has(norm(cmd)) && args[0] === "--version") return { status: 0, signal: null, stdout: `${versions.get(norm(cmd))}\n`, stderr: "", error: null, timedOut: false };
      if (name === "reg") {
        if (args[0] === "add") {
          const key = args[1].toLowerCase();
          if (!registry.has(key)) registry.set(key, new Map());
          const type = args[args.indexOf("/t") + 1];
          const value = args[args.indexOf("/d") + 1];
          const vn = args[args.indexOf("/v") + 1];
          registry.get(key).set(vn.toLowerCase(), { name: vn, type, value });
          return ok("");
        }
        if (args[0] === "delete") {
          const k = registry.get(args[1].toLowerCase());
          const vn = args[args.indexOf("/v") + 1];
          if (k && k.delete(vn.toLowerCase())) return ok("");
          return { status: 1, signal: null, stdout: "", stderr: "ERROR: The system was unable to find the specified registry key or value.\r\n", error: null, timedOut: false };
        }
      }
      if (name === "cmd") {
        const line = String(args[args.length - 1] || "");
        // chcp ... & reg.exe query "KEY" [/v "NAME"]
        const q = /reg(?:\.exe)?"?\s+query\s+"([^"]+)"(?:\s+\/v\s+"([^"]+)")?/i.exec(line);
        if (q) { const r = regQuery(q[1], q[2]); return { ...r, signal: null, error: null, timedOut: false }; }
        // "<shim or exe>" --version
        const v = /^"?([^"]+?)"?\s+--version\s*"?$/i.exec(line.replace(/^"|"$/g, ""));
        if (v && versions.has(norm(v[1]))) return ok(`${versions.get(norm(v[1]))}\n`);
        const inner = d.commands && d.commands.cmd;
        if (inner) return wrap(inner(args, opts));
      }
      const handler = d.commands && d.commands[name];
      if (handler) return wrap(handler(args, opts));
      const error = Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: "ENOENT" });
      return { status: null, signal: null, stdout: "", stderr: "", error, timedOut: false };
    },
    where(name, { cwd, env: whereEnv } = {}) {
      if (d.where) return d.where(name, { cwd, env: whereEnv });
      if (!win) return null;
      const e = whereEnv || env;
      const dirs = [cwd || sys.cwd, ...W.splitList(envGet(e, "PATH", platform))];
      const exts = W.pathExt(envGet(e, "PATHEXT", platform));
      const lines = [];
      // where.exe matches a name that already has an extension as it is, and a name without one with each extension of PATHEXT
      const candidates = W.extname(name) ? [name] : exts.map((ext) => `${name}${ext}`);
      for (const dir of dirs) {
        for (const c of candidates) {
          const f = W.join(dir, c);
          if (fileMap.has(norm(f))) lines.push(fileMap.get(norm(f)));
        }
      }
      return lines;
    },
  };
  function ok(stdout) { return { status: 0, signal: null, stdout, stderr: "", error: null, timedOut: false }; }
  function wrap(r) { return { status: 0, signal: null, stdout: "", stderr: "", error: null, timedOut: false, ...r }; }
  return sys;
}

/** A Windows machine with a Git for Windows in the folder `root` (cmd\git.exe, mingw64\bin\git.exe, bin\bash.exe, usr\bin\bash.exe), PATH as given. */
export function gitFiles(root) {
  return [`${root}\\cmd\\git.exe`, `${root}\\mingw64\\bin\\git.exe`, `${root}\\bin\\bash.exe`, `${root}\\bin\\git.exe`, `${root}\\bin\\sh.exe`, `${root}\\usr\\bin\\bash.exe`];
}

export const SYSTEM_PATH = "C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\Wbem";
export const SYSTEM_FILES = [
  "C:\\Windows\\System32\\bash.exe",
  "C:\\Windows\\System32\\where.exe",
  "C:\\Windows\\System32\\reg.exe",
  "C:\\Windows\\System32\\cmd.exe",
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
];
