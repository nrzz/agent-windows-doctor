// The only code that writes a file. It writes one kind of thing: the throwaway folders in which `check --live` runs a real agent binary, each with its
// own home folder, its agent's config folder and a project folder, under the temporary folder, removed afterwards. Nothing else: no settings file of
// the user, no ~/.claude.json, no ~/.codex, ~/.copilot, ~/.gemini or ~/.cursor, and no registry value. (This tool is read only; a test fails if any
// other file of src/ can write, or if this one names a folder of an agent's real home.)
import fs from "node:fs";
import path from "node:path";

/** A new empty folder under the temporary folder. */
export function makeTempDir(tmpdir, prefix = "adw-") {
  return fs.realpathSync(fs.mkdtempSync(path.join(tmpdir, prefix)));
}

/** Removes a folder that makeTempDir made (and refuses any other: its name must start with adw-). */
export function removeTempDir(dir) {
  if (!dir || !path.basename(dir).startsWith("adw-")) return false;
  try { fs.rmSync(dir, { recursive: true, force: true }); return true; } catch { return false; }
}

const put = (file, obj) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof obj === "string" ? obj : `${JSON.stringify(obj, null, 2)}\n`); };

/**
 * The folders of a live run, all inside `base`: home (HOME, USERPROFILE, GEMINI_CLI_HOME), appData, localAppData, work (the project), and the config folder
 * of each agent: claude (CLAUDE_CONFIG_DIR), codex (CODEX_HOME), copilot (COPILOT_HOME); Gemini CLI keeps its files in home\.gemini.
 */
export function makeLiveWorld(base) {
  const home = path.join(base, "home");
  const world = {
    base, home,
    appData: path.join(home, "AppData", "Roaming"),
    localAppData: path.join(home, "AppData", "Local"),
    work: path.join(base, "work"),
    claude: path.join(home, ".claude"),
    codex: path.join(home, ".codex"),
    copilot: path.join(home, ".copilot"),
    gemini: path.join(home, ".gemini"),
    debugFile: path.join(base, "debug.log"),
  };
  for (const d of [world.home, world.appData, world.localAppData, world.work, world.claude, world.codex, world.copilot, world.gemini]) fs.mkdirSync(d, { recursive: true });
  return world;
}

/** Claude Code's config folder: onboarding finished, the project trusted, and the settings that decide the shell ({ user, project, local }). */
export function writeClaudeWorld(world, settings = {}) {
  const trust = { hasTrustDialogAccepted: true, allowedTools: [] };
  put(path.join(world.claude, ".claude.json"), { hasCompletedOnboarding: true, projects: { [world.work]: trust, [world.work.replace(/\\/g, "/")]: trust } });
  if (settings.user) put(path.join(world.claude, "settings.json"), settings.user);
  if (settings.project) put(path.join(world.work, ".claude", "settings.json"), settings.project);
  if (settings.local) put(path.join(world.work, ".claude", "settings.local.json"), settings.local);
}

/** Codex CLI's CODEX_HOME/config.toml: the fake provider at 127.0.0.1:<port> and nothing else. */
export function writeCodexWorld(world, port) {
  put(path.join(world.codex, "config.toml"), `model = "gpt-5.5"\nmodel_provider = "fake"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n\n[model_providers.fake]\nname = "fake"\nbase_url = "http://127.0.0.1:${port}/v1"\nenv_key = "FAKE_API_KEY"\nwire_api = "responses"\n`);
}

/** Gemini CLI's settings: the API key as the sign-in and no statistics. */
export function writeGeminiWorld(world) {
  put(path.join(world.gemini, "settings.json"), { security: { auth: { selectedType: "gemini-api-key" } }, privacy: { usageStatisticsEnabled: false }, general: { previewFeatures: false } });
}

/** The text of the debug log that a live run wrote, or "". */
export function readDebugLog(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}
