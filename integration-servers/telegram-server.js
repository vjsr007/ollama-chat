#!/usr/bin/env node
// Telegram Bot MCP server. Requires TELEGRAM_BOT_TOKEN.
const { JsonRpcServer } = require('./base-jsonrpc-server.js');

async function tgFetch(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN');
  const resp = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await resp.json();
  if (!json.ok) throw new Error('Telegram error: ' + JSON.stringify(json));
  return json.result;
}

const tools = () => [
  {
    name: 'telegram_send_message',
    description: 'Send a text message to a chat id',
    inputSchema: { type: 'object', properties: { chat_id: { type: 'string' }, text: { type: 'string' } }, required: ['chat_id', 'text'] },
    invoke: async ({ chat_id, text }) => tgFetch('sendMessage', { chat_id, text })
  }
];

new JsonRpcServer({ toolsProvider: tools, onInitialize: () => ({ name: 'telegram-mcp' }) });
