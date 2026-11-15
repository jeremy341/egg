ALTER TABLE `jobs` ADD `project_id` text;--> statement-breakpoint
-- Every existing job learns its project from its deployment.
UPDATE `jobs` SET `project_id` = (SELECT d.`project_id` FROM `deployments` d WHERE d.`id` = `jobs`.`deployment_id`) WHERE `project_id` IS NULL;--> statement-breakpoint
-- A database that already holds two running jobs for one project (the claim query should never allow it, but a
-- restored or hand-edited file might) must still accept the unique index. The job with the newest lock keeps its
-- project_id and so stays covered; the older ones lose it and are left running as they were. Nothing is ended or
-- deleted here: whether a leftover build still runs is for the operator recovery tool to decide. Ties fall to created_at, then id.
UPDATE `jobs` SET `project_id` = NULL
WHERE `state` = 'running' AND `project_id` IS NOT NULL AND EXISTS (
  SELECT 1 FROM `jobs` n WHERE n.`state` = 'running' AND n.`project_id` = `jobs`.`project_id` AND n.`id` <> `jobs`.`id` AND (
    COALESCE(n.`locked_at`, 0) > COALESCE(`jobs`.`locked_at`, 0)
    OR (COALESCE(n.`locked_at`, 0) = COALESCE(`jobs`.`locked_at`, 0) AND (
      n.`created_at` > `jobs`.`created_at` OR (n.`created_at` = `jobs`.`created_at` AND n.`id` > `jobs`.`id`)))
  )
);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_running_project_idx` ON `jobs` (`project_id`) WHERE "state" = 'running' and "project_id" is not null;
