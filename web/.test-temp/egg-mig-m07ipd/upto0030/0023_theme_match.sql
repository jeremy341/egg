ALTER TABLE `user_preferences` ADD `match_device` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `light_preset` text DEFAULT 'egg-light' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `dark_preset` text DEFAULT 'egg-dark' NOT NULL;