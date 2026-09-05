import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", String(process.pid) + "-" + Date.now());
  return (await import(workerUrl.href)).default;
}

const workerEnv = {
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
  assert.match(html, /Describe the tool you wish existed/);
  assert.match(html, /Browse all 100 product concepts/);
  assert.match(html, /overdue-invoice-rescue/);
});

test("renders an indexable product concept with signup and FAQ content", async () => {
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
  assert.match(html, /Join the early-access list/);
  assert.match(html, /Questions about/);
  assert.match(html, /application\/ld\+json/);
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
