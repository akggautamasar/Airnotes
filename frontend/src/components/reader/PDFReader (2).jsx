import React, {
  useState, useEffect, useRef, useCallback
} from 'react';
import {
  X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2, Minimize2,
  Bookmark, BookmarkCheck, Highlighter, MessageSquare, Sun, Moon,
  Coffee, Layers, RotateCcw, Menu
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
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('/pdf.worker.min.mjs', import.meta.url).href;
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
  const [scale, setScale] = useState(1.2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [renderingPage, setRenderingPage] = useState(false);

  // UI state
  const [fullscreen, setFullscreen] = useState(false);
  const [showThumbs, setShowThumbs] = useState(false);   // off by default on mobile
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  // Annotation state
  const [highlights, setHighlights] = useState([]);
  const [bookmarks, setBookmarks] = useState([]);
  const [activeHighlightColor, setActiveHighlightColor] = useState('yellow');
  const [highlightMode, setHighlightMode] = useState(false);

  // Refs
  const canvasRef = useRef(null);
  const textLayerRef = useRef(null);
  const containerRef = useRef(null);
  const renderTaskRef = useRef(null);
  const pageRef = useRef(currentPage);
  pageRef.current = currentPage;

  const modeStyle = READER_MODES[readerMode];

  // Track mobile/desktop
  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setShowThumbs(false);
        setShowAnnotations(false);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Fit scale to screen width on mount / resize
  useEffect(() => {
    const updateScale = () => {
      const w = window.innerWidth;
      if (w < 480) setScale(0.7);
      else if (w < 768) setScale(0.9);
      else if (w < 1024) setScale(1.1);
      else setScale(1.3);
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  // Load PDF
  useEffect(() => {
    if (!file) return;
    loadPDF();
    loadAnnotations();
    restoreProgress();

    const handleKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextPage();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') prevPage();
      if (e.key === 'Escape') actions.closeFile();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [file]);

  // Touch swipe support
  useEffect(() => {
    let startX = 0;
    const onTouchStart = (e) => { startX = e.touches[0].clientX; };
    const onTouchEnd = (e) => {
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 60) {
        if (dx < 0) nextPage();
        else prevPage();
      }
    };
    const el = containerRef.current;
    el?.addEventListener('touchstart', onTouchStart, { passive: true });
    el?.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el?.removeEventListener('touchstart', onTouchStart);
      el?.removeEventListener('touchend', onTouchEnd);
    };
  }, [containerRef.current, numPages]);

  async function loadPDF() {
    setLoading(true);
    setError('');
    try {
      const lib = await getPdfJs();
      const streamUrl = api.getStreamUrl(file.id);
      const loadingTask = lib.getDocument({
        url: streamUrl,
        withCredentials: false,
        httpHeaders: { Authorization: `Bearer ${localStorage.getItem('airnotes_token')}` },
        rangeChunkSize: 131072, // 128KB chunks — better for large files
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
    if (prog && prog.currentPage > 1) setCurrentPage(prog.currentPage);
  }

  // Render page
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

      if (textLayerRef.current) {
        textLayerRef.current.innerHTML = '';
        textLayerRef.current.style.width = `${viewport.width}px`;
        textLayerRef.current.style.height = `${viewport.height}px`;
        const textContent = await page.getTextContent();
        const lib = await getPdfJs();
        if (lib.renderTextLayer) {
          lib.renderTextLayer({ textContentSource: textContent, container: textLayerRef.current, viewport, textDivs: [] });
        }
      }

      await progressStore.save(file.id, pageNum, pdfDoc.numPages);
      const bookmarked = await bookmarkStore.isBookmarked(file.id, pageNum);
      setIsBookmarked(bookmarked);
    } catch (e) {
      if (e.name !== 'RenderingCancelledException') console.error('Render error:', e);
    } finally {
      setRenderingPage(false);
    }
  }, [pdfDoc, scale, readerMode, file]);

  const nextPage = useCallback(() => setCurrentPage(p => Math.min(p + 1, numPages)), [numPages]);
  const prevPage = useCallback(() => setCurrentPage(p => Math.max(p - 1, 1)), []);
  const goToPage = useCallback((n) => setCurrentPage(Math.max(1, Math.min(n, numPages))), [numPages]);

  const zoomIn  = () => setScale(s => Math.min(s + 0.2, 4.0));
  const zoomOut = () => setScale(s => Math.max(s - 0.2, 0.4));
  const resetZoom = () => setScale(isMobile ? 0.9 : 1.3);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setFullscreen(true);
    } else {
      document.exitFullscreen();
      setFullscreen(false);
    }
  }

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

  async function handleTextSelection() {
    if (!highlightMode) return;
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!text || text.length < 2) return;
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

  const progress = numPages > 0 ? Math.round((currentPage / numPages) * 100) : 0;
  const pageHighlights = highlights.filter(h => h.page === currentPage);
  const title = cleanFileName(file.name);

  if (!file) return null;

  const borderColor = readerMode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.1)';

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-40 flex flex-col"
      style={{ background: modeStyle.bg, color: modeStyle.text }}
    >
      {/* ─── Top Toolbar ─── */}
      <div
        className="flex items-center gap-1 px-2 md:px-4 py-2 border-b flex-shrink-0"
        style={{ borderColor }}
      >
        {/* Close */}
        <button
          onClick={() => actions.closeFile()}
          className="p-1.5 rounded-lg hover:bg-black/10 transition-colors opacity-60 hover:opacity-100 flex-shrink-0"
        >
          <X size={16} />
        </button>

        {/* Title */}
        <div className="flex-1 min-w-0 px-1 md:px-2">
          <p className="text-xs md:text-sm font-medium truncate opacity-80">{title}</p>
          <p className="text-[9px] md:text-[10px] opacity-40 hidden sm:block">{currentPage} / {numPages} pages · {progress}%</p>
        </div>

        {/* Desktop controls */}
        <div className="hidden md:flex items-center gap-1">
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
                className={`p-1.5 rounded-md transition-all ${readerMode === key ? 'bg-white/20 opacity-100' : 'opacity-40 hover:opacity-70'}`}
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

          <button onClick={toggleBookmark} title={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
            className={`p-1.5 rounded-lg transition-all ${isBookmarked ? 'text-amber-400' : 'opacity-50 hover:opacity-100'}`}>
            {isBookmarked ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
          </button>

          <button onClick={() => setHighlightMode(!highlightMode)} title="Highlight"
            className={`p-1.5 rounded-lg transition-all ${highlightMode ? 'bg-yellow-400/20 text-yellow-400' : 'opacity-50 hover:opacity-100'}`}>
            <Highlighter size={15} />
          </button>

          <button onClick={() => { setShowAnnotations(!showAnnotations); setShowThumbs(false); }} title="Annotations"
            className={`p-1.5 rounded-lg transition-all ${showAnnotations ? 'bg-black/20' : 'opacity-50 hover:opacity-100'}`}>
            <MessageSquare size={15} />
          </button>

          <button onClick={() => { setShowThumbs(!showThumbs); setShowAnnotations(false); }} title="Thumbnails"
            className={`p-1.5 rounded-lg transition-all ${showThumbs ? 'bg-black/20' : 'opacity-50 hover:opacity-100'}`}>
            <Layers size={15} />
          </button>

          <button onClick={toggleFullscreen} title="Fullscreen"
            className="p-1.5 rounded-lg opacity-50 hover:opacity-100 transition-all">
            {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>

        {/* Mobile: zoom + menu */}
        <div className="flex md:hidden items-center gap-1">
          <button onClick={zoomOut} className="p-1.5 opacity-60 hover:opacity-100"><ZoomOut size={15} /></button>
          <span className="text-[10px] font-mono opacity-50 w-8 text-center">{Math.round(scale * 100)}%</span>
          <button onClick={zoomIn} className="p-1.5 opacity-60 hover:opacity-100"><ZoomIn size={15} /></button>
          <button
            onClick={() => setShowMobileMenu(!showMobileMenu)}
            className="p-1.5 rounded-lg opacity-60 hover:opacity-100 relative"
          >
            <Menu size={16} />
          </button>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {showMobileMenu && (
        <div
          className="md:hidden flex flex-wrap gap-2 px-3 py-2 border-b flex-shrink-0"
          style={{ borderColor, background: modeStyle.bg }}
        >
          {/* Reading mode */}
          <div className="flex items-center gap-0.5 bg-black/10 rounded-lg p-0.5">
            {[
              { key: 'dark',  icon: Moon },
              { key: 'sepia', icon: Coffee },
              { key: 'light', icon: Sun },
            ].map(({ key, icon: Icon }) => (
              <button key={key} onClick={() => { actions.setReaderMode(key); }}
                className={`p-1.5 rounded-md transition-all ${readerMode === key ? 'bg-white/20 opacity-100' : 'opacity-40'}`}>
                <Icon size={14} />
              </button>
            ))}
          </div>

          <button onClick={toggleBookmark}
            className={`p-1.5 rounded-lg transition-all ${isBookmarked ? 'text-amber-400' : 'opacity-50'}`}>
            {isBookmarked ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
          </button>

          <button onClick={() => { setHighlightMode(!highlightMode); setShowMobileMenu(false); }}
            className={`p-1.5 rounded-lg ${highlightMode ? 'bg-yellow-400/20 text-yellow-400' : 'opacity-50'}`}>
            <Highlighter size={16} />
          </button>

          <button onClick={() => { setShowThumbs(!showThumbs); setShowAnnotations(false); setShowMobileMenu(false); }}
            className={`p-1.5 rounded-lg ${showThumbs ? 'bg-black/20' : 'opacity-50'}`}>
            <Layers size={16} />
          </button>

          <button onClick={() => { setShowAnnotations(!showAnnotations); setShowThumbs(false); setShowMobileMenu(false); }}
            className={`p-1.5 rounded-lg ${showAnnotations ? 'bg-black/20' : 'opacity-50'}`}>
            <MessageSquare size={16} />
          </button>

          <button onClick={toggleFullscreen} className="p-1.5 rounded-lg opacity-50">
            {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>

          <button onClick={resetZoom} className="p-1.5 rounded-lg opacity-50">
            <RotateCcw size={16} />
          </button>
        </div>
      )}

      {/* Progress bar */}
      <div className="h-0.5 flex-shrink-0" style={{ background: 'rgba(0,0,0,0.1)' }}>
        <div className="progress-bar h-full transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      {/* ─── Main Content ─── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Thumbnail Sidebar — overlay on mobile, fixed width on desktop */}
        {showThumbs && pdfDoc && (
          <>
            {/* Mobile: overlay with backdrop */}
            {isMobile && (
              <div className="absolute inset-0 z-10 flex">
                <div className="w-36 h-full overflow-y-auto flex-shrink-0" style={{ zIndex: 20 }}>
                  <ThumbnailSidebar
                    pdfDoc={pdfDoc}
                    numPages={numPages}
                    currentPage={currentPage}
                    onGoTo={(p) => { goToPage(p); setShowThumbs(false); }}
                    bookmarks={bookmarks}
                    readerMode={readerMode}
                  />
                </div>
                <div className="flex-1 bg-black/40" onClick={() => setShowThumbs(false)} />
              </div>
            )}
            {/* Desktop: inline */}
            {!isMobile && (
              <ThumbnailSidebar
                pdfDoc={pdfDoc}
                numPages={numPages}
                currentPage={currentPage}
                onGoTo={goToPage}
                bookmarks={bookmarks}
                readerMode={readerMode}
              />
            )}
          </>
        )}

        {/* PDF Canvas Area */}
        <div
          className="flex-1 overflow-auto flex flex-col items-center py-4 md:py-8 px-2 md:px-4"
          style={{ background: readerMode === 'dark' ? '#161210' : readerMode === 'sepia' ? '#ede8de' : '#e8e8e8' }}
          onMouseUp={handleTextSelection}
        >
          {loading && (
            <div className="flex flex-col items-center justify-center flex-1 gap-4">
              <div className="w-8 h-8 border-2 border-current border-t-transparent rounded-full animate-spin opacity-40" />
              <p className="text-sm opacity-40">Loading PDF…</p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center px-6">
              <p className="text-red-400 font-medium text-sm">Failed to load PDF</p>
              <p className="text-xs opacity-50 max-w-xs">{error}</p>
              <button onClick={loadPDF} className="btn-primary text-sm mt-2 px-4 py-2 rounded-lg bg-amber-600 text-white">
                Retry
              </button>
            </div>
          )}

          {!loading && !error && (
            <div className="pdf-page-wrapper relative shadow-2xl" style={{ maxWidth: '100%' }}>
              <canvas
                ref={canvasRef}
                style={{ filter: modeStyle.canvas, display: 'block', maxWidth: '100%', height: 'auto' }}
              />
              <div
                ref={textLayerRef}
                className="absolute top-0 left-0 overflow-hidden"
                style={{
                  position: 'absolute', top: 0, left: 0,
                  cursor: highlightMode ? 'crosshair' : 'text',
                  userSelect: 'text',
                }}
              />
              {highlightMode && (
                <div className="absolute top-3 right-3 flex gap-1.5 bg-black/60 backdrop-blur-sm rounded-xl p-1.5">
                  {['yellow', 'green', 'blue', 'pink'].map(color => (
                    <button
                      key={color}
                      onClick={() => setActiveHighlightColor(color)}
                      className={`w-5 h-5 rounded-full transition-transform ${activeHighlightColor === color ? 'scale-125 ring-2 ring-white/50' : ''}`}
                      style={{ background: { yellow: '#fbbf24', green: '#4ade80', blue: '#60a5fa', pink: '#fb7185' }[color] }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Page highlights */}
          {pageHighlights.length > 0 && !loading && (
            <div className="mt-3 w-full max-w-lg px-2">
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

        {/* Annotation Sidebar — overlay on mobile */}
        {showAnnotations && (
          <>
            {isMobile && (
              <div className="absolute inset-0 z-10 flex justify-end">
                <div className="w-64 h-full overflow-y-auto" style={{ zIndex: 20 }}>
                  <AnnotationSidebar
                    highlights={highlights}
                    bookmarks={bookmarks}
                    currentPage={currentPage}
                    onGoTo={(p) => { goToPage(p); setShowAnnotations(false); }}
                    onDeleteHighlight={deleteHighlight}
                    readerMode={readerMode}
                  />
                </div>
                <div className="absolute inset-0 bg-black/40" style={{ zIndex: 15 }} onClick={() => setShowAnnotations(false)} />
              </div>
            )}
            {!isMobile && (
              <AnnotationSidebar
                highlights={highlights}
                bookmarks={bookmarks}
                currentPage={currentPage}
                onGoTo={goToPage}
                onDeleteHighlight={deleteHighlight}
                readerMode={readerMode}
              />
            )}
          </>
        )}
      </div>

      {/* ─── Bottom Nav Bar ─── */}
      <div
        className="flex items-center justify-center gap-2 md:gap-4 px-4 py-2 md:py-3 border-t flex-shrink-0"
        style={{ borderColor }}
      >
        <button
          onClick={prevPage}
          disabled={currentPage <= 1}
          className="p-2 rounded-xl disabled:opacity-20 hover:bg-black/10 transition-all"
        >
          <ChevronLeft size={isMobile ? 20 : 18} />
        </button>

        <div className="flex items-center gap-2">
          <input
            type="number"
            value={currentPage}
            min={1}
            max={numPages}
            onChange={e => goToPage(parseInt(e.target.value) || 1)}
            className="w-12 md:w-14 text-center bg-black/10 rounded-lg px-1 py-1 text-xs md:text-sm font-mono border border-transparent focus:outline-none"
            style={{ color: modeStyle.text }}
          />
          <span className="text-xs md:text-sm opacity-40">/ {numPages}</span>
        </div>

        <button
          onClick={nextPage}
          disabled={currentPage >= numPages}
          className="p-2 rounded-xl disabled:opacity-20 hover:bg-black/10 transition-all"
        >
          <ChevronRight size={isMobile ? 20 : 18} />
        </button>

        {/* Progress — hidden on very small screens */}
        <div className="hidden sm:flex absolute right-4 items-center gap-1 text-xs opacity-30">
          {progress}%
        </div>
      </div>
    </div>
  );
}
