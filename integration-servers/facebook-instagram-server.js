#!/usr/bin/env node
// Facebook & Instagram (Meta Graph) MCP server. Requires META_TOKEN.
const { JsonRpcServer } = require('./base-jsonrpc-server.js');

async function metaGet(path) {
  const token = process.env.META_TOKEN;
  if (!token) throw new Error('Missing META_TOKEN');
  const url = `https://graph.facebook.com/v19.0${path}${path.includes('?') ? '&' : '?'}access_token=${token}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Meta API error ' + resp.status + ' ' + await resp.text());
  return resp.json();
}

const tools = () => [
  {
    name: 'facebook_page_insights',
    description: 'Fetch basic page insights (page id required)',
    inputSchema: { type: 'object', properties: { page_id: { type: 'string' } }, required: ['page_id'] },
    invoke: async ({ page_id }) => metaGet(`/${page_id}/insights?metric=page_impressions_unique,page_post_engagements&period=day`)
  },
  {
    name: 'instagram_user_media',
    description: 'List recent Instagram business account media (ig user id)',
    inputSchema: { type: 'object', properties: { ig_user_id: { type: 'string' }, limit: { type: 'number', default: 5 } }, required: ['ig_user_id'] },
    invoke: async ({ ig_user_id, limit = 5 }) => metaGet(`/${ig_user_id}/media?fields=id,caption,media_type,media_url,timestamp&limit=${limit}`)
  }
];

new JsonRpcServer({ toolsProvider: tools, onInitialize: () => ({ name: 'facebook-instagram-mcp' }) });
