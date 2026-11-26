CREATE TABLE `cleanup_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`server_id` text NOT NULL,
	`opened_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cleanup_operations_server_idx` ON `cleanup_operations` (`server_id`,`opened_at`);--> statement-breakpoint
CREATE TABLE `instance_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`starts_at` integer,
	`ends_at` integer,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
DROP INDEX `cleanup_jobs_active_user_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `cleanup_jobs_active_account_idx` ON `cleanup_jobs` (`user_id`) WHERE "cleanup_jobs"."scope" = 'account' and "cleanup_jobs"."state" in ('draining', 'running', 'failed');--> statement-breakpoint
CREATE UNIQUE INDEX `cleanup_jobs_active_project_idx` ON `cleanup_jobs` (`user_id`,`project_id`) WHERE "cleanup_jobs"."scope" = 'project' and "cleanup_jobs"."state" in ('draining', 'running', 'failed');