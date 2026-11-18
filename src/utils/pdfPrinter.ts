// ─── PDF Printing Utility ─────────────────────────────────────────────────────
// Picks the best print pipeline for the current runtime:
//
//  • Desktop macOS  → native PDFKit print sheet (Rust `print_pdf_file`), full vector quality.
//  • Desktop Windows / Linux → pages are rendered with pdf.js into a print-only layer and
//    `window.print()` opens the webview's own dialog (WebView2 / GTK). Blob-PDF iframes
//    can't be printed inside these webviews, so rasterising is the reliable path.
//  • Browser → isolated PDF blob in a hidden iframe, printed by the browser's PDF viewer.

import type * as pdfjsLib from "pdfjs-dist";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const IS_MACOS =
  typeof navigator !== "undefined" && /Macintosh|Mac OS X/i.test(navigator.userAgent);

/** Print resolution for rasterised pages (150 DPI keeps text crisp at a sane memory cost). */
const PRINT_DPI = 150;
const PRINT_ROOT_ID = "pagecraft-print-root";
const PRINT_STYLE_ID = "pagecraft-print-style";

export interface PrintProgress {
  stage: "preparing" | "printing" | "done" | "cancelled" | "error";
  currentPage: number;
  totalPages: number;
  percent: number;
  fileName: string;
  errorMessage?: string;
}

export interface PrintOptions {
  buffer: ArrayBuffer;
  fileName: string;
  /** Absolute path on disk (desktop only) — lets macOS print without copying bytes over IPC. */
  filePath?: string;
  /** Loaded pdf.js document, used to render pages on Windows / Linux. */
  doc: pdfjsLib.PDFDocumentProxy | null;
  signal?: AbortSignal;
  onProgress?: (progress: PrintProgress) => void;
}

export async function printPDF(options: PrintOptions): Promise<void> {
  if (IS_TAURI) {
    if (IS_MACOS && (await printWithNativeSheet(options))) return;
    if (options.doc) return printRasterized(options.doc, options);
  }
  printWithIframe(options.buffer);
}

// ─── macOS: native PDFKit print sheet ─────────────────────────────────────────

async function printWithNativeSheet({ buffer, filePath }: PrintOptions): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("print_pdf_file", {
      path: filePath || null,
      data: filePath ? null : Array.from(new Uint8Array(buffer)),
    });
    return true;
  } catch (err) {
    console.warn("Native print unavailable, falling back to webview print:", err);
    return false;
  }
}

// ─── Windows / Linux: render pages, then window.print() ──────────────────────

let cleanupActivePrint: (() => void) | null = null;

async function printRasterized(
  doc: pdfjsLib.PDFDocumentProxy,
  { fileName, signal, onProgress }: PrintOptions
): Promise<void> {
  cleanupActivePrint?.();

  const totalPages = doc.numPages;
  const report = (stage: PrintProgress["stage"], currentPage: number, errorMessage?: string) =>
    onProgress?.({
      stage,
      currentPage,
      totalPages,
      percent: Math.round((currentPage / Math.max(totalPages, 1)) * 100),
      fileName,
      errorMessage,
    });

  const objectUrls: string[] = [];
  const style = document.createElement("style");
  style.id = PRINT_STYLE_ID;
  style.textContent = PRINT_CSS;
  const root = document.createElement("div");
  root.id = PRINT_ROOT_ID;
  root.setAttribute("aria-hidden", "true");

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    window.removeEventListener("afterprint", cleanup);
    root.remove();
    style.remove();
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    if (cleanupActivePrint === cleanup) cleanupActivePrint = null;
  };
  cleanupActivePrint = cleanup;

  document.head.appendChild(style);
  document.body.appendChild(root);

  try {
    const scale = PRINT_DPI / 72;
    const images: HTMLImageElement[] = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      if (signal?.aborted) {
        cleanup();
        report("cancelled", pageNum - 1);
        return;
      }
      report("preparing", pageNum - 1);

      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("Unable to create a canvas for printing");

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      page.cleanup();

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) throw new Error(`Failed to render page ${pageNum} for printing`);

      const url = URL.createObjectURL(blob);
      objectUrls.push(url);

      const sheet = document.createElement("div");
      sheet.className = "pc-print-page";
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      sheet.appendChild(img);
      root.appendChild(sheet);
      images.push(img);

      // Keep the UI (progress modal) responsive between pages
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    await Promise.all(images.map((img) => img.decode().catch(() => undefined)));

    if (signal?.aborted) {
      cleanup();
      report("cancelled", totalPages);
      return;
    }

    report("printing", totalPages);
    // Let the modal paint its final state before the dialog takes over
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

    window.addEventListener("afterprint", cleanup);
    window.print();
    // Safety net in case the webview never fires `afterprint`
    setTimeout(cleanup, 120_000);

    report("done", totalPages);
  } catch (err) {
    cleanup();
    const message = err instanceof Error ? err.message : "Failed to prepare document for printing";
    report("error", 0, message);
    throw err;
  }
}

/** Only the rendered pages are visible on paper; the app UI is hidden while printing. */
const PRINT_CSS = `
#${PRINT_ROOT_ID} { display: none; }
@media print {
  @page { margin: 0; }
  html, body {
    background: #ffffff !important;
    height: auto !important;
    overflow: visible !important;
  }
  body > *:not(#${PRINT_ROOT_ID}) { display: none !important; }
  #${PRINT_ROOT_ID} { display: block !important; }
  #${PRINT_ROOT_ID} .pc-print-page {
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    break-inside: avoid;
    break-after: page;
    page-break-after: always;
  }
  #${PRINT_ROOT_ID} .pc-print-page:last-child {
    break-after: auto;
    page-break-after: auto;
  }
  #${PRINT_ROOT_ID} img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
}
`;

// ─── Browser: hidden iframe with the original PDF ─────────────────────────────

function printWithIframe(buffer: ArrayBuffer): void {
  const blob = new Blob([buffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.visibility = "hidden";
  iframe.src = url;

  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (err) {
      console.warn("Direct iframe print failed, falling back to print window:", err);
      const printWin = window.open(url, "_blank");
      printWin?.focus();
      printWin?.print();
    }

    // Clean up after print dialog is opened
    setTimeout(() => {
      iframe.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  };

  document.body.appendChild(iframe);
}
