ALTER TABLE `candidates` ADD `source` text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE `candidates` ADD `email` text;--> statement-breakpoint
CREATE UNIQUE INDEX `candidates_job_email_unique` ON `candidates` (`job_id`,`email`) WHERE `email` is not null;--> statement-breakpoint
ALTER TABLE `jobs` ADD `slug` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `cover_key` text;--> statement-breakpoint
UPDATE `jobs` SET `slug` = 'job-' || lower(hex(randomblob(4))) WHERE `slug` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_slug_unique` ON `jobs` (`slug`);