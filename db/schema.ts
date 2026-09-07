import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    audience: text("audience").notNull(),
    problem: text("problem").notNull(),
    promise: text("promise").notNull(),
    differentiator: text("differentiator").notNull(),
    workflowJson: text("workflow_json").notNull(),
    keywordsJson: text("keywords_json").notNull(),
    metricsJson: text("metrics_json").notNull(),
    source: text("source").notNull(),
    originQuery: text("origin_query"),
    queryHash: text("query_hash"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_products_slug").on(table.slug),
    uniqueIndex("idx_products_query_hash").on(table.queryHash),
    index("idx_products_created_at").on(table.createdAt),
  ],
);

export const productTerms = sqliteTable(
  "product_terms",
  {
    productSlug: text("product_slug").notNull(),
    term: text("term").notNull(),
    weight: integer("weight").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.productSlug, table.term] }),
    index("idx_product_terms_term_weight").on(table.term, table.weight),
  ],
);

export const productImports = sqliteTable(
  "product_imports",
  {
    provider: text("provider").notNull(),
    externalIdHash: text("external_id_hash").notNull(),
    productSlug: text("product_slug").notNull(),
    sourceUrlHash: text("source_url_hash").notNull(),
    sourceWebsiteUrlHash: text("source_website_url_hash"),
    sourceNameHash: text("source_name_hash").notNull(),
    sourceContentHash: text("source_content_hash").notNull(),
    generationModel: text("generation_model").notNull(),
    importedAt: text("imported_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.externalIdHash] }),
    uniqueIndex("idx_product_imports_product_slug").on(table.productSlug),
    index("idx_product_imports_source_url_hash").on(
      table.provider,
      table.sourceUrlHash,
    ),
    index("idx_product_imports_content_hash").on(
      table.provider,
      table.sourceContentHash,
    ),
    index("idx_product_imports_imported_at").on(table.importedAt),
  ],
);

export const signups = sqliteTable(
  "signups",
  {
    id: text("id").primaryKey(),
    productSlug: text("product_slug").notNull(),
    email: text("email").notNull(),
    emailHash: text("email_hash").notNull(),
    sourceQuery: text("source_query"),
    ipHash: text("ip_hash"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_signups_product_email").on(
      table.productSlug,
      table.emailHash,
    ),
    index("idx_signups_product_created").on(
      table.productSlug,
      table.createdAt,
    ),
  ],
);

export const rateLimits = sqliteTable(
  "rate_limits",
  {
    action: text("action").notNull(),
    bucket: text("bucket").notNull(),
    identityHash: text("identity_hash").notNull(),
    count: integer("count").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.action, table.bucket, table.identityHash],
    }),
  ],
);
