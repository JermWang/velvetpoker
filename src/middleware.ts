import { NextResponse, type NextRequest } from "next/server";

/**
 * Capture a referral code from `?ref=CODE` into a first-party cookie so it
 * survives until the visitor connects a wallet and a User row is created (where
 * require-user attributes it). The first referrer wins — we never overwrite an
 * existing capture.
 */
export function middleware(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get("ref");
  const res = NextResponse.next();

  if (ref && /^[A-Za-z0-9]{3,16}$/.test(ref) && !req.cookies.get("velvet_ref")) {
    res.cookies.set("velvet_ref", ref.toUpperCase(), {
      maxAge: 60 * 60 * 24 * 30, // 30 days
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  }
  return res;
}

export const config = {
  matcher: ["/", "/signin", "/app/:path*"],
};
