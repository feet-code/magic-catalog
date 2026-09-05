export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface VectorMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface VectorIndexBinding {
  query(
    vector: number[],
    options: {
      topK: number;
      returnMetadata?: boolean | "all" | "indexed";
    },
  ): Promise<{ matches: VectorMatch[] }>;
  upsert(
    vectors: Array<{
      id: string;
      values: number[];
      metadata?: Record<string, string | number | boolean>;
    }>,
  ): Promise<unknown>;
}

export interface MagicCatalogEnv {
  DB?: D1Database;
  AI?: AiBinding;
  PRODUCT_INDEX?: VectorIndexBinding;
  SITE_URL?: string;
  GSC_VERIFICATION_TOKEN?: string;
  POSTHOG_KEY?: string;
  POSTHOG_HOST?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  RATE_LIMIT_SALT?: string;
  ADMIN_REINDEX_TOKEN?: string;
  LLM_API_BASE?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
}

declare global {
  var __MAGIC_CATALOG_ENV__: MagicCatalogEnv | undefined;
}

export function setRuntimeEnv(env: MagicCatalogEnv) {
  globalThis.__MAGIC_CATALOG_ENV__ = env;
}

export function getRuntimeEnv(): MagicCatalogEnv {
  if (globalThis.__MAGIC_CATALOG_ENV__) {
    return globalThis.__MAGIC_CATALOG_ENV__;
  }
  return process.env as unknown as MagicCatalogEnv;
}

export function getSiteUrl() {
  const configured = getRuntimeEnv().SITE_URL?.trim();
  return (configured || "https://magic-catalog.example").replace(/\/+$/, "");
}
