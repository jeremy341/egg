CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`accent` text DEFAULT 'default' NOT NULL,
	`density` text DEFAULT 'comfortable' NOT NULL,
	`reduced_motion` text DEFAULT 'system' NOT NULL,
	`default_branch` text,
	`display_name` text,
	`avatar` text DEFAULT 'pixel-01' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Before the unique indexes: end any older active duplicates, keeping the newest of each group.
UPDATE `jobs` SET `state` = 'failed', `error` = 'Superseded by a newer duplicate'
WHERE `state` IN ('queued', 'running') AND `deployment_id` IN (
  SELECT d.`id` FROM `deployments` d WHERE d.`state` IN ('queued', 'building', 'deploying') AND (
    (d.`source` = 'webhook' AND d.`commit_sha` IS NOT NULL AND EXISTS (
      SELECT 1 FROM `deployments` n WHERE n.`project_id` = d.`project_id` AND n.`branch` = d.`branch`
        AND n.`commit_sha` = d.`commit_sha` AND n.`source` = 'webhook'
        AND n.`state` IN ('queued', 'building', 'deploying')
        AND (n.`created_at` > d.`created_at` OR (n.`created_at` = d.`created_at` AND n.`id` > d.`id`))))
    OR
    (d.`source` = 'hook' AND EXISTS (
      SELECT 1 FROM `deployments` n WHERE n.`project_id` = d.`project_id` AND n.`source` = 'hook'
        AND n.`state` IN ('queued', 'building', 'deploying')
        AND (n.`created_at` > d.`created_at` OR (n.`created_at` = d.`created_at` AND n.`id` > d.`id`))))
  )
);
--> statement-breakpoint
UPDATE `deployments` SET `state` = 'canceled', `error` = 'Superseded by a newer duplicate', `finished_at` = `created_at`
WHERE `state` IN ('queued', 'building', 'deploying') AND (
  (`source` = 'webhook' AND `commit_sha` IS NOT NULL AND EXISTS (
    SELECT 1 FROM `deployments` n WHERE n.`project_id` = `deployments`.`project_id` AND n.`branch` = `deployments`.`branch`
      AND n.`commit_sha` = `deployments`.`commit_sha` AND n.`source` = 'webhook'
      AND n.`state` IN ('queued', 'building', 'deploying')
      AND (n.`created_at` > `deployments`.`created_at` OR (n.`created_at` = `deployments`.`created_at` AND n.`id` > `deployments`.`id`))))
  OR
  (`source` = 'hook' AND EXISTS (
    SELECT 1 FROM `deployments` n WHERE n.`project_id` = `deployments`.`project_id` AND n.`source` = 'hook'
      AND n.`state` IN ('queued', 'building', 'deploying')
      AND (n.`created_at` > `deployments`.`created_at` OR (n.`created_at` = `deployments`.`created_at` AND n.`id` > `deployments`.`id`))))
);
--> statement-breakpoint
-- A deployment should never have two live jobs; keep the newest.
UPDATE `jobs` SET `state` = 'failed', `error` = 'Superseded by a newer duplicate'
WHERE `state` IN ('queued', 'running') AND EXISTS (
  SELECT 1 FROM `jobs` n WHERE n.`deployment_id` = `jobs`.`deployment_id` AND n.`state` IN ('queued', 'running')
    AND (n.`created_at` > `jobs`.`created_at` OR (n.`created_at` = `jobs`.`created_at` AND n.`id` > `jobs`.`id`))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deployments_active_webhook_commit_idx` ON `deployments` (`project_id`,`branch`,`commit_sha`) WHERE "source" = 'webhook' and "commit_sha" is not null and "state" in ('queued', 'building', 'deploying');--> statement-breakpoint
CREATE UNIQUE INDEX `deployments_active_hook_idx` ON `deployments` (`project_id`) WHERE "source" = 'hook' and "state" in ('queued', 'building', 'deploying');--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_active_deployment_idx` ON `jobs` (`deployment_id`) WHERE "state" in ('queued', 'running');
