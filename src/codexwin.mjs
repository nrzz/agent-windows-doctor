// Codex CLI on Windows: where its files are (CODEX_HOME, the system folder under ProgramData), the configuration layers that bear on the shell, the
// hooks and the Windows sandbox, and which Windows sandbox it selects. Put to Codex CLI 0.163.0 on Windows 11 (test/e2e-codex.test.mjs):
//   * windows.sandbox names the implementation (mxc, elevated or unelevated). features.prefer_mxc = true selects mxc when it is available (the log
//     says "MXC availability: true"). With nothing selected the log says "Windows sandbox selection: disabled", and sandbox_mode = "workspace-write"
//     becomes read-only (the header of `codex exec` says `sandbox: read-only`). The documentation says that with none selected Codex prefers
//     elevated; the binary logged "disabled".
//   * the log is CODEX_HOME\.sandbox\sandbox.<date>.log; its lines "MXC availability: true|false" and "Windows sandbox selection: ..." are what
//     Codex found. elevated needs an administrator for its setup: this tool never starts a command under it.
//   * windows.shell_path (proposed in openai/codex#16579) is not a key of 0.163.0: --strict-config says "unknown configuration field
//     `windows.shell_path`", and without it the key is ignored.
//   * a project's .codex folder applies only when the user config trusts the project (projects.<path>.trust_level = "trusted") — copied from
//     codex-config-doctor, which put it to the binary.
import * as W from "./winpath.mjs";
import { parseToml } from "./toml.mjs";
import { mxcSupport } from "./machine.mjs";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** The folder Codex keeps its files in: CODEX_HOME when it is not empty, else ~\.codex. */
export function codexHome(sys) {
  const set = sys.getEnv("CODEX_HOME");
  if (set !== undefined && set !== "") return { dir: W.isAbsolute(set) ? W.join(set) : W.join(sys.cwd, set), source: "CODEX_HOME", given: set };
  return { dir: W.join(sys.home, ".codex"), source: "default", given: null };
}

/** The folder of the system-wide files: config.toml, requirements.toml. */
export function codexSystemDir(sys) {
  const base = sys.getEnv("ProgramData") || sys.getEnv("ALLUSERSPROFILE") || "C:\\ProgramData";
  return W.join(base, "OpenAI", "Codex");
}

/** One TOML file read through sys: { path, exists, ok, value, error }. A file that is not UTF-8 text with valid TOML is not ok. */
export function readTomlFile(sys, file) {
  const text = sys.readText(file);
  if (text === null) return { path: file, exists: sys.exists(file), ok: false, value: null, error: sys.exists(file) ? { message: "cannot be read", line: 1, column: 1 } : null };
  const parsed = parseToml(text);
  if (!parsed.ok) return { path: file, exists: true, ok: false, value: null, error: parsed.error };
  return { path: file, exists: true, ok: true, value: parsed.value, error: null };
}

/** hooks.json, or any JSON file, read through sys: { path, exists, ok, value, error }. */
export function readJsonDoc(sys, file) {
  const text = sys.readText(file);
  if (text === null) return { path: file, exists: sys.exists(file), ok: false, value: null, error: sys.exists(file) ? { message: "cannot be read" } : null };
  try { return { path: file, exists: true, ok: true, value: JSON.parse(text.replace(/^﻿/, "")), error: null }; } catch (e) { return { path: file, exists: true, ok: false, value: null, error: { message: String(e.message).slice(0, 120) } }; }
}

/** Tables merge key by key; arrays and values are replaced (how Codex merges its layers). */
export function mergeTables(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) out[k] = isObject(v) && isObject(out[k]) ? mergeTables(out[k], v) : v;
  return out;
}

const trimTrust = (p) => W.key(String(p).replace(/^\\\\\?\\/, ""));

/** The nearest folder at or above `dir` that holds a .git (folder or file), or null. */
function gitRootOf(sys, dir) {
  let cur = dir;
  for (let i = 0; i < 64; i++) {
    if (sys.exists(W.join(cur, ".git"))) return cur;
    const up = W.dirname(cur);
    if (W.same(up, cur)) return null;
    cur = up;
  }
  return null;
}

