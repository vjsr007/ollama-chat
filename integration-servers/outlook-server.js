#!/usr/bin/env node
// Outlook (Microsoft Graph) MCP server. Requires env OUTLOOK_TOKEN (Bearer access token with Mail.Read scope).
const { JsonRpcServer } = require('./base-jsonrpc-server.js');

async function graphFetch(path) {
  const token = process.env.OUTLOOK_TOKEN;
  if (!token) throw new Error('Missing OUTLOOK_TOKEN environment variable');
  const resp = await fetch('https://graph.microsoft.com/v1.0' + path, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error('Graph error ' + resp.status + ' ' + await resp.text());
  return resp.json();
}

const tools = () => [
  {
    name: 'outlook_list_messages',
    description: 'List recent messages in a folder (default Inbox)',
    inputSchema: { type: 'object', properties: { folder: { type: 'string', description: 'Mail folder display name', default: 'Inbox' }, top: { type: 'number', default: 5 } } },
    invoke: async ({ folder = 'Inbox', top = 5 }) => {
      const mail = await graphFetch(`/me/mailFolders?$select=id,displayName`);
      const f = mail.value.find(m => m.displayName === folder) || mail.value[0];
      const msgs = await graphFetch(`/me/mailFolders/${f.id}/messages?$top=${top}&$select=subject,from,receivedDateTime`);
      return { folder: f.displayName, messages: msgs.value.map(m => ({ subject: m.subject, from: m.from?.emailAddress?.address, received: m.receivedDateTime })) };
    }
  }
];

new JsonRpcServer({ toolsProvider: tools, onInitialize: () => ({ name: 'outlook-mcp' }) });
