import { dynamicProductCount } from "./catalog";
import { getRuntimeEnv, getSearchShards } from "./runtime";
import { scalableProductCount } from "./scalable-catalog";

export async function catalogProductCount() {
  const [legacy, scalable] = await Promise.all([
    dynamicProductCount(),
    scalableProductCount(),
  ]);
  return legacy + scalable;
}

async function legacyRows(offset: number, limit: number) {
  if (limit <= 0) return [];
  try {
    const result = await getRuntimeEnv().DB?.prepare(
      "SELECT slug, created_at AS createdAt FROM products ORDER BY rowid LIMIT ?1 OFFSET ?2",
    )
      .bind(limit, offset)
      .all<{ slug: string; createdAt: string }>();
    return result?.results ?? [];
  } catch {
    return [];
  }
}

async function shardCounts() {
  return Promise.all(
    getSearchShards().map(async (db) => {
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
}

async function scalableRows(offset: number, limit: number) {
  if (limit <= 0) return [];
  const shards = getSearchShards();
  if (!shards.length) return [];
  const counts = await shardCounts();
  let remainingOffset = offset;
  let remaining = limit;
  const rows: Array<{ slug: string; createdAt: string }> = [];

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
          "SELECT slug, created_at AS createdAt FROM catalog_products ORDER BY id LIMIT ?1 OFFSET ?2",
        )
        .bind(take, remainingOffset)
        .all<{ slug: string; createdAt: string }>();
      const found = result.results ?? [];
      rows.push(...found);
      remaining -= found.length;
    } catch {
      // Sitemap generation remains available if one shard is temporarily unhealthy.
    }
    remainingOffset = 0;
  }
  return rows;
}

export async function catalogSitemapRows(page: number, pageSize: number) {
  const safePage = Math.max(0, Math.floor(page));
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const globalOffset = safePage * safePageSize;
  const legacyCount = await dynamicProductCount();

  if (globalOffset >= legacyCount) {
    return scalableRows(globalOffset - legacyCount, safePageSize);
  }

  const fromLegacy = await legacyRows(
    globalOffset,
    Math.min(safePageSize, legacyCount - globalOffset),
  );
  if (fromLegacy.length >= safePageSize) return fromLegacy;
  const fromScalable = await scalableRows(0, safePageSize - fromLegacy.length);
  return [...fromLegacy, ...fromScalable];
}
