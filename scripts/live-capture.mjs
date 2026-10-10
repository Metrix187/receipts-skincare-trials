#!/usr/bin/env node
// Runs one photo through the REAL app flow in a headless browser: new trial ->
// lock -> capture page (real MediaPipe detector + on-device checks) -> Analyze.
// With MOCK_YOUCAM=0 on the dev server this spends real units (9 at SD, 1-4 concerns).
//
//   node scripts/live-capture.mjs <photo.jpg> [baseUrl]
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const photo = resolve(process.argv[2] ?? "");
const base = process.argv[3] ?? "http://localhost:3000";
if (!existsSync(photo)) {
  console.error("usage: node scripts/live-capture.mjs <photo.jpg> [baseUrl]");
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
try {
  await page.goto(`${base}/trials/new`);
  await page.getByTestId("product").fill("Live check (real YouCam call)");
  await page.getByTestId("claim").fill("Reduces redness in 4 weeks");
  await page.getByTestId("design-trial").click();
  await page.getByTestId("lock-protocol").click({ timeout: 60_000 });
  await page.getByTestId("take-selfie").click();
  await page.getByTestId("upload").setInputFiles(photo);

  const checks = page.getByTestId("checks");
  await checks.waitFor({ timeout: 30_000 });
  console.log("on-device checks:\n" + (await checks.innerText()).replace(/\n(?=[✓!✕])/g, "\n  ").trim());
  const analyze = page.getByTestId("analyze");
  if (!(await analyze.isEnabled())) {
    console.error("\nThe photo failed an on-device check, so nothing was sent and no units were spent.");
    process.exit(2);
  }
  console.log(`\nclicking: ${await analyze.innerText()}`);
  await analyze.click();
  const result = page.getByTestId("capture-result");
  await result.waitFor({ timeout: 120_000 });
  console.log("\nresult: " + (await result.innerText()).split("\n").slice(0, 3).join(" | "));
  console.log(`trial: ${page.url().replace(/\/capture$/, "")}`);
} finally {
  await browser.close();
}
