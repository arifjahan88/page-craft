#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const rawArg = process.argv[2];

if (!rawArg) {
  console.error("\n❌ Error: Missing version argument.");
  console.log("Usage:   yarn bump <version>");
  console.log("Example: yarn bump 1.0.1  (or yarn bump v1.0.1)\n");
  process.exit(1);
}

const cleanVersion = rawArg.trim().replace(/^v/, "");
const semverRegex = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

if (!semverRegex.test(cleanVersion)) {
  console.error(`\n❌ Error: Invalid semver version: "${rawArg}".`);
  console.log("Expected format: X.Y.Z (e.g. 1.0.1, 1.2.0, 2.0.0-beta.1)\n");
  process.exit(1);
}

console.log(`\n==========================================`);
console.log(`  PageCraft Version Synchronizer`);
console.log(`  Bumping version to: v${cleanVersion}`);
console.log(`==========================================\n`);

let oldVersion = "";

// 1. package.json
const packageJsonPath = path.join(rootDir, "package.json");
if (fs.existsSync(packageJsonPath)) {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  oldVersion = pkg.version;
  pkg.version = cleanVersion;
  fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`✅ Updated package.json: ${oldVersion} → ${cleanVersion}`);
}

// 2. src-tauri/tauri.conf.json
const tauriConfPath = path.join(rootDir, "src-tauri", "tauri.conf.json");
if (fs.existsSync(tauriConfPath)) {
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
  tauriConf.version = cleanVersion;
  fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");
  console.log(`✅ Updated src-tauri/tauri.conf.json: ${cleanVersion}`);
}

// 3. src-tauri/Cargo.toml
const cargoTomlPath = path.join(rootDir, "src-tauri", "Cargo.toml");
if (fs.existsSync(cargoTomlPath)) {
  let cargoContent = fs.readFileSync(cargoTomlPath, "utf8");
  cargoContent = cargoContent.replace(/^version = ".*"/m, `version = "${cleanVersion}"`);
  fs.writeFileSync(cargoTomlPath, cargoContent);
  console.log(`✅ Updated src-tauri/Cargo.toml: ${cleanVersion}`);
}

// 4. README.md
const readmePath = path.join(rootDir, "README.md");
if (fs.existsSync(readmePath) && oldVersion) {
  let readme = fs.readFileSync(readmePath, "utf8");

  // Replace shields badge and alt
  readme = readme.replace(
    new RegExp(`Release-v${oldVersion.replace(/\./g, "\\.")}-`, "g"),
    `Release-v${cleanVersion}-`
  );
  readme = readme.replace(
    new RegExp(`alt="Version ${oldVersion.replace(/\./g, "\\.")}"`, "g"),
    `alt="Version ${cleanVersion}"`
  );

  // Replace installer bundle filenames in table
  readme = readme.replace(
    new RegExp(`PageCraft_${oldVersion.replace(/\./g, "\\.")}_`, "g"),
    `PageCraft_${cleanVersion}_`
  );
  readme = readme.replace(
    new RegExp(`pagecraft_${oldVersion.replace(/\./g, "\\.")}_`, "g"),
    `pagecraft_${cleanVersion}_`
  );

  fs.writeFileSync(readmePath, readme);
  console.log(`✅ Updated README.md badges and installer paths`);
}

console.log("\n✨ Version bump completed successfully!");
console.log(`\nNext steps:`);
console.log(`  1. git commit -am "chore(release): bump version to v${cleanVersion}"`);
console.log(`  2. git push origin main`);
console.log(`  3. Run the GitHub Action with release version: v${cleanVersion}\n`);
