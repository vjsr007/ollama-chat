import React, { useEffect, useState } from 'react';
import './LogViewer.css';

interface LogEntry { ts: number; level: string; msg: string; }
interface Props { isOpen: boolean; onClose: () => void; }

const levelColor: Record<string,string> = { error: '#ff4d4f', warn: '#faad14', info: '#1677ff', log: '#666', debug: '#52c41a', trace: '#aaa' };

const formatTs = (ts: number) => {
  const d = new Date(ts); return d.toLocaleTimeString(undefined, { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3,'0');
};

const LogViewer: React.FC<Props> = ({ isOpen, onClose }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [limit, setLimit] = useState(500);
  const [filter, setFilter] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = async () => {
    try {
      const res = await (window as any).logs.getRecent(limit);
      if (res?.success) setLogs(res.logs);
    } catch (e) { /* ignore */ }
  };

  useEffect(() => { if (isOpen) load(); }, [isOpen, limit]);
  useEffect(() => {
    if (!autoRefresh || !isOpen) return;
    const id = setInterval(load, 1500);
    return () => clearInterval(id);
  }, [autoRefresh, isOpen, limit]);

  if (!isOpen) return null;

  const filtered = filter.trim() ? logs.filter(l => l.msg.toLowerCase().includes(filter.toLowerCase())) : logs;

  return (
    <div className="log-viewer-overlay" role="dialog" aria-modal="true">
      <div className="log-viewer">
        <div className="lv-header">
          <strong>Backend Logs</strong>
          <div className="lv-controls">
            <label>Limit:
              <select value={limit} onChange={e => setLimit(parseInt(e.target.value,10))}>
                {[200,500,1000,1500,2000].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <input placeholder="Filter" value={filter} onChange={e => setFilter(e.target.value)} />
            <label><input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} /> Auto</label>
            <button onClick={load}>Reload</button>
            <button onClick={async () => { await (window as any).logs.clear(); load(); }}>Clear</button>
            <button onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="lv-body">
          {filtered.map((l,i) => (
            <div key={i} className={`lv-row level-${l.level}`}>
              <span className="lv-ts">{formatTs(l.ts)}</span>
              <span className="lv-level">{l.level.toUpperCase()}</span>
              <span className="lv-msg">{l.msg}</span>
            </div>
          ))}
          {filtered.length === 0 && <div className="lv-empty">No logs</div>}
        </div>
      </div>
    </div>
  );
};

export default LogViewer;
