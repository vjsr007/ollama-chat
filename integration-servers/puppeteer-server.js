#!/usr/bin/env node
// Puppeteer MCP integration server (local) providing basic web automation & scraping tools.
// Uses a fresh browser per tool invocation for isolation. For higher performance you could implement session reuse.
const { JsonRpcServer } = require('./base-jsonrpc-server.js');
const fs = require('fs');
const path = require('path');
let puppeteer; let ppAvailable = true;
try { puppeteer = require('puppeteer'); } catch { ppAvailable = false; }

async function withBrowser(fn, { headless = true } = {}) {
  if (!ppAvailable) throw new Error('Puppeteer not installed. Run: npm install puppeteer');
  const browser = await puppeteer.launch({ headless });
  try { return await fn(browser); } finally { await browser.close(); }
}

function safeScriptWrap(script) {
  if (/return\s+/i.test(script)) return `(() => { try { ${script} } catch(e){ return { __pp_error: e.message }; } })()`;
  return `(() => { try { return (${script}); } catch(e){ return { __pp_error: e.message }; } })()`;
}

const tools = () => [
  {
    name: 'puppeteer_navigate_get_title',
    description: 'Open a page at URL and return its title',
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'Page URL' } }, required: ['url'] },
    invoke: async ({ url }) => withBrowser(async browser => {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      return { url, title: await page.title() };
    })
  },
  {
    name: 'puppeteer_screenshot',
    description: 'Navigate to a URL and capture a screenshot (PNG base64, optionally write file)',
    inputSchema: { type: 'object', properties: {
      url: { type: 'string' },
      fullPage: { type: 'boolean', default: false },
      selector: { type: 'string', description: 'If provided, screenshot only this selector' },
      waitSelector: { type: 'string', description: 'Wait for this selector before capture' },
      outputPath: { type: 'string', description: 'Optional absolute or relative path to save PNG' },
      ensureDir: { type: 'boolean', default: true }
    }, required: ['url'] },
    invoke: async ({ url, fullPage=false, selector, waitSelector, outputPath, ensureDir=true }) => withBrowser(async browser => {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      if (waitSelector) await page.waitForSelector(waitSelector, { timeout: 20000 });
      let buffer;
      if (selector) {
        const el = await page.$(selector);
        if (!el) throw new Error('Selector not found: '+selector);
        buffer = await el.screenshot();
      } else {
        buffer = await page.screenshot({ fullPage });
      }
      let savedPath = null;
      if (outputPath) {
        try {
          const finalPath = path.isAbsolute(outputPath) ? outputPath : path.join(process.cwd(), outputPath);
          const dir = path.dirname(finalPath);
          if (ensureDir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(finalPath, buffer);
          savedPath = finalPath;
        } catch (e) {
          return { url, fullPage, selector: selector||null, error: 'Failed to save screenshot: '+(e.message||e), screenshot_base64: buffer.toString('base64') };
        }
      }
      return { url, fullPage, selector: selector||null, saved_path: savedPath, screenshot_base64: buffer.toString('base64') };
    })
  },
  {
    name: 'puppeteer_get_html',
    description: 'Return page HTML (optionally after waiting for a selector)',
    inputSchema: { type: 'object', properties: {
      url: { type: 'string' },
      waitSelector: { type: 'string' }
    }, required: ['url'] },
    invoke: async ({ url, waitSelector }) => withBrowser(async browser => {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      if (waitSelector) await page.waitForSelector(waitSelector, { timeout: 20000 });
      const content = await page.content();
      return { url, html: content };
    })
  },
  {
    name: 'puppeteer_get_text',
    description: 'Extract innerText from selector(s) on a page',
    inputSchema: { type: 'object', properties: {
      url: { type: 'string' },
      selector: { type: 'string' },
      selectorAll: { type: 'string' }
    }, required: ['url'] },
    invoke: async ({ url, selector, selectorAll }) => withBrowser(async browser => {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const result = {};
      if (selector) {
        const el = await page.$(selector);
        result.text = el ? (await el.evaluate(n => n.innerText)) : null;
      }
      if (selectorAll) {
        const els = await page.$$(selectorAll);
        result.texts = [];
        for (const el of els) result.texts.push(await el.evaluate(n => n.innerText));
      }
      return { url, selector: selector||null, selectorAll: selectorAll||null, ...result };
    })
  },
  {
    name: 'puppeteer_eval_js',
    description: 'Evaluate JavaScript in the page context and return the JSON-serializable result',
    inputSchema: { type: 'object', properties: {
      url: { type: 'string' },
      script: { type: 'string', description: 'JS expression or function body returning data' }
    }, required: ['url','script'] },
    invoke: async ({ url, script }) => withBrowser(async browser => {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const wrapped = safeScriptWrap(script);
      const value = await page.evaluate(wrapped);
      if (value && value.__pp_error) throw new Error('Eval error: '+value.__pp_error);
      return { url, result: value };
    })
  },
  {
    name: 'puppeteer_wait_selector',
    description: 'Wait for a selector and optionally return its text and HTML',
    inputSchema: { type: 'object', properties: {
      url: { type: 'string' },
      selector: { type: 'string' },
      returnHtml: { type: 'boolean', default: false },
      returnText: { type: 'boolean', default: true },
      timeoutMs: { type: 'number', default: 30000 }
    }, required: ['url','selector'] },
    invoke: async ({ url, selector, returnHtml=false, returnText=true, timeoutMs=30000 }) => withBrowser(async browser => {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      const el = await page.waitForSelector(selector, { timeout: timeoutMs });
      if (!el) throw new Error('Selector not found after wait');
      const payload = { url, selector };
      if (returnText) payload.text = await el.evaluate(n => n.innerText);
      if (returnHtml) payload.html = await el.evaluate(n => n.outerHTML);
      return payload;
    })
  },
  {
    name: 'puppeteer_batch',
    description: 'Run multiple page actions sequentially (navigate once). Actions: get_text, screenshot, eval_js, wait_selector',
    inputSchema: { type: 'object', properties: {
      url: { type: 'string' },
      actions: { type: 'array', items: { type: 'object', properties: {
        type: { type: 'string', enum: ['get_text','screenshot','eval_js','wait_selector'] },
        selector: { type: 'string' },
        selectorAll: { type: 'string' },
        script: { type: 'string' },
        fullPage: { type: 'boolean' },
        waitSelector: { type: 'string' },
        returnHtml: { type: 'boolean' },
        returnText: { type: 'boolean' }
      }, required: ['type'] } }
    }, required: ['url','actions'] },
    invoke: async ({ url, actions }) => withBrowser(async browser => {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const results = [];
      for (const act of actions) {
        switch (act.type) {
          case 'get_text': {
            const res = {};
            if (act.selector) {
              const el = await page.$(act.selector);
              res.text = el ? await el.evaluate(n => n.innerText) : null;
            }
            if (act.selectorAll) {
              const els = await page.$$(act.selectorAll);
              res.texts = [];
              for (const el of els) res.texts.push(await el.evaluate(n => n.innerText));
            }
            results.push({ type: 'get_text', ...res });
            break;
          }
          case 'screenshot': {
            if (act.waitSelector) await page.waitForSelector(act.waitSelector, { timeout: 20000 });
            let buf;
            if (act.selector) {
              const el = await page.$(act.selector);
              if (!el) throw new Error('Selector not found for screenshot');
              buf = await el.screenshot();
            } else {
              buf = await page.screenshot({ fullPage: !!act.fullPage });
            }
            results.push({ type: 'screenshot', selector: act.selector||null, screenshot_base64: buf.toString('base64') });
            break;
          }
          case 'eval_js': {
            const wrapped = safeScriptWrap(act.script);
            const val = await page.evaluate(wrapped);
            if (val && val.__pp_error) throw new Error('Eval error: '+val.__pp_error);
            results.push({ type: 'eval_js', result: val });
            break;
          }
          case 'wait_selector': {
            const el = await page.waitForSelector(act.selector, { timeout: 30000 });
            results.push({ type: 'wait_selector', found: !!el });
            break;
          }
          default:
            throw new Error('Unknown action type: '+act.type);
        }
      }
      return { url, results };
    })
  }
];

new JsonRpcServer({ toolsProvider: tools, onInitialize: () => ({ name: 'puppeteer-mcp' }) });
