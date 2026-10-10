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
  const res = await db.photo.deleteMany({ where: { capture: { trialId } } });
  return res.count;
}
