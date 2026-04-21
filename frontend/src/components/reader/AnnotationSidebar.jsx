import React, { useState } from 'react';
import { Highlighter, Bookmark, Trash2 } from 'lucide-react';

const COLOR_MAP = { yellow:'#fbbf24', green:'#4ade80', blue:'#60a5fa', pink:'#fb7185' };

export default function AnnotationSidebar({ highlights, bookmarks, currentPage, onGoTo, onDeleteHighlight, readerMode }) {
  const [tab, setTab] = useState('highlights');
  const bg = readerMode === 'dark' ? '#0a0806' : readerMode === 'sepia' ? '#e8e2d8' : '#f0f0f0';
  const text = readerMode === 'dark' ? '#c4b396' : readerMode === 'sepia' ? '#5c4a32' : '#333';

  return (
    <div className="w-64 flex-shrink-0 border-l flex flex-col overflow-hidden" style={{ background: bg, borderColor: 'rgba(255,255,255,0.06)', color: text }}>
      <div className="flex border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        {[{ key:'highlights', icon:Highlighter, label:'Highlights', count:highlights.length }, { key:'bookmarks', icon:Bookmark, label:'Bookmarks', count:bookmarks.length }].map(({ key, icon: Icon, label, count }) => (
          <button key={key} onClick={() => setTab(key)} className="flex-1 flex flex-col items-center gap-0.5 py-3 text-xs transition-all"
            style={{ opacity: tab === key ? 1 : 0.4, borderBottom: tab === key ? '2px solid #967852' : '2px solid transparent' }}>
            <Icon size={14} /><span>{label}</span><span className="text-[10px] opacity-60">({count})</span>
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {tab === 'highlights' && (highlights.length === 0
          ? <p className="text-xs opacity-40 text-center py-8">No highlights yet</p>
          : highlights.sort((a,b) => a.page - b.page).map(h => (
            <div key={h.id} className="rounded-xl p-3 cursor-pointer group" onClick={() => onGoTo(h.page)}
              style={{ background: `${COLOR_MAP[h.color]}18`, border: `1px solid ${COLOR_MAP[h.color]}33` }}>
              <div className="flex items-start justify-between mb-1">
                <span className="text-[10px] opacity-50">Page {h.page}</span>
                <button onClick={e => { e.stopPropagation(); onDeleteHighlight(h.id); }} className="opacity-0 group-hover:opacity-60"><Trash2 size={10} /></button>
              </div>
              <p className="text-xs italic line-clamp-3">"{h.text}"</p>
            </div>
          ))
        )}
        {tab === 'bookmarks' && (bookmarks.length === 0
          ? <p className="text-xs opacity-40 text-center py-8">No bookmarks yet</p>
          : bookmarks.sort((a,b) => a.page - b.page).map(b => (
            <div key={b.id} onClick={() => onGoTo(b.page)} className="rounded-xl p-3 cursor-pointer flex items-center gap-3 hover:opacity-80"
              style={{ background:'rgba(251,191,36,0.1)', border:'1px solid rgba(251,191,36,0.2)' }}>
              <Bookmark size={14} className="text-amber-400 fill-amber-400 flex-shrink-0" />
              <p className="text-xs font-medium">Page {b.page}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
