import { z } from "zod";
import {
  getProductsBySlugs,
  productSearchText,
  toSearchResult,
} from "./catalog";
import {
  diagnosticDetails,
  logRuntimeEvent,
  RuntimeDiagnosticError,
} from "./diagnostics";
import type {
  GeneratedProductDraft,
  Product,
  ProductSearchResult,
} from "./product-types";
import { getRuntimeEnv } from "./runtime";

export const EMBEDDING_MODEL = "@cf/baai/bge-small-en-v1.5";
export const DEFAULT_GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3-flash",
  "gemini-2.5-flash",
] as const;

export type GenerationAttempt = {
  provider: "gemini";
  model: string;
  attempt: number;
  ok: boolean;
  code?: string;
  stage?: string;
  message?: string;
  cause?: string;
  issues?: string[];
};

export type ProductDraftGeneration = {
  draft: GeneratedProductDraft;
  provider: GenerationAttempt["provider"];
  model: string;
  attempts: GenerationAttempt[];
};

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

const requiredProductFields = [
  "name",
  "category",
  "audience",
  "problem",
  "promise",
  "differentiator",
  "workflow",
  "keywords",
  "metrics",
] as const;

// Gemini supports a JSON Schema subset. Length limits stay in Zod because the
// Gemini subset does not support minLength/maxLength.
const geminiProductJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", description: "A specific 3-64 character name." },
    category: {
      type: "string",
      description: "A concise 3-48 character software category.",
    },
    audience: {
      type: "string",
      description: "The specific intended users in 8-160 characters.",
    },
    problem: {
      type: "string",
      description: "The concrete operational problem in 20-360 characters.",
    },
    promise: {
      type: "string",
      description: "A realistic 12-220 character value proposition.",
    },
    differentiator: {
      type: "string",
      description: "A specific, honest 20-420 character differentiator.",
    },
    workflow: {
      type: "array",
      description: "Exactly three concise workflow steps.",
      minItems: 3,
      maxItems: 3,
      items: { type: "string" },
    },
    keywords: {
      type: "array",
      description: "Four to eight realistic search phrases.",
      minItems: 4,
      maxItems: 8,
      items: { type: "string" },
    },
    metrics: {
      type: "array",
      description: "Two to four measurable operational outcomes.",
      minItems: 2,
      maxItems: 4,
      items: { type: "string" },
    },
  },
  required: requiredProductFields,
} as const;

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
        "You write complete catalog records for focused software products that solve real operational problems.",
        "Return only one valid JSON object and no markdown.",
        "Use present tense and describe the product and its capabilities directly.",
        "Do not mention product generation, concepts, experiments, prototypes, validation, testing demand, future construction, or whether the product exists.",
        "Be specific, useful, confident, and avoid unsupported performance claims.",
        "Use exactly these keys: name, category, audience, problem, promise, differentiator, workflow, keywords, metrics.",
        "workflow must be an array of 3 concise steps. keywords must contain 4 to 8 realistic search phrases.",
        "metrics must contain 2 to 4 operational outcomes that do not make unsupported claims.",
      ].join(" "),
    },
    {
      role: "user",
      content:
        "Create a focused software product record for this request: " +
        JSON.stringify(query.slice(0, 320)),
    },
  ];
}

function parseDraftResponse(raw: unknown) {
  const candidate = typeof raw === "string" ? parseJsonObject(raw) : raw;
  return draftSchema.parse(candidate);
}

export function configuredGeminiModels() {
  const configured = getRuntimeEnv().GEMINI_MODELS?.trim();
  if (!configured) return [...DEFAULT_GEMINI_MODELS];

  const models = Array.from(
    new Set(
      configured
        .split(",")
        .map((model) => model.trim())
        .filter(Boolean),
    ),
  ).slice(0, 6);
  if (
    !models.length ||
    models.some((model) => !/^[a-z0-9][a-z0-9._-]{1,79}$/i.test(model))
  ) {
    throw new RuntimeDiagnosticError(
      "GEMINI_MODELS_INVALID",
      "configuration",
      "GEMINI_MODELS must be a comma-separated list of Gemini model IDs.",
    );
  }
  return models;
}

