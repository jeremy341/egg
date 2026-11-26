-- Old databases allowed two users to register the same Nest username on one
-- host. Before the new unique index can be created, the older duplicates get a
-- suffix: the newest row keeps the real login, older rows stay for inspection
-- but no longer claim the account. No server row is ever deleted.
UPDATE `servers`
SET `nest_username` = substr(`nest_username`, 1, 23) || '-r-' || substr(`id`, 1, 8)
WHERE `id` IN (
  SELECT older.`id`
  FROM `servers` older
  JOIN `servers` newer
    ON `newer`.`id` <> `older`.`id`
   AND `newer`.`host` IS `older`.`host`
   AND `newer`.`nest_username` IS `older`.`nest_username`
   AND `newer`.`rowid` > `older`.`rowid`
);
--> statement-breakpoint
CREATE UNIQUE INDEX `servers_nest_host_idx` ON `servers` (`host`,`nest_username`);