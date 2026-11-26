ALTER TABLE `deployments` ADD `listen_port` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `workload_kind` text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `deployment_mode` text DEFAULT 'native' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `listen_port` integer;--> statement-breakpoint
UPDATE `projects` SET `listen_port` = `port`;--> statement-breakpoint
UPDATE `deployments` SET `listen_port` = `port`;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_server_listen_port_idx` ON `projects` (`server_id`, `listen_port`) WHERE `listen_port` IS NOT NULL;
