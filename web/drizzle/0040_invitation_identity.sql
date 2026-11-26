ALTER TABLE `project_invitations` ADD `invited_user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified` integer DEFAULT false NOT NULL;