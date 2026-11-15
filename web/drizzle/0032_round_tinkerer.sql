CREATE TABLE `build_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`scope` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `build_credentials_token_hash_unique` ON `build_credentials` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `build_credentials_project_scope_idx` ON `build_credentials` (`project_id`,`scope`);--> statement-breakpoint
CREATE INDEX `build_credentials_expiry_idx` ON `build_credentials` (`expires_at`);