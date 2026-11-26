CREATE TABLE `idempotency_keys` (
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`claim_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`state` text NOT NULL,
	`status` integer,
	`body` text DEFAULT '' NOT NULL,
	`headers` text DEFAULT '[]' NOT NULL,
	`sensitive` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `key`)
);
--> statement-breakpoint
CREATE INDEX `idempotency_keys_expires_idx` ON `idempotency_keys` (`expires_at`);