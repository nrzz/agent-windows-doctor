// The CLAUDE_* and ANTHROPIC_* variables of the Windows user environment (HKCU\Environment) against the environment of this process.
// A program reads the user environment once, when it starts: a variable set (with setx, or in System Properties, or by `fix`) after a
// terminal, the desktop app or an editor started is not in that program, which is the finding of claude-relocate that a CLAUDE_CONFIG_DIR
// set in the user environment is not seen by an app that was started earlier.
//
// What is printed: the value of a variable that is a path (its name ends in DIR, PATH, HOME, FILE or ROOT) or a switch (0, 1, true,
// false, yes, no, on, off); for any other variable only that it is set. A token in ANTHROPIC_API_KEY is "set", never its value.

const NAME = /^(CLAUDE|ANTHROPIC)/i;
// variables that Claude Code sets itself for the programs it starts: they are in a process under Claude Code and are nobody's configuration
const OWN = /^(CLAUDECODE|CLAUDE_CODE_(ENTRYPOINT|SSE_PORT|SESSION\w*|EXECPATH|REMOTE\w*|MESSAGING_\w+)|CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_\w+|CLAUDE_ENV_FILE|CLAUDE_AGENT_SDK_\w+|CLAUDE_SKILL_DIR)$/i;
// the variables that this tool tells a person to set once, for every program: a copy only in a process is worth a note
export const CONFIG_NAMES = ["CLAUDE_CONFIG_DIR", "CLAUDE_CODE_GIT_BASH_PATH", "CLAUDE_CODE_USE_POWERSHELL_TOOL"];

const isPathName = (name) => /(DIR|PATH|HOME|FILE|ROOT)$/i.test(name);
const isSwitchValue = (v) => /^(0|1|true|false|yes|no|on|off)$/i.test(String(v).trim());

/** May the value be printed? */
export const showsValue = (name, value) => isPathName(name) || isSwitchValue(value);

/** A REG_EXPAND_SZ value as a program sees it: each %NAME% replaced by the variable of that name, when there is one. */
export function expandPercent(value, env) {
  const get = (n) => { const lower = n.toLowerCase(); for (const k of Object.keys(env)) if (k.toLowerCase() === lower) return env[k]; return undefined; };
  return String(value).replace(/%([^%]+)%/g, (m, n) => (get(n) !== undefined ? get(n) : m));
}

/**
 * Compares the two. Returns { ok, layer, error, entries, own } with an entry for each name:
 *   { name, status: "same" | "differs" | "user-only" | "process-only", user, process } where user and process are null when the variable is
 *   not set there, else { type?, value } with the value present only when it may be printed (shown) and `set: true` otherwise.
 * `own` is the number of process-only variables that Claude Code sets itself, which are left out of the entries (so are the variables of this tool itself, AGENT_WINDOWS_DOCTOR_*).
 */
export function compareUserEnv(sys, userEnv) {
  const listed = userEnv.list();
  if (!listed.ok) return { ok: false, layer: userEnv.kind, error: listed.error, entries: [], own: 0 };
  const user = new Map(listed.values.filter((v) => NAME.test(v.name)).map((v) => [v.name.toLowerCase(), v]));
  const proc = new Map(Object.entries(sys.env).filter(([k]) => NAME.test(k)).map(([k, v]) => [k.toLowerCase(), { name: k, value: String(v) }]));
  const names = [...new Set([...user.keys(), ...proc.keys()])].sort();
  const entries = [];
  let own = 0;
  for (const n of names) {
    const u = user.get(n);
    const p = proc.get(n);
    const name = (u || p).name;
    if (!u && OWN.test(name)) { own++; continue; }
    const uValue = u ? (u.type === "REG_EXPAND_SZ" ? expandPercent(u.value, sys.env) : u.value) : null;
    const status = u && p ? (uValue === p.value ? "same" : "differs") : u ? "user-only" : "process-only";
    const view = (side, raw) => (side ? (showsValue(name, raw) ? { value: raw, ...(side.type ? { type: side.type } : {}) } : { set: true, ...(side.type ? { type: side.type } : {}) }) : null);
    entries.push({ name, status, user: view(u, u ? u.value : null), process: view(p, p ? p.value : null) });
  }
  return { ok: true, layer: userEnv.kind, error: null, entries, own };
}
