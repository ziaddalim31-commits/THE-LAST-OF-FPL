#!/usr/bin/env node
/**
 * THE LAST OF FPL — Static Assembly Script (Option A: original SPA)
 * Copies the original single-page site (tracked at the repo root) into ./public
 * so Vercel can publish it as a static site while api/ stays at the root as
 * serverless functions.
 *
 * Run: node shared/assemble/assemble.js
 * Output: ./public/ (Vercel-ready static site)
 *
 * This intentionally does NOT build the incomplete pages/ multi-page scaffold.
 * Original site files are copied verbatim (never simplified or replaced).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

// Original site files (relative to repo root) required by index.html.
const SPA_FILES = [
  'index.html',
  'style.css',
  'dashboard.css',
  'chapter2.css',
  'script.js',
];

// Original asset directories required by the site (copied recursively).
const SPA_DIRS = [
  'assets',
];

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(child => copyRecursive(path.join(src, child), path.join(dest, child)));
  } else {
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function main() {
  console.log('=== THE LAST OF FPL — Static Assembly (original SPA) ===');
  console.log(`Root:   ${ROOT}`);
  console.log(`Output: ${PUBLIC_DIR}`);

  if (fs.existsSync(PUBLIC_DIR)) {
    fs.rmSync(PUBLIC_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });

  let success = true;

  for (const rel of SPA_FILES) {
    const srcPath = path.join(ROOT, rel);
    if (!fs.existsSync(srcPath)) {
      console.error(`[error] Missing site file: ${rel}`);
      success = false;
      continue;
    }
    copyRecursive(srcPath, path.join(PUBLIC_DIR, rel));
    console.log(`[write] ${rel}`);
  }

  for (const rel of SPA_DIRS) {
    const srcPath = path.join(ROOT, rel);
    if (!fs.existsSync(srcPath)) {
      console.error(`[error] Missing asset directory: ${rel}`);
      success = false;
      continue;
    }
    copyRecursive(srcPath, path.join(PUBLIC_DIR, rel));
    console.log(`[write] ${rel}/`);
  }

  console.log(success ? '\n✅ Assembly complete' : '\n❌ Assembly completed with errors');
  process.exit(success ? 0 : 1);
}

main();