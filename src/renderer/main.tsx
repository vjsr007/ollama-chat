import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatMessage } from '../shared/domain/chat';
import './styles.css';

const App: React.FC = () => {
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [imagePath, setImagePath] = useState<string | undefined>();
  const [systemPrompt, setSystemPrompt] = useState('Eres un asistente útil.');
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
    const reply = await window.ollama.sendChat({ model, messages: newMessages });
    setMessages([...newMessages, { role: 'assistant', content: reply }]);
    setIsLoading(false);
  };

  const pickImage = async () => {
    const p = await window.ollama.openImage();
    if (p) setImagePath(p);
  };

  return (
    <div className="app" role="main">
      <div className="topbar">
        <div className="logo"><span className="brand">Local</span> Ollama Chat</div>
        <div className="actions">
          <button onClick={() => setMessages([])} disabled={!messages.length || isLoading}>Limpiar</button>
        </div>
      </div>
      <div className="toolbar">
        <label htmlFor="modelSelect">Modelo:</label>
        <select id="modelSelect" value={model} onChange={e => setModel(e.target.value)} aria-label="Seleccionar modelo">
          {models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <button onClick={pickImage} aria-label="Adjuntar imagen">📷 Imagen</button>
        {imagePath && (
          <span className="image-chip">{imagePath.split(/\\|\//).pop()} <button onClick={() => setImagePath(undefined)} aria-label="Quitar imagen">✕</button></span>
        )}
      </div>
  <div className="layout">
        <div className="chat-wrapper">
          <div className="scroll-fade-top" />
          <div className="scroll-fade-bottom" />
          <div ref={chatRef} className="chat" aria-live="polite">
            {messages.map((m,i) => (
              <div key={i} className={`msg ${m.role}`}>
                <span className="msg-role">{m.role}</span>
                <div className="msg-content">{m.content}</div>
                {m.imagePath && <div className="attachment">Imagen adjunta</div>}
              </div>
            ))}
            {isLoading && <div className="msg assistant loading">Pensando...</div>}
          </div>
        </div>
        <aside className="side-panel" aria-label="Opciones">
          <div className="panel">
            <div className="info-line">System Prompt</div>
            <textarea className="system-textarea" value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} placeholder="Instrucciones del asistente" />
          </div>
          <div className="panel flex1">
            <div className="info-line">Ayuda</div>
            <p className="help-text">
              Escribe tu mensaje y pulsa Enviar. Puedes adjuntar una imagen para modelos con visión. El primer mensaje incluirá el system prompt si está definido.
            </p>
          </div>
        </aside>
      </div>
      <div className="footer">
        <label htmlFor="chatInput" className="visually-hidden">Mensaje</label>
        <textarea id="chatInput" value={input} onChange={e => setInput(e.target.value)} placeholder="Escribe tu mensaje" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
  <button className="primary send-button" onClick={send} disabled={isLoading || !input.trim()}>{isLoading ? 'Generando…' : 'Enviar'}</button>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
