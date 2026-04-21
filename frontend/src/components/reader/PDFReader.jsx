import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2, Minimize2, Bookmark, BookmarkCheck, Highlighter, MessageSquare, Sun, Moon, Coffee, Layers } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { api } from '../../utils/api';
import { highlightStore, bookmarkStore, progressStore } from '../../utils/storage';
import { cleanFileName } from '../../utils/format';
import ThumbnailSidebar from './ThumbnailSidebar';
import AnnotationSidebar from './AnnotationSidebar';

let pdfjsLib = null;
async function getPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
  return pdfjsLib;
}

const READER_MODES = {
  dark:  { bg: '#0e0b08', text: '#e8ddd0', canvas: 'brightness(0.88) contrast(1.05)' },
  sepia: { bg: '#f4efe6', text: '#5c4a32', canvas: 'sepia(0.4) brightness(0.97)' },
  light: { bg: '#ffffff', text: '#1a1a1a', canvas: 'brightness(1) contrast(1)' },
};

export default function PDFReader() {
  const { state, actions } = useApp();
  const file = state.openFile;
  const readerMode = state.readerMode;
  const [pdfDoc, setPdfDoc] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.3);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [showThumbs, setShowThumbs] = useState(true);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [highlights, setHighlights] = useState([]);
  const [bookmarks, setBookmarks] = useState([]);
  const [highlightMode, setHighlightMode] = useState(false);
  const [activeHighlightColor, setActiveHighlightColor] = useState('yellow');
  const canvasRef = useRef(null);
  const textLayerRef = useRef(null);
  const containerRef = useRef(null);
  const renderTaskRef = useRef(null);
  const modeStyle = READER_MODES[readerMode];

  useEffect(() => {
    if (!file) return;
    loadPDF(); loadAnnotations(); restoreProgress();
    const handleKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setCurrentPage(p => Math.min(p+1, numPages));
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') setCurrentPage(p => Math.max(p-1, 1));
      if (e.key === 'Escape') actions.closeFile();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [file]);

  async function loadPDF() {
    setLoading(true); setError('');
    try {
      const lib = await getPdfJs();
      const doc = await lib.getDocument({
        url: api.getStreamUrl(file.id),
        httpHeaders: { Authorization: `Bearer ${localStorage.getItem('airnotes_token')}` },
        rangeChunkSize: 65536,
      }).promise;
      setPdfDoc(doc); setNumPages(doc.numPages); setLoading(false);
    } catch (e) { setError(e.message || 'Failed to load PDF'); setLoading(false); }
  }

  async function loadAnnotations() {
    const hl = await highlightStore.getByFile(file.id); setHighlights(hl);
    const bm = await bookmarkStore.getByFile(file.id); setBookmarks(bm);
  }

  async function restoreProgress() {
    const prog = await progressStore.get(file.id);
    if (prog && prog.currentPage > 1) setCurrentPage(prog.currentPage);
  }

  useEffect(() => { if (pdfDoc && canvasRef.current) renderPage(currentPage); }, [pdfDoc, currentPage, scale, readerMode]);

  const renderPage = useCallback(async (pageNum) => {
    if (!pdfDoc || !canvasRef.current) return;
    if (renderTaskRef.current) { renderTaskRef.current.cancel(); renderTaskRef.current = null; }
    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      canvas.width = viewport.width; canvas.height = viewport.height;
      const renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport });
      renderTaskRef.current = renderTask;
      await renderTask.promise;
      renderTaskRef.current = null;
      await progressStore.save(file.id, pageNum, pdfDoc.numPages);
      setIsBookmarked(await bookmarkStore.isBookmarked(file.id, pageNum));
    } catch (e) { if (e.name !== 'RenderingCancelledException') console.error(e); }
  }, [pdfDoc, scale, file]);

  async function toggleBookmark() {
    if (isBookmarked) { await bookmarkStore.remove(file.id, currentPage); setIsBookmarked(false); setBookmarks(prev => prev.filter(b => b.page !== currentPage)); }
    else { await bookmarkStore.add(file.id, currentPage); setIsBookmarked(true); setBookmarks(await bookmarkStore.getByFile(file.id)); }
  }

  async function handleTextSelection() {
    if (!highlightMode) return;
    const text = window.getSelection()?.toString().trim();
    if (!text || text.length < 2) return;
    const id = await highlightStore.add(file.id, currentPage, text, activeHighlightColor);
    const newHL = { id, fileId: file.id, page: currentPage, text, color: activeHighlightColor, createdAt: Date.now() };
    setHighlights(prev => [...prev, newHL]);
    window.getSelection().removeAllRanges();
  }

  async function deleteHighlight(id) { await highlightStore.delete(id); setHighlights(prev => prev.filter(h => h.id !== id)); }

  const progress = numPages > 0 ? Math.round((currentPage / numPages) * 100) : 0;
  if (!file) return null;

  return (
    <div ref={containerRef} className="fixed inset-0 z-40 flex flex-col" style={{ background: modeStyle.bg, color: modeStyle.text }}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-shrink-0" style={{ borderColor: readerMode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.1)' }}>
        <button onClick={() => actions.closeFile()} className="p-1.5 rounded-lg hover:bg-black/10 opacity-60 hover:opacity-100"><X size={16} /></button>
        <div className="flex-1 min-w-0 px-2">
          <p className="text-sm font-medium truncate opacity-80">{cleanFileName(file.name)}</p>
          <p className="text-[10px] opacity-40">{currentPage} / {numPages}</p>
        </div>
        <div className="flex items-center gap-0.5 bg-black/10 rounded-lg p-0.5">
          {[{ key:'dark',icon:Moon },{ key:'sepia',icon:Coffee },{ key:'light',icon:Sun }].map(({ key, icon: Icon }) => (
            <button key={key} onClick={() => actions.setReaderMode(key)} className={`p-1.5 rounded-md transition-all ${readerMode === key ? 'bg-white/20' : 'opacity-40 hover:opacity-70'}`}><Icon size={13} /></button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-black/10 rounded-lg px-2 py-1">
          <button onClick={() => setScale(s => Math.max(s-0.2, 0.5))} className="opacity-60 hover:opacity-100"><ZoomOut size={13} /></button>
          <button onClick={() => setScale(1.3)} className="text-xs font-mono opacity-70 w-10 text-center">{Math.round(scale*100)}%</button>
          <button onClick={() => setScale(s => Math.min(s+0.2, 3))} className="opacity-60 hover:opacity-100"><ZoomIn size={13} /></button>
        </div>
        <button onClick={toggleBookmark} className={`p-1.5 rounded-lg ${isBookmarked ? 'text-amber-400' : 'opacity-50 hover:opacity-100'}`}>
          {isBookmarked ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
        </button>
        <button onClick={() => setHighlightMode(!highlightMode)} className={`p-1.5 rounded-lg ${highlightMode ? 'bg-yellow-400/20 text-yellow-400' : 'opacity-50 hover:opacity-100'}`}><Highlighter size={15} /></button>
        <button onClick={() => { setShowAnnotations(!showAnnotations); setShowThumbs(false); }} className={`p-1.5 rounded-lg ${showAnnotations ? 'bg-black/20' : 'opacity-50'}`}><MessageSquare size={15} /></button>
        <button onClick={() => { setShowThumbs(!showThumbs); setShowAnnotations(false); }} className={`p-1.5 rounded-lg ${showThumbs ? 'bg-black/20' : 'opacity-50'}`}><Layers size={15} /></button>
      </div>

      <div className="h-0.5 flex-shrink-0" style={{ background: 'rgba(0,0,0,0.1)' }}>
        <div className="progress-bar h-full" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {showThumbs && pdfDoc && <ThumbnailSidebar pdfDoc={pdfDoc} numPages={numPages} currentPage={currentPage} onGoTo={setCurrentPage} bookmarks={bookmarks} readerMode={readerMode} />}
        <div className="flex-1 overflow-auto flex flex-col items-center py-8 px-4"
          style={{ background: readerMode === 'dark' ? '#161210' : readerMode === 'sepia' ? '#ede8de' : '#e8e8e8' }}
          onMouseUp={handleTextSelection}>
          {loading && <div className="flex flex-col items-center justify-center flex-1 gap-4"><div className="w-8 h-8 border-2 border-ink-600 border-t-ink-300 rounded-full animate-spin" /><p className="text-sm opacity-50">Loading PDF…</p></div>}
          {error && <div className="text-center py-16"><p className="text-red-400">{error}</p><button onClick={loadPDF} className="btn-primary mt-4 text-sm">Retry</button></div>}
          {!loading && !error && (
            <div className="pdf-page-wrapper">
              <canvas ref={canvasRef} style={{ filter: modeStyle.canvas, display: 'block', maxWidth: '100%' }} />
              <div ref={textLayerRef} style={{ position:'absolute', top:0, left:0, overflow:'hidden', cursor: highlightMode ? 'crosshair' : 'text', userSelect:'text' }} />
              {highlightMode && (
                <div className="absolute top-3 right-3 flex gap-1.5 bg-black/60 backdrop-blur-sm rounded-xl p-1.5">
                  {['yellow','green','blue','pink'].map(color => (
                    <button key={color} onClick={() => setActiveHighlightColor(color)}
                      className={`w-5 h-5 rounded-full transition-transform ${activeHighlightColor === color ? 'scale-125 ring-2 ring-white/50' : ''}`}
                      style={{ background: {yellow:'#fbbf24',green:'#4ade80',blue:'#60a5fa',pink:'#fb7185'}[color] }} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {showAnnotations && <AnnotationSidebar highlights={highlights} bookmarks={bookmarks} currentPage={currentPage} onGoTo={setCurrentPage} onDeleteHighlight={deleteHighlight} readerMode={readerMode} />}
      </div>

      <div className="flex items-center justify-center gap-4 px-6 py-3 border-t flex-shrink-0 relative" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <button onClick={() => setCurrentPage(p => Math.max(p-1,1))} disabled={currentPage <= 1} className="p-2 rounded-xl disabled:opacity-20 hover:bg-black/10"><ChevronLeft size={18} /></button>
        <div className="flex items-center gap-2">
          <input type="number" value={currentPage} min={1} max={numPages} onChange={e => setCurrentPage(Math.max(1, Math.min(parseInt(e.target.value)||1, numPages)))}
            className="w-14 text-center bg-black/10 rounded-lg px-2 py-1 text-sm font-mono focus:outline-none" style={{ color: modeStyle.text }} />
          <span className="text-sm opacity-40">/ {numPages}</span>
        </div>
        <button onClick={() => setCurrentPage(p => Math.min(p+1,numPages))} disabled={currentPage >= numPages} className="p-2 rounded-xl disabled:opacity-20 hover:bg-black/10"><ChevronRight size={18} /></button>
        <span className="absolute right-6 text-xs opacity-30">{progress}%</span>
      </div>
    </div>
  );
}
