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

test("uses Workers AI JSON-schema mode and retries an invalid draft", async () => {
  const { getRuntimeEnv, setRuntimeEnv } = await vite.ssrLoadModule(
    "/lib/runtime.ts",
  );
  const { generateProductDraft, GENERATION_MODEL } = await vite.ssrLoadModule(
    "/lib/ai.ts",
  );
  let attempts = 0;
  setRuntimeEnv({
    AI: {
      async run(model, input) {
        attempts += 1;
        assert.equal(model, GENERATION_MODEL);
        assert.equal(input.response_format.type, "json_schema");
        if (attempts === 1) return { response: { name: "Incomplete" } };
        return {
          response: {
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
          },
        };
      },
    },
  });

  try {
    const draft = await generateProductDraft(
      "Plan watering for a rooftop moss garden",
    );
    assert.equal(draft.name, "Moss Water Planner");
    assert.equal(attempts, 2);
  } finally {
    setRuntimeEnv({});
  }
  assert.deepEqual(getRuntimeEnv(), {});
});

test("uses a Gemini API key before the Workers AI fallback", async () => {
  const { setRuntimeEnv } = await vite.ssrLoadModule("/lib/runtime.ts");
  const { generateProductDraftWithInfo } = await vite.ssrLoadModule(
    "/lib/ai.ts",
  );
  const originalFetch = globalThis.fetch;
  let workersAiCalls = 0;
  setRuntimeEnv({
    GEMINI_API_KEY: "test-gemini-key",
    GEMINI_MODELS: "gemini-3.5-flash",
    AI: {
      async run() {
        workersAiCalls += 1;
        throw new Error("Workers AI should not be called when Gemini succeeds.");
      },
    },
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
    assert.equal(workersAiCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    setRuntimeEnv({});
  }
});
