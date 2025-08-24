import React, { useEffect, useState } from 'react';

interface DirectoryEntry {
  id: string;
  package: string;
  name: string;
  description: string;
  website?: string;
  repo?: string;
  reliability: number;
  tags?: string[];
  notes?: string;
  installed?: boolean;
  version?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onInstall?: (pkg: string) => Promise<void>;
  quickAddServer?: (entry: DirectoryEntry, opts?: { start?: boolean }) => Promise<void>;
}

const reliabilityStars = (n: number) => '★★★★★'.slice(0,n) + '☆☆☆☆☆'.slice(n,5);

export const McpDirectoryPopup: React.FC<Props> = ({ isOpen, onClose, onInstall, quickAddServer }) => {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<DirectoryEntry[]>([]);
  const [onlineMode, setOnlineMode] = useState(false);
  const [tagFilter, setTagFilter] = useState<string>('');
  const [showInstalledOnly, setShowInstalledOnly] = useState(false);
  const [selected, setSelected] = useState<DirectoryEntry | null>(null);
  const [readme, setReadme] = useState<string>('');
  const [loadingReadme, setLoadingReadme] = useState(false);
  const [history, setHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('mcp-directory-history') || '[]'); } catch { return []; }
  });
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);

  const persistHistory = (q: string) => {
    if (!q.trim()) return;
    setHistory(prev => {
      const next = [q, ...prev.filter(p => p !== q)].slice(0, 8);
      localStorage.setItem('mcp-directory-history', JSON.stringify(next));
      return next;
    });
  };

  const search = async (q: string) => {
    setLoading(true);
    try {
      const resp = onlineMode
        ? await (window as any).mcp.directorySearchOnline(q)
        : await (window as any).mcp.directorySearch(q);
      if (resp.success) setResults(resp.results); else setResults([]);
    } catch (e) { console.error(e); setResults([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (isOpen) { search(''); } }, [isOpen]);

  const loadReadme = async (entry: DirectoryEntry) => {
    setSelected(entry);
    setReadme('');
    setLoadingReadme(true);
    try {
      const resp = await (window as any).mcp.directoryReadme(entry.package);
      if (resp.success) setReadme(resp.content); else setReadme(`README not available: ${resp.error || ''}`);
    } catch (e:any) { setReadme(`Error loading README: ${e.message || String(e)}`); }
    finally { setLoadingReadme(false); }
  };

  const handleInstall = async (entry: DirectoryEntry, andAdd = false, autoStart = false) => {
    if (!onInstall) return;
    setInstalling(entry.package);
    try {
      await onInstall(entry.package);
      if (andAdd && quickAddServer) {
        await quickAddServer(entry, { start: autoStart });
      }
      await search(term);
    } catch (e) { console.error(e); }
    finally { setInstalling(null); }
  };

  const handleQuickAdd = async (entry: DirectoryEntry, autoStart = false) => {
    if (!quickAddServer) return;
    try { await quickAddServer(entry, { start: autoStart }); } catch (e) { console.error(e); }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal large">
        <div className="modal-header">
          <h3>MCP Directory</h3>
          <button onClick={onClose} className="modal-close">✕</button>
        </div>
        <div className="modal-body directory-body">
          <div className="directory-search-row">
            <input
              type="text"
              placeholder="Search MCP servers (filesystem, git, db, browser...)"
              value={term}
              onChange={e => { const v = e.target.value; setTerm(v); search(v); }}
              onKeyDown={e => { if (e.key === 'Enter') persistHistory(term); }}
            />
            <select value={tagFilter} onChange={e => setTagFilter(e.target.value)} title="Tag filter" disabled={onlineMode}>
              <option value="">All Tags</option>
              {Array.from(new Set(results.flatMap((r: any) => r.tags || []))).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <label className="dir-inline-filter" title="Toggle online npm registry search">
              <input type="checkbox" checked={onlineMode} onChange={e => { setOnlineMode(e.target.checked); setResults([]); if (term.trim()) search(term); }} /> Online
            </label>
            <label className="dir-inline-filter">
              <input type="checkbox" checked={showInstalledOnly} onChange={e => setShowInstalledOnly(e.target.checked)} /> Installed
            </label>
            {loading && <span className="loading-indicator">Searching…</span>}
          </div>
          {history.length > 0 && (
            <div className="dir-history-row">
              {history.map(h => (
                <button key={h} className="dir-history-btn" onClick={() => { setTerm(h); search(h); }} title="Recent search">{h}</button>
              ))}
            </div>
          )}
          <div className="dir-flex-row">
            <div className={`directory-results ${selected ? 'with-readme' : ''}` }>
              {results
                .filter(r => !tagFilter || (r.tags || []).includes(tagFilter))
                .filter(r => !showInstalledOnly || r.installed)
                .map(r => (
                <div key={r.id} className={`directory-entry ${selected?.id===r.id ? 'selected' : ''}`}>
                <div className="dir-main">
                  <div className="dir-title-row">
                    <span className="dir-name">{r.name}</span>
                    <span className={`dir-badge ${r.installed ? 'installed' : 'missing'}`}>{r.installed ? `Installed${r.version? ' @'+r.version: ''}` : 'Not Installed'}</span>
                  </div>
                  <div className="dir-desc">{r.description}</div>
                  <div className="dir-meta-row">
                    <span className="dir-package" title={r.package}>{r.package}</span>
                    <span className="dir-reliability" title={`Reliability score ${r.reliability}/5`}>{reliabilityStars(r.reliability)}</span>
                    {r.tags && <span className="dir-tags">{r.tags.map(t => <span key={t} className="tag">{t}</span>)}</span>}
                  </div>
                  <div className="dir-links">
                    {r.website && <a href={r.website} onClick={e => { e.preventDefault(); window.open(r.website, '_blank'); }}>Site</a>}
                    {r.repo && <a href={r.repo} onClick={e => { e.preventDefault(); window.open(r.repo, '_blank'); }}>Repo</a>}
                    <button className="dir-readme-btn" onClick={() => loadReadme(r)}>README</button>
                  </div>
                  {r.notes && <div className="dir-notes">⚠️ {r.notes}</div>}
                </div>
                <div className="dir-actions">
                  {!r.installed && (
                    <>
                      <button disabled={installing === r.package} onClick={() => handleInstall(r)}>
                        {installing === r.package ? 'Installing…' : 'Install'}
                      </button>
                      <button disabled={installing === r.package} onClick={() => handleInstall(r, true, true)} title="Install + Add + Start">
                        {installing === r.package ? '...' : 'One-Click'}
                      </button>
                    </>
                  )}
                  {r.installed && quickAddServer && (
                    <>
                      <button onClick={() => handleQuickAdd(r)} title="Add server using this package">Add</button>
                      <button onClick={() => handleQuickAdd(r, true)} title="Add + Start server">Start</button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {results.filter(r => !tagFilter || (r.tags || []).includes(tagFilter)).filter(r => !showInstalledOnly || r.installed).length === 0 && !loading && <div className="no-results">No servers match your filters.</div>}
            </div>
            {selected && (
              <div className="dir-readme-pane">
                <div className="dir-readme-header">
                  <h4>README: {selected.name}</h4>
                  <button className="dir-readme-close" onClick={() => setSelected(null)}>✕</button>
                </div>
                <div className="dir-readme-content">
                  {loadingReadme ? 'Loading README…' : (readme || 'No README content.')}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn-cancel">Close</button>
        </div>
      </div>
    </div>
  );
};

export default McpDirectoryPopup;
