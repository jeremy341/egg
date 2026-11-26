CREATE TABLE `alert_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`metric` text NOT NULL,
	`comparison` text NOT NULL,
	`threshold` real NOT NULL,
	`duration_minutes` integer NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`breach_since` integer,
	`recover_since` integer,
	`last_value` real,
	`evaluated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `alert_rules_project_idx` ON `alert_rules` (`project_id`);--> statement-breakpoint
CREATE TABLE `project_trash` (
	`project_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`server_id` text NOT NULL,
	`payload` text NOT NULL,
	`deleted_at` integer NOT NULL,
	`purge_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_trash_user_idx` ON `project_trash` (`user_id`);--> statement-breakpoint
CREATE INDEX `project_trash_purge_idx` ON `project_trash` (`purge_at`);--> statement-breakpoint
ALTER TABLE `deployments` ADD `post_deploy_check` text;--> statement-breakpoint
ALTER TABLE `deployments` ADD `post_deploy_checked_at` integer;--> statement-breakpoint
ALTER TABLE `project_samples` ADD `health_ms` integer;--> statement-breakpoint
ALTER TABLE `project_samples` ADD `health_ok` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `deletion_protected` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `last_exit_result` text;