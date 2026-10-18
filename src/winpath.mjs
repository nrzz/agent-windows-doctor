// Windows path handling that behaves the same on every system. The Windows logic of this tool (the Git Bash search, the
// PATH lookups) is tested on Linux and macOS too, with a pretend Windows machine, so it never uses the `path` of the system
// it runs on: only path.win32, and only on absolute paths (path.win32.resolve would borrow the current folder of the host).
import path from "node:path";

const W = path.win32;

export const basename = (p) => W.basename(String(p));
export const dirname = (p) => W.dirname(String(p));
export const join = (...parts) => W.join(...parts.map(String));
export const isAbsolute = (p) => W.isAbsolute(String(p));
export const extname = (p) => W.extname(String(p));

/** A path as a key for comparing: backslashes, no trailing separator, lower case (Windows file names ignore case). */
export const key = (p) => {
  const n = W.normalize(String(p));
  return (n.length > 3 ? n.replace(/[\\/]+$/, "") : n).toLowerCase();
};
export const same = (a, b) => key(a) === key(b);

/** Is `child` the folder `parent` or below it? */
export function isInside(child, parent) {
  const c = key(child);
  const p = key(parent);
  return c === p || c.startsWith(p.endsWith("\\") ? p : `${p}\\`);
}

export const toForward = (p) => String(p).replace(/\\/g, "/");
export const toBackslash = (p) => String(p).replace(/\//g, "\\");

/** The entries of a PATH-style list (separated by ;), with the quotes some entries carry taken off and empty entries dropped. */
export function splitList(value) {
  if (value === undefined || value === null) return [];
  const out = [];
  for (const raw of String(value).split(";")) {
    let e = raw.trim();
    if (e.length >= 2 && e.startsWith('"') && e.endsWith('"')) e = e.slice(1, -1);
    if (e) out.push(e);
  }
  return out;
}

/** The extensions of PATHEXT as lower case with the dot, in order; the Windows default when it is not set. */
export function pathExt(value) {
  const list = String(value === undefined || value === null || value === "" ? ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC" : value)
    .split(";").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.map((e) => (e.startsWith(".") ? e : `.${e}`));
}

/** The home folder of Windows as the environment names it. */
export const homeOf = (env) => env.USERPROFILE || env.HOME || "";
