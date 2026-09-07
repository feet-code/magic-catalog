import { embedTexts } from "./ai";
import type { IntentCluster, IntentMatch } from "./scalable-catalog";
import { getRuntimeEnv } from "./runtime";

export async function semanticIntentSearch(
  query: string,
  limit = 6,
): Promise<IntentMatch[] | null> {
  const runtime = getRuntimeEnv();
  if (!runtime.INTENT_INDEX || !runtime.AI) return null;
  const vectors = await embedTexts([query]);
  if (!vectors?.[0]) return null;
  const response = await runtime.INTENT_INDEX.query(vectors[0], {
    topK: Math.max(1, Math.min(12, limit)),
    returnMetadata: "all",
  });
  return response.matches.flatMap((match) => {
    const key = match.metadata?.intentKey;
    if (typeof key !== "string" || !key) return [];
    const label = match.metadata?.label;
    return [
      {
        key,
        label: typeof label === "string" ? label : undefined,
        score: match.score,
      },
    ];
  });
}

export async function upsertIntentVectors(clusters: IntentCluster[]) {
  const runtime = getRuntimeEnv();
  if (!clusters.length) return true;
  if (!runtime.INTENT_INDEX || !runtime.AI) return false;
  const vectors = await embedTexts(
    clusters.map((cluster) => `${cluster.label}. ${cluster.searchText}`),
  );
  if (!vectors || vectors.length !== clusters.length) {
    throw new Error("Intent embedding count did not match the cluster batch.");
  }
  await runtime.INTENT_INDEX.upsert(
    clusters.map((cluster, index) => ({
      id: cluster.key,
      values: vectors[index],
      metadata: {
        intentKey: cluster.key,
        label: cluster.label,
      },
    })),
  );
  return true;
}
