import React, { useState, useEffect } from 'react';
import ArgumentEditor from './ArgumentEditor';

interface McpTool {
  name: string;
  description: string;
  schema: Record<string, {
    type: string;
    required?: boolean;
    description?: string;
    enum?: string[];
    default?: any;
  }>;
  origin?: string;
}

interface McpServer {
  id: string;
  name: string;
  type: 'stdio' | 'ws' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  enabled: boolean;
  auto_restart?: boolean;
  status?: 'stopped' | 'starting' | 'ready' | 'error' | 'connecting' | 'closed';
  secretEnvKeys?: string[];
}

interface McpToolCall {
  tool: string;
  args: Record<string, any>;
  serverId?: string;
}

interface McpToolsProps {
  onToolCall: (call: McpToolCall) => void;
}

// Extend window.mcp type locally for new methods added in preload
interface ExtendedMcpApi {
  getTools: () => Promise<McpTool[]>;
  callTool: (call: McpToolCall) => Promise<any>;
  getServers: () => Promise<McpServer[]>;
  addServer: (config: any) => Promise<any>;
  startServer: (id: string) => Promise<any>;
  stopServer: (id: string) => Promise<any>;
  removeServer: (id: string) => Promise<any>;
  getServerTools: (serverId: string) => Promise<any>;
  reloadConfig: () => Promise<{ success: boolean }>;
  getConfigPath: () => Promise<{ success: boolean; path?: string; error?: string }>;
  updateServerConfig: (id: string, updates: any) => Promise<any>;
  setServerSecret: (id: string, key: string, value: string) => Promise<any>;
  getServerConfig: (id: string) => Promise<any>;
}

