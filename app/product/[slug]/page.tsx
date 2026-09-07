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
  return (
    "Explore " +
    product.name +
    ", a product in " +
    product.category +
    " for " +
    product.audience +
    ". " +
    product.promise
  ).slice(0, 158);
}

function cleanSentence(value: string) {
  const clean = value.trim();
  if (!clean) return "";
  return /[.!?]$/.test(clean) ? clean : clean + ".";
}

function naturalList(values: string[]) {
  const clean = values
    .map((value) => value.trim().replace(/[.!?]+$/, ""))
    .filter(Boolean);
  if (!clean.length) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return clean[0] + " and " + clean[1];
  return clean.slice(0, -1).join(", ") + ", and " + clean[clean.length - 1];
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
  const useCases = product.workflow.map((item) => item.trim()).filter(Boolean).slice(0, 6);
  const evaluationSignals = product.metrics
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
  const relatedSearches = product.keywords
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
  const useCaseSummary = naturalList(useCases);
  const signalSummary = naturalList(evaluationSignals);
  const faqs = [
    {
      question: "What is " + product.name + "?",
      answer:
        product.name +
        " is a product in " +
        product.category +
        " designed for " +
        product.audience +
        ". " +
        cleanSentence(product.promise),
    },
    {
      question: "Who is " + product.name + " for?",
      answer:
        product.name +
        " is designed for " +
        product.audience +
        ". It is especially relevant when " +
        product.problem.charAt(0).toLowerCase() +
        product.problem.slice(1),
    },
    {
      question: "What problem does " + product.name + " help solve?",
      answer: cleanSentence(product.problem) + " " + cleanSentence(product.promise),
    },
    {
      question: "What can I use " + product.name + " for?",
      answer: useCaseSummary
        ? "Common ways to use " + product.name + " include " + useCaseSummary + "."
        : cleanSentence(product.promise),
    },
    {
      question:
        "How is " + product.name + " different from other " + product.category + " options?",
      answer: cleanSentence(product.differentiator),
    },
    {
      question: "How do I know if " + product.name + " is a good fit?",
      answer:
        "Start with the problem you need to solve and who will use the product. " +
        "For " +
        product.name +
        ", the intended audience is " +
        product.audience +
        ". Compare that fit with the core promise: " +
        cleanSentence(product.promise),
    },
    {
      question: "What should I compare when choosing " + product.category + " tools?",
      answer:
        "Compare how well each option fits the main use case, how easy it is to adopt, " +
        "the quality of its core experience, compatibility with the tools or devices you already use, " +
        "pricing and limits, support, and any privacy or security requirements that matter to you.",
    },
    {
      question: "What should I check before adopting a product in " + product.category + "?",
      answer:
        "Verify the features you actually need, current pricing and usage limits, supported platforms or integrations, " +
        "data handling, export options, support, and any constraints that could matter at your expected level of use. " +
        "Testing the primary use case end to end is usually more useful than comparing feature counts alone.",
    },
    {
      question: "What results should I track after using " + product.name + "?",
      answer: signalSummary
        ? "Useful signals may include " + signalSummary + ". Choose the measures that best match your actual goal."
        : "Track the outcome that motivated the purchase, along with adoption, time saved, quality, reliability, and user satisfaction where relevant.",
    },
    {
      question: "What are common alternatives to " + product.name + "?",
      answer:
        "Depending on the need, alternatives can include other products in " +
        product.category +
        ", broader general-purpose tools, a manual process, or an internal solution. " +
        "The best comparison is the one that solves the same core problem for the same users.",
    },
    {
      question: "Can products in " + product.category + " replace a manual process?",
      answer:
        "Sometimes, but replacement is not always the right goal. A product can also reduce repetitive work, organize information, " +
        "improve consistency, or handle one part of a process while people keep control of decisions that need judgment.",
    },
    {
      question: "What should I ask during a trial or demo?",
      answer:
        "Ask whether the product handles your most common real-world case, what happens at edge cases or higher usage, " +
        "how data can be imported and exported, which integrations or platforms are supported, what the full cost is, " +
        "and how easy it is for the intended users to get value without extra work.",
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
        keywords: product.keywords.join(", "),
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
                Overview
              </p>
              <h2 className="mt-4 text-3xl font-black tracking-[-0.04em] md:text-4xl">
                What {product.name} is designed to help with
              </h2>
              <div className="mt-6 space-y-5 text-base leading-8 text-foreground/75 md:text-lg">
                <p>{product.problem}</p>
                <p>{product.promise}</p>
                <p>
                  The intended audience is {product.audience}. Whether it is a
                  strong fit depends on the exact use case, constraints, and
                  alternatives you are comparing.
                </p>
              </div>
            </section>

            {useCases.length ? (
              <section className="mt-16">
                <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">
                  Common uses
                </p>
                <h2 className="mt-4 text-3xl font-black tracking-[-0.04em] md:text-4xl">
                  Ways to use {product.name}
                </h2>
                <div className="mt-8 grid gap-5 md:grid-cols-2">
                  {useCases.map((useCase, index) => (
                    <div
                      key={useCase}
                      className="rounded-2xl border border-border bg-white p-5 md:p-6"
                    >
                      <span className="text-xs font-black uppercase tracking-[0.14em] text-primary">
                        Use {index + 1}
                      </span>
                      <p className="mt-3 text-base font-medium leading-7 text-foreground/80">
                        {useCase}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="mt-16 rounded-3xl bg-foreground p-7 text-background md:p-10">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-accent">
                What stands out
              </p>
              <h2 className="mt-4 text-3xl font-black tracking-[-0.04em]">
                How {product.name} is positioned differently
              </h2>
              <p className="mt-6 text-lg leading-8 text-background/70">
                {product.differentiator}
              </p>
            </section>

            <section className="mt-16">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">
                Buying guide
              </p>
              <h2 className="mt-4 text-3xl font-black tracking-[-0.04em] md:text-4xl">
                How to evaluate products in {product.category}
              </h2>
              <div className="mt-7 space-y-6 text-base leading-8 text-foreground/75">
                <div>
                  <h3 className="font-bold text-foreground">Start with the real use case</h3>
                  <p>
                    Define the job you need done, who will use the product, and
                    what a good outcome looks like. A long feature list matters
                    less if the core experience does not match that need.
                  </p>
                </div>
                <div>
                  <h3 className="font-bold text-foreground">Test the important path end to end</h3>
                  <p>
                    Try the most common real-world case instead of only viewing
                    screenshots or feature tables. Check setup effort, everyday
                    usability, edge cases, and how easily you can get your data
                    in and out when those details matter.
                  </p>
                </div>
                <div>
                  <h3 className="font-bold text-foreground">Compare the constraints, not just features</h3>
                  <p>
                    Verify current pricing and limits, supported platforms and
                    integrations, support, privacy or security requirements, and
                    anything else that could become a blocker at your expected
                    level of use.
                  </p>
                </div>
              </div>
            </section>

            <section className="mt-16">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">
                Frequently asked
              </p>
              <h2 className="mt-4 text-3xl font-black tracking-[-0.04em] md:text-4xl">
                Questions about {product.name} and {product.category}
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
                Designed for
              </h2>
              <p className="mt-4 text-sm leading-6 text-foreground/75">
                {product.audience}
              </p>
            </div>

            {evaluationSignals.length ? (
              <div className="rounded-2xl border border-border bg-white p-6">
                <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-primary">
                  Things worth measuring
                </h2>
                <ul className="mt-5 space-y-4">
                  {evaluationSignals.map((signal) => (
                    <li key={signal} className="flex items-start gap-3 text-sm leading-6">
                      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" />
                      <span>{signal}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

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
