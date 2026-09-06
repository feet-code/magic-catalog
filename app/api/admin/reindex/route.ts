import { desc } from "drizzle-orm";
import { getDb } from "../../../../db";
import { products } from "../../../../db/schema";
import { upsertProductVectors } from "../../../../lib/ai";
import { rowToProduct } from "../../../../lib/catalog";
import {
  diagnosticDetails,
  logRuntimeEvent,
  requestIdFor,
} from "../../../../lib/diagnostics";
import { seedProducts } from "../../../../lib/seed-products";
import { getRuntimeEnv } from "../../../../lib/runtime";
import type { Product } from "../../../../lib/product-types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const runtime = getRuntimeEnv();
  const requestId = requestIdFor(request);
  const headers = {
    "cache-control": "no-store",
    "x-request-id": requestId,
  };
  const authorization = request.headers.get("authorization");
  if (
    !runtime.ADMIN_REINDEX_TOKEN ||
    authorization !== "Bearer " + runtime.ADMIN_REINDEX_TOKEN
  ) {
    return Response.json({ error: "Not found." }, { status: 404, headers });
  }
  if (!runtime.AI || !runtime.PRODUCT_INDEX) {
    return Response.json(
      { error: "Workers AI and PRODUCT_INDEX bindings are required." },
      { status: 503, headers },
    );
  }
  if (!runtime.DB) {
    return Response.json(
      { error: "The D1 DB binding is required before indexing." },
      { status: 503, headers },
    );
  }

  let dynamicProducts: Product[] = [];
  try {
    await runtime.DB.prepare("SELECT 1 FROM rate_limits LIMIT 1").first();
    const rows = await getDb()
      .select()
      .from(products)
      .orderBy(desc(products.createdAt))
      .limit(1000);
    dynamicProducts = rows.map(rowToProduct);
  } catch (error) {
    logRuntimeEvent("error", "reindex_d1_check_failed", {
      requestId,
      failure: diagnosticDetails(error),
    });
    return Response.json(
      {
        error:
          "The D1 schema is not initialized. Run npm run db:migrate:remote, then retry the reindex command.",
        debugId: requestId,
      },
      { status: 503, headers },
    );
  }

  const all = [...seedProducts, ...dynamicProducts];
  let indexed = 0;
  try {
    for (let cursor = 0; cursor < all.length; cursor += 20) {
      const batch = all.slice(cursor, cursor + 20);
      await upsertProductVectors(batch);
      indexed += batch.length;
    }
  } catch (error) {
    logRuntimeEvent("error", "reindex_failed", {
      requestId,
      indexed,
      total: all.length,
      failure: diagnosticDetails(error),
    });
    return Response.json(
      {
        error: "Vector indexing failed before all products were processed.",
        indexed,
        total: all.length,
        debugId: requestId,
      },
      { status: 503, headers },
    );
  }
  logRuntimeEvent("info", "reindex_succeeded", {
    requestId,
    indexed,
  });
  return Response.json({ indexed, requestId }, { headers });
}
