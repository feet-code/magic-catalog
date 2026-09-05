import { getRuntimeEnv } from "./runtime";

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function queryHash(query: string) {
  return sha256(query.trim().toLowerCase().replace(/\s+/g, " "));
}

function clientAddress(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local"
  );
}

export async function clientIdentityHash(request: Request) {
  const runtime = getRuntimeEnv();
  const raw = [
    runtime.RATE_LIMIT_SALT || "magic-catalog-local-only",
    clientAddress(request),
    request.headers.get("user-agent") || "unknown",
  ].join("|");
  return sha256(raw);
}

export async function consumeRateLimit(
  request: Request,
  action: string,
  maximum: number,
) {
  const binding = getRuntimeEnv().DB;
  if (!binding) return { allowed: false, remaining: 0 };

  const bucket = new Date().toISOString().slice(0, 10);
  const identity = await clientIdentityHash(request);
  const now = new Date().toISOString();
  const row = await binding
    .prepare(
      "INSERT INTO rate_limits (action, bucket, identity_hash, count, updated_at) " +
        "VALUES (?1, ?2, ?3, 1, ?4) " +
        "ON CONFLICT(action, bucket, identity_hash) DO UPDATE SET " +
        "count = count + 1, updated_at = excluded.updated_at RETURNING count",
    )
    .bind(action, bucket, identity, now)
    .first<{ count: number }>();
  const count = Number(row?.count ?? maximum + 1);
  return {
    allowed: count <= maximum,
    remaining: Math.max(0, maximum - count),
  };
}

export async function verifyTurnstile(
  request: Request,
  token: string | undefined,
) {
  const secret = getRuntimeEnv().TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;

  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  form.set("remoteip", clientAddress(request));
  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body: form },
  );
  if (!response.ok) return false;
  const payload = (await response.json()) as { success?: boolean };
  return payload.success === true;
}
