import { z } from "zod";
import type { GeneratedProductDraft } from "./product-types";

const productDraftSchema = z
  .object({
    name: z.string().trim().min(3).max(64),
    category: z.string().trim().min(3).max(48),
    audience: z.string().trim().min(8).max(160),
    problem: z.string().trim().min(20).max(360),
    promise: z.string().trim().min(12).max(220),
    differentiator: z.string().trim().min(20).max(420),
    workflow: z.array(z.string().trim().min(8).max(180)).min(3).max(4),
    keywords: z.array(z.string().trim().min(2).max(60)).min(4).max(10),
    metrics: z.array(z.string().trim().min(3).max(100)).min(2).max(4),
  })
  .strict();

const importGenerationModelSchema = z.enum([
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3-flash",
  "gemini-2.5-flash",
]);

const productHuntImportSchema = z
  .object({
    externalId: z.string().trim().min(1).max(128),
    sourceUrl: z.string().trim().url().max(2_048),
    sourceWebsiteUrl: z.string().trim().url().max(2_048).optional(),
    sourceName: z.string().trim().min(1).max(160),
    sourceContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    generationModel: importGenerationModelSchema,
    product: productDraftSchema,
  })
  .strict()
  .superRefine((value, context) => {
    let parsed: URL;
    try {
      parsed = new URL(value.sourceUrl);
    } catch {
      return;
    }
    const hostname = parsed.hostname.toLowerCase();
    const productPath = /^\/products\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/i.exec(
      parsed.pathname,
    );
    if (
      parsed.protocol !== "https:" ||
      (hostname !== "producthunt.com" && hostname !== "www.producthunt.com") ||
      !productPath ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceUrl"],
        message: "sourceUrl must be a Product Hunt product URL.",
      });
    } else if (productPath[1].toLowerCase() !== value.externalId.toLowerCase()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["externalId"],
        message: "externalId must match the Product Hunt product URL slug.",
      });
    }
    if (value.sourceWebsiteUrl) {
      const protocol = new URL(value.sourceWebsiteUrl).protocol;
      if (protocol !== "http:" && protocol !== "https:") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceWebsiteUrl"],
          message: "sourceWebsiteUrl must use HTTP or HTTPS.",
        });
      }
    }
  });

export const productImportBatchSchema = z
  .object({
    products: z.array(productHuntImportSchema).min(1).max(20),
  })
  .strict();

const GENERIC_NAME_TOKENS = new Set([
  "app",
  "apps",
  "beta",
  "cloud",
  "flow",
  "hub",
  "labs",
  "platform",
  "software",
  "studio",
  "suite",
  "sync",
  "tool",
  "tools",
  "work",
]);

export function normalizeBrandText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function bigrams(value: string) {
  const compact = normalizeBrandText(value).replace(/\s+/g, "");
  if (compact.length < 2) return new Set([compact]);
  return new Set(
    Array.from({ length: compact.length - 1 }, (_, index) =>
      compact.slice(index, index + 2),
    ),
  );
}

function diceSimilarity(left: string, right: string) {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) intersection += 1;
  }
  return (2 * intersection) / (a.size + b.size);
}

function publicProductText(product: GeneratedProductDraft) {
  return [
    product.name,
    product.category,
    product.audience,
    product.problem,
    product.promise,
    product.differentiator,
    ...product.workflow,
    ...product.keywords,
    ...product.metrics,
  ].join(" ");
}

export function findSourceNameLeaks(
  sourceName: string,
  product: GeneratedProductDraft,
) {
  const normalizedSource = normalizeBrandText(sourceName);
  const normalizedPublicText = normalizeBrandText(publicProductText(product));
  const publicTokens = new Set(normalizedPublicText.split(" "));
  const leaks = new Set<string>();

  if (
    normalizedSource.length >= 3 &&
    (" " + normalizedPublicText + " ").includes(" " + normalizedSource + " ")
  ) {
    leaks.add("full-source-name");
  }

  for (const token of normalizedSource.split(" ")) {
    if (
      token.length >= 4 &&
      !GENERIC_NAME_TOKENS.has(token) &&
      publicTokens.has(token)
    ) {
      leaks.add("source-token:" + token);
    }
  }

  if (diceSimilarity(sourceName, product.name) >= 0.62) {
    leaks.add("replacement-name-too-similar");
  }

  return [...leaks];
}
