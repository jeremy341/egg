CREATE TABLE `cleanup_items` (
	`id` text PRIMARY KEY NOT NULL,
	`cleanup_job_id` text NOT NULL,
	`project_id` text NOT NULL,
	`server_id` text NOT NULL,
	`project_name` text NOT NULL,
	`project_slug` text NOT NULL,
	`server_label` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`step` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`warnings` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`cleanup_job_id`) REFERENCES `cleanup_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cleanup_items_job_idx` ON `cleanup_items` (`cleanup_job_id`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `cleanup_items_job_project_idx` ON `cleanup_items` (`cleanup_job_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `cleanup_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`scope` text NOT NULL,
	`project_id` text,
	`state` text DEFAULT 'draining' NOT NULL,
	`requested_at` integer NOT NULL,
	`not_before` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`step` text DEFAULT 'draining' NOT NULL,
	`lease_owner` text,
	`lease_until` integer,
	`error` text,
	`warnings` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cleanup_jobs_queue_idx` ON `cleanup_jobs` (`state`,`not_before`);--> statement-breakpoint
CREATE UNIQUE INDEX `cleanup_jobs_active_user_idx` ON `cleanup_jobs` (`user_id`) WHERE "cleanup_jobs"."state" in ('draining', 'running', 'failed');