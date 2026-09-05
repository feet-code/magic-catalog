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

test("ships exactly 100 complete, uniquely addressable seed products", async () => {
  const { seedProducts } = await vite.ssrLoadModule("/lib/seed-products.ts");
  assert.equal(seedProducts.length, 100);
  assert.equal(new Set(seedProducts.map((product) => product.slug)).size, 100);
  for (const product of seedProducts) {
    assert.match(product.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(product.name.length >= 3);
    assert.ok(product.problem.length >= 20);
    assert.ok(product.workflow.length >= 3);
    assert.ok(product.keywords.length >= 4);
  }
});

test("D1 migration contains the query-path indexes and optimization step", async () => {
  const migration = await readFile(
    path.join(root, "drizzle/0000_chilly_pandemic.sql"),
    "utf8",
  );
  assert.match(migration, /idx_product_terms_term_weight/);
  assert.match(migration, /idx_products_slug/);
  assert.match(migration, /idx_signups_product_email/);
  assert.match(migration, /PRAGMA optimize/);
});

test("rejects invalid SITE_URL values without crashing metadata rendering", async () => {
  const { getSiteUrl, setRuntimeEnv } = await vite.ssrLoadModule(
    "/lib/runtime.ts",
  );

  setRuntimeEnv({ SITE_URL: "https://REPLACE_WITH_YOUR_DOMAIN" });
  assert.equal(
    getSiteUrl(),
    "https://magic-catalog.cloudwebsites.workers.dev",
  );

  setRuntimeEnv({ SITE_URL: "https://magic-catalog.cloudwebsites.workers.dev/" });
  assert.equal(
    getSiteUrl(),
    "https://magic-catalog.cloudwebsites.workers.dev",
  );

  setRuntimeEnv({});
});
