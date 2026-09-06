import { z } from "zod";
import { getRuntimeEnv, getSiteUrl } from "../../../lib/runtime";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  event: z.enum([
    "page_viewed",
    "search_submitted",
    "search_results_returned",
    "product_viewed",
    "product_generated",
    "email_signup",
  ]),
  anonymousId: z.string().min(8).max(100),
  path: z.string().max(500),
  properties: z
    .record(z.union([z.string().max(500), z.number(), z.boolean(), z.null()]))
    .optional(),
});

export async function POST(request: Request) {
  try {
    const payload = bodySchema.parse(await request.json());
    const runtime = getRuntimeEnv();
    if (!runtime.POSTHOG_PROJECT_API_KEY) {
      return new Response(null, { status: 204 });
    }

    const host = (
      runtime.POSTHOG_INGEST_HOST || "https://us.i.posthog.com"
    ).replace(/\/+$/, "");
    const hostUrl = new URL(host);
    if (hostUrl.protocol !== "https:") {
      return new Response(null, { status: 204 });
    }

    const forwarded = await fetch(host + "/capture/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: runtime.POSTHOG_PROJECT_API_KEY,
        event: payload.event,
        properties: {
          distinct_id: payload.anonymousId,
          $current_url: getSiteUrl() + payload.path,
          ...payload.properties,
        },
      }),
    });
    return new Response(null, { status: forwarded.ok ? 204 : 202 });
  } catch {
    return new Response(null, { status: 204 });
  }
}
