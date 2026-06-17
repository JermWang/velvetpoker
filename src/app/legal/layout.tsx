import { Wordmark } from "@/components/brand";
import { SiteFooter } from "@/components/marketing/site-footer";

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-white/8">
        <div className="container-page flex h-16 items-center">
          <Wordmark />
        </div>
      </header>
      <main className="flex-1">
        <article className="container-page max-w-3xl py-16">
          <div className="space-y-6 text-sm leading-relaxed text-ash [&_h1]:font-display [&_h1]:text-4xl [&_h1]:text-ivory [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-xl [&_h2]:text-ivory [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_strong]:text-ivory">
            {children}
          </div>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
