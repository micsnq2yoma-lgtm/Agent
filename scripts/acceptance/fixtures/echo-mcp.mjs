#!/usr/bin/env node
// A tiny MCP tool server for p21: one tool, p21_secret, that returns the P21_SECRET env value
// (bound from a Paperclip secret) so the acceptance can see the whole chain worked.
import readline from "node:readline";
const out = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.method === "initialize") out({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "p21-echo", version: "1.0" } } });
  else if (m.method === "tools/list") out({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "p21_secret", description: "返回验收用的口令", inputSchema: { type: "object", properties: {} } }] } });
  else if (m.method === "tools/call") out({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: `口令：${process.env.P21_SECRET ?? "（没有拿到 P21_SECRET）"}` }] } });
  else if (m.id !== undefined) out({ jsonrpc: "2.0", id: m.id, result: {} });
});
