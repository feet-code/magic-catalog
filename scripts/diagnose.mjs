import { getAdminConfig } from "./admin-config.mjs";

try {
  const { siteUrl, token } = await getAdminConfig("Diagnostics");
  const response = await fetch(siteUrl + "/api/admin/diagnostics", {
    method: "POST",
    headers: { authorization: "Bearer " + token },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      "Diagnostics returned non-JSON status " + response.status + ": " + text,
    );
  }

  console.log("Magic Catalog diagnostics");
  console.log("URL: " + siteUrl);
  console.log(
    "Request ID: " +
      (body.requestId || response.headers.get("x-request-id") || "unknown"),
  );
  for (const [name, check] of Object.entries(body.checks || {})) {
    console.log((check.ok ? "PASS " : "FAIL ") + name + ": " + check.message);
    if (check.details) console.log("  " + JSON.stringify(check.details));
    if (check.failure) {
      console.log(
        "  [" +
          check.failure.stage +
          "/" +
          check.failure.code +
          "] " +
          check.failure.message,
      );
      if (check.failure.cause) console.log("  Cause: " + check.failure.cause);
      for (const issue of check.failure.issues || []) console.log("  - " + issue);
      if (check.failure.details) {
        console.log("  Details: " + JSON.stringify(check.failure.details));
      }
    }
  }

  if (!response.ok || !body.ok) {
    console.error(
      "Diagnostics failed. Run `npm run logs`, reproduce the problem, and match the Request ID shown by the site.",
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
