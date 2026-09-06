import { generateProductDraftWithInfo, upsertProductVectors } from "./ai";
import {
  getGeneratedProductByQueryHash,
  saveGeneratedProduct,
} from "./catalog";
import type { Product } from "./product-types";
import {
  diagnosticDetails,
  logRuntimeEvent,
  RuntimeDiagnosticError,
} from "./diagnostics";
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

export async function generateAndSaveProduct(
  query: string,
  requestId?: string,
) {
  const hash = await queryHash(query);
  const existing = await getGeneratedProductByQueryHash(hash);
  if (existing) return { product: existing, created: false };

  const generation = await generateProductDraftWithInfo(query, requestId);
  const draft = generation.draft;
  const product: Product = {
    ...draft,
    id: crypto.randomUUID(),
    slug: slugify(draft.name) + "-" + hash.slice(0, 6),
    source: "generated",
    originQuery: query,
    createdAt: new Date().toISOString(),
  };

  try {
    await saveGeneratedProduct(product, query, hash);
  } catch (error) {
    throw new RuntimeDiagnosticError(
      "PRODUCT_DATABASE_WRITE_FAILED",
      "database",
      "The generated product could not be saved to D1.",
      error,
    );
  }

  try {
    await upsertProductVectors([product]);
  } catch (error) {
    // Search falls back to the indexed lexical terms when vector indexing fails.
    logRuntimeEvent("warn", "generated_product_vector_upsert_failed", {
      requestId,
      productSlug: product.slug,
      failure: diagnosticDetails(error),
    });
  }
  return {
    product,
    created: true,
    generation: {
      provider: generation.provider,
      model: generation.model,
      attempts: generation.attempts,
    },
  };
}
