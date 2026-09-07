#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONFIG_URL = new URL("../wrangler.jsonc", import.meta.url);
const R2_BUCKET = "magic-catalog-product-bodies";
const INTENT_INDEX = "magic-catalog-intents";
const SHARD_COUNT = 8;
const SHARD_PREFIX = "magic-catalog-search-";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function run(args, { quiet = false, allowFailure = false } = {}) {
  const result = spawnSync(npx, ["wrangler", ...args], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    shell: false,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (!quiet && output.trim()) process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`wrangler ${args.join(" ")} failed with exit ${result.status}.\n${output}`);
  }
  return { status: result.status ?? 1, output, stdout: result.stdout || "" };
}

function parseJsonOutput(raw, label) {
  const trimmed = String(raw).trim();
  const firstArray = trimmed.indexOf("[");
  const firstObject = trimmed.indexOf("{");
  const start = [firstArray, firstObject].filter((value) => value >= 0).sort((a, b) => a - b)[0];
  if (start === undefined) throw new Error(`${label} did not return JSON.\n${trimmed}`);
  try {
    return JSON.parse(trimmed.slice(start));
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}\n${trimmed}`);
  }
}

async function readConfig() {
  try {
    return JSON.parse(await readFile(CONFIG_URL, "utf8"));
  } catch (error) {
    throw new Error(`Could not parse wrangler.jsonc as JSON: ${error.message}`);
  }
}

async function writeConfig(config) {
  await writeFile(CONFIG_URL, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function d1List() {
  const result = run(["d1", "list", "--json", "--config", "wrangler.jsonc"], { quiet: true });
  const parsed = parseJsonOutput(result.stdout, "wrangler d1 list --json");
  return Array.isArray(parsed) ? parsed : parsed.result || [];
}

function vectorList() {
  const result = run(["vectorize", "list", "--json", "--config", "wrangler.jsonc"], { quiet: true });
  const parsed = parseJsonOutput(result.stdout, "wrangler vectorize list --json");
  return Array.isArray(parsed) ? parsed : parsed.result || [];
}

function databaseId(database) {
  return database.uuid || database.id || database.database_id;
}

async function ensureD1Shards() {
  let databases = d1List();
  for (let index = 0; index < SHARD_COUNT; index += 1) {
    const name = `${SHARD_PREFIX}${index}`;
    if (databases.some((database) => database.name === name)) {
      console.log(`D1 shard exists: ${name}`);
      continue;
    }
    console.log(`Creating D1 shard: ${name}`);
    run(["d1", "create", name, "--config", "wrangler.jsonc"]);
    databases = d1List();
    if (!databases.some((database) => database.name === name)) {
      throw new Error(`Wrangler reported success but ${name} was not returned by d1 list.`);
    }
  }
  return databases;
}

function ensureR2Bucket() {
  const listed = run(["r2", "bucket", "list", "--config", "wrangler.jsonc"], { quiet: true });
  if (listed.output.includes(R2_BUCKET)) {
    console.log(`R2 bucket exists: ${R2_BUCKET}`);
    return;
  }
  console.log(`Creating R2 bucket: ${R2_BUCKET}`);
  const created = run(
    ["r2", "bucket", "create", R2_BUCKET, "--config", "wrangler.jsonc"],
    { allowFailure: true },
  );
  if (created.status !== 0 && !/already exists|already owned|duplicate/i.test(created.output)) {
    throw new Error(`Could not create R2 bucket ${R2_BUCKET}.\n${created.output}`);
  }
}

function ensureIntentIndex() {
  let indexes = vectorList();
  if (indexes.some((index) => index.name === INTENT_INDEX)) {
    console.log(`Vectorize intent index exists: ${INTENT_INDEX}`);
    return;
  }
  console.log(`Creating Vectorize intent index: ${INTENT_INDEX}`);
  run([
    "vectorize",
    "create",
    INTENT_INDEX,
    "--dimensions=384",
    "--metric=cosine",
    "--config",
    "wrangler.jsonc",
  ]);
  indexes = vectorList();
  if (!indexes.some((index) => index.name === INTENT_INDEX)) {
    throw new Error(`Wrangler reported success but ${INTENT_INDEX} was not returned by vectorize list.`);
  }
}

function configureBindings(config, databases) {
  const primary = (config.d1_databases || []).filter(
    (database) => database.binding !== undefined && !/^SEARCH_DB_\d+$/.test(database.binding),
  );
  const shards = Array.from({ length: SHARD_COUNT }, (_, index) => {
    const name = `${SHARD_PREFIX}${index}`;
    const database = databases.find((item) => item.name === name);
    const id = database && databaseId(database);
    if (!id) throw new Error(`Could not determine database ID for ${name}.`);
    return {
      binding: `SEARCH_DB_${index}`,
      database_name: name,
      database_id: id,
    };
  });
  config.d1_databases = [...primary, ...shards];

  const r2 = (config.r2_buckets || []).filter((bucket) => bucket.binding !== "PRODUCT_BODIES");
  config.r2_buckets = [
    ...r2,
    { binding: "PRODUCT_BODIES", bucket_name: R2_BUCKET },
  ];

  const vectorize = (config.vectorize || []).filter((index) => index.binding !== "INTENT_INDEX");
  config.vectorize = [
    ...vectorize,
    { binding: "INTENT_INDEX", index_name: INTENT_INDEX },
  ];
  return config;
}

function applyShardSchemas() {
  for (let index = 0; index < SHARD_COUNT; index += 1) {
    const name = `${SHARD_PREFIX}${index}`;
    console.log(`Applying FTS schema to ${name}`);
    run([
      "d1",
      "execute",
      name,
      "--remote",
      "--file=db/search-shard.sql",
      "--config",
      "wrangler.jsonc",
    ]);
  }
}

async function main() {
  console.log("Provisioning Magic Catalog million-product storage/search resources.");
  ensureR2Bucket();
  const databases = await ensureD1Shards();
  ensureIntentIndex();
  const config = configureBindings(await readConfig(), databases);
  await writeConfig(config);
  console.log("Updated wrangler.jsonc with scalable bindings.");
  applyShardSchemas();
  console.log("\nScale setup complete.");
  console.log("Next: npm run deploy");
  console.log("After deploy, use POST /api/admin/catalog/ingest in batches of up to 25 products.");
}

main().catch((error) => {
  console.error(`\nScale setup failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
