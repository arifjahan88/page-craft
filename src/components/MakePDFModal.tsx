import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  defaultDropAnimationSideEffects,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
  type DropAnimation,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ImagePlus,
  UploadCloud,
  X,
  GripVertical,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Loader2,
  FileOutput,
} from "lucide-react";
import {
  MAX_IMAGES_PER_UPLOAD,
  MAX_TOTAL_IMAGES,
  formatFileSize,
  validateImageFile,
  guessImageMimeType,
  sanitizePdfBaseName,
  normalizePdfFileName,
  makePdfFromImages,
  type PDFPageSize,
  type MakePDFProgress,
  type MakePDFResult,
} from "../utils/pdfMaker";
import styles from "./MakePDFModal.module.css";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

interface UploadedImageItem {
  id: string;
  file: Blob;
  name: string;
  size: number;
  previewUrl: string;
}

interface MakePDFModalProps {
  onClose: () => void;
  onOpenGeneratedPDF?: (buffer: ArrayBuffer, fileName: string, filePath: string) => void;
  externalDroppedPaths?: string[] | null;
  onExternalPathsConsumed?: () => void;
  isExternalFileDragOver?: boolean;
}

let _imgCounter = 1;
const nextImageId = () => `img-${Date.now()}-${_imgCounter++}`;

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const DROP_ANIMATION: DropAnimation = {
  duration: 220,
  easing: "cubic-bezier(0.25, 1, 0.5, 1)",
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: "0.3",
      },
    },
  }),
};

interface SortableImageCardProps {
  item: UploadedImageItem;
  pageNumber: number;
  disabled: boolean;
  onRemove: (id: string) => void;
}

function SortableImageCard({ item, pageNumber, disabled, onRemove }: SortableImageCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled,
    transition: {
      duration: 220,
      easing: "cubic-bezier(0.25, 1, 0.5, 1)",
    },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`${styles.card} ${isDragging ? styles.cardPlaceholder : ""}`}
      title={`${item.name} (${formatFileSize(item.size)}) — Drag to reorder`}
    >
      <div className={styles.thumbWrap}>
        <span className={styles.pageBadge}>{pageNumber}</span>
        <img src={item.previewUrl} alt={item.name} className={styles.thumbImg} draggable={false} />
        {!disabled && (
          <button
            type="button"
            className={styles.removeCardBtn}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(item.id);
            }}
            title={`Remove ${item.name}`}
            aria-label={`Remove ${item.name}`}
          >
            <X size={13} strokeWidth={2.5} />
          </button>
        )}
      </div>

      <div className={styles.cardFooter}>
        <GripVertical size={13} className={styles.gripIcon} />
        <div className={styles.cardMeta}>
          <span className={styles.cardName}>{item.name}</span>
          <span className={styles.cardSize}>{formatFileSize(item.size)}</span>
        </div>
      </div>
    </div>
  );
}

