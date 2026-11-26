CREATE TABLE `oauth_refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`scopes` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_refresh_tokens_token_hash_unique` ON `oauth_refresh_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_tokens_family_idx` ON `oauth_refresh_tokens` (`family_id`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_tokens_user_idx` ON `oauth_refresh_tokens` (`user_id`);--> statement-breakpoint
ALTER TABLE `oauth_tokens` ADD `family_id` text;--> statement-breakpoint
CREATE INDEX `oauth_tokens_family_idx` ON `oauth_tokens` (`family_id`);