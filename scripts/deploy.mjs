#!/usr/bin/env node
import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SITE_VERIFICATION_URL = "https://www.googleapis.com/siteVerification/v1";
const SEARCH_CONSOLE_URL = "https://www.googleapis.com/webmasters/v3";
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/siteverification",
  "https://www.googleapis.com/auth/webmasters",
];

class HttpError extends Error {
  constructor(status, method, url, detail) {
    super(`Google HTTP ${status} for ${method} ${url}: ${detail}`);
    this.status = status;
    this.detail = detail;
  }
}

function positiveNumber(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, got ${JSON.stringify(raw)}`);
  }
  return value;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

export function normalizeSiteUrl(value) {
  const url = new URL(String(value).trim());
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("SITE_URL must be a public HTTP or HTTPS origin.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("SITE_URL must be an origin without a path, query, or fragment.");
  }
  return `${url.origin}/`;
}

function decodeAttribute(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

export function verificationMetaContents(document) {
  const contents = [];
  for (const match of String(document).matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = new Map();
    const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    for (const attribute of match[0].matchAll(pattern)) {
      attributes.set(
        attribute[1].toLowerCase(),
        decodeAttribute(attribute[2] ?? attribute[3] ?? attribute[4] ?? ""),
      );
    }
    if (attributes.get("name")?.toLowerCase() === "google-site-verification") {
      const content = attributes.get("content")?.trim();
      if (content) contents.push(content);
    }
  }
  return contents;
}

export function googleVerificationContent(value) {
  return verificationMetaContents(value)[0] || String(value).trim();
}

export function webResourcePathId(resourceId) {
  // Google's list API can return an already percent-encoded ID. Preserve those
  // escapes instead of turning each '%' into '%25'.
  return encodeURIComponent(String(resourceId)).replace(/%25([0-9a-f]{2})/gi, "%$1");
}

export function serviceAccountAssertion(credentials, now = Date.now()) {
  if (!credentials?.client_email || !credentials?.private_key) {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS must reference a service-account JSON key with client_email and private_key.",
    );
  }
  const issuedAt = Math.floor(now / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: GOOGLE_SCOPES.join(" "),
    aud: GOOGLE_TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(credentials.private_key).toString("base64url")}`;
}

async function command(executable, args, input) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      cwd: ROOT,
      env: process.env,
      stdio: ["pipe", "inherit", "inherit"],
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${executable} ${args.join(" ")} failed (${signal || `exit ${code}`}).`));
    });
    child.stdin.end(input ?? "");
  });
}

async function putWorkerSecret(name, value) {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  console.log(`Uploading Worker secret ${name}.`);
  await command(npx, ["wrangler", "secret", "put", name, "--config", "wrangler.jsonc"], `${value}\n`);
}

async function googleJson(method, url, accessToken, body) {
  let failure;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      const detail = await response.text();
      if (response.ok) return detail ? JSON.parse(detail) : {};
      failure = new HttpError(response.status, method, url, detail || "<empty response>");
      if (response.status !== 429 && response.status < 500) throw failure;
    } catch (error) {
      failure = error;
      if (error instanceof HttpError && error.status !== 429 && error.status < 500) throw error;
    }
    if (attempt < 3) await delay(2 ** attempt * 1000);
  }
  throw failure;
}

async function googleAccessToken(credentials) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: serviceAccountAssertion(credentials),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const detail = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, "POST", GOOGLE_TOKEN_URL, detail || "<empty response>");
  }
  const payload = JSON.parse(detail);
  if (!payload.access_token) throw new Error("Google returned no service-account access token.");
  return payload.access_token;
}

async function serviceAccount() {
  const configured = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!configured) return null;
  const path = resolve(process.cwd(), configured);
  let credentials;
  try {
    credentials = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read GOOGLE_APPLICATION_CREDENTIALS at ${path}: ${error.message}`);
  }
  if (credentials.type !== "service_account") {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS must reference a service-account JSON key.");
  }
  return credentials;
}

async function configuredSiteUrl() {
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  if (!config.vars?.SITE_URL) {
    throw new Error("wrangler.jsonc must define vars.SITE_URL before deployment.");
  }
  return normalizeSiteUrl(config.vars?.SITE_URL);
}

function matchingSiteResource(resources, propertyUrl) {
  return (resources.items || []).find((resource) => {
    if (resource.site?.type !== "SITE") return false;
    try {
      return normalizeSiteUrl(resource.site.identifier) === propertyUrl;
    } catch {
      return false;
    }
  });
}

async function updateDelegatedOwner(resource, ownerEmail, accessToken) {
  if (!ownerEmail || resource.owners?.includes(ownerEmail)) return;
  const owners = [...new Set([...(resource.owners || []), ownerEmail])].sort();
  await googleJson(
    "PUT",
    `${SITE_VERIFICATION_URL}/webResource/${webResourcePathId(resource.id)}`,
    accessToken,
    { site: resource.site, owners },
  );
  console.log(`Delegated Google site ownership to ${ownerEmail}.`);
}

