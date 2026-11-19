// ─── Zero-Dependency Images-to-PDF Generator (PDF 1.4) ───────────────────────
// Validates image uploads (JPG/JPEG/PNG/WebP, max 20 images, max 500 KB each),
// normalizes images via HTML5 Canvas into baseline RGB JPEG streams (fixing EXIF
// rotation, transparency, and WebP compatibility), assembles a standards-compliant
// PDF 1.4 binary with exact xref byte offsets, and saves/downloads cross-platform.

export const MAX_IMAGES_PER_UPLOAD = 20;
export const MAX_TOTAL_IMAGES = 100;
export const MAX_IMAGE_SIZE_BYTES = 500 * 1024; // 500 KB per image

export const ALLOWED_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export type PDFPageSize = "fit" | "a4";

export interface ImageValidationResult {
  valid: boolean;
  reason?: "unsupported_format" | "exceeds_size_limit" | "empty_file";
  message?: string;
}

export interface MakePDFProgress {
  stage: "processing" | "building" | "saving" | "complete" | "cancelled" | "error";
  currentImage: number;
  totalImages: number;
  percent: number;
  errorMessage?: string;
}

export interface MakePDFInputImage {
  file: Blob;
  name: string;
}

export interface MakePDFOptions {
  images: MakePDFInputImage[];
  fileName: string;
  pageSize: PDFPageSize;
  quality?: number;
  signal?: AbortSignal;
  onProgress?: (progress: MakePDFProgress) => void;
}

export interface MakePDFResult {
  buffer: ArrayBuffer;
  fileName: string;
  savedPath: string;
  cancelled: boolean;
}

// ─── Validation & Formatting Helpers ─────────────────────────────────────────

export function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx === -1 ? "" : fileName.slice(idx + 1).toLowerCase();
}

export function isSupportedImage(fileName: string, mimeType?: string): boolean {
  const ext = getExtension(fileName);
  if (ext && ALLOWED_IMAGE_EXTENSIONS.has(ext)) return true;
  if (mimeType && ALLOWED_IMAGE_MIME_TYPES.has(mimeType.toLowerCase())) return true;
  return false;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export function validateImageFile(
  fileName: string,
  mimeType: string,
  sizeBytes: number
): ImageValidationResult {
  if (!isSupportedImage(fileName, mimeType)) {
    return {
      valid: false,
      reason: "unsupported_format",
      message: `${fileName} (unsupported format — use JPG, JPEG, PNG, or WebP)`,
    };
  }
  if (sizeBytes <= 0) {
    return {
      valid: false,
      reason: "empty_file",
      message: `${fileName} (file is empty)`,
    };
  }
  if (sizeBytes > MAX_IMAGE_SIZE_BYTES) {
    return {
      valid: false,
      reason: "exceeds_size_limit",
      message: `${fileName} (${formatFileSize(sizeBytes)} exceeds 500 KB limit)`,
    };
  }
  return { valid: true };
}

export function sanitizePdfBaseName(rawName: string): string {
  return rawName
    .trim()
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/(\.[pP][dD][fF])+$/, "")
    .trim();
}

export function normalizePdfFileName(rawName: string): string {
  const base = sanitizePdfBaseName(rawName);
  return `${base || "document"}.pdf`;
}

export function guessImageMimeType(fileName: string): string {
  const ext = getExtension(fileName);
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "jpg":
    case "jpeg":
    default:
      return "image/jpeg";
  }
}

// ─── Image Normalization (Canvas → Baseline RGB JPEG) ────────────────────────

interface EncodedPageImage {
  jpegBytes: Uint8Array;
  width: number;
  height: number;
}

