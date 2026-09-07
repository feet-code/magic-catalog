import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react";
import { catalogDirectoryCount, catalogDirectoryRows } from "../../lib/catalog-directory";
import { getSiteUrl } from "../../lib/runtime";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 250;

export const metadata: Metadata = {
  title: "Browse the Magic Catalog",
  description: "Browse every product concept and product page in Magic Catalog.",
  alternates: { canonical: getSiteUrl() + "/catalog" },
  robots: { index: true, follow: true },
};

export default async function CatalogPage() {
  return <CatalogDirectory page={0} />;
}

export async function CatalogDirectory({ page }: { page: number }) {
  const [rows, total] = await Promise.all([
    catalogDirectoryRows(page, PAGE_SIZE),
    catalogDirectoryCount(),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(0, page), pageCount - 1);
  const hasPrevious = current > 0;
  const hasNext = current + 1 < pageCount;

  return (
    <main className="min-h-screen">
      <header className="border-b border-border bg-background/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-5 py-5 md:px-8">
          <Link href="/" className="font-black tracking-[-0.05em] text-foreground">
            MAGIC/CATALOG
          </Link>
          <Link
            href="/"
            className="text-sm font-semibold text-muted-foreground hover:text-primary"
          >
            Search catalog
          </Link>
        </div>
      </header>

      <section className="border-b border-border">
        <div className="mx-auto max-w-7xl px-5 py-12 md:px-8 md:py-16">
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">
            Catalog directory
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-[-0.045em] md:text-6xl">
            Browse {total.toLocaleString()} products.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
            Every product has a permanent page. This directory provides a
            simple HTML path through the catalog so people and search engines
            can discover products beyond the featured set.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-10 md:px-8 md:py-14">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((product) => (
            <Link
              key={product.slug}
              href={"/product/" + product.slug}
              className="group rounded-2xl border border-border bg-white p-5 transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lg"
            >
              <div className="flex items-start justify-between gap-4">
                <p className="text-xs font-bold uppercase tracking-[0.13em] text-primary">
                  {product.category}
                </p>
                <ArrowUpRight className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
              </div>
              <h2 className="mt-4 text-lg font-black tracking-[-0.025em]">
                {product.name}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {product.promise}
              </p>
            </Link>
          ))}
        </div>

        {!rows.length ? (
          <p className="rounded-2xl border border-border bg-muted/30 p-6 text-sm text-muted-foreground">
            No products are available on this page yet.
          </p>
        ) : null}

        <nav
          className="mt-12 flex items-center justify-between gap-4 border-t border-border pt-6"
          aria-label="Catalog pagination"
        >
          {hasPrevious ? (
            <Link
              href={current === 1 ? "/catalog" : "/catalog/" + (current - 1)}
              className="inline-flex items-center gap-2 text-sm font-bold hover:text-primary"
            >
              <ArrowLeft className="size-4" />
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted-foreground">
            Page {current + 1} of {pageCount}
          </span>
          {hasNext ? (
            <Link
              href={"/catalog/" + (current + 1)}
              className="inline-flex items-center gap-2 text-sm font-bold hover:text-primary"
            >
              Next
              <ArrowRight className="size-4" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </section>
    </main>
  );
}
