CREATE TABLE `candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`job_id` text NOT NULL,
	`file_key` text NOT NULL,
	`file_name` text NOT NULL,
	`file_size` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`runs` integer DEFAULT 1 NOT NULL,
	`error` text,
	`name` text,
	`headline` text,
	`summary` text,
	`score` integer,
	`requirements` text,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`scored_at` integer,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `candidates_job_score_idx` ON `candidates` (`job_id`,`score`);--> statement-breakpoint
CREATE INDEX `candidates_org_idx` ON `candidates` (`org_id`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `cv_count` integer DEFAULT 0 NOT NULL;