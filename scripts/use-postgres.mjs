#!/usr/bin/env node
// Swap the Prisma datasource from SQLite to Postgres (Neon).
//
//   node scripts/use-postgres.mjs             -> writes prisma/schema.postgres.prisma
//   node scripts/use-postgres.mjs --in-place  -> rewrites prisma/schema.prisma
//                                               (default on Vercel, whose build dir is throwaway)
//
// Neon's Vercel integration provides DATABASE_URL (pooled) and DATABASE_URL_UNPOOLED
// (direct, used by `prisma db push`).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "prisma/schema.prisma");
const inPlace = process.argv.includes("--in-place") || !!process.env.VERCEL;
const dst = inPlace ? src : resolve(root, "prisma/schema.postgres.prisma");

const schema = readFileSync(src, "utf8");
if (schema.includes('provider = "postgresql"')) {
  console.log("[use-postgres] schema already targets postgresql");
  process.exit(0);
}
const out = schema.replace(
  /datasource db \{[^}]*\}/,
  `datasource db {\n  provider  = "postgresql"\n  url       = env("DATABASE_URL")\n  directUrl = env("DATABASE_URL_UNPOOLED")\n}`,
);
writeFileSync(dst, out);
console.log(`[use-postgres] wrote ${dst}`);
