import React, { useEffect, useState, useMemo } from 'react';
import { Grid, List, RefreshCw, AlertCircle, BookOpen } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { api } from '../../utils/api';
import { progressStore, folderStore, recentStore } from '../../utils/storage';
import { FileCard } from './FileCard';

export default function LibraryView() {
  const { state, actions } = useApp();
  const [progresses, setProgresses] = useState({});
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { loadFiles(); loadLocalData(); }, []);

  async function loadFiles() {
    actions.setFilesLoading(true);
    try {
      const res = await api.getFiles();
      actions.setFiles(res.files || []);
      if (res.demo_mode !== undefined) actions.setDemoMode(res.demo_mode);
    } catch (e) { actions.setFilesError(e.message); }
  }

  async function loadLocalData() {
    const allProgress = await progressStore.getAll();
    const map = {};
    for (const p of allProgress) map[p.fileId] = p;
    setProgresses(map);
    const folders = await folderStore.getAll();
    actions.setFolders(folders);
    const assignments = {};
    for (const folder of folders) {
      const assigned = await folderStore.getFilesInFolder(folder.id);
      for (const a of assigned) assignments[a.fileId] = a.folderId;
    }
    actions.setFileAssignments(assignments);
    const recent = await recentStore.getAll(20);
    actions.setRecent(recent);
  }

  async function refresh() { setRefreshing(true); await loadFiles(); setRefreshing(false); }

  const displayedFiles = useMemo(() => {
    let files = state.files;
    if (state.activeSection === 'search') files = state.searchResults;
    else if (state.activeSection === 'recent') {
      const ids = state.recentFiles.map(r => r.fileId);
      files = ids.map(id => state.files.find(f => f.id === id)).filter(Boolean);
    } else if (state.activeSection === 'folder' && state.activeFolderId) {
      const inFolder = Object.entries(state.fileAssignments).filter(([, fid]) => fid === state.activeFolderId).map(([fid]) => fid);
      files = state.files.filter(f => inFolder.includes(f.id));
    }
    return files;
  }, [state.files, state.activeSection, state.searchResults, state.recentFiles, state.activeFolderId, state.fileAssignments]);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-ink-500 text-sm">{displayedFiles.length} documents</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refresh} disabled={refreshing} className="p-2 text-ink-500 hover:text-ink-200 rounded-lg hover:bg-ink-800/50 transition-all">
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <div className="flex bg-ink-900 border border-ink-800/50 rounded-lg p-0.5">
            <button onClick={() => actions.setViewMode('grid')} className={`p-1.5 rounded-md transition-all ${state.viewMode === 'grid' ? 'bg-ink-700 text-ink-100' : 'text-ink-500'}`}><Grid size={14} /></button>
            <button onClick={() => actions.setViewMode('list')} className={`p-1.5 rounded-md transition-all ${state.viewMode === 'list' ? 'bg-ink-700 text-ink-100' : 'text-ink-500'}`}><List size={14} /></button>
          </div>
        </div>
      </div>

      {state.filesLoading && (
        <div className={state.viewMode === 'grid' ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4' : 'space-y-1'}>
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} list={state.viewMode === 'list'} />)}
        </div>
      )}

      {state.filesError && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertCircle size={32} className="text-red-400 mb-3" />
          <p className="text-ink-300 mb-4">{state.filesError}</p>
          <button onClick={loadFiles} className="btn-primary text-sm">Retry</button>
        </div>
      )}

      {!state.filesLoading && !state.filesError && displayedFiles.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <BookOpen size={40} className="text-ink-700 mb-4" />
          <p className="text-ink-400">No PDFs found</p>
        </div>
      )}

      {!state.filesLoading && !state.filesError && displayedFiles.length > 0 && (
        state.viewMode === 'grid' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 animate-fade-in">
            {displayedFiles.map(file => <FileCard key={file.id} file={file} progress={progresses[file.id]} />)}
          </div>
        ) : (
          <div className="space-y-0.5 animate-fade-in">
            {displayedFiles.map(file => <FileCard key={file.id} file={file} progress={progresses[file.id]} />)}
          </div>
        )
      )}
    </div>
  );
}

function SkeletonCard({ list }) {
  if (list) return (
    <div className="flex items-center gap-4 px-4 py-3 rounded-xl">
      <div className="w-8 h-10 rounded-lg shimmer" />
      <div className="flex-1"><div className="h-3 w-3/4 rounded shimmer mb-1.5" /><div className="h-2 w-1/2 rounded shimmer" /></div>
    </div>
  );
  return (
    <div className="rounded-2xl overflow-hidden border border-ink-800/30">
      <div className="h-36 shimmer" />
      <div className="p-3"><div className="h-3 w-3/4 rounded shimmer mb-1.5" /><div className="h-2 w-1/2 rounded shimmer" /></div>
    </div>
  );
}
