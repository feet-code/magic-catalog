import {
  configuredGeminiModels,
  EMBEDDING_MODEL,
  embedTexts,
  generateProductDraftWithInfo,
} from "../../../../lib/ai";
import {
  diagnosticDetails,
  logRuntimeEvent,
  requestIdFor,
  RuntimeDiagnosticError,
} from "../../../../lib/diagnostics";
import { getRuntimeEnv } from "../../../../lib/runtime";

export const dynamic = "force-dynamic";

type CheckResult = {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
  failure?: ReturnType<typeof diagnosticDetails>;
};

export async function POST(request: Request) {
  const runtime = getRuntimeEnv();
  const requestId = requestIdFor(request);
  const authorization = request.headers.get("authorization");
  if (
    !runtime.ADMIN_REINDEX_TOKEN ||
    authorization !== "Bearer " + runtime.ADMIN_REINDEX_TOKEN
  ) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const checks: Record<string, CheckResult> = {};
  const runCheck = async (
    name: string,
    message: string,
    check: () => Promise<Record<string, unknown> | undefined>,
  ) => {
    try {
      checks[name] = { ok: true, message, details: await check() };
    } catch (error) {
      checks[name] = {
        ok: false,
        message: name + " check failed",
        failure: diagnosticDetails(error),
      };
    }
  };

  await runCheck("d1", "D1 is ready", async () => {
    if (!runtime.DB) {
      throw new RuntimeDiagnosticError(
        "D1_BINDING_MISSING",
        "configuration",
        "The DB binding is missing.",
      );
    }
    const productCount = await runtime.DB.prepare(
      "SELECT count(*) AS count FROM products",
    ).first<{ count: number }>();
    await runtime.DB.prepare("SELECT 1 FROM rate_limits LIMIT 1").first();
    return { generatedProducts: Number(productCount?.count ?? 0) };
  });

  await runCheck("geminiConfiguration", "Gemini is configured", async () => {
    if (!runtime.GEMINI_API_KEY?.trim()) {
      throw new RuntimeDiagnosticError(
        "GEMINI_API_KEY_MISSING",
        "configuration",
        "The GEMINI_API_KEY secret is missing.",
      );
    }
    return { models: configuredGeminiModels() };
  });

  let diagnosticVector: number[] | undefined;
  await runCheck("workersAiEmbedding", "Workers AI embeddings are ready", async () => {
    if (!runtime.AI) {
      throw new RuntimeDiagnosticError(
        "WORKERS_AI_BINDING_MISSING",
        "configuration",
        "The AI binding is missing.",
      );
    }
    const vectors = await embedTexts(["invoice follow-up workflow"]);
    diagnosticVector = vectors?.[0];
    if (!diagnosticVector?.length) {
      throw new RuntimeDiagnosticError(
        "EMBEDDING_RESPONSE_EMPTY",
        "workers_ai",
        "The embedding model returned no vector.",
      );
    }
    return { model: EMBEDDING_MODEL, dimensions: diagnosticVector.length };
  });

  await runCheck("vectorize", "Vectorize is ready", async () => {
    if (!runtime.PRODUCT_INDEX) {
      throw new RuntimeDiagnosticError(
        "VECTORIZE_BINDING_MISSING",
        "configuration",
        "The PRODUCT_INDEX binding is missing.",
      );
    }
    if (!diagnosticVector) {
      throw new RuntimeDiagnosticError(
        "DIAGNOSTIC_EMBEDDING_UNAVAILABLE",
        "vectorize",
        "Vectorize could not be tested because embedding failed.",
      );
    }
    const result = await runtime.PRODUCT_INDEX.query(diagnosticVector, {
      topK: 1,
      returnMetadata: "all",
    });
    return {
      matches: result.matches.length,
      topScore: result.matches[0]?.score,
    };
  });

  await runCheck("productGeneration", "Product generation is ready", async () => {
    const generation = await generateProductDraftWithInfo(
      "A diagnostic-only tool for organizing rooftop moss garden maintenance",
      requestId,
    );
    return {
      provider: generation.provider,
      model: generation.model,
      sampleName: generation.draft.name,
      attempts: generation.attempts,
      persisted: false,
    };
  });

  const ok = Object.values(checks).every((check) => check.ok);
  logRuntimeEvent(ok ? "info" : "error", "admin_diagnostics_completed", {
    requestId,
    ok,
    failedChecks: Object.entries(checks)
      .filter(([, check]) => !check.ok)
      .map(([name]) => name),
  });

  return Response.json(
    {
      ok,
      requestId,
      checkedAt: new Date().toISOString(),
      bindings: {
        d1: Boolean(runtime.DB),
        gemini: Boolean(runtime.GEMINI_API_KEY?.trim()),
        workersAi: Boolean(runtime.AI),
        vectorize: Boolean(runtime.PRODUCT_INDEX),
      },
      checks,
    },
    {
      status: ok ? 200 : 503,
      headers: {
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    },
  );
}
