import { useEffect } from "react";
import { Loader2, CheckCircle2, AlertCircle, FileArchive } from "lucide-react";
import { type ExtractionProgress, getFormatLabel } from "../utils/pdfExtractor";
import styles from "./ExtractionProgressModal.module.css";

interface ExtractionProgressModalProps {
  progress: ExtractionProgress;
  onCancel: () => void;
  onClose: () => void;
}

export function ExtractionProgressModal({
  progress,
  onCancel,
  onClose,
}: ExtractionProgressModalProps) {
  const isComplete = progress.stage === "complete";
  const isError = progress.stage === "error";
  const isCancelled = progress.stage === "cancelled";
  const isRunning = progress.stage === "rendering" || progress.stage === "compressing";

  const formatLabel = getFormatLabel(progress.format);

  // Close on Escape if finished or error
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isRunning) {
          onCancel();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRunning, onCancel, onClose]);

  // Auto-dismiss after 2.5 seconds on completion
  useEffect(() => {
    if (isComplete) {
      const timer = setTimeout(() => {
        onClose();
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [isComplete, onClose]);

  const getStatusText = () => {
    switch (progress.stage) {
      case "rendering":
        return `Rendering page ${progress.currentPage} of ${progress.totalPages}…`;
      case "compressing":
        return "Packaging images into ZIP archive…";
      case "complete":
        return "Extraction complete! Download started.";
      case "cancelled":
        return "Extraction cancelled.";
      case "error":
        return progress.errorMessage || "An error occurred during extraction.";
      default:
        return "Processing…";
    }
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <div
            className={`${styles.iconWrap} ${
              isComplete ? styles.iconWrapComplete : isError ? styles.iconWrapError : ""
            }`}
          >
            {isRunning && <Loader2 size={22} strokeWidth={2.2} className={styles.spin} />}
            {isComplete && <CheckCircle2 size={24} strokeWidth={2.2} />}
            {isError && <AlertCircle size={24} strokeWidth={2.2} />}
            {isCancelled && <FileArchive size={22} strokeWidth={2.2} />}
          </div>

          <div className={styles.headerText}>
            <h3 className={styles.title}>
              {isComplete
                ? `Extracted as ${formatLabel}`
                : isError
                  ? "Extraction Failed"
                  : isCancelled
                    ? "Extraction Cancelled"
                    : `Extracting Pages as ${formatLabel}`}
            </h3>
            <span className={styles.fileName} title={progress.fileName}>
              {progress.fileName}
            </span>
          </div>
        </div>

        {/* Progress Section */}
        <div className={styles.progressSection}>
          <div className={styles.track}>
            <div
              className={`${styles.bar} ${
                isComplete ? styles.barComplete : isError ? styles.barError : ""
              }`}
              style={{ width: `${progress.percent}%` }}
            />
          </div>

          <div className={styles.statusRow}>
            <span className={styles.statusText}>{getStatusText()}</span>
            <span className={styles.percentText}>{progress.percent}%</span>
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          {isRunning ? (
            <button className={styles.cancelBtn} onClick={onCancel} type="button">
              Cancel
            </button>
          ) : (
            <button className={styles.doneBtn} onClick={onClose} type="button">
              {isComplete ? "Done" : "Close"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
