import { ArrowUpRight, Asterisk, Sparkles } from "lucide-react";
import Link from "next/link";
import { HomeSearch } from "../components/home-search";
import { catalogProductCount } from "../lib/catalog-sitemap";
import { seedProducts } from "../lib/seed-products";

const examples = [
  "track construction change orders before billing",
  "find stale SaaS permissions after team changes",
  "compare residential solar proposals",
];

export const dynamic = "force-dynamic";

export default async function Home() {
  const featured = seedProducts.slice(0, 12);
  const productCount = seedProducts.length + (await catalogProductCount());

  return (
    <main className="min-h-screen">
      <section className="catalog-grid border-b border-border">
        <div className="mx-auto flex min-h-[78vh] max-w-7xl flex-col px-5 py-6 md:px-8 md:py-8">
          <header className="flex items-center justify-between">
            <Link
              href="/"
              className="font-black tracking-[-0.05em] text-foreground"
            >
              MAGIC/CATALOG
            </Link>
            <Link
              href="/catalog"
              className="rounded-full border border-border bg-white/80 px-3 py-1.5 text-xs font-semibold text-muted-foreground backdrop-blur hover:text-primary"
            >
              {productCount.toLocaleString()} products
            </Link>
          </header>

          <div className="flex flex-1 items-center py-16 md:py-24">
            <div className="w-full max-w-5xl">
              <div className="mb-7 inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-accent-foreground">
                <Sparkles className="size-3.5" />
                Search beyond the catalog
              </div>
              <h1 className="max-w-5xl text-5xl font-black leading-[0.96] tracking-[-0.06em] text-foreground md:text-7xl lg:text-[5.7rem]">
                Describe what you need. Find the right product.
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-muted-foreground md:text-xl">
                Search focused software by the problem, workflow, or outcome
                you need.
              </p>
              <div className="mt-10 max-w-4xl">
                <HomeSearch />
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground/70">Try:</span>
                  {examples.map((example) => (
                    <Link
                      key={example}
                      href={"/search?q=" + encodeURIComponent(example)}
                      className="underline decoration-border underline-offset-4 hover:text-primary"
                    >
                      {example}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-border/80 py-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <span>One domain</span>
            <span className="hidden sm:inline">Problem-first discovery</span>
            <span>Focused software</span>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20 md:px-8 md:py-28">
        <div className="mb-10 flex items-end justify-between gap-6">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">
              Featured products
            </p>
            <h2 className="mt-3 text-4xl font-black tracking-[-0.045em] md:text-5xl">
              Focused products for expensive problems.
            </h2>
          </div>
          <Asterisk className="hidden size-10 text-accent-foreground md:block" />
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {featured.map((product, index) => (
            <Link
              key={product.slug}
              href={"/product/" + product.slug}
              className="group flex min-h-64 flex-col justify-between rounded-2xl border border-border bg-white p-6 transition duration-200 hover:-translate-y-1 hover:border-primary/35 hover:shadow-lg"
            >
              <div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-bold uppercase tracking-[0.13em] text-primary">
                    {product.category}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="mt-7 text-2xl font-black tracking-[-0.035em]">
                  {product.name}
                </h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {product.promise}
                </p>
              </div>
              <div className="mt-8 flex items-center justify-between text-sm font-semibold">
                <span>Explore product</span>
                <ArrowUpRight className="size-4 transition group-hover:text-primary" />
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-16 rounded-2xl border border-border bg-card px-6 py-6 md:flex md:items-center md:justify-between md:gap-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">
              Full catalog
            </p>
            <p className="mt-2 text-xl font-black tracking-[-0.03em]">
              Browse all {productCount.toLocaleString()} product pages.
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Every product has its own crawlable URL and is linked from the
              paginated catalog directory.
            </p>
          </div>
          <Link
            href="/catalog"
            className="mt-5 inline-flex shrink-0 items-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-bold text-background hover:opacity-90 md:mt-0"
          >
            Browse catalog
            <ArrowUpRight className="size-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-border bg-foreground text-background">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-10 text-sm md:flex-row md:items-center md:justify-between md:px-8">
          <p className="font-black tracking-[-0.04em]">MAGIC/CATALOG</p>
          <p className="max-w-xl leading-6 text-background/60">
            Find focused software by the problem it solves.
          </p>
        </div>
      </footer>
    </main>
  );
}
