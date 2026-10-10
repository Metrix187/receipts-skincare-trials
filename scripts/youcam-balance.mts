// Prints your real YouCam unit balance and the skin-analysis price table.
// Both endpoints are free (0 units). Needs YOUCAM_API_KEY in .env.
//   npm run youcam:balance

const { YouCamClient } = await import("@/lib/youcam/client");

const key = process.env.YOUCAM_API_KEY;
if (!key) {
  console.error("YOUCAM_API_KEY is not set (put it in .env or run `npm run setup`).");
  process.exit(1);
}
const client = new YouCamClient({ apiKey: key, baseUrl: process.env.YOUCAM_BASE_URL });
const credits = await client.getCredits();
console.log(`Spendable API units: ${credits.spendable}`);
for (const b of credits.batches) {
  console.log(`  ${b.type}: ${b.amount}${b.expiry ? ` (expires ${new Date(b.expiry).toISOString().slice(0, 10)})` : ""}`);
}
console.log("\nSkin analysis pricing (units per successful task):");
for (const s of (await client.getFeatureCosts()).filter((s) => s.run_task_url.includes("/v2.1/"))) {
  console.log(`  ${s.description.padEnd(42)} ${s.amount}`);
}
