#!/usr/bin/env node
// Wrapper to run the original process-control MCP server from source path when packaged.
import path from 'path';
import { pathToFileURL } from 'url';

const candidatePaths = [
  path.join(process.cwd(), 'dist', 'shared', 'infrastructure', 'mcp', 'servers', 'process-control-server.js'),
  path.join(process.cwd(), 'src', 'shared', 'infrastructure', 'mcp', 'servers', 'process-control-server.js'),
  path.join(process.resourcesPath || '', 'app', 'dist', 'shared', 'infrastructure', 'mcp', 'servers', 'process-control-server.js'),
  path.join(process.resourcesPath || '', 'dist', 'shared', 'infrastructure', 'mcp', 'servers', 'process-control-server.js')
].filter(Boolean);

let loaded = false;
for (const p of candidatePaths) {
  try {
    await import(pathToFileURL(p).href);
    loaded = true;
    break;
  } catch (e) {
    // continue
  }
}

if (!loaded) {
  console.error('Failed to locate original process-control-server.js');
  process.exit(1);
}
