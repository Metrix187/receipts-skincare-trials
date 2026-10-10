#!/usr/bin/env node
// Creates or updates .env from .env.example without ever printing a secret.
//
//   npm run setup                       # uses ../youcamkey.env if it exists
//   npm run setup -- --from path/to/keys.env
//
// Precedence for each variable: existing .env value > --from file > .env.example default.
// PHOTO_ENCRYPTION_KEY is generated once if empty and never overwritten.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const examplePath = resolve(root, ".env.example");
const envPath = resolve(root, ".env");

const fromFlag = process.argv.indexOf("--from");
const fromPath =
  fromFlag > -1 ? resolve(process.argv[fromFlag + 1]) : resolve(root, "..", "youcamkey.env");

function parse(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
}

const example = readFileSync(examplePath, "utf8");
const current = existsSync(envPath) ? parse(readFileSync(envPath, "utf8")) : {};
const imported = existsSync(fromPath) ? parse(readFileSync(fromPath, "utf8")) : {};

const report = [];
const lines = example.split(/\r?\n/).map((line) => {
  const m = line.match(/^(\s*)([A-Z0-9_]+)(\s*=\s*)(.*)$/);
  if (!m) return line;
  const [, indent, key, eq, def] = m;
  let value = current[key];
  let source = "kept";
  if (!value && imported[key]) {
    value = imported[key];
    source = `imported from ${fromPath}`;
  }
  if (!value && key === "PHOTO_ENCRYPTION_KEY") {
    value = randomBytes(32).toString("base64");
    source = "generated";
  }
  if (!value) {
    value = def;
    source = def ? "default" : "EMPTY";
  }
  const secret = /KEY/.test(key);
  report.push(`  ${key.padEnd(26)} ${secret && value ? `<set, ${value.length} chars>` : value || "-"}  (${source})`);
  const needsQuotes = /\s|#/.test(value) && !/^".*"$/.test(value);
  return `${indent}${key}${eq}${needsQuotes ? `"${value}"` : value}`;
});

writeFileSync(envPath, lines.join("\n"));
console.log(`Wrote ${envPath}`);
console.log(report.join("\n"));
if (!current.YOUCAM_API_KEY && !imported.YOUCAM_API_KEY) {
  console.log("\nYOUCAM_API_KEY is empty: the app runs in mock mode until you add it to .env.");
}
