import React, { useState } from 'react';
import { BookOpen, MoreVertical, FolderInput } from 'lucide-react';
import { formatSize, formatRelativeDate, cleanFileName, getInitials, stringToColor } from '../../utils/format';
import { useApp } from '../../store/AppContext';
import { folderStore, recentStore } from '../../utils/storage';

export function FileCard({ file, progress }) {
  const { state, actions } = useApp();
  const [showMenu, setShowMenu] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const title = cleanFileName(file.name);
  const initials = getInitials(file.name);
  const coverColor = stringToColor(file.id);
  const assignedFolderId = state.fileAssignments[file.id];
  const assignedFolder = state.folders.find(f => f.id === assignedFolderId);
  const pct = progress ? progress.percent : 0;

  async function openFile() {
    actions.openFile(file);
    await recentStore.touch(file.id, file.name);
    actions.addRecent({ fileId: file.id, fileName: file.name, openedAt: Date.now() });
  }

  async function assignToFolder(folderId) {
    await folderStore.assignFile(file.id, folderId);
    actions.assignFile(file.id, folderId);
    setShowFolderPicker(false); setShowMenu(false);
  }

  if (state.viewMode === 'list') {
    return (
      <div onClick={openFile} className="group flex items-center gap-4 px-4 py-3 rounded-xl border border-transparent hover:bg-ink-800/50 hover:border-ink-700/40 cursor-pointer transition-all">
        <div className="w-8 h-10 rounded-lg flex-shrink-0 flex items-center justify-center text-xs font-bold text-white/80 shadow"
          style={{ background: `linear-gradient(135deg, ${coverColor}, ${coverColor}aa)` }}>{initials.slice(0,2)}</div>
        <div className="flex-1 min-w-0">
          <p className="text-ink-100 text-sm font-medium truncate">{title}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-ink-500 text-xs">{formatSize(file.size)}</span>
            <span className="text-ink-700 text-xs">·</span>
            <span className="text-ink-500 text-xs">{formatRelativeDate(file.date)}</span>
            {assignedFolder && <span className="text-ink-600 text-xs">📁 {assignedFolder.name}</span>}
          </div>
        </div>
        {pct > 0 && <div className="flex items-center gap-2">
          <div className="w-20 h-1 bg-ink-800 rounded-full overflow-hidden"><div className="progress-bar h-full" style={{ width: `${pct}%` }} /></div>
          <span className="text-ink-500 text-xs">{pct}%</span>
        </div>}
      </div>
    );
  }

  return (
    <div onClick={openFile} className="group relative flex flex-col rounded-2xl border border-ink-800/50 bg-ink-900/40 hover:bg-ink-800/60 hover:border-ink-600/50 cursor-pointer transition-all duration-200 overflow-hidden shadow-sm hover:shadow-lg">
      <div className="h-36 flex items-end justify-start p-4 relative" style={{ background: `linear-gradient(160deg, ${coverColor}33, ${coverColor}88)` }}>
        <div className="absolute left-0 top-0 bottom-0 w-3 opacity-40" style={{ background: `linear-gradient(to right, ${coverColor}88, transparent)` }} />
        <div className="w-12 h-14 rounded-lg shadow-xl flex items-center justify-center text-sm font-bold text-white/90 border border-white/10 relative" style={{ background: coverColor }}>
          {initials.slice(0,2)}
        </div>
        {pct > 0 && (
          <div className="absolute top-3 right-3">
            <svg width="28" height="28" className="rotate-[-90deg]">
              <circle cx="14" cy="14" r="11" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2.5" />
              <circle cx="14" cy="14" r="11" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5"
                strokeDasharray={`${2*Math.PI*11}`} strokeDashoffset={`${2*Math.PI*11*(1-pct/100)}`} strokeLinecap="round" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[8px] text-white/80 rotate-90 font-mono">{pct}%</span>
          </div>
        )}
        {assignedFolder && <div className="absolute bottom-2 right-2 text-[10px] bg-black/40 text-white/60 px-1.5 py-0.5 rounded-md">📁 {assignedFolder.name}</div>}
      </div>
      <div className="p-3 flex-1">
        <p className="text-ink-100 text-xs font-medium leading-snug line-clamp-2 mb-1">{title}</p>
        <div className="flex items-center gap-2 text-ink-600 text-[11px]">
          <span>{formatSize(file.size)}</span><span>·</span><span>{formatRelativeDate(file.date)}</span>
        </div>
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-ink-950/60 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="bg-ink-700 border border-ink-600 rounded-xl px-4 py-2 flex items-center gap-2 text-ink-100 text-sm font-medium shadow-xl">
          <BookOpen size={14} /> {pct > 0 ? 'Continue' : 'Open'}
        </div>
      </div>
      <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
        <div className="relative">
          <button onClick={() => setShowMenu(!showMenu)} className="p-1 bg-ink-900/80 rounded-lg text-ink-500 hover:text-ink-200"><MoreVertical size={14} /></button>
          {showMenu && (
            <div className="absolute z-50 top-full mt-1 glass rounded-xl shadow-2xl min-w-[160px] py-1.5" onMouseLeave={() => { setShowMenu(false); setShowFolderPicker(false); }}>
              <button onClick={() => setShowFolderPicker(!showFolderPicker)} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-ink-300 hover:bg-ink-700/50">
                <FolderInput size={12} /> Move to folder
              </button>
              {showFolderPicker && state.folders.map(f => (
                <button key={f.id} onClick={() => assignToFolder(f.id)} className="w-full text-left px-4 py-1.5 text-xs text-ink-400 hover:bg-ink-700/50">
                  {assignedFolderId === f.id ? '✓ ' : '   '}{f.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
