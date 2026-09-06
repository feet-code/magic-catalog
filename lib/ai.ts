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

export const GENERATION_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
export const EMBEDDING_MODEL = "@cf/baai/bge-small-en-v1.5";
export const DEFAULT_GEMINI_MODELS = [
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
] as const;

export type GenerationAttempt = {
  provider: "gemini" | "workers_ai" | "compatible_llm";
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

const productJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 3, maxLength: 64 },
    category: { type: "string", minLength: 3, maxLength: 48 },
    audience: { type: "string", minLength: 8, maxLength: 160 },
    problem: { type: "string", minLength: 20, maxLength: 360 },
    promise: { type: "string", minLength: 12, maxLength: 220 },
    differentiator: { type: "string", minLength: 20, maxLength: 420 },
    workflow: {
      type: "array",
      minItems: 3,
      maxItems: 4,
      items: { type: "string", minLength: 8, maxLength: 180 },
    },
    keywords: {
      type: "array",
      minItems: 4,
      maxItems: 10,
      items: { type: "string", minLength: 2, maxLength: 60 },
    },
    metrics: {
      type: "array",
      minItems: 2,
      maxItems: 4,
      items: { type: "string", minLength: 3, maxLength: 100 },
    },
  },
  required: [
    "name",
    "category",
    "audience",
    "problem",
    "promise",
    "differentiator",
    "workflow",
    "keywords",
    "metrics",
  ],
} as const;

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
  required: productJsonSchema.required,
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
  ).slice(0, 5);
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

async function runCloudflareGenerator(query: string) {
  const binding = getRuntimeEnv().AI;
  if (!binding) return null;
  const response = await binding.run(GENERATION_MODEL, {
    messages: generationMessages(query),
    max_tokens: 1100,
    temperature: 0.2,
    response_format: {
      type: "json_schema",
      json_schema: productJsonSchema,
    },
  });
  if (typeof response === "string") return response;
  if (
    response &&
    typeof response === "object" &&
    "response" in response
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
  let hasConfiguredProvider = false;

  if (runtime.GEMINI_API_KEY?.trim()) {
    hasConfiguredProvider = true;
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
  }

  if (runtime.AI) {
    hasConfiguredProvider = true;
    for (let retry = 1; retry <= 2; retry += 1) {
      const attemptNumber = attempts.length + 1;
      let raw: unknown;
      try {
        raw = await runCloudflareGenerator(query);
      } catch (error) {
        const attempt = failedAttempt(
          "workers_ai",
          GENERATION_MODEL,
          attemptNumber,
          new RuntimeDiagnosticError(
            "WORKERS_AI_REQUEST_FAILED",
            "workers_ai",
            "Workers AI could not complete the product-generation request.",
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
          provider: "workers_ai",
          model: GENERATION_MODEL,
          attempt: attemptNumber,
          ok: true,
        };
        attempts.push(attempt);
        logGenerationAttempt(requestId, attempt);
        return { draft, provider: "workers_ai", model: GENERATION_MODEL, attempts };
      } catch (error) {
        const attempt = failedAttempt(
          "workers_ai",
          GENERATION_MODEL,
          attemptNumber,
          new RuntimeDiagnosticError(
            "WORKERS_AI_RESPONSE_INVALID",
            "response_validation",
            "Workers AI returned a product that did not match the required schema.",
            error,
          ),
        );
        attempts.push(attempt);
        logGenerationAttempt(requestId, attempt);
      }
    }
  }

  if (runtime.LLM_API_BASE && runtime.LLM_API_KEY && runtime.LLM_MODEL) {
    hasConfiguredProvider = true;
    const attemptNumber = attempts.length + 1;
    try {
      const fallback = await runCompatibleGenerator(query);
      const draft = parseDraftResponse(fallback);
      const attempt: GenerationAttempt = {
        provider: "compatible_llm",
        model: runtime.LLM_MODEL,
        attempt: attemptNumber,
        ok: true,
      };
      attempts.push(attempt);
      logGenerationAttempt(requestId, attempt);
      return {
        draft,
        provider: "compatible_llm",
        model: runtime.LLM_MODEL,
        attempts,
      };
    } catch (error) {
      const attempt = failedAttempt(
        "compatible_llm",
        runtime.LLM_MODEL,
        attemptNumber,
        new RuntimeDiagnosticError(
          "FALLBACK_LLM_FAILED",
          "fallback_llm",
          "The fallback LLM could not produce a valid product.",
          error,
        ),
      );
      attempts.push(attempt);
      logGenerationAttempt(requestId, attempt);
    }
  }

  if (!hasConfiguredProvider) {
    throw new RuntimeDiagnosticError(
      "PRODUCT_GENERATION_NOT_CONFIGURED",
      "configuration",
      "Product generation is not configured. Add GEMINI_API_KEY, a Workers AI binding, or an OpenAI-compatible LLM.",
    );
  }

  throw new RuntimeDiagnosticError(
    "ALL_PRODUCT_GENERATORS_FAILED",
    "unknown",
    "Every configured product-generation provider failed.",
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