export const McpTools: React.FC<McpToolsProps> = ({ onToolCall }) => {
  const [tools, setTools] = useState<McpTool[]>([]);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [selectedTool, setSelectedTool] = useState<string>('');
  const [toolArgs, setToolArgs] = useState<Record<string, any>>({});
  const [showAddServer, setShowAddServer] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [isExecuting, setIsExecuting] = useState(false);
  
  // State for tool history and suggestions
  const [toolHistory, setToolHistory] = useState<McpToolCall[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  
  const [newServer, setNewServer] = useState({
    name: '',
    type: 'stdio' as const,
    command: '',
    args: '',
    enabled: true
  });

  const [configPath, setConfigPath] = useState<string>('');
  const [loadingConfigPath, setLoadingConfigPath] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [missingReport, setMissingReport] = useState<string[]>([]);
  const [packageScan, setPackageScan] = useState<{running: boolean; results: any[]}>({running: false, results: []});
  const [installing, setInstalling] = useState<boolean>(false);
  const [configuringServer, setConfiguringServer] = useState<McpServer | null>(null);
  const [serverConfigState, setServerConfigState] = useState<{endpoint?: string; secrets: Record<string,string>; newSecretValues: Record<string,string>}>({endpoint: '', secrets: {}, newSecretValues: {}});
  const [serverMetadata, setServerMetadata] = useState<any | null>(null);
  const [metadataLoading, setMetadataLoading] = useState<string | null>(null);
  const [depCheckingServer, setDepCheckingServer] = useState<string | null>(null);
  const [depInstallingServer, setDepInstallingServer] = useState<string | null>(null);

  useEffect(() => {
    loadTools();
    loadServers();
    loadToolHistory();
    // Subscribe to real-time tool updates
    (window as any).mcp?.onToolsUpdated?.((payload: any) => {
      console.log('[McpTools] 🔄 tools-updated event:', payload?.reason, payload?.toolsCount);
      if (Array.isArray(payload?.tools)) {
        setTools(payload.tools);
      } else {
        loadTools();
      }
    });
  }, []);

  const loadToolHistory = () => {
    try {
      const savedHistory = localStorage.getItem('ollama-chat-tool-history');
      if (savedHistory) {
        setToolHistory(JSON.parse(savedHistory));
      }
    } catch (error) {
      console.error('Error loading tool history:', error);
    }
  };

  const loadTools = async () => {
    try {
      const toolsList = await window.mcp.getTools();
      setTools(toolsList);
    } catch (error) {
      console.error('Failed to load tools:', error);
    }
  };

  const loadServers = async () => {
    try {
      const serversList = await window.mcp.getServers();
      setServers(serversList);
    } catch (error) {
      console.error('Failed to load servers:', error);
    }
  };

  const fetchConfigPath = async () => {
    setLoadingConfigPath(true);
    try {
  const result = await (window.mcp as unknown as ExtendedMcpApi).getConfigPath();
  if (result.success && result.path) setConfigPath(result.path);
    } catch (e) {
      console.error('Failed to get config path', e);
    } finally {
      setLoadingConfigPath(false);
    }
  };

  const reloadConfig = async () => {
    setReloading(true);
    try {
  await (window.mcp as unknown as ExtendedMcpApi).reloadConfig();
      await loadServers();
      await loadTools();
    } catch (e) {
      console.error('Failed to reload MCP config', e);
    } finally {
      setReloading(false);
    }
  };

  const detectMissing = async () => {
    try {
      await loadServers();
      const list = await window.mcp.getServers();
      const problems: string[] = [];
      list.forEach(s => {
        if (s.name?.includes('missing') || (s as any).missing) problems.push(`${s.name}: placeholder`);
        if (s.command === 'npx' && s.args && s.args[0]?.startsWith('@modelcontextprotocol/server-')) {
          // heuristic: if package not installed globally, invocation may be slow/fail but we can't check directly here
        }
      });
      setMissingReport(problems);
    } catch (e) {
      console.error('Detect missing failed', e);
    }
  };

  const checkPackages = async () => {
    setPackageScan({ running: true, results: [] });
    try {
      const resp = await (window.mcp as unknown as ExtendedMcpApi & { checkPackages: () => Promise<any> }).checkPackages();
      if (resp.success) setPackageScan({ running: false, results: resp.results }); else setPackageScan({ running: false, results: [] });
    } catch (e) {
      console.error('Package check failed', e);
      setPackageScan({ running: false, results: [] });
    }
  };

  const installMissing = async () => {
    if (!packageScan.results.length) return;
    const missing = packageScan.results.filter(r => r.status === 'missing').map(r => r.package || r.id);
    if (!missing.length) return;
    setInstalling(true);
    try {
      const resp = await (window.mcp as any).installPackages(missing);
      console.log('Install resp', resp);
      await checkPackages();
    } catch (e) {
      console.error('Install failed', e);
    } finally {
      setInstalling(false);
    }
  };

  // Validate arguments before executing the tool
  const validateArguments = (tool: McpTool): { isValid: boolean; errors: Record<string, string> } => {
    const errors: Record<string, string> = {};
    
  // Ensure the tool has a valid schema
    if (!tool.schema || typeof tool.schema !== 'object') {
  return { isValid: true, errors: {} }; // If there's no schema, nothing to validate
    }
    
    for (const [argName, argDef] of Object.entries(tool.schema)) {
      const value = toolArgs[argName];
      
  // Check required arguments
      if (argDef.required && (value === undefined || value === null || value === '')) {
  errors[argName] = `${argName} is required`;
        continue;
      }
      
  // Validate type if value present
      if (value !== undefined && value !== null && value !== '') {
        switch (argDef.type) {
          case 'number':
            if (isNaN(Number(value))) {
              errors[argName] = `${argName} must be a number`;
            }
            break;
          case 'boolean':
            if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
              errors[argName] = `${argName} must be true or false`;
            }
            break;
          case 'array':
            if (!Array.isArray(value)) {
              errors[argName] = `${argName} must be an array`;
            }
            break;
          case 'object':
            if (typeof value !== 'object' || Array.isArray(value)) {
              errors[argName] = `${argName} must be an object`;
            }
            break;
        }
      }
    }
    
    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  };

  const handleToolCall = async () => {
    if (!selectedTool) return;
    
    const tool = tools.find(t => t.name === selectedTool);
    if (!tool) return;

  // Validate arguments
    const validation = validateArguments(tool);
    setValidationErrors(validation.errors);
    
    if (!validation.isValid) {
  return; // Don't execute if there are validation errors
    }

    setIsExecuting(true);
    
    try {
      const serverId = tool.origin === 'builtin' ? undefined : servers.find(s => s.status === 'ready')?.id;
      
      const toolCall: McpToolCall = {
        tool: selectedTool,
        args: toolArgs,
        serverId
      };
      
  // Add to history
      addToToolHistory(toolCall);
      
      onToolCall(toolCall);
    } catch (error) {
      console.error('Error executing tool:', error);
    } finally {
      setIsExecuting(false);
    }
  };

  const addToToolHistory = (toolCall: McpToolCall) => {
    const newHistory = [toolCall, ...toolHistory.filter(h => 
      !(h.tool === toolCall.tool && JSON.stringify(h.args) === JSON.stringify(toolCall.args))
  )].slice(0, 20); // Keep last 20 executions
    
    setToolHistory(newHistory);
    localStorage.setItem('ollama-chat-tool-history', JSON.stringify(newHistory));
  };

  const loadFromHistory = (historyItem: McpToolCall) => {
    setSelectedTool(historyItem.tool);
    setToolArgs(historyItem.args);
    setShowHistory(false);
  };

  const addServer = async () => {
    try {
      const serverConfig = {
        name: newServer.name,
        type: newServer.type,
        command: newServer.command,
        args: newServer.args ? newServer.args.split(' ') : [],
        enabled: newServer.enabled
      };
      
      await window.mcp.addServer(serverConfig);
      setShowAddServer(false);
      setNewServer({ name: '', type: 'stdio', command: '', args: '', enabled: true });
      loadServers();
      loadTools();
    } catch (error) {
      console.error('Failed to add server:', error);
    }
  };

  const toggleServer = async (id: string, currentStatus?: string) => {
    try {
      if (currentStatus === 'ready') {
        await window.mcp.stopServer(id);
      } else {
        await window.mcp.startServer(id);
      }
      loadServers();
      loadTools();
    } catch (error) {
      console.error('Failed to toggle server:', error);
    }
  };

  const removeServer = async (id: string) => {
    try {
      await window.mcp.removeServer(id);
      loadServers();
      loadTools();
    } catch (error) {
      console.error('Failed to remove server:', error);
    }
  };

  const fetchServerMetadata = async (id: string) => {
    setMetadataLoading(id);
    try {
      const resp = await (window.mcp as any).getServerMetadata(id);
      if (resp.success) setServerMetadata(resp.metadata); else setServerMetadata({ error: resp.error });
    } catch (e) { setServerMetadata({ error: e instanceof Error ? e.message : String(e) }); }
    finally { setMetadataLoading(null); }
  };

  const checkServerDeps = async (id: string) => {
    setDepCheckingServer(id);
    try {
      const resp = await (window.mcp as any).checkServerDeps(id);
      if (resp.success && serverMetadata && serverMetadata.id === id) {
        setServerMetadata({ ...serverMetadata, depCheck: resp.results });
      }
    } catch (e) { console.error(e); }
    finally { setDepCheckingServer(null); }
  };

  const installServerDeps = async (id: string) => {
    setDepInstallingServer(id);
    try {
      const resp = await (window.mcp as any).installServerDeps(id);
      if (resp.success) {
        // Re-check deps after install
        await checkServerDeps(id);
      }
    } catch (e) { console.error(e); }
    finally { setDepInstallingServer(null); }
  };

  const openConfigure = async (server: McpServer) => {
    try {
      const resp = await (window.mcp as unknown as ExtendedMcpApi).getServerConfig(server.id);
      if (resp.success) {
        let secrets: Record<string,string> = resp.secrets || {};
        // Heuristic: if no secret keys defined, propose defaults based on server name
        if (Object.keys(secrets).length === 0) {
          const n = server.name.toLowerCase();
          const suggested: string[] = [];
          if (n.includes('telegram')) suggested.push('TELEGRAM_BOT_TOKEN');
          if (n.includes('whatsapp')) { suggested.push('WHATSAPP_TOKEN'); suggested.push('WHATSAPP_PHONE_ID'); }
            if (n.includes('facebook') || n.includes('instagram') || n.includes('meta')) suggested.push('META_TOKEN');
            if (n.includes('spotify')) suggested.push('SPOTIFY_TOKEN');
            if (n.includes('outlook') || n.includes('graph')) suggested.push('OUTLOOK_TOKEN');
            if (n.includes('playwright')) suggested.push('PLAYWRIGHT_WS_ENDPOINT');
          if (suggested.length) {
            secrets = Object.fromEntries(suggested.map(k => [k, '']));
          }
        }
        setServerConfigState({
          endpoint: server.url || '',
            secrets,
            newSecretValues: {}
        });
        setConfiguringServer(server);
      }
    } catch (e) {
      console.error('Failed to load server config', e);
    }
  };

  const saveServerConfig = async () => {
    if (!configuringServer) return;
    const id = configuringServer.id;
    // Update endpoint/url + secret key list if needed
    const updates: any = {};
    if (serverConfigState.endpoint !== undefined) updates.url = serverConfigState.endpoint;
    // For now secrets are predefined heuristically: any existing plus newSecretValues keys
  const secretKeys = Array.from(new Set([...Object.keys(serverConfigState.secrets), ...Object.keys(serverConfigState.newSecretValues)]));
    updates.secretEnvKeys = secretKeys;
    await (window.mcp as unknown as ExtendedMcpApi).updateServerConfig(id, updates);
    // Store any secret values user entered
    for (const [k, val] of Object.entries(serverConfigState.newSecretValues)) {
      if (val) await (window.mcp as unknown as ExtendedMcpApi).setServerSecret(id, k, val);
    }
    setConfiguringServer(null);
    loadServers();
  };

  const selectedToolSchema = (() => {
    const tool = tools.find(t => t.name === selectedTool);
    return tool?.schema && typeof tool.schema === 'object' ? tool.schema : {};
  })();

  return (
    <div className="mcp-tools">
      <div className="mcp-section">
        <div className="section-header">
          <h3>🛠️ Available Tools</h3>
          <span className="tool-count">{tools.length}</span>
        </div>
        <div className="config-actions-row">
          <button onClick={reloadConfig} disabled={reloading} title="Reload MCP configuration JSON files">
            {reloading ? '⏳ Reloading...' : '🔄 Reload Config'}
          </button>
          <button onClick={fetchConfigPath} disabled={loadingConfigPath} title="Show folder where MCP config JSON files live">
            📂 {loadingConfigPath ? 'Locating...' : 'Config Path'}
          </button>
          <button onClick={detectMissing} title="Detect missing / placeholder servers">🩺 Check Missing</button>
          <button onClick={checkPackages} disabled={packageScan.running} title="npm view each package">{packageScan.running ? '🔍 Scanning...' : '📦 Verify Packages'}</button>
          <button onClick={installMissing} disabled={installing || packageScan.running || !packageScan.results.some(r => r.status === 'missing')} title="Install all missing npm packages">
            {installing ? '⏳ Installing...' : '⬇️ Install Missing'}
          </button>
          {configPath && (
            <span className="config-path-label" title={configPath}>{configPath}</span>
          )}
        </div>
        {missingReport.length > 0 && (
          <div className="missing-report">
            <strong>Missing/Placeholder:</strong> {missingReport.join(', ')}
          </div>
        )}
        {packageScan.results.length > 0 && (
          <div className="missing-report">
            <strong>Package Status:</strong>
            <ul className="package-status-list">
              {packageScan.results.map(r => (
                <li key={r.package || r.id} className="package-status-item">
                  <span>{r.package || r.id}</span>
                  <span>{r.status === 'installed' ? '✅ installed' : '❌ missing'}</span>
                  {r.version && <span>@{r.version}</span>}
                  {r.status === 'missing' && !installing && (
                    <button className="btn-inline-install" onClick={async () => {
                      setInstalling(true);
                      try {
                        await (window.mcp as any).installPackages([r.package || r.id]);
                        await checkPackages();
                      } catch (e) { console.error(e); } finally { setInstalling(false); }
                    }}>Install</button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        
        <div className="tool-selection">
          <div className="tool-selector-container">
            <select 
              value={selectedTool} 
              onChange={(e) => {
                setSelectedTool(e.target.value);
                setToolArgs({});
                setValidationErrors({});
              }}
              className="tool-selector"
              title="Select MCP tool"
            >
              <option value="">Select tool...</option>
              {tools.map(tool => (
                <option key={tool.name} value={tool.name}>
                  {tool.name} {tool.origin === 'builtin' ? '🔧' : '🌐'}
                </option>
              ))}
            </select>
            
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="history-btn"
              title="Tool execution history"
              disabled={toolHistory.length === 0}
            >
              📋 {toolHistory.length}
            </button>
          </div>
          
          {/* Dropdown de historial */}
          {showHistory && toolHistory.length > 0 && (
            <div className="history-dropdown">
              <div className="history-header">
                <span>Recent Tool Executions</span>
                <button onClick={() => setShowHistory(false)} className="close-history">✕</button>
              </div>
              {toolHistory.map((item, index) => (
                <div key={index} className="history-item" onClick={() => loadFromHistory(item)}>
                  <div className="history-tool">🛠️ {item.tool}</div>
                  <div className="history-args">
                    {Object.keys(item.args).length > 0 
                      ? Object.entries(item.args).map(([key, value]) => 
                          `${key}: ${String(value).slice(0, 30)}${String(value).length > 30 ? '...' : ''}`
                        ).join(', ')
                      : 'No parameters'
                    }
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedTool && (
          <div className="tool-form">
            <div className="tool-info">
              <p className="tool-description">
                {tools.find(t => t.name === selectedTool)?.description}
              </p>
            </div>
            
            {selectedToolSchema && Object.keys(selectedToolSchema).length > 0 && 
              Object.entries(selectedToolSchema).map(([argName, argDef]) => (
                <div key={argName} className="argument-wrapper">
                  <ArgumentEditor
                    argName={argName}
                    argDef={argDef}
                    value={toolArgs[argName]}
                    onChange={(value) => {
                    setToolArgs(prev => ({
                      ...prev,
                      [argName]: value
                    }));
                    // Clear validation error when value changes
                    if (validationErrors[argName]) {
                      setValidationErrors(prev => {
                        const newErrors = { ...prev };
                        delete newErrors[argName];
                        return newErrors;
                      });
                    }
                  }}
                />
                {validationErrors[argName] && (
                  <div className="validation-error">
                    ⚠️ {validationErrors[argName]}
                  </div>
                )}
              </div>
            ))}
            
            {Object.keys(validationErrors).length > 0 && (
              <div className="validation-summary">
                <div className="validation-summary-header">
                  ⚠️ Validation errors:
                </div>
                <ul className="validation-list">
                  {Object.entries(validationErrors).map(([field, error]) => (
                    <li key={field}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
            
            <button 
              onClick={handleToolCall}
              className={`btn-tool-call ${Object.keys(validationErrors).length > 0 ? 'btn-disabled' : ''}`}
              disabled={!selectedTool || Object.keys(validationErrors).length > 0 || isExecuting}
            >
              {isExecuting ? '⏳ Executing...' : 'Execute Tool'}
            </button>
          </div>
        )}
      </div>

      <div className="mcp-section">
        <div className="section-header">
          <h3>🖥️ MCP Servers</h3>
          <button 
            onClick={() => setShowAddServer(true)}
            className="btn-add-server"
          >
            Add Server
          </button>
        </div>
        
        <div className="servers-list">
          {servers.map(server => (
            <div key={server.id} className={`server-item status-${server.status}`}>
              <div className="server-info">
                <div className="server-name">{server.name}</div>
                <div className="server-details">
                  <span className="server-type">{server.type}</span>
                  <span className={`server-status status-${server.status}`}>
                    {server.status || 'unknown'}
                  </span>
                </div>
                {server.command && (
                  <div className="server-command">{server.command}</div>
                )}
              </div>
              
              <div className="server-actions">
                <button
                  onClick={() => toggleServer(server.id, server.status)}
                  className={`btn-toggle ${server.status === 'ready' ? 'btn-stop' : 'btn-start'}`}
                >
                  {server.status === 'ready' ? 'Stop' : 'Start'}
                </button>
                <button
                  onClick={() => fetchServerMetadata(server.id)}
                  className="btn-configure"
                  title="Metadata"
                  disabled={metadataLoading === server.id}
                >
                  {metadataLoading === server.id ? '…' : 'Info'}
                </button>
                <button
                  onClick={() => openConfigure(server)}
                  className="btn-configure"
                  title="Configure tokens / endpoint"
                >
                  Config
                </button>
                <button
                  onClick={() => removeServer(server.id)}
                  className="btn-remove"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          
          {servers.length === 0 && (
            <div className="no-servers">
              No servers configured. Add one to get started.
            </div>
          )}
        </div>
      </div>

      {showAddServer && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Add MCP Server</h3>
              <button 
                onClick={() => setShowAddServer(false)}
                className="modal-close"
              >
                ✕
              </button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Name</label>
                <input
                  type="text"
                  placeholder="Server name"
                  value={newServer.name}
                  onChange={(e) => setNewServer(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>
              
              <div className="form-group">
                <label>Type</label>
                <select
                  value={newServer.type}
                  onChange={(e) => setNewServer(prev => ({ ...prev, type: e.target.value as any }))}
                  title="MCP server type"
                >
                  <option value="stdio">STDIO</option>
                  <option value="ws">WebSocket</option>
                  <option value="http">HTTP</option>
                </select>
              </div>
              
              <div className="form-group">
                <label>Command</label>
                <input
                  type="text"
                  placeholder="npx @modelcontextprotocol/server-filesystem"
                  value={newServer.command}
                  onChange={(e) => setNewServer(prev => ({ ...prev, command: e.target.value }))}
                />
              </div>
              
              <div className="form-group">
                <label>Arguments</label>
                <input
                  type="text"
                  placeholder="--port 8080"
                  value={newServer.args}
                  onChange={(e) => setNewServer(prev => ({ ...prev, args: e.target.value }))}
                />
              </div>
              
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={newServer.enabled}
                    onChange={(e) => setNewServer(prev => ({ ...prev, enabled: e.target.checked }))}
                  />
                  Enabled
                </label>
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowAddServer(false)} className="btn-cancel">
                Cancel
              </button>
              <button 
                onClick={addServer} 
                className="btn-add"
                disabled={!newServer.name || !newServer.command}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {configuringServer && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Configure: {configuringServer.name}</h3>
              <button onClick={() => setConfiguringServer(null)} className="modal-close">✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Endpoint / URL</label>
                <input value={serverConfigState.endpoint || ''} onChange={e => setServerConfigState(s => ({...s, endpoint: e.target.value}))} placeholder="https://api.example.com" />
              </div>
              {Object.keys(serverConfigState.secrets).length > 0 && (
                <div className="form-group">
                  <label>Secrets</label>
                  {Object.entries(serverConfigState.secrets).map(([k, v]) => (
                    <div key={k} className="secret-item">
                      <span className="secret-name">{k}</span>
                      <input type="password" placeholder={v === '__SECURE__' ? 'Stored' : 'Not set'} onChange={e => setServerConfigState(s => ({...s, newSecretValues: {...s.newSecretValues, [k]: e.target.value}}))} />
                    </div>
                  ))}
                </div>
              )}
              {Object.keys(serverConfigState.secrets).length === 0 && (
                <div className="hint">No secret keys defined for this server.</div>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={() => setConfiguringServer(null)} className="btn-cancel">Cancel</button>
              <button onClick={saveServerConfig} className="btn-add">Save</button>
            </div>
          </div>
        </div>
      )}

      {serverMetadata && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Server Metadata: {serverMetadata.name || serverMetadata.id}</h3>
              <button onClick={() => setServerMetadata(null)} className="modal-close">✕</button>
            </div>
            <div className="modal-body metadata-body">
              {serverMetadata.error && <div className="error">Error: {serverMetadata.error}</div>}
              {!serverMetadata.error && (
                <>
                  <div className="meta-row"><strong>ID:</strong> {serverMetadata.id}</div>
                  <div className="meta-row"><strong>Status:</strong> {serverMetadata.status}</div>
                  <div className="meta-row"><strong>Type:</strong> {serverMetadata.type}</div>
                  {serverMetadata.command && <div className="meta-row"><strong>Command:</strong> {serverMetadata.command} {serverMetadata.args?.join(' ')}</div>}
                  {serverMetadata.package && <div className="meta-row"><strong>Package:</strong> {serverMetadata.package} {serverMetadata.packageVersion ? `@${serverMetadata.packageVersion}` : serverMetadata.packageInstalled ? '(installed)' : '(not installed)'}</div>}
                  <div className="meta-row"><strong>Tools:</strong> {serverMetadata.toolCount} {serverMetadata.tools?.slice(0,15).join(', ')}{serverMetadata.tools?.length > 15 ? '…' : ''}</div>
                  {serverMetadata.envKeys && <div className="meta-row"><strong>Env Keys:</strong> {serverMetadata.envKeys.join(', ') || '—'}</div>}
                  {serverMetadata.secretEnvKeys && <div className="meta-row"><strong>Secret Keys:</strong> {serverMetadata.secretEnvKeys.join(', ') || '—'}</div>}
                  <div className="meta-row"><strong>PID:</strong> {serverMetadata.pid || '—'}</div>
                  <hr />
                  <div className="dep-actions">
                    <button disabled={depCheckingServer === serverMetadata.id} onClick={() => checkServerDeps(serverMetadata.id)}>
                      {depCheckingServer === serverMetadata.id ? 'Checking…' : 'Check Dependencies'}
                    </button>
                    <button disabled={depInstallingServer === serverMetadata.id} onClick={() => installServerDeps(serverMetadata.id)}>
                      {depInstallingServer === serverMetadata.id ? 'Installing…' : 'Install Dependencies'}
                    </button>
                  </div>
                  {serverMetadata.depCheck && (
                    <div className="dep-results">
                      {serverMetadata.depCheck.map((r:any) => (
                        <div key={r.package || r.id} className={`dep-item status-${r.status}`}>
                          {r.package || 'no-package'} → {r.status}{r.version ? ` @${r.version}`: ''}
                          {r.error && <span className="dep-error"> {r.error}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={() => setServerMetadata(null)} className="btn-cancel">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
