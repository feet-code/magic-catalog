import { catalogDirectoryCount } from "../../lib/catalog-directory";
import { catalogProductCount } from "../../lib/catalog-sitemap";
import { getSiteUrl } from "../../lib/runtime";

export const dynamic = "force-dynamic";
const DIRECTORY_PAGE_SIZE = 250;

export async function GET() {
  const [productCount, directoryCount] = await Promise.all([
    catalogProductCount(),
    catalogDirectoryCount(),
  ]);
  const productPages = Math.max(1, Math.ceil(productCount / 44_900));
  const directoryPages = Math.max(1, Math.ceil(directoryCount / DIRECTORY_PAGE_SIZE));
  const origin = getSiteUrl();
  const entries = Array.from(
    { length: productPages },
    (_, page) =>
      "<sitemap><loc>" +
      origin +
      "/sitemaps/" +
      page +
      "</loc></sitemap>",
  ).concat([
    "<sitemap><loc>" + origin + "/catalog</loc></sitemap>",
    ...Array.from(
      { length: Math.max(0, directoryPages - 1) },
      (_, page) =>
        "<sitemap><loc>" +
        origin +
        "/catalog/" +
        (page + 1) +
        "</loc></sitemap>",
    ),
  ]).join("");
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
