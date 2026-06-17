import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { env, isAdminEmail } from "@/lib/env";

/**
 * DEVELOPMENT-ONLY sign-in. Disabled in production and whenever Privy is
 * configured. Creates/loads a user keyed by `dev:<email>` and sets a readable
 * cookie consumed by the dev session fallback and the WS auth query.
 */
export async function POST(req: Request) {
  if (env.isProduction || (env.privyAppId && env.privyAppSecret)) {
    return NextResponse.json({ error: "Dev sign-in disabled" }, { status: 403 });
  }

  const parsed = z
    .object({ email: z.string().email() })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase();

  await prisma.user.upsert({
    where: { privyUserId: `dev:${email}` },
    create: {
      privyUserId: `dev:${email}`,
      email,
      displayName: email.split("@")[0],
      role: isAdminEmail(email) ? "ADMIN" : "USER",
    },
    update: { role: isAdminEmail(email) ? "ADMIN" : undefined },
  });

  cookies().set("velvet_dev_user", email, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  cookies().delete("velvet_dev_user");
  return NextResponse.json({ ok: true });
}