/** Reads the layers that bear on the shell, the hooks and the Windows sandbox. */
export function readCodexLayers(sys, { project } = {}) {
  const dir = project || sys.cwd;
  const home = codexHome(sys);
  const system = codexSystemDir(sys);
  const layers = [];
  const add = (kind, label, file) => { const l = { kind, label, ...readTomlFile(sys, file) }; layers.push(l); return l; };
  const systemLayer = add("system", "system config.toml", W.join(system, "config.toml"));
  const userLayer = add("user", "user config.toml", W.join(home.dir, "config.toml"));
  const below = mergeTables(systemLayer.ok ? systemLayer.value : {}, userLayer.ok ? userLayer.value : {});
  const projects = isObject(below.projects) ? below.projects : {};
  const trustOf = (folder) => {
    const key = W.key(folder);
    for (const [k, v] of Object.entries(projects)) if (trimTrust(k) === key && isObject(v)) return { level: v.trust_level || null, entry: k };
    return { level: null, entry: null };
  };
  const gitRoot = gitRootOf(sys, dir);
  const rootTrust = gitRoot ? trustOf(gitRoot) : { level: null };
  // the folders from the Git root down to the project folder
  const chain = [];
  for (let cur = dir, i = 0; i < 64; i++) {
    chain.push(cur);
    if (gitRoot ? W.same(cur, gitRoot) : true) break;
    const up = W.dirname(cur);
    if (W.same(up, cur)) break;
    cur = up;
  }
  chain.reverse();
  const hooksJson = [];
  const jsonFor = (kind, label, file) => { const d = { kind, label, ...readJsonDoc(sys, file) }; hooksJson.push(d); return d; };
  jsonFor("user", "user hooks.json", W.join(home.dir, "hooks.json"));
  for (const folder of chain) {
    const own = trustOf(folder);
    const decision = own.level !== null ? { level: own.level, by: "this folder" } : rootTrust.level !== null ? { level: rootTrust.level, by: "the Git root" } : { level: null, by: null };
    const trusted = decision.level === "trusted";
    const file = W.join(folder, ".codex", "config.toml");
    const l = { kind: "project", label: `project ${folder}`, scope: folder, trusted, trust: decision, ...(trusted ? readTomlFile(sys, file) : { path: file, exists: sys.exists(file), ok: false, value: null, error: null, skipped: true }) };
    layers.push(l);
    const jf = W.join(folder, ".codex", "hooks.json");
    if (trusted) jsonFor("project", `project hooks.json (${folder})`, jf); else hooksJson.push({ kind: "project", label: `project hooks.json (${folder})`, path: jf, exists: sys.exists(jf), ok: false, value: null, error: null, skipped: true });
  }
  let merged = {};
  for (const l of layers) if (l.ok) merged = mergeTables(merged, l.value);
  const trust = trustOf(dir).level !== null ? trustOf(dir) : rootTrust;
  return { dir, home, system, layers, hooksJson, merged, trusted: trust.level === "trusted", trustLevel: trust.level || null };
}

/** The last "MXC availability" and "Windows sandbox selection" lines of the newest sandbox log of a Codex home, or null. */
export function readSandboxLog(sys, codexHomeDir) {
  const dir = W.join(codexHomeDir, ".sandbox");
  const names = (sys.listDir(dir) || []).filter((n) => /^sandbox\..*\.log$/.test(n)).sort();
  if (!names.length) return null;
  const file = W.join(dir, names[names.length - 1]);
  const text = sys.readText(file) || "";
  let mxc = null;
  let selection = null;
  let at = null;
  for (const line of text.split(/\r?\n/)) {
    let m = /^\[([^\]]*?)\s+\S+\]\s+MXC availability:\s*(true|false)/.exec(line);
    if (m) { mxc = m[2] === "true"; at = m[1]; }
    m = /^\[([^\]]*?)\s+\S+\]\s+Windows sandbox selection:\s*(\S+)/.exec(line);
    if (m) { selection = m[2]; at = m[1]; }
  }
  return { path: file, mxcAvailable: mxc, lastSelection: selection, at };
}

/**
 * Codex on Windows. `layers` is readCodexLayers; `machine` is collectMachine's answer; `userEnv` is a user environment layer (or null).
 * Returns { home, layers (summary), merged keys, sandbox, shellPath, wsl, trust, ... }.
 */
export function codexOnWindows(sys, { layers, machine, userEnv }) {
  const m = layers.merged;
  const windows = isObject(m.windows) ? m.windows : {};
  const features = isObject(m.features) ? m.features : {};
  const configured = typeof windows.sandbox === "string" ? windows.sandbox : null;
  const preferMxc = features.prefer_mxc === true;
  const log = readSandboxLog(sys, layers.home.dir);
  const mxc = machine ? machine.mxc : { supported: null, why: "" };
  const mxcAvailable = log && log.mxcAvailable !== null ? log.mxcAvailable : mxc.supported;
  const preferUnavailable = preferMxc && !configured && mxcAvailable === false;
  const selection = configured || (preferMxc && !preferUnavailable ? "mxc" : "none");
  const asked = typeof m.sandbox_mode === "string" ? m.sandbox_mode : null;
  const wanted = asked || (layers.trusted ? "workspace-write" : "read-only");
  const effective = selection === "none" && wanted === "workspace-write" ? "read-only" : wanted;
  const shellKeys = [];
  for (const l of layers.layers) {
    if (!l.ok || !isObject(l.value)) continue;
    if (isObject(l.value.windows) && Object.prototype.hasOwnProperty.call(l.value.windows, "shell_path")) shellKeys.push({ key: "windows.shell_path", value: l.value.windows.shell_path, layer: l.label, file: l.path });
  }
  // CODEX_HOME in the user environment or in this process, and a WSL to read it from (openai/codex#13762)
  let userHome = null;
  if (userEnv) { const r = userEnv.read("CODEX_HOME"); if (r.ok && r.exists) userHome = r.value; }
  const processHome = sys.getEnv("CODEX_HOME");
  return {
    home: layers.home,
    homeExists: sys.isDir(layers.home.dir),
    systemDir: layers.system,
    trusted: layers.trusted,
    trustLevel: layers.trustLevel,
    sandbox: {
      configured, preferMxc, selection,
      selectionHow: configured ? "windows.sandbox" : preferMxc ? (preferUnavailable ? "features.prefer_mxc, with no MXC to pick" : "features.prefer_mxc") : "nothing is set",
      preferUnavailable,
      mode: { asked, wanted, effective, downgraded: effective !== wanted },
      mxcAvailable, mxc, log,
    },
    shellKeys,
    wsl: { processHome: processHome || null, userHome, workable: machine ? machine.wsl.workable.length : 0 },
  };
}
