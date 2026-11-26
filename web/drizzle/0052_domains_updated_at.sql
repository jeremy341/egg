ALTER TABLE `domains` ADD `updated_at` integer NOT NULL DEFAULT 0;--> statement-breakpoint
UPDATE `domains` SET `updated_at` = `created_at`;