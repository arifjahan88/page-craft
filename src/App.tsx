import { useRef, useCallback, useEffect, useState } from "react";
import React from "react";
import { ThemeProvider } from "./hooks/useTheme";
import { usePDF } from "./hooks/usePDF";
import { useRecents } from "./hooks/useRecents";
import { useTabs } from "./hooks/useTabs";
import { Toolbar } from "./components/Toolbar";
import { TabBar } from "./components/TabBar";
import { PDFViewer } from "./components/PDFViewer";
import { StatusBar } from "./components/StatusBar";
import {
  savePDFBuffer,
  getPDFBuffer,
  deletePDFBuffer,
  clearAllPDFBuffers,
} from "./utils/pdfStorage";
import styles from "./App.module.css";

// ─── Constants ────────────────────────────────────────────────────────────────

const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ─── App ──────────────────────────────────────────────────────────────────────

function PDFApp({ initialFilePath }: { initialFilePath: string | null }) {
  // ── Refs ───────────────────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(
    null,
  ) as React.RefObject<HTMLCanvasElement>;
  const textLayerRef = useRef<HTMLDivElement>(
    null,
  ) as React.RefObject<HTMLDivElement>;
  const containerRef = useRef<HTMLDivElement>(null);
  const switchingRef = useRef(false); // prevents stale page/zoom writes during tab switch

  // ── State ──────────────────────────────────────────────────────────────────
  // true while the initial double-click file is loading — keeps spinner visible
  const [pendingFile, setPendingFile] = useState(initialFilePath !== null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // ── Hooks ──────────────────────────────────────────────────────────────────
  const {
    state,
    doc,
    loadPDF,
    resetPDF,
    goToPage,
    nextPage,
    prevPage,
    zoomIn,
    zoomOut,
    zoomFit,
    setZoom,
    fitToWidth,
    ZOOM_MIN,
    ZOOM_MAX,
    searchState,
    openSearch,
    closeSearch,
    searchPDF,
    goToNextMatch,
    goToPrevMatch,
  } = usePDF(canvasRef, textLayerRef);

  const {
    recents,
    addRecent,
    updateRecentPage,
    removeRecent,
    clearAllRecents,
  } = useRecents();
  const {
    tabs,
    activeId,
    openTab,
    activateTab,
    closeTab,
    closeAllTabs,
    saveTabState,
  } = useTabs();

  // ── Go Home: close all open files/tabs and return to home screen ─────────
  const handleGoHome = useCallback(async () => {
    closeAllTabs();
    await resetPDF();
  }, [closeAllTabs, resetPDF]);

  // ── Clear all recents & storage ──────────────────────────────────────────
  const handleClearAllRecents = useCallback(async () => {
    clearAllRecents();
    await clearAllPDFBuffers();
  }, [clearAllRecents]);

  // ── Dismiss spinner only after PDF is confirmed loaded or errored ──────────
  useEffect(() => {
    if (!pendingFile) return;
    if (state.isLoaded || state.error) setPendingFile(false);
  }, [state.isLoaded, state.error, pendingFile]);

  // ── Persist page/zoom into active tab ──────────────────────────────────────
  useEffect(() => {
    if (!activeId || !state.isLoaded || switchingRef.current) return;
    saveTabState(activeId, state.currentPage, state.zoom, state.totalPages);
    if (state.fileName)
      updateRecentPage(state.fileName, state.currentPage, state.totalPages);
  }, [
    state.currentPage,
    state.zoom,
    state.totalPages,
    state.isLoaded,
    state.fileName,
    activeId,
    saveTabState,
    updateRecentPage,
  ]);

  // ── Core loader: multiple buffers → tabs → active PDF ──────────────────────
  const loadMultipleBuffers = useCallback(
    async (
      items: Array<{ buffer: ArrayBuffer; fileName: string; filePath: string }>
    ) => {
      if (items.length === 0) return;
      const capped = items.slice(0, 10);
      let targetTabId: string | null = null;
      let targetBuffer: ArrayBuffer | null = null;
      let targetFileName: string | null = null;
      let targetSavedPage = 1;
      let targetSavedZoom = 1.0;
      let isExistingTab = false;

      for (let i = 0; i < capped.length; i++) {
        const item = capped[i];
        const { tab, isNew } = openTab(item.fileName, item.filePath, item.buffer);
        if (i === 0) {
          targetTabId = tab.id;
          targetBuffer = tab.buffer;
          targetFileName = tab.fileName;
          targetSavedPage = tab.savedPage;
          targetSavedZoom = tab.savedZoom;
          isExistingTab = !isNew;
        }
        if (isNew) {
          addRecent({ fileName: item.fileName, filePath: item.filePath, lastPage: 1, totalPages: 0 });
        }
        // Persist buffer to IndexedDB for persistent recents in browser
        savePDFBuffer(item.fileName, item.buffer);
      }

      if (targetTabId && targetBuffer && targetFileName) {
        activateTab(targetTabId);
        switchingRef.current = true;
        await loadPDF(targetBuffer.slice(0), targetFileName);
        if (isExistingTab) {
          goToPage(targetSavedPage);
          setZoom(targetSavedZoom);
        }
        switchingRef.current = false;
      }
    },
    [openTab, activateTab, loadPDF, goToPage, setZoom, addRecent]
  );

  // ── Load multiple files from OS file paths ─────────────────────────────────
  const loadMultiplePaths = useCallback(
    async (filePaths: string[]) => {
      if (filePaths.length === 0) return;
      const capped = filePaths.slice(0, 10);
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const items: Array<{ buffer: ArrayBuffer; fileName: string; filePath: string }> = [];
        for (const path of capped) {
          const fileName = path.split(/[/\\]/).pop() ?? "document.pdf";
          const base64 = await invoke<string>("read_pdf_file", { path });
          items.push({
            buffer: base64ToBuffer(base64),
            fileName,
            filePath: path,
          });
        }
        await loadMultipleBuffers(items);
      } catch (err) {
        console.error("Failed to open files from paths:", err);
        setPendingFile(false);
      }
    },
    [loadMultipleBuffers]
  );

  // ── Load from single path ──────────────────────────────────────────────────
  const loadFromPath = useCallback(
    async (filePath: string, _fileName?: string) => {
      await loadMultiplePaths([filePath]);
    },
    [loadMultiplePaths]
  );

  // ── Load initial file passed via double-click (once on mount) ─────────────
  useEffect(() => {
    if (!initialFilePath) {
      // No file — show window immediately after mount
      if (IS_TAURI) {
        import("@tauri-apps/api/core").then(({ invoke }) => {
          invoke("show_window").catch(() => {});
        });
      }
      return;
    }
    const fileName = initialFilePath.split(/[/\\]/).pop() ?? "document.pdf";
    loadFromPath(initialFilePath, fileName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pendingFile && IS_TAURI) {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke("show_window").catch(() => {});
      });
    }
  }, [pendingFile]);

  // ── Open via OS file dialog (Multi-file support, up to 10) ─────────────────
  const handleOpenFile = useCallback(async () => {
    if (IS_TAURI) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({
          multiple: true,
          filters: [{ name: "PDF Documents", extensions: ["pdf"] }],
        });
        if (!selected) return;
        const paths = (Array.isArray(selected) ? selected : [selected]).slice(0, 10);
        await loadMultiplePaths(paths);
      } catch (err) {
        console.error("Tauri file open error:", err);
      }
    } else {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.accept = "application/pdf,.pdf";
      input.onchange = async () => {
        const fileList = Array.from(input.files || []).slice(0, 10);
        if (fileList.length === 0) return;
        const items = await Promise.all(
          fileList.map(async (file) => ({
            buffer: await file.arrayBuffer(),
            fileName: file.name,
            filePath: "",
          }))
        );
        await loadMultipleBuffers(items);
      };
      input.click();
    }
  }, [loadMultiplePaths, loadMultipleBuffers]);

  // ── Drag & Drop file handling (up to 10 files) ──────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) {
      setIsDraggingOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDraggingOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingOver(false);

      const files = Array.from(e.dataTransfer.files || [])
        .filter(
          (f) => f.name.toLowerCase().endsWith(".pdf") || f.type === "application/pdf"
        )
        .slice(0, 10);

      if (files.length === 0) return;

      const items = await Promise.all(
        files.map(async (f) => ({
          buffer: await f.arrayBuffer(),
          fileName: f.name,
          filePath: (f as unknown as { path?: string }).path || "",
        }))
      );
      await loadMultipleBuffers(items);
    },
    [loadMultipleBuffers]
  );

  // ── Re-open from recents ───────────────────────────────────────────────────
  const handleOpenRecent = useCallback(
    async (filePath: string, fileName: string) => {
      // 1. In Tauri with full file path: read from filesystem
      if (IS_TAURI && filePath) {
        try {
          await loadFromPath(filePath, fileName);
          return;
        } catch (err) {
          console.warn("Failed to load from path, falling back to cached buffer:", err);
        }
      }

      // 2. Check IndexedDB cached buffer (browser mode / offline persistence)
      const cachedBuffer = await getPDFBuffer(fileName);
      if (cachedBuffer) {
        await loadMultipleBuffers([{ buffer: cachedBuffer, fileName, filePath }]);
        return;
      }

      // 3. Fallback: prompt to pick file if buffer was cleared from cache
      handleOpenFile();
    },
    [loadFromPath, loadMultipleBuffers, handleOpenFile],
  );

  // ── Remove from recents and delete cached buffer ───────────────────────────
  const handleRemoveRecent = useCallback(
    (fileName: string) => {
      removeRecent(fileName);
      deletePDFBuffer(fileName);
    },
    [removeRecent]
  );

  // ── Switch to an existing tab ──────────────────────────────────────────────
  const handleActivateTab = useCallback(
    async (id: string) => {
      if (id === activeId) return;
      const tab = tabs.find((t) => t.id === id);
      if (!tab) return;
      switchingRef.current = true;
      activateTab(id);
      await loadPDF(tab.buffer.slice(0), tab.fileName);
      goToPage(tab.savedPage);
      setZoom(tab.savedZoom);
      switchingRef.current = false;
    },
    [activeId, tabs, activateTab, loadPDF, goToPage, setZoom],
  );

  // ── Close a tab ────────────────────────────────────────────────────────────
  const handleCloseTab = useCallback(
    async (id: string) => {
      const nextTab = closeTab(id, id === activeId);

      if (nextTab) {
        // Closed the active tab — switch to neighbour
        switchingRef.current = true;
        await loadPDF(nextTab.buffer.slice(0), nextTab.fileName);
        goToPage(nextTab.savedPage);
        setZoom(nextTab.savedZoom);
        switchingRef.current = false;
      } else if (tabs.length === 1) {
        // Last tab closed — reset to home screen
        await resetPDF();
      }
    },
    [activeId, tabs, closeTab, loadPDF, goToPage, setZoom, resetPDF],
  );

  // ── Fit canvas to container width ──────────────────────────────────────────
  const handleFitToWidth = useCallback(() => {
    fitToWidth(containerRef.current?.clientWidth ?? window.innerWidth);
  }, [fitToWidth]);

  // ── Global keyboard shortcuts ──────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.target instanceof HTMLInputElement) return;

      if (ctrl && e.key === "f") {
        e.preventDefault();
        openSearch();
      }
      if (ctrl && e.key === "o") {
        e.preventDefault();
        handleOpenFile();
      }
      if (ctrl && e.key === "w") {
        e.preventDefault();
        if (activeId) handleCloseTab(activeId);
      }
      if (!ctrl && e.key === "w" && state.isLoaded) {
        e.preventDefault();
        handleFitToWidth();
      }

      if (ctrl && e.key === "Tab") {
        e.preventDefault();
        if (tabs.length < 2 || !activeId) return;
        const idx = tabs.findIndex((t) => t.id === activeId);
        const next = e.shiftKey
          ? tabs[(idx - 1 + tabs.length) % tabs.length]
          : tabs[(idx + 1) % tabs.length];
        handleActivateTab(next.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    openSearch,
    handleOpenFile,
    handleFitToWidth,
    handleCloseTab,
    handleActivateTab,
    state.isLoaded,
    activeId,
    tabs,
  ]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className={styles.app}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Toolbar
        isLoaded={state.isLoaded}
        fileName={state.fileName}
        currentPage={state.currentPage}
        totalPages={state.totalPages}
        zoom={state.zoom}
        zoomMin={ZOOM_MIN}
        zoomMax={ZOOM_MAX}
        searchState={searchState}
        onGoHome={handleGoHome}
        onOpenFile={handleOpenFile}
        onPrevPage={prevPage}
        onNextPage={nextPage}
        onGoToPage={goToPage}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomFit={zoomFit}
        onZoomSet={setZoom}
        onFitToWidth={handleFitToWidth}
        onOpenSearch={openSearch}
        onCloseSearch={closeSearch}
        onSearch={searchPDF}
        onNextMatch={goToNextMatch}
        onPrevMatch={goToPrevMatch}
      />

      <TabBar
        tabs={tabs}
        activeId={activeId}
        onActivate={handleActivateTab}
        onClose={handleCloseTab}
        onNewTab={handleOpenFile}
      />

      <PDFViewer
        ref={containerRef}
        doc={doc}
        totalPages={state.totalPages}
        currentPage={state.currentPage}
        onGoToPage={goToPage}
        searchQuery={searchState.query}
        isDraggingOver={isDraggingOver}
        isLoaded={state.isLoaded}
        isLoading={state.isLoading}
        initializing={pendingFile}
        error={state.error}
        zoom={state.zoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomSet={setZoom}
        onOpenFile={handleOpenFile}
        onNextPage={nextPage}
        onPrevPage={prevPage}
        recents={recents}
        onOpenRecent={handleOpenRecent}
        onRemoveRecent={handleRemoveRecent}
        onClearAllRecents={handleClearAllRecents}
      />

      <StatusBar
        isLoaded={state.isLoaded}
        currentPage={state.currentPage}
        totalPages={state.totalPages}
        zoom={state.zoom}
        fileName={state.fileName}
      />
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App({
  initialFilePath,
}: {
  initialFilePath: string | null;
}) {
  return (
    <ThemeProvider>
      <PDFApp initialFilePath={initialFilePath} />
    </ThemeProvider>
  );
}
