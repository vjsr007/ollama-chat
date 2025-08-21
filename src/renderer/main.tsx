import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatMessage } from '../shared/domain/chat';
import { McpTools } from './components/McpTools';
import MessageContent from './components/MessageContent';
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
  const chatRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    window.ollama.listModels().then(ms => { setModels(ms); if (ms[0]) setModel(ms[0]); });
  }, []);

  const send = async () => {
    if (!input.trim() || !model) return;
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
            <textarea id="chatInput" value={input} onChange={e => setInput(e.target.value)} placeholder="Type your message" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button className="primary send-button" onClick={send} disabled={isLoading || !input.trim()}>{isLoading ? 'Generating…' : 'Send'}</button>
          </div>
        </>
      )}
      
      {activeTab === 'tools' && (
        <div className="tools-container">
          <McpTools onToolCall={handleToolCall} />
        </div>
      )}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
