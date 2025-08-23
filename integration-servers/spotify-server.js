#!/usr/bin/env node
// Spotify MCP server. Requires SPOTIFY_TOKEN (Bearer access token). For production implement full OAuth refresh.
const { JsonRpcServer } = require('./base-jsonrpc-server.js');

async function spotifyFetch(path) {
  const token = process.env.SPOTIFY_TOKEN;
  if (!token) throw new Error('Missing SPOTIFY_TOKEN');
  const resp = await fetch('https://api.spotify.com/v1' + path, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error('Spotify error ' + resp.status + ' ' + await resp.text());
  return resp.json();
}

const tools = () => [
  {
    name: 'spotify_search_tracks',
    description: 'Search tracks by query',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number', default: 5 } }, required: ['query'] },
    invoke: async ({ query, limit = 5 }) => {
      const data = await spotifyFetch(`/search?type=track&limit=${limit}&q=${encodeURIComponent(query)}`);
      return (data.tracks?.items || []).map(t => ({ name: t.name, artists: t.artists.map(a => a.name).join(', '), album: t.album?.name, url: t.external_urls?.spotify }));
    }
  }
];

new JsonRpcServer({ toolsProvider: tools, onInitialize: () => ({ name: 'spotify-mcp' }) });
