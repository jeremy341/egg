CREATE TABLE `project_statistics` (
	`project_id` text PRIMARY KEY NOT NULL,
	`deploy_count` integer DEFAULT false NOT NULL,
	`deploy_success` integer DEFAULT false NOT NULL,
	`build_time` integer DEFAULT false NOT NULL,
	`visitors` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pull_request_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`action` text NOT NULL,
	`number` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pull_request_events_project_idx` ON `pull_request_events` (`project_id`,`created_at`);
--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `show_name_public` integer DEFAULT true NOT NULL;
