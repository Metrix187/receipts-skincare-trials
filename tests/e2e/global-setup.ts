import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

// Playwright loads this file as CommonJS, so __dirname is available.
const here = __dirname;

/** A synthetic "selfie" fixture (evenly lit, skin-toned). The e2e DB is reset by the webServer command. */
export default async function globalSetup() {

  // 1200x1500 portrait. With NEXT_PUBLIC_FACE_DETECTOR=mock the "face" is the
  // centered box; this image passes the lighting/evenness/resolution checks.
  const W = 1200;
  const H = 1500;
  const px = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const grain = ((x * 7 + y * 13) % 11) - 5; // fine texture so focus isn't flat
      px[i] = 200 + grain;
      px[i + 1] = 160 + grain;
      px[i + 2] = 140 + grain;
    }
  }
  const dir = resolve(here, "fixtures");
  mkdirSync(dir, { recursive: true });
  await sharp(px, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 90 }).toFile(resolve(dir, "selfie.jpg"));
}
