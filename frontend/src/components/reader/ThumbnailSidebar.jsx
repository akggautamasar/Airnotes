import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Bookmark } from 'lucide-react';

export default function ThumbnailSidebar({ pdfDoc, numPages, currentPage, onGoTo, bookmarks, readerMode }) {
  const [thumbs, setThumbs] = useState({});
  const containerRef = useRef(null);
  const observerRef = useRef(null);
  const renderQueueRef = useRef([]);
  const renderingRef = useRef(false);
  const bookmarkedPages = new Set(bookmarks.map(b => b.page));

  useEffect(() => {
    observerRef.current = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const pageNum = parseInt(entry.target.dataset.page);
        if (entry.isIntersecting && !thumbs[pageNum]) { renderQueueRef.current.push(pageNum); processQueue(); }
      });
    }, { root: containerRef.current, rootMargin: '200px', threshold: 0 });
    return () => observerRef.current?.disconnect();
  }, [thumbs]);

  const processQueue = useCallback(async () => {
    if (renderingRef.current || renderQueueRef.current.length === 0) return;
    renderingRef.current = true;
    const pageNum = renderQueueRef.current.shift();
    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 0.18 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      setThumbs(prev => ({ ...prev, [pageNum]: canvas.toDataURL('image/jpeg', 0.7) }));
    } catch (e) { if (e.name !== 'RenderingCancelledException') console.warn(e); }
    finally { renderingRef.current = false; setTimeout(processQueue, 20); }
  }, [pdfDoc]);

  useEffect(() => {
    containerRef.current?.querySelector(`[data-page="${currentPage}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [currentPage]);

  const bg = readerMode === 'dark' ? '#0a0806' : readerMode === 'sepia' ? '#e8e2d8' : '#e0e0e0';

  return (
    <div ref={containerRef} className="w-36 flex-shrink-0 overflow-y-auto border-r flex flex-col gap-2 py-3 px-2"
      style={{ background: bg, borderColor: 'rgba(255,255,255,0.06)' }}>
      {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
        <ThumbItem key={pageNum} pageNum={pageNum} thumb={thumbs[pageNum]}
          isActive={pageNum === currentPage} isBookmarked={bookmarkedPages.has(pageNum)}
          onClick={() => onGoTo(pageNum)} observerRef={observerRef} readerMode={readerMode} />
      ))}
    </div>
  );
}

function ThumbItem({ pageNum, thumb, isActive, isBookmarked, onClick, observerRef, readerMode }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el && observerRef.current) { observerRef.current.observe(el); return () => observerRef.current?.unobserve(el); }
  }, []);
  const activeBorder = readerMode === 'sepia' ? '#7d6344' : '#967852';
  return (
    <div ref={ref} data-page={pageNum} onClick={onClick} className="relative cursor-pointer rounded-lg overflow-hidden flex-shrink-0 transition-all"
      style={{ border: isActive ? `2px solid ${activeBorder}` : '2px solid transparent' }}>
      {thumb ? <img src={thumb} alt={`Page ${pageNum}`} className="w-full block" />
        : <div className="w-full aspect-[3/4] flex items-center justify-center text-xs opacity-20" style={{ background: '#1c1610' }}>{pageNum}</div>}
      {isBookmarked && <div className="absolute top-1 right-1"><Bookmark size={10} className="text-amber-400 fill-amber-400" /></div>}
      <div className="absolute bottom-0 left-0 right-0 text-center text-[9px] py-0.5 font-mono" style={{ background:'rgba(0,0,0,0.4)', color:'#fff' }}>{pageNum}</div>
    </div>
  );
}
