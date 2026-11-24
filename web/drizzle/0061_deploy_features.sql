ALTER TABLE `projects` ADD `deploy_strategy` text DEFAULT 'rolling' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `has_volumes` integer DEFAULT false NOT NULL;