import React, {
  useState, useEffect, useRef, useCallback, useMemo
} from 'react';
import {
  X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2, Minimize2,
  Bookmark, BookmarkCheck, Highlighter, MessageSquare, Sun, Moon,
  Coffee, PanelLeft, PanelRight, RotateCcw, Download, Layers
} from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { api } from '../../utils/api';
import { highlightStore, bookmarkStore, progressStore } from '../../utils/storage';
import { cleanFileName } from '../../utils/format';
import ThumbnailSidebar from './ThumbnailSidebar';
import AnnotationSidebar from './AnnotationSidebar';

// Dynamically import PDF.js
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

  // PDF state
  const [pdfDoc, setPdfDoc] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.3);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [renderingPage, setRenderingPage] = useState(false);

  // UI state
  const [fullscreen, setFullscreen] = useState(false);
  const [showThumbs, setShowThumbs] = useState(true);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(false);

  // Annotation state
  const [highlights, setHighlights] = useState([]);
  const [bookmarks, setBookmarks] = useState([]);
  const [activeHighlightColor, setActiveHighlightColor] = useState('yellow');
  const [highlightMode, setHighlightMode] = useState(false);
  const [selectedText, setSelectedText] = useState('');

  // Refs
  const canvasRef = useRef(null);
  const textLayerRef = useRef(null);
  const containerRef = useRef(null);
  const renderTaskRef = useRef(null);
  const pageRef = useRef(currentPage);
  pageRef.current = currentPage;

  const modeStyle = READER_MODES[readerMode];

  // ─── Load PDF ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!file) return;
    loadPDF();
    loadAnnotations();
    restoreProgress();

    const handleKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextPage();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') prevPage();
      if (e.key === 'Escape' && !fullscreen) actions.closeFile();
      if (e.key === 'f' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); toggleFullscreen(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [file]);

  async function loadPDF() {
    setLoading(true);
    setError('');
    try {
      const lib = await getPdfJs();
      const streamUrl = api.getStreamUrl(file.id);

      const loadingTask = lib.getDocument({
        url: streamUrl,
        withCredentials: false,
        httpHeaders: {
          Authorization: `Bearer ${localStorage.getItem('airnotes_token')}`
        },
        rangeChunkSize: 65536,
      });

      const doc = await loadingTask.promise;
      setPdfDoc(doc);
      setNumPages(doc.numPages);
      setLoading(false);
    } catch (e) {
      console.error('PDF load error:', e);
      setError(e.message || 'Failed to load PDF');
      setLoading(false);
    }
  }

  async function loadAnnotations() {
    const hl = await highlightStore.getByFile(file.id);
    setHighlights(hl);
    const bm = await bookmarkStore.getByFile(file.id);
    setBookmarks(bm);
    actions.setHighlights(file.id, hl);
    actions.setBookmarks(file.id, bm);
  }

  async function restoreProgress() {
    const prog = await progressStore.get(file.id);
    if (prog && prog.currentPage > 1) {
      setCurrentPage(prog.currentPage);
    }
  }

  // ─── Render Page ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (pdfDoc && canvasRef.current) renderPage(currentPage);
  }, [pdfDoc, currentPage, scale, readerMode]);

  const renderPage = useCallback(async (pageNum) => {
    if (!pdfDoc || !canvasRef.current) return;
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    setRenderingPage(true);
    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const renderTask = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = renderTask;

      await renderTask.promise;
      renderTaskRef.current = null;

      // Text layer for selection/search
      if (textLayerRef.current) {
        textLayerRef.current.innerHTML = '';
        textLayerRef.current.style.width = `${viewport.width}px`;
        textLayerRef.current.style.height = `${viewport.height}px`;

        const textContent = await page.getTextContent();
        const lib = await getPdfJs();

        if (lib.renderTextLayer) {
          lib.renderTextLayer({
            textContentSource: textContent,
            container: textLayerRef.current,
            viewport,
            textDivs: [],
          });
        }
      }

      // Save progress
      await progressStore.save(file.id, pageNum, pdfDoc.numPages);

      // Check bookmark state
      const bookmarked = await bookmarkStore.isBookmarked(file.id, pageNum);
      setIsBookmarked(bookmarked);

    } catch (e) {
      if (e.name !== 'RenderingCancelledException') {
        console.error('Render error:', e);
      }
    } finally {
      setRenderingPage(false);
    }
  }, [pdfDoc, scale, readerMode, file]);

  // ─── Navigation ──────────────────────────────────────────────────────────────
  const nextPage = useCallback(() => {
    setCurrentPage(p => Math.min(p + 1, numPages));
  }, [numPages]);

  const prevPage = useCallback(() => {
    setCurrentPage(p => Math.max(p - 1, 1));
  }, []);

  const goToPage = useCallback((n) => {
    const page = Math.max(1, Math.min(n, numPages));
    setCurrentPage(page);
  }, [numPages]);

  // ─── Zoom ─────────────────────────────────────────────────────────────────────
  const zoomIn  = () => setScale(s => Math.min(s + 0.2, 3.0));
  const zoomOut = () => setScale(s => Math.max(s - 0.2, 0.5));
  const resetZoom = () => setScale(1.3);

  // ─── Fullscreen ───────────────────────────────────────────────────────────────
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setFullscreen(true);
    } else {
      document.exitFullscreen();
      setFullscreen(false);
    }
  }

  // ─── Bookmarks ────────────────────────────────────────────────────────────────
  async function toggleBookmark() {
    if (isBookmarked) {
      await bookmarkStore.remove(file.id, currentPage);
      setIsBookmarked(false);
      setBookmarks(prev => prev.filter(b => b.page !== currentPage));
    } else {
      await bookmarkStore.add(file.id, currentPage, `Page ${currentPage}`);
      setIsBookmarked(true);
      const updated = await bookmarkStore.getByFile(file.id);
      setBookmarks(updated);
    }
  }

  // ─── Highlights ───────────────────────────────────────────────────────────────
  async function handleTextSelection() {
    if (!highlightMode) return;
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!text || text.length < 2) return;

    setSelectedText(text);
    const id = await highlightStore.add(file.id, currentPage, text, activeHighlightColor);
    const newHL = { id, fileId: file.id, page: currentPage, text, color: activeHighlightColor, createdAt: Date.now() };
    setHighlights(prev => [...prev, newHL]);
    actions.addHighlight(file.id, newHL);
    selection.removeAllRanges();
  }

  async function deleteHighlight(id) {
    await highlightStore.delete(id);
    setHighlights(prev => prev.filter(h => h.id !== id));
    actions.removeHighlight(file.id, id);
  }

  // ─── Progress ─────────────────────────────────────────────────────────────────
  const progress = numPages > 0 ? Math.round((currentPage / numPages) * 100) : 0;
  const pageHighlights = highlights.filter(h => h.page === currentPage);
  const title = cleanFileName(file.name);

  if (!file) return null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-40 flex flex-col"
      style={{ background: modeStyle.bg, color: modeStyle.text }}
    >
      {/* ─── Top Toolbar ─── */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 border-b flex-shrink-0"
        style={{ borderColor: readerMode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.1)' }}
      >
        {/* Close */}
        <button
          onClick={() => actions.closeFile()}
          className="p-1.5 rounded-lg hover:bg-black/10 transition-colors text-current opacity-60 hover:opacity-100"
        >
          <X size={16} />
        </button>

        {/* Title */}
        <div className="flex-1 min-w-0 px-2">
          <p className="text-sm font-medium truncate opacity-80">{title}</p>
          <p className="text-[10px] opacity-40">{currentPage} / {numPages} pages</p>
        </div>

        {/* Reading mode */}
        <div className="flex items-center gap-0.5 bg-black/10 rounded-lg p-0.5">
          {[
            { key: 'dark',  icon: Moon,   title: 'Dark' },
            { key: 'sepia', icon: Coffee, title: 'Sepia' },
            { key: 'light', icon: Sun,    title: 'Light' },
          ].map(({ key, icon: Icon, title: t }) => (
            <button
              key={key}
              onClick={() => actions.setReaderMode(key)}
              title={t}
              className={`p-1.5 rounded-md transition-all ${readerMode === key
                ? 'bg-white/20 opacity-100' : 'opacity-40 hover:opacity-70'}`}
            >
              <Icon size={13} />
            </button>
          ))}
        </div>

        {/* Zoom */}
        <div className="flex items-center gap-1 bg-black/10 rounded-lg px-2 py-1">
          <button onClick={zoomOut} className="opacity-60 hover:opacity-100"><ZoomOut size={13} /></button>
          <button onClick={resetZoom} className="text-xs font-mono opacity-70 hover:opacity-100 w-10 text-center">
            {Math.round(scale * 100)}%
          </button>
          <button onClick={zoomIn} className="opacity-60 hover:opacity-100"><ZoomIn size={13} /></button>
        </div>

        {/* Bookmark */}
        <button
          onClick={toggleBookmark}
          title={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
          className={`p-1.5 rounded-lg transition-all ${isBookmarked ? 'text-amber-400' : 'opacity-50 hover:opacity-100'}`}
        >
          {isBookmarked ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
        </button>

        {/* Highlight mode */}
        <button
          onClick={() => setHighlightMode(!highlightMode)}
          title="Highlight text"
          className={`p-1.5 rounded-lg transition-all ${highlightMode
            ? 'bg-yellow-400/20 text-yellow-400' : 'opacity-50 hover:opacity-100'}`}
        >
          <Highlighter size={15} />
        </button>

        {/* Annotations panel */}
        <button
          onClick={() => { setShowAnnotations(!showAnnotations); setShowThumbs(false); }}
          title="Annotations"
          className={`p-1.5 rounded-lg transition-all ${showAnnotations ? 'bg-black/20' : 'opacity-50 hover:opacity-100'}`}
        >
          <MessageSquare size={15} />
        </button>

        {/* Thumbnails */}
        <button
          onClick={() => { setShowThumbs(!showThumbs); setShowAnnotations(false); }}
          title="Page thumbnails"
          className={`p-1.5 rounded-lg transition-all ${showThumbs ? 'bg-black/20' : 'opacity-50 hover:opacity-100'}`}
        >
          <Layers size={15} />
        </button>

        {/* Fullscreen */}
        <button
          onClick={toggleFullscreen}
          title="Fullscreen"
          className="p-1.5 rounded-lg opacity-50 hover:opacity-100 transition-all"
        >
          {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>

      {/* ─── Progress bar ─── */}
      <div className="h-0.5 flex-shrink-0" style={{ background: 'rgba(0,0,0,0.1)' }}>
        <div className="progress-bar h-full transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      {/* ─── Main Content ─── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Thumbnail Sidebar */}
        {showThumbs && pdfDoc && (
          <ThumbnailSidebar
            pdfDoc={pdfDoc}
            numPages={numPages}
            currentPage={currentPage}
            onGoTo={goToPage}
            bookmarks={bookmarks}
            readerMode={readerMode}
          />
        )}

        {/* PDF Canvas Area */}
        <div
          className="flex-1 overflow-auto flex flex-col items-center py-8 px-4"
          style={{ background: readerMode === 'dark' ? '#161210' : readerMode === 'sepia' ? '#ede8de' : '#e8e8e8' }}
          onMouseUp={handleTextSelection}
        >
          {loading && (
            <div className="flex flex-col items-center justify-center flex-1 gap-4">
              <div className="w-8 h-8 border-2 border-ink-600 border-t-ink-300 rounded-full animate-spin" />
              <p className="text-sm opacity-50">Loading PDF…</p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center px-8">
              <p className="text-red-400 font-medium">Failed to load PDF</p>
              <p className="text-sm opacity-50">{error}</p>
              <button onClick={loadPDF} className="btn-primary text-sm mt-2">Retry</button>
            </div>
          )}

          {!loading && !error && (
            <div className="pdf-page-wrapper">
              <canvas
                ref={canvasRef}
                style={{ filter: modeStyle.canvas, display: 'block', maxWidth: '100%' }}
              />
              {/* Text layer for selection */}
              <div
                ref={textLayerRef}
                className="absolute top-0 left-0 overflow-hidden"
                style={{
                  position: 'absolute', top: 0, left: 0,
                  cursor: highlightMode ? 'crosshair' : 'text',
                  userSelect: 'text',
                }}
              />
              {/* Highlight color picker when in highlight mode */}
              {highlightMode && (
                <div className="absolute top-3 right-3 flex gap-1.5 bg-black/60 backdrop-blur-sm rounded-xl p-1.5">
                  {['yellow', 'green', 'blue', 'pink'].map(color => (
                    <button
                      key={color}
                      onClick={() => setActiveHighlightColor(color)}
                      className={`w-5 h-5 rounded-full transition-transform ${activeHighlightColor === color ? 'scale-125 ring-2 ring-white/50' : ''}`}
                      style={{
                        background: { yellow: '#fbbf24', green: '#4ade80', blue: '#60a5fa', pink: '#fb7185' }[color]
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Page highlights overlay */}
          {pageHighlights.length > 0 && !loading && (
            <div className="mt-3 w-full max-w-lg">
              <p className="text-xs opacity-40 mb-1.5">{pageHighlights.length} highlight{pageHighlights.length !== 1 ? 's' : ''} on this page</p>
              {pageHighlights.map(h => (
                <div key={h.id}
                  className={`text-xs px-3 py-2 rounded-lg mb-1.5 flex items-start gap-2 highlight-${h.color}`}
                  style={{ color: modeStyle.text }}
                >
                  <span className="flex-1 italic">"{h.text}"</span>
                  <button onClick={() => deleteHighlight(h.id)} className="opacity-40 hover:opacity-80 flex-shrink-0">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Annotation Sidebar */}
        {showAnnotations && (
          <AnnotationSidebar
            highlights={highlights}
            bookmarks={bookmarks}
            currentPage={currentPage}
            onGoTo={goToPage}
            onDeleteHighlight={deleteHighlight}
            readerMode={readerMode}
          />
        )}
      </div>

      {/* ─── Bottom Nav Bar ─── */}
      <div
        className="flex items-center justify-center gap-4 px-6 py-3 border-t flex-shrink-0"
        style={{ borderColor: readerMode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)' }}
      >
        <button
          onClick={prevPage}
          disabled={currentPage <= 1}
          className="p-2 rounded-xl disabled:opacity-20 hover:bg-black/10 transition-all"
        >
          <ChevronLeft size={18} />
        </button>

        {/* Page input */}
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={currentPage}
            min={1}
            max={numPages}
            onChange={e => goToPage(parseInt(e.target.value) || 1)}
            className="w-14 text-center bg-black/10 rounded-lg px-2 py-1 text-sm
                       font-mono border border-transparent focus:border-current/20
                       focus:outline-none"
            style={{ color: modeStyle.text }}
          />
          <span className="text-sm opacity-40">/ {numPages}</span>
        </div>

        <button
          onClick={nextPage}
          disabled={currentPage >= numPages}
          className="p-2 rounded-xl disabled:opacity-20 hover:bg-black/10 transition-all"
        >
          <ChevronRight size={18} />
        </button>

        {/* Progress */}
        <div className="absolute right-6 flex items-center gap-2 text-xs opacity-40">
          {progress}% complete
        </div>
      </div>
    </div>
  );
}
