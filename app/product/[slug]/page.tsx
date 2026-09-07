import type { Metadata } from "next";
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Search,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmailSignup } from "../../../components/email-signup";
import { ProductViewTracker } from "../../../components/product-view-tracker";
import {
  getProductBySlug,
  productSearchText,
  searchSeedCatalog,
} from "../../../lib/catalog";
import { getRuntimeEnv, getSiteUrl } from "../../../lib/runtime";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string }>;
};

function cleanItems(values: string[], limit: number) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  ).slice(0, limit);
}

function cleanSentence(value: string) {
  const clean = value.trim();
  if (!clean) return "";
  return /[.!?]$/.test(clean) ? clean : clean + ".";
}

function descriptionFor(
  product: NonNullable<Awaited<ReturnType<typeof getProductBySlug>>>,
) {
  return (
    product.name +
    " is a " +
    product.category +
    " product for " +
    product.audience +
    ". " +
    product.promise
  )
    .replace(/\s+/g, " ")
    .slice(0, 158);
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const product = await getProductBySlug((await params).slug);
  if (!product) return { title: "Product not found" };
  const canonical = "/product/" + product.slug;
  return {
    title: product.name + " | " + product.category,
    description: descriptionFor(product),
    keywords: product.keywords,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      url: canonical,
      title: product.name + " | " + product.category,
      description: descriptionFor(product),
    },
  };
}

