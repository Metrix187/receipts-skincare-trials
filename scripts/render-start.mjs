// Render's public, free demo: apply the schema, seed only a fresh database,
// and start the server. This never resets an existing database.
import { spawn, spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

if (process.env.RECEIPTS_PUBLIC_DEMO !== "1") throw new Error("This bootstrap is only for RECEIPTS_PUBLIC_DEMO=1.");
// The Postgres schema reads directUrl from DATABASE_URL_UNPOOLED. Render gives one
// connection string, so reuse it rather than relying on the start command to export it.
process.env.DATABASE_URL_UNPOOLED ||= process.env.DATABASE_URL;
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
function run(args) {
  const result = spawnSync(npx, args, { stdio: "inherit", env: process.env, shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(`Startup command failed: ${args[0]}`);
}
run(["prisma", "db", "push", "--skip-generate"]);
const db = new PrismaClient();
try {
  const existing = await db.trial.count({ where: { isDemo: true } });
  if (existing === 0) run(["tsx", "--conditions=react-server", "scripts/seed-demo.mts"]);
  else console.log(`[render-demo] Preserving ${existing} existing demo trials.`);
} finally { await db.$disconnect(); }
const server = spawn(npx, ["next", "start", "-H", "0.0.0.0", "-p", process.env.PORT || "10000"], {
  stdio: "inherit", env: process.env, shell: process.platform === "win32",
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 1));
