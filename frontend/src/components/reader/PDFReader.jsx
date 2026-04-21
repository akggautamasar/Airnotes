import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
  Bookmark, BookmarkCheck, Highlighter, MessageSquare,
  Sun, Moon, Coffee, Layers
} from 'lucide-react';

import { useApp } from '../../store/AppContext';
import { api } from '../../utils/api';
import { highlightStore, bookmarkStore, progressStore } from '../../utils/storage';
import { cleanFileName } from '../../utils/format';
import ThumbnailSidebar from './ThumbnailSidebar';
import AnnotationSidebar from './AnnotationSidebar';

// ✅ FIXED: Local worker (no CDN)
import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const READER_MODES = {
  dark: { bg: '#0e0b08', text: '#e8ddd0', canvas: 'brightness(0.88) contrast(1.05)' },
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
  const [showThumbs, setShowThumbs] = useState(true);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [highlights, setHighlights] = useState([]);
  const [bookmarks, setBookmarks] = useState([]);
  const [highlightMode, setHighlightMode] = useState(false);
  const [activeHighlightColor, setActiveHighlightColor] = useState('yellow');

  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);

  const modeStyle = READER_MODES[readerMode];

  // 🔹 Load PDF
  useEffect(() => {
    if (!file) return;

    loadPDF();
    loadAnnotations();
    restoreProgress();

    const handleKey = (e) => {
      if (e.key === 'ArrowRight') setCurrentPage(p => Math.min(p + 1, numPages));
      if (e.key === 'ArrowLeft') setCurrentPage(p => Math.max(p - 1, 1));
      if (e.key === 'Escape') actions.closeFile();
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [file]);

  async function loadPDF() {
    setLoading(true);
    setError('');

    try {
      const doc = await pdfjsLib.getDocument({
        url: api.getStreamUrl(file.id),
        httpHeaders: {
          Authorization: `Bearer ${localStorage.getItem('airnotes_token')}`
        },
        rangeChunkSize: 65536,
      }).promise;

      setPdfDoc(doc);
      setNumPages(doc.numPages);
      setLoading(false);
    } catch (e) {
      setError(e.message || 'Failed to load PDF');
      setLoading(false);
    }
  }

  async function loadAnnotations() {
    const hl = await highlightStore.getByFile(file.id);
    const bm = await bookmarkStore.getByFile(file.id);
    setHighlights(hl);
    setBookmarks(bm);
  }

  async function restoreProgress() {
    const prog = await progressStore.get(file.id);
    if (prog?.currentPage) setCurrentPage(prog.currentPage);
  }

  // 🔹 Render page
  useEffect(() => {
    if (pdfDoc && canvasRef.current) renderPage(currentPage);
  }, [pdfDoc, currentPage, scale]);

  const renderPage = useCallback(async (pageNum) => {
    if (!pdfDoc || !canvasRef.current) return;

    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
    }

    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      const canvas = canvasRef.current;
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const renderTask = page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
      });

      renderTaskRef.current = renderTask;
      await renderTask.promise;

      await progressStore.save(file.id, pageNum, pdfDoc.numPages);
      setIsBookmarked(await bookmarkStore.isBookmarked(file.id, pageNum));

    } catch (e) {
      if (e.name !== 'RenderingCancelledException') console.error(e);
    }
  }, [pdfDoc, scale]);

  async function toggleBookmark() {
    if (isBookmarked) {
      await bookmarkStore.remove(file.id, currentPage);
      setIsBookmarked(false);
    } else {
      await bookmarkStore.add(file.id, currentPage);
      setIsBookmarked(true);
    }
  }

  if (!file) return null;

  const progress = numPages ? Math.round((currentPage / numPages) * 100) : 0;

  return (
    <div className="fixed inset-0 flex flex-col z-40"
         style={{ background: modeStyle.bg, color: modeStyle.text }}>

      {/* Top Bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b">
        <button onClick={() => actions.closeFile()}>
          <X size={18} />
        </button>

        <div className="flex-1">
          {cleanFileName(file.name)}
        </div>

        <button onClick={toggleBookmark}>
          {isBookmarked ? <BookmarkCheck /> : <Bookmark />}
        </button>
      </div>

      {/* Progress */}
      <div className="h-1 bg-gray-700">
        <div className="bg-yellow-500 h-full"
             style={{ width: `${progress}%` }} />
      </div>

      {/* Main */}
      <div className="flex flex-1 overflow-hidden">

        {showThumbs && pdfDoc && (
          <ThumbnailSidebar
            pdfDoc={pdfDoc}
            numPages={numPages}
            currentPage={currentPage}
            onGoTo={setCurrentPage}
            bookmarks={bookmarks}
          />
        )}

        <div className="flex-1 flex justify-center items-center overflow-auto">
          {loading && <p>Loading PDF…</p>}
          {error && <p className="text-red-400">{error}</p>}
          {!loading && !error && (
            <canvas ref={canvasRef} />
          )}
        </div>

        {showAnnotations && (
          <AnnotationSidebar
            highlights={highlights}
            bookmarks={bookmarks}
            currentPage={currentPage}
            onGoTo={setCurrentPage}
          />
        )}
      </div>

      {/* Bottom Controls */}
      <div className="flex justify-center gap-4 p-3 border-t">
        <button onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}>
          <ChevronLeft />
        </button>

        <span>{currentPage} / {numPages}</span>

        <button onClick={() => setCurrentPage(p => Math.min(p + 1, numPages))}>
          <ChevronRight />
        </button>
      </div>
    </div>
  );
}
