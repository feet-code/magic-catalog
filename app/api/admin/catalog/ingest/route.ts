import { z } from "zod";
import {
  diagnosticDetails,
  logRuntimeEvent,
  requestIdFor,
} from "../../../../../lib/diagnostics";
import { upsertIntentVectors } from "../../../../../lib/intent-search";
import type { Product } from "../../../../../lib/product-types";
import {
  upsertIntentClusterRecord,
  upsertScalableProduct,
} from "../../../../../lib/scalable-catalog";
import { getRuntimeEnv, getSearchShards } from "../../../../../lib/runtime";

export const dynamic = "force-dynamic";

const intentSchema = z.object({
  key: z.string().trim().min(2).max(96).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  label: z.string().trim().min(3).max(160),
  searchText: z.string().trim().min(8).max(1200),
});

const productSchema = z.object({
  id: z.string().trim().min(1).max(128).optional(),
  slug: z.string().trim().min(3).max(96).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(3).max(80),
  category: z.string().trim().min(2).max(80),
  audience: z.string().trim().min(3).max(200),
  problem: z.string().trim().min(12).max(800),
  promise: z.string().trim().min(8).max(300),
  differentiator: z.string().trim().min(8).max(800),
  workflow: z.array(z.string().trim().min(3).max(240)).min(1).max(8),
  keywords: z.array(z.string().trim().min(2).max(80)).min(1).max(16),
  metrics: z.array(z.string().trim().min(2).max(120)).min(1).max(8),
  intentKey: z.string().trim().min(2).max(96),
  createdAt: z.string().datetime().optional(),
});

const bodySchema = z.object({
  intents: z.array(intentSchema).max(25).default([]),
  products: z.array(productSchema).min(1).max(25),
});

export async function POST(request: Request) {
  const runtime = getRuntimeEnv();
  const requestId = requestIdFor(request);
  const headers = {
    "cache-control": "no-store",
    "x-request-id": requestId,
  };
  if (
    !runtime.ADMIN_REINDEX_TOKEN ||
    request.headers.get("authorization") !== "Bearer " + runtime.ADMIN_REINDEX_TOKEN
  ) {
    return Response.json({ error: "Not found." }, { status: 404, headers });
  }
  if (!runtime.PRODUCT_BODIES || !getSearchShards().length) {
    return Response.json(
      {
        error:
          "Scalable catalog resources are not configured. Run npm run scale:setup and deploy again.",
      },
      { status: 503, headers },
    );
  }

  try {
    const payload = bodySchema.parse(await request.json());
    for (const intent of payload.intents) {
      await upsertIntentClusterRecord(intent);
    }
    if (payload.intents.length) {
      try {
        await upsertIntentVectors(payload.intents);
      } catch (error) {
        logRuntimeEvent("warn", "intent_vector_upsert_failed", {
          requestId,
          failure: diagnosticDetails(error),
        });
      }
    }

    const written = [];
    for (const input of payload.products) {
      const product: Product = {
        id: input.id ?? crypto.randomUUID(),
        slug: input.slug,
        name: input.name,
        category: input.category,
        audience: input.audience,
        problem: input.problem,
        promise: input.promise,
        differentiator: input.differentiator,
        workflow: input.workflow,
        keywords: input.keywords,
        metrics: input.metrics,
        source: "catalog",
        createdAt: input.createdAt ?? new Date().toISOString(),
        intentKey: input.intentKey,
      };
      const stored = await upsertScalableProduct(product, input.intentKey);
      written.push({ slug: product.slug, shard: stored.shardIndex });
    }

    logRuntimeEvent("info", "scalable_catalog_ingest_succeeded", {
      requestId,
      products: written.length,
      intents: payload.intents.length,
    });
    return Response.json(
      {
        ok: true,
        products: written.length,
        intents: payload.intents.length,
        written,
        requestId,
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid catalog ingest payload.", issues: error.issues, requestId },
        { status: 400, headers },
      );
    }
    logRuntimeEvent("error", "scalable_catalog_ingest_failed", {
      requestId,
      failure: diagnosticDetails(error),
    });
    return Response.json(
      { error: "Catalog ingest failed.", debugId: requestId },
      { status: 500, headers },
    );
  }
}
