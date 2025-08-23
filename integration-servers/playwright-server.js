#!/usr/bin/env node
// Playwright MCP server (basic). Requires playwright installed (npm i playwright) and browsers installed.
const { JsonRpcServer } = require('./base-jsonrpc-server.js');
let playwright; let pwAvailable = true;
try { playwright = require('playwright'); } catch { pwAvailable = false; }

const tools = () => [
  {
    name: 'pw_navigate_get_title',
    description: 'Open a page (Chromium) at URL and return its title',
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'Page URL' } }, required: ['url'] },
    invoke: async ({ url }) => {
      if (!pwAvailable) throw new Error('Playwright not installed. Run: npm install playwright');
      const browser = await playwright.chromium.launch({ headless: true });
      try { const page = await browser.newPage(); await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); return { url, title: await page.title() }; }
      finally { await browser.close(); }
    }
  }
];

new JsonRpcServer({ toolsProvider: tools, onInitialize: () => ({ name: 'playwright-mcp' }) });
