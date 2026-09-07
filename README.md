# Magic Catalog

Magic Catalog is a one-domain software catalog designed to grow from a small seed collection to roughly one million dynamically rendered product pages without creating a million-file build.

Visitors describe a problem or desired solution. Search combines semantic routing and lexical retrieval. When there is no strong match, Gemini can still create a tailored product through the existing generation flow.

## Architecture

The application runs as one Cloudflare Worker.

### Existing / small catalog

The original path remains intact for backward compatibility:

- 100 bundled seed products
- D1 for generated products, signups, rate limits, and legacy lexical terms
- Workers AI embeddings
- the existing `PRODUCT_INDEX` Vectorize index for the small legacy catalog

### Million-product catalog

Large imported catalogs use a separate storage and retrieval path:

- **R2 (`PRODUCT_BODIES`)** stores the full JSON body for every imported product.
- **8 D1 search shards (`SEARCH_DB_0` through `SEARCH_DB_7`)** store compact metadata plus an FTS5 index.
- Products are assigned to shards with a deterministic FNV-1a hash of the slug.
- **Vectorize (`INTENT_INDEX`)** stores semantic intent clusters, not one vector per product.
- A query is embedded once, Vectorize returns the closest intent clusters, and D1 FTS5 ranks products inside those clusters.
- If the intent-filtered lookup finds nothing, search automatically retries FTS without the cluster filter.
- `/product/<slug>` reads the full product body from R2 while preserving the existing public URL format.
- Sitemap routes combine legacy D1 products and all scalable search shards.

At 384 dimensions, 10,000 intent vectors use 3.84 million stored dimensions. This is the reason the scalable architecture does not create one Vectorize vector per product.

## Initial setup

Requirements: Node.js 22.13 or newer.

```bash
npm ci
```

Create `.dev.vars` from `.dev.vars.example`, then set the required secrets used by your existing deployment:

```text
GEMINI_API_KEY=...
RATE_LIMIT_SALT=...
ADMIN_REINDEX_TOKEN=...
```

For local development:

```bash
npm run db:migrate:local
npm run dev
```

The local Vinext configuration includes an R2 binding for `PRODUCT_BODIES`. The eight production search shards are provisioned by the scale setup command below.

## Deploy the existing catalog

The current primary D1 database is already configured in `wrangler.jsonc`.

```bash
npm run deploy
```

`npm run deploy` builds the app, applies pending primary D1 migrations, deploys the Worker, and keeps the existing PostHog / Google Search Console automation.

## One-time million-product setup

Before bulk-loading the large catalog, authenticate with Cloudflare if necessary:

```bash
npm run login:cloudflare
```

Then run:

```bash
npm run scale:setup
```

That command is restart-safe and does the infrastructure work for you:

1. creates or reuses the `magic-catalog-product-bodies` R2 bucket;
2. creates or reuses eight D1 databases named `magic-catalog-search-0` through `magic-catalog-search-7`;
3. creates or reuses the 384-dimensional `magic-catalog-intents` Vectorize index;
4. writes the real resource IDs/bindings into `wrangler.jsonc`;
5. applies `db/search-shard.sql` to every search shard.

After it succeeds, deploy the updated bindings and primary migration:

```bash
npm run deploy
```

You do not need to manually copy D1 IDs or create the FTS tables.

## Bulk ingest API

The scalable catalog exposes an authenticated internal endpoint:

```text
POST /api/admin/catalog/ingest
Authorization: Bearer <ADMIN_REINDEX_TOKEN>
Content-Type: application/json
```

Each request accepts up to 7 products and up to 7 intent definitions, leaving headroom under Workers Free per-request query/subrequest limits. The Product Hunt scraper can call this endpoint directly after it has normalized/rebranded a product.

Example payload shape:

```json
{
  "intents": [
    {
      "key": "invoice-operations",
      "label": "Invoice operations",
      "searchText": "invoice follow-up accounts receivable overdue payments freelancer billing"
    }
  ],
  "products": [
    {
      "slug": "invoice-followup-assistant",
      "name": "Invoice Followup Assistant",
      "category": "Accounts receivable",
      "audience": "small businesses and freelancers",
      "problem": "Teams lose time repeatedly checking and following up on overdue invoices.",
      "promise": "Keep overdue invoice follow-up organized in one workflow.",
      "differentiator": "Prioritizes the next account to review and preserves follow-up context.",
      "workflow": ["Import open invoices", "Review prioritized accounts", "Track follow-ups"],
      "keywords": ["invoice followup", "accounts receivable", "overdue invoice"],
      "metrics": ["overdue invoices", "follow-up time"],
      "intentKey": "invoice-operations"
    }
  ]
}
```

Writes are retry-safe: R2 is written first, D1 metadata is upserted, and the FTS row is refreshed. A partially failed request can be sent again.

## Search flow

Large-catalog retrieval is:

```text
query
  -> Workers AI 384d embedding
  -> INTENT_INDEX (closest intent clusters)
  -> FTS5 query across SEARCH_DB_0..7, filtered by those intents
  -> merge/rank top products
  -> unfiltered FTS fallback on a cluster miss
  -> legacy semantic + lexical results are merged in
```

If the scale resources are not configured yet, the scalable path simply returns no results and the original catalog continues to work.

