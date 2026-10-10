#!/usr/bin/env node
// Copies the MediaPipe vision WASM runtime into public/ so the face detector is
// served from our own origin (no CDN, no third-party requests from the capture page).
// The BlazeFace model (Apache-2.0, ~230 KB) is committed at public/mediapipe/.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "node_modules/@mediapipe/tasks-vision/wasm");
const dst = resolve(root, "public/mediapipe/wasm");

if (!existsSync(src)) {
  console.warn("[copy-mediapipe] @mediapipe/tasks-vision not installed; skipping");
  process.exit(0);
}
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log("[copy-mediapipe] wasm runtime -> public/mediapipe/wasm");
