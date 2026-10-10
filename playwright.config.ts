import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// Smoke test of capture -> analyze -> verdict in full mock mode: no YouCam units,
// no Anthropic calls, no real face needed. Runs a production build on :3100 against
// its own SQLite file so it never touches dev data.
const PORT = 3100;
// A fresh SQLite file per run: nothing is ever reset or dropped. (Old e2e-*.db files are gitignored.)
const dbFile = (process.env.E2E_DB ??= `e2e-${Date.now()}.db`);
const env = {
  DATABASE_URL: `file:./${dbFile}`,
  MOCK_YOUCAM: "1",
  MOCK_AGENTS: "1",
  YOUCAM_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  NEXT_PUBLIC_FACE_DETECTOR: "mock",
  PHOTO_ENCRYPTION_KEY: process.env.E2E_PHOTO_KEY ?? (process.env.E2E_PHOTO_KEY = randomBytes(32).toString("base64")),
  NEXT_TELEMETRY_DISABLED: "1",
};

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Pixel 7"],
  },
  webServer: {
    command: `npx prisma db push --skip-generate && npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 300_000,
    reuseExistingServer: false,
    env,
  },
});
