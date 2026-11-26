CREATE TABLE `graft_installations` (
	`graft_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`changed_by` text,
	`changed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `graft_announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`published_at` integer,
	`expires_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `graft_announcements_feed_idx` ON `graft_announcements` (`status`,`pinned`,`published_at`);
--> statement-breakpoint
CREATE TABLE `graft_announcement_dismissals` (
	`announcement_id` text NOT NULL,
	`user_id` text NOT NULL,
	`dismissed_at` integer NOT NULL,
	PRIMARY KEY(`announcement_id`, `user_id`),
	FOREIGN KEY (`announcement_id`) REFERENCES `graft_announcements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `graft_announcement_dismissals_user_idx` ON `graft_announcement_dismissals` (`user_id`);
--> statement-breakpoint
CREATE TABLE `graft_forum_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`author_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `graft_forum_threads_feed_idx` ON `graft_forum_threads` (`pinned`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `graft_forum_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `graft_forum_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `graft_forum_replies_thread_idx` ON `graft_forum_replies` (`thread_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `graft_forum_votes` (
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`thread_id`, `user_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `graft_forum_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `graft_forum_votes_user_idx` ON `graft_forum_votes` (`user_id`);
--> statement-breakpoint
CREATE TABLE `graft_greenhouse_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`goal` text NOT NULL,
	`branch` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `graft_greenhouse_user_idx` ON `graft_greenhouse_workspaces` (`user_id`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `graft_greenhouse_project_idx` ON `graft_greenhouse_workspaces` (`project_id`);
--> statement-breakpoint
CREATE TABLE `graft_greenhouse_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `graft_greenhouse_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `graft_greenhouse_notes_workspace_idx` ON `graft_greenhouse_notes` (`workspace_id`,`created_at`);
