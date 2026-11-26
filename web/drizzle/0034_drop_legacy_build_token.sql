DROP INDEX `projects_build_token_idx`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `build_upload_token_hash`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `build_upload_token_created_at`;