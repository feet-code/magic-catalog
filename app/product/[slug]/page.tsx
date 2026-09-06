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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../../../components/ui/accordion";
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

function descriptionFor(product: NonNullable<Awaited<ReturnType<typeof getProductBySlug>>>) {
  return (product.promise + " Built for " + product.audience + ".").slice(0, 158);
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const product = await getProductBySlug((await params).slug);
  if (!product) return { title: "Product not found" };
  const canonical = "/product/" + product.slug;
  return {
    title: product.name,
    description: descriptionFor(product),
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      url: canonical,
      title: product.name,
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
  const related = searchSeedCatalog(productSearchText(product), 6)
    .filter((result) => result.slug !== product.slug)
    .slice(0, 3);
  const runtime = getRuntimeEnv();
  const faqs = [
    {
      question: "What is " + product.name + "?",
      answer:
        product.name +
        " is focused software for " +
        product.audience +
        ". " +
        product.promise,
    },
    {
      question: "What problem does it solve?",
      answer: product.problem + " " + product.differentiator,
    },
    {
      question: "How does the workflow work?",
      answer: product.workflow
        .map((step, index) => String(index + 1) + ". " + step)
        .join(" "),
    },
    {
      question: "Who is " + product.name + " for?",
      answer:
        product.name +
        " is designed for " +
        product.audience +
        ". Subscribe for feature updates and related resources.",
    },
    {
      question: "What outcomes can teams track?",
      answer: product.metrics.join(", ") + ".",
    },
  ];
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        name: product.name,
        description: descriptionFor(product),
        category: product.category,
        audience: {
          "@type": "Audience",
          audienceType: product.audience,
        },
        url: getSiteUrl() + "/product/" + product.slug,
      },
      {
        "@type": "FAQPage",
        mainEntity: faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: faq.answer,
          },
        })),
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
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full border border-primary/20 bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-primary">
                  {product.category}
                </span>
              </div>
              <h1 className="mt-7 max-w-4xl text-5xl font-black leading-[0.98] tracking-[-0.055em] text-foreground md:text-7xl">
                {product.name}
              </h1>
              <p className="mt-7 max-w-3xl text-xl font-medium leading-8 text-foreground/80 md:text-2xl md:leading-9">
                {product.promise}
              </p>
              <p className="mt-7 max-w-3xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
                For {product.audience}. {product.problem}
              </p>
            </div>

            <aside className="rounded-2xl border border-border bg-white p-6 shadow-xl shadow-primary/5 md:p-7">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">
                Product updates
              </p>
              <h2 className="mt-3 text-2xl font-black tracking-[-0.035em]">
                Stay informed about {product.name}
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Get feature updates, product news, and related resources by
                email.
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
                The operational gap
              </p>
              <h2 className="mt-4 text-3xl font-black tracking-[-0.04em] md:text-4xl">
                Why the current workflow breaks
              </h2>
              <div className="mt-6 space-y-5 text-base leading-8 text-foreground/75 md:text-lg">
                <p>{product.problem}</p>
                <p>
                  For {product.audience}, the visible task is rarely the whole
                  problem. The real cost comes from missing context, unclear
                  ownership, late exceptions, and decisions that cannot be
                  reconstructed later.
                </p>
                <p>
                  {product.name} reduces that coordination burden by making
                  evidence easier to collect, the next action easier to see,
                  and the final outcome easier to learn from.
                </p>
              </div>
            </section>

            <section className="mt-16">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">
                How it works
              </p>
              <h2 className="mt-4 text-3xl font-black tracking-[-0.04em] md:text-4xl">
                From scattered context to a clear decision
              </h2>
              <ol className="mt-8 space-y-5">
                {product.workflow.map((step, index) => (
                  <li
                    key={step}
                    className="grid grid-cols-[44px_1fr] gap-4 rounded-2xl border border-border bg-white p-5 md:p-6"
                  >
                    <span className="flex size-11 items-center justify-center rounded-full bg-primary font-black text-primary-foreground">
                      {index + 1}
                    </span>
                    <p className="pt-1 text-base font-medium leading-7 text-foreground/80">
                      {step}
                    </p>
                  </li>
                ))}
              </ol>
            </section>

            <section className="mt-16 rounded-3xl bg-foreground p-7 text-background md:p-10">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-accent">
                The sharper angle
              </p>
              <h2 className="mt-4 text-3xl font-black tracking-[-0.04em]">
                What makes it different
              </h2>
              <p className="mt-6 text-lg leading-8 text-background/70">
                {product.differentiator}
              </p>
            </section>

            <section className="mt-16">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">
                Practical rollout
              </p>
              <h2 className="mt-4 text-3xl font-black tracking-[-0.04em] md:text-4xl">
                How to introduce a better workflow
              </h2>
              <div className="mt-7 space-y-6 text-base leading-8 text-foreground/75">
                <div>
                  <h3 className="font-bold text-foreground">Start with one repeatable case</h3>
                  <p>
                    Choose a frequent, bounded version of the problem and agree
                    on what a good outcome looks like. This keeps the first
                    workflow understandable for everyone involved.
                  </p>
                </div>
                <div>
                  <h3 className="font-bold text-foreground">Connect only useful evidence</h3>
                  <p>
                    Use the smallest set of source records needed to make a
                    better next action visible. Preserve provenance, access
                    boundaries, and the original context behind each record.
                  </p>
                </div>
                <div>
                  <h3 className="font-bold text-foreground">Keep the decision boundary explicit</h3>
                  <p>
                    Decide which steps can be automated safely and which require
                    a named human reviewer. A clear boundary is part of the
                    operating process, especially for consequential decisions.
                  </p>
                </div>
              </div>
            </section>

            <section className="mt-16">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">
                Frequently asked
              </p>
              <h2 className="mt-4 text-3xl font-black tracking-[-0.04em] md:text-4xl">
                Questions about {product.name}
              </h2>
              <Accordion type="single" collapsible className="mt-7">
                {faqs.map((faq, index) => (
                  <AccordionItem value={"faq-" + index} key={faq.question}>
                    <AccordionTrigger className="py-5 text-base font-bold hover:no-underline">
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent className="max-w-2xl text-base leading-7 text-muted-foreground">
                      {faq.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>
          </div>

          <aside className="space-y-8 lg:sticky lg:top-8 lg:self-start">
            <div className="rounded-2xl border border-border bg-white p-6">
              <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-primary">
                Success signals
              </h2>
              <ul className="mt-5 space-y-4">
                {product.metrics.map((metric) => (
                  <li key={metric} className="flex items-start gap-3 text-sm leading-6">
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" />
                    <span>{metric}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-border bg-muted/50 p-6">
              <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-foreground">
                Search themes
              </h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {product.keywords.slice(0, 8).map((keyword) => (
                  <span
                    key={keyword}
                    className="rounded-full border border-border bg-white px-3 py-1.5 text-xs text-muted-foreground"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
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
        Last updated {new Date(product.createdAt).toISOString().slice(0, 10)}.
      </footer>
    </main>
  );
}
