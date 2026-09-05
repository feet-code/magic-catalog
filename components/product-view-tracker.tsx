"use client";

import { useEffect } from "react";
import { captureEvent } from "../lib/analytics-client";

export function ProductViewTracker({
  slug,
  source,
  category,
}: {
  slug: string;
  source: string;
  category: string;
}) {
  useEffect(() => {
    captureEvent("product_viewed", {
      product_slug: slug,
      product_source: source,
      category,
    });
  }, [category, slug, source]);
  return null;
}
