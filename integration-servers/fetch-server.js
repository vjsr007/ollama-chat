#!/usr/bin/env node
// Minimal fetch MCP server using node fetch (global in >=18). Provides simple GET.
const { JsonRpcServer } = require('./base-jsonrpc-server.js');

const tools = () => [
  {
    name: 'http_get_text',
    description: 'HTTP GET a URL and return status, headers, text (max 50KB)',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    invoke: async ({ url }) => {
      const res = await fetch(url, { method: 'GET' });
      const buf = await res.arrayBuffer();
      const max = 50 * 1024; // 50KB
      const truncated = buf.byteLength > max;
      const text = new TextDecoder().decode(buf.slice(0, max));
      return { status: res.status, ok: res.ok, headers: Object.fromEntries(res.headers.entries()), truncated, length: buf.byteLength, text };
    }
  }
];

new JsonRpcServer({ toolsProvider: tools, onInitialize: () => ({ name: 'fetch-mcp' }) });