export function MakePDFModal({
  onClose,
  onOpenGeneratedPDF,
  externalDroppedPaths,
  onExternalPathsConsumed,
  isExternalFileDragOver = false,
}: MakePDFModalProps) {
  const [images, setImages] = useState<UploadedImageItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileNameError, setFileNameError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<PDFPageSize>("fit");
  const [isFileDragOver, setIsFileDragOver] = useState(false);

  // @dnd-kit pointer-event sorting state (works natively in Tauri & browsers)
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overDragId, setOverDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Generation state
  const [progress, setProgress] = useState<MakePDFProgress | null>(null);
  const [generatedResult, setGeneratedResult] = useState<MakePDFResult | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileNameInputRef = useRef<HTMLInputElement>(null);
  const overlayPointerDownRef = useRef(false);
  const imagesRef = useRef<UploadedImageItem[]>([]);
  imagesRef.current = images;

  const isGenerating =
    progress?.stage === "processing" ||
    progress?.stage === "building" ||
    progress?.stage === "saving";

  const imageIds = useMemo(() => images.map((img) => img.id), [images]);
  const activeItem = useMemo(
    () => (activeDragId ? (images.find((img) => img.id === activeDragId) ?? null) : null),
    [activeDragId, images]
  );
  const activeOverlayPageNumber = useMemo(() => {
    if (!activeDragId) return 1;
    const targetIdx = overDragId ? images.findIndex((img) => img.id === overDragId) : -1;
    if (targetIdx !== -1) return targetIdx + 1;
    const activeIdx = images.findIndex((img) => img.id === activeDragId);
    return activeIdx !== -1 ? activeIdx + 1 : 1;
  }, [activeDragId, overDragId, images]);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      for (const item of imagesRef.current) {
        URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  // Escape key to close (or cancel while generating; ignored while dragging)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (activeDragId) return; // let @dnd-kit cancel the active drag
      e.preventDefault();
      if (isGenerating) {
        abortControllerRef.current?.abort();
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeDragId, isGenerating, onClose]);

  // ── Add validated files into the sortable queue ───────────────────────────
  const addIncomingFiles = useCallback(
    (incoming: Array<{ file: Blob; name: string; mimeType: string; size: number }>) => {
      if (incoming.length === 0) return;

      if (incoming.length > MAX_IMAGES_PER_UPLOAD) {
        setBatchError(
          `You selected ${incoming.length} images. Please select at most ${MAX_IMAGES_PER_UPLOAD} images at a time.`
        );
        setWarnings([]);
        return;
      }

      setBatchError(null);

      const totalRemaining = MAX_TOTAL_IMAGES - imagesRef.current.length;
      if (totalRemaining <= 0) {
        return;
      }

      const nextWarnings: string[] = [];
      const accepted: UploadedImageItem[] = [];

      for (const item of incoming) {
        const validation = validateImageFile(item.name, item.mimeType, item.size);
        if (!validation.valid) {
          if (validation.message) nextWarnings.push(validation.message);
          continue;
        }
        if (accepted.length >= totalRemaining) {
          break;
        }
        const previewUrl = URL.createObjectURL(item.file);
        accepted.push({
          id: nextImageId(),
          file: item.file,
          name: item.name,
          size: item.size,
          previewUrl,
        });
      }

      if (accepted.length > 0) {
        setImages((prev) => [...prev, ...accepted]);
        setGeneratedResult(null);
        setProgress(null);
      }

      setWarnings(nextWarnings);
    },
    []
  );

  // ── Load image paths from Tauri filesystem ────────────────────────────────
  const loadPathsFromDisk = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;

      if (paths.length > MAX_IMAGES_PER_UPLOAD) {
        setBatchError(
          `You selected ${paths.length} images. Please select at most ${MAX_IMAGES_PER_UPLOAD} images at a time.`
        );
        setWarnings([]);
        return;
      }

      setBatchError(null);
      const loaded: Array<{ file: Blob; name: string; mimeType: string; size: number }> = [];
      const readErrors: string[] = [];

      for (const filePath of paths) {
        const name = filePath.split(/[/\\]/).pop() || "image";
        const mimeType = guessImageMimeType(name);

        // Quick format pre-check before reading bytes from disk
        const formatCheck = validateImageFile(name, mimeType, 1);
        if (!formatCheck.valid) {
          if (formatCheck.message) readErrors.push(formatCheck.message);
          continue;
        }

        try {
          let bytes: Uint8Array;
          try {
            const { readFile } = await import("@tauri-apps/plugin-fs");
            bytes = await readFile(filePath);
          } catch {
            const { invoke } = await import("@tauri-apps/api/core");
            const base64 = await invoke<string>("read_binary_file", { path: filePath });
            bytes = base64ToUint8Array(base64);
          }

          const blob = new Blob([bytes as unknown as BlobPart], { type: mimeType });
          loaded.push({
            file: blob,
            name,
            mimeType,
            size: bytes.byteLength,
          });
        } catch (err) {
          console.error(`Failed to read image ${filePath}:`, err);
          readErrors.push(`${name} (could not read file from disk)`);
        }
      }

      if (loaded.length > 0) {
        addIncomingFiles(loaded);
      }
      if (readErrors.length > 0) {
        setWarnings((prev) => [...readErrors, ...prev]);
      }
    },
    [addIncomingFiles]
  );

  // Handle OS file drops routed from App.tsx while modal is open in Tauri
  useEffect(() => {
    if (!externalDroppedPaths || externalDroppedPaths.length === 0) return;
    loadPathsFromDisk(externalDroppedPaths);
    onExternalPathsConsumed?.();
  }, [externalDroppedPaths, loadPathsFromDisk, onExternalPathsConsumed]);

  // ── Trigger file picker ───────────────────────────────────────────────────
  const handlePickImages = useCallback(async () => {
    if (isGenerating || images.length >= MAX_TOTAL_IMAGES) return;

    if (IS_TAURI) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({
          multiple: true,
          filters: [
            { name: "Images (JPG, PNG, WebP)", extensions: ["jpg", "jpeg", "png", "webp"] },
          ],
        });
        if (!selected) return;
        const paths = Array.isArray(selected) ? selected : [selected];
        await loadPathsFromDisk(paths);
        return;
      } catch (err) {
        console.warn("Tauri image picker failed, falling back to browser input:", err);
      }
    }

    fileInputRef.current?.click();
  }, [isGenerating, images.length, loadPathsFromDisk]);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) {
        addIncomingFiles(
          files.map((f) => ({
            file: f,
            name: f.name,
            mimeType: f.type,
            size: f.size,
          }))
        );
      }
      e.target.value = "";
    },
    [addIncomingFiles]
  );

  // ── HTML5 File Drag & Drop onto Modal (Web Browser) ───────────────────────
  const handleModalDragOver = useCallback(
    (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes("Files")) {
        e.preventDefault();
        e.stopPropagation();
        if (!isGenerating) setIsFileDragOver(true);
      }
    },
    [isGenerating]
  );

  const handleModalDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsFileDragOver(false);
  }, []);

  const handleModalDrop = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      setIsFileDragOver(false);
      if (isGenerating) return;

      const files = Array.from(e.dataTransfer.files || []);
      if (files.length > 0) {
        addIncomingFiles(
          files.map((f) => ({
            file: f,
            name: f.name,
            mimeType: f.type,
            size: f.size,
          }))
        );
      }
    },
    [isGenerating, addIncomingFiles]
  );

  // ── @dnd-kit Pointer-Based Drag-and-Drop Sorting ──────────────────────────
  const handleDndStart = useCallback((event: DragStartEvent) => {
    const id = String(event.active.id);
    setActiveDragId(id);
    setOverDragId(id);
  }, []);

  const handleDndOver = useCallback((event: DragOverEvent) => {
    setOverDragId(event.over ? String(event.over.id) : null);
  }, []);

  const handleDndEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);
    setOverDragId(null);

    if (over && active.id !== over.id) {
      setImages((prev) => {
        const oldIndex = prev.findIndex((item) => item.id === active.id);
        const newIndex = prev.findIndex((item) => item.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return prev;
        return arrayMove(prev, oldIndex, newIndex);
      });
      setGeneratedResult(null);
    }
  }, []);

  const handleDndCancel = useCallback(() => {
    setActiveDragId(null);
    setOverDragId(null);
  }, []);

  // ── Remove / Clear ────────────────────────────────────────────────────────
  const handleRemoveImage = useCallback((id: string) => {
    setImages((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
    setGeneratedResult(null);
  }, []);

  const handleClearAll = useCallback(() => {
    for (const item of imagesRef.current) {
      URL.revokeObjectURL(item.previewUrl);
    }
    setImages([]);
    setWarnings([]);
    setBatchError(null);
    setProgress(null);
    setGeneratedResult(null);
  }, []);

  // ── Start Making PDF ──────────────────────────────────────────────────────
  const handleStartMakingPDF = useCallback(async () => {
    if (images.length === 0 || isGenerating) return;

    const cleanBase = sanitizePdfBaseName(fileName);
    if (!cleanBase) {
      setFileNameError("Please enter a file name.");
      fileNameInputRef.current?.focus();
      return;
    }

    setFileNameError(null);
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setGeneratedResult(null);
    setWarnings([]);

    try {
      const result = await makePdfFromImages({
        images: images.map((img) => ({ file: img.file, name: img.name })),
        fileName: normalizePdfFileName(cleanBase),
        pageSize,
        signal: controller.signal,
        onProgress: (p) => setProgress(p),
      });

      if (result && !result.cancelled) {
        setGeneratedResult(result);
      }
    } catch (err) {
      console.error("Make PDF error:", err);
    }
  }, [images, isGenerating, fileName, pageSize]);

  const handleOpenCreatedInViewer = useCallback(() => {
    if (!generatedResult || !onOpenGeneratedPDF) return;
    onOpenGeneratedPDF(
      generatedResult.buffer.slice(0),
      generatedResult.fileName,
      generatedResult.savedPath
    );
    onClose();
  }, [generatedResult, onOpenGeneratedPDF, onClose]);

  const isAnyFileDragOver = isFileDragOver || isExternalFileDragOver;
  const visibleWarnings = warnings.slice(0, 4);
  const hiddenWarningCount = Math.max(0, warnings.length - visibleWarnings.length);

  const progressText =
    progress?.stage === "processing"
      ? `Processing image ${progress.currentImage} of ${progress.totalImages}…`
      : progress?.stage === "building"
        ? "Assembling PDF document…"
        : progress?.stage === "saving"
          ? "Saving PDF…"
          : "";

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="make-pdf-modal-title"
      onPointerDown={(e) => {
        overlayPointerDownRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (overlayPointerDownRef.current && e.target === e.currentTarget && !isGenerating) {
          onClose();
        }
        overlayPointerDownRef.current = false;
      }}
      onDragOver={handleModalDragOver}
      onDragLeave={handleModalDragLeave}
      onDrop={handleModalDrop}
    >
      <div
        className={`${styles.modal} ${isAnyFileDragOver ? styles.modalFileDragOver : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          className={styles.hiddenInput}
          onChange={handleFileInputChange}
        />

        {/* ── Header ── */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.iconWrap}>
              <ImagePlus size={20} strokeWidth={2} />
            </div>
            <div className={styles.headerText}>
              <h3 id="make-pdf-modal-title" className={styles.title}>
                Make PDF from Images
              </h3>
              <span className={styles.subtitle}>
                Upload images, drag cards to sort page order, then export as PDF
              </span>
            </div>
          </div>

          <div className={styles.headerRight}>
            <span className={styles.countPill}>
              {images.length} {images.length === 1 ? "image" : "images"}
            </span>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              disabled={isGenerating}
              title="Close (Esc)"
              aria-label="Close Make PDF modal"
            >
              <X size={16} strokeWidth={2.2} />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className={styles.body}>
          {/* Strict Batch Limit Error (> 20 selected at once) */}
          {batchError && (
            <div className={styles.errorBanner} role="alert">
              <AlertCircle size={16} />
              <span style={{ flex: 1 }}>{batchError}</span>
              <button
                type="button"
                className={styles.warningDismiss}
                onClick={() => setBatchError(null)}
                title="Dismiss error"
                aria-label="Dismiss error"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Validation Warnings */}
          {warnings.length > 0 && (
            <div className={styles.warningBanner} role="alert">
              <AlertCircle size={16} className={styles.warningBannerIcon} />
              <div className={styles.warningList}>
                <strong>Some files were skipped:</strong>
                {visibleWarnings.map((msg, i) => (
                  <span key={i}>• {msg}</span>
                ))}
                {hiddenWarningCount > 0 && <span>• and {hiddenWarningCount} more…</span>}
              </div>
              <button
                type="button"
                className={styles.warningDismiss}
                onClick={() => setWarnings([])}
                title="Dismiss warning"
                aria-label="Dismiss warning"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Generation Error */}
          {progress?.stage === "error" && (
            <div className={styles.errorBanner} role="alert">
              <AlertCircle size={16} />
              <span>{progress.errorMessage || "Failed to generate PDF."}</span>
            </div>
          )}

          {/* Success Banner */}
          {generatedResult && progress?.stage === "complete" && (
            <div className={styles.successBanner}>
              <div className={styles.successLeft}>
                <CheckCircle2 size={16} className={styles.successIcon} />
                <span>
                  Created <strong>{generatedResult.fileName}</strong> ({images.length}{" "}
                  {images.length === 1 ? "page" : "pages"})
                </span>
              </div>
              {onOpenGeneratedPDF && (
                <button
                  type="button"
                  className={styles.openCreatedBtn}
                  onClick={handleOpenCreatedInViewer}
                >
                  Open in PageCraft
                </button>
              )}
            </div>
          )}

          {/* Empty Dropzone OR Sortable Image List */}
          {images.length === 0 ? (
            <div
              className={`${styles.dropzone} ${isAnyFileDragOver ? styles.dropzoneActive : ""}`}
              onClick={handlePickImages}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handlePickImages();
                }
              }}
            >
              <div className={styles.dropzoneIcon}>
                <UploadCloud size={26} strokeWidth={1.8} />
              </div>
              <span className={styles.dropzoneTitle}>
                {isAnyFileDragOver ? "Drop images to add" : "Click to upload or drag & drop images"}
              </span>
              <span className={styles.dropzoneHint}>
                Select multiple images at once and reorder them before generating your PDF
              </span>
              <div className={styles.specChips}>
                <span className={styles.specChip}>JPG / JPEG / PNG / WebP</span>
                <span className={styles.specChip}>
                  Up to {MAX_IMAGES_PER_UPLOAD} images per upload
                </span>
                <span className={styles.specChip}>Max 500 KB per image</span>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.listToolbar}>
                <div className={styles.listToolbarLeft}>
                  <button
                    type="button"
                    className={styles.addMoreBtn}
                    onClick={handlePickImages}
                    disabled={isGenerating || images.length >= MAX_TOTAL_IMAGES}
                  >
                    <ImagePlus size={14} strokeWidth={2} />
                    <span>Add More Images</span>
                  </button>
                  <span className={styles.sortHint}>Drag and drop cards to change page order</span>
                </div>

                <button
                  type="button"
                  className={styles.clearBtn}
                  onClick={handleClearAll}
                  disabled={isGenerating}
                >
                  <Trash2 size={13} strokeWidth={2} />
                  <span>Clear all</span>
                </button>
              </div>

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDndStart}
                onDragOver={handleDndOver}
                onDragEnd={handleDndEnd}
                onDragCancel={handleDndCancel}
              >
                <SortableContext items={imageIds} strategy={rectSortingStrategy}>
                  <div className={styles.grid}>
                    {images.map((item, idx) => (
                      <SortableImageCard
                        key={item.id}
                        item={item}
                        pageNumber={idx + 1}
                        disabled={isGenerating}
                        onRemove={handleRemoveImage}
                      />
                    ))}
                  </div>
                </SortableContext>

                <DragOverlay dropAnimation={DROP_ANIMATION} zIndex={1100}>
                  {activeItem ? (
                    <div className={`${styles.card} ${styles.cardOverlay}`}>
                      <div className={styles.thumbWrap}>
                        <span className={styles.pageBadge}>{activeOverlayPageNumber}</span>
                        <img
                          src={activeItem.previewUrl}
                          alt={activeItem.name}
                          className={styles.thumbImg}
                          draggable={false}
                        />
                      </div>
                      <div className={styles.cardFooter}>
                        <GripVertical size={13} className={styles.gripIcon} />
                        <div className={styles.cardMeta}>
                          <span className={styles.cardName}>{activeItem.name}</span>
                          <span className={styles.cardSize}>{formatFileSize(activeItem.size)}</span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            </>
          )}

          {/* Generation Progress */}
          {isGenerating && progress && (
            <div className={styles.progressWrap}>
              <div className={styles.progressRow}>
                <span>{progressText}</span>
                <span className={styles.progressPercent}>{progress.percent}%</span>
              </div>
              <div className={styles.track}>
                <div className={styles.bar} style={{ width: `${progress.percent}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* ── Footer Settings & Actions ── */}
        <div className={styles.footerWrap}>
          <div className={styles.settingsRow}>
            <div className={styles.fieldGroup}>
              <label htmlFor="make-pdf-filename" className={styles.fieldLabel}>
                File name
              </label>
              <div className={styles.fieldColumn}>
                <div
                  className={`${styles.fileNameInputWrap} ${fileNameError ? styles.fileNameInputWrapError : ""}`}
                >
                  <input
                    ref={fileNameInputRef}
                    id="make-pdf-filename"
                    type="text"
                    className={styles.fileNameInput}
                    value={fileName}
                    onChange={(e) => {
                      setFileName(e.target.value);
                      if (fileNameError) setFileNameError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && images.length > 0 && !isGenerating) {
                        e.preventDefault();
                        handleStartMakingPDF();
                      }
                    }}
                    disabled={isGenerating}
                    placeholder="Enter file name"
                    aria-invalid={Boolean(fileNameError)}
                    aria-describedby={fileNameError ? "make-pdf-filename-error" : undefined}
                  />
                  <span className={styles.fileNameSuffix}>.pdf</span>
                </div>
                {fileNameError && (
                  <span id="make-pdf-filename-error" className={styles.fieldError} role="alert">
                    <AlertCircle size={12} />
                    <span>{fileNameError}</span>
                  </span>
                )}
              </div>
            </div>

            <div className={styles.pageSizeGroup}>
              <span className={styles.pageSizeLabel}>Page size</span>
              <div className={styles.segmented} role="radiogroup" aria-label="PDF page size">
                <button
                  type="button"
                  role="radio"
                  aria-checked={pageSize === "fit"}
                  className={`${styles.segmentBtn} ${pageSize === "fit" ? styles.segmentBtnActive : ""}`}
                  onClick={() => setPageSize("fit")}
                  disabled={isGenerating}
                >
                  Fit Image
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={pageSize === "a4"}
                  className={`${styles.segmentBtn} ${pageSize === "a4" ? styles.segmentBtnActive : ""}`}
                  onClick={() => setPageSize("a4")}
                  disabled={isGenerating}
                >
                  A4
                </button>
              </div>
            </div>
          </div>

          <div className={styles.actionsRow}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={() => {
                if (isGenerating) {
                  abortControllerRef.current?.abort();
                } else {
                  onClose();
                }
              }}
            >
              {isGenerating ? "Cancel" : "Close"}
            </button>

            <button
              type="button"
              className={styles.startBtn}
              onClick={handleStartMakingPDF}
              disabled={images.length === 0 || isGenerating}
            >
              {isGenerating ? (
                <>
                  <Loader2 size={15} className={styles.spin} />
                  <span>Making PDF…</span>
                </>
              ) : (
                <>
                  <FileOutput size={15} strokeWidth={2.2} />
                  <span>Start Making PDF</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
