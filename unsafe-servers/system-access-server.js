#!/usr/bin/env node
// Wrapper to run the original system-access MCP server from source path when packaged.
import path from 'path';
import { pathToFileURL } from 'url';

// Prefer source (development) path first so latest code (with truncation, aliases) is used when running from repo.
const candidatePaths = [
  path.join(process.cwd(), 'src', 'shared', 'infrastructure', 'mcp', 'servers', 'system-access-server.js'),
  path.join(process.cwd(), 'dist', 'shared', 'infrastructure', 'mcp', 'servers', 'system-access-server.js'),
  path.join(process.resourcesPath || '', 'app', 'dist', 'shared', 'infrastructure', 'mcp', 'servers', 'system-access-server.js'),
  path.join(process.resourcesPath || '', 'dist', 'shared', 'infrastructure', 'mcp', 'servers', 'system-access-server.js')
].filter(Boolean);

let loaded = false;
for (const p of candidatePaths) {
  try {
  await import(pathToFileURL(p).href);
  console.error('[system-access-wrapper] Loaded implementation from', p);
    loaded = true;
    break;
  } catch (e) {
    // continue
  }
}

if (!loaded) {
  console.error('Failed to locate original system-access-server.js');
  process.exit(1);
}
