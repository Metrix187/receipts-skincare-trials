import "server-only";
import { ZodError } from "zod";
import { CaptureRejected } from "@/lib/analysis/pipeline";
import { HttpError } from "@/lib/owner";

/** Wraps a route handler body: maps known errors to JSON responses. */
export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    const out = await fn();
    return out instanceof Response ? out : Response.json(out ?? { ok: true });
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
    if (err instanceof CaptureRejected) return Response.json({ error: err.message }, { status: 400 });
    if (err instanceof ZodError) {
      return Response.json({ error: err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") }, { status: 400 });
    }
    console.error(err);
    return Response.json({ error: "Something went wrong. Nothing was charged." }, { status: 500 });
  }
}
