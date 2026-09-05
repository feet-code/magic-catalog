import { z } from "zod";
import { semanticSearch } from "../../../lib/ai";
import {
  searchGeneratedCatalog,
  searchSeedCatalog,
  toSearchResult,
} from "../../../lib/catalog";
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

export async function POST(request: Request) {
  try {
    const payload = bodySchema.parse(await request.json());
    const passedChallenge = await verifyTurnstile(
      request,
      payload.turnstileToken,
    );
    if (!passedChallenge) {
      return Response.json(
        { error: "Please complete the verification and try again." },
        { status: 400 },
      );
    }

    let semantic: ProductSearchResult[] | null = null;
    try {
      semantic = await semanticSearch(payload.query, 8);
    } catch {
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
      return Response.json(
        { mode: "matches", generated: false, results },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const rate = await consumeRateLimit(request, "generate", 3);
    if (!rate.allowed) {
      return Response.json(
        {
          mode: "related",
          generated: false,
          generationStatus: "limited",
          message:
            "No close match was found. The daily generation limit for this browser has been reached, so these are the nearest existing ideas.",
          results,
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    try {
      const generated = await generateAndSaveProduct(payload.query);
      const top = {
        ...toSearchResult(generated.product, 1),
        generated: generated.created,
      };
      return Response.json(
        {
          mode: generated.created ? "generated" : "matches",
          generated: generated.created,
          results: mergeResults([[top], results]),
        },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      const message =
        error instanceof Error &&
        error.message.startsWith("Product generation is not configured")
          ? "No close match was found. On-demand generation needs its AI binding configured; the nearest existing ideas are shown below."
          : "No close match was found, and a new concept could not be generated just now. The nearest existing ideas are shown below.";
      return Response.json(
        {
          mode: "related",
          generated: false,
          generationStatus: "unavailable",
          message,
          results,
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Describe a specific problem in 4 to 320 characters." },
        { status: 400 },
      );
    }
    return Response.json(
      { error: "Search is temporarily unavailable." },
      { status: 500 },
    );
  }
}
