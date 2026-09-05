const siteUrl = process.env.SITE_URL?.replace(/\/+$/, "");
const token = process.env.ADMIN_REINDEX_TOKEN;

if (!siteUrl || !token) {
  console.error(
    "Set SITE_URL and ADMIN_REINDEX_TOKEN before running the reindex command.",
  );
  process.exit(1);
}

const response = await fetch(siteUrl + "/api/admin/reindex", {
  method: "POST",
  headers: { authorization: "Bearer " + token },
});
const body = await response.text();
if (!response.ok) {
  console.error("Reindex failed with status " + response.status + ": " + body);
  process.exit(1);
}
console.log(body);
