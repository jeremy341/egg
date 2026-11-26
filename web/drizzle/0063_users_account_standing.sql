ALTER TABLE `users` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `suspended_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `grace_ends_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `suspension_reason` text;
