CREATE TABLE `deploy_hook_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deploy_hook_tokens_hash_idx` ON `deploy_hook_tokens` (`hash`);
--> statement-breakpoint
CREATE INDEX `deploy_hook_tokens_project_created_idx` ON `deploy_hook_tokens` (`project_id`,`created_at`);
