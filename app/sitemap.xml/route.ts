import { dynamicProductCount } from "../../lib/catalog";
import { getSiteUrl } from "../../lib/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const dynamicCount = await dynamicProductCount();
  const pages = Math.max(1, Math.ceil(dynamicCount / 44_900));
  const origin = getSiteUrl();
  const entries = Array.from(
    { length: pages },
    (_, page) =>
      "<sitemap><loc>" +
      origin +
      "/sitemaps/" +
      page +
      "</loc></sitemap>",
  ).join("");
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    entries +
    "</sitemapindex>";
  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
