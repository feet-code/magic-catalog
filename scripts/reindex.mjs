import { getAdminConfig } from "./admin-config.mjs";

try {
  const { siteUrl, token } = await getAdminConfig("Reindex");
  const response = await fetch(siteUrl + "/api/admin/reindex", {
    method: "POST",
    headers: { authorization: "Bearer " + token },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      "Reindex failed with status " + response.status + ": " + body,
    );
  }
  console.log(body);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
