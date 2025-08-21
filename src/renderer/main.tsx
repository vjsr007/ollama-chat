import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatMessage } from '../shared/domain/chat';
import { McpTools } from './components/McpTools';
import MessageContent from './components/MessageContent';
import ToolManager from './components/ToolManager';
import ModelManager from './components/ModelManager';
import type { McpToolCall, McpToolResult } from '../shared/domain/mcp';
import './styles.css';

const App: React.FC = () => {
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [imagePath, setImagePath] = useState<string | undefined>();
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.');
  const [activeTab, setActiveTab] = useState<'chat' | 'tools'>('chat');
  const [isToolManagerOpen, setIsToolManagerOpen] = useState(false);
  const [isModelManagerOpen, setIsModelManagerOpen] = useState(false);
  const [toolsStatus, setToolsStatus] = useState<{ enabled: number; total: number; limit: number } | null>(null);
  
  // States for history and autocompletion
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [availableTools, setAvailableTools] = useState<any[]>([]);
  
  const chatRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    window.ollama.listModels().then(ms => { setModels(ms); if (ms[0]) setModel(ms[0]); });
    
    // Load prompt history from localStorage
    const savedHistory = localStorage.getItem('ollama-chat-prompt-history');
    if (savedHistory) {
      try {
        const parsedHistory = JSON.parse(savedHistory);
        setPromptHistory(parsedHistory);
        console.log('📚 Loaded prompt history:', parsedHistory.length, 'items');
      } catch (error) {
        console.error('Error loading prompt history:', error);
      }
    } else {
      console.log('📚 No prompt history found in localStorage');
    }
    
    // Load available tools for autocompletion
    loadAvailableTools();
  }, []);

  // Reload tools when activeTab changes to ensure fresh data
  useEffect(() => {
    if (activeTab === 'chat') {
      loadAvailableTools();
    }
  }, [activeTab]);

  const loadAvailableTools = async () => {
    try {
      const toolsResponse = await (window as any).mcp?.getTools();
      if (toolsResponse && toolsResponse.tools) {
        setAvailableTools(toolsResponse.tools);
        console.log('🛠️ Loaded available tools:', toolsResponse.tools.length);
      } else if (toolsResponse && Array.isArray(toolsResponse)) {
        setAvailableTools(toolsResponse);
        console.log('🛠️ Loaded available tools (array):', toolsResponse.length);
      } else {
        console.warn('🛠️ No tools found in response:', toolsResponse);
      }
    } catch (error) {
      console.error('Error loading available tools:', error);
    }
  };

  // Load tool status when model changes
  useEffect(() => {
    if (model) {
      loadToolsStatus();
    }
  }, [model]);

  const loadToolsStatus = async () => {
    try {
      // Get all available tools
      const toolsResponse = await (window as any).electronAPI?.getAvailableTools();
      if (toolsResponse && toolsResponse.success) {
        const allTools = toolsResponse.tools;
        const enabledTools = allTools.filter((tool: any) => tool.enabled);
        
        // Get model limits
        const limitsResponse = await (window as any).electronAPI?.getModelLimits();
        const modelLimit = limitsResponse?.success 
          ? (limitsResponse.limits[model] || limitsResponse.limits['default'] || 25)
          : 25;

        setToolsStatus({
          enabled: enabledTools.length,
          total: allTools.length,
          limit: modelLimit
        });
      }
    } catch (error) {
      console.error('Error loading tools status:', error);
    }
  };

  // Functions to handle prompt history
  const addToHistory = (prompt: string) => {
    if (!prompt.trim()) return;
    
    const newHistory = [prompt, ...promptHistory.filter(p => p !== prompt)].slice(0, 50); // Keep last 50
    setPromptHistory(newHistory);
    localStorage.setItem('ollama-chat-prompt-history', JSON.stringify(newHistory));
    setHistoryIndex(-1);
    
    console.log('📝 Prompt added to history:', prompt);
    console.log('📚 History length:', newHistory.length);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // If suggestions are visible, handle them first
    if (showSuggestions) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
        return;
      }
      // Don't process other keys if suggestions are visible
      return;
    }
    
    // Handle history navigation only if no suggestions
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (promptHistory.length > 0 && historyIndex < promptHistory.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setInput(promptHistory[newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(promptHistory[newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInput('');
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setHistoryIndex(-1);
    }
  };

  const getToolSuggestions = () => {
    const text = input.toLowerCase();
    
    // Check if contains keywords for tools (even without space after)
    const hasUse = text.includes('use');
    const hasRun = text.includes('run');
    const hasExecute = text.includes('execute');
    
    if (!hasUse && !hasRun && !hasExecute) {
      return [];
    }
    
    console.log('🔍 Looking for tool suggestions, input:', input);
    console.log('🔍 Available tools count:', availableTools.length);
    
    // Get the word after the keyword
    let searchTerm = '';
    const useIndex = text.lastIndexOf('use');
    const runIndex = text.lastIndexOf('run');
    const executeIndex = text.lastIndexOf('execute');
    
    const maxIndex = Math.max(
      hasUse ? useIndex : -1,
      hasRun ? runIndex : -1, 
      hasExecute ? executeIndex : -1
    );
    
    if (maxIndex >= 0) {
      // Determine which command was used
      const command = hasExecute && executeIndex === maxIndex ? 'execute' :
                     hasUse && useIndex === maxIndex ? 'use' :
                     hasRun && runIndex === maxIndex ? 'run' : '';
      
      if (command) {
        const afterCommand = input.slice(maxIndex + command.length).trim();
        searchTerm = afterCommand;
      }
    }
    
    console.log('🔍 Search term:', searchTerm);
    
    if (searchTerm === '') {
      const result = availableTools.slice(0, 5); // Show first 5 tools if no search term
      console.log('🔍 Returning first 5 tools:', result.length);
      return result;
    }
    
    const filtered = availableTools.filter(tool => 
      tool.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tool.description?.toLowerCase().includes(searchTerm.toLowerCase())
    ).slice(0, 5);
    
    console.log('🔍 Filtered tools:', filtered.length);
    return filtered;
  };

  const insertToolSuggestion = (tool: any) => {
    const text = input;
    const lowerText = text.toLowerCase();
    
    const useIndex = lowerText.lastIndexOf('use');
    const runIndex = lowerText.lastIndexOf('run');
    const executeIndex = lowerText.lastIndexOf('execute');
    
    const maxIndex = Math.max(useIndex, runIndex, executeIndex);
    if (maxIndex >= 0) {
      // Determine which command was used
      const command = executeIndex === maxIndex ? 'execute' :
                     useIndex === maxIndex ? 'use' :
                     runIndex === maxIndex ? 'run' : '';
      
      if (command) {
        // Replace from command to end
        const beforeCommand = text.slice(0, maxIndex);
        let newText = beforeCommand + command + ' ' + tool.name;
        
        // If tool has required parameters, add placeholder
        if (tool.inputSchema?.properties && Object.keys(tool.inputSchema.properties).length > 0) {
          const requiredParams = Object.entries(tool.inputSchema.properties)
            .filter(([_, def]: [string, any]) => def.required)
            .map(([key, _]) => key);
          
          if (requiredParams.length > 0) {
            newText += ` {${requiredParams.join(', ')}}`;
          }
        }
        
        setInput(newText);
      }
    }
    
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const send = async () => {
    if (!input.trim() || !model) return;
    
    // Add to history
    addToHistory(input.trim());
    const baseMessages = messages.length === 0 && systemPrompt.trim()
      ? [{ role: 'system', content: systemPrompt } as ChatMessage, ...messages]
      : messages;
    const newMsg: ChatMessage = { role: 'user', content: input, imagePath };
    const newMessages = [...baseMessages, newMsg];
    setMessages(newMessages);
    setInput('');
    setImagePath(undefined);
    setIsLoading(true);
    
    try {
      console.log('🚀 UI: Sending chat request...');
      console.log('📝 UI: Messages being sent:', newMessages);
      console.log('🤖 UI: Model:', model);
      
      const reply = await window.ollama.sendChat({ model, messages: newMessages });
      
      console.log('📨 UI: Received reply from main process:', reply);
      console.log('📏 UI: Reply length:', reply?.length || 0);
      console.log('🔤 UI: Reply type:', typeof reply);
      
      if (!reply || reply.trim() === '') {
        console.warn('⚠️ UI: Empty or null reply received');
        setMessages([...newMessages, { 
          role: 'assistant', 
          content: '⚠️ Received empty response from AI model. Please try again.' 
        }]);
      } else {
        console.log('✅ UI: Adding reply to messages');
        setMessages([...newMessages, { role: 'assistant', content: reply }]);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setMessages([...newMessages, { 
        role: 'assistant', 
        content: `❌ Error: ${errorMessage}. Please check that Ollama is running and the model is available.` 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const pickImage = async () => {
    const p = await window.ollama.openImage();
    if (p) setImagePath(p);
  };

  const handleToolCall = async (call: McpToolCall) => {
    try {
      setIsLoading(true);
      const result: McpToolResult = await window.mcp.callTool(call);
      
      const toolMessage: ChatMessage = {
        role: 'system',
        content: `Tool executed: ${call.tool}\nResult: ${JSON.stringify(result.result || result.error, null, 2)}`
      };
      
      setMessages(prev => [...prev, toolMessage]);
      
      // Switch to chat tab to show result
      setActiveTab('chat');
    } catch (error) {
      console.error('Tool call failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app" role="main">
      <div className="topbar">
        <div className="logo"><span className="brand">Local</span> Ollama Chat</div>
        <div className="tab-buttons">
          <button 
            className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            💬 Chat
          </button>
          <button 
            className={`tab-btn ${activeTab === 'tools' ? 'active' : ''}`}
            onClick={() => setActiveTab('tools')}
          >
            🛠️ Tools
          </button>
          <button 
            className="tab-btn tool-manager-btn"
            onClick={() => setIsToolManagerOpen(true)}
            title="Manage available tools for the model"
          >
            ⚙️ Configure
          </button>
          <button 
            className="tab-btn model-manager-btn"
            onClick={() => setIsModelManagerOpen(true)}
            title="Manage external models (OpenAI, Anthropic, GitHub Copilot)"
          >
            🌐 Models
          </button>
          <button 
            className="tab-btn"
            onClick={() => {
              loadAvailableTools();
              loadToolsStatus();
            }}
            title="Refresh tools and status"
          >
            🔄 Refresh
          </button>
        </div>
        <div className="actions">
          <button onClick={() => setMessages([])} disabled={!messages.length || isLoading}>Clear</button>
        </div>
      </div>
      <div className="toolbar">
        <label htmlFor="modelSelect">Model:</label>
        <select id="modelSelect" value={model} onChange={e => setModel(e.target.value)} aria-label="Select model">
          {models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        
        {/* Tool status indicator */}
        {toolsStatus && (
          <div className="tools-status" title={`${toolsStatus.enabled} tools enabled of ${toolsStatus.total} available (limit: ${toolsStatus.limit})`}>
            🛠️ {toolsStatus.enabled}/{toolsStatus.total}
            {toolsStatus.enabled > toolsStatus.limit && (
              <span className="warning-indicator" title="Exceeds model limit">⚠️</span>
            )}
          </div>
        )}
        
        <button onClick={pickImage} aria-label="Attach image">📷 Image</button>
        {imagePath && (
          <span className="image-chip">{imagePath.split(/\\|\//).pop()} <button onClick={() => setImagePath(undefined)} aria-label="Remove image">✕</button></span>
        )}
      </div>
      
      {activeTab === 'chat' && (
        <>
          <div className="layout">
            <div className="chat-wrapper">
              <div className="scroll-fade-top" />
              <div className="scroll-fade-bottom" />
              <div ref={chatRef} className="chat" aria-live="polite">
                {messages.map((m,i) => (
                  <div key={i} className={`msg ${m.role}`}>
                    <span className="msg-role">{m.role}</span>
                    <div className="msg-content">
                      <MessageContent content={m.content} />
                    </div>
                    {m.imagePath && <div className="attachment">Attached image</div>}
                  </div>
                ))}
                {isLoading && <div className="msg assistant loading">Thinking...</div>}
              </div>
            </div>
            <aside className="side-panel" aria-label="Options">
              <div className="panel">
                <div className="info-line">System Prompt</div>
                <textarea className="system-textarea" value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} placeholder="Assistant instructions" />
              </div>
              <div className="panel flex1">
                <div className="info-line">Help</div>
                <p className="help-text">
                  Type your message and press Send. You can attach an image for vision models. The first message will include the system prompt if defined.
                </p>
              </div>
            </aside>
          </div>
          <div className="footer">
            <label htmlFor="chatInput" className="visually-hidden">Message</label>
            <div className="input-container">
              <textarea 
                id="chatInput" 
                ref={inputRef}
                value={input} 
                onChange={e => {
                  const newValue = e.target.value;
                  setInput(newValue);
                  setHistoryIndex(-1); // Reset history index when typing
                  
                  // Show tool suggestions if user is typing commands
                  const suggestions = getToolSuggestions();
                  const shouldShow = suggestions.length > 0 && newValue.trim().length > 0;
                  console.log('🔄 Input changed:', newValue);
                  console.log('🔄 Suggestions found:', suggestions.length);
                  console.log('🔄 Should show suggestions:', shouldShow);
                  setShowSuggestions(shouldShow);
                }}
                placeholder="Type your message (↑/↓ for history, 'use/run/execute <tool>' for suggestions)" 
                onKeyDown={e => { 
                  handleKeyDown(e);
                  if (e.key === 'Enter' && !e.shiftKey && !showSuggestions) { 
                    e.preventDefault(); 
                    send(); 
                  }
                }}
              />
              
              {/* Autocompletion suggestions */}
              {showSuggestions && (
                <div className="suggestions-dropdown">
                  {getToolSuggestions().map((tool, index) => (
                    <div 
                      key={tool.name}
                      className="suggestion-item"
                      onClick={() => insertToolSuggestion(tool)}
                    >
                      <div className="suggestion-name">🛠️ {tool.name}</div>
                      <div className="suggestion-description">{tool.description}</div>
                      {tool.inputSchema?.properties && (
                        <div className="suggestion-params">
                          Params: {Object.keys(tool.inputSchema.properties).join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button className="primary send-button" onClick={send} disabled={isLoading || !input.trim()}>{isLoading ? 'Generating…' : 'Send'}</button>
          </div>
        </>
      )}
      
      {activeTab === 'tools' && (
        <div className="tools-container">
          <McpTools onToolCall={handleToolCall} />
        </div>
      )}
      
      <ToolManager 
        isOpen={isToolManagerOpen}
        onClose={() => {
          setIsToolManagerOpen(false);
          loadToolsStatus(); // Reload status after closing
          loadAvailableTools(); // Reload tools for autocompletion
        }}
        currentModel={model}
      />
      
      <ModelManager 
        isOpen={isModelManagerOpen}
        onClose={() => {
          setIsModelManagerOpen(false);
          loadAvailableTools(); // Reload tools when model manager closes
        }}
      />
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
