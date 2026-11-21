CREATE TABLE `analytics_errors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`at` integer NOT NULL,
	`message` text NOT NULL,
	`file` text,
	`line` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `analytics_errors_project_at_idx` ON `analytics_errors` (`project_id`,`at`);--> statement-breakpoint
CREATE TABLE `analytics_live` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`at` integer NOT NULL,
	`vid` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `analytics_live_project_at_idx` ON `analytics_live` (`project_id`,`at`);--> statement-breakpoint
CREATE TABLE `analytics_vitals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`at` integer NOT NULL,
	`path` text NOT NULL,
	`lcp` integer,
	`cls` real,
	`inp` integer,
	`fcp` integer,
	`ttfb` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `analytics_vitals_project_at_idx` ON `analytics_vitals` (`project_id`,`at`);--> statement-breakpoint
ALTER TABLE `analytics_events` ADD `value` text;--> statement-breakpoint
ALTER TABLE `analytics_settings` ADD `referrers` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_settings` ADD `vitals` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_settings` ADD `events` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_settings` ADD `live` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_settings` ADD `retention` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `pageviews` ADD `utm_source` text;--> statement-breakpoint
ALTER TABLE `pageviews` ADD `utm_medium` text;--> statement-breakpoint
ALTER TABLE `pageviews` ADD `utm_campaign` text;--> statement-breakpoint
ALTER TABLE `pageviews` ADD `vid` text;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `analytics_defaults` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
-- Referring sites used to be recorded for every project with analytics on. Referrers are
-- now a switch that starts off, so a project that is counting visits today keeps recording
-- them. Nothing else about an existing project changes, and no row is removed.
INSERT INTO `analytics_settings` (`project_id`, `referrers`, `updated_at`)
SELECT `id`, 1, CAST(strftime('%s', 'now') AS integer) * 1000 FROM `projects` WHERE `analytics_key` IS NOT NULL
ON CONFLICT(`project_id`) DO UPDATE SET `referrers` = 1;
