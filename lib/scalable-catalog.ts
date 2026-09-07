import type { Product, ProductSearchResult, ProductSource } from "./product-types";
import { getRuntimeEnv, getSearchShards } from "./runtime";

export type IntentMatch = {
  key: string;
  label?: string;
  score: number;
};

export type IntentCluster = {
  key: string;
  label: string;
  searchText: string;
  productCount?: number;
};

type ScalableMetadataRow = {
  id: number;
  slug: string;
  name: string;
  category: string;
  audience: string;
  problem: string;
  promise: string;
  source: string;
  storageKey: string;
  intentKey: string;
  createdAt: string;
};

type ScalableSearchRow = Omit<ScalableMetadataRow, "storageKey" | "createdAt"> & {
  rank: number;
};

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "because", "been", "before",
  "being", "but", "can", "could", "does", "for", "from", "have", "how", "into",
  "its", "just", "looking", "need", "our", "that", "the", "their", "them", "there",
  "these", "they", "this", "through", "tool", "want", "what", "when", "where",
  "which", "while", "who", "with", "would", "you", "your",
]);

function normalizedTokens(input: string) {
  return Array.from(
    new Set(
      input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .map((term) => {
          if (term.length > 5 && term.endsWith("ies")) return term.slice(0, -3) + "y";
          if (term.length > 5 && term.endsWith("ing")) return term.slice(0, -3);
          if (term.length > 4 && term.endsWith("s")) return term.slice(0, -1);
          return term;
        })
        .filter((term) => term.length > 2 && !STOP_WORDS.has(term)),
    ),
  ).slice(0, 12);
}

export function scalableFtsQuery(input: string) {
  return normalizedTokens(input)
    .map((term) => `"${term}"`)
    .join(" OR ");
}

export function productBodyKey(slug: string) {
  return `products/${slug}.json`;
}

