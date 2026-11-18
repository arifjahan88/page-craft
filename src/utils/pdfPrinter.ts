// ─── Native High-Fidelity PDF Printing Utility ───────────────────────────────
// Creates an isolated PDF blob stream and invokes the native print dialog
// preserving 100% original vector sharpness, text, and page geometries.

export function printPDFBuffer(buffer: ArrayBuffer): void {
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
