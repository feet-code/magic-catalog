import type { Metadata } from "next";
import { SearchResults } from "../../components/search-results";
import { getRuntimeEnv } from "../../lib/runtime";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Search",
  description: "Search Magic Catalog by problem, workflow, or desired outcome.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/search" },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const query = ((await searchParams).q || "").trim().slice(0, 320);
  return (
    <SearchResults
      key={query}
      initialQuery={query}
      turnstileSiteKey={getRuntimeEnv().TURNSTILE_SITE_KEY}
    />
  );
}
