#!/usr/bin/env node
// LinkedIn MCP server.
// Herramientas:
//  - linkedin_generate_auth_url: genera URL OAuth2 para usuario.
//  - linkedin_exchange_code: intercambia ?code= por access token (devolver, NO persiste salvo que configures).
//  - linkedin_profile: obtiene perfil básico.
//  - linkedin_post_text: publica un post de texto simple en el perfil del usuario autenticado.
// Requisitos:
//  Variables de entorno:
//   LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_REDIRECT_URI
//   LINKEDIN_ACCESS_TOKEN (access token obtenido) (opcional si usarás exchange_code primero)
//   LINKEDIN_SCOPES (opcional, por defecto: r_liteprofile w_member_social)
// NOTA: Para producción conviene almacenar/renovar tokens (refresh tokens) y no exponerlos en texto plano.

const { JsonRpcServer } = require('./base-jsonrpc-server.js');
const querystring = require('node:querystring');

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error('Missing required env ' + name);
  return v;
}

async function linkedinApi(path, { method = 'GET', body } = {}) {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  if (!token) throw new Error('Missing LINKEDIN_ACCESS_TOKEN (usa linkedin_exchange_code o configura manualmente)');
  const url = (path.startsWith('http') ? path : 'https://api.linkedin.com/v2' + path);
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
  if (method !== 'GET' && body === undefined) body = {}; // ensure body object if needed
  const resp = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error('LinkedIn API error ' + resp.status + ' ' + txt);
  }
  if (resp.status === 204) return { ok: true };
  return resp.json();
}

function buildAuthUrl() {
  const clientId = requireEnv('LINKEDIN_CLIENT_ID');
  const redirect = requireEnv('LINKEDIN_REDIRECT_URI');
  const scopes = (process.env.LINKEDIN_SCOPES || 'r_liteprofile w_member_social').split(/[,\s]+/).filter(Boolean).join(' ');
  const state = Math.random().toString(36).slice(2, 10); // simple anti-CSRF token
  const params = querystring.stringify({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirect,
    scope: scopes,
    state
  });
  return { url: `https://www.linkedin.com/oauth/v2/authorization?${params}`, state, scopes };
}

async function exchangeCode(code) {
  const clientId = requireEnv('LINKEDIN_CLIENT_ID');
  const clientSecret = requireEnv('LINKEDIN_CLIENT_SECRET');
  const redirect = requireEnv('LINKEDIN_REDIRECT_URI');
  const body = querystring.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: clientId, client_secret: clientSecret });
  const resp = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!resp.ok) throw new Error('Token exchange failed ' + resp.status + ' ' + await resp.text());
  const json = await resp.json();
  // json: { access_token, expires_in }
  return json;
}

async function getAuthorUrn() {
  const me = await linkedinApi('/me'); // returns { id, localizedFirstName, ... }
  if (!me.id) throw new Error('No id in /me response');
  return 'urn:li:person:' + me.id;
}

async function postText(content) {
  const author = await getAuthorUrn();
  const body = {
    author,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: content.slice(0, 2950) },
        shareMediaCategory: 'NONE'
      }
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
  };
  // Endpoint ugcPosts (legacy v2). Newer API may use /rest/posts (requires different schema). Mantener simple aquí.
  const res = await linkedinApi('/ugcPosts', { method: 'POST', body });
  return { post: res, note: 'Si falla, revisa que la app tenga w_member_social aprobada y que uses UGC API.' };
}

const tools = () => [
  {
    name: 'linkedin_generate_auth_url',
    description: 'Genera la URL de autorización OAuth2 para LinkedIn (abre en el navegador y autoriza).',
    inputSchema: { type: 'object', properties: {} },
    invoke: async () => buildAuthUrl()
  },
  {
    name: 'linkedin_exchange_code',
    description: 'Intercambia el parámetro ?code= recibido tras la autorización por un access token (devuelve el token).',
    inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
    invoke: async ({ code }) => exchangeCode(code)
  },
    {
      name: 'linkedin_profile',
      description: 'Obtiene el perfil básico del usuario autenticado (/me).',
      inputSchema: { type: 'object', properties: {} },
      invoke: async () => linkedinApi('/me')
    },
    {
      name: 'linkedin_post_text',
      description: 'Publica un post de texto simple en tu perfil.',
      inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'Contenido del post' } }, required: ['text'] },
      invoke: async ({ text }) => postText(text)
    }
];

new JsonRpcServer({ toolsProvider: tools, onInitialize: () => ({ name: 'linkedin-mcp' }) });
