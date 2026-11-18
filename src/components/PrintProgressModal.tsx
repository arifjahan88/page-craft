import { useEffect } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { type PrintProgress } from "../utils/pdfPrinter";
import styles from "./ExtractionProgressModal.module.css";

interface PrintProgressModalProps {
  progress: PrintProgress;
  onCancel: () => void;
  onClose: () => void;
}

export function PrintProgressModal({ progress, onCancel, onClose }: PrintProgressModalProps) {
  const isError = progress.stage === "error";
  const isRunning = progress.stage === "preparing" || progress.stage === "printing";

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isRunning) onCancel();
      else onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRunning, onCancel, onClose]);

  const statusText = isError
    ? progress.errorMessage || "Something went wrong while preparing the document."
    : progress.stage === "printing"
      ? "Opening print dialog…"
      : `Preparing page ${Math.min(progress.currentPage + 1, progress.totalPages)} of ${progress.totalPages}…`;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={`${styles.iconWrap} ${isError ? styles.iconWrapError : ""}`}>
            {isError ? (
              <AlertCircle size={24} strokeWidth={2.2} />
            ) : (
              <Loader2 size={22} strokeWidth={2.2} className={styles.spin} />
            )}
          </div>
          <div className={styles.headerText}>
            <h3 className={styles.title}>{isError ? "Print Failed" : "Preparing to Print"}</h3>
            <span className={styles.fileName} title={progress.fileName}>
              {progress.fileName}
            </span>
          </div>
        </div>

        <div className={styles.progressSection}>
          <div className={styles.track}>
            <div
              className={`${styles.bar} ${isError ? styles.barError : ""}`}
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <div className={styles.statusRow}>
            <span className={styles.statusText}>{statusText}</span>
            <span className={styles.percentText}>{progress.percent}%</span>
          </div>
        </div>

        <div className={styles.footer}>
          {isRunning ? (
            <button className={styles.cancelBtn} onClick={onCancel} type="button">
              Cancel
            </button>
          ) : (
            <button className={styles.doneBtn} onClick={onClose} type="button">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
