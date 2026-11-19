ALTER TABLE `projects` ADD `build_upload_token_hash` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `build_upload_token_created_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_build_token_idx` ON `projects` (`build_upload_token_hash`);