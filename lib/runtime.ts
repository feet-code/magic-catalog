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
  POSTHOG_PROJECT_API_KEY?: string;
  POSTHOG_INGEST_HOST?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  RATE_LIMIT_SALT?: string;
  ADMIN_REINDEX_TOKEN?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODELS?: string;
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

const DEFAULT_SITE_URL = "https://magic-catalog.cloudwebsites.workers.dev";

function hasValidHostname(hostname: string) {
  if (hostname === "localhost" || hostname.startsWith("[")) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
    return hostname.split(".").every((part) => Number(part) <= 255);
  }

  if (hostname.length > 253) return false;
  return hostname.split(".").every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
  );
}

export function getSiteUrl() {
  const configured = getRuntimeEnv().SITE_URL?.trim();
  if (!configured) return DEFAULT_SITE_URL;

  try {
    const parsed = new URL(configured);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password ||
      !hasValidHostname(parsed.hostname)
    ) {
      return DEFAULT_SITE_URL;
    }
    return parsed.origin;
  } catch {
    return DEFAULT_SITE_URL;
  }
}
