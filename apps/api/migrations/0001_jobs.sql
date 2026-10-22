CREATE TABLE `ai_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text,
	`job_id` text,
	`operation` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`ok` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_usage_org_created_idx` ON `ai_usage` (`org_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jobs_org_created_idx` ON `jobs` (`org_id`,`created_at`);