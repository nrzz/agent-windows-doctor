// A hook for the real-binary checks. It logs what the agent sent (the stdin JSON, the arguments, the agent's own environment variables, the
// working folder, and on request the command line of the program that started it) as one line of ADW_LOG. With the second argument `act` it
// then behaves as the case named in the input says: the first CASE-<id> in the input picks the entry <id> of the JSON file ADW_CASES
// ({ stdout, stderr, exit, sleepMs }). With no entry it exits 0 and prints nothing.
import fs from "node:fs";
import { spawnSync } from "node:child_process";

// `node --test` also runs every file under test/: without ADW_LOG this is not a hook run, so do nothing (reading stdin would block)
if (!process.env.ADW_LOG) process.exit(0);

const label = process.argv[2] || "";
const act = process.argv[3] === "act";
let raw = "";
try { raw = fs.readFileSync(0, "utf8"); } catch { raw = ""; }
let input = null;
try { input = JSON.parse(raw); } catch { input = { unparsed: raw }; }
const env = {};
for (const [k, v] of Object.entries(process.env)) if (/^(CLAUDE|CODEX|COPILOT|GEMINI|CURSOR|ADW_)/.test(k)) env[k] = v;
const id = (/CASE-([A-Za-z0-9_-]+)/.exec(raw) || [])[1] || "";
let parent = null;
if (process.env.ADW_PARENT === "1" && process.platform === "win32") {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${process.ppid}"; $p.Name; $p.ExecutablePath; $p.CommandLine`], { encoding: "utf8", windowsHide: true, env: { ...process.env, PSModulePath: undefined } });
  const lines = (r.stdout || "").trim().split(/\r?\n/);
  parent = { name: lines[0] || "", path: lines[1] || "", commandLine: lines.slice(2).join("\n") };
}
fs.appendFileSync(process.env.ADW_LOG, `${JSON.stringify({ label, id, at: Date.now(), cwd: process.cwd(), argv: process.argv.slice(2), env, parent, input })}\n`);
let beh = {};
if (act && id && process.env.ADW_CASES) { try { beh = JSON.parse(fs.readFileSync(process.env.ADW_CASES, "utf8"))[id] || {}; } catch { beh = {}; } }
if (beh.sleepMs) await new Promise((r) => setTimeout(r, beh.sleepMs));
// synchronous writes: a pipe may not be flushed when the process exits right after an asynchronous write
if (beh.stdout) fs.writeSync(1, beh.stdout);
if (beh.stderr) fs.writeSync(2, beh.stderr);
process.exitCode = beh.exit || 0;
