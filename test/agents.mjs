// The four agents that can be run at zero cost, each against a fake API on 127.0.0.1: the recipes of 17 October 2026 (Codex CLI, Gemini CLI,
// GitHub Copilot CLI) and the established one of claude-windows-doctor (Claude Code). Cursor is not run: its CLI needs a login.
//
//   agent.BIN / agent.info() / agent.skip()   the binary E2E_* names, whether it runs, the value for node:test's `skip`
//   agent.fake(script)                        the fake API: { port, requests, results(), close() }
//   agent.sandbox(label)                      a world for the agent (home, its config folder, the project folder, the settings it needs)
//   agent.run(sb, api, { prompt, args, env, path, timeout })   runs the binary through test/sandbox.mjs's guard; resolves { code, out, err, ms, ... }
//
// A script says what the "model" does, one tool call per turn: { shell: "echo hi" }, { text: "..." }. Every answer after the script is the
// text PROBE-DONE. Tool names differ: the fakes use the shell tool of the agent as its first request lists it.
import fs from "node:fs";
import path from "node:path";
import { IS_WIN, world } from "./helpers.mjs";
import { binInfo, fakeServer, launch, putFile, resolveBin, sse, textOf } from "./sandbox.mjs";

const USAGE = { input_tokens: 1, output_tokens: 1 };

// ---- Claude Code --------------------------------------------------------------------------------------------------------------

const msgStart = (id, model) => ["message_start", { type: "message_start", message: { id, type: "message", role: "assistant", model: model || "x", content: [], stop_reason: null, usage: USAGE } }];

/** SSE events of an assistant message holding the given blocks: { text } or { tool, input, id }. */
export function claudeMessage(id, model, blocks) {
  const ev = [msgStart(id, model)];
  blocks.forEach((b, i) => {
    if (b.text !== undefined) {
      ev.push(["content_block_start", { type: "content_block_start", index: i, content_block: { type: "text", text: "" } }]);
      ev.push(["content_block_delta", { type: "content_block_delta", index: i, delta: { type: "text_delta", text: b.text } }]);
    } else {
      ev.push(["content_block_start", { type: "content_block_start", index: i, content_block: { type: "tool_use", id: b.id || `toolu_${id}_${i}`, name: b.tool, input: {} } }]);
      ev.push(["content_block_delta", { type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } }]);
    }
    ev.push(["content_block_stop", { type: "content_block_stop", index: i }]);
  });
  ev.push(["message_delta", { type: "message_delta", delta: { stop_reason: blocks.some((b) => b.tool) ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }]);
  ev.push(["message_stop", { type: "message_stop" }]);
  return ev;
}

export const userText = (j) => (j.messages || []).filter((m) => m.role === "user").map((m) => (typeof m.content === "string" ? m.content : (m.content || []).map((b) => b.text || "").join(""))).join("\n");

