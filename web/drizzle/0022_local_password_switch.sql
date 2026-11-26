ALTER TABLE `local_auth_credentials` ADD `user_id` text REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `local_auth_credentials` ADD `recovery_key_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `local_auth_credentials_user_idx` ON `local_auth_credentials` (`user_id`);