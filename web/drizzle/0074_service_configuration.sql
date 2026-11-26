ALTER TABLE `projects` ADD `service_ports` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `internal_domain` text;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_server_internal_domain_idx` ON `projects` (`server_id`,`internal_domain`) WHERE `internal_domain` is not null;
