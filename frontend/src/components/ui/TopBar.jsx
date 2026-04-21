import React from 'react';
import { Search, Command } from 'lucide-react';
import { useApp } from '../../store/AppContext';

export default function TopBar({ onSearchOpen }) {
  const { state } = useApp();
  const title = state.activeSection === 'recent' ? 'Recent'
    : state.activeSection === 'folder' ? (state.folders.find(f => f.id === state.activeFolderId)?.name || 'Folder')
    : 'My Library';

  return (
    <header className="h-14 flex-shrink-0 flex items-center justify-between px-6 border-b border-ink-800/50 bg-ink-950/80 backdrop-blur-sm">
      <h2 className="font-display text-base font-semibold text-paper-100">{title}</h2>
      <button onClick={onSearchOpen} className="flex items-center gap-2 bg-ink-900 border border-ink-800/60 rounded-xl px-3 py-2 text-ink-500 hover:text-ink-300 hover:border-ink-700 transition-all text-sm min-w-[200px]">
        <Search size={13} />
        <span className="flex-1 text-left text-xs">Quick search…</span>
        <div className="flex items-center gap-0.5 text-[10px] bg-ink-800/80 px-1.5 py-0.5 rounded-md"><Command size={9} />K</div>
      </button>
    </header>
  );
}
