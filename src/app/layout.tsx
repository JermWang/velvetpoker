import type { Metadata } from "next";
import { Cormorant_Garamond, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { APP_NAME_FULL } from "@/components/brand";
import { Providers } from "@/components/providers";
import { AmbientBackground } from "@/components/ambient/ambient-background";

// Design system type (from Claude Design): editorial serif display, clean sans
// UI, mono for figures.
const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});
const sans = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME_FULL} — Private real-money poker on Solana`,
    template: `%s · ${APP_NAME_FULL}`,
  },
  description:
    "A private, elegant real-money poker room on Solana. Transparent hands, professional custody, instant crypto settlement.",
  robots: { index: false, follow: false },
  icons: {
    icon: [{ url: "/velvet-poker-chip.png", type: "image/png" }],
    shortcut: "/velvet-poker-chip.png",
    apple: "/velvet-poker-chip.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
    >
      <body className="min-h-screen">
        <AmbientBackground />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
