import { connection } from "next/server";
import { db } from "@/lib/db";

/** /demo -> the seeded 21-day demo trial (run `npm run seed:demo` first). */
export async function GET() {
  await connection();
  const demo =
    (await db.trial.findFirst({ where: { isDemo: true, shareSlug: "demo-azelaic" }, select: { id: true } })) ??
    (await db.trial.findFirst({ where: { isDemo: true }, orderBy: { createdAt: "desc" }, select: { id: true } }));
  const to = demo ? `/trials/${demo.id}` : "/?demo=missing";
  // Relative Location: behind a proxy (Render) req.url is the internal 0.0.0.0:10000
  // address, so an absolute URL built from it sends visitors nowhere.
  return new Response(null, { status: 307, headers: { Location: to } });
}
