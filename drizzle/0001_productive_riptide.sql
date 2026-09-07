CREATE TABLE `product_imports` (
	`provider` text NOT NULL,
	`external_id_hash` text NOT NULL,
	`product_slug` text NOT NULL,
	`source_url_hash` text NOT NULL,
	`source_website_url_hash` text,
	`source_name_hash` text NOT NULL,
	`source_content_hash` text NOT NULL,
	`generation_model` text NOT NULL,
	`imported_at` text NOT NULL,
	PRIMARY KEY(`provider`, `external_id_hash`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_imports_product_slug` ON `product_imports` (`product_slug`);--> statement-breakpoint
CREATE INDEX `idx_product_imports_source_url_hash` ON `product_imports` (`provider`,`source_url_hash`);--> statement-breakpoint
CREATE INDEX `idx_product_imports_content_hash` ON `product_imports` (`provider`,`source_content_hash`);--> statement-breakpoint
CREATE INDEX `idx_product_imports_imported_at` ON `product_imports` (`imported_at`);