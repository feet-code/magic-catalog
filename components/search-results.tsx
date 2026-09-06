"use client";

import {
  ArrowLeft,
  ArrowUpRight,
  Search,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { captureEvent } from "../lib/analytics-client";
import type { ProductSearchResult } from "../lib/product-types";
import { TurnstileWidget } from "./turnstile-widget";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Skeleton } from "./ui/skeleton";

type SearchResponse = {
  mode: "matches" | "generated" | "related";
  generated: boolean;
  generationStatus?: "limited" | "unavailable";
  message?: string;
  debugId?: string;
  results: ProductSearchResult[];
  error?: string;
};

export function SearchResults({
  initialQuery,
  turnstileSiteKey,
}: {
  initialQuery: string;
  turnstileSiteKey?: string;
}) {
  const router = useRouter();
  const hasValidQuery = initialQuery.trim().length >= 4;
  const [input, setInput] = useState(initialQuery);
  const [results, setResults] = useState<ProductSearchResult[]>([]);
  const [loading, setLoading] = useState(hasValidQuery);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string | undefined>(
    hasValidQuery
      ? undefined
      : "Describe a specific problem to search the catalog.",
  );
  const [debugId, setDebugId] = useState<string>();
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const receiveToken = useCallback((token: string) => {
    setTurnstileToken(token);
  }, []);

  useEffect(() => {
    if (!hasValidQuery) return;
    if (turnstileSiteKey && !turnstileToken) return;

    const controller = new AbortController();
    void fetch("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: initialQuery,
        turnstileToken,
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as SearchResponse;
        setDebugId(body.debugId);
        if (!response.ok) throw new Error(body.error || "Search failed.");
        return body;
      })
      .then((body) => {
        setResults(body.results);
        setMessage(body.message);
        captureEvent("search_results_returned", {
          query_length: initialQuery.length,
          result_count: body.results.length,
          result_mode: body.mode,
        });
        if (body.generated && body.results[0]) {
          captureEvent("product_generated", {
            product_slug: body.results[0].slug,
            category: body.results[0].category,
          });
        }
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Search is temporarily unavailable.",
        );
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [hasValidQuery, initialQuery, turnstileSiteKey, turnstileToken]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = input.trim();
    if (value.length < 4) return;
    captureEvent("search_submitted", {
      query_length: value.length,
      search_origin: "results",
    });
    router.push("/search?q=" + encodeURIComponent(value));
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/80 bg-background/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 md:px-8">
          <Link
            href="/"
            className="font-black tracking-[-0.05em] text-foreground"
          >
            MAGIC/CATALOG
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            New search
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-10 md:px-8 md:py-16">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-primary">
          Catalog search
        </p>
        <h1 className="max-w-4xl text-3xl font-black tracking-[-0.04em] text-foreground md:text-5xl">
          Results for “{initialQuery}”
        </h1>

        <form onSubmit={submit} className="mt-8" role="search">
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-white p-2 shadow-sm sm:flex-row">
            <div className="flex min-w-0 flex-1 items-center px-2">
              <Search className="mr-2 size-5 shrink-0 text-muted-foreground" />
              <Input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                minLength={4}
                maxLength={320}
                required
                aria-label="Search for another product"
                className="h-12 border-0 bg-transparent px-1 text-base shadow-none focus-visible:ring-0"
              />
            </div>
            <Button type="submit" className="h-12 rounded-xl px-6 font-semibold">
              Search
            </Button>
          </div>
        </form>

        {turnstileSiteKey ? (
          <div className="mt-4 max-w-sm">
            <TurnstileWidget
              siteKey={turnstileSiteKey}
              onToken={receiveToken}
            />
          </div>
        ) : null}

        <section className="mt-12" aria-live="polite" aria-busy={loading}>
          {loading ? (
            <div className="space-y-4">
              <div className="mb-7 flex items-center gap-3 text-sm font-medium text-muted-foreground">
                <Sparkles className="size-4 text-primary" />
                Searching by meaning across the catalog.
              </div>
              {[0, 1, 2].map((item) => (
                <Skeleton key={item} className="h-48 rounded-2xl" />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
              <p>{error}</p>
              {debugId ? (
                <p className="mt-2 font-mono text-xs">Debug ID: {debugId}</p>
              ) : null}
            </div>
          ) : (
            <>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {results.length} {results.length === 1 ? "result" : "results"}
                </p>
              </div>
              {message ? (
                <div className="mb-6 rounded-xl border border-border bg-muted/60 p-4 text-sm leading-6 text-muted-foreground">
                  <p>{message}</p>
                  {debugId ? (
                    <p className="mt-2 font-mono text-xs">
                      Debug ID: {debugId}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="space-y-4">
                {results.map((result, index) => (
                  <Link
                    href={
                      "/product/" +
                      result.slug +
                      "?from=" +
                      encodeURIComponent(initialQuery)
                    }
                    key={result.slug}
                    className="group block rounded-2xl border border-border bg-white p-6 transition duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lg md:p-8"
                  >
                    <div className="flex items-start justify-between gap-6">
                      <div className="min-w-0">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold uppercase tracking-[0.14em] text-primary">
                            {index === 0 ? "Best match" : result.category}
                          </span>
                        </div>
                        <h2 className="text-2xl font-black tracking-[-0.03em] text-foreground md:text-3xl">
                          {result.name}
                        </h2>
                        <p className="mt-3 text-base leading-7 text-muted-foreground">
                          {result.promise}
                        </p>
                        <p className="mt-4 text-sm leading-6 text-foreground/75">
                          Built for {result.audience}. {result.problem}
                        </p>
                      </div>
                      <ArrowUpRight
                        className="mt-1 size-5 shrink-0 text-muted-foreground transition group-hover:text-primary"
                        aria-hidden="true"
                      />
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