## Product pages and SEO

Product pages remain dynamic:

```text
/product/<slug>
```

The scalable page lookup reads `products/<slug>.json` from R2. No static million-page build is required.

The sitemap index uses 44,900 dynamic product URLs per shard so it remains under search-engine sitemap URL limits. It includes both the original D1-generated products and the R2-backed scalable catalog.

Search result pages remain no-index; product pages remain canonical and indexable.

## Semantic intent maintenance

Intent definitions are persisted in the primary D1 `intent_clusters` table. The ingest endpoint tries to index supplied intents immediately.

If Vectorize was temporarily unavailable, repair/rebuild it with:

```bash
npm run vector:reindex
```

That command still rebuilds the small legacy product index and now also reindexes all stored intent clusters into `INTENT_INDEX`.

## Free-tier operating constraints

This architecture is designed around the Cloudflare Free allowances rather than pretending one million individual vectors fit for free.

Important practical constraints:

- 384-dimensional vectors should be reserved for intent clusters. Around 10,000 clusters consume about 3.84 million stored dimensions.
- Free D1 databases have a 500 MB per-database ceiling, so large search data is split across eight shards.
- Keep the primary D1 small; full imported product bodies belong in R2, not the primary database.
- Cloudflare Free currently allows 100,000 D1 rows written per day. A product creates/updates compact metadata and FTS data; indexes and FTS internals also contribute writes. Do not try to load all one million products in a single day while staying free.
- Budget bulk ingestion using measured D1 `meta.rows_written`, including index and FTS maintenance. There is no fixed safe products/day conversion. The two scrapers share a conservative local write budget and leave headroom for normal activity.
- R2 storage must also remain under its free storage allowance. Keep product JSON compact and do not store scraped images or large duplicated documents in each object.
- Worker request and D1 read quotas still matter once traffic/crawling becomes large. At that point paying a small amount is preferable to degrading search quality solely to preserve a $0 bill.

The Product Hunt scraper should therefore be restart-safe and rate-limited on both the source-scraping side and Magic Catalog ingest side.

## Monitoring and diagnostics

Useful commands:

```bash
npm run typecheck
npm test
npm run diagnose
npm run logs
```

Production generation/search events are logged with request IDs. Existing PostHog and Google Search Console integration stays unchanged.

The repository also includes GitHub Actions CI that runs:

```text
npm ci
npm run typecheck
npm test
```

on the main branch, automation branches, and pull requests.

## Google Search Console

The deployment script reuses the same Google service-account setup as `seo-test`.

Typical local `.env` values:

```text
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_WORKERS_SUBDOMAIN=...
POSTHOG_PROJECT_ID=...
POSTHOG_PROJECT_API_KEY=...
POSTHOG_INGEST_HOST=https://us.i.posthog.com
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
GOOGLE_SEARCH_CONSOLE_OWNER_EMAIL=you@example.com
```

`npm run deploy` installs the public Google verification token, verifies/adds the URL-prefix property, and submits `sitemap.xml` when Google credentials are configured.

## Main files

- `app/api/search/route.ts` — combined scalable + legacy search flow
- `app/api/admin/catalog/ingest/route.ts` — authenticated bulk ingest endpoint
- `app/product/[slug]/page.tsx` — dynamic SEO product page renderer
- `lib/scalable-catalog.ts` — R2 storage, deterministic sharding, FTS retrieval, intent registry
- `lib/intent-search.ts` — semantic intent Vectorize routing
- `lib/catalog-sitemap.ts` — combined legacy/scalable sitemap pagination
- `db/search-shard.sql` — compact D1 + FTS5 search-shard schema
- `scripts/setup-scale.mjs` — one-command R2/D1/Vectorize provisioning
- `drizzle/0001_million_catalog.sql` — primary D1 intent-cluster registry
- `wrangler.jsonc` — Worker bindings; scale setup adds the generated resource IDs

## Safeguards

- Search pages are no-index to avoid crawl traps.
- Existing generated-product rate limits remain in place.
- Signup rate limiting and optional Turnstile remain in place.
- Bulk catalog ingest is protected by `ADMIN_REINDEX_TOKEN`.
- R2 product JSON is not publicly exposed as a bucket; the Worker reads it through a binding.
- Scale-resource failures fall back to the existing catalog rather than taking down search.

## Measured ingestion for batched scrapers

Deploy this version before using the updated Acquire and Product Hunt publishers. Authenticated `GET /api/admin/catalog/ingest` returns `{ "usageReportingVersion": 1, "maxProducts": 7 }` without database writes. It returns 503 if scalable bindings are missing.

Successful POST responses include `usage.rowsWritten`, summing D1-reported write counts for intent registration, metadata upserts, FTS deletion and FTS insertion. This includes the index work reported by D1. Error responses report successfully observed partial write counts; unavailable measurements are null, never an invented zero. The clients retain conservative reservations after failed requests.

The two Python scrapers separately support scraping, adaptive 25–100 item Gemini requests, and publishing. They negotiate the smaller server import cap automatically and share a local ledger for Gemini cooldowns and D1 write budgets. They require `ADMIN_REINDEX_TOKEN`; do not configure these clients for the legacy `/api/admin/import-products` path.
