import { useRef, useEffect, useCallback, useState, forwardRef, type MutableRefObject } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { type RecentFile } from "../hooks/useRecents";
import { applyHighlights } from "../hooks/usePDF";
import { UploadCloud, FileText } from "lucide-react";
import styles from "./PDFViewer.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PDFViewerProps {
  doc: pdfjsLib.PDFDocumentProxy | null;
  totalPages: number;
  currentPage: number;
  onGoToPage: (page: number) => void;
  searchQuery?: string;
  isDraggingOver?: boolean;
  isLoaded: boolean;
  isLoading: boolean;
  initializing: boolean;
  error: string | null;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomSet: (zoom: number) => void;
  onOpenFile: () => void;
  onNextPage: () => void;
  onPrevPage: () => void;
  recents: RecentFile[];
  onOpenRecent: (filePath: string, fileName: string) => void;
  onRemoveRecent: (fileName: string) => void;
  onClearAllRecents: () => void;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export const PDFViewer = forwardRef<HTMLDivElement, PDFViewerProps>(function PDFViewer(
  {
    doc,
    totalPages,
    currentPage,
    onGoToPage,
    searchQuery = "",
    isDraggingOver = false,
    isLoaded,
    isLoading,
    initializing,
    error,
    zoom,
    onZoomIn,
    onZoomOut,
    onZoomSet,
    onOpenFile,
    onNextPage,
    onPrevPage,
    recents,
    onOpenRecent,
    onRemoveRecent,
    onClearAllRecents,
  }: PDFViewerProps,
  ref: ((node: HTMLDivElement | null) => void) | MutableRefObject<HTMLDivElement | null> | null
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Ctrl+Scroll to zoom ───────────────────────────────────────────────────

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      onZoomSet(Math.max(0.25, Math.min(4.0, zoom + delta)));
    },
    [zoom, onZoomSet]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // ── Drag to pan ───────────────────────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;
    // Don't drag if clicking inside text selection layer
    if ((e.target as HTMLElement).closest(`.${styles.textLayer}`)) return;
    isDragging.current = true;
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
    el.style.cursor = "grabbing";
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollLeft = dragStart.current.scrollLeft - (e.clientX - dragStart.current.x);
    el.scrollTop = dragStart.current.scrollTop - (e.clientY - dragStart.current.y);
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    const el = containerRef.current;
    if (el) el.style.cursor = "";
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const ctrl = e.ctrlKey || e.metaKey;
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          onNextPage();
          break;

        case "ArrowLeft":
          e.preventDefault();
          onPrevPage();
          break;

        case "ArrowDown":
          containerRef.current?.scrollBy({ top: 80, behavior: "smooth" });
          break;

        case "ArrowUp":
          containerRef.current?.scrollBy({ top: -80, behavior: "smooth" });
          break;

        case "0":
          if (ctrl) {
            e.preventDefault();
            onZoomSet(1.0);
          }
          break;

        case "+":
        case "=":
          if (ctrl) {
            e.preventDefault();
            onZoomIn();
          }
          break;

        case "-":
          if (ctrl) {
            e.preventDefault();
            onZoomOut();
          }
          break;

        case "o":
        case "O":
          if (ctrl) {
            e.preventDefault();
            onOpenFile();
          }
          break;

        case " ":
          e.preventDefault();
          if (e.shiftKey) {
            containerRef.current?.scrollBy({
              top: -window.innerHeight * 0.8,
              behavior: "smooth",
            });
          } else {
            containerRef.current?.scrollBy({
              top: window.innerHeight * 0.8,
              behavior: "smooth",
            });
          }
          break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onNextPage, onPrevPage, onZoomIn, onZoomOut, onZoomSet, onOpenFile]);

  // ── Copy: sort text nodes by visual position ──────────────────────────────

  const handleCopy = useCallback((e: React.ClipboardEvent) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const container = (range.commonAncestorContainer as HTMLElement).closest(
      `.${styles.textLayer}`
    );
    if (!container) return;

    const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
        if (!container.contains(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const nodes: { text: string; rect: DOMRect }[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const span = node.parentElement;
      if (!span) continue;
      const rect = span.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      nodes.push({ text: node.textContent ?? "", rect });
    }

    if (nodes.length === 0) return;

    nodes.sort((a, b) => {
      const yDiff = a.rect.top - b.rect.top;
      if (Math.abs(yDiff) > 5) return yDiff;
      return a.rect.left - b.rect.left;
    });

    let result = "";
    for (let i = 0; i < nodes.length; i++) {
      if (i === 0) {
        result += nodes[i].text;
        continue;
      }
      const prev = nodes[i - 1].rect;
      const curr = nodes[i].rect;
      const newLine = curr.top - prev.bottom > 2;
      const hasGap = curr.left - prev.right > 3;
      if (newLine) {
        result += "\n" + nodes[i].text;
      } else if (hasGap && !result.endsWith(" ") && !nodes[i].text.startsWith(" ")) {
        result += " " + nodes[i].text;
      } else {
        result += nodes[i].text;
      }
    }

    if (!result.trim()) return;
    e.clipboardData.setData("text/plain", result);
    e.preventDefault();
  }, []);

  // ── Continuous Scroll: Synchronize Current Page with Viewport ──────────────

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    isUserScrollingRef.current = true;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
    }, 250);

    const container = containerRef.current;
    const containerTop = container.scrollTop;
    const pageEls = container.querySelectorAll<HTMLElement>("[data-page-number]");
    if (pageEls.length === 0) return;

    let closestPage = 1;
    let minDistance = Infinity;

    pageEls.forEach((el) => {
      const pageNum = parseInt(el.dataset.pageNumber || "1", 10);
      const offsetTop = el.offsetTop - container.offsetTop;
      const distance = Math.abs(offsetTop - containerTop - 40);
      if (distance < minDistance) {
        minDistance = distance;
        closestPage = pageNum;
      }
    });

    if (closestPage !== currentPage) {
      onGoToPage(closestPage);
    }
  }, [currentPage, onGoToPage]);

  // ── Smooth Scroll when Target Page is selected externally ──────────────────

  useEffect(() => {
    if (!containerRef.current || isUserScrollingRef.current) return;
    const targetEl = containerRef.current.querySelector<HTMLElement>(
      `[data-page-number="${currentPage}"]`
    );
    if (targetEl) {
      const container = containerRef.current;
      const targetTop = targetEl.offsetTop - container.offsetTop - 24;
      const diff = Math.abs(container.scrollTop - targetTop);
      if (diff > 50) {
        container.scrollTo({ top: targetTop, behavior: "smooth" });
      }
    }
  }, [currentPage]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={(node) => {
        (containerRef as MutableRefObject<HTMLDivElement | null>).current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as MutableRefObject<HTMLDivElement | null>).current = node;
      }}
      className={styles.container}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onScroll={handleScroll}
    >
      {/* ── Drag Overlay ── */}
      {isDraggingOver && (
        <div className={styles.dragOverlay}>
          <UploadCloud size={44} strokeWidth={1.8} color="var(--accent)" />
          <h3 className={styles.dragOverlayTitle}>Drop PDF files here</h3>
          <p className={styles.dragOverlaySub}>Open up to 10 files simultaneously</p>
        </div>
      )}

      {/* ── Initializing / Empty ── */}
      {!isLoaded &&
        !isLoading &&
        !error &&
        (initializing ? (
          <InitializingState />
        ) : (
          <EmptyState
            onOpenFile={onOpenFile}
            recents={recents}
            onOpenRecent={onOpenRecent}
            onRemoveRecent={onRemoveRecent}
            onClearAllRecents={onClearAllRecents}
          />
        ))}

      {/* ── Loading ── */}
      {isLoading && <LoadingState />}

      {/* ── Error ── */}
      {!isLoaded && !!error && <ErrorState message={error} onRetry={onOpenFile} />}

      {/* ── Document Continuous Scroll View ── */}
      {isLoaded && !isLoading && doc && (
        <div className={styles.continuousContainer}>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
            <ContinuousPage
              key={`${doc.loadingTask.docId}-${pageNum}`}
              doc={doc}
              pageNum={pageNum}
              zoom={zoom}
              searchQuery={searchQuery}
              onCopy={handleCopy}
            />
          ))}
        </div>
      )}
    </div>
  );
});

