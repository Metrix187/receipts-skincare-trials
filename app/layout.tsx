import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ModeBadges } from "@/components/ModeBadges";
import "./globals.css";

// next/font self-hosts these at build time: no font requests leave our origin.
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Receipts", template: "%s · Receipts" },
  description: "Is your skincare actually working? Honest n=1 trials with YouCam AI Skin Analysis.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0d" },
  ],
};

// Applies a saved theme before first paint (no flash). Storage may be unavailable.
const themeInit = `try{var t=localStorage.getItem("rcpt-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-dvh antialiased">
        <header className="sticky top-0 z-20 border-b border-line bg-plane/85 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg bg-btn text-btn-ink text-sm">R</span>
              Receipts
            </Link>
            <ModeBadges />
            <nav className="ml-auto flex items-center gap-1 text-sm text-ink-2">
              <Link href="/settings" className="rounded-md px-2 py-1 hover:bg-surface-2">Settings</Link>
              <Link href="/privacy" className="hidden rounded-md px-2 py-1 hover:bg-surface-2 sm:inline-block">Privacy</Link>
              <ThemeToggle />
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">{children}</main>
      </body>
    </html>
  );
}
