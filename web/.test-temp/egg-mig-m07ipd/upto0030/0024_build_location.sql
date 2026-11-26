ALTER TABLE `projects` ADD `build_location` text DEFAULT 'container' NOT NULL;--> statement-breakpoint
-- Projects that exist now keep building centrally until their owner changes it.
UPDATE `projects` SET `build_location` = 'central';--> statement-breakpoint
ALTER TABLE `servers` ADD `build_lock_holder` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `build_lock_at` integer;
