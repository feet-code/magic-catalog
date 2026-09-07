import { dynamicProductCount } from "./catalog";
import { getRuntimeEnv, getSearchShards } from "./runtime";
import { scalableProductCount, shardIndexForSlug } from "./scalable-catalog";
import { seedProducts } from "./seed-products";

export type CatalogDirectoryRow = {
  slug: string;
  name: string;
  category: string;
  promise: string;
  createdAt: string;
};

async function legacyRows(offset: number, limit: number) {
  if (limit <= 0) return [];
  try {
    const result = await getRuntimeEnv().DB?.prepare(
      "SELECT slug, name, category, promise, created_at AS createdAt " +
        "FROM products ORDER BY rowid LIMIT ?1 OFFSET ?2",
    )
      .bind(limit, offset)
      .all<CatalogDirectoryRow>();
    return result?.results ?? [];
  } catch {
    return [];
  }
}

async function scalableRows(offset: number, limit: number) {
  if (limit <= 0) return [];
  const shards = getSearchShards();
  if (!shards.length) return [];

  const counts = await Promise.all(
    shards.map(async (db) => {
      try {
        const row = await db
          .prepare("SELECT count(*) AS count FROM catalog_products")
          .first<{ count: number }>();
        return Number(row?.count ?? 0);
      } catch {
        return 0;
      }
    }),
  );

  let remainingOffset = Math.max(0, offset);
  let remaining = limit;
  const rows: CatalogDirectoryRow[] = [];

  for (let index = 0; index < shards.length && remaining > 0; index += 1) {
    const count = counts[index] ?? 0;
    if (remainingOffset >= count) {
      remainingOffset -= count;
      continue;
    }

    const take = Math.min(remaining, count - remainingOffset);
    try {
      const result = await shards[index]
        .prepare(
          "SELECT slug, name, category, promise, created_at AS createdAt " +
            "FROM catalog_products ORDER BY id LIMIT ?1 OFFSET ?2",
        )
        .bind(take, remainingOffset)
        .all<CatalogDirectoryRow>();
      const found = result.results ?? [];
      rows.push(...found);
      remaining -= found.length;
    } catch {
      // Keep the directory available if one shard is temporarily unavailable.
    }
    remainingOffset = 0;
  }

  return rows;
}

export async function catalogDirectoryCount() {
  const [legacy, scalable] = await Promise.all([
    dynamicProductCount(),
    scalableProductCount(),
  ]);
  return seedProducts.length + legacy + scalable;
}

export async function catalogDirectoryRows(page: number, pageSize: number) {
  const safePage = Math.max(0, Math.floor(page));
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const offset = safePage * safePageSize;
  const legacyCount = await dynamicProductCount();

  const rows: CatalogDirectoryRow[] = [];
  const seedStart = Math.min(offset, seedProducts.length);
  const seedEnd = Math.min(seedProducts.length, offset + safePageSize);
  if (offset < seedProducts.length) {
    rows.push(
      ...seedProducts.slice(seedStart, seedEnd).map((product) => ({
        slug: product.slug,
        name: product.name,
        category: product.category,
        promise: product.promise,
        createdAt: product.createdAt,
      })),
    );
  }

  if (rows.length >= safePageSize) return rows;

  const dynamicOffset = Math.max(0, offset - seedProducts.length);
  const remaining = safePageSize - rows.length;

  if (dynamicOffset < legacyCount) {
    const legacy = await legacyRows(
      dynamicOffset,
      Math.min(remaining, legacyCount - dynamicOffset),
    );
    rows.push(...legacy);
  }

  if (rows.length >= safePageSize) return rows;

  const scalableOffset = Math.max(0, dynamicOffset - legacyCount);
  const scalable = await scalableRows(
    scalableOffset,
    safePageSize - rows.length,
  );
  rows.push(...scalable);

  return rows;
}