// ─── Continuous Page Component ───────────────────────────────────────────────

function ContinuousPage({
  doc,
  pageNum,
  zoom,
  searchQuery,
  onCopy,
}: {
  doc: pdfjsLib.PDFDocumentProxy;
  pageNum: number;
  zoom: number;
  searchQuery: string;
  onCopy: (e: React.ClipboardEvent) => void;
}) {
  const pageWrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);

  const [isVisible, setIsVisible] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<number>(0.707); // Default A4 ratio
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);

  // ── Measure page dimensions once ──────────────────────────────────────────
  useEffect(() => {
    let active = true;
    doc
      .getPage(pageNum)
      .then((page) => {
        if (!active) return;
        const vp = page.getViewport({ scale: 1.0 });
        setAspectRatio(vp.width / vp.height);
        setPageSize({ width: vp.width, height: vp.height });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [doc, pageNum]);

  // ── Intersection Observer for lazy rendering ──────────────────────────────
  useEffect(() => {
    const el = pageWrapRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      {
        rootMargin: "650px 0px 650px 0px", // Preload pages within 650px of viewport
        threshold: 0.01,
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ── Render page when visible ──────────────────────────────────────────────
  useEffect(() => {
    if (!isVisible) {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      return;
    }

    let active = true;

    async function render() {
      try {
        const page = await doc.getPage(pageNum);
        if (!active) return;

        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: zoom * dpr });
        const canvas = canvasRef.current;
        const textLayer = textLayerRef.current;
        if (!canvas) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / dpr}px`;
        canvas.style.height = `${viewport.height / dpr}px`;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
          renderTaskRef.current = null;
        }

        const task = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;
        renderTaskRef.current = null;

        if (!active || !textLayer) return;

        // Render text layer
        const cssWidth = viewport.width / dpr;
        const cssHeight = viewport.height / dpr;
        const baseViewport = page.getViewport({ scale: 1.0 });
        const scale = cssWidth / baseViewport.width;
        const textVp = page.getViewport({ scale });
        const textContent = await page.getTextContent();

        if (!active) return;

        textLayer.innerHTML = "";
        textLayer.style.width = `${cssWidth}px`;
        textLayer.style.height = `${cssHeight}px`;

        const tl = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayer,
          viewport: textVp,
        });
        await tl.render();
        textLayer.style.setProperty("--scale-factor", String(scale));

        if (searchQuery) {
          applyHighlights(textLayer, searchQuery);
        }
      } catch (err: unknown) {
        const isCancelled =
          err instanceof Error &&
          (err.message.includes("cancelled") || err.message.includes("canceled"));
        if (!isCancelled) console.error(`Error rendering page ${pageNum}:`, err);
      }
    }

    render();

    return () => {
      active = false;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [isVisible, doc, pageNum, zoom, searchQuery]);

  const computedWidth = pageSize ? pageSize.width * zoom : 600 * zoom;
  const computedHeight = pageSize ? pageSize.height * zoom : computedWidth / aspectRatio;

  return (
    <div
      ref={pageWrapRef}
      data-page-number={pageNum}
      className={styles.continuousPageWrap}
      style={{
        width: `${computedWidth}px`,
        minHeight: `${computedHeight}px`,
      }}
    >
      <span className={styles.pageNumberTag}>Page {pageNum}</span>
      <div
        className={styles.pageShadow}
        style={{
          width: `${computedWidth}px`,
          height: `${computedHeight}px`,
        }}
      >
        <div style={{ position: "relative", lineHeight: 0, width: "100%", height: "100%" }}>
          <canvas
            ref={canvasRef}
            className={styles.canvas}
            style={{
              display: isVisible ? "block" : "none",
            }}
          />
          <div
            ref={textLayerRef}
            className={styles.textLayer}
            onCopy={onCopy}
            style={{
              display: isVisible ? "block" : "none",
            }}
          />
          {!isVisible && (
            <div
              className={styles.continuousPlaceholder}
              style={{ width: `${computedWidth}px`, height: `${computedHeight}px` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function InitializingState() {
  return (
    <div className={styles.loadingState}>
      <div className={styles.spinner} />
    </div>
  );
}

function LoadingState() {
  return (
    <div className={styles.loadingState}>
      <div className={styles.spinner} />
      <p className={styles.loadingText}>Loading document…</p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={styles.errorState}>
      <div className={styles.errorIcon}>⚠</div>
      <h3 className={styles.errorTitle}>Failed to load PDF</h3>
      <p className={styles.errorMessage}>{message}</p>
      <button className={styles.emptyBtn} onClick={onRetry}>
        Try another file
      </button>
    </div>
  );
}

function EmptyState({
  onOpenFile,
  recents,
  onOpenRecent,
  onRemoveRecent,
  onClearAllRecents,
}: {
  onOpenFile: () => void;
  recents: RecentFile[];
  onOpenRecent: (filePath: string, fileName: string) => void;
  onRemoveRecent: (fileName: string) => void;
  onClearAllRecents: () => void;
}) {
  const hasRecents = recents.length > 0;

  const formatDate = (ts: number) => {
    const diff = Math.floor((Date.now() - ts) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    if (diff < 7) return `${diff} days ago`;
    return new Date(ts).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className={hasRecents ? styles.emptyStateTop : styles.emptyStateCentered}>
      {/* Hero section */}
      <div className={styles.emptyHero}>
        <div className={styles.emptyIcon}>
          <svg width="40" height="48" viewBox="0 0 56 64" fill="none">
            <rect
              x="1"
              y="1"
              width="54"
              height="62"
              rx="5"
              fill="none"
              stroke="var(--border)"
              strokeWidth="1.5"
            />
            <rect
              x="1"
              y="1"
              width="54"
              height="62"
              rx="5"
              fill="var(--bg-button)"
              fillOpacity="0.4"
            />
            <path d="M36 1v14a2 2 0 002 2h14" stroke="var(--border)" strokeWidth="1.5" />
            <rect x="12" y="26" width="32" height="2" rx="1" fill="var(--border)" />
            <rect x="12" y="34" width="24" height="2" rx="1" fill="var(--border)" />
            <rect x="12" y="42" width="20" height="2" rx="1" fill="var(--border)" />
          </svg>
        </div>
        <h2 className={styles.emptyTitle}>PDF Reader</h2>
        <p className={styles.emptySubtitle}>Fast, minimal, distraction-free</p>
        <button className={styles.emptyBtn} onClick={onOpenFile}>
          Open PDF
        </button>
        <p className={styles.emptyHint}>Ctrl+O · Supports up to 10 files</p>
      </div>

      {/* Recents Section: Modern Card-Wise Grid */}
      {hasRecents && (
        <div className={styles.recentsWrap}>
          <div className={styles.recentsHeader}>
            <span className={styles.recentsLabel}>Recent Documents</span>
            <div className={styles.recentsActions}>
              <span className={styles.recentsCount}>{recents.length} files</span>
              <span className={styles.recentsDot}>·</span>
              <button
                className={styles.clearRecentsBtn}
                onClick={onClearAllRecents}
                title="Clear all recent documents and storage"
              >
                Clear all
              </button>
            </div>
          </div>

          <div className={styles.recentsGrid}>
            {recents.map((r) => (
              <div
                key={r.fileName}
                className={styles.recentCard}
                onClick={() => onOpenRecent(r.filePath, r.fileName)}
                title={r.filePath || r.fileName}
              >
                <div className={styles.recentCardThumb}>
                  <div className={styles.recentCardFileIcon}>
                    <FileText size={36} strokeWidth={1.5} color="var(--text-secondary)" />
                  </div>
                  <span className={styles.pdfBadge}>PDF</span>
                </div>

                <div className={styles.recentCardBody}>
                  <span className={styles.recentCardTitle}>{r.fileName}</span>
                  <span className={styles.recentCardMeta}>
                    {r.totalPages > 0 ? `Page ${r.lastPage} of ${r.totalPages} · ` : ""}
                    {formatDate(r.openedAt)}
                  </span>
                </div>

                <button
                  className={styles.recentCardDelete}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveRecent(r.fileName);
                  }}
                  title="Remove from recents"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