export function shardIndexForSlug(slug: string, shardCount: number) {
  if (!Number.isInteger(shardCount) || shardCount <= 0) return 0;
  let hash = 0x811c9dc5;
  for (let index = 0; index < slug.length; index += 1) {
    hash ^= slug.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % shardCount;
}

function productSearchText(product: Product) {
  return [
    product.name,
    product.category,
    product.audience,
    product.problem,
    product.promise,
    product.differentiator,
    product.keywords.join(" "),
  ].join(". ");
}

function validSource(value: string): ProductSource {
  if (value === "seed" || value === "generated" || value === "catalog") return value;
  return "catalog";
}

function searchResultFromRow(
  row: ScalableSearchRow,
  position: number,
  clusterScores: Map<string, number>,
): ProductSearchResult {
  const semantic = clusterScores.get(row.intentKey) ?? 0;
  const positionBoost = Math.max(0, 0.12 - position * 0.012);
  const score = Math.min(0.98, 0.58 + semantic * 0.25 + positionBoost);
  return {
    slug: row.slug,
    name: row.name,
    category: row.category,
    audience: row.audience,
    problem: row.problem,
    promise: row.promise,
    source: validSource(row.source),
    score,
  };
}

async function searchOneShard(
  db: D1Database,
  ftsQuery: string,
  intentKeys: string[],
  limit: number,
) {
  const intentClause = intentKeys.length
    ? ` AND p.intent_key IN (${intentKeys.map((_, index) => `?${index + 2}`).join(", ")})`
    : "";
  const limitParameter = `?${intentKeys.length + 2}`;
  const result = await db
    .prepare(
      "SELECT p.id, p.slug, p.name, p.category, p.audience, " +
        "p.problem_excerpt AS problem, p.promise, p.source, p.intent_key AS intentKey, " +
        "bm25(catalog_products_fts) AS rank " +
        "FROM catalog_products_fts " +
        "JOIN catalog_products p ON p.id = catalog_products_fts.rowid " +
        "WHERE catalog_products_fts MATCH ?1" +
        intentClause +
        " ORDER BY rank LIMIT " +
        limitParameter,
    )
    .bind(ftsQuery, ...intentKeys, limit)
    .all<ScalableSearchRow>();
  return result.results ?? [];
}

async function runShardSearch(
  query: string,
  intents: IntentMatch[],
  limit: number,
  allowUnfilteredFallback: boolean,
) {
  const shards = getSearchShards();
  const ftsQuery = scalableFtsQuery(query);
  if (!shards.length || !ftsQuery) return [];

  const intentKeys = intents.map((intent) => intent.key).filter(Boolean).slice(0, 8);
  const perShard = Math.min(16, Math.max(limit, 10));
  const groups = await Promise.all(
    shards.map(async (db) => {
      try {
        return await searchOneShard(db, ftsQuery, intentKeys, perShard);
      } catch {
        return [];
      }
    }),
  );
  const rows = groups.flat();
  if (!rows.length && intentKeys.length && allowUnfilteredFallback) {
    return runShardSearch(query, [], limit, false);
  }

  const clusterScores = new Map(intents.map((intent) => [intent.key, intent.score]));
  const deduped = new Map<string, ProductSearchResult>();
  rows
    .sort((a, b) => Number(a.rank) - Number(b.rank))
    .forEach((row, index) => {
      const result = searchResultFromRow(row, index, clusterScores);
      const current = deduped.get(result.slug);
      if (!current || result.score > current.score) deduped.set(result.slug, result);
    });
  return Array.from(deduped.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function searchScalableCatalog(
  query: string,
  intents: IntentMatch[] = [],
  limit = 8,
) {
  return runShardSearch(query, intents, Math.max(1, Math.min(20, limit)), true);
}

async function findMetadataBySlug(slug: string) {
  const shards = getSearchShards();
  if (!shards.length) return null;
  const preferred = shardIndexForSlug(slug, shards.length);
  const order = [preferred, ...shards.map((_, index) => index).filter((index) => index !== preferred)];
  for (const index of order) {
    try {
      const row = await shards[index]
        .prepare(
          "SELECT id, slug, name, category, audience, problem_excerpt AS problem, promise, " +
            "source, storage_key AS storageKey, intent_key AS intentKey, created_at AS createdAt " +
            "FROM catalog_products WHERE slug = ?1 LIMIT 1",
        )
        .bind(slug)
        .first<ScalableMetadataRow>();
      if (row) return row;
    } catch {
      // A missing or temporarily unavailable shard should not break legacy pages.
    }
  }
  return null;
}

function parseStoredProduct(raw: string, metadata: ScalableMetadataRow): Product | null {
  try {
    const parsed = JSON.parse(raw) as Partial<Product>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.slug !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.category !== "string" ||
      typeof parsed.audience !== "string" ||
      typeof parsed.problem !== "string" ||
      typeof parsed.promise !== "string" ||
      typeof parsed.differentiator !== "string" ||
      !Array.isArray(parsed.workflow) ||
      !Array.isArray(parsed.keywords) ||
      !Array.isArray(parsed.metrics)
    ) {
      return null;
    }
    return {
      id: parsed.id,
      slug: parsed.slug,
      name: parsed.name,
      category: parsed.category,
      audience: parsed.audience,
      problem: parsed.problem,
      promise: parsed.promise,
      differentiator: parsed.differentiator,
      workflow: parsed.workflow.filter((value): value is string => typeof value === "string"),
      keywords: parsed.keywords.filter((value): value is string => typeof value === "string"),
      metrics: parsed.metrics.filter((value): value is string => typeof value === "string"),
      source: validSource(String(parsed.source ?? metadata.source)),
      createdAt:
        typeof parsed.createdAt === "string" ? parsed.createdAt : metadata.createdAt,
      originQuery:
        typeof parsed.originQuery === "string" ? parsed.originQuery : undefined,
      intentKey:
        typeof parsed.intentKey === "string" ? parsed.intentKey : metadata.intentKey,
    };
  } catch {
    return null;
  }
}

export async function getScalableProductBySlug(slug: string): Promise<Product | null> {
  const runtime = getRuntimeEnv();
  if (!runtime.PRODUCT_BODIES) return null;
  const metadata = await findMetadataBySlug(slug);
  if (!metadata) return null;
  try {
    const object = await runtime.PRODUCT_BODIES.get(metadata.storageKey);
    if (!object) return null;
    return parseStoredProduct(await object.text(), metadata);
  } catch {
    return null;
  }
}

export async function upsertScalableProduct(product: Product, intentKey: string) {
  const runtime = getRuntimeEnv();
  const shards = getSearchShards();
  if (!runtime.PRODUCT_BODIES || !shards.length) {
    throw new Error(
      "Scalable catalog storage is not configured. Run npm run scale:setup, then deploy again.",
    );
  }
  const cleanIntentKey = intentKey.trim().slice(0, 96);
  if (!cleanIntentKey) throw new Error("intentKey is required for scalable catalog products.");
  const shardIndex = shardIndexForSlug(product.slug, shards.length);
  const db = shards[shardIndex];
  const storageKey = productBodyKey(product.slug);
  const stored: Product = {
    ...product,
    source: product.source === "seed" ? "catalog" : product.source,
    intentKey: cleanIntentKey,
  };

  await runtime.PRODUCT_BODIES.put(storageKey, JSON.stringify(stored), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { slug: product.slug, intent: cleanIntentKey },
  });

  await db
    .prepare(
      "INSERT INTO catalog_products " +
        "(slug, name, category, audience, problem_excerpt, promise, source, storage_key, intent_key, created_at) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) " +
        "ON CONFLICT(slug) DO UPDATE SET " +
        "name=excluded.name, category=excluded.category, audience=excluded.audience, " +
        "problem_excerpt=excluded.problem_excerpt, promise=excluded.promise, source=excluded.source, " +
        "storage_key=excluded.storage_key, intent_key=excluded.intent_key, created_at=excluded.created_at",
    )
    .bind(
      product.slug,
      product.name,
      product.category,
      product.audience,
      product.problem.slice(0, 360),
      product.promise,
      stored.source,
      storageKey,
      cleanIntentKey,
      product.createdAt,
    )
    .run();

  const metadata = await db
    .prepare("SELECT id FROM catalog_products WHERE slug = ?1 LIMIT 1")
    .bind(product.slug)
    .first<{ id: number }>();
  if (!metadata) throw new Error("Catalog metadata write did not return a row.");

  await db
    .prepare("DELETE FROM catalog_products_fts WHERE rowid = ?1")
    .bind(metadata.id)
    .run();
  await db
    .prepare(
      "INSERT INTO catalog_products_fts(rowid, slug, intent_key, search_text) VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(metadata.id, product.slug, cleanIntentKey, productSearchText(stored))
    .run();

  return { shardIndex, storageKey };
}

export async function upsertIntentClusterRecord(cluster: IntentCluster) {
  const db = getRuntimeEnv().DB;
  if (!db) throw new Error("Primary D1 DB binding is required for intent clusters.");
  const key = cluster.key.trim().slice(0, 96);
  const label = cluster.label.trim().slice(0, 160);
  const searchText = cluster.searchText.trim().slice(0, 1200);
  if (!key || !label || !searchText) throw new Error("Intent cluster key, label, and searchText are required.");
  await db
    .prepare(
      "INSERT INTO intent_clusters (intent_key, label, search_text, product_count, updated_at) " +
        "VALUES (?1, ?2, ?3, ?4, ?5) " +
        "ON CONFLICT(intent_key) DO UPDATE SET label=excluded.label, search_text=excluded.search_text, " +
        "product_count=max(intent_clusters.product_count, excluded.product_count), updated_at=excluded.updated_at",
    )
    .bind(
      key,
      label,
      searchText,
      Math.max(0, Math.floor(cluster.productCount ?? 0)),
      new Date().toISOString(),
    )
    .run();
  return { key, label, searchText };
}

export async function listIntentClusters(limit = 10_000) {
  const db = getRuntimeEnv().DB;
  if (!db) return [];
  try {
    const result = await db
      .prepare(
        "SELECT intent_key AS key, label, search_text AS searchText, product_count AS productCount " +
          "FROM intent_clusters ORDER BY product_count DESC, intent_key LIMIT ?1",
      )
      .bind(Math.max(1, Math.min(10_000, limit)))
      .all<IntentCluster>();
    return result.results ?? [];
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

export async function scalableProductCount() {
  const counts = await shardCounts();
  return counts.reduce((total, count) => total + count, 0);
}

export async function scalableSitemapRows(page: number, pageSize: number) {
  const shards = getSearchShards();
  if (!shards.length) return [];
  const counts = await shardCounts();
  let remainingOffset = Math.max(0, Math.floor(page)) * pageSize;
  let remaining = pageSize;
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
      rows.push(...(result.results ?? []));
      remaining -= result.results?.length ?? 0;
    } catch {
      // Keep producing a partial sitemap instead of failing every sitemap request.
    }
    remainingOffset = 0;
  }
  return rows;
}
