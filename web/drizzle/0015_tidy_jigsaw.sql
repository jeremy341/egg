CREATE TABLE `github_webhook_events` (
	`body_hash` text PRIMARY KEY NOT NULL,
	`received_at` integer NOT NULL
);
