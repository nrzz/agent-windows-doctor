// Facts that belong to one agent and are read from its files: the Cursor CLI's launcher chain (agent.cmd, cursor-agent.ps1, the versions folder),
// whether the installed Gemini CLI has the native half of node-pty (#16003), and which Node each npm package asks for (its own `engines`).
// Nothing here runs a program.
import * as W from "./winpath.mjs";
import { satisfiesNode } from "./versions.mjs";

// ---- Cursor's launcher ------------------------------------------------------------------------------------------------------

/**
 * What agent.cmd (or cursor-agent.cmd) says, from its text: { delayedExpansion, powershell (the program as written), hardcoded51, flags, forwardsArgs, file }.
 * Read on this machine (the Cursor CLI installed on 16 June 2026): setlocal enabledelayedexpansion, then
 *   %SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "...\cursor-agent.ps1" %*
 */
export function parseCursorCmd(text) {
  const t = String(text || "");
  const delayedExpansion = /^\s*setlocal\s+enabledelayedexpansion\s*$/im.test(t);
  let line = null;
  for (const l of t.split(/\r?\n/)) {
    if (/^\s*(rem\b|::)/i.test(l)) continue;
    if (/powershell(\.exe)?\b/i.test(l)) { line = l.trim(); break; }
  }
  if (!line) return { delayedExpansion, powershell: null, hardcoded51: false, flags: null, forwardsArgs: false };
  const m = /^("[^"]+"|\S+)\s*(.*)$/.exec(line);
  const exe = m ? m[1].replace(/^"|"$/g, "") : null;
  const rest = m ? m[2] : "";
  return {
    delayedExpansion,
    powershell: exe,
    hardcoded51: /\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i.test(exe || ""),
    flags: rest.replace(/"[^"]*\.ps1"/i, "<script>").replace(/\s*%\*\s*$/, "").trim() || null,
    forwardsArgs: /%\*\s*$/.test(rest),
  };
}

/** What cursor-agent.ps1 says: { versionPattern, runsRootNode, picksByDate }. The pattern is the one its Where-Object filter matches a version folder's name with. */
export function parseCursorPs1(text) {
  const t = String(text || "");
  const m = /\$name\s+-match\s+'([^']{1,200})'/.exec(t) || /-match\s+'([^']{1,200})'/.exec(t);
  return {
    versionPattern: m ? m[1] : null,
    runsRootNode: /Test-Path\s+"\$scriptPath\\node\.exe"/i.test(t),
    picksByDate: /Parse-VersionString/.test(t),
  };
}

/** Does PowerShell's -match (case-insensitive) take `name` for the pattern? null when the pattern is not one JavaScript can read. */
export function psMatch(pattern, name) {
  try { return new RegExp(pattern, "i").test(name); } catch { return null; }
}

/** The Cursor CLI launcher in a folder (%LOCALAPPDATA%\cursor-agent): its files and what they say. Returns null when there is no launcher there. */
export function readCursorLauncher(sys, dir) {
  const cmdName = ["agent.cmd", "cursor-agent.cmd"].find((n) => sys.isFile(W.join(dir, n)));
  if (!cmdName) return null;
  const cmd = parseCursorCmd(sys.readText(W.join(dir, cmdName)));
  const ps1Name = ["cursor-agent.ps1", "agent.ps1"].find((n) => sys.isFile(W.join(dir, n)));
  const ps1 = ps1Name ? parseCursorPs1(sys.readText(W.join(dir, ps1Name))) : null;
  const versions = (sys.listDir(W.join(dir, "versions")) || []).filter((n) => sys.isDir(W.join(dir, "versions", n))).sort();
  const matching = ps1 && ps1.versionPattern ? versions.filter((n) => psMatch(ps1.versionPattern, n) === true) : null;
  const rootNode = sys.isFile(W.join(dir, "node.exe"));
  return {
    dir, cmdFile: W.join(dir, cmdName), ps1File: ps1Name ? W.join(dir, ps1Name) : null,
    cmd, ps1, versions, matching, rootNode,
    powershell: cmd.powershell ? cmd.powershell.replace(/%SystemRoot%/i, sys.getEnv("SystemRoot") || "C:\\Windows") : null,
    args: cmd.flags,
    // the launcher stops when it must pick a version folder and none matches its pattern
    noVersionFolder: Boolean(ps1 && ps1.versionPattern && !rootNode && matching && matching.length === 0),
  };
}

// ---- Gemini CLI's node-pty ------------------------------------------------------------------------------------------------

/**
 * The native half of node-pty in an installed Gemini CLI: Gemini CLI starts shell commands in a pseudo-terminal when it can, and #16003 is a missing
 * binary. The package lists it as an optional dependency (@lydell/node-pty-win32-x64 holds conpty.node), installed next to the CLI or inside it.
 * Returns { pkgDir, found: path | null, searched: [paths] }.
 */
export function ptyOf(sys, pkgDir) {
  const nm = W.dirname(W.dirname(pkgDir));
  const roots = [W.join(pkgDir, "node_modules"), nm];
  const candidates = [];
  for (const root of roots) {
    for (const arch of ["x64", "arm64"]) candidates.push(W.join(root, "@lydell", `node-pty-win32-${arch}`, "conpty.node"));
    candidates.push(W.join(root, "node-pty", "build", "Release", "conpty.node"), W.join(root, "node-pty", "prebuilds", "win32-x64", "conpty.node"));
  }
  const found = candidates.find((c) => sys.isFile(c)) || null;
  return { pkgDir, found, searched: candidates };
}

// ---- the Node each npm package asks for ----------------------------------------------------------------------------------

/** For each agent with an npm package found: { agent, package, version, range, ok } from the package's own engines.node ("not read" when the package has none). */
export function nodeWants(inventory, nodeVersion) {
  const out = [];
  for (const [agent, a] of Object.entries(inventory.agents)) {
    for (const e of a.entries) {
      if (!e.package) continue;
      const range = e.package.engines && typeof e.package.engines.node === "string" ? e.package.engines.node : null;
      out.push({ agent, package: e.package.name, version: e.package.version, path: e.path, range, ok: range ? satisfiesNode(nodeVersion, range) : null });
    }
  }
  return out.filter((x, i, all) => all.findIndex((y) => y.agent === x.agent && y.package === x.package && y.range === x.range) === i);
}
