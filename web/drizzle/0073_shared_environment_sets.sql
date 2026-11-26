CREATE TABLE `shared_env_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_env_sets_user_name_idx` ON `shared_env_sets` (`user_id`,`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_env_sets_default_user_idx` ON `shared_env_sets` (`user_id`) WHERE `is_default` = 1;
--> statement-breakpoint
CREATE TABLE `shared_env_vars` (
	`id` text PRIMARY KEY NOT NULL,
	`set_id` text NOT NULL,
	`key` text NOT NULL,
	`value_enc` text NOT NULL,
	`target` text DEFAULT 'all' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `shared_env_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_env_vars_set_key_idx` ON `shared_env_vars` (`set_id`,`key`,`target`);
