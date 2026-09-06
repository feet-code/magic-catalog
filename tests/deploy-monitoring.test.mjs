import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  googleVerificationContent,
  normalizeSiteUrl,
  serviceAccountAssertion,
  verificationMetaContents,
  webResourcePathId,
} from "../scripts/deploy.mjs";

test("uses the same PostHog and Google environment names as seo-test", async () => {
  const runtime = await readFile(new URL("../lib/runtime.ts", import.meta.url), "utf8");
  const analytics = await readFile(new URL("../app/api/analytics/route.ts", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  for (const source of [runtime, analytics]) {
    assert.match(source, /POSTHOG_PROJECT_API_KEY/);
    assert.match(source, /POSTHOG_INGEST_HOST/);
    assert.doesNotMatch(source, /POSTHOG_KEY|POSTHOG_HOST/);
  }
  assert.match(packageJson.scripts.deploy, /--env-file-if-exists=\.env/);
  const deploy = await readFile(new URL("../scripts/deploy.mjs", import.meta.url), "utf8");
  assert.match(deploy, /GOOGLE_APPLICATION_CREDENTIALS/);
  assert.doesNotMatch(deploy, /process\.env\.SITE_URL/);
});

test("normalizes the configured URL to one URL-prefix property", () => {
  assert.equal(
    normalizeSiteUrl("https://magic-catalog.cloudwebsites.workers.dev"),
    "https://magic-catalog.cloudwebsites.workers.dev/",
  );
  assert.throws(() => normalizeSiteUrl("https://example.com/catalog"), /origin without a path/);
});

test("finds Google verification tags regardless of attribute order", () => {
  const html = [
    '<meta content="first-token" name="google-site-verification">',
    "<meta name='google-site-verification' content='second-token'>",
  ].join("");
  assert.deepEqual(verificationMetaContents(html), ["first-token", "second-token"]);
  assert.equal(googleVerificationContent(html), "first-token");
  assert.equal(googleVerificationContent("raw-token"), "raw-token");
});

test("preserves percent escapes in Site Verification resource IDs", () => {
  assert.equal(
    webResourcePathId("https%3A%2F%2Fexample.com%2F"),
    "https%3A%2F%2Fexample.com%2F",
  );
  assert.equal(
    webResourcePathId("https://example.com/"),
    "https%3A%2F%2Fexample.com%2F",
  );
});

test("creates a signed service-account JWT with the shared Google scopes", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const assertion = serviceAccountAssertion({
    client_email: "catalog@example.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  }, Date.parse("2026-09-05T12:00:00Z"));
  const [, claims] = assertion.split(".");
  const payload = JSON.parse(Buffer.from(claims, "base64url").toString("utf8"));
  assert.equal(payload.iss, "catalog@example.iam.gserviceaccount.com");
  assert.match(payload.scope, /siteverification/);
  assert.match(payload.scope, /webmasters/);
  assert.equal(payload.exp - payload.iat, 3600);
});
