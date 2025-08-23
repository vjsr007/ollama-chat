// Lightweight JSON-RPC 2.0 helper for MCP-like servers over stdio (CommonJS).
// Implements minimal subset: initialize, tools/list, tools/call.
function JsonRpcServer(opts) {
  this.toolsProvider = opts.toolsProvider; // () => tool definitions
  this.onInitialize = opts.onInitialize || function () { return {}; };
  setup.call(this);
}

function setup() {
  process.stdin.setEncoding('utf8');
  let buffer = '';
  process.stdin.on('data', chunk => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try { handleMessage.call(this, JSON.parse(line)); }
      catch (e) { write({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: ' + e.message } }); }
    }
  });
}

function write(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

function handleMessage(msg) {
  if (msg.method === 'initialize') {
    const info = this.onInitialize(msg.params || {});
    write({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: info.name || 'integration-server', version: '0.1.0' } } });
    return;
  }
  if (msg.method === 'tools/list') {
    const tools = this.toolsProvider();
    write({ jsonrpc: '2.0', id: msg.id, result: { tools } });
    return;
  }
  if (msg.method === 'tools/call') {
    const params = msg.params || {};
    const name = params.name;
    const args = params.arguments || {};
    const tool = (this.toolsProvider() || []).find(t => t.name === name);
    if (!tool) { write({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Tool not found: ' + name } }); return; }
    Promise.resolve().then(() => tool.invoke(args))
      .then(result => write({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } }))
      .catch(err => write({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: err.message } }));
    return;
  }
  write({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
}

module.exports = { JsonRpcServer };
