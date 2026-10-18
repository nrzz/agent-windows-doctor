// Versions without running the program. A coding agent's binary is run only by `check --live` (or in a throwaway home by a test), because a run
// of the real binary can touch the real ~/.codex, ~/.copilot, ~/.gemini or ~/.claude. So `check` reads the version where the install leaves it:
//   * the package.json of an npm package (the .cmd shim of npm says which JavaScript file or program it starts; the package is the nearest
//     folder above that file with a package.json)
//   * the version resource of an .exe (what Explorer shows under Details), read with PowerShell's Get-Item, one call for all the files
//   * the name of a folder that holds one version: the desktop app's claude-code\<version>\<hash>, Cursor's versions\<version>
// Every answer says which of these it was (`from`), and a version that none of them gives is null: "not read".
import * as W from "./winpath.mjs";
import { readJsonFile, isObject } from "./jsonfile.mjs";

const VERSION_RE = /(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?)/;
export const versionIn = (text) => (VERSION_RE.exec(String(text || "")) || [])[1] || null;

/** Parses the numbers of a file version such as "2.1.299.0" -> "2.1.299" (the fourth number of a Windows file version is a build counter that the agents leave at 0). */
export function trimFileVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(v || "").trim());
  if (!m) return null;
  return m[4] && m[4] !== "0" ? `${m[1]}.${m[2]}.${m[3]}.${m[4]}` : `${m[1]}.${m[2]}.${m[3]}`;
}

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * The version resource of some files: [{ file, fileVersion, productVersion, productName }], in the order given, each field null when the file has
 * none. One PowerShell call; it only reads. On a system that is not Windows, or with no PowerShell, every field is null.
 */
export function readFileVersions(sys, files) {
  const list = [...files];
  const none = list.map((file) => ({ file, fileVersion: null, productVersion: null, productName: null }));
  if (sys.platform !== "win32" || !list.length) return none;
  const out = none.map((x) => ({ ...x }));
  const CHUNK = 40;
  for (let at = 0; at < list.length; at += CHUNK) {
    const chunk = list.slice(at, at + CHUNK);
    const script = `$ErrorActionPreference='SilentlyContinue'; $i=0; foreach ($f in @(${chunk.map(psQuote).join(",")})) { $v=(Get-Item -LiteralPath $f).VersionInfo; 'V|'+$i+'|'+$v.FileVersion+'|'+$v.ProductVersion+'|'+$v.ProductName; $i++ }`;
    const env = Object.fromEntries(Object.entries(sys.env).filter(([k]) => k.toLowerCase() !== "psmodulepath"));
    const r = sys.run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env, timeout: 60000 });
    if (r.error || r.status !== 0) continue;
    for (const line of String(r.stdout).split(/\r?\n/)) {
      const m = /^V\|(\d+)\|([^|]*)\|([^|]*)\|(.*)$/.exec(line);
      if (!m) continue;
      const x = out[at + Number(m[1])];
      if (x) { x.fileVersion = m[2].trim() || null; x.productVersion = m[3].trim() || null; x.productName = m[4].trim() || null; }
    }
  }
  return out;
}

/** The package.json at `dir` as { name, version, engines, bin, dependencies... } (only what is used), or null. */
export function readPackage(sys, dir, join = W.join) {
  const r = readJsonFile(sys, join(dir, "package.json"));
  if (!r.exists || r.error || !isObject(r.data)) return null;
  const d = r.data;
  return { dir, name: typeof d.name === "string" ? d.name : null, version: typeof d.version === "string" ? d.version : null, engines: isObject(d.engines) ? d.engines : {}, bin: d.bin ?? null, optionalDependencies: isObject(d.optionalDependencies) ? Object.keys(d.optionalDependencies) : [] };
}

/** The nearest folder at or above `start` that has a package.json (within `limit` levels): the package, as readPackage gives it, or null. `want` limits it to a package of that name. */
export function nearestPackage(sys, start, { want, limit = 8 } = {}) {
  let dir = start;
  for (let i = 0; i < limit; i++) {
    const p = readPackage(sys, dir);
    if (p && (!want || p.name === want)) return p;
    const up = W.dirname(dir);
    if (W.same(up, dir)) return null;
    dir = up;
  }
  return null;
}

/**
 * What an npm .cmd shim starts: its last line names the file, relative to the shim's own folder (%dp0%), as in
 *   "%_prog%"  "%dp0%\..\@openai\codex\bin\codex.js" %*          (a JavaScript file, run with node)
 *   "%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"   %*      (a program)
 * Returns { target, js } with the absolute path, or null for a file that is not such a shim.
 */
export function npmShimTarget(sys, shim) {
  const text = sys.readText(shim);
  if (text === null || !/%dp0%/i.test(text)) return null;
  const lines = text.split(/\r?\n/).filter((l) => /%\*\s*$/.test(l));
  const line = lines[lines.length - 1];
  if (!line) return null;
  const m = /"%dp0%[\\/]+([^"]+)"\s+%\*\s*$/i.exec(line);
  if (!m) return null;
  const target = W.join(W.dirname(shim), m[1]);
  return { target, js: /\.(c|m)?js$/i.test(target) };
}

/** The version in a folder name such as 2.1.299, or Cursor's 2026.06.16-20-30-07-a07d3ac (kept whole: it is a date and a commit), or null. */
export function versionFromFolder(name) {
  const n = String(name || "");
  const cursor = /^(\d{4}\.\d{1,2}\.\d{1,2}-[0-9a-z-]+)$/i.exec(n);
  if (cursor) return cursor[1];
  const m = /^v?(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?)$/.exec(n);
  return m ? m[1] : null;
}

/** Compares two versions as numbers: -1, 0 or 1. A missing version is lower than any. Cursor's date versions compare as their numbers. */
export function compareVersions(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Does `version` (a Node version such as 24.19.0) satisfy a ">=N" or ">=N.M.P" range, which is how the agents write `engines.node`? Other shapes give null (cannot tell). */
export function satisfiesNode(version, range) {
  const r = String(range || "").trim();
  const m = /^>=\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(r);
  if (!m) return null;
  return compareVersions(String(version).replace(/^v/, ""), `${m[1]}.${m[2] || 0}.${m[3] || 0}`) >= 0;
}
