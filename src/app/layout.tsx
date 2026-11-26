import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getDb } from "@/db/client";
import * as repo from "@/db/repo";
import { colorCss, DEFAULT_COLORS, type StatusColors } from "@/domain/colors";

export const metadata: Metadata = {
  title: "RX Gateway",
  description: "Client readiness record: gates, colors, portfolio and EDI partners.",
};

const NAV = [
  ["/", "Dashboard"],
  ["/portfolio", "Portfolio"],
  ["/partners", "Partner profiles"],
  ["/alerts", "Alerts"],
  ["/audit", "Audit log"],
  ["/settings", "Settings"],
] as const;

// Saved status colors apply on every page, so the layout reads them per request.
export const dynamic = "force-dynamic";

async function savedColors(): Promise<StatusColors> {
  try {
    return await repo.statusColors(await getDb());
  } catch {
    return DEFAULT_COLORS;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style>{colorCss(await savedColors())}</style>
      </head>
      <body className="min-h-screen antialiased">
        <header className="bg-navy text-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="font-serif text-lg font-bold text-white no-underline">RX Gateway</Link>
            <nav className="flex flex-wrap gap-4 text-sm">
              {NAV.map(([href, label]) => (
                <Link key={href} href={href} className="text-white/85 no-underline hover:text-white">{label}</Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-gray-500">
          Colors are computed from the records. A hand change needs a written reason and lapses at the next Monday refresh.
        </footer>
      </body>
    </html>
  );
}
