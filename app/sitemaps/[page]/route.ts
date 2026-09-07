import { catalogSitemapRows } from "../../../lib/catalog-sitemap";
import { seedProducts } from "../../../lib/seed-products";
import { getSiteUrl } from "../../../lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ page: string }> },
) {
  const raw = (await context.params).page;
  if (!/^\d+$/.test(raw)) return new Response("Not found", { status: 404 });
  const page = Number(raw);
  const dynamicRows = await catalogSitemapRows(page, 44_900);
  const origin = getSiteUrl();
  const staticRows =
    page === 0
      ? [
          { slug: "", createdAt: "2026-09-05T00:00:00.000Z" },
          ...seedProducts.map((product) => ({
            slug: "product/" + product.slug,
            createdAt: product.createdAt,
          })),
        ]
      : [];
  const rows = [
    ...staticRows,
    ...dynamicRows.map((row) => ({
      slug: "product/" + row.slug,
      createdAt: row.createdAt,
    })),
  ];
  if (!rows.length) return new Response("Not found", { status: 404 });

  const urls = rows
    .map(
      (row) =>
        "<url><loc>" +
        origin +
        "/" +
        row.slug +
        "</loc><lastmod>" +
        row.createdAt.slice(0, 10) +
        "</lastmod></url>",
    )
    .join("");
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    urls +
    "</urlset>";
  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
