import React, { useEffect, useState } from 'react';
import { useApp } from '../store/AppContext';
import { api } from '../utils/api';
import Sidebar from '../components/Sidebar';
import TopBar from '../components/ui/TopBar';
import LibraryView from '../components/library/LibraryView';
import PDFReader from '../components/reader/PDFReader';
import SearchModal from '../components/ui/SearchModal';

export default function MainApp() {
  const { state, actions } = useApp();
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); if (!state.openFile) setShowSearch(true); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state.openFile]);

  useEffect(() => { api.verify().catch(() => actions.logout()); }, []);

  return (
    <div className="h-screen flex overflow-hidden bg-ink-950">
      <Sidebar onSearch={() => setShowSearch(true)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar onSearchOpen={() => setShowSearch(true)} />
        <LibraryView />
      </div>
      {state.openFile && <PDFReader />}
      {showSearch && !state.openFile && <SearchModal onClose={() => setShowSearch(false)} />}
    </div>
  );
}
