CREATE TABLE `crash_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
	`release_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`reason` text NOT NULL,
	`captured_lines` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `crash_reports_project_created_idx` ON `crash_reports` (`project_id`,`created_at`,`id`);
