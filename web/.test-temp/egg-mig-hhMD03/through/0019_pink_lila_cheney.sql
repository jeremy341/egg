CREATE TABLE `security_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`payload_enc` text NOT NULL,
	`stored_bytes` integer NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `security_reports_created_idx` ON `security_reports` (`created_at`);