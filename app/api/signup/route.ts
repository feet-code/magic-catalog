import { z } from "zod";
import { getDb } from "../../../db";
import { signups } from "../../../db/schema";
import { getProductBySlug } from "../../../lib/catalog";
import {
  clientIdentityHash,
  consumeRateLimit,
  sha256,
  verifyTurnstile,
} from "../../../lib/security";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  productSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
  sourceQuery: z.string().trim().max(320).optional(),
  company: z.string().max(0).optional(),
  turnstileToken: z.string().max(4096).optional(),
});

export async function POST(request: Request) {
  try {
    const payload = bodySchema.parse(await request.json());
    if (!(await verifyTurnstile(request, payload.turnstileToken))) {
      return Response.json(
        { error: "Please complete the verification and try again." },
        { status: 400 },
      );
    }
    const product = await getProductBySlug(payload.productSlug);
    if (!product) {
      return Response.json({ error: "Product not found." }, { status: 404 });
    }
    const rate = await consumeRateLimit(request, "signup", 12);
    if (!rate.allowed) {
      return Response.json(
        { error: "Too many signup attempts today. Please try again tomorrow." },
        { status: 429 },
      );
    }

    await getDb()
      .insert(signups)
      .values({
        id: crypto.randomUUID(),
        productSlug: payload.productSlug,
        email: payload.email,
        emailHash: await sha256(payload.email),
        sourceQuery: payload.sourceQuery || null,
        ipHash: await clientIdentityHash(request),
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing();

    return Response.json(
      { ok: true },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Enter a valid email address." },
        { status: 400 },
      );
    }
    return Response.json(
      { error: "We could not save your signup. Please try again." },
      { status: 500 },
    );
  }
}
