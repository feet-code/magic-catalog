import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  server: { middlewareMode: true },
});

after(async () => {
  await vite.close();
});

test("search shard schema uses FTS5 and compact metadata", async () => {
  const sql = await readFile(path.join(root, "db/search-shard.sql"), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS catalog_products/);
  assert.match(sql, /CREATE VIRTUAL TABLE IF NOT EXISTS catalog_products_fts USING fts5/);
  assert.match(sql, /intent_key/);
  assert.match(sql, /storage_key/);
  assert.doesNotMatch(sql, /differentiator|workflow_json|metrics_json/);
});

test("sharding is deterministic and distributes slugs", async () => {
  const { shardIndexForSlug, productBodyKey, scalableFtsQuery } =
    await vite.ssrLoadModule("/lib/scalable-catalog.ts");
  assert.equal(shardIndexForSlug("invoice-followup", 8), shardIndexForSlug("invoice-followup", 8));
  assert.match(productBodyKey("invoice-followup"), /^products\/invoice-followup\.json$/);
  assert.equal(scalableFtsQuery("invoice followups for freelancers"), '"invoice" OR "followup" OR "freelancer"');

  const shards = new Set(
    Array.from({ length: 200 }, (_, index) => shardIndexForSlug(`product-${index}`, 8)),
  );
  assert.equal(shards.size, 8);
});

test("R2 product writes happen before searchable D1 metadata", async () => {
  const { setRuntimeEnv } = await vite.ssrLoadModule("/lib/runtime.ts");
  const { upsertScalableProduct } = await vite.ssrLoadModule("/lib/scalable-catalog.ts");
  const operations = [];
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              operations.push(sql.startsWith("INSERT INTO catalog_products ") ? "metadata" : sql.startsWith("DELETE FROM catalog_products_fts") ? "fts-delete" : "fts-insert");
              return { success: true };
            },
            async first() {
              assert.match(sql, /SELECT id FROM catalog_products/);
              return { id: 41 };
            },
          };
        },
      };
    },
  };
  const bucket = {
    async put(key, value) {
      operations.push("r2");
      assert.equal(key, "products/test-product.json");
      assert.equal(JSON.parse(value).intentKey, "invoice-ops");
    },
  };
  setRuntimeEnv({ SEARCH_DB_0: db, PRODUCT_BODIES: bucket });
  try {
    await upsertScalableProduct(
      {
        id: "p1",
        slug: "test-product",
        name: "Test Product",
        category: "Invoice operations",
        audience: "freelance businesses",
        problem: "Following up on overdue invoices takes repetitive manual work.",
        promise: "Keep invoice follow-up organized.",
        differentiator: "Prioritizes overdue accounts with a focused workflow.",
        workflow: ["Import invoices", "Review priorities", "Send follow-ups"],
        keywords: ["invoice followup", "overdue invoice"],
        metrics: ["overdue invoices"],
        source: "catalog",
        createdAt: "2026-09-06T00:00:00.000Z",
      },
      "invoice-ops",
    );
    assert.deepEqual(operations, ["r2", "metadata", "fts-delete", "fts-insert"]);
  } finally {
    setRuntimeEnv({});
  }
});

test("R2-backed products can be read without the legacy D1 products table", async () => {
  const { setRuntimeEnv } = await vite.ssrLoadModule("/lib/runtime.ts");
  const { getScalableProductBySlug } = await vite.ssrLoadModule("/lib/scalable-catalog.ts");
  const product = {
    id: "p2",
    slug: "r2-product",
    name: "R2 Product",
    category: "Catalog testing",
    audience: "catalog operators",
    problem: "Large catalogs need product bodies outside the search database.",
    promise: "Read full product pages from R2.",
    differentiator: "Keeps the D1 search rows compact.",
    workflow: ["Find metadata", "Read R2", "Render page"],
    keywords: ["r2 catalog"],
    metrics: ["database size"],
    source: "catalog",
    createdAt: "2026-09-06T00:00:00.000Z",
    intentKey: "catalog-storage",
  };
  const db = {
    prepare(sql) {
      assert.match(sql, /FROM catalog_products WHERE slug/);
      return {
        bind(slug) {
          assert.equal(slug, product.slug);
          return {
            async first() {
              return {
                id: 1,
                slug: product.slug,
                name: product.name,
                category: product.category,
                audience: product.audience,
                problem: product.problem,
                promise: product.promise,
                source: product.source,
                storageKey: "products/r2-product.json",
                intentKey: product.intentKey,
                createdAt: product.createdAt,
              };
            },
          };
        },
      };
    },
  };
  const bucket = {
    async get(key) {
      assert.equal(key, "products/r2-product.json");
      return { async text() { return JSON.stringify(product); } };
    },
  };
  setRuntimeEnv({ SEARCH_DB_0: db, PRODUCT_BODIES: bucket });
  try {
    const found = await getScalableProductBySlug(product.slug);
    assert.equal(found?.name, product.name);
    assert.equal(found?.intentKey, product.intentKey);
  } finally {
    setRuntimeEnv({});
  }
});
