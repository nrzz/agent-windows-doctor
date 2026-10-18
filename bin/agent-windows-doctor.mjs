#!/usr/bin/env node
// agent-windows-doctor: what Claude Code, Codex CLI, Gemini CLI, GitHub Copilot CLI and Cursor each get on Windows, and why. All the work lives in
// src/cli.mjs; run `agent-windows-doctor --help` for the commands.
import { main } from "../src/cli.mjs";

// `agent-windows-doctor check | head` closes the pipe early: that is not an error.
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

process.exitCode = await main(process.argv.slice(2));
