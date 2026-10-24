ALTER TABLE `candidates` ADD `evidence` text;--> statement-breakpoint
ALTER TABLE `candidates` ADD `check_state` text;--> statement-breakpoint
ALTER TABLE `candidates` ADD `check_ids` text;--> statement-breakpoint
CREATE INDEX `candidates_check_updated_idx` ON `candidates` (`check_state`,`updated_at`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `rubric` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `rubric_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `rubric_version` integer DEFAULT 0 NOT NULL;