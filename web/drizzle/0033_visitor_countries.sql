ALTER TABLE `analytics_settings` ADD `locations` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `pageviews` ADD `country` text;