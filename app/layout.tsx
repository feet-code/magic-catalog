import type { Metadata } from "next";
import { PageViewTracker } from "../components/page-view-tracker";
import { getRuntimeEnv, getSiteUrl } from "../lib/runtime";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const runtime = getRuntimeEnv();
  return {
    metadataBase: new URL(getSiteUrl()),
    title: {
      default: "Magic Catalog — Describe it. Find it. Create it.",
      template: "%s | Magic Catalog",
    },
    description:
      "Search focused software product concepts by the problem you need solved. If there is no close match, Magic Catalog can create a new concept.",
    verification: runtime.GSC_VERIFICATION_TOKEN
      ? { google: runtime.GSC_VERIFICATION_TOKEN }
      : undefined,
    alternates: { canonical: "/" },
    robots: { index: true, follow: true },
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
  };
}

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#5b3df5",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <PageViewTracker />
        {children}
      </body>
    </html>
  );
}
