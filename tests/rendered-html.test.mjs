import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", String(process.pid) + "-" + Date.now());
  return (await import(workerUrl.href)).default;
}

const workerEnv = {
  SITE_URL: "https://REPLACE_WITH_YOUR_DOMAIN",
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};
const context = {
  waitUntil() {},
  passThroughOnException() {},
};

test("renders the search-first catalog homepage", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    workerEnv,
    context,
  );
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(html, /Describe what you need\. Find the right product/);
  assert.match(html, /Browse all 100 products/);
  assert.doesNotMatch(html, /transparent product concept|deserves to be built/i);
  assert.match(html, /overdue-invoice-rescue/);
});

test("renders an indexable, domain-neutral product page with expanded FAQ content", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/product/overdue-invoice-rescue", {
      headers: { accept: "text/html" },
    }),
    workerEnv,
    context,
  );
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Invoice Rescue/);
  assert.match(html, /Get product updates/);
  assert.match(html, /Questions about/);
  assert.match(html, /How to evaluate products in/);
  assert.match(html, /What should I ask during a trial or demo/);
  assert.match(html, /What are common alternatives to/);
  assert.match(html, /application\/ld\+json/);
  assert.doesNotMatch(
    html,
    /transparent concept|not a launched service|created from a catalog search|initial concept/i,
  );
  assert.doesNotMatch(
    html,
    /the operational gap|why the current workflow breaks|practical rollout|how to introduce a better workflow/i,
  );
});

test("publishes robots and the sitemap index", async () => {
  const worker = await loadWorker();
  const robots = await worker.fetch(
    new Request("http://localhost/robots.txt"),
    workerEnv,
    context,
  );
  const sitemap = await worker.fetch(
    new Request("http://localhost/sitemap.xml"),
    workerEnv,
    context,
  );
  assert.match(await robots.text(), /Sitemap: .*\/sitemap\.xml/);
  assert.match(await sitemap.text(), /<sitemapindex/);
});

test("keeps search available when the D1 rate-limit table is missing", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/search", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: "organize unusual jellyfish tank maintenance reminders",
      }),
    }),
    {
      ...workerEnv,
      DB: {
        prepare() {
          throw new Error("no such table: rate_limits");
        },
      },
    },
    context,
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.mode, "related");
  assert.equal(body.generationStatus, "unavailable");
  assert.ok(body.debugId);
  assert.ok(Array.isArray(body.results));
});

test("reindex reports an uninitialized D1 schema instead of false success", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/admin/reindex", {
      method: "POST",
      headers: { authorization: "Bearer test-admin-token" },
    }),
    {
      ...workerEnv,
      ADMIN_REINDEX_TOKEN: "test-admin-token",
      AI: {},
      PRODUCT_INDEX: {},
      DB: {
        prepare() {
          throw new Error("no such table: rate_limits");
        },
      },
    },
    context,
  );
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.match(body.error, /D1 schema is not initialized/);
});

test("admin diagnostics identifies missing production bindings", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/admin/diagnostics", {
      method: "POST",
      headers: { authorization: "Bearer test-admin-token" },
    }),
    {
      ...workerEnv,
      ADMIN_REINDEX_TOKEN: "test-admin-token",
    },
    context,
  );
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.ok, false);
  assert.ok(body.requestId);
  assert.equal(body.checks.d1.failure.code, "D1_BINDING_MISSING");
  assert.equal(
    body.checks.geminiConfiguration.failure.code,
    "GEMINI_API_KEY_MISSING",
  );
  assert.equal(
    body.checks.productGeneration.failure.code,
    "PRODUCT_GENERATION_NOT_CONFIGURED",
  );
});