/** Claude Code resolved to the native binary: an npm install puts claude.cmd next to a node_modules folder that holds claude.exe; start that one. */
export function resolveClaude(name = process.env.E2E_CLAUDE || "") {
  const bin = resolveBin(name);
  if (!bin || !IS_WIN || !/\.cmd$/i.test(bin)) return bin;
  const native = path.join(path.dirname(bin), "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
  return fs.existsSync(native) ? native : bin;
}

function makeClaude() {
  const a = { id: "claude", label: "Claude Code", envName: "E2E_CLAUDE", BIN: resolveClaude() };
  let cached;
  a.info = async () => (cached ??= await binInfo(a.BIN, "a Claude Code binary", a.envName, { DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1" }));
  a.fake = async (script = []) => {
    const api = await fakeServer((req, body, res, ctx) => {
      if (!req.url.includes("/v1/messages")) { res.writeHead(404, { "content-type": "application/json" }); res.end("{}"); return; }
      if (body.stream === false) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: `msg_${ctx.n}`, type: "message", role: "assistant", model: body.model || "x", content: [{ type: "text", text: "done" }], stop_reason: "end_turn", usage: USAGE }));
        return;
      }
      const turn = (body.messages || []).filter((m) => m.role === "assistant").length;
      const step = script[turn];
      const shell = ((body.tools || []).map((t) => t.name).find((n) => n === "Bash" || n === "PowerShell")) || "Bash";
      const events = step && step.shell !== undefined
        ? claudeMessage(`msg_${ctx.n}`, body.model, [{ tool: shell, id: `toolu_${turn}`, input: { command: step.shell, description: "probe" } }])
        : claudeMessage(`msg_${ctx.n}`, body.model, [{ text: (step && step.text) || "PROBE-DONE" }]);
      const send = sse(res);
      for (const [ev, data] of events) send(ev, data);
      res.end();
    });
    api.main = () => api.requests.map((r) => r.body).find((b) => userText(b).includes("PROBE-MAIN")) || (api.requests[0] && api.requests[0].body);
    api.tools = () => ((api.main() || {}).tools || []).map((t) => t.name);
    api.results = () => {
      for (let i = api.requests.length - 1; i >= 0; i--) {
        const out = [];
        for (const m of api.requests[i].body.messages || []) if (m.role === "user" && Array.isArray(m.content)) for (const b of m.content) if (b.type === "tool_result") out.push({ text: textOf(b.content), error: !!b.is_error });
        if (out.length) return out;
      }
      return [];
    };
    return api;
  };
  /** A world for Claude Code: the config folder already onboarded and the project trusted. */
  a.sandbox = (label = "claude") => {
    const sb = world(label);
    const trust = { hasTrustDialogAccepted: true, allowedTools: [] };
    putFile(path.join(sb.claude, ".claude.json"), { hasCompletedOnboarding: true, projects: { [sb.work]: trust, [sb.work.replace(/\\/g, "/")]: trust } });
    sb.settings = path.join(sb.claude, "settings.json");
    sb.debug = path.join(sb.base, "debug.log");
    return sb;
  };
  a.env = (sb, api, extra = {}) => ({ ANTHROPIC_API_KEY: "sk-ant-probe", ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.port}`, DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", NO_COLOR: "1", ...extra });
  a.run = async (sb, api, { prompt = "PROBE-MAIN hello", args = [], env = {}, path: pathOpts, timeout = 150000, debug = true } = {}) => {
    const r = await launch(sb, a.BIN, ["-p", prompt, "--output-format", "json", ...(debug ? ["--debug-file", sb.debug] : []), ...args], { env: a.env(sb, api, env), cwd: sb.work, timeout, path: pathOpts });
    let result = null;
    try { result = JSON.parse(r.out); } catch { /* not json */ }
    return { ...r, result };
  };
  return a;
}

// ---- Codex CLI ------------------------------------------------------------------------------------------------------------------

const sseNamed = (res, ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
const CODEX_USAGE = { input_tokens: 1, output_tokens: 1, total_tokens: 2 };

function makeCodex() {
  const a = { id: "codex", label: "Codex CLI", envName: "E2E_CODEX", BIN: resolveBin(process.env.E2E_CODEX || "") };
  let cached;
  a.info = async () => (cached ??= await binInfo(a.BIN, "a Codex CLI binary", a.envName));
  /** The fake Responses API: step k answers the request that carries as many tool results as the steps before k asked for. */
  a.fake = async (script = []) => {
    const consumed = (k) => script.slice(0, k).filter((s) => s.shell !== undefined).length;
    const api = await fakeServer((req, body, res, ctx) => {
      if (!(req.method === "POST" && /\/responses(\?|$)/.test(req.url))) { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: `fake API: no route ${req.method} ${req.url}` } })); return; }
      const outputs = (body.input || []).filter((i) => i && (i.type === "function_call_output" || i.type === "custom_tool_call_output")).length;
      const index = script.findIndex((_, k) => consumed(k) === outputs);
      const step = index >= 0 ? script[index] : null;
      res.writeHead(200, { "content-type": "text/event-stream" });
      sseNamed(res, "response.created", { type: "response.created", response: { id: `resp_${ctx.n}`, status: "in_progress", output: [] } });
      if (step && step.shell !== undefined) {
        const tool = (body.tools || []).map((t) => t.name).find((n) => n === "exec_command" || n === "shell" || n === "shell_command") || "exec_command";
        const item = { type: "function_call", id: `fc_${ctx.n}`, call_id: `call_${ctx.n}`, name: tool, arguments: JSON.stringify({ cmd: step.shell }), status: "completed" };
        sseNamed(res, "response.output_item.added", { type: "response.output_item.added", output_index: 0, item });
        sseNamed(res, "response.output_item.done", { type: "response.output_item.done", output_index: 0, item });
        sseNamed(res, "response.completed", { type: "response.completed", response: { id: `resp_${ctx.n}`, status: "completed", output: [item], usage: CODEX_USAGE } });
      } else {
        const text = (step && step.text) || "PROBE-DONE";
        const msg = { type: "message", id: `msg_${ctx.n}`, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
        sseNamed(res, "response.output_item.added", { type: "response.output_item.added", output_index: 0, item: msg });
        sseNamed(res, "response.output_text.delta", { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: text });
        sseNamed(res, "response.output_item.done", { type: "response.output_item.done", output_index: 0, item: msg });
        sseNamed(res, "response.completed", { type: "response.completed", response: { id: `resp_${ctx.n}`, status: "completed", output: [msg], usage: CODEX_USAGE } });
      }
      res.end();
    });
    api.main = () => (api.requests[0] || {}).body;
    api.tools = () => (((api.main() || {}).tools) || []).map((t) => t.name || t.type);
    api.results = () => {
      for (let i = api.requests.length - 1; i >= 0; i--) {
        const out = (api.requests[i].body.input || []).filter((x) => x.type === "function_call_output").map((x) => ({ text: textOf(x.output) }));
        if (out.length) return out;
      }
      return [];
    };
    return api;
  };
  a.sandbox = (label = "codex") => {
    const sb = world(label);
    sb.config = path.join(sb.codex, "config.toml");
    return sb;
  };
  /** Writes CODEX_HOME/config.toml: the fake provider, then `top` (more top-level keys) and `tables` (more tables). */
  a.writeConfig = (sb, api, { top = "", tables = "", model = "gpt-5.5" } = {}) => {
    const text = `model = "${model}"\nmodel_provider = "fake"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n${top}${top && !top.endsWith("\n") ? "\n" : ""}\n[model_providers.fake]\nname = "fake"\nbase_url = "http://127.0.0.1:${api.port}/v1"\nenv_key = "FAKE_API_KEY"\nwire_api = "responses"\n\n${tables}`;
    putFile(sb.config, text);
    return text;
  };
  a.env = (sb, api, extra = {}) => ({ FAKE_API_KEY: "fake", NO_COLOR: "1", ...extra });
  a.run = async (sb, api, { prompt = "hello", args = [], env = {}, path: pathOpts, timeout = 120000, json = true } = {}) => {
    const r = await launch(sb, a.BIN, ["exec", "--skip-git-repo-check", "-C", sb.work, ...(json ? ["--json"] : []), ...args, prompt], { env: a.env(sb, api, env), cwd: sb.work, timeout, path: pathOpts });
    return { ...r, events: parseJsonLines(r.out) };
  };
  return a;
}

/** The JSON lines of `codex exec --json`, parsed; lines that are not JSON are skipped. */
export const parseJsonLines = (out) => String(out).split(/\r?\n/).filter((l) => l.startsWith("{")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// ---- Gemini CLI -----------------------------------------------------------------------------------------------------------------

/** A value that satisfies a JSON schema (types in either case), for the requests that want JSON back. */
export function fromSchema(s) {
  if (!s || typeof s !== "object") return {};
  const t = String(s.type || (s.properties ? "object" : "")).toLowerCase();
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  if (t === "object" || s.properties) { const o = {}; for (const [k, v] of Object.entries(s.properties || {})) o[k] = fromSchema(v); return o; }
  if (t === "array") return [];
  if (t === "number" || t === "integer") return 1;
  if (t === "boolean") return false;
  return "x";
}

const geminiChunk = (part) => ({ candidates: [{ content: { role: "model", parts: [part] }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }, modelVersion: "fake" });

function makeGemini() {
  const a = { id: "gemini", label: "Gemini CLI", envName: "E2E_GEMINI", BIN: resolveBin(process.env.E2E_GEMINI || "") };
  let cached;
  a.info = async () => (cached ??= await binInfo(a.BIN, "a Gemini CLI binary", a.envName, { GEMINI_CLI_NO_RELAUNCH: "1" }));
  /**
   * The fake Gemini API. The CLI asks a "utility_router" role to classify the request before the main turn: any request that wants JSON gets a
   * document built from the schema it sends, so the router succeeds at once (a reply that is not JSON makes the CLI retry for about 90 seconds).
   */
  a.fake = async (script = []) => {
    const done = (body) => (body.contents || []).reduce((n, c) => n + (c.parts || []).filter((p) => p.functionResponse).length, 0);
    const api = await fakeServer((req, body, res) => {
      const url = req.url;
      if (url.includes(":countTokens")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ totalTokens: 1 })); return; }
      const gc = body.generationConfig || {};
      const wantsJson = gc.responseMimeType === "application/json" || gc.responseJsonSchema || gc.responseSchema;
      if (url.includes(":streamGenerateContent")) {
        const step = script[done(body)];
        const send = sse(res);
        send(null, geminiChunk(step && step.shell !== undefined ? { functionCall: { name: "run_shell_command", args: { command: step.shell, description: "probe" } } } : { text: (step && step.text) || "PROBE-DONE" }));
        res.end();
        return;
      }
      if (url.includes(":generateContent")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(geminiChunk({ text: wantsJson ? JSON.stringify(fromSchema(gc.responseJsonSchema || gc.responseSchema)) : "PROBE-DONE" })));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `fake API: no route ${url}` } }));
    });
    api.main = () => (api.requests.find((r) => r.url.includes(":streamGenerateContent")) || {}).body;
    api.tools = () => (((api.main() || {}).tools) || []).flatMap((t) => (t.functionDeclarations || []).map((f) => f.name));
    api.results = () => {
      for (let i = api.requests.length - 1; i >= 0; i--) {
        const out = [];
        for (const c of api.requests[i].body.contents || []) for (const p of c.parts || []) if (p.functionResponse) out.push({ text: textOf(p.functionResponse.response) });
        if (out.length) return out;
      }
      return [];
    };
    return api;
  };
  /** A world for Gemini CLI: <home>/.gemini/settings.json with the API key as the sign-in and no statistics; `extra` keys (hooks) are merged in. */
  a.sandbox = (label = "gemini", extra = {}) => {
    const sb = world(label);
    sb.settings = path.join(sb.gemini, "settings.json");
    putFile(sb.settings, { security: { auth: { selectedType: "gemini-api-key" } }, privacy: { usageStatisticsEnabled: false }, general: { previewFeatures: false }, ...extra });
    return sb;
  };
  a.env = (sb, api, extra = {}) => ({ GEMINI_API_KEY: "fake", GOOGLE_GEMINI_BASE_URL: `http://127.0.0.1:${api.port}`, GEMINI_CLI_TRUST_WORKSPACE: "true", GEMINI_CLI_NO_RELAUNCH: "1", NO_BROWSER: "1", NO_COLOR: "1", ...extra });
  a.run = async (sb, api, { prompt = "hello", args = [], env = {}, path: pathOpts, timeout = 170000 } = {}) => {
    const r = await launch(sb, a.BIN, ["-p", prompt, "--yolo", "--skip-trust", "--output-format", "json", ...args], { env: a.env(sb, api, env), cwd: sb.work, timeout, path: pathOpts });
    let result = null;
    try { result = JSON.parse(r.out.slice(r.out.indexOf("{"))); } catch { /* not json */ }
    return { ...r, result };
  };
  return a;
}

// ---- GitHub Copilot CLI -----------------------------------------------------------------------------------------------------------

function makeCopilot() {
  const a = { id: "copilot", label: "GitHub Copilot CLI", envName: "E2E_COPILOT", BIN: resolveBin(process.env.E2E_COPILOT || "") };
  let cached;
  a.info = async () => (cached ??= await binInfo(a.BIN, "a GitHub Copilot CLI binary", a.envName, { COPILOT_AUTO_UPDATE: "false" }));
  const toolNamesOf = (body) => (body.tools || []).map((t) => (t.function && t.function.name) || t.name);
  a.fake = async (script = []) => {
    const api = await fakeServer((req, body, res, ctx) => {
      if (req.url.includes("/chat/completions")) {
        const done = (body.messages || []).filter((m) => m.role === "tool").length;
        const step = script[done];
        const names = toolNamesOf(body);
        const shell = names.find((t) => /^(powershell|bash)$/i.test(t)) || (IS_WIN ? "powershell" : "bash");
        const call = step && step.shell !== undefined ? { name: shell, args: { command: step.shell, description: "probe" } } : null;
        const base = { id: `c_${ctx.n}`, object: "chat.completion.chunk", created: 0, model: body.model };
        const toolCalls = call ? [{ id: `call_${ctx.n}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] : null;
        if (body.stream) {
          const send = sse(res);
          send(null, { ...base, choices: [{ index: 0, delta: call ? { role: "assistant", tool_calls: toolCalls.map((tc, i) => ({ index: i, ...tc })) } : { role: "assistant", content: (step && step.text) || "PROBE-DONE" }, finish_reason: null }] });
          send(null, { ...base, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
          send(null, "[DONE]");
          res.end();
        } else {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ...base, object: "chat.completion", choices: [{ index: 0, message: call ? { role: "assistant", content: null, tool_calls: toolCalls } : { role: "assistant", content: "PROBE-DONE" }, finish_reason: call ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
        }
        return;
      }
      if (req.url.includes("/models")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ object: "list", data: [{ id: "gpt-4.1", object: "model" }] })); return; }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `fake API: no route ${req.url}` } }));
    });
    api.main = () => (api.requests.find((r) => r.url.includes("/chat/completions")) || {}).body;
    api.tools = () => toolNamesOf(api.main() || {});
    api.results = () => {
      for (let i = api.requests.length - 1; i >= 0; i--) {
        const out = (api.requests[i].body.messages || []).filter((m) => m.role === "tool").map((m) => ({ text: textOf(m.content) }));
        if (out.length) return out;
      }
      return [];
    };
    return api;
  };
  a.sandbox = (label = "copilot") => {
    const sb = world(label);
    sb.hooksDir = path.join(sb.copilot, "hooks");
    return sb;
  };
  a.env = (sb, api, extra = {}) => ({
    COPILOT_OFFLINE: "true", COPILOT_PROVIDER_BASE_URL: `http://127.0.0.1:${api.port}/v1`, COPILOT_PROVIDER_TYPE: "openai", COPILOT_PROVIDER_WIRE_API: "completions",
    COPILOT_PROVIDER_API_KEY: "fake", COPILOT_MODEL: "gpt-4.1", COPILOT_PROVIDER_MAX_PROMPT_TOKENS: "100000", COPILOT_PROVIDER_MAX_OUTPUT_TOKENS: "4000",
    COPILOT_ALLOW_ALL: "true", COPILOT_AUTO_UPDATE: "false", NO_COLOR: "1", ...extra,
  });
  a.run = (sb, api, { prompt = "hello", args = [], env = {}, path: pathOpts, timeout = 120000 } = {}) => launch(sb, a.BIN, ["-p", prompt, "--allow-all-tools", "-s", "-C", sb.work, ...args], { env: a.env(sb, api, env), cwd: sb.work, timeout, path: pathOpts });
  return a;
}

export const claude = makeClaude();
export const codex = makeCodex();
export const gemini = makeGemini();
export const copilot = makeCopilot();
export const AGENTS = { claude, codex, gemini, copilot };

/** The value for node:test's `skip` option for an agent: false when its binary runs, else the reason. Resolves once per agent. */
export async function skipReason(agent) {
  const i = await agent.info();
  return i.ok ? false : i.reason;
}
