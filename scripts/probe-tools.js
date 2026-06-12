#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";

const SERVER = new URL("../dist/src/index.js", import.meta.url).pathname;
const child = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "pipe"] });

let buf = "";
let serverStderr = "";

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { process.stderr.write("non-JSON: " + line + "\n"); continue; }
    handle(msg);
  }
});

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { serverStderr += chunk; });

function send(obj) { child.stdin.write(JSON.stringify(obj) + "\n"); }

function handle(msg) {
  if (msg.id === 1 && msg.result) {
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    return;
  }
  if (msg.id === 2 && msg.result) {
    const tools = msg.result.tools ?? [];
    const names = tools.map((t) => t.name).sort();
    console.log("=== tools/list response ===");
    console.log(JSON.stringify(msg.result, null, 2));
    console.log("=== tool names (sorted) ===");
    console.log(JSON.stringify(names));
    console.log(`=== count: ${names.length} ===`);
    if (serverStderr) {
      console.log("=== server stderr (should be empty) ===");
      console.log(JSON.stringify(serverStderr));
    }
    child.kill();
    process.exit(0);
  }
  if (msg.id !== undefined && msg.error) {
    console.log(JSON.stringify(msg, null, 2));
    if (serverStderr) console.log("stderr:\n" + serverStderr);
    child.kill();
    process.exit(3);
  }
}

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "probe", version: "0.0.0" },
  },
});

setTimeout(() => {
  process.stderr.write("TIMEOUT\n");
  if (serverStderr) process.stderr.write("stderr:\n" + serverStderr + "\n");
  child.kill();
  process.exit(2);
}, 8000).unref();
