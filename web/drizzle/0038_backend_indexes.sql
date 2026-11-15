DROP INDEX `deployments_project_idx`;--> statement-breakpoint
CREATE INDEX `deployments_project_idx` ON `deployments` (`project_id`,`created_at`,`id`);