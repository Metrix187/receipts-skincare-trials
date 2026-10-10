import { NextResponse, type NextRequest } from "next/server";
import { OWNER_COOKIE } from "@/lib/owner-cookie";

// Gives each browser an anonymous owner id so trials stay private to the device
// that created them, with no accounts. The id is forwarded on the same request so the
// first page render already sees it.
export function proxy(request: NextRequest) {
  if (request.cookies.get(OWNER_COOKIE)) return NextResponse.next();
  const id = crypto.randomUUID();
  request.cookies.set(OWNER_COOKIE, id);
  const res = NextResponse.next({ request: { headers: request.headers } });
  res.cookies.set({
    name: OWNER_COOKIE,
    value: id,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

export const config = {
  matcher: ["/((?!_next/|mediapipe/|favicon.ico).*)"],
};
