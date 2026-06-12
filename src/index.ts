#!/usr/bin/env node
import { startStdioServer } from "./server.js";

startStdioServer().catch((err) => {
  // We must never write to stdout in stdio mode (it would corrupt the JSON-RPC
  // stream). Use stderr so a parent MCP host can see the failure.
  process.stderr.write(`repovitals: fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
