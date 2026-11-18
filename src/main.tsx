import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function bootstrap() {
  let initialFiles: string[] = [];

  if (IS_TAURI) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      initialFiles = await invoke<string[]>("take_pending_files");
    } catch {
      // ignore
    }
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App initialFiles={initialFiles} />
    </React.StrictMode>
  );
}

bootstrap();
