import { generateProductDraft, upsertProductVectors } from "./ai";
import {
  getGeneratedProductByQueryHash,
  saveGeneratedProduct,
} from "./catalog";
import type { Product } from "./product-types";
import { queryHash } from "./security";

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 68) || "new-product"
  );
}

export async function generateAndSaveProduct(query: string) {
  const hash = await queryHash(query);
  const existing = await getGeneratedProductByQueryHash(hash);
  if (existing) return { product: existing, created: false };

  const draft = await generateProductDraft(query);
  const product: Product = {
    ...draft,
    id: crypto.randomUUID(),
    slug: slugify(draft.name) + "-" + hash.slice(0, 6),
    source: "generated",
    originQuery: query,
    createdAt: new Date().toISOString(),
  };

  await saveGeneratedProduct(product, query, hash);
  try {
    await upsertProductVectors([product]);
  } catch {
    // Search falls back to the indexed lexical terms when vector indexing fails.
  }
  return { product, created: true };
}
