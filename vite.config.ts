import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

const pkg = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig(async () => ({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Tauri expects a fixed port in dev mode
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  // PDF.js worker needs to be served as a static asset
  optimizeDeps: {
    exclude: ["pdfjs-dist"],
  },
  worker: {
    format: "es",
  },
  build: {
    target: ["es2021", "chrome100", "safari13"],
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        manualChunks: {
          pdfjs: ["pdfjs-dist"],
        },
      },
    },
  },
}));
