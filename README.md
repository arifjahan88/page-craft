<p align="center">
  <img src="assets/banner.png?v=1.0.1" alt="PageCraft - Modern Desktop & Web PDF Reader" width="100%" />
</p>

<p align="center">
  <a href="#-building-for-distribution"><img src="https://img.shields.io/badge/Release-v1.0.1-blueviolet?style=flat-square" alt="Version 1.0.1" /></a>
  <a href="https://tauri.app"><img src="https://img.shields.io/badge/Tauri-v2.0-24C8D8?style=flat-square&logo=tauri&logoColor=white" alt="Tauri v2" /></a>
  <a href="https://react.dev"><img src="https://img.shields.io/badge/React-18.3-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React 18" /></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-5.5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://vitejs.dev"><img src="https://img.shields.io/badge/Vite-5.4-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite" /></a>
  <a href="https://mozilla.github.io/pdf.js"><img src="https://img.shields.io/badge/PDF.js-v4.4-FF6600?style=flat-square&logo=firefox&logoColor=white" alt="PDF.js" /></a>
  <a href="#license"><img src="https://img.shields.io/badge/License-MIT-emerald?style=flat-square" alt="License" /></a>
</p>

<p align="center">
  <strong>PageCraft</strong> is an ultra-fast, minimal, and beautiful document reader built with <strong>Tauri v2</strong>, <strong>React 18</strong>, and <strong>PDF.js</strong>.<br />
  Engineered for distraction-free reading with smooth continuous scrolling, multi-tab workflows, images-to-PDF creation, cross-platform printing, and page-to-image extraction.
</p>

<p align="center">
  <a href="#-whats-new-in-v101">What's New in v1.0.1</a> •
  <a href="#-key-features">Key Features</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-keyboard-shortcuts">Shortcuts</a> •
  <a href="#-building-for-distribution">Distribution</a> •
  <a href="#-architecture">Architecture</a>
</p>

---

## 🆕 What's New in v1.0.1

Upgrades and fixes from `v1.0.0` → `v1.0.1`:

### ✨ New Features
- **🖼️ Make PDF from Images**: Convert `JPG`, `JPEG`, `PNG`, and `WebP` images into a single downloadable PDF directly inside PageCraft (accessible beside **Open PDF** on the home screen and beside **Open** in the top toolbar).
  - Supports uploading up to **20 images per batch** (with strict validation if more than 20 are selected at once) and **500 KB per image**, with unlimited batch additions.
  - Smooth 60fps pointer-event **drag-and-drop card sorting** powered by `@dnd-kit` (works natively across macOS WKWebView, Windows WebView2, Linux WebKitGTK, and all browsers).
  - Zero-dependency **PDF 1.4 binary generator** with automatic EXIF orientation handling, white background compositing for transparent PNG/WebP images, **Fit Image** & **A4** page sizing, clean `.pdf` filename validation, native OS Save dialog, and one-click **Open in PageCraft**.
- **📂 Multi-Select Recent Documents & Confirmation Modals**:
  - Open all recent documents at once with **Open All**, or multi-select specific cards via checkboxes, `Ctrl / ⌘ + Click`, or `Shift + Click` (with `Enter` to open selected and `Esc` to cancel).
  - Batch-remove selected documents or clear all recents safely behind a themed **Confirmation Modal** (`ConfirmModal`).
- **🔗 Native OS PDF File Associations & Multi-File Launch (Windows, Linux & macOS)**:
  - Registered `.pdf` file associations so you can double-click or right-click → **"Open With PageCraft"** on one or multiple PDF files simultaneously.
  - Added single-instance forwarding (`tauri-plugin-single-instance`) on Windows & Linux so launching additional PDFs opens them cleanly as tabs in the running window instead of spawning conflicting processes.
  - Added native Tauri webview drag-and-drop handling (`onDragDropEvent`) so dragging multiple files from Windows Explorer, Linux file managers, or macOS Finder works reliably.
