export type ProductSource = "seed" | "generated" | "catalog";

export type Product = {
  id: string;
  slug: string;
  name: string;
  category: string;
  audience: string;
  problem: string;
  promise: string;
  differentiator: string;
  workflow: string[];
  keywords: string[];
  metrics: string[];
  source: ProductSource;
  createdAt: string;
  originQuery?: string;
  intentKey?: string;
};

export type ProductSearchResult = Pick<
  Product,
  | "slug"
  | "name"
  | "category"
  | "audience"
  | "problem"
  | "promise"
  | "source"
> & {
  score: number;
  generated?: boolean;
};

export type GeneratedProductDraft = Pick<
  Product,
  | "name"
  | "category"
  | "audience"
  | "problem"
  | "promise"
  | "differentiator"
  | "workflow"
  | "keywords"
  | "metrics"
>;
