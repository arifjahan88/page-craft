import { execSync } from "child_process";
import os from "os";

console.log("\n==========================================");
console.log("   PageCraft - Desktop App Builder");
console.log("==========================================\n");

const platform = os.platform();

if (platform === "darwin") {
  console.log("📦 Building macOS application (.app & .dmg)...\n");
  try {
    execSync("yarn tauri build", { stdio: "inherit" });
    console.log("\n✅ macOS build completed successfully!");
    console.log("📂 Output location:");
    console.log("   • .app: src-tauri/target/release/bundle/macos/PageCraft.app");
    console.log("   • .dmg: src-tauri/target/release/bundle/dmg/PageCraft_1.0.0_aarch64.dmg\n");
  } catch (err) {
    console.error("\n❌ macOS build failed:", err.message);
    process.exit(1);
  }

  console.log("------------------------------------------");
  console.log("ℹ️  Building for Windows & Linux:");
  console.log(
    "   Tauri desktop apps compile native OS GUI libraries (WebView2 on Windows, WebKitGTK on Linux)."
  );
  console.log(
    "   Because macOS lacks Windows & Linux system SDKs, Tauri does not support cross-packaging them directly on a Mac."
  );
  console.log(
    "   To build all 3 platforms (macOS, Windows, and Linux) automatically with 1 click:"
  );
  console.log("   👉 We created a GitHub Actions workflow: .github/workflows/build-all.yml");
  console.log(
    "   Simply push your repository to GitHub, and it will build and package all 3 operating systems in parallel!"
  );
  console.log("------------------------------------------\n");
} else if (platform === "win32") {
  console.log("📦 Building Windows application (.exe & .msi)...\n");
  execSync("yarn tauri build", { stdio: "inherit" });
  console.log("\n✅ Windows build completed successfully!");
  console.log("📂 Output location: src-tauri/target/release/bundle/nsis/ and /msi/");
} else if (platform === "linux") {
  console.log("📦 Building Linux application (.deb & .AppImage)...\n");
  execSync("yarn tauri build", { stdio: "inherit" });
  console.log("\n✅ Linux build completed successfully!");
  console.log("📂 Output location: src-tauri/target/release/bundle/appimage/ and /deb/");
}