export default async function ProductPage({
  params,
  searchParams,
}: PageProps) {
  const product = await getProductBySlug((await params).slug);
  if (!product) notFound();

  const sourceQuery = ((await searchParams).from || "").trim().slice(0, 320);
  const useCases = cleanItems(product.workflow, 6);
  const outcomes = cleanItems(product.metrics, 6);
  const relatedSearches = cleanItems(product.keywords, 10);
  const runtime = getRuntimeEnv();
  const productUrl = getSiteUrl() + "/product/" + product.slug;

  // The bundled seed catalog can cheaply calculate related products in memory.
  // Million-product R2/D1 pages intentionally do not fan out across every
  // search shard during render. Large-catalog relationships should be supplied
  // or precomputed during ingestion rather than making each page expensive.
  const related =
    product.source === "seed"
      ? searchSeedCatalog(productSearchText(product), 6)
          .filter((result) => result.slug !== product.slug)
          .slice(0, 3)
      : [];

  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        name: product.name,
        description: descriptionFor(product),
        category: product.category,
        keywords: product.keywords.join(", "),
        audience: {
          "@type": "Audience",
          audienceType: product.audience,
        },
        url: productUrl,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: getSiteUrl() + "/",
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Catalog",
            item: getSiteUrl() + "/catalog",
          },
          {
            "@type": "ListItem",
            position: 3,
            name: product.name,
            item: productUrl,
          },
        ],
      },
    ],
  };

  return (
    <main className="min-h-screen">
      <ProductViewTracker
        slug={product.slug}
        source={product.source}
        category={product.category}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />

      <header className="border-b border-border bg-background/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 md:px-8">
          <Link
            href="/"
            className="font-black tracking-[-0.05em] text-foreground"
          >
            MAGIC/CATALOG
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-primary"
          >
            <Search className="size-4" />
            Search catalog
          </Link>
        </div>
      </header>

      <section className="catalog-grid border-b border-border">
        <div className="mx-auto max-w-7xl px-5 py-12 md:px-8 md:py-20">
          <Link
            href={sourceQuery ? "/search?q=" + encodeURIComponent(sourceQuery) : "/"}
            className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="size-4" />
            {sourceQuery ? "Back to results" : "Back to search"}
          </Link>

          <div className="mt-10 grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div>
              <span className="inline-flex rounded-full border border-primary/20 bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-primary">
                {product.category}
              </span>
              <h1 className="mt-7 max-w-4xl text-5xl font-black leading-[0.98] tracking-[-0.055em] text-foreground md:text-7xl">
                {product.name}
              </h1>
              <p className="mt-7 max-w-3xl text-xl font-medium leading-8 text-foreground/80 md:text-2xl md:leading-9">
                {product.promise}
              </p>

              <div className="mt-8 max-w-3xl rounded-2xl border border-border bg-white/85 p-6 md:p-7">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">
                  What is {product.name}?
                </p>
                <p className="mt-4 text-base leading-7 text-foreground/80 md:text-lg md:leading-8">
                  <strong className="font-bold text-foreground">{product.name}</strong>{" "}
                  is a {product.category} product built for {product.audience}. Its
                  core purpose is straightforward: {cleanSentence(product.promise)}
                </p>
                <p className="mt-4 text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
                  The need behind it is specific: {cleanSentence(product.problem)}{" "}
                  {cleanSentence(product.differentiator)}
                </p>
              </div>
            </div>

            <aside className="rounded-2xl border border-border bg-white p-6 shadow-xl shadow-primary/5 md:p-7">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">
                Product updates
              </p>
              <h2 className="mt-3 text-2xl font-black tracking-[-0.035em]">
                Follow {product.name}
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Get product news and updates by email.
              </p>
              <div className="mt-6">
                <EmailSignup
                  productSlug={product.slug}
                  productName={product.name}
                  sourceQuery={sourceQuery || undefined}
                  turnstileSiteKey={runtime.TURNSTILE_SITE_KEY}
                />
              </div>
            </aside>
          </div>
        </div>
      </section>

      <article className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-24">
        <div className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="max-w-3xl">
            <section>
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">
                The need
              </p>
              <h2 className="mt-4 text-3xl font-black tracking-[-0.04em] md:text-4xl">
                What problem does {product.name} solve?
              </h2>
              <p className="mt-6 text-lg leading-8 text-foreground/75">
                {product.problem}
              </p>
            </section>

            <section className="mt-16">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">
                Fit
              </p>
              <h2 className="mt-4 text-3xl font-black tracking-[-0.04em] md:text-4xl">
                Who is {product.name} for?
              </h2>
              <p className="mt-6 text-lg leading-8 text-foreground/75">
                {product.name} is designed for {product.audience}. The strongest
                fit is someone facing the problem above and looking for this
                outcome: {cleanSentence(product.promise)}
              </p>
            </section>

            {useCases.length ? (
              <section className="mt-16">
                <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">
                  Use cases
                </p>
                <h2 className="mt-4 text-3xl font-black tracking-[-0.04em] md:text-4xl">
                  What can you do with {product.name}?
                </h2>
                <div className="mt-8 grid gap-5 md:grid-cols-2">
                  {useCases.map((useCase) => (
                    <div
                      key={useCase}
                      className="rounded-2xl border border-border bg-white p-5 md:p-6"
                    >
                      <p className="text-base font-medium leading-7 text-foreground/80">
                        {useCase}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="mt-16 rounded-3xl bg-foreground p-7 text-background md:p-10">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-accent">
                Approach
              </p>
              <h2 className="mt-4 text-3xl font-black tracking-[-0.04em]">
                How does {product.name} approach the problem?
              </h2>
              <p className="mt-6 text-lg leading-8 text-background/70">
                {product.differentiator}
              </p>
            </section>

            {outcomes.length ? (
              <section className="mt-16">
                <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">
                  Outcomes
                </p>
                <h2 className="mt-4 text-3xl font-black tracking-[-0.04em] md:text-4xl">
                  What should you pay attention to when using {product.name}?
                </h2>
                <ul className="mt-8 grid gap-4 md:grid-cols-2">
                  {outcomes.map((outcome) => (
                    <li
                      key={outcome}
                      className="flex items-start gap-3 rounded-2xl border border-border bg-white p-5 text-base leading-7"
                    >
                      <CheckCircle2 className="mt-1 size-5 shrink-0 text-primary" />
                      <span>{outcome}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          <aside className="space-y-8 lg:sticky lg:top-8 lg:self-start">
            <div className="rounded-2xl border border-border bg-white p-6">
              <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-primary">
                At a glance
              </h2>
              <dl className="mt-5 space-y-5 text-sm leading-6">
                <div>
                  <dt className="font-bold text-foreground">Category</dt>
                  <dd className="mt-1 text-muted-foreground">{product.category}</dd>
                </div>
                <div>
                  <dt className="font-bold text-foreground">Designed for</dt>
                  <dd className="mt-1 text-muted-foreground">{product.audience}</dd>
                </div>
                <div>
                  <dt className="font-bold text-foreground">Core outcome</dt>
                  <dd className="mt-1 text-muted-foreground">{product.promise}</dd>
                </div>
                {useCases[0] ? (
                  <div>
                    <dt className="font-bold text-foreground">Example use</dt>
                    <dd className="mt-1 text-muted-foreground">{useCases[0]}</dd>
                  </div>
                ) : null}
              </dl>
            </div>

            {relatedSearches.length ? (
              <div className="rounded-2xl border border-border bg-muted/50 p-6">
                <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-foreground">
                  Related searches
                </h2>
                <div className="mt-4 flex flex-wrap gap-2">
                  {relatedSearches.map((keyword) => (
                    <Link
                      key={keyword}
                      href={"/search?q=" + encodeURIComponent(keyword)}
                      className="rounded-full border border-border bg-white px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/30 hover:text-primary"
                    >
                      {keyword}
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      </article>

      {related.length ? (
        <section className="border-t border-border bg-white">
          <div className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-20">
            <h2 className="text-3xl font-black tracking-[-0.04em]">
              Related products
            </h2>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {related.map((item) => (
                <Link
                  key={item.slug}
                  href={"/product/" + item.slug}
                  className="group rounded-2xl border border-border bg-background p-6 transition hover:border-primary/35"
                >
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="text-lg font-black tracking-[-0.025em]">
                      {item.name}
                    </h3>
                    <ArrowUpRight className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {item.promise}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <footer className="border-t border-border px-5 py-8 text-center text-xs text-muted-foreground md:px-8">
        Catalog listing date {new Date(product.createdAt).toISOString().slice(0, 10)}.
      </footer>
    </main>
  );
}
