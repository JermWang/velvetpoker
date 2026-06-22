import { prisma } from "@/lib/db/prisma";

/** Serve a user's profile picture bytes. Public (avatars are shown table-wide). */
export async function GET(
  _req: Request,
  { params }: { params: { userId: string } },
) {
  const avatar = await prisma.avatar.findUnique({
    where: { userId: params.userId },
  });
  if (!avatar) {
    return new Response("Not found", { status: 404 });
  }
  // Bytes come back as a Buffer/Uint8Array from Prisma.
  const body = new Uint8Array(avatar.data);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": avatar.contentType,
      // Defense-in-depth against content sniffing / stored-XSS via a crafted
      // "image": never let the browser reinterpret these bytes as HTML/JS, and
      // sandbox them with a no-execution CSP.
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // URLs are cache-busted with ?v= on change, so cache aggressively.
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
