// A stand-in for the binary of an agent, for the tests of src/live.mjs on every system: it does what the real one does that the live check reads, and no more.
// Started as `node fake-agent.mjs <claude|codex|gemini|copilot> <config.json> <the arguments of the agent>` (a shim in the test makes that the command `claude`,
// `codex`, ...). The config says what it prints and sends: { tools, debug, exit, shellLine, versionExit, version, dump }.
//   claude   sends one request to ANTHROPIC_BASE_URL/v1/messages with the tools of the config, writes the lines of `debug` to the file after --debug-file
//   codex    reads base_url from CODEX_HOME/config.toml, sends the Responses requests of a shell call, prints the command_execution event with `shellLine`
//   gemini   sends a streamGenerateContent request to GOOGLE_GEMINI_BASE_URL, then the one that carries the result, and prints nothing
//   copilot  sends the chat completions requests to COPILOT_PROVIDER_BASE_URL with a powershell tool, then the one that carries the result
// `--version` prints `version`. When `dump` is a file, it gets the folders and proxies of the environment, so that a test can see what the guard gave the binary.
import fs from "node:fs";
import http from "node:http";

const argv = process.argv.slice(2);
// the runner of `node --test` also starts every file of test/ on its own, with no arguments: then this is a helper, not a test, and it does nothing
if (argv.length < 2) process.exit(0);
const [agent, configFile, ...args] = argv;
const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
const env = process.env;

if (config.dump) {
  const keep = ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "CODEX_HOME", "COPILOT_HOME", "CLAUDE_CONFIG_DIR", "GEMINI_CLI_HOME", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "CLAUDE_CODE_GIT_BASH_PATH", "CLAUDE_CODE_USE_POWERSHELL_TOOL", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "FAKE_API_KEY"];
  fs.writeFileSync(config.dump, JSON.stringify({ values: Object.fromEntries(keep.filter((k) => env[k] !== undefined).map((k) => [k, env[k]])), names: Object.keys(env).sort(), cwd: process.cwd(), args }));
}
if (args.includes("--version")) {
  process.stdout.write(`${config.version === undefined ? "9.9.9" : config.version}\n`);
  process.exit(config.versionExit || 0);
}
if (config.exit) { process.stderr.write(`${config.stderr || "stopped"}\n`); process.exit(config.exit); }

const post = (url, body) => new Promise((resolve, reject) => {
  const u = new URL(url);
  const data = JSON.stringify(body);
  const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) } }, (res) => { let t = ""; res.on("data", (c) => { t += c; }); res.on("end", () => resolve(t)); });
  req.on("error", reject);
  req.end(data);
});
const after = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };

if (agent === "claude") {
  const debug = after("--debug-file");
  if (debug && config.debug) fs.writeFileSync(debug, `${config.debug.join("\n")}\n`);
  const tools = [...(config.tools || []).map((name) => ({ name, description: name === "PowerShell" ? `Executes PowerShell.\n\nPowerShell edition: ${config.edition || "PowerShell 7+ (pwsh)"}\n - x` : `the ${name} tool`, input_schema: { type: "object" } })), { name: "Read", description: "Reads", input_schema: { type: "object" } }];
  await post(`${env.ANTHROPIC_BASE_URL}/v1/messages`, { model: "x", max_tokens: 1, stream: true, messages: [{ role: "user", content: [{ type: "text", text: after("-p") || "" }] }], tools });
} else if (agent === "codex") {
  const toml = fs.readFileSync(`${env.CODEX_HOME}/config.toml`, "utf8");
  const base = /base_url = "([^"]+)"/.exec(toml)[1];
  const first = await post(`${base}/responses`, { model: "gpt-5.5", input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }], tools: [{ type: "function", name: "exec_command" }] });
  const called = /exec_command/.test(first);
  if (called) {
    process.stdout.write(`${JSON.stringify({ type: "thread.started", thread_id: "t" })}\n`);
    process.stdout.write(`${JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "command_execution", command: config.shellLine, aggregated_output: "x", exit_code: 0, status: "completed" } })}\n`);
    await post(`${base}/responses`, { model: "gpt-5.5", input: [{ type: "function_call_output", call_id: "c", output: "x" }], tools: [] });
  }
} else if (agent === "gemini") {
  const base = env.GOOGLE_GEMINI_BASE_URL;
  await post(`${base}/v1beta/models/m:generateContent`, { generationConfig: { responseMimeType: "application/json", responseJsonSchema: { type: "object", properties: { reasoning: { type: "string" } } } }, contents: [{ role: "user", parts: [{ text: "route" }] }] });
  const first = await post(`${base}/v1beta/models/m:streamGenerateContent?alt=sse`, { contents: [{ role: "user", parts: [{ text: "hello" }] }], tools: [{ functionDeclarations: [{ name: "run_shell_command" }] }] });
  if (/run_shell_command/.test(first)) {
    const response = config.shellError ? { error: config.shellError } : { output: `<untrusted_context>\nOutput: ${config.shellLine}\nProcess Group PGID: 1\n</untrusted_context>` };
    await post(`${base}/v1beta/models/m:streamGenerateContent?alt=sse`, { contents: [{ role: "user", parts: [{ text: "hello" }] }, { role: "model", parts: [{ functionCall: { name: "run_shell_command", args: {} } }] }, { role: "user", parts: [{ functionResponse: { name: "run_shell_command", response } }] }] });
  }
  process.stdout.write(`${JSON.stringify({ session_id: "s", response: "PROBE-DONE" })}\n`);
} else if (agent === "copilot") {
  const base = env.COPILOT_PROVIDER_BASE_URL;
  const first = await post(`${base}/chat/completions`, { model: "gpt-4.1", stream: true, messages: [{ role: "user", content: "hello" }], tools: [{ type: "function", function: { name: "powershell" } }] });
  if (/"powershell"/.test(first)) {
    const content = config.shellError || `${config.shellLine}\n<shellId: 0 completed with exit code 0>`;
    await post(`${base}/chat/completions`, { model: "gpt-4.1", stream: true, messages: [{ role: "user", content: "hello" }, { role: "assistant", content: null, tool_calls: [{ id: "c", type: "function", function: { name: "powershell", arguments: "{}" } }] }, { role: "tool", tool_call_id: "c", content }], tools: [] });
  }
  process.stdout.write("PROBE-DONE\n");
}
