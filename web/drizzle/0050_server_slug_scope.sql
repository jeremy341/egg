-- Old databases allowed two users to hold the same slug on one server. Before
-- the new per-server unique index can be created, the older duplicates are
-- renamed in place: the newest row keeps the real slug, each older row gets a
-- suffix. No project row is ever deleted. A renamed project provisions its
-- systemd unit under the new slug on its next deploy.
UPDATE `projects`
SET `slug` = substr(`slug`, 1, 29) || '-r-' || substr(`id`, 1, 8)
WHERE `id` IN (
  SELECT older.`id`
  FROM `projects` older
  JOIN `projects` newer
    ON `newer`.`id` <> `older`.`id`
   AND `newer`.`server_id` IS `older`.`server_id`
   AND `newer`.`slug` IS `older`.`slug`
   AND `newer`.`rowid` > `older`.`rowid`
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_server_slug_idx` ON `projects` (`server_id`,`slug`);