import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const selfie = resolve(__dirname, "fixtures/selfie.jpg");

test("capture -> analyze -> verdict (mock mode)", async ({ page }) => {
  // 1. New trial -> Protocol Agent (mock) designs it
  await page.goto("/trials/new");
  await page.getByTestId("product").fill("Smoke Test Serum");
  await page.getByTestId("claim").fill("Reduces redness in 4 weeks");
  await page.getByTestId("design-trial").click();
  await expect(page.getByTestId("protocol-card")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("protocol-card")).toContainText("Split-face");

  // 2. Pre-register (lock) the protocol
  await page.getByTestId("lock-protocol").click();
  await expect(page.getByTestId("today-card")).toBeVisible();
  await expect(page.getByTestId("verdict-panel")).toContainText("Not enough data");

  // 3. Capture: no camera in headless -> upload path; checks run client-side
  await page.getByTestId("take-selfie").click();
  await page.getByTestId("upload").setInputFiles(selfie);
  await expect(page.getByTestId("checks")).toContainText("One face found");
  await expect(page.getByTestId("checks")).toContainText("Even exposure");
  await expect(page.getByTestId("analyze")).toBeEnabled();
  await expect(page.getByTestId("analyze")).toContainText("mock: 0 units");

  // 4. Analyze through the (mock) YouCam client: upload -> task -> poll -> masks
  await page.getByTestId("analyze").click();
  await expect(page.getByTestId("capture-result")).toContainText("Day 0 logged", { timeout: 45_000 });
  await expect(page.getByTestId("capture-result")).toContainText("counts toward your trial");

  // 5. Verdict Agent (mock) must say "not enough data" honestly after one day
  await page.getByTestId("back-to-trial").click();
  await expect(page.getByTestId("done-today")).toBeVisible();
  await page.getByTestId("run-verdict").click();
  await expect(page.getByTestId("verdict-headline")).toContainText("Not enough data yet", { timeout: 30_000 });
  await expect(page.getByText("Verdict Agent: how it reasoned")).toBeVisible();

  // 6. Receipt renders and exports a PNG
  await page.getByTestId("open-receipt").click();
  await expect(page.getByTestId("receipt")).toContainText("Smoke Test Serum");
  const download = page.waitForEvent("download");
  await page.getByTestId("export-png").click();
  expect((await download).suggestedFilename()).toMatch(/^receipt-smoke-test-serum\.png$/);

  // 7. One-click photo wipe
  await page.goBack();
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("delete-photos").click();
  await expect(page.getByText("0 encrypted photos stored")).toBeVisible();
});
