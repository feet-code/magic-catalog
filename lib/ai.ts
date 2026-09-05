import { z } from "zod";
import {
  getProductsBySlugs,
  productSearchText,
  toSearchResult,
} from "./catalog";
import type { GeneratedProductDraft, Product, ProductSearchResult } from "./product-types";
import { getRuntimeEnv } from "./runtime";

const GENERATION_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const EMBEDDING_MODEL = "@cf/baai/bge-small-en-v1.5";

const draftSchema = z.object({
  name: z.string().trim().min(3).max(64),
  category: z.string().trim().min(3).max(48),
  audience: z.string().trim().min(8).max(160),
  problem: z.string().trim().min(20).max(360),
  promise: z.string().trim().min(12).max(220),
  differentiator: z.string().trim().min(20).max(420),
  workflow: z.array(z.string().trim().min(8).max(180)).min(3).max(4),
  keywords: z.array(z.string().trim().min(2).max(60)).min(4).max(10),
  metrics: z.array(z.string().trim().min(3).max(100)).min(2).max(4),
});

function parseJsonObject(raw: string) {
  let clean = raw.trim();
  const fence = String.fromCharCode(96).repeat(3);
  if (clean.startsWith(fence)) {
    clean = clean.slice(fence.length).replace(/^json\s*/i, "");
  }
  if (clean.endsWith(fence)) clean = clean.slice(0, -fence.length);
  const firstBrace = clean.indexOf("{");
  const lastBrace = clean.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("The model did not return a JSON product record.");
  }
  return JSON.parse(clean.slice(firstBrace, lastBrace + 1));
}

function generationMessages(query: string) {
  return [
    {
      role: "system",
      content: [
        "You design narrow, plausible software product concepts for real operational problems.",
        "Return only one valid JSON object and no markdown.",
        "Be specific, useful, and honest. Do not imply the product already exists.",
        "Avoid illegal, harmful, adult, gambling, weapons, surveillance, discrimination, or deceptive concepts.",
        "For medical, legal, financial, safety, or regulated subjects, limit the concept to administrative organization and require qualified human decisions.",
        "Use exactly these keys: name, category, audience, problem, promise, differentiator, workflow, keywords, metrics.",
        "workflow must be an array of 3 concise steps. keywords must contain 4 to 8 realistic search phrases.",
        "metrics must contain 2 to 4 operational outcomes that do not make unsupported claims.",
      ].join(" "),
    },
    {
      role: "user",
      content:
        "Create a focused product concept for this request: " +
        JSON.stringify(query.slice(0, 320)),
    },
  ];
}

async function runCloudflareGenerator(query: string) {
  const binding = getRuntimeEnv().AI;
  if (!binding) return null;
  const response = await binding.run(GENERATION_MODEL, {
    messages: generationMessages(query),
    max_tokens: 900,
    temperature: 0.35,
  });
  if (typeof response === "string") return response;
  if (
    response &&
    typeof response === "object" &&
    "response" in response &&
    typeof response.response === "string"
  ) {
    return response.response;
  }
  throw new Error("Cloudflare AI returned an unexpected response.");
}

async function runCompatibleGenerator(query: string) {
  const runtime = getRuntimeEnv();
  const base = runtime.LLM_API_BASE?.replace(/\/+$/, "");
  if (!base || !runtime.LLM_API_KEY || !runtime.LLM_MODEL) return null;

  const response = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + runtime.LLM_API_KEY,
    },
    body: JSON.stringify({
      model: runtime.LLM_MODEL,
      messages: generationMessages(query),
      temperature: 0.35,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    throw new Error("The configured LLM returned " + response.status + ".");
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("The configured LLM returned no product.");
  return content;
}

export async function generateProductDraft(
  query: string,
): Promise<GeneratedProductDraft> {
  const raw =
    (await runCloudflareGenerator(query)) ??
    (await runCompatibleGenerator(query));

  if (!raw) {
    throw new Error(
      "Product generation is not configured. Add a Workers AI binding or an OpenAI-compatible LLM.",
    );
  }
  return draftSchema.parse(parseJsonObject(raw));
}

function vectorsFromResponse(response: unknown) {
  if (
    response &&
    typeof response === "object" &&
    "data" in response &&
    Array.isArray(response.data)
  ) {
    return response.data.filter(
      (item): item is number[] =>
        Array.isArray(item) && item.every((value) => typeof value === "number"),
    );
  }
  throw new Error("Cloudflare AI returned unexpected embedding data.");
}

export async function embedTexts(texts: string[]) {
  const binding = getRuntimeEnv().AI;
  if (!binding) return null;
  const response = await binding.run(EMBEDDING_MODEL, { text: texts });
  return vectorsFromResponse(response);
}

export async function upsertProductVectors(products: Product[]) {
  const runtime = getRuntimeEnv();
  if (!runtime.PRODUCT_INDEX || !runtime.AI || !products.length) return false;

  const vectors = await embedTexts(products.map(productSearchText));
  if (!vectors || vectors.length !== products.length) {
    throw new Error("Embedding count did not match the product batch.");
  }

  await runtime.PRODUCT_INDEX.upsert(
    products.map((product, index) => ({
      id: product.slug,
      values: vectors[index],
      metadata: {
        slug: product.slug,
        source: product.source,
        category: product.category,
      },
    })),
  );
  return true;
}

export async function semanticSearch(
  query: string,
  limit = 8,
): Promise<ProductSearchResult[] | null> {
  const runtime = getRuntimeEnv();
  if (!runtime.PRODUCT_INDEX || !runtime.AI) return null;

  const vectors = await embedTexts([query]);
  if (!vectors?.[0]) return null;
  const response = await runtime.PRODUCT_INDEX.query(vectors[0], {
    topK: limit,
    returnMetadata: "all",
  });
  const slugs = response.matches.map((match) => {
    const metadataSlug = match.metadata?.slug;
    return typeof metadataSlug === "string" ? metadataSlug : match.id;
  });
  const found = await getProductsBySlugs(slugs);
  const scoreBySlug = new Map(
    response.matches.map((match) => {
      const metadataSlug = match.metadata?.slug;
      return [
        typeof metadataSlug === "string" ? metadataSlug : match.id,
        match.score,
      ] as const;
    }),
  );

  return found.map((product) =>
    toSearchResult(product, scoreBySlug.get(product.slug) ?? 0),
  );
}
