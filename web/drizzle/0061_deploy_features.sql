CREATE TABLE `registry_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`host` text NOT NULL,
	`username_enc` text NOT NULL,
	`password_enc` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registry_credentials_user_host_idx` ON `registry_credentials` (`user_id`,`host`);--> statement-breakpoint
ALTER TABLE `projects` ADD `deploy_strategy` text DEFAULT 'rolling' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `image_ref` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `pull_policy` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `registry_credential_id` text REFERENCES registry_credentials(id);--> statement-breakpoint
ALTER TABLE `projects` ADD `has_volumes` integer DEFAULT false NOT NULL;