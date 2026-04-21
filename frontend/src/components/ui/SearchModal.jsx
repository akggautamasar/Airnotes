import React, { useState, useEffect, useRef } from 'react';
import { Search, X, FileText, Clock } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { api } from '../../utils/api';
import { cleanFileName, formatSize, formatRelativeDate } from '../../utils/format';
import { recentStore } from '../../utils/storage';

export default function SearchModal({ onClose }) {
  const { state, actions } = useApp();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.search(query);
        setResults(res.files || []);
      } catch {
        const q = query.toLowerCase();
        setResults(state.files.filter(f => f.name.toLowerCase().includes(q) || (f.caption && f.caption.toLowerCase().includes(q))));
      } finally { setSearching(false); }
    }, 300);
  }, [query]);

  async function openFile(file) {
    actions.openFile(file);
    await recentStore.touch(file.id, file.name);
    actions.addRecent({ fileId: file.id, fileName: file.name, openedAt: Date.now() });
    onClose();
  }

  const displayList = query.trim() ? results : state.recentFiles.map(r => state.files.find(f => f.id === r.fileId)).filter(Boolean).slice(0, 6);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" />
      <div className="relative w-full max-w-xl glass rounded-2xl shadow-2xl overflow-hidden animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-ink-800/50">
          {searching ? <div className="w-4 h-4 border-2 border-ink-600 border-t-ink-300 rounded-full animate-spin flex-shrink-0" /> : <Search size={16} className="text-ink-500 flex-shrink-0" />}
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search your library…"
            className="flex-1 bg-transparent text-ink-100 placeholder-ink-600 text-sm focus:outline-none" />
          {query && <button onClick={() => setQuery('')} className="text-ink-600 hover:text-ink-300"><X size={14} /></button>}
          <kbd className="text-[10px] bg-ink-800 text-ink-500 px-2 py-1 rounded-lg border border-ink-700">ESC</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {displayList.length === 0 && query && <div className="py-10 text-center text-ink-600 text-sm">No results for "{query}"</div>}
          {displayList.map(file => (
            <button key={file.id} onClick={() => openFile(file)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-ink-800/50 transition-colors text-left">
              <div className="w-8 h-9 rounded-lg bg-ink-800 border border-ink-700/40 flex items-center justify-center flex-shrink-0">
                <FileText size={14} className="text-ink-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-ink-100 text-sm truncate">{cleanFileName(file.name)}</p>
                <p className="text-ink-600 text-xs">{formatSize(file.size)} · {formatRelativeDate(file.date)}</p>
              </div>
              <span className="text-ink-700 text-xs">↵</span>
            </button>
          ))}
        </div>
        <div className="px-4 py-2.5 border-t border-ink-800/40 text-[11px] text-ink-700">
          <kbd className="bg-ink-800 px-1.5 py-0.5 rounded">ESC</kbd> to close
        </div>
      </div>
    </div>
  );
}
