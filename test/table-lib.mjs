// Turning a row of test/shell-table.mjs into a machine: the same folders, files, PATH, variables and settings, either as a pretend
// Windows machine (the offline test) or as real files in a temporary folder (the test against the real binary).
import * as W from "../src/winpath.mjs";
import { LAYOUTS } from "./shell-table.mjs";
import { fakeMachine, SYSTEM_FILES, SYSTEM_PATH } from "./machine.mjs";
import { loadSettingsFiles, shellFacts } from "../src/claude-settings.mjs";
import { FIXED_BASH, predictShell } from "../src/claude-shell.mjs";

/** ctx: { root, work } with forward slashes. Fills {root}, {work}, {<layout>} and {<layout>:bs}; a value that starts with `bs:` has all its slashes turned into backslashes. */
export function fill(text, ctx) {
  let s = String(text);
  s = s.replace(/\{([^{}:]+)(:bs)?\}/g, (m, name, bs) => {
    let v;
    if (name === "root") v = ctx.root;
    else if (name === "work") v = ctx.work;
    else if (Object.prototype.hasOwnProperty.call(LAYOUTS, name)) v = `${ctx.root}/${name}`;
    else if (ctx.extra && Object.prototype.hasOwnProperty.call(ctx.extra, name)) v = ctx.extra[name];
    else return m;
    return bs ? v.replace(/\//g, "\\") : v;
  });
  if (s.startsWith("bs:")) s = s.slice(3).replace(/\//g, "\\");
  return s;
}

export function fillDeep(value, ctx) {
  if (typeof value === "string") return fill(value, ctx);
  if (Array.isArray(value)) return value.map((v) => fillDeep(v, ctx));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillDeep(v, ctx)]));
  return value;
}

/** The files and folders a row needs, as absolute paths with forward slashes: { files, dirs }. */
export function rowFiles(row, ctx) {
  const files = [];
  const dirs = [];
  const add = (p) => { if (p.endsWith("/")) dirs.push(p.slice(0, -1)); else files.push(p); };
  for (const name of row.layouts || []) for (const e of LAYOUTS[name]) add(`${ctx.root}/${name}/${e}`);
  for (const f of row.projectFiles || []) add(`${ctx.work}/${f}`);
  for (const f of row.files || []) add(fill(f, ctx));
  return { files, dirs };
}

export const pathDirsOf = (row, ctx) => (row.path || []).map((p) => fill(p, ctx).replace(/\//g, "\\"));
export const envOf = (row, ctx) => Object.fromEntries(Object.entries(row.env || {}).map(([k, v]) => [k, fill(v, ctx)]));
export const settingsOf = (row, ctx) => Object.fromEntries(Object.entries(row.settings || {}).map(([k, v]) => [k, fillDeep(v, ctx)]));

/** The Windows spelling of a path written with forward slashes. */
export const winPath = (p) => W.toBackslash(p);

export const CTX = { root: "C:/t", work: "C:/work/proj" };
const WORK = "C:\\work\\proj";
const HOME = "C:\\Users\\me";

/** The pretend machine for a row. `defaultGit`: whether there is a Git at C:\Program Files\Git. */
export function machineFor(row, { defaultGit = false, ctx = CTX } = {}) {
  const { files, dirs } = rowFiles(row, ctx);
  const env = { ...envOf(row, ctx), Path: [...pathDirsOf(row, ctx), SYSTEM_PATH].join(";"), SystemRoot: "C:\\Windows" };
  const texts = {};
  const s = settingsOf(row, ctx);
  if (s.user) texts[`${HOME}\\.claude\\settings.json`] = JSON.stringify(s.user);
  if (s.project) texts[`${WORK}\\.claude\\settings.json`] = JSON.stringify(s.project);
  if (s.local) texts[`${WORK}\\.claude\\settings.local.json`] = JSON.stringify(s.local);
  return fakeMachine({
    env,
    cwd: WORK,
    home: HOME,
    files: [...SYSTEM_FILES, ...files.map((f) => f.replace(/\//g, "\\")), ...(defaultGit ? [FIXED_BASH[0]] : [])],
    dirs: dirs.map((f) => f.replace(/\//g, "\\")),
    texts,
  });
}

/** The prediction for a machine, from its own settings files. */
export function predictFor(sys, cwd = WORK) {
  const settings = loadSettingsFiles(sys, { project: cwd });
  return predictShell(sys, { cwd, facts: shellFacts(settings) });
}
