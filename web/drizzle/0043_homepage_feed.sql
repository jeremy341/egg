-- Off for every project. A project is listed on the Egg homepage only when its owner turns this on.
ALTER TABLE `projects` ADD `homepage_feed` integer DEFAULT 0 NOT NULL;
