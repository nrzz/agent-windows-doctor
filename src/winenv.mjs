// The Windows registry, as far as this tool needs it, and only to read: the values of HKCU\Environment (the user environment), the long-path
// switch, the update revision of Windows, the managed settings of Claude Code, and where Git for Windows says it is installed. Read with
// reg.exe; no other program is needed. Nothing here writes the registry: a test fails if this tool starts reg.exe with add or delete, or setx.
//
// Provenance: parseRegQuery and the reg.exe command line (UTF-8 through chcp 65001, whole path of each program, /s quoting for cmd.exe) are
// claude-relocate's src/winenv.mjs through claude-windows-doctor's, which this file is a read-only copy of (its writer, the `fix` and `undo`
// of that tool, is not here).
//
// The layer (`userEnv`) has the shape:
//   kind: "registry" | "file", key: the registry key or the file
//   list()   { ok, values: [{ name, type, value }], error }
//   read(name)   { ok, exists, type, value, error }
import { programPath } from "./sys.mjs";

export const REAL_KEY = "HKCU\\Environment";

// `reg query <key> /v <name>` prints
//
//   HKEY_CURRENT_USER\Environment
//       CLAUDE_CODE_GIT_BASH_PATH    REG_SZ    E:\Das\Git\bin\bash.exe
//
// -> { exists, type, value }.
export function parseRegQuery(text, name) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s+(\S.*?)\s{4}(REG_[A-Z_]+)(?:\s{4}(.*?))?\s*$/.exec(line) || /^\s+(\S+)\s+(REG_[A-Z_]+)(?:\s{2,}(.*?))?\s*$/.exec(line);
    if (m && m[1].toLowerCase() === String(name).toLowerCase()) return { exists: true, type: m[2], value: m[3] ?? "" };
  }
  return { exists: false, type: null, value: null };
}

/** Every value that `reg query <key>` lists: [{ name, type, value }] (the sub-keys it also lists are left out). */
export function parseRegValues(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (/^HKEY_/i.test(line.trim())) continue;
    const m = /^\s+(\S.*?)\s{4}(REG_[A-Z_]+)(?:\s{4}(.*?))?\s*$/.exec(line) || /^\s+(\S+)\s+(REG_[A-Z_]+)(?:\s{2,}(.*?))?\s*$/.exec(line);
    if (m) out.push({ name: m[1], type: m[2], value: m[3] ?? "" });
  }
  return out;
}

// reg prints in the console's code page, which turns é or 日本語 into other characters; a console set to UTF-8 (chcp 65001) prints
// them as they are. cmd.exe looks in the working folder first for the programs it is asked to run, so they are named by their
// full path, and /s takes off the first and the last quote of the line, so the whole line is in one more pair.
function regCommand(sys, args) {
  const opts = { platform: sys.platform, env: sys.env };
  const line = `"${programPath("chcp.com", opts)}" 65001>nul & "${programPath("reg.exe", opts)}" ${args}`;
  return sys.run("cmd.exe", ["/d", "/s", "/c", `"${line}"`], { verbatim: true, timeout: 30000 });
}

/** One value of a registry key: { ok, exists, type, value, error }. A key or a value that is not there is not an error. */
export function readRegValue(sys, key, name) {
  if (sys.platform !== "win32") return { ok: true, exists: false, type: null, value: null, error: null };
  const r = regCommand(sys, `query "${key}" /v "${name}"`);
  if (r.error) return { ok: false, exists: false, type: null, value: null, error: `reg.exe could not run (${r.error.message})` };
  // reg exits 1 both for "no such value" and for "no such key"
  if (r.status !== 0) return { ok: true, exists: false, type: null, value: null, error: null };
  return { ok: true, ...parseRegQuery(r.stdout, name), error: null };
}

/** The Windows registry's user environment (HKCU\Environment), read only. */
export function regUserEnv(sys) {
  return {
    kind: "registry",
    key: REAL_KEY,
    list() {
      if (sys.platform !== "win32") return { ok: true, values: [], error: null };
      const r = regCommand(sys, `query "${REAL_KEY}"`);
      if (r.error) return { ok: false, values: [], error: `reg.exe could not run (${r.error.message})` };
      if (r.status !== 0) return { ok: true, values: [], error: null };
      return { ok: true, values: parseRegValues(r.stdout), error: null };
    },
    read: (name) => readRegValue(sys, REAL_KEY, name),
  };
}

/**
 * A user environment kept in a JSON file { "NAME": { "type": "REG_SZ", "value": "..." } }, with the shape of the layer above. The tests use it
 * (AGENT_WINDOWS_DOCTOR_USER_ENV_FILE names it), so that no test reads the registry of the machine it runs on. Read only. Names match in any case.
 */
export function fileUserEnv(sys, file) {
  const load = () => {
    const text = sys.readText(file);
    if (text === null) return {};
    try { const j = JSON.parse(text.replace(/^﻿/, "")); return j && typeof j === "object" && !Array.isArray(j) ? j : {}; } catch { return {}; }
  };
  const find = (obj, name) => Object.keys(obj).find((k) => k.toLowerCase() === String(name).toLowerCase());
  return {
    kind: "file",
    key: file,
    list: () => ({ ok: true, values: Object.entries(load()).map(([name, v]) => ({ name, type: v.type || "REG_SZ", value: String(v.value ?? "") })), error: null }),
    read(name) {
      const obj = load();
      const k = find(obj, name);
      return k === undefined ? { ok: true, exists: false, type: null, value: null, error: null } : { ok: true, exists: true, type: obj[k].type || "REG_SZ", value: String(obj[k].value ?? ""), error: null };
    },
  };
}
