import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { decryptBytes, encryptBytes, parseKey } from "@/lib/crypto";

function key() {
  return parseKey(env().PHOTO_ENCRYPTION_KEY);
}

export async function storePhoto(captureId: string, bytes: Uint8Array, meta: { mime: string; width: number; height: number }) {
  const blob = encryptBytes(key(), bytes, captureId);
  await db.photo.create({
    data: {
      captureId,
      mime: meta.mime,
      width: meta.width,
      height: meta.height,
      ciphertext: Buffer.from(blob.ciphertext),
      iv: Buffer.from(blob.iv),
      authTag: Buffer.from(blob.authTag),
    },
  });
}

export async function readPhoto(captureId: string) {
  const p = await db.photo.findUnique({ where: { captureId } });
  if (!p) return null;
  return { mime: p.mime, bytes: decryptBytes(key(), p, captureId) };
}

/** One-click wipe: deletes every stored selfie for a trial. Scores are kept. */
export async function deleteTrialPhotos(trialId: string) {
  return db.$transaction(async (tx) => {
    const captures = await tx.capture.findMany({ where: { trialId }, select: { id: true, youcamResult: true } });
    for (const capture of captures) {
      const result = capture.youcamResult as { scores?: Array<Record<string, unknown>>; [key: string]: unknown } | null;
      if (!result || !Array.isArray(result.scores)) continue;
      // Signed mask URLs can reveal derived images. Forget them with the photos;
      // numerical measurements and the verdict remain available.
      const scores = result.scores.map((score) => ({ ...score, maskUrls: [] }));
      await tx.capture.update({ where: { id: capture.id }, data: { youcamResult: { ...result, scores } as object } });
    }
    const res = await tx.photo.deleteMany({ where: { capture: { trialId } } });
    return res.count;
  });
}
