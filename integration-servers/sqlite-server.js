#!/usr/bin/env node
// Minimal SQLite MCP server using better-sqlite3 (fast sync API). Install: npm i better-sqlite3
const { JsonRpcServer } = require('./base-jsonrpc-server.js');
let Database; let available = true;
try { Database = require('better-sqlite3'); } catch { available = false; }

const tools = () => [
  {
    name: 'sqlite_query',
    description: 'Run a read-only SQL query (SELECT) against a SQLite file',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'DB file path'}, sql: { type: 'string', description: 'SELECT statement'} }, required: ['path','sql'] },
    invoke: async ({ path, sql }) => {
      if (!available) throw new Error('better-sqlite3 not installed. Run: npm install better-sqlite3');
      if (!/^\s*select/i.test(sql)) throw new Error('Only SELECT allowed');
      const db = new Database(path, { readonly: true });
      try { return { rows: db.prepare(sql).all(), count: db.prepare(sql).pluck().get ? undefined : undefined }; }
      finally { db.close(); }
    }
  }
];

new JsonRpcServer({ toolsProvider: tools, onInitialize: () => ({ name: 'sqlite-mcp' }) });
