import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogDirectory } from "../page";
import { catalogDirectoryCount } from "../../../lib/catalog-directory";
import { getSiteUrl } from "../../../lib/runtime";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 250;

type PageProps = {
  params: Promise<{ page: string }>;
};

function parsePage(value: string) {
  if (!/^\d+$/.test(value)) return null;
  return Number(value);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const raw = (await params).page;
  const page = parsePage(raw);
  if (page === null) return { title: "Catalog page not found" };

  const total = await catalogDirectoryCount();
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page < 1 || page >= pageCount) return { title: "Catalog page not found" };

  return {
    title: `Browse Magic Catalog — Page ${page + 1}`,
    description: `Browse products ${page * PAGE_SIZE + 1}–${Math.min(
      total,
      (page + 1) * PAGE_SIZE,
    )} in Magic Catalog.`,
    alternates: { canonical: getSiteUrl() + "/catalog/" + page },
    robots: { index: true, follow: true },
  };
}

export default async function CatalogPage({ params }: PageProps) {
  const page = parsePage((await params).page);
  if (page === null || page < 1) notFound();

  const total = await catalogDirectoryCount();
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page >= pageCount) notFound();

  return <CatalogDirectory page={page} />;
}
