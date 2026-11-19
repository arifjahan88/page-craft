import { useRef, useEffect, useCallback, useState, forwardRef, type ForwardedRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { type RecentFile } from "../hooks/useRecents";
import { applyHighlights } from "../hooks/usePDF";
import {
  UploadCloud,
  FileText,
  FolderOpen,
  ImagePlus,
  Check,
  CheckSquare,
  Trash2,
} from "lucide-react";
import { ConfirmModal } from "./ConfirmModal";
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
  onOpenMakePDF: () => void;
  onNextPage: () => void;
  onPrevPage: () => void;
  recents: RecentFile[];
  onOpenRecent: (filePath: string, fileName: string) => void;
  onOpenMultipleRecents?: (selected: RecentFile[]) => void;
  onRemoveRecent: (fileName: string) => void;
  onRemoveMultipleRecents?: (fileNames: string[]) => void;
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
    onOpenMakePDF,
    onNextPage,
    onPrevPage,
    recents,
    onOpenRecent,
    onOpenMultipleRecents,
    onRemoveRecent,
    onRemoveMultipleRecents,
    onClearAllRecents,
  }: PDFViewerProps,
  ref: ForwardedRef<HTMLDivElement>
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
        containerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
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
            onOpenMakePDF={onOpenMakePDF}
            recents={recents}
            onOpenRecent={onOpenRecent}
            onOpenMultipleRecents={onOpenMultipleRecents}
            onRemoveRecent={onRemoveRecent}
            onRemoveMultipleRecents={onRemoveMultipleRecents}
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
  onOpenMakePDF,
  recents,
  onOpenRecent,
  onOpenMultipleRecents,
  onRemoveRecent,
  onRemoveMultipleRecents,
  onClearAllRecents,
}: {
  onOpenFile: () => void;
  onOpenMakePDF: () => void;
  recents: RecentFile[];
  onOpenRecent: (filePath: string, fileName: string) => void;
  onOpenMultipleRecents?: (selected: RecentFile[]) => void;
  onRemoveRecent: (fileName: string) => void;
  onRemoveMultipleRecents?: (fileNames: string[]) => void;
  onClearAllRecents: () => void;
}) {
  const hasRecents = recents.length > 0;
  const [selectedFileNames, setSelectedFileNames] = useState<Set<string>>(new Set());
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);

  // Clean up selected names that might have been removed
  useEffect(() => {
    setSelectedFileNames((prev) => {
      if (prev.size === 0) return prev;
      const validNames = new Set(recents.map((r) => r.fileName));
      const next = new Set<string>();
      for (const name of prev) {
        if (validNames.has(name)) next.add(name);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [recents]);

  const isSelecting = selectedFileNames.size > 0;

  const handleToggleSelect = useCallback((fileName: string) => {
    setSelectedFileNames((prev) => {
      const next = new Set(prev);
      if (next.has(fileName)) next.delete(fileName);
      else next.add(fileName);
      return next;
    });
    setLastSelected(fileName);
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedFileNames(new Set(recents.map((r) => r.fileName)));
  }, [recents]);

  const handleClearSelection = useCallback(() => {
    setSelectedFileNames(new Set());
    setLastSelected(null);
  }, []);

  const handleCardClick = useCallback(
    (e: React.MouseEvent, r: RecentFile) => {
      // If Shift is pressed and we have a lastSelected:
      if (e.shiftKey && lastSelected) {
        e.preventDefault();
        const idx1 = recents.findIndex((item) => item.fileName === lastSelected);
        const idx2 = recents.findIndex((item) => item.fileName === r.fileName);
        if (idx1 !== -1 && idx2 !== -1) {
          const start = Math.min(idx1, idx2);
          const end = Math.max(idx1, idx2);
          const range = recents.slice(start, end + 1).map((item) => item.fileName);
          setSelectedFileNames((prev) => new Set([...prev, ...range]));
          return;
        }
      }

      // If Ctrl/Cmd is pressed, or if currently in selection mode:
      if (e.ctrlKey || e.metaKey || isSelecting) {
        e.preventDefault();
        handleToggleSelect(r.fileName);
        return;
      }

      // Normal click opens immediately
      onOpenRecent(r.filePath, r.fileName);
    },
    [isSelecting, lastSelected, recents, handleToggleSelect, onOpenRecent]
  );

  const handleOpenSelected = useCallback(() => {
    const selected = recents.filter((r) => selectedFileNames.has(r.fileName));
    if (selected.length === 0) return;
    if (selected.length === 1) {
      onOpenRecent(selected[0].filePath, selected[0].fileName);
    } else if (onOpenMultipleRecents) {
      onOpenMultipleRecents(selected);
    }
    handleClearSelection();
  }, [recents, selectedFileNames, onOpenRecent, onOpenMultipleRecents, handleClearSelection]);

  const handleOpenAll = useCallback(() => {
    if (recents.length === 0) return;
    if (onOpenMultipleRecents) {
      onOpenMultipleRecents(recents.slice(0, 10));
    } else {
      onOpenRecent(recents[0].filePath, recents[0].fileName);
    }
  }, [recents, onOpenMultipleRecents, onOpenRecent]);

  const handlePromptClearAll = useCallback(() => {
    setConfirmAction({
      title: "Clear Recent Documents?",
      message: `Are you sure you want to clear all ${recents.length} recent documents? This will also remove their saved page positions and offline cache.`,
      confirmLabel: "Clear All",
      onConfirm: () => {
        onClearAllRecents();
        setConfirmAction(null);
      },
    });
  }, [recents.length, onClearAllRecents]);

  const handlePromptDeleteSelected = useCallback(() => {
    const names = Array.from(selectedFileNames);
    if (names.length === 0) return;
    setConfirmAction({
      title: "Remove from Recents?",
      message: `Are you sure you want to remove ${names.length} selected document${names.length > 1 ? "s" : ""} from your recent documents list?`,
      confirmLabel: "Remove",
      onConfirm: () => {
        if (onRemoveMultipleRecents) {
          onRemoveMultipleRecents(names);
        } else {
          for (const name of names) onRemoveRecent(name);
        }
        handleClearSelection();
        setConfirmAction(null);
      },
    });
  }, [selectedFileNames, onRemoveMultipleRecents, onRemoveRecent, handleClearSelection]);

  const handlePromptDeleteSingle = useCallback(
    (fileName: string) => {
      setConfirmAction({
        title: "Remove from Recents?",
        message: `Are you sure you want to remove "${fileName}" from your recent documents list?`,
        confirmLabel: "Remove",
        onConfirm: () => {
          onRemoveRecent(fileName);
          setConfirmAction(null);
        },
      });
    },
    [onRemoveRecent]
  );

  // Global key listener for selection shortcuts
  useEffect(() => {
    if (!isSelecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClearSelection();
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleOpenSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isSelecting, handleClearSelection, handleOpenSelected]);

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
      {/* ── Aesthetic Background (Aurora Glows, Subtle Grid & Fluid Waves) ── */}
      <div className={styles.aestheticBg} aria-hidden="true">
        <div className={styles.auroraOrb1} />
        <div className={styles.auroraOrb2} />
        <div className={styles.auroraOrb3} />
        <div className={styles.dotGridOverlay} />
        <div className={styles.waveContainer}>
          <svg
            className={styles.waveSvg}
            viewBox="0 0 1440 380"
            fill="none"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="waveGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="var(--wave-grad-1)" />
                <stop offset="50%" stopColor="var(--wave-grad-2)" />
                <stop offset="100%" stopColor="var(--wave-grad-3)" />
              </linearGradient>
              <linearGradient id="waveGrad2" x1="100%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="var(--wave-grad-2)" />
                <stop offset="50%" stopColor="var(--wave-grad-1)" />
                <stop offset="100%" stopColor="var(--wave-grad-3)" />
              </linearGradient>
              <linearGradient id="waveGrad3" x1="0%" y1="50%" x2="100%" y2="50%">
                <stop offset="0%" stopColor="var(--wave-grad-1)" />
                <stop offset="100%" stopColor="var(--wave-grad-2)" />
              </linearGradient>
              <linearGradient id="waveLineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="var(--wave-line)" stopOpacity="0" />
                <stop offset="20%" stopColor="var(--wave-line)" stopOpacity="0.8" />
                <stop offset="80%" stopColor="var(--wave-line)" stopOpacity="0.8" />
                <stop offset="100%" stopColor="var(--wave-line)" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Back Wave */}
            <path
              className={styles.wavePath1}
              d="M-300,200 C-200,220 -100,180 0,160 C320,90 640,240 960,150 C1200,80 1340,190 1440,160 C1540,130 1640,190 1740,170 L1740,450 L-300,450 Z"
              fill="url(#waveGrad1)"
            />

            {/* Middle Wave */}
            <path
              className={styles.wavePath2}
              d="M-300,180 C-200,170 -100,200 0,220 C280,280 580,140 880,220 C1160,290 1320,180 1440,210 C1540,235 1640,250 1740,240 L1740,450 L-300,450 Z"
              fill="url(#waveGrad2)"
            />

            {/* Front Wave with Crest */}
            <path
              className={styles.wavePath3}
              d="M-300,310 C-200,325 -100,292 0,270 C360,190 720,310 1080,240 C1260,210 1380,260 1440,270 C1500,280 1620,290 1740,285 L1740,450 L-300,450 Z"
              fill="url(#waveGrad3)"
            />
            <path
              className={styles.waveCrest}
              d="M-300,310 C-200,325 -100,292 0,270 C360,190 720,310 1080,240 C1260,210 1380,260 1440,270 C1500,280 1620,290 1740,285"
              stroke="url(#waveLineGrad)"
              strokeWidth="1.5"
              fill="none"
            />
          </svg>
        </div>
      </div>

      {/* Hero section */}
      <div className={styles.emptyHero}>
        <div className={styles.emptyIcon}>
          <img
            src="/favicon.svg"
            alt="PageCraft"
            className={styles.emptyIconImg}
            draggable={false}
          />
        </div>
        <h2 className={styles.emptyTitle}>PageCraft</h2>
        <p className={styles.emptySubtitle}>Fast, minimal, distraction-free</p>
        <div className={styles.emptyActions}>
          <button className={styles.emptyBtn} onClick={onOpenFile}>
            <FolderOpen size={15} strokeWidth={2.2} />
            <span>Open PDF</span>
          </button>
          <button className={styles.emptyBtnSecondary} onClick={onOpenMakePDF}>
            <ImagePlus size={15} strokeWidth={2.2} />
            <span>Make PDF</span>
          </button>
        </div>
        <p className={styles.emptyHint}>Ctrl+O · Supports up to 10 files</p>
      </div>

      {/* Recents Section: Modern Card-Wise Grid */}
      {hasRecents && (
        <div className={styles.recentsWrap}>
          {isSelecting ? (
            <div className={`${styles.recentsHeader} ${styles.recentsHeaderSelecting}`}>
              <div className={styles.recentsSelectionLeft}>
                <span className={styles.recentsSelectedBadge}>
                  {selectedFileNames.size} selected
                </span>
                <button
                  type="button"
                  className={styles.recentsTextBtn}
                  onClick={() => {
                    if (selectedFileNames.size === recents.length) {
                      handleClearSelection();
                    } else {
                      handleSelectAll();
                    }
                  }}
                >
                  {selectedFileNames.size === recents.length ? "Deselect all" : "Select all"}
                </button>
              </div>

              <div className={styles.recentsActions}>
                <button
                  type="button"
                  className={styles.openSelectedBtn}
                  onClick={handleOpenSelected}
                  title={`Open ${selectedFileNames.size} selected document(s) in tabs`}
                >
                  <FolderOpen size={14} strokeWidth={2} />
                  <span>Open Selected ({selectedFileNames.size})</span>
                </button>

                <button
                  type="button"
                  className={styles.removeSelectedBtn}
                  onClick={handlePromptDeleteSelected}
                  title={`Remove ${selectedFileNames.size} document(s) from recents`}
                >
                  <Trash2 size={13} strokeWidth={2} />
                  <span>Remove</span>
                </button>

                <button
                  type="button"
                  className={styles.cancelSelectBtn}
                  onClick={handleClearSelection}
                  title="Cancel selection (Esc)"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.recentsHeader}>
              <div className={styles.recentsHeaderLeft}>
                <span className={styles.recentsLabel}>Recent Documents</span>
                <span className={styles.recentsCount}>{recents.length} files</span>
              </div>

              <div className={styles.recentsActions}>
                {recents.length > 1 && (
                  <>
                    <button
                      type="button"
                      className={styles.recentsActionBtn}
                      onClick={handleOpenAll}
                      title="Open all recent documents in tabs (up to 10)"
                    >
                      <FolderOpen size={13} strokeWidth={2} />
                      <span>Open All</span>
                    </button>
                    <span className={styles.recentsDot}>·</span>
                    <button
                      type="button"
                      className={styles.recentsActionBtn}
                      onClick={handleSelectAll}
                      title="Select multiple files"
                    >
                      <CheckSquare size={13} strokeWidth={2} />
                      <span>Select</span>
                    </button>
                    <span className={styles.recentsDot}>·</span>
                  </>
                )}
                <button
                  type="button"
                  className={styles.clearRecentsBtn}
                  onClick={handlePromptClearAll}
                  title="Clear all recent documents and storage"
                >
                  Clear all
                </button>
              </div>
            </div>
          )}

          <div className={styles.recentsGrid}>
            {recents.map((r) => {
              const isSelected = selectedFileNames.has(r.fileName);
              return (
                <div
                  key={r.fileName}
                  className={`${styles.recentCard} ${isSelected ? styles.recentCardSelected : ""}`}
                  onClick={(e) => handleCardClick(e, r)}
                  title={
                    isSelecting
                      ? `${isSelected ? "Deselect" : "Select"} ${r.fileName}`
                      : `${r.filePath || r.fileName}\n(Click to open, Ctrl+click or checkbox to select multiple)`
                  }
                >
                  <div className={styles.recentCardThumb}>
                    <button
                      type="button"
                      className={`${styles.recentCardCheckbox} ${isSelected ? styles.recentCardCheckboxSelected : ""} ${isSelecting ? styles.recentCardCheckboxVisible : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleSelect(r.fileName);
                      }}
                      title={isSelected ? "Deselect" : "Select"}
                      aria-label={isSelected ? `Deselect ${r.fileName}` : `Select ${r.fileName}`}
                    >
                      {isSelected && <Check size={10} strokeWidth={3.5} />}
                    </button>

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

                  {!isSelecting && (
                    <button
                      type="button"
                      className={styles.recentCardDelete}
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePromptDeleteSingle(r.fileName);
                      }}
                      title="Remove from recents"
                      aria-label={`Remove ${r.fileName}`}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {confirmAction && (
        <ConfirmModal
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.confirmLabel}
          cancelLabel="Cancel"
          onConfirm={confirmAction.onConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}
