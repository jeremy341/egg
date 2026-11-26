-- Builds only run on the Nest container now. Projects that were set to build on Egg's machine move over.
UPDATE `projects` SET `build_location` = 'container' WHERE `build_location` = 'central';
