import { useRef, useState, useEffect, KeyboardEvent } from "react";
import {
  FolderOpen,
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Sun,
  Moon,
  RotateCcw,
  Maximize2,
  Search,
  X,
  Loader,
} from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import type { SearchState } from "../hooks/usePDF";
import styles from "./Toolbar.module.css";

interface ToolbarProps {
  isLoaded: boolean;
  fileName: string;
  currentPage: number;
  totalPages: number;
  zoom: number;
  zoomMin: number;
  zoomMax: number;
  searchState: SearchState;
  onGoHome: () => void;
  onOpenFile: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onGoToPage: (page: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
  onZoomSet: (zoom: number) => void;
  onFitToWidth: () => void;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  onSearch: (query: string) => void;
  onNextMatch: () => void;
  onPrevMatch: () => void;
}

export function Toolbar({
  isLoaded,
  fileName,
  currentPage,
  totalPages,
  zoom,
  zoomMin,
  zoomMax,
  searchState,
  onGoHome,
  onOpenFile,
  onPrevPage,
  onNextPage,
  onGoToPage,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onZoomSet,
  onFitToWidth,
  onOpenSearch,
  onCloseSearch,
  onSearch,
  onNextMatch,
  onPrevMatch,
}: ToolbarProps) {
  const { theme, toggleTheme } = useTheme();
  const [pageInput, setPageInput] = useState("");
  const [zoomInput, setZoomInput] = useState("");
  const [editingPage, setEditingPage] = useState(false);
  const [editingZoom, setEditingZoom] = useState(false);
  const pageRef = useRef<HTMLInputElement>(null);
  const zoomRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchState.isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 50);
    }
  }, [searchState.isOpen]);

  // ── Page input ──────────────────────────────────────────────────────────────
  const handlePageClick = () => {
    setPageInput(String(currentPage));
    setEditingPage(true);
    setTimeout(() => pageRef.current?.select(), 0);
  };
  const commitPage = () => {
    const n = parseInt(pageInput, 10);
    if (!isNaN(n)) onGoToPage(n);
    setEditingPage(false);
  };
  const handlePageKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") commitPage();
    if (e.key === "Escape") setEditingPage(false);
  };

  // ── Zoom input ──────────────────────────────────────────────────────────────
  const handleZoomClick = () => {
    setZoomInput(String(Math.round(zoom * 100)));
    setEditingZoom(true);
    setTimeout(() => zoomRef.current?.select(), 0);
  };
  const commitZoom = () => {
    const n = parseFloat(zoomInput);
    if (!isNaN(n)) onZoomSet(n / 100);
    setEditingZoom(false);
  };
  const handleZoomKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") commitZoom();
    if (e.key === "Escape") setEditingZoom(false);
  };

  // ── Search key ──────────────────────────────────────────────────────────────
  const handleSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.shiftKey ? onPrevMatch() : onNextMatch();
    }
    if (e.key === "Escape") {
      onCloseSearch();
    }
  };

  const zoomPercent = Math.round(zoom * 100);
  const canPrev = isLoaded && currentPage > 1;
  const canNext = isLoaded && currentPage < totalPages;
  const canZoomOut = isLoaded && zoom > zoomMin;
  const canZoomIn = isLoaded && zoom < zoomMax;
  const displayName = fileName.length > 40 ? "…" + fileName.slice(-37) : fileName;

  const hasSearchQuery = searchState.query.trim().length > 0;
  const noMatches = hasSearchQuery && !searchState.isSearching && searchState.results.length === 0;
  const matchLabel = searchState.isSearching
    ? null
    : searchState.results.length > 0
      ? `${searchState.currentIndex + 1} / ${searchState.results.length}`
      : hasSearchQuery
        ? "0 / 0"
        : null;

  return (
    <div className={`${styles.toolbar} ${!isLoaded ? styles.homeToolbar : ""}`}>
      {/* ── Left: Back (when loaded) + Open (when loaded) + Filename ── */}
      <div className={styles.section}>
        {isLoaded && (
          <>
            <button
              className={styles.iconBtn}
              onClick={onGoHome}
              title="Close file and return to Home"
            >
              <ArrowLeft size={16} strokeWidth={2.2} />
            </button>
            <button className={styles.openBtn} onClick={onOpenFile} title="Open PDF (Ctrl+O)">
              <FolderOpen size={15} strokeWidth={2} />
              <span className={styles.btnLabel}>Open</span>
            </button>
            <span className={styles.fileName} title={fileName}>
              {displayName}
            </span>
          </>
        )}
      </div>

      {/* ── Center: Navigation + Zoom + Search ── */}
      {isLoaded && (
        <div className={styles.center}>
          {/* Page navigation */}
          <div className={styles.group}>
            <button
              className={styles.iconBtn}
              onClick={onPrevPage}
              disabled={!canPrev}
              title="Previous page (←)"
            >
              <ChevronLeft size={16} strokeWidth={2.5} />
            </button>

            <div className={styles.pageIndicator}>
              {editingPage ? (
                <input
                  ref={pageRef}
                  className={styles.numInput}
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  onBlur={commitPage}
                  onKeyDown={handlePageKey}
                  style={{ width: "42px" }}
                />
              ) : (
                <button
                  className={styles.numBtn}
                  onClick={handlePageClick}
                  title="Click to jump to page"
                >
                  {currentPage}
                </button>
              )}
              <span className={styles.pageOf}>/ {totalPages}</span>
            </div>

            <button
              className={styles.iconBtn}
              onClick={onNextPage}
              disabled={!canNext}
              title="Next page (→)"
            >
              <ChevronRight size={16} strokeWidth={2.5} />
            </button>
          </div>

          <div className={styles.divider} />

          {/* Zoom controls */}
          <div className={styles.group}>
            <button
              className={styles.iconBtn}
              onClick={onZoomOut}
              disabled={!canZoomOut}
              title="Zoom out (-)"
            >
              <ZoomOut size={15} strokeWidth={2} />
            </button>

            {editingZoom ? (
              <div className={styles.zoomInputWrap}>
                <input
                  ref={zoomRef}
                  className={styles.numInput}
                  value={zoomInput}
                  onChange={(e) => setZoomInput(e.target.value)}
                  onBlur={commitZoom}
                  onKeyDown={handleZoomKey}
                  style={{ width: "46px" }}
                />
                <span className={styles.pct}>%</span>
              </div>
            ) : (
              <button className={styles.numBtn} onClick={handleZoomClick} title="Click to set zoom">
                {zoomPercent}%
              </button>
            )}

            <button
              className={styles.iconBtn}
              onClick={onZoomIn}
              disabled={!canZoomIn}
              title="Zoom in (+)"
            >
              <ZoomIn size={15} strokeWidth={2} />
            </button>

            <button
              className={`${styles.iconBtn} ${styles.hideMobile}`}
              onClick={onZoomFit}
              title="Reset zoom (Ctrl+0)"
            >
              <RotateCcw size={13} strokeWidth={2} />
            </button>

            <button
              className={`${styles.iconBtn} ${styles.hideMobile}`}
              onClick={onFitToWidth}
              title="Fit to width (W)"
            >
              <Maximize2 size={13} strokeWidth={2} />
            </button>
          </div>

          <div className={styles.divider} />

          {/* Search Control */}
          {searchState.isOpen ? (
            <div className={styles.searchPill}>
              <div className={`${styles.searchInputWrap} ${noMatches ? styles.noMatchWrap : ""}`}>
                <Search size={13} className={styles.searchPillIcon} />
                <input
                  ref={searchInputRef}
                  className={styles.searchInput}
                  placeholder="Find in document…"
                  value={searchState.query}
                  onChange={(e) => onSearch(e.target.value)}
                  onKeyDown={handleSearchKey}
                  spellCheck={false}
                  autoComplete="off"
                />
                {searchState.isSearching && (
                  <Loader size={12} strokeWidth={2} className={styles.spin} />
                )}
                {matchLabel && (
                  <span className={`${styles.searchCount} ${noMatches ? styles.noMatchText : ""}`}>
                    {matchLabel}
                  </span>
                )}
              </div>
              <div className={styles.searchBtns}>
                <button
                  className={styles.iconBtnSmall}
                  onClick={onPrevMatch}
                  disabled={searchState.results.length < 2}
                  title="Previous (Shift+Enter)"
                >
                  <ChevronUp size={13} strokeWidth={2.5} />
                </button>
                <button
                  className={styles.iconBtnSmall}
                  onClick={onNextMatch}
                  disabled={searchState.results.length < 2}
                  title="Next (Enter)"
                >
                  <ChevronDown size={13} strokeWidth={2.5} />
                </button>
                <div className={styles.miniDivider} />
                <button className={styles.iconBtnSmall} onClick={onCloseSearch} title="Close (Esc)">
                  <X size={13} strokeWidth={2.5} />
                </button>
              </div>
            </div>
          ) : (
            <button
              className={styles.iconBtn}
              onClick={onOpenSearch}
              title="Search in document (Ctrl+F)"
            >
              <Search size={14} strokeWidth={2} />
            </button>
          )}
        </div>
      )}

      {/* ── Right: Theme toggle ── */}
      <div className={styles.section} style={{ justifyContent: "flex-end" }}>
        <button
          className={styles.themeBtn}
          onClick={toggleTheme}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? (
            <Sun size={15} strokeWidth={2} />
          ) : (
            <Moon size={15} strokeWidth={2} />
          )}
        </button>
      </div>
    </div>
  );
}
