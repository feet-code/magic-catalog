CREATE TABLE IF NOT EXISTS `intent_clusters` (
  `intent_key` text PRIMARY KEY NOT NULL,
  `label` text NOT NULL,
  `search_text` text NOT NULL,
  `product_count` integer NOT NULL DEFAULT 0,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_intent_clusters_product_count` ON `intent_clusters` (`product_count` DESC);
--> statement-breakpoint
PRAGMA optimize;
