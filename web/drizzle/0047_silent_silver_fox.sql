CREATE TABLE `provider_webhook_deliveries` (
	`project_id` text NOT NULL,
	`delivery_id` text NOT NULL,
	`received_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_webhook_delivery_project_id_idx` ON `provider_webhook_deliveries` (`project_id`,`delivery_id`);