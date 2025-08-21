import React, { useState, useEffect } from 'react';

interface McpTool {
  name: string;
  description: string;
  schema: Record<string, {
    type: string;
    required?: boolean;
    description?: string;
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
}

interface McpToolCall {
  tool: string;
  args: Record<string, any>;
  serverId?: string;
}

interface McpToolsProps {
  onToolCall: (call: McpToolCall) => void;
}

export const McpTools: React.FC<McpToolsProps> = ({ onToolCall }) => {
  const [tools, setTools] = useState<McpTool[]>([]);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [selectedTool, setSelectedTool] = useState<string>('');
  const [toolArgs, setToolArgs] = useState<Record<string, any>>({});
  const [showAddServer, setShowAddServer] = useState(false);
  const [newServer, setNewServer] = useState({
    name: '',
    type: 'stdio' as const,
    command: '',
    args: '',
    enabled: true
  });

  useEffect(() => {
    loadTools();
    loadServers();
  }, []);

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

  const handleToolCall = async () => {
    if (!selectedTool) return;
    
    const tool = tools.find(t => t.name === selectedTool);
    if (!tool) return;

    const serverId = tool.origin === 'builtin' ? undefined : servers.find(s => s.status === 'ready')?.id;
    
    onToolCall({
      tool: selectedTool,
      args: toolArgs,
      serverId
    });
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

  const selectedToolSchema = tools.find(t => t.name === selectedTool)?.schema || {};

  return (
    <div className="mcp-tools">
      <div className="mcp-section">
        <div className="section-header">
          <h3>🛠️ Available Tools</h3>
          <span className="tool-count">{tools.length}</span>
        </div>
        
        <div className="tool-selection">
          <select 
            value={selectedTool} 
            onChange={(e) => {
              setSelectedTool(e.target.value);
              setToolArgs({});
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
        </div>

        {selectedTool && (
          <div className="tool-form">
            <div className="tool-info">
              <p className="tool-description">
                {tools.find(t => t.name === selectedTool)?.description}
              </p>
            </div>
            
            {Object.entries(selectedToolSchema).map(([argName, argDef]) => (
              <div key={argName} className="form-group">
                <label>
                  {argName} 
                  {argDef.required && <span className="required">*</span>}
                </label>
                <input
                  type="text"
                  placeholder={argDef.description}
                  value={toolArgs[argName] || ''}
                  onChange={(e) => setToolArgs(prev => ({
                    ...prev,
                    [argName]: e.target.value
                  }))}
                />
              </div>
            ))}
            
            <button 
              onClick={handleToolCall}
              className="btn-tool-call"
              disabled={!selectedTool}
            >
              Execute Tool
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
                <label>Tipo</label>
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
                  Habilitado
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
    </div>
  );
};
