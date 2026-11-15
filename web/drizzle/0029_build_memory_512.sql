-- New servers start at 512 MB of build memory; a project with a build step gets at least 1024 MB
-- while it builds, applied in the build code. Servers still on the old 1024 MB default move down;
-- any other value was set by the owner and stays. The column default is not touched.
UPDATE `servers` SET `build_memory_mb` = 512 WHERE `build_memory_mb` = 1024;
