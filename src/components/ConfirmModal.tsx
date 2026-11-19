import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import styles from "./ConfirmModal.module.css";

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" onClick={onCancel}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.iconWrapDanger}>
            <AlertTriangle size={22} strokeWidth={2.2} />
          </div>
          <div className={styles.headerText}>
            <h3 className={styles.title}>{title}</h3>
            <p className={styles.message}>{message}</p>
          </div>
        </div>

        <div className={styles.footer}>
          <button ref={cancelBtnRef} type="button" className={styles.cancelBtn} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={styles.dangerBtn} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
