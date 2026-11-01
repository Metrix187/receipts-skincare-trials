import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Local setup only: deployed instances must use their hosting provider's secret settings.
export async function POST(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (process.env.NODE_ENV !== "development" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || origin !== url.origin) {
    return Response.json({ error: "Key setup is available only on localhost in development." }, { status: 403 });
  }
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const key = typeof body === "object" && body !== null && "key" in body ? (body as { key: unknown }).key : null;
  if (typeof key !== "string" || !/^sk-ant-[A-Za-z0-9_-]{10,256}$/.test(key)) {
    return Response.json({ error: "Enter an Anthropic API key beginning with sk-ant-." }, { status: 400 });
  }
  const path = join(process.cwd(), ".env.local");
  let contents = "";
  try { contents = await readFile(path, "utf8"); } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return Response.json({ error: "Could not read local settings." }, { status: 500 });
  }
  const line = `ANTHROPIC_API_KEY=${key}`;
  contents = /^\s*ANTHROPIC_API_KEY\s*=.*$/m.test(contents)
    ? contents.replace(/^\s*ANTHROPIC_API_KEY\s*=.*$/m, line)
    : `${contents.replace(/\s*$/, "")}\n${line}\n`;
  try { await writeFile(path, contents, { encoding: "utf8", mode: 0o600 }); }
  catch { return Response.json({ error: "Could not save local settings." }, { status: 500 }); }
  process.env.ANTHROPIC_API_KEY = key;
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
