// ─── Asynchronous Multi-Format Page Extraction Engine ────────────────────────
// Renders all PDF pages at 2.0x DPI, names files in human-readable format,
// packages them into a ZIP archive, and streams the download without UI blocking.

import type * as pdfjsLib from "pdfjs-dist";
import { createZipArchive, type ZipFileInput } from "./zipWriter";

export type ImageFormat = "png" | "jpeg" | "webp";

export interface ExtractionProgress {
  currentPage: number;
  totalPages: number;
  stage: "rendering" | "compressing" | "complete" | "cancelled" | "error";
  percent: number;
  fileName: string;
  format: ImageFormat;
  errorMessage?: string;
}

export interface ExtractOptions {
  doc: pdfjsLib.PDFDocumentProxy;
  fileName: string;
  format: ImageFormat;
  scale?: number;
  quality?: number;
  signal?: AbortSignal;
  onProgress?: (progress: ExtractionProgress) => void;
}

// ─── Human-Readable Naming Helpers ───────────────────────────────────────────

export function cleanDocumentTitle(rawFileName: string): string {
  let cleaned = rawFileName.replace(/\.[pP][dD][fF]$/, "").trim();
  cleaned = cleaned.replace(/^_+|_+$/g, "");
  return cleaned || "Document";
}

export function getFileExtension(format: ImageFormat): string {
  switch (format) {
    case "jpeg":
      return "jpg";
    case "webp":
      return "webp";
    case "png":
    default:
      return "png";
  }
}

export function getMimeType(format: ImageFormat): string {
  switch (format) {
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "png":
    default:
      return "image/png";
  }
}

export function getFormatLabel(format: ImageFormat): string {
  switch (format) {
    case "jpeg":
      return "JPG";
    case "webp":
      return "WebP";
    case "png":
    default:
      return "PNG";
  }
}

// ─── Core Extraction Pipeline ────────────────────────────────────────────────

export async function extractPDFPagesAsZip({
  doc,
  fileName,
  format,
  scale = 2.0,
  quality = 0.92,
  signal,
  onProgress,
}: ExtractOptions): Promise<void> {
  const totalPages = doc.numPages;
  const cleanTitle = cleanDocumentTitle(fileName);
  const ext = getFileExtension(format);
  const mimeType = getMimeType(format);
  const formatLabel = getFormatLabel(format);
  const padLength = Math.max(2, String(totalPages).length);

  const files: ZipFileInput[] = [];

  const update = (
    stage: ExtractionProgress["stage"],
    currentPage: number,
    percent: number,
    errorMessage?: string
  ) => {
    onProgress?.({
      currentPage,
      totalPages,
      stage,
      percent: Math.min(100, Math.max(0, Math.round(percent))),
      fileName,
      format,
      errorMessage,
    });
  };

  try {
    // ── Phase 1: Render pages to canvas and encode image blobs ───────────────
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      if (signal?.aborted) {
        update("cancelled", pageNum, (pageNum / totalPages) * 85);
        return;
      }

      update("rendering", pageNum, ((pageNum - 1) / totalPages) * 85);

      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) {
        throw new Error("Unable to obtain 2D canvas context for page rendering");
      }

      // Draw pure white background in case PDF has transparent areas
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Render PDF page content
      await page.render({
        canvasContext: ctx,
        viewport,
      }).promise;

      // Convert canvas to image blob
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), mimeType, quality);
      });

      if (!blob) {
        throw new Error(`Failed to encode page ${pageNum} as ${formatLabel}`);
      }

      // Formulate clean human-readable image name
      const paddedPage = String(pageNum).padStart(padLength, "0");
      const imageName = `${cleanTitle} - Page ${paddedPage}.${ext}`;

      files.push({
        name: imageName,
        data: blob,
      });

      // Free canvas memory
      canvas.width = 0;
      canvas.height = 0;

      // Yield control to main thread for 60fps UI responsiveness
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (signal?.aborted) {
      update("cancelled", totalPages, 85);
      return;
    }

    // ── Phase 2: Package into ZIP archive ────────────────────────────────────
    update("compressing", totalPages, 90);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const zipBlob = await createZipArchive(files);

    if (signal?.aborted) {
      update("cancelled", totalPages, 95);
      return;
    }

    // ── Phase 3: Trigger automatic download ──────────────────────────────────
    update("complete", totalPages, 100);

    const zipFileName = `${cleanTitle} - Extracted Pages (${formatLabel}).zip`;
    const downloadUrl = URL.createObjectURL(zipBlob);

    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = zipFileName;
    document.body.appendChild(anchor);
    anchor.click();

    setTimeout(() => {
      try {
        anchor.remove();
        URL.revokeObjectURL(downloadUrl);
      } catch {
        /* ignore */
      }
    }, 15_000);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to extract PDF pages";
    update("error", 0, 0, message);
    throw err;
  }
}
