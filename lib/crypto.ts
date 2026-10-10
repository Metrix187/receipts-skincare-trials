// Photo encryption at rest: AES-256-GCM with a random 96-bit IV per photo.
// The capture id is bound as additional authenticated data, so a ciphertext copied
// onto another row fails to decrypt instead of silently showing the wrong face.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface EncryptedBlob {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
}

export function parseKey(b64: string): Buffer {
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error("PHOTO_ENCRYPTION_KEY must be 32 bytes, base64-encoded (run `npm run setup`).");
  }
  return key;
}

export function encryptBytes(key: Buffer, plaintext: Uint8Array, aad: string): EncryptedBlob {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

export function decryptBytes(key: Buffer, blob: EncryptedBlob, aad: string): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(blob.iv));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(blob.authTag));
  return Buffer.concat([decipher.update(Buffer.from(blob.ciphertext)), decipher.final()]);
}

/** Stable hash of a JSON value (sorted keys) for protocol pre-registration. */
export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}
