import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalHash, canonicalJson, decryptBytes, encryptBytes, parseKey } from "@/lib/crypto";

const key = parseKey(randomBytes(32).toString("base64"));

describe("photo encryption", () => {
  it("round-trips bytes", () => {
    const photo = randomBytes(5000);
    const blob = encryptBytes(key, photo, "cap_1");
    expect(Buffer.from(blob.ciphertext).equals(photo)).toBe(false);
    expect(decryptBytes(key, blob, "cap_1").equals(photo)).toBe(true);
  });

  it("refuses a ciphertext moved to another capture row", () => {
    const blob = encryptBytes(key, randomBytes(100), "cap_1");
    expect(() => decryptBytes(key, blob, "cap_2")).toThrow();
  });

  it("refuses tampered ciphertext", () => {
    const blob = encryptBytes(key, randomBytes(100), "cap_1");
    blob.ciphertext[0] ^= 1;
    expect(() => decryptBytes(key, blob, "cap_1")).toThrow();
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => parseKey(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});

describe("canonical protocol hash", () => {
  it("ignores key order", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(canonicalHash({ x: 1, y: 2 })).toBe(canonicalHash({ y: 2, x: 1 }));
    expect(canonicalHash({ x: 1 })).not.toBe(canonicalHash({ x: 2 }));
  });
});
