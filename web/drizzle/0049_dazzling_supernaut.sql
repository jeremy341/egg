ALTER TABLE `projects` ADD `dockerfile_path` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `compose_file_path` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `compose_service` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `container_port` integer;