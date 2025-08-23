import keytar from 'keytar';
import { app } from 'electron';

// Secure storage for MCP server secrets (tokens, API keys). Values never written to JSON config.
export class McpSecretStore {
  private serviceName: string;
  constructor() {
    const base = app.getName() || 'ollama-chat';
    this.serviceName = `${base}-mcp-secret`;
  }
  private key(serverId: string, varName: string) {
    return `${serverId}:${varName}`;
  }
  async set(serverId: string, varName: string, value?: string): Promise<void> {
    try {
      const k = this.key(serverId, varName);
      if (!value) await keytar.deletePassword(this.serviceName, k); else await keytar.setPassword(this.serviceName, k, value);
    } catch (e) {
      console.error('[McpSecretStore] set error', serverId, varName, e);
    }
  }
  async get(serverId: string, varName: string): Promise<string | undefined> {
    try { return await keytar.getPassword(this.serviceName, this.key(serverId, varName)) || undefined; } catch { return undefined; }
  }
  async has(serverId: string, varName: string): Promise<boolean> { return (await this.get(serverId, varName)) !== undefined; }
  async list(serverId: string, varNames: string[]): Promise<Record<string, string | undefined>> {
    const out: Record<string, string | undefined> = {}; for (const v of varNames) out[v] = await this.get(serverId, v); return out;
  }
}
export const mcpSecretStore = new McpSecretStore();