async function decodeAndEncodeAsJpeg(blob: Blob, quality: number): Promise<EncodedPageImage> {
  let width = 0;
  let height = 0;
  let bitmap: ImageBitmap | null = null;
  let imgEl: HTMLImageElement | null = null;
  let objectUrl: string | null = null;

  try {
    if (typeof createImageBitmap === "function") {
      try {
        bitmap = await createImageBitmap(blob);
        width = bitmap.width;
        height = bitmap.height;
      } catch {
        bitmap = null;
      }
    }

    if (!bitmap) {
      objectUrl = URL.createObjectURL(blob);
      imgEl = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Failed to decode image"));
        img.src = objectUrl!;
      });
      width = imgEl.naturalWidth || imgEl.width;
      height = imgEl.naturalHeight || imgEl.height;
    }

    if (width <= 0 || height <= 0) {
      throw new Error("Image has invalid dimensions");
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      throw new Error("Unable to initialize 2D canvas context");
    }

    // White paper background for PNG/WebP transparency
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    if (bitmap) {
      ctx.drawImage(bitmap, 0, 0, width, height);
    } else if (imgEl) {
      ctx.drawImage(imgEl, 0, 0, width, height);
    }

    const jpegBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
    });

    canvas.width = 0;
    canvas.height = 0;

    if (!jpegBlob) {
      throw new Error("Failed to encode image as JPEG");
    }

    const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
    if (jpegBytes.length < 4 || jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) {
      throw new Error("Encoded JPEG stream is invalid");
    }

    return { jpegBytes, width, height };
  } finally {
    if (bitmap) {
      try {
        bitmap.close();
      } catch {
        /* ignore */
      }
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

// ─── PDF 1.4 Binary Assembly ─────────────────────────────────────────────────

const A4_PORTRAIT_W = 595.28;
const A4_PORTRAIT_H = 841.89;
const A4_MARGIN = 24;

function computePageLayout(
  imgW: number,
  imgH: number,
  pageSize: PDFPageSize
): {
  pageW: number;
  pageH: number;
  drawW: number;
  drawH: number;
  offsetX: number;
  offsetY: number;
} {
  if (pageSize === "a4") {
    const isLandscape = imgW > imgH;
    const pageW = isLandscape ? A4_PORTRAIT_H : A4_PORTRAIT_W;
    const pageH = isLandscape ? A4_PORTRAIT_W : A4_PORTRAIT_H;
    const availW = pageW - A4_MARGIN * 2;
    const availH = pageH - A4_MARGIN * 2;
    const scale = Math.min(availW / imgW, availH / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    return {
      pageW,
      pageH,
      drawW,
      drawH,
      offsetX: (pageW - drawW) / 2,
      offsetY: (pageH - drawH) / 2,
    };
  }

  // "fit": convert px → PDF points (72/96 = 0.75) preserving exact aspect ratio
  const pageW = Math.max(1, imgW * 0.75);
  const pageH = Math.max(1, imgH * 0.75);
  return {
    pageW,
    pageH,
    drawW: pageW,
    drawH: pageH,
    offsetX: 0,
    offsetY: 0,
  };
}

export function buildPdfFromJpegs(pages: EncodedPageImage[], pageSize: PDFPageSize): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let currentOffset = 0;

  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    currentOffset += bytes.length;
  };

  const pushText = (text: string) => {
    pushBytes(encoder.encode(text));
  };

  // PDF 1.4 Header + binary marker comment
  pushText("%PDF-1.4\n");
  pushBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const totalObjects = 2 + pages.length * 3;
  const offsets = new Array<number>(totalObjects + 1).fill(0);

  // Object 1: Catalog
  offsets[1] = currentOffset;
  pushText("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  // Object 2: Pages Tree
  const kidsRefs = pages.map((_, idx) => `${3 + idx * 3} 0 R`).join(" ");
  offsets[2] = currentOffset;
  pushText(`2 0 obj\n<< /Type /Pages /Kids [${kidsRefs}] /Count ${pages.length} >>\nendobj\n`);

  // Per-Page Objects: Page (3+3i), Image XObject (4+3i), Content Stream (5+3i)
  for (let i = 0; i < pages.length; i++) {
    const img = pages[i];
    const pageObjId = 3 + i * 3;
    const imgObjId = 4 + i * 3;
    const contentObjId = 5 + i * 3;

    const layout = computePageLayout(img.width, img.height, pageSize);

    // Page Object
    offsets[pageObjId] = currentOffset;
    pushText(
      `${pageObjId} 0 obj\n` +
        `<< /Type /Page /Parent 2 0 R ` +
        `/MediaBox [0 0 ${layout.pageW.toFixed(2)} ${layout.pageH.toFixed(2)}] ` +
        `/Resources << /ProcSet [/PDF /ImageC] /XObject << /Im0 ${imgObjId} 0 R >> >> ` +
        `/Contents ${contentObjId} 0 R >>\n` +
        `endobj\n`
    );

    // Image XObject
    offsets[imgObjId] = currentOffset;
    pushText(
      `${imgObjId} 0 obj\n` +
        `<< /Type /XObject /Subtype /Image ` +
        `/Width ${img.width} /Height ${img.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
        `/Filter /DCTDecode /Length ${img.jpegBytes.length} >>\n` +
        `stream\n`
    );
    pushBytes(img.jpegBytes);
    pushText("\nendstream\nendobj\n");

    // Content Stream
    const contentText =
      `q\n` +
      `${layout.drawW.toFixed(2)} 0 0 ${layout.drawH.toFixed(2)} ` +
      `${layout.offsetX.toFixed(2)} ${layout.offsetY.toFixed(2)} cm\n` +
      `/Im0 Do\n` +
      `Q\n`;
    const contentBytes = encoder.encode(contentText);

    offsets[contentObjId] = currentOffset;
    pushText(`${contentObjId} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
    pushBytes(contentBytes);
    pushText("endstream\nendobj\n");
  }

  // Cross-Reference Table
  const xrefOffset = currentOffset;
  pushText(`xref\n0 ${totalObjects + 1}\n`);
  pushText("0000000000 65535 f \n");
  for (let objId = 1; objId <= totalObjects; objId++) {
    pushText(`${String(offsets[objId]).padStart(10, "0")} 00000 n \n`);
  }

  // Trailer
  pushText(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  );

  // Combine into contiguous Uint8Array
  const output = new Uint8Array(currentOffset);
  let pos = 0;
  for (const chunk of chunks) {
    output.set(chunk, pos);
    pos += chunk.length;
  }
  return output;
}

// ─── End-to-End Pipeline (Encode → Assemble → Save / Download) ───────────────

export async function makePdfFromImages({
  images,
  fileName,
  pageSize,
  quality = 0.92,
  signal,
  onProgress,
}: MakePDFOptions): Promise<MakePDFResult | null> {
  if (images.length === 0) {
    throw new Error("Please add at least one image to create a PDF.");
  }
  if (images.length > MAX_TOTAL_IMAGES) {
    throw new Error("Image limit reached. Please remove some images and try again.");
  }

  const totalImages = images.length;
  const outputFileName = normalizePdfFileName(fileName);

  const emit = (
    stage: MakePDFProgress["stage"],
    currentImage: number,
    percent: number,
    errorMessage?: string
  ) => {
    onProgress?.({
      stage,
      currentImage,
      totalImages,
      percent: Math.min(100, Math.max(0, Math.round(percent))),
      errorMessage,
    });
  };

  try {
    const encodedPages: EncodedPageImage[] = [];

    // Phase 1: Normalize and encode each image
    for (let i = 0; i < totalImages; i++) {
      if (signal?.aborted) {
        emit("cancelled", i, (i / totalImages) * 80);
        return null;
      }

      emit("processing", i + 1, (i / totalImages) * 80);
      const encoded = await decodeAndEncodeAsJpeg(images[i].file, quality);
      encodedPages.push(encoded);

      // Yield control to keep UI responsive
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (signal?.aborted) {
      emit("cancelled", totalImages, 80);
      return null;
    }

    // Phase 2: Assemble PDF binary
    emit("building", totalImages, 88);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const pdfBytes = buildPdfFromJpegs(encodedPages, pageSize);
    const pdfBuffer = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength
    ) as ArrayBuffer;

    if (signal?.aborted) {
      emit("cancelled", totalImages, 94);
      return null;
    }

    // Phase 3: Save via native OS dialog in Tauri, or browser download
    emit("saving", totalImages, 95);
    const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

    if (IS_TAURI) {
      try {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const savePath = await save({
          defaultPath: outputFileName,
          filters: [{ name: "PDF Document", extensions: ["pdf"] }],
        });

        if (!savePath) {
          emit("cancelled", totalImages, 100);
          return {
            buffer: pdfBuffer,
            fileName: outputFileName,
            savedPath: "",
            cancelled: true,
          };
        }

        try {
          const { writeFile } = await import("@tauri-apps/plugin-fs");
          await writeFile(savePath, pdfBytes);
        } catch (fsErr) {
          console.warn("plugin-fs writeFile failed, falling back to write_binary_file:", fsErr);
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("write_binary_file", {
            path: savePath,
            data: Array.from(pdfBytes),
          });
        }

        const savedName = savePath.split(/[/\\]/).pop() || outputFileName;
        emit("complete", totalImages, 100);
        return {
          buffer: pdfBuffer,
          fileName: savedName,
          savedPath: savePath,
          cancelled: false,
        };
      } catch (err) {
        console.warn("Tauri native save error, falling back to browser download:", err);
      }
    }

    // Browser download fallback
    const pdfBlob = new Blob([pdfBytes as unknown as BlobPart], {
      type: "application/pdf",
    });
    const downloadUrl = URL.createObjectURL(pdfBlob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = outputFileName;
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

    emit("complete", totalImages, 100);
    return {
      buffer: pdfBuffer,
      fileName: outputFileName,
      savedPath: "",
      cancelled: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create PDF from images";
    emit("error", 0, 0, message);
    throw err;
  }
}
