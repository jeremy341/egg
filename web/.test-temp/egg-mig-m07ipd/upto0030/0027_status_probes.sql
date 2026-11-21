CREATE TABLE `status_probes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target` text NOT NULL,
	`checked_at` integer NOT NULL,
	`ok` integer NOT NULL,
	`http_status` integer,
	`latency_ms` integer
);
--> statement-breakpoint
CREATE INDEX `status_probes_target_at_idx` ON `status_probes` (`target`,`checked_at`);