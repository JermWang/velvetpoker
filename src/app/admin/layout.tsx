import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import { Wordmark } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { AdminNav } from "@/components/admin/admin-nav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/8 bg-charcoal-900/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <Wordmark href="/admin" />
            <Badge tone="velvet">Admin</Badge>
          </div>
          <Link href="/app" className="text-sm text-ash hover:text-ivory">
            Exit to app
          </Link>
        </div>
        <div className="mx-auto max-w-7xl px-6 pb-3">
          <AdminNav />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">
        <p className="sr-only">Signed in as {admin.email}</p>
        {children}
      </main>
    </div>
  );
}
