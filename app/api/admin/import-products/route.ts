import { z } from "zod";
import { upsertProductVectors } from "../../../../lib/ai";
import {
  getImportedProductByIdentityHash,
  saveImportedProduct,
} from "../../../../lib/catalog";
import {
  diagnosticDetails,
  logRuntimeEvent,
  requestIdFor,
} from "../../../../lib/diagnostics";
import {
  findSourceNameLeaks,
  normalizeBrandText,
  productImportBatchSchema,
} from "../../../../lib/import-validation";
import type {
  ImportedProductProvenance,
  Product,
} from "../../../../lib/product-types";
import { getRuntimeEnv } from "../../../../lib/runtime";
import { sha256 } from "../../../../lib/security";

export const dynamic = "force-dynamic";

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 62) || "imported-product"
  );
}

function jsonResponse(body: unknown, requestId: string, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}

export async function POST(request: Request) {
  const runtime = getRuntimeEnv();
  const requestId = requestIdFor(request);
  const authorization = request.headers.get("authorization");
  if (
    !runtime.ADMIN_IMPORT_TOKEN ||
    authorization !== "Bearer " + runtime.ADMIN_IMPORT_TOKEN
  ) {
    return jsonResponse({ error: "Not found." }, requestId, 404);
  }
  if (!runtime.DB) {
    return jsonResponse(
      { error: "The D1 DB binding is required before importing." },
      requestId,
      503,
    );
  }
  if (!runtime.AI || !runtime.PRODUCT_INDEX) {
    return jsonResponse(
      {
        error:
          "Workers AI and PRODUCT_INDEX bindings are required so every import reaches Vectorize.",
      },
      requestId,
      503,
    );
  }

  try {
    await runtime.DB.prepare("SELECT 1 FROM product_imports LIMIT 1").first();
  } catch (error) {
    logRuntimeEvent("error", "product_import_schema_check_failed", {
      requestId,
      failure: diagnosticDetails(error),
    });
    return jsonResponse(
      {
        error:
          "The product import schema is not initialized. Apply remote D1 migrations, then retry.",
        debugId: requestId,
      },
      requestId,
      503,
    );
  }

  try {
    const payload = productImportBatchSchema.parse(await request.json());
    const seenExternalIds = new Set<string>();
    const validationFailures = payload.products.flatMap((item, index) => {
      const duplicate = seenExternalIds.has(item.externalId);
      seenExternalIds.add(item.externalId);
      const leaks = findSourceNameLeaks(item.sourceName, item.product);
      return duplicate || leaks.length
        ? [{ index, externalId: item.externalId, duplicate, leaks }]
        : [];
    });
    if (validationFailures.length) {
      return jsonResponse(
        {
          error:
            "One or more records reused the source brand or duplicated an external ID.",
          failures: validationFailures,
        },
        requestId,
        422,
      );
    }

    const stored: Array<{ product: Product; created: boolean }> = [];
    for (const item of payload.products) {
      const identityHash = await sha256("product-hunt:" + item.externalId);
      const existing = await getImportedProductByIdentityHash(
        "product-hunt",
        identityHash,
      );
      if (existing) {
        stored.push({ product: existing, created: false });
        continue;
      }

      const now = new Date().toISOString();
      const product: Product = {
        ...item.product,
        id: crypto.randomUUID(),
        slug: slugify(item.product.name) + "-" + identityHash.slice(0, 10),
        source: "product-hunt",
        createdAt: now,
      };
      const provenance: ImportedProductProvenance = {
        provider: "product-hunt",
        externalIdHash: identityHash,
        sourceUrlHash: await sha256(item.sourceUrl),
        sourceWebsiteUrlHash: item.sourceWebsiteUrl
          ? await sha256(item.sourceWebsiteUrl)
          : undefined,
        sourceNameHash: await sha256(normalizeBrandText(item.sourceName)),
        sourceContentHash: item.sourceContentHash,
        generationModel: item.generationModel,
        importedAt: now,
      };
      const saved = await saveImportedProduct(
        product,
        provenance,
        identityHash,
      );
      stored.push({ product: saved, created: true });
    }

    try {
      await upsertProductVectors(stored.map((item) => item.product));
    } catch (error) {
      logRuntimeEvent("error", "product_import_vector_upsert_failed", {
        requestId,
        saved: stored.length,
        failure: diagnosticDetails(error),
      });
      return jsonResponse(
        {
          error:
            "Products were saved to D1, but Vectorize indexing failed. Retry the identical batch; the import is idempotent.",
          saved: stored.length,
          retryable: true,
          debugId: requestId,
        },
        requestId,
        503,
      );
    }

    const created = stored.filter((item) => item.created).length;
    logRuntimeEvent("info", "product_import_batch_succeeded", {
      requestId,
      received: stored.length,
      created,
      existing: stored.length - created,
    });
    return jsonResponse(
      {
        created,
        existing: stored.length - created,
        indexed: stored.length,
        products: stored.map(({ product, created: wasCreated }) => ({
          slug: product.slug,
          name: product.name,
          created: wasCreated,
        })),
        requestId,
      },
      requestId,
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonResponse(
        { error: "The import payload is invalid.", issues: error.issues },
        requestId,
        400,
      );
    }
    logRuntimeEvent("error", "product_import_batch_failed", {
      requestId,
      failure: diagnosticDetails(error),
    });
    return jsonResponse(
      { error: "The import failed.", debugId: requestId },
      requestId,
      500,
    );
  }
}
