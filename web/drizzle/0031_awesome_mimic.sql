ALTER TABLE `analytics_settings` ADD `campaigns` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_settings` ADD `utm_allowlist` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_settings` ADD `retention_days` integer DEFAULT 90 NOT NULL;