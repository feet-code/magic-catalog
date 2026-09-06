import { z } from "zod";
import { semanticSearch } from "../../../lib/ai";
import {
  searchGeneratedCatalog,
  searchSeedCatalog,
  toSearchResult,
} from "../../../lib/catalog";
import {
  diagnosticDetails,
  logRuntimeEvent,
  requestIdFor,
} from "../../../lib/diagnostics";
import { generateAndSaveProduct } from "../../../lib/generation";
import type { ProductSearchResult } from "../../../lib/product-types";
import { consumeRateLimit, verifyTurnstile } from "../../../lib/security";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  query: z.string().trim().min(4).max(320),
  turnstileToken: z.string().max(4096).optional(),
});

function mergeResults(groups: ProductSearchResult[][]) {
  const merged = new Map<string, ProductSearchResult>();
  for (const result of groups.flat()) {
    const current = merged.get(result.slug);
    if (!current || result.score > current.score) merged.set(result.slug, result);
  }
  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
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
  const requestId = requestIdFor(request);
  const startedAt = Date.now();
  try {
    const payload = bodySchema.parse(await request.json());
    const passedChallenge = await verifyTurnstile(
      request,
      payload.turnstileToken,
    );
    if (!passedChallenge) {
      return jsonResponse(
        { error: "Please complete the verification and try again." },
        requestId,
        400,
      );
    }

    let semantic: ProductSearchResult[] | null = null;
    try {
      semantic = await semanticSearch(payload.query, 8);
    } catch (error) {
      logRuntimeEvent("warn", "semantic_search_failed", {
        requestId,
        failure: diagnosticDetails(error),
      });
      semantic = null;
    }
    const [dynamicResults] = await Promise.all([
      searchGeneratedCatalog(payload.query, 8),
    ]);
    const lexical = mergeResults([
      searchSeedCatalog(payload.query, 8),
      dynamicResults,
    ]);
    const results = mergeResults([semantic ?? [], lexical]);
    const bestScore = results[0]?.score ?? 0;
    const threshold = semantic ? 0.72 : 0.42;

    if (bestScore >= threshold) {
      return jsonResponse(
        { mode: "matches", generated: false, results },
        requestId,
      );
    }

    const rate = await consumeRateLimit(request, "generate", 3);
    if (!rate.allowed) {
      const storageUnavailable = rate.status === "unavailable";
      if (storageUnavailable) {
        logRuntimeEvent("error", "generation_rate_limit_storage_unavailable", {
          requestId,
        });
      }
      return jsonResponse(
        {
          mode: "related",
          generated: false,
          generationStatus: storageUnavailable ? "unavailable" : "limited",
          debugId: storageUnavailable ? requestId : undefined,
          message: storageUnavailable
            ? "No close match was found. Catalog search is available, but new concept generation is temporarily unavailable while its storage is being prepared."
            : "No close match was found. The daily generation limit for this browser has been reached, so these are the nearest existing ideas.",
          results,
        },
        requestId,
      );
    }

    try {
      const generated = await generateAndSaveProduct(payload.query, requestId);
      const top = {
        ...toSearchResult(generated.product, 1),
        generated: generated.created,
      };
      logRuntimeEvent("info", "product_generation_succeeded", {
        requestId,
        durationMs: Date.now() - startedAt,
        productSlug: generated.product.slug,
        created: generated.created,
        generation: "generation" in generated ? generated.generation : undefined,
      });
      return jsonResponse(
        {
          mode: generated.created ? "generated" : "matches",
          generated: generated.created,
          results: mergeResults([[top], results]),
        },
        requestId,
      );
    } catch (error) {
      const failure = diagnosticDetails(error);
      logRuntimeEvent("error", "product_generation_failed", {
        requestId,
        durationMs: Date.now() - startedAt,
        failure,
      });
      const message =
        failure.code === "PRODUCT_GENERATION_NOT_CONFIGURED"
          ? "No close match was found. On-demand generation needs its AI binding configured; the nearest existing ideas are shown below."
          : "No close match was found, and a new concept could not be generated just now. The nearest existing ideas are shown below.";
      return jsonResponse(
        {
          mode: "related",
          generated: false,
          generationStatus: "unavailable",
          debugId: requestId,
          message,
          results,
        },
        requestId,
      );
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonResponse(
        { error: "Describe a specific problem in 4 to 320 characters." },
        requestId,
        400,
      );
    }
    logRuntimeEvent("error", "search_request_failed", {
      requestId,
      durationMs: Date.now() - startedAt,
      failure: diagnosticDetails(error),
    });
    return jsonResponse(
      { error: "Search is temporarily unavailable.", debugId: requestId },
      requestId,
      500,
    );
  }
}