- **🏷️ Automated Tag-Wise Releases & 1-Command Version Bumping**:
  - Added `yarn bump <version>` (`scripts/bump-version.js`) to synchronize versions across `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `README.md`.
  - GitHub Actions automatically synchronizes version metadata from the release tag so every installer filename matches the release tag.

### 🐛 Bug Fixes & Polish
- **🖨️ Windows & Linux Desktop Printing Fix**: Replaced broken `cmd /C start /P` and `lpr` print invocations with a reliable 150 DPI `pdf.js` `@media print` pipeline and **Print Progress Modal** (`PrintProgressModal`) so native print dialogs open properly on Windows (WebView2) and Linux (WebKitGTK), while preserving native `PDFKit` vector sheets on macOS.
- **🌊 Background Wave Clipping Fix**: Extended SVG wave paths (`X = -300` to `1740`, `Y = 450`) and set `overflow: visible` on the SVG so animated floating waves never expose vertical cut-off edges on wide screens.
- **🛡️ Windows Installer Metadata & SmartScreen Guidance**: Added official publisher (`PageCraft Team`), copyright, and NSIS `currentUser` installer metadata in `tauri.conf.json`, plus clear Windows SmartScreen installation steps in `README.md` and release notes.

---

## ✨ Key Features

### 🖼️ Make PDF from Images
- Combine `JPG`, `JPEG`, `PNG`, and `WebP` images into a single `.pdf` document completely offline — zero external uploads.
- Strict batch upload validation (**up to 20 images per upload**, **max 500 KB per image**) with clear inline warnings for invalid formats or oversized files.
- **60fps Drag-and-Drop Sorting**: Reorder pages visually in a responsive grid powered by `@dnd-kit` with live page badges (`1..N`) and lifted drag overlay.
- Choose between **Fit Image** (exact aspect ratio) or **A4** (auto-oriented portrait/landscape with margins), enter a clean filename (`.pdf` suffix attached automatically), and save via native OS dialog or browser download.

### 📑 Multi-Tab Workspace
- Open and manage up to **10 PDF documents simultaneously** with an intuitive, native-feeling tab bar.
- Each tab preserves its own independent scroll position, current page, and zoom level.
- Quickly cycle through open documents using `Ctrl / ⌘ + Tab` and `Ctrl / ⌘ + Shift + Tab`.

### 🎨 Aesthetic Aurora & Wave Interface
- Fluid, GPU-accelerated animated SVG waves and ambient aurora mesh glows create a calming home screen.
- Frosted glassmorphism (`backdrop-filter: blur`) cards with anti-aliased border radii.
- Seamless **Dark** and **Light** themes with smooth color transitions and persistent state.

### 🖨️ High-Fidelity Cross-Platform Print Dialog
- Prints documents directly from inside the app across all operating systems:
  - **Desktop (macOS)**: Integrates directly with native `PDFKit` and `AppKit` (`NSPrintOperation`), sliding down the native macOS vector print sheet inside the window.
  - **Desktop (Windows & Linux)**: Renders pages at high-DPI (150 DPI) via `pdf.js` into an isolated `@media print` layer with an interactive **Print Progress Modal** and cancellation support, opening the native Windows / Linux print dialog reliably.
  - **Web**: Uses an isolated, offscreen streaming `<iframe>` print pipeline with automatic memory cleanup.

### 📦 Multi-Format Page Extraction (ZIP Download)
- Extract every page of any PDF into crisp image files:
  - **PNG (`.png`)**: High-resolution lossless extraction at $2.0\times$ scale (ideal for diagrams and fine text).
  - **JPG (`.jpg`)**: High-efficiency photographic compression.
  - **WebP (`.webp`)**: Modern, compact web image format.
- **Zero-Dependency High-Speed ZIP Generator**: Built-in in-memory PKZip 2.0 containerizer with 32-bit CRC validation.
- **Human-Readable File Naming**: Structured naming with zero-padding (e.g., `Document - Page 01.png`, `Document - Extracted Pages (PNG).zip`).
- **Interactive Progress Modal**: Live progress bar, stage indicator, and cancellation support (`Escape` or Cancel button). Saves via native OS dialog in desktop mode.

### 🔍 Instant Full-Text Document Search
- Real-time full-document keyword matching with match counter indicator (`X / Y`).
- Jump forward (`Enter`) and backward (`Shift + Enter`) through matches across all pages.
- Highlighted text occurrences rendered directly within the selectable text layer.

### ⚡ Continuous Scroll & Lazy Rendering
- Vertical continuous document flow with lazy page virtualization powered by `IntersectionObserver`.
- Automatic viewport page tracking synchronized with the toolbar indicator and thumbnail navigation.
- Low-memory footprint: pages outside the preload threshold are cleanly de-allocated.

### 🕒 Persistent Recent Documents (Multi-Select & Batch Open)
- Card-based home screen grid displaying previously opened files with last-read page badges (`Page X of Y`).
- **One-Click "Open All"** & **Multi-Select Mode**: Hover checkboxes, `Ctrl / ⌘ + Click`, or `Shift + Click` to select multiple recent files and open or remove them in a batch.
- Safe **Confirmation Modal** before removing individual/selected files or clearing all recent history and cache.
- Backed by **IndexedDB** binary buffer storage for instant re-opening even in browser mode.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| `Ctrl / ⌘ + O` | **Open File** | Open native OS file picker (supports multi-selection) |
| `Ctrl / ⌘ + P` | **Print** | Trigger native in-app print dialog sheet |
| `Ctrl / ⌘ + F` | **Search** | Open full-text document search bar |
| `Ctrl / ⌘ + W` | **Close Tab** | Close active tab (returns to home screen when last tab closes) |
| `W` *(without Ctrl)* | **Fit to Width** | Instantly fit active page to viewer container width |
| `Ctrl / ⌘ + Tab` | **Next Tab** | Switch to the next open document |
| `Ctrl / ⌘ + Shift + Tab` | **Previous Tab** | Switch to the previous open document |
| `→` / `↓` / `Space` | **Next Page** | Navigate to the subsequent document page |
| `←` / `↑` | **Previous Page** | Navigate to the preceding document page |
| `Ctrl / ⌘ + =` | **Zoom In** | Increase document zoom level |
| `Ctrl / ⌘ + -` | **Zoom Out** | Decrease document zoom level |
| `Ctrl / ⌘ + 0` | **Reset Zoom** | Reset zoom level to 100% |
| `Ctrl + Scroll` | **Pinch Zoom** | Smooth mouse wheel zoom adjustment |
| `Click + Drag` | **Pan Document** | Pan around the canvas when zoomed in |
| `Escape` | **Close / Cancel** | Close search bar or abort ongoing extraction |

---

## 🚀 Quick Start

### Prerequisites

| Tool | Recommended Version | Download |
| :--- | :--- | :--- |
| **Node.js** | `>= 18.x` | [nodejs.org](https://nodejs.org) |
| **Rust & Cargo** *(for desktop)* | `stable` | [rustup.rs](https://rustup.rs) |

---

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-username/pagecraft.git
cd pagecraft

# 2. Install dependencies
yarn install
```

