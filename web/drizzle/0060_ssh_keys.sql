CREATE TABLE `ssh_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`public_key` text NOT NULL,
	`private_key_enc` text NOT NULL,
	`fingerprint` text NOT NULL,
	`external_id` text,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ssh_keys_project_kind_idx` ON `ssh_keys` (`project_id`,`kind`) WHERE "ssh_keys"."project_id" is not null and "ssh_keys"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX `ssh_keys_user_idx` ON `ssh_keys` (`user_id`);