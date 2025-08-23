#!/usr/bin/env node
// WhatsApp Cloud API MCP server. Requires WHATSAPP_TOKEN and WHATSAPP_PHONE_ID.
const { JsonRpcServer } = require('./base-jsonrpc-server.js');

async function waFetch(endpoint, body) {
  const token = process.env.WHATSAPP_TOKEN; const phone = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phone) throw new Error('Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_ID');
  const resp = await fetch(`https://graph.facebook.com/v19.0/${phone}/${endpoint}`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!resp.ok) throw new Error('WhatsApp error ' + resp.status + ' ' + await resp.text());
  return resp.json();
}

const tools = () => [
  {
    name: 'whatsapp_send_text',
    description: 'Send a text message to a WhatsApp number (E.164)',
    inputSchema: { type: 'object', properties: { to: { type: 'string' }, text: { type: 'string' } }, required: ['to', 'text'] },
    invoke: async ({ to, text }) => waFetch('messages', { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } })
  }
];

new JsonRpcServer({ toolsProvider: tools, onInitialize: () => ({ name: 'whatsapp-mcp' }) });
