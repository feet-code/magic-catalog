import { desc } from "drizzle-orm";
import { getDb } from "../../../../db";
import { products } from "../../../../db/schema";
import { upsertProductVectors } from "../../../../lib/ai";
import { rowToProduct } from "../../../../lib/catalog";
import { seedProducts } from "../../../../lib/seed-products";
import { getRuntimeEnv } from "../../../../lib/runtime";
import type { Product } from "../../../../lib/product-types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const runtime = getRuntimeEnv();
  const authorization = request.headers.get("authorization");
  if (
    !runtime.ADMIN_REINDEX_TOKEN ||
    authorization !== "Bearer " + runtime.ADMIN_REINDEX_TOKEN
  ) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  if (!runtime.AI || !runtime.PRODUCT_INDEX) {
    return Response.json(
      { error: "Workers AI and PRODUCT_INDEX bindings are required." },
      { status: 503 },
    );
  }
  if (!runtime.DB) {
    return Response.json(
      { error: "The D1 DB binding is required before indexing." },
      { status: 503 },
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
    console.error("[magic-catalog] D1 schema check failed before reindex.", error);
    return Response.json(
      {
        error:
          "The D1 schema is not initialized. Run npm run db:migrate:remote, then retry the reindex command.",
      },
      { status: 503 },
    );
  }

  const all = [...seedProducts, ...dynamicProducts];
  let indexed = 0;
  for (let cursor = 0; cursor < all.length; cursor += 20) {
    const batch = all.slice(cursor, cursor + 20);
    await upsertProductVectors(batch);
    indexed += batch.length;
  }
  return Response.json({ indexed });
}
