ALTER TABLE `projects` ADD `source_provider` text DEFAULT 'github' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `provider_connection_id` text REFERENCES provider_connections(id);--> statement-breakpoint
ALTER TABLE `projects` ADD `provider_webhook_secret_enc` text;