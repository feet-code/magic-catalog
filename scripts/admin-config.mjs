import { readFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".dev.vars");
} catch (error) {
  if (!error || typeof error !== "object" || error.code !== "ENOENT") {
    throw error;
  }
}

async function siteUrlFromWrangler() {
  try {
    const source = await readFile("wrangler.jsonc", "utf8");
    const match = source.match(/"SITE_URL"\s*:\s*"([^"]+)"/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function normalizeUrl(value) {
  if (!value) return undefined;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function commandLineUrl() {
  const index = process.argv.indexOf("--url");
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export async function getAdminConfig(commandName) {
  const cliUrl = normalizeUrl(commandLineUrl());
  const explicitUrl = normalizeUrl(process.env.MAGIC_CATALOG_URL);
  const siteUrlEnvironment = normalizeUrl(process.env.SITE_URL);
  const wranglerUrl = normalizeUrl(await siteUrlFromWrangler());
  const siteUrl =
    cliUrl ||
    explicitUrl ||
    (siteUrlEnvironment &&
    !/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::|$)/.test(siteUrlEnvironment)
      ? siteUrlEnvironment
      : wranglerUrl || siteUrlEnvironment);
  const token = process.env.ADMIN_REINDEX_TOKEN?.trim();

  const missing = [];
  if (!siteUrl) missing.push("a valid deployed SITE_URL");
  if (!token || token.startsWith("replace-with-")) {
    missing.push("ADMIN_REINDEX_TOKEN");
  }
  if (missing.length) {
    throw new Error(
      commandName +
        " needs " +
        missing.join(" and ") +
        ". Put the same admin token used with `wrangler secret put ADMIN_REINDEX_TOKEN` in an ignored `.dev.vars` file. The deployed URL is read from wrangler.jsonc automatically; use `--url http://localhost:5173` to target local development.",
    );
  }

  return { siteUrl, token };
}
