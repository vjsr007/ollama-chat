// Directory of known MCP servers/packages with metadata.
// This is a static starter list; extend as needed.
export interface McpDirectoryEntry {
  id: string;                 // unique id / slug
  package: string;            // npm package name (for npx install)
  name: string;               // human readable name
  description: string;        // short description
  website?: string;           // homepage or docs URL
  repo?: string;              // repository URL
  reliability: number;        // 1-5 (subjective/stub until telemetry available)
  tags?: string[];
  command?: string;           // override command (default npx <package>)
  args?: string[];            // default args if required
  notes?: string;             // extra notes / warnings
}

export const mcpDirectory: McpDirectoryEntry[] = [
  {
    id: 'filesystem',
    package: '@modelcontextprotocol/server-filesystem',
    name: 'Filesystem Server',
    description: 'Browse and read files from the local filesystem (sandbox as configured).',
    website: 'https://github.com/modelcontextprotocol/servers',
    repo: 'https://github.com/modelcontextprotocol/servers',
    reliability: 5,
    tags: ['official','fs']
  },
  {
    id: 'git',
    package: '@modelcontextprotocol/server-git',
    name: 'Git Server',
    description: 'Interact with Git repositories (log, diff, list files).',
    website: 'https://github.com/modelcontextprotocol/servers',
    repo: 'https://github.com/modelcontextprotocol/servers',
    reliability: 5,
    tags: ['official','git']
  },
  {
    id: 'openapi',
    package: '@modelcontextprotocol/server-openapi',
    name: 'OpenAPI Server',
    description: 'Expose an OpenAPI described HTTP API as MCP tools.',
    website: 'https://github.com/modelcontextprotocol/servers/tree/main/openapi',
    repo: 'https://github.com/modelcontextprotocol/servers',
    reliability: 4,
    tags: ['official','api']
  },
  {
    id: 'postgres',
    package: '@modelcontextprotocol/server-postgres',
    name: 'Postgres Server',
    description: 'Query PostgreSQL databases safely.',
    website: 'https://github.com/modelcontextprotocol/servers',
    repo: 'https://github.com/modelcontextprotocol/servers',
    reliability: 4,
    tags: ['official','db']
  },
  {
    id: 'sqlite',
    package: '@modelcontextprotocol/server-sqlite',
    name: 'SQLite Server',
    description: 'Query local SQLite databases.',
    website: 'https://github.com/modelcontextprotocol/servers',
    repo: 'https://github.com/modelcontextprotocol/servers',
    reliability: 4,
    tags: ['official','db']
  },
  {
    id: 'playwright',
  // The official @modelcontextprotocol/server-playwright package does NOT exist (404).
  // We provide a bundled local integration server instead. The npm package "playwright" is
  // only a runtime dependency (browsers + API). So `package` here refers to dependency to install.
  package: 'playwright',
  name: 'Playwright Server (Local)',
  description: 'Local Playwright integration (Chromium/Firefox/WebKit automation & scraping).',
  website: 'https://playwright.dev',
  repo: 'https://github.com/microsoft/playwright',
  reliability: 4,
  tags: ['local','browser','automation'],
  command: 'node',
  args: ['integration-servers/playwright-server.js'],
  notes: 'Installs the playwright dependency (npm i playwright). After install run: npx playwright install (once) to download browsers.'
  },
  {
    id: 'puppeteer',
    package: 'puppeteer',
    name: 'Puppeteer Server (Local)',
    description: 'Local Puppeteer integration (Chromium automation & scraping).',
    website: 'https://pptr.dev',
    repo: 'https://github.com/puppeteer/puppeteer',
    reliability: 4,
    tags: ['local','browser','automation'],
    command: 'node',
    args: ['integration-servers/puppeteer-server.js'],
    notes: 'Installs puppeteer dependency (npm i puppeteer). Uses bundled local MCP server.'
  },
  {
    id: 'fetch',
    package: '@modelcontextprotocol/server-fetch',
    name: 'Fetch Server',
    description: 'Perform HTTP requests (GET/POST) and return responses.',
    website: 'https://github.com/modelcontextprotocol/servers',
    repo: 'https://github.com/modelcontextprotocol/servers',
    reliability: 4,
    tags: ['official','http']
  },
  {
    id: 'brave-search',
    package: '@modelcontextprotocol/server-brave-search',
    name: 'Brave Search Server',
    description: 'Search the web via Brave Search API.',
    website: 'https://github.com/modelcontextprotocol/servers',
    repo: 'https://github.com/modelcontextprotocol/servers',
    reliability: 4,
    tags: ['official','search'],
    notes: 'Requires BRAVE_API_KEY environment variable.'
  }
];

export function searchMcpDirectory(term: string): McpDirectoryEntry[] {
  const t = term.trim().toLowerCase();
  if (!t) return mcpDirectory;
  return mcpDirectory.filter(e =>
    e.name.toLowerCase().includes(t) ||
    e.package.toLowerCase().includes(t) ||
    e.description.toLowerCase().includes(t) ||
    (e.tags || []).some(tag => tag.toLowerCase().includes(t))
  );
}
