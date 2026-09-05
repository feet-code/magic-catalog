# Magic Catalog

Magic Catalog is a one-domain SEO experiment built to support a very large catalog of narrow product concepts.

Visitors describe a problem or desired solution. The site returns the closest products using semantic and lexical retrieval. When no result is close enough, an LLM creates a transparent new product concept, saves it, indexes it, and returns it as the first result. Every product page has useful explanatory content, FAQs, structured data, related internal links, and a product-specific early-access form.

The repository starts with exactly 100 hand-curated niche product pages.

## What is implemented

- Problem-first search homepage and shareable no-index results pages
- 100 server-rendered, indexable product pages
- Cloudflare Workers AI generation with an OpenAI-compatible fallback
- Workers AI embeddings plus Vectorize semantic search
- Indexed lexical fallback for generated products
- D1 persistence for generated products, search terms, email signups, and abuse limits
- Per-browser daily generation and signup limits
- Optional Cloudflare Turnstile verification
- PostHog events for page views, searches, generated products, product views, and email signups
- Google Search Console verification metadata
- Dynamic robots.txt, sitemap index, and 45,000-URL sitemap shards
- Product and FAQ structured data
- A protected endpoint for indexing the initial catalog in Vectorize

Search and product copy stay honest: dynamically created pages are marked as concepts and do not pretend a product has launched.

## Architecture

The application is rendered by one Cloudflare Worker. The initial 100 products are bundled with the Worker, so they load even if D1 is unavailable. New LLM-created products and email signups are stored in D1. Vectorize holds 384-dimensional semantic-search vectors. A compact indexed term table provides a no-AI fallback for generated products.

Product pages are rendered by slug at request time, so adding hundreds of thousands of records does not create a million-file build. The sitemap routes split URLs into crawler-safe batches.

## Run locally

Requirements: Node.js 22.13 or newer.

~~~
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
~~~

The catalog and lexical search work without an AI provider. For local on-demand generation, fill the OpenAI-compatible LLM values in .dev.vars. Cloudflare Workers AI and Vectorize are used after deployment.

Useful checks:

~~~
npm run typecheck
npm run build
~~~

## Deploy to Cloudflare

This setup uses Workers, D1, Workers AI, and Vectorize.

1. Authenticate and create the database.

~~~
npx wrangler login
npx wrangler d1 create magic-catalog
~~~

Copy the returned database ID into wrangler.jsonc in place of REPLACE_WITH_D1_DATABASE_ID.

2. Create the semantic-search index.

~~~
npx wrangler vectorize create magic-catalog-products --dimensions=384 --metric=cosine
~~~

3. `SITE_URL` already points to `https://magic-catalog.cloudwebsites.workers.dev`. Change it only if you attach a custom domain, then apply the schema.

~~~
npm run db:migrate:remote
~~~

The migration is required for generated products, rate limiting, and email signups. Reindexing Vectorize does not create the D1 tables. Future `npm run deploy` commands apply pending migrations automatically before uploading the Worker.

4. Add long random values for the two required operational secrets.

~~~
npx wrangler secret put RATE_LIMIT_SALT
npx wrangler secret put ADMIN_REINDEX_TOKEN
~~~

5. Add analytics and verification values when available.

~~~
npx wrangler secret put POSTHOG_KEY
npx wrangler secret put POSTHOG_HOST
npx wrangler secret put GSC_VERIFICATION_TOKEN
~~~

POSTHOG_HOST normally looks like https://us.i.posthog.com or https://eu.i.posthog.com.

Turnstile is optional. If enabled, both values must be configured:

~~~
npx wrangler secret put TURNSTILE_SITE_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
~~~

6. Deploy.

~~~
npm run deploy
~~~

7. Seed the semantic index after the first deployment. Run this with SITE_URL and ADMIN_REINDEX_TOKEN available in the shell:

~~~
npm run vector:reindex
~~~

The endpoint first verifies that the D1 schema is ready, then indexes the 100 bundled concepts in batches and refreshes up to the 1,000 newest generated concepts. Newly generated concepts index themselves automatically.

## Google Search Console

1. Add the final domain or URL-prefix property in Search Console.
2. Set GSC_VERIFICATION_TOKEN to the token value only, then redeploy.
3. Verify the property.
4. Submit https://YOUR_DOMAIN/sitemap.xml.

The verification token is emitted as the standard google-site-verification meta tag. Search results pages and API routes are excluded from indexing; product pages are canonical and indexable.

## PostHog

Use the same project key as another site if all experiments should appear in one PostHog project. The application forwards a small allowlisted event payload server-side and never includes the signup email in PostHog.

Events:

- page_viewed
- search_submitted
- search_results_returned
- product_generated
- product_viewed
- email_signup

Useful properties include product_slug, category, result_mode, result_count, and product_source.

## Inspect email interest

Email addresses are stored in D1 because they are needed for launch outreach. PostHog receives only an anonymous browser ID.

~~~
npx wrangler d1 execute magic-catalog --remote --command "SELECT product_slug, count(*) AS signups FROM signups GROUP BY product_slug ORDER BY signups DESC"
~~~

Treat the database as personal data: limit access, publish a privacy policy before broad promotion, and delete records when they are no longer needed.

## Free-tier reality

The initial experiment is designed to run inside Cloudflare's free allowances at modest traffic. Current Cloudflare documentation lists 100,000 Worker requests per day, 5 million D1 rows read per day, 100,000 D1 rows written per day, 500 MB per free D1 database, 10,000 free Workers AI neurons per day, and 5 million free stored Vectorize dimensions.

At 384 dimensions, the free Vectorize storage allowance covers roughly 13,000 product vectors, not one million. One million fully generated product records plus their search index will also outgrow a single free D1 database. In other words:

- The 100-page test can run free.
- A low-traffic catalog can grow into the thousands for free.
- A true one-million-page semantic catalog will require paid Vectorize or another retrieval tier and likely D1 sharding or compact object storage.

The URL and rendering design already avoids a million-page static build. The storage and retrieval layer is isolated so it can be sharded without changing public product URLs.

Official limits and pricing:

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/vectorize/platform/pricing/

## Important safeguards

- Search pages are no-index to avoid infinite crawl traps.
- LLM generation is limited to three new concepts per browser identity per UTC day.
- The browser identity is a salted hash; the raw IP is not stored.
- Generated schemas are validated before persistence.
- High-consequence subjects are constrained to administrative support with human decisions.
- The signup form includes a honeypot, deduplication, optional Turnstile, and a daily attempt limit.
- The Vectorize reindex route is hidden behind ADMIN_REINDEX_TOKEN.

## Main files

- app/page.tsx — search-first homepage and catalog index
- app/product/[slug]/page.tsx — SEO product-page renderer
- app/api/search/route.ts — retrieval and generation flow
- app/api/signup/route.ts — email capture
- lib/seed-products.ts — the initial 100 product concepts
- lib/ai.ts — generation, embeddings, and semantic retrieval
- db/schema.ts — D1 schema
- drizzle/ — generated D1 migrations
- wrangler.jsonc — direct Cloudflare deployment configuration
