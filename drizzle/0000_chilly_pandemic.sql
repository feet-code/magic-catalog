CREATE TABLE `product_terms` (
	`product_slug` text NOT NULL,
	`term` text NOT NULL,
	`weight` integer NOT NULL,
	PRIMARY KEY(`product_slug`, `term`)
);
--> statement-breakpoint
CREATE INDEX `idx_product_terms_term_weight` ON `product_terms` (`term`,`weight`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`audience` text NOT NULL,
	`problem` text NOT NULL,
	`promise` text NOT NULL,
	`differentiator` text NOT NULL,
	`workflow_json` text NOT NULL,
	`keywords_json` text NOT NULL,
	`metrics_json` text NOT NULL,
	`source` text NOT NULL,
	`origin_query` text,
	`query_hash` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_products_slug` ON `products` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_products_query_hash` ON `products` (`query_hash`);--> statement-breakpoint
CREATE INDEX `idx_products_created_at` ON `products` (`created_at`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`action` text NOT NULL,
	`bucket` text NOT NULL,
	`identity_hash` text NOT NULL,
	`count` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`action`, `bucket`, `identity_hash`)
);
--> statement-breakpoint
CREATE TABLE `signups` (
	`id` text PRIMARY KEY NOT NULL,
	`product_slug` text NOT NULL,
	`email` text NOT NULL,
	`email_hash` text NOT NULL,
	`source_query` text,
	`ip_hash` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_signups_product_email` ON `signups` (`product_slug`,`email_hash`);--> statement-breakpoint
CREATE INDEX `idx_signups_product_created` ON `signups` (`product_slug`,`created_at`);--> statement-breakpoint
PRAGMA optimize;