---

### Running in Development

#### 🖥️ Desktop Application (Tauri Live Reload)
```bash
yarn dev:desktop
```

#### 🌐 Web Application (Browser Mode)
```bash
yarn dev
```
Open [http://localhost:1420](http://localhost:1420) in your browser. All viewer features, search, tab management, and extraction work identically in web mode.

---

## 📦 Building for Distribution

### Unified Desktop Build Script
Run the automated desktop builder script:
```bash
yarn build:all
```

### Platform-Specific Commands

```bash
# macOS (.app & .dmg)
yarn build:mac

# macOS Universal Binary (Apple Silicon + Intel)
yarn build:mac:universal

# Windows (.exe NSIS & .msi) — run on Windows
yarn build:win

# Linux (.deb & .AppImage) — run on Linux
yarn build:linux
```

### 📂 Build Output Locations

| Platform | Package Format | Output Path |
| :--- | :--- | :--- |
| **macOS** | `.app` Bundle | `src-tauri/target/release/bundle/macos/PageCraft.app` |
| **macOS** | `.dmg` Installer | `src-tauri/target/release/bundle/dmg/PageCraft_1.0.1_aarch64.dmg` |
| **Windows** | `.exe` Setup | `src-tauri/target/release/bundle/nsis/PageCraft_1.0.1_x64-setup.exe` |
| **Windows** | `.msi` Package | `src-tauri/target/release/bundle/msi/PageCraft_1.0.1_x64_en-US.msi` |
| **Linux** | `.AppImage` | `src-tauri/target/release/bundle/appimage/pagecraft_1.0.1_amd64.AppImage` |
| **Linux** | `.deb` Package | `src-tauri/target/release/bundle/deb/pagecraft_1.0.1_amd64.deb` |

---

## ☁️ Automated Multi-Platform CI/CD

A pre-configured GitHub Actions workflow is included at [`.github/workflows/build-all.yml`](.github/workflows/build-all.yml). 

To build all installers, simply trigger the workflow manually from the **Actions** tab on GitHub (or push a release tag):
1. Matrix runners spin up on **macOS**, **Windows**, and **Ubuntu**.
2. Automatically synchronizes version metadata from your release tag across all config files.
3. Each platform compiles native GUI toolkits and packages installers with filenames matching the release tag.
4. Drafts a GitHub Release containing all `.dmg`, `.exe`, `.msi`, `.AppImage`, and `.deb` binaries ready for download.

### 🏷️ 1-Command Version Synchronizer

To bump the version across the entire repository before a release:

```bash
yarn bump 1.0.1
```

This single command atomically updates:
- `package.json` (`"version"`)
- `src-tauri/tauri.conf.json` (`"version"`)
- `src-tauri/Cargo.toml` (`version`)
- `README.md` (badges and download paths)

---

### 🛡️ Windows Installation & SmartScreen Notice

PageCraft is a 100% open-source, privacy-first desktop application without an expensive commercial code-signing certificate (\$200–\$500/year). When running the Windows installer for the first time on a new version, Microsoft Defender SmartScreen may show an *"Unrecognized app"* notice:

> **"Windows protected your PC — Microsoft Defender SmartScreen prevented an unrecognized app from starting."**

**How to run it in 2 clicks:**
1. Click **"More info"**
2. Click **"Run anyway"**

*(Alternatively, right-click the `.exe` installer → **Properties** → check **"Unblock"** → click **OK**).*

---

## 🏛️ Architecture & Project Structure

```
pagecraft/
├── .github/
│   └── workflows/
│       └── build-all.yml           # Multi-platform CI/CD release workflow
├── assets/
│   └── banner.png                  # High-resolution README banner preview
├── public/                         # Web assets & progressive web icons
│   ├── favicon.svg                 # Scalable vector favicon
│   ├── favicon-32x32.png           # Fallback PNG favicon
│   ├── apple-touch-icon.png        # Retina touch icon
│   └── site.webmanifest            # Web manifest configuration
├── scripts/
│   ├── build.js                    # Cross-platform desktop build runner
│   ├── bump-version.js             # 1-command version synchronizer (yarn bump)
│   └── generate-banner.js          # SVG-to-PNG hero banner generator
├── src-tauri/                      # Rust / Tauri desktop core
│   ├── capabilities/
│   │   └── default.json            # Security capability scopes (dialog, fs)
│   ├── icons/                      # Desktop icon bundle (icns, ico, png)
│   ├── src/
│   │   ├── main.rs                 # Single-instance queue, PDFKit print & binary FS commands
│   │   └── lib.rs                  # Library entrypoint
│   └── tauri.conf.json             # App metadata, file associations, NSIS & window specs
├── src/                            # React 18 UI layer
│   ├── components/
│   │   ├── ConfirmModal.tsx        # Confirmation dialog for remove / clear all actions
│   │   ├── ExtractionProgressModal.tsx # Page-to-image extraction progress & cancel UI
│   │   ├── MakePDFModal.tsx        # Images-to-PDF modal with @dnd-kit drag-and-drop sorting
│   │   ├── PDFViewer.tsx           # Continuous canvas viewer & home screen
│   │   ├── PrintProgressModal.tsx  # Windows/Linux raster print progress & cancel UI
│   │   ├── SearchBar.tsx           # Full-text search bar with match counter
│   │   ├── StatusBar.tsx           # Bottom page metrics & document status
│   │   ├── TabBar.tsx              # Multi-document tabs with close/add actions
│   │   └── Toolbar.tsx             # Responsive controls, zoom, print, Make PDF & export menu
│   ├── hooks/
│   │   ├── usePDF.ts               # Core PDF.js loader & text layer highlight engine
│   │   ├── useRecents.ts           # Recent document history & batch removal
│   │   ├── useTabs.ts              # Multi-document tab state & buffer storage
│   │   └── useTheme.tsx            # Fluid dark/light theme context & persistence
│   ├── styles/
│   │   └── globals.css             # Theme tokens, fluid wave animations & reset
│   ├── utils/
│   │   ├── pdfExtractor.ts         # High-resolution canvas rendering to image
│   │   ├── pdfMaker.ts             # Zero-dependency PDF 1.4 generator from images
│   │   ├── pdfPrinter.ts           # Hybrid native print bridge (macOS / Win / Linux / Web)
│   │   ├── pdfStorage.ts           # IndexedDB binary buffer persistence
│   │   └── zipWriter.ts            # Zero-dependency in-memory PKZip 2.0 generator
│   ├── App.tsx                     # Top-level coordinator & keyboard handlers
│   └── main.tsx                    # React DOM entry point
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 🛠️ Code Style & Quality

The codebase enforces strict TypeScript typing, Prettier formatting, and ESLint standards:

```bash
# Check code formatting
yarn format:check

# Format codebase with Prettier
yarn format

# Run linter
yarn lint:check
```

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.
