import { chromium } from "@playwright/test";
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

// Records the actual app against a synthetic-data-only server. Never accepts or
// displays a real photo, and refuses to proceed unless public demo mode is on.
const base = process.argv[2] ?? "http://127.0.0.1:3201";
const out = resolve("deliverables/video-work");
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: out, size: { width: 1280, height: 720 } }, colorScheme: "light", acceptDownloads: true });
let trialUrl = "";
async function scene(id, run) {
  const page = await context.newPage();
  try {
    await run(page);
    await page.waitForTimeout(2500);
  } finally {
    const video = page.video();
    await page.close();
    if (video) await copyFile(await video.path(), resolve(out, `${id}.webm`));
  }
  console.log(`Recorded ${id}.`);
}
try {
  await scene("01-intro", async (p) => {
    await p.goto(base, { waitUntil: "networkidle" });
    await p.getByText("Public demo: synthetic data", { exact: false }).waitFor();
    await p.getByTestId("start-trial").hover();
  });
  await scene("02-design", async (p) => {
    await p.goto(`${base}/trials/new`);
    await p.getByTestId("product").pressSequentially("Calming Serum", { delay: 35 });
    await p.getByTestId("claim").pressSequentially("Reduces redness in 4 weeks", { delay: 35 });
    await p.getByTestId("design-trial").click();
    await p.getByTestId("protocol-card").waitFor({ timeout: 30000 });
    trialUrl = p.url();
  });
  await scene("03-protocol", async (p) => {
    await p.goto(trialUrl);
    await p.getByText("Protocol Agent: how it reasoned").click();
    await p.getByText("Estimated YouCam units").scrollIntoViewIfNeeded();
    await p.waitForTimeout(1200);
    await p.getByTestId("lock-protocol").click();
    await p.getByTestId("today-card").waitFor();
  });
  await scene("04-capture", async (p) => {
    await p.goto(trialUrl);
    await p.getByTestId("take-selfie").click();
    await p.getByTestId("demo-check-in").waitFor();
    await p.waitForTimeout(900);
    await p.getByTestId("demo-check-in").click();
    await p.getByTestId("capture-result").waitFor({ timeout: 45000 });
  });
  await scene("05-not-enough", async (p) => {
    await p.goto(trialUrl);
    await p.getByTestId("run-verdict").click();
    await p.getByText("Verdict Agent: how it reasoned").waitFor({ timeout: 30000 });
    await p.getByTestId("verdict-panel").scrollIntoViewIfNeeded();
  });
  await scene("06-chart", async (p) => {
    await p.goto(`${base}/demo`, { waitUntil: "networkidle" });
    await p.getByRole("img", { name: /daily values and effect estimate/ }).scrollIntoViewIfNeeded();
  });
  await scene("07-receipt", async (p) => {
    await p.goto(`${base}/r/demo-azelaic`, { waitUntil: "networkidle" });
    await p.getByTestId("receipt").waitFor();
    await p.waitForTimeout(800);
    await p.getByTestId("export-png").scrollIntoViewIfNeeded();
    const download = p.waitForEvent("download");
    await p.getByTestId("export-png").click();
    await (await download).saveAs(resolve("deliverables/demo-receipt.png"));
  });
  await scene("08-youcam", async (p) => {
    await p.goto(`${base}/demo`, { waitUntil: "networkidle" });
    await p.getByTestId("protocol-card").scrollIntoViewIfNeeded();
    await p.waitForTimeout(800);
  });
} finally {
  await context.close();
  await browser.close();
}
