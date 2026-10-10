// Inspect one real (non-mock) capture end to end: the stored YouCam result, each
// detection mask (format, size, which channel encodes detection), the per-cheek
// coverage, and an overlay image showing exactly which pixels were measured.
// Mask URLs are pre-signed and expire (~24h), so run this soon after the capture.
//
//   npm run inspect:capture [-- <captureId>] [-- --out <dir>]

const { db } = await import("@/lib/db");
const { decryptBytes, parseKey } = await import("@/lib/crypto");
const { cheekRegions, maskCoverageBySide } = await import("@/lib/analysis/mask-sides");
const { default: sharp } = await import("sharp");
const { mkdirSync, writeFileSync } = await import("node:fs");
const { join, resolve } = await import("node:path");

type Score = { concern: string; action: string; region: string; uiScore: number | null; rawScore: number | null; maskUrls: string[] };

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const out = resolve(outIdx > -1 ? args[outIdx + 1] : "inspect-out");
const id = args.find((a, i) => !a.startsWith("--") && i !== outIdx + 1);

const capture = await db.capture.findFirst({
  where: id ? { id } : { mock: false, status: "success" },
  orderBy: { capturedAt: "desc" },
  include: { photo: true, measurements: true, trial: true },
});
if (!capture) {
  console.error("No live capture found (MOCK_YOUCAM=0 + one analyzed photo needed).");
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const face = capture.face as { box: { x: number; y: number; w: number; h: number }; midlineX: number; rollDeg: number };
const result = capture.youcamResult as { taskId: string; scores: Score[]; overall: number | null; skinAge: number | null } | null;

console.log(`capture ${capture.id} · day ${capture.dayIndex} · ${capture.status} · units ${capture.units} · mock=${capture.mock}`);
console.log(`trial: ${capture.trial.productName} · ${capture.trial.design} · treated=${capture.trial.treatedSide}`);
console.log(`face (normalized to crop): ${JSON.stringify(face)}`);
console.log(`overall=${result?.overall} skinAge=${result?.skinAge}`);
for (const s of result?.scores ?? []) {
  console.log(`  ${s.action.padEnd(16)} region=${s.region.padEnd(6)} ui=${s.uiScore} raw=${s.rawScore} masks=${s.maskUrls.length}`);
}
writeFileSync(join(out, "youcam-result.json"), JSON.stringify(result, null, 2));

// Photo
let photoPath: string | null = null;
let pw = 0;
let ph = 0;
if (capture.photo) {
  const bytes = decryptBytes(parseKey(process.env.PHOTO_ENCRYPTION_KEY!), capture.photo, capture.id);
  photoPath = join(out, "photo.jpg");
  writeFileSync(photoPath, bytes);
  pw = capture.photo.width;
  ph = capture.photo.height;
  console.log(`photo: ${pw}x${ph}`);
}

// Masks
for (const s of result?.scores ?? []) {
  const url = s.maskUrls[0];
  if (!url) continue;
  const res = await fetch(url);
  if (!res.ok) {
    console.log(`  ${s.concern}: mask download HTTP ${res.status} (expired?)`);
    continue;
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const ext = url.split("?")[0].split(".").pop();
  const file = join(out, `mask-${s.action}-${s.region}.${ext}`);
  writeFileSync(file, buf);
  const meta = await sharp(buf).metadata();
  const cov = await maskCoverageBySide(buf, face);
  console.log(`  ${s.concern}: ${meta.format} ${meta.width}x${meta.height} channels=${meta.channels} hasAlpha=${meta.hasAlpha} -> read via ${cov.channel}; coverage L=${cov.left} R=${cov.right} whole=${cov.whole}`);

  // Overlay: photo + mask tint + measured cheek regions + midline.
  if (photoPath) {
    const maskRgba = await sharp(buf).resize(pw, ph, { fit: "fill" }).ensureAlpha().raw().toBuffer();
    const tint = Buffer.alloc(pw * ph * 4);
    for (let i = 0; i < pw * ph; i++) {
      const a = cov.channel === "alpha" ? maskRgba[i * 4 + 3] : Math.round(0.2126 * maskRgba[i * 4] + 0.7152 * maskRgba[i * 4 + 1] + 0.0722 * maskRgba[i * 4 + 2]);
      tint.set([255, 40, 160, Math.round(a * 0.75)], i * 4);
    }
    const { imageLeft, imageRight } = cheekRegions(face);
    const r = (q: { x0: number; x1: number; y0: number; y1: number }, color: string, label: string) =>
      `<rect x="${q.x0 * pw}" y="${q.y0 * ph}" width="${(q.x1 - q.x0) * pw}" height="${(q.y1 - q.y0) * ph}" fill="none" stroke="${color}" stroke-width="4"/>` +
      `<text x="${q.x0 * pw + 8}" y="${q.y0 * ph + 28}" font-size="26" fill="${color}" font-family="sans-serif">${label}</text>`;
    const b = face.box;
    const svg = `<svg width="${pw}" height="${ph}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${b.x * pw}" y="${b.y * ph}" width="${b.w * pw}" height="${b.h * ph}" fill="none" stroke="white" stroke-width="2" stroke-dasharray="8 6"/>
      <line x1="${face.midlineX * pw}" x2="${face.midlineX * pw}" y1="0" y2="${ph}" stroke="yellow" stroke-width="2"/>
      ${r(imageLeft, "#3987e5", "subject RIGHT")}${r(imageRight, "#ff9a3c", "subject LEFT")}</svg>`;
    await sharp(photoPath)
      .composite([{ input: tint, raw: { width: pw, height: ph, channels: 4 } }, { input: Buffer.from(svg) }])
      .jpeg({ quality: 85 })
      .toFile(join(out, `overlay-${s.action}.jpg`));
  }
}

console.log("\nstored measurements:");
for (const m of capture.measurements) console.log(`  ${m.concern}/${m.metric}/${m.side}/${m.region} = ${m.value}`);
console.log(`\nwrote ${out}`);
await db.$disconnect();