async function prepareGoogle(propertyUrl) {
  const credentials = await serviceAccount();
  if (!credentials) {
    console.log("GOOGLE_APPLICATION_CREDENTIALS is not set; leaving GSC configuration unchanged.");
    return null;
  }
  console.log(`Google authentication: service account ${credentials.client_email}`);
  const accessToken = await googleAccessToken(credentials);
  const resources = await googleJson("GET", `${SITE_VERIFICATION_URL}/webResource`, accessToken);
  const resource = matchingSiteResource(resources, propertyUrl);
  const ownerEmail = process.env.GOOGLE_SEARCH_CONSOLE_OWNER_EMAIL?.trim();
  if (resource) {
    console.log(`Google ownership already exists for ${propertyUrl}`);
    await updateDelegatedOwner(resource, ownerEmail, accessToken);
    return { accessToken, needsVerification: false, propertyUrl };
  }

  const result = await googleJson("POST", `${SITE_VERIFICATION_URL}/token`, accessToken, {
    site: { identifier: propertyUrl, type: "SITE" },
    verificationMethod: "META",
  });
  const verificationToken = googleVerificationContent(result.token || "");
  if (!verificationToken) throw new Error("Google returned an empty META verification token.");
  await putWorkerSecret("GSC_VERIFICATION_TOKEN", verificationToken);
  return { accessToken, needsVerification: true, ownerEmail, propertyUrl, verificationToken };
}

async function configurePostHog() {
  const apiKey = process.env.POSTHOG_PROJECT_API_KEY?.trim();
  if (!apiKey) {
    console.log("POSTHOG_PROJECT_API_KEY is not set; leaving PostHog secrets unchanged.");
    return;
  }
  const host = (process.env.POSTHOG_INGEST_HOST?.trim() || "https://us.i.posthog.com").replace(/\/+$/, "");
  const parsed = new URL(host);
  if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("POSTHOG_INGEST_HOST must be an HTTPS origin such as https://us.i.posthog.com.");
  }
  await putWorkerSecret("POSTHOG_PROJECT_API_KEY", apiKey);
  await putWorkerSecret("POSTHOG_INGEST_HOST", parsed.origin);
}

async function waitForVerificationMeta(propertyUrl, expectedToken) {
  const timeout = positiveNumber("GOOGLE_VERIFICATION_TIMEOUT_SECONDS", 300) * 1000;
  const poll = positiveNumber("GOOGLE_VERIFICATION_POLL_SECONDS", 5) * 1000;
  const deadline = Date.now() + timeout;
  let attempt = 0;
  let observation = "not fetched yet";
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const response = await fetch(propertyUrl, {
        headers: { Accept: "text/html", "Cache-Control": "no-cache", Pragma: "no-cache" },
        signal: AbortSignal.timeout(30_000),
      });
      const document = await response.text();
      const tokens = verificationMetaContents(document);
      if (response.ok && tokens.includes(expectedToken)) {
        console.log(`Google META token is public at ${propertyUrl}`);
        return;
      }
      observation = response.ok
        ? tokens.length ? "a different META token is present" : "no verification META token is present"
        : `site returned HTTP ${response.status}`;
    } catch (error) {
      observation = `public fetch failed: ${error.message}`;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const wait = Math.min(poll * 1.5 ** Math.min(attempt - 1, 6), 20_000, remaining);
    console.log(`Verification tag not public yet (${observation}); retrying in ${(wait / 1000).toFixed(1)}s.`);
    await delay(wait);
  }
  throw new Error(
    `Timed out waiting for the Google verification META tag at ${propertyUrl}; last observation: ${observation}.`,
  );
}

function verificationTokenMissing(error) {
  return error instanceof HttpError && error.status === 400 &&
    /verification token/i.test(error.detail) && /could not be found/i.test(error.detail);
}

async function finalizeGoogle(context) {
  if (!context) return;
  const { accessToken, needsVerification, ownerEmail, propertyUrl, verificationToken } = context;
  if (needsVerification) {
    await waitForVerificationMeta(propertyUrl, verificationToken);
    const deadline = Date.now() + positiveNumber("GOOGLE_VERIFICATION_TIMEOUT_SECONDS", 300) * 1000;
    let verified;
    while (!verified) {
      try {
        const body = { site: { identifier: propertyUrl, type: "SITE" } };
        if (ownerEmail) body.owners = [ownerEmail];
        verified = await googleJson(
          "POST",
          `${SITE_VERIFICATION_URL}/webResource?verificationMethod=META`,
          accessToken,
          body,
        );
      } catch (error) {
        if (!verificationTokenMissing(error) || Date.now() >= deadline) throw error;
        console.log("Google has not observed the public META token yet; retrying in 5s.");
        await delay(Math.min(5000, deadline - Date.now()));
      }
    }
    console.log(`Google ownership verified: ${verified.id || propertyUrl}`);
  }

  const encodedProperty = encodeURIComponent(propertyUrl);
  await googleJson("PUT", `${SEARCH_CONSOLE_URL}/sites/${encodedProperty}`, accessToken);
  console.log(`Search Console property ready: ${propertyUrl}`);
  const sitemapUrl = `${propertyUrl}sitemap.xml`;
  await googleJson(
    "PUT",
    `${SEARCH_CONSOLE_URL}/sites/${encodedProperty}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
    accessToken,
  );
  console.log(`Search Console sitemap submitted: ${sitemapUrl}`);
}

export async function main() {
  const propertyUrl = await configuredSiteUrl();
  console.log(`Production site: ${propertyUrl}`);
  await configurePostHog();
  const google = await prepareGoogle(propertyUrl);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  await command(npm, ["run", "deploy:worker"]);
  await finalizeGoogle(google);
  console.log("Magic Catalog deployment and monitoring setup complete.");
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(`\nDeployment failed: ${error.message}`);
    process.exitCode = 1;
  });
}
