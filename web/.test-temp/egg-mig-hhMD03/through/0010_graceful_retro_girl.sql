CREATE TABLE `analytics_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`day` text NOT NULL,
	`kind` text NOT NULL,
	`label` text,
	`bucket` text,
	`visitor` text,
	`at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `analytics_events_project_day_idx` ON `analytics_events` (`project_id`,`day`,`kind`);--> statement-breakpoint
CREATE TABLE `analytics_settings` (
	`project_id` text PRIMARY KEY NOT NULL,
	`clicks` integer DEFAULT false NOT NULL,
	`time` integer DEFAULT false NOT NULL,
	`funnel` integer DEFAULT false NOT NULL,
	`funnel_steps` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`nest_username` text NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 22 NOT NULL,
	`public_key` text NOT NULL,
	`private_key_enc` text NOT NULL,
	`key_fingerprint` text NOT NULL,
	`host_key_fingerprint` text,
	`allow_terminal` integer DEFAULT false NOT NULL,
	`allow_file_writes` integer DEFAULT false NOT NULL,
	`allow_orphan_removal` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_error` text,
	`probe` text,
	`last_checked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_servers`("id", "user_id", "nest_username", "host", "port", "public_key", "private_key_enc", "key_fingerprint", "host_key_fingerprint", "allow_terminal", "allow_file_writes", "allow_orphan_removal", "status", "last_error", "probe", "last_checked_at", "created_at") SELECT "id", "user_id", "nest_username", "host", "port", "public_key", "private_key_enc", "key_fingerprint", "host_key_fingerprint", "allow_terminal", "allow_file_writes", "allow_orphan_removal", "status", "last_error", "probe", "last_checked_at", "created_at" FROM `servers`;--> statement-breakpoint
DROP TABLE `servers`;--> statement-breakpoint
ALTER TABLE `__new_servers` RENAME TO `servers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `servers_user_nest_idx` ON `servers` (`user_id`,`nest_username`);