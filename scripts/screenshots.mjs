#!/usr/bin/env node
// Full-page screenshots of key pages (for README / visual QA).
//   node scripts/screenshots.mjs [outDir] [baseUrl]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "docs/screenshots";
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const pages = [
  ["home", "/"],
  ["demo-split-face", "/demo"],
  ["receipt-split-face", "/r/demo-azelaic"],
  ["receipt-pre-post", "/r/demo-collagen"],
  ["settings", "/settings"],
];
for (const scheme of ["light", "dark"]) {
  for (const [vw, label] of [[390, "mobile"], [1100, "desktop"]]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    for (const [name, path] of pages) {
      await page.goto(base + path, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
    await ctx.close();
  }
}
await browser.close();
console.log(`screenshots -> ${out}`);
