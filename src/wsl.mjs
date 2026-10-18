// WSL, from both sides. From Windows: the distributions (`wsl.exe -l -v`, which prints UTF-16, with or without a byte-order mark, and in the
// language of Windows) and the policy key wslInheritsWindowsSettings. From inside a distribution (/proc/version says Microsoft): which claude
// runs (a Windows binary reached through /mnt, or a Linux one) and whether the config folder or the project is on a Windows drive (/mnt/c,
// which is slow). Everything is read only.
import path from "node:path";
import { configDirOf } from "./claude-settings.mjs";

/** The text of wsl.exe's output: UTF-16 little endian (what it prints to a pipe), with or without a byte-order mark; plain text when it holds no NUL. */
export function decodeWsl(buf) {
  if (typeof buf === "string") return buf;
  if (!buf || !buf.length) return "";
  let b = Buffer.from(buf);
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString("utf16le").replace(/^﻿/, "");
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) { b = Buffer.from(b.subarray(2)); b.swap16(); return b.toString("utf16le"); }
  const zeros = [...b.subarray(0, Math.min(b.length, 64))].filter((x) => x === 0).length;
  return zeros >= 2 ? b.toString("utf16le").replace(/^﻿/, "") : b.toString("utf8");
}

// the distributions that a tool made for itself (Docker Desktop, Rancher Desktop, Podman), which nobody works in
const INTERNAL = /^(docker-desktop(-data)?|rancher-desktop(-data)?|podman-machine-default)$/i;

/** [{ name, isDefault, state, version, internal }] from the text of `wsl.exe -l -v`: a header line, then a line a distribution, the default marked with *. */
export function parseDistros(text) {
  const lines = String(text || "").replace(/\0/g, "").split(/\r?\n/).filter((l) => l.trim());
  const out = [];
  for (const line of lines.slice(1)) {
    const m = /^\s*(\*)?\s*(\S+)\s+(.+?)\s+([12])\s*$/.exec(line);
    if (m) out.push({ name: m[2], isDefault: Boolean(m[1]), state: m[3].trim(), version: Number(m[4]), internal: INTERNAL.test(m[2]) });
  }
  return out;
}

/** The distributions of this Windows machine: { available, distros, defaultName, workable, error }. Not installed, or no distribution, is available: false. */
export function windowsWslFacts(sys) {
  if (sys.platform !== "win32") return { available: false, distros: [], workable: [], defaultName: null, error: null };
  const r = sys.run("wsl.exe", ["-l", "-v"], { binary: true, timeout: 30000 });
  if (r.error) return { available: false, distros: [], workable: [], defaultName: null, error: r.error.code === "ENOENT" ? null : `wsl.exe could not run (${r.error.code || r.error.message})` };
  const text = decodeWsl(r.stdout);
  const distros = r.status === 0 ? parseDistros(text) : [];
  const workable = distros.filter((d) => !d.internal);
  const def = distros.find((d) => d.isDefault);
  return { available: distros.length > 0, distros, workable, defaultName: def ? def.name : null, error: null, outputStatus: r.status };
}

/** Inside a WSL distribution: { inside, version } (1 or 2), read from /proc/version. */
export function insideWsl(sys) {
  if (sys.platform !== "linux") return { inside: false, version: null };
  const v = sys.readText("/proc/version") || "";
  if (!/microsoft/i.test(v)) return { inside: false, version: null };
  return { inside: true, version: /WSL2|microsoft-standard/i.test(v) ? 2 : 1 };
}

/** A path on a Windows drive as WSL mounts it: /mnt/c/... */
export const onWindowsDrive = (p) => /^\/mnt\/[a-z](\/|$)/i.test(String(p || ""));

/** Where things are, seen from inside WSL: { configDir, configOnWindows, projectOnWindows }. */
export function wslLocations(sys, project) {
  const cfg = configDirOf(sys);
  const proj = project ? path.posix.resolve(project) : sys.cwd;
  return { configDir: cfg.dir, configSource: cfg.source, configOnWindows: onWindowsDrive(cfg.dir), project: proj, projectOnWindows: onWindowsDrive(proj) };
}
