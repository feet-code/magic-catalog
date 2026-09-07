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

  const importMigration = await readFile(
    path.join(root, "drizzle/0001_productive_riptide.sql"),
    "utf8",
  );
  assert.match(importMigration, /CREATE TABLE `product_imports`/);
  assert.match(importMigration, /external_id_hash/);
  assert.match(importMigration, /source_name_hash/);
  assert.doesNotMatch(importMigration, /`source_name` text/);
  assert.doesNotMatch(importMigration, /`source_url` text/);
});

test("Product Hunt imports reject source-brand leakage", async () => {
  const { findSourceNameLeaks, productImportBatchSchema } =
    await vite.ssrLoadModule("/lib/import-validation.ts");
  const product = {
    name: "Signal Grove",
    category: "Customer research",
    audience: "product teams organizing customer interview evidence",
    problem:
      "Interview notes become disconnected from decisions, owners, and follow-up work.",
    promise:
      "Turn scattered research evidence into a reviewable decision trail.",
    differentiator:
      "The workflow keeps evidence, ownership, and follow-up decisions in one structured record.",
    workflow: [
      "Import approved research notes and supporting context.",
      "Group recurring evidence around a specific decision.",
      "Assign the follow-up action and preserve its outcome.",
    ],
    keywords: [
      "customer interview repository",
      "research decision log",
      "product evidence workflow",
      "user research follow up",
    ],
    metrics: ["unassigned follow-up actions", "decision evidence coverage"],
  };
  assert.deepEqual(findSourceNameLeaks("Acme Beacon", product), []);
  assert.deepEqual(
    findSourceNameLeaks("Acme Beacon", {
      ...product,
      differentiator: product.differentiator + " Built around Acme evidence.",
    }),
    ["source-token:acme"],
  );

  const parsed = productImportBatchSchema.parse({
    products: [
      {
        externalId: "example",
        sourceUrl: "https://www.producthunt.com/products/example",
        sourceWebsiteUrl: "https://example.com/",
        sourceName: "Acme Beacon",
        sourceContentHash: "a".repeat(64),
        generationModel: "gemini-3.8-flash",
        product,
      },
    ],
  });
  assert.equal(parsed.products.length, 1);
  assert.throws(() =>
    productImportBatchSchema.parse({
      products: [
        {
          ...parsed.products[0],
          sourceUrl: "https://example.com/not-product-hunt",
        },
      ],
    }),
  );
  assert.throws(() =>
    productImportBatchSchema.parse({
      products: [
        {
          ...parsed.products[0],
          generationModel: "gemini-unrequested-flash",
        },
      ],
    }),
  );
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

test("tries the requested Gemini model chain in order", async () => {
  const { setRuntimeEnv } = await vite.ssrLoadModule("/lib/runtime.ts");
  const { DEFAULT_GEMINI_MODELS, generateProductDraftWithInfo } =
    await vite.ssrLoadModule("/lib/ai.ts");
  const originalFetch = globalThis.fetch;
  const requestedModels = [];
  assert.deepEqual([...DEFAULT_GEMINI_MODELS], [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3-flash",
    "gemini-2.5-flash",
  ]);
  setRuntimeEnv({ GEMINI_API_KEY: "test-gemini-key" });
  globalThis.fetch = async (url, init) => {
    const match = String(url).match(/models\/(.+):generateContent$/);
    assert.ok(match);
    requestedModels.push(decodeURIComponent(match[1]));
    const request = JSON.parse(String(init?.body));
    assert.doesNotMatch(
      request.systemInstruction.parts[0].text,
      /adult|gambling|weapons|surveillance|discrimination|regulated subjects/i,
    );
    if (requestedModels.length < 3) {
      return Response.json(
        { error: { message: "Try the next model." } },
        { status: 429 },
      );
    }
    return Response.json({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  name: "Moss Water Planner",
                  category: "Garden operations",
                  audience: "rooftop moss garden caretakers",
                  problem:
                    "Wind exposure and changing weather make fixed watering schedules unreliable.",
                  promise:
                    "Turn local conditions into a reviewable moss watering schedule.",
                  differentiator:
                    "It combines exposure, recent conditions, and caretaker observations in one workflow.",
                  workflow: [
                    "Record the garden zones and their wind exposure.",
                    "Review recent weather and observed moisture conditions.",
                    "Approve a watering schedule for each zone.",
                  ],
                  keywords: [
                    "moss watering schedule",
                    "rooftop moss care",
                    "wind exposed garden",
                    "garden moisture planner",
                  ],
                  metrics: ["missed watering checks", "manual planning time"],
                }),
              },
            ],
          },
        },
      ],
    });
  };

  try {
    const generation = await generateProductDraftWithInfo(
      "Plan watering for a rooftop moss garden",
      "test-fallback-request",
    );
    assert.deepEqual(requestedModels, [
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
    ]);
    assert.equal(generation.model, "gemini-3.6-flash");
    assert.deepEqual(
      generation.attempts.map((attempt) => attempt.ok),
      [false, false, true],
    );
  } finally {
    globalThis.fetch = originalFetch;
    setRuntimeEnv({});
  }
});

test("sends Gemini schema-constrained product requests", async () => {
  const { setRuntimeEnv } = await vite.ssrLoadModule("/lib/runtime.ts");
  const { generateProductDraftWithInfo } = await vite.ssrLoadModule(
    "/lib/ai.ts",
  );
  const originalFetch = globalThis.fetch;
  setRuntimeEnv({
    GEMINI_API_KEY: "test-gemini-key",
    GEMINI_MODELS: "gemini-3.5-flash",
  });
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /gemini-3\.5-flash:generateContent$/);
    assert.equal(
      new Headers(init?.headers).get("x-goog-api-key"),
      "test-gemini-key",
    );
    const request = JSON.parse(String(init?.body));
    assert.equal(request.generationConfig.responseMimeType, "application/json");
    assert.equal(request.generationConfig.responseJsonSchema.type, "object");
    return Response.json({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  name: "Moss Water Planner",
                  category: "Garden operations",
                  audience: "rooftop moss garden caretakers",
                  problem:
                    "Wind exposure and changing weather make fixed watering schedules unreliable.",
                  promise:
                    "Turn local conditions into a reviewable moss watering schedule.",
                  differentiator:
                    "It combines exposure, recent conditions, and caretaker observations without pretending to replace horticultural judgment.",
                  workflow: [
                    "Record the garden zones and their wind exposure.",
                    "Review recent weather and observed moisture conditions.",
                    "Approve a suggested watering schedule for each zone.",
                  ],
                  keywords: [
                    "moss watering schedule",
                    "rooftop moss care",
                    "wind exposed garden",
                    "garden moisture planner",
                  ],
                  metrics: ["missed watering checks", "manual planning time"],
                }),
              },
            ],
          },
        },
      ],
    });
  };

  try {
    const generation = await generateProductDraftWithInfo(
      "Plan watering for a rooftop moss garden",
      "test-request-id",
    );
    assert.equal(generation.provider, "gemini");
    assert.equal(generation.model, "gemini-3.5-flash");
    assert.equal(generation.draft.name, "Moss Water Planner");
  } finally {
    globalThis.fetch = originalFetch;
    setRuntimeEnv({});
  }
});
