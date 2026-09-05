"use client";

function anonymousId() {
  const key = "magic_catalog_anonymous_id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const next = crypto.randomUUID();
  window.localStorage.setItem(key, next);
  return next;
}

export function captureEvent(
  event:
    | "page_viewed"
    | "search_submitted"
    | "search_results_returned"
    | "product_viewed"
    | "product_generated"
    | "email_signup",
  properties: Record<string, string | number | boolean | null> = {},
) {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({
    event,
    anonymousId: anonymousId(),
    path: window.location.pathname + window.location.search,
    properties,
  });
  void fetch("/api/analytics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  });
}