async function runGeminiGenerator(query: string, model: string) {
  const apiKey = getRuntimeEnv().GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const [systemMessage, userMessage] = generationMessages(query);
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(model) +
      ":generateContent",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemMessage.content }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userMessage.content }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
          responseJsonSchema: geminiProductJsonSchema,
        },
      }),
    },
  );

  let payload: {
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
    candidates?: Array<{
      finishReason?: string;
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new Error(
      "Gemini " + model + " returned non-JSON HTTP " + response.status + ".",
    );
  }

  if (!response.ok) {
    throw new Error(
      "Gemini " +
        model +
        " returned HTTP " +
        response.status +
        (payload.error?.message ? ": " + payload.error.message : "."),
    );
  }

  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  if (!text) {
    const reason =
      payload.promptFeedback?.blockReason ||
      payload.candidates?.[0]?.finishReason ||
      "empty response";
    throw new Error("Gemini " + model + " returned no product (" + reason + ").");
  }
  return text;
}

function failedAttempt(
  provider: GenerationAttempt["provider"],
  model: string,
  attempt: number,
  error: unknown,
): GenerationAttempt {
  const failure = diagnosticDetails(error);
  return {
    provider,
    model,
    attempt,
    ok: false,
    code: failure.code,
    stage: failure.stage,
    message: failure.message,
    cause: failure.cause,
    issues: failure.issues,
  };
}

function logGenerationAttempt(
  requestId: string | undefined,
  attempt: GenerationAttempt,
) {
  logRuntimeEvent(attempt.ok ? "info" : "warn", "generation_provider_attempt", {
    requestId,
    ...attempt,
  });
}

export async function generateProductDraftWithInfo(
  query: string,
  requestId?: string,
): Promise<ProductDraftGeneration> {
  const runtime = getRuntimeEnv();
  const attempts: GenerationAttempt[] = [];
  if (!runtime.GEMINI_API_KEY?.trim()) {
    throw new RuntimeDiagnosticError(
      "PRODUCT_GENERATION_NOT_CONFIGURED",
      "configuration",
      "Product generation is not configured. Add GEMINI_API_KEY.",
    );
  }

  for (const model of configuredGeminiModels()) {
    const attemptNumber = attempts.length + 1;
    let raw: unknown;
    try {
      raw = await runGeminiGenerator(query, model);
    } catch (error) {
      const attempt = failedAttempt(
        "gemini",
        model,
        attemptNumber,
        new RuntimeDiagnosticError(
          "GEMINI_REQUEST_FAILED",
          "gemini_api",
          "Gemini could not complete the product-generation request.",
          error,
        ),
      );
      attempts.push(attempt);
      logGenerationAttempt(requestId, attempt);
      continue;
    }

    try {
      const draft = parseDraftResponse(raw);
      const attempt: GenerationAttempt = {
        provider: "gemini",
        model,
        attempt: attemptNumber,
        ok: true,
      };
      attempts.push(attempt);
      logGenerationAttempt(requestId, attempt);
      return { draft, provider: "gemini", model, attempts };
    } catch (error) {
      const attempt = failedAttempt(
        "gemini",
        model,
        attemptNumber,
        new RuntimeDiagnosticError(
          "GEMINI_RESPONSE_INVALID",
          "response_validation",
          "Gemini returned a product that did not match the required schema.",
          error,
        ),
      );
      attempts.push(attempt);
      logGenerationAttempt(requestId, attempt);
    }
  }

  throw new RuntimeDiagnosticError(
    "ALL_GEMINI_MODELS_FAILED",
    "gemini_api",
    "Every configured Gemini model failed.",
    undefined,
    { attempts },
  );
}

export async function generateProductDraft(
  query: string,
  requestId?: string,
): Promise<GeneratedProductDraft> {
  return (await generateProductDraftWithInfo(query, requestId)).draft;
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
