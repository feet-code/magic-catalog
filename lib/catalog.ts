import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { productTerms, products } from "../db/schema";
import type { Product, ProductSearchResult } from "./product-types";
import { getScalableProductBySlug } from "./scalable-catalog";
import { seedProductBySlug, seedProducts } from "./seed-products";
import { getRuntimeEnv } from "./runtime";

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "because", "been", "before",
  "being", "but", "can", "could", "does", "for", "from", "have", "how", "into",
  "its", "just", "looking", "need", "our", "that", "the", "their", "them", "there",
  "these", "they", "this", "through", "tool", "want", "what", "when", "where",
  "which", "while", "who", "with", "would", "you", "your",
]);

export function tokenize(input: string) {
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

export function productSearchText(product: Product) {
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

function weightedTerms(product: Product) {
  const weights = new Map<string, number>();
  const add = (value: string, weight: number) => {
    for (const term of tokenize(value)) {
      weights.set(term, Math.max(weight, weights.get(term) ?? 0));
    }
  };

  add(product.name, 8);
  add(product.keywords.join(" "), 6);
  add(product.category, 5);
  add(product.audience, 4);
  add(product.promise, 4);
  add(product.problem, 3);
  add(product.differentiator, 2);
  return weights;
}

export function toSearchResult(
  product: Product,
  score: number,
): ProductSearchResult {
  return {
    slug: product.slug,
    name: product.name,
    category: product.category,
    audience: product.audience,
    problem: product.problem,
    promise: product.promise,
    source: product.source,
    score,
  };
}

export function searchSeedCatalog(query: string, limit = 8) {
  const queryTerms = tokenize(query);
  const queryPhrase = query.trim().toLowerCase();
  if (!queryTerms.length) return [];

  return seedProducts
    .map((product) => {
      const weights = weightedTerms(product);
      let points = queryTerms.reduce(
        (total, term) => total + (weights.get(term) ?? 0),
        0,
      );
      const haystack = productSearchText(product).toLowerCase();
      if (queryPhrase.length > 5 && haystack.includes(queryPhrase)) points += 12;
      const score = Math.min(0.99, points / Math.max(12, queryTerms.length * 8));
      return toSearchResult(product, score);
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function parseStringArray(value: string, fallback: string[]) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : fallback;
  } catch {
    return fallback;
  }
}

export function rowToProduct(row: typeof products.$inferSelect): Product {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    audience: row.audience,
    problem: row.problem,
    promise: row.promise,
    differentiator: row.differentiator,
    workflow: parseStringArray(row.workflowJson, []),
    keywords: parseStringArray(row.keywordsJson, []),
    metrics: parseStringArray(row.metricsJson, []),
    source:
      row.source === "seed"
        ? "seed"
        : row.source === "catalog"
          ? "catalog"
          : "generated",
    createdAt: row.createdAt,
    originQuery: row.originQuery ?? undefined,
  };
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  const seed = seedProductBySlug.get(slug);
  if (seed) return seed;

  const scalable = await getScalableProductBySlug(slug);
  if (scalable) return scalable;

  try {
    const [row] = await getDb()
      .select()
      .from(products)
      .where(eq(products.slug, slug))
      .limit(1);
    return row ? rowToProduct(row) : null;
  } catch {
    return null;
  }
}

export async function getGeneratedProductByQueryHash(queryHash: string) {
  try {
    const [row] = await getDb()
      .select()
      .from(products)
      .where(eq(products.queryHash, queryHash))
      .limit(1);
    return row ? rowToProduct(row) : null;
  } catch {
    return null;
  }
}

export async function getProductsBySlugs(slugs: string[]) {
  const wanted = Array.from(new Set(slugs)).slice(0, 20);
  if (!wanted.length) return [];

  const found = new Map<string, Product>();
  for (const slug of wanted) {
    const seed = seedProductBySlug.get(slug);
    if (seed) found.set(slug, seed);
  }

  const dynamicSlugs = wanted.filter((slug) => !found.has(slug));
  if (dynamicSlugs.length) {
    try {
      const rows = await getDb()
        .select()
        .from(products)
        .where(inArray(products.slug, dynamicSlugs));
      for (const row of rows) found.set(row.slug, rowToProduct(row));
    } catch {
      // The bundled catalog still works when D1 is temporarily unavailable.
    }
  }

  return wanted.flatMap((slug) => {
    const product = found.get(slug);
    return product ? [product] : [];
  });
}

export async function searchGeneratedCatalog(query: string, limit = 8) {
  const queryTerms = tokenize(query);
  const binding = getRuntimeEnv().DB;
  if (!queryTerms.length || !binding) return [];

  try {
    const placeholders = queryTerms
      .map((_, index) => "?" + String(index + 1))
      .join(", ");
    const limitParameter = "?" + String(queryTerms.length + 1);
    const ranked = await binding
      .prepare(
        "SELECT product_slug AS slug, sum(weight) AS points " +
          "FROM product_terms WHERE term IN (" +
          placeholders +
          ") GROUP BY product_slug ORDER BY points DESC LIMIT " +
          limitParameter,
      )
      .bind(...queryTerms, limit)
      .all<{ slug: string; points: number }>();

    const rows = ranked.results ?? [];
    const matched = await getProductsBySlugs(rows.map((row) => row.slug));
    const pointsBySlug = new Map(
      rows.map((row) => [row.slug, Number(row.points)]),
    );
    return matched.map((product) =>
      toSearchResult(
        product,
        Math.min(
          0.99,
          (pointsBySlug.get(product.slug) ?? 0) /
            Math.max(12, queryTerms.length * 8),
        ),
      ),
    );
  } catch {
    return [];
  }
}

export async function saveGeneratedProduct(
  product: Product,
  originQuery: string,
  queryHash: string,
) {
  const db = getDb();
  await db
    .insert(products)
    .values({
      id: product.id,
      slug: product.slug,
      name: product.name,
      category: product.category,
      audience: product.audience,
      problem: product.problem,
      promise: product.promise,
      differentiator: product.differentiator,
      workflowJson: JSON.stringify(product.workflow),
      keywordsJson: JSON.stringify(product.keywords),
      metricsJson: JSON.stringify(product.metrics),
      source: "generated",
      originQuery,
      queryHash,
      createdAt: product.createdAt,
    })
    .onConflictDoNothing();

  const terms = Array.from(weightedTerms(product), ([term, weight]) => ({
    productSlug: product.slug,
    term,
    weight,
  }));
  if (terms.length) {
    await db.insert(productTerms).values(terms).onConflictDoNothing();
  }
}

export async function dynamicProductCount() {
  try {
    const result = await getRuntimeEnv().DB?.prepare(
      "SELECT count(*) AS count FROM products",
    ).first<{ count: number }>();
    return Number(result?.count ?? 0);
  } catch {
    return 0;
  }
}

export async function dynamicSitemapRows(page: number, pageSize: number) {
  const start = Math.max(0, page) * pageSize;
  const end = start + pageSize;
  try {
    const result = await getRuntimeEnv().DB?.prepare(
      "SELECT slug, created_at AS createdAt FROM products " +
        "WHERE rowid > ?1 AND rowid <= ?2 ORDER BY rowid",
    )
      .bind(start, end)
      .all<{ slug: string; createdAt: string }>();
    return result?.results ?? [];
  } catch {
    return [];
  }
}
