-- New servers start at 1024 MB of build memory. Servers still on the old 2048 MB value move down;
-- any other value was set by the owner and stays. The column default is not touched.
UPDATE `servers` SET `build_memory_mb` = 1024 WHERE `build_memory_mb` = 2048;
