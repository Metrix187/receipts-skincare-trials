import { connection } from "next/server";
import { db } from "@/lib/db";

/** /demo -> the seeded 21-day demo trial (run `npm run seed:demo` first). */
export async function GET(req: Request) {
  await connection();
  const demo =
    (await db.trial.findFirst({ where: { isDemo: true, shareSlug: "demo-azelaic" }, select: { id: true } })) ??
    (await db.trial.findFirst({ where: { isDemo: true }, orderBy: { createdAt: "desc" }, select: { id: true } }));
  const to = demo ? `/trials/${demo.id}` : "/?demo=missing";
  return Response.redirect(new URL(to, req.url), 307);
}
