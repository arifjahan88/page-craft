// ─── Native High-Fidelity PDF Printing Utility ───────────────────────────────
// In desktop (Tauri): invokes native OS print pipeline avoiding WKWebView sandbox issues
// In browser: creates an isolated PDF blob stream and invokes the native print dialog

export const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function printPDFBuffer(buffer: ArrayBuffer, filePath?: string): Promise<void> {
  if (IS_TAURI) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const data = filePath ? null : Array.from(new Uint8Array(buffer));
      await invoke("print_pdf_file", {
        path: filePath || null,
        data,
      });
      return;
    } catch (err) {
      console.warn("Tauri native print invocation error, falling back to browser print:", err);
    }
  }

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
      try {
        iframe.remove();
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }, 60_000);
  };

  document.body.appendChild(iframe);
}
