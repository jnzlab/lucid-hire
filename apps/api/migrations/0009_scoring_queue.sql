ALTER TABLE `candidates` ADD `queue_priority_at` integer;--> statement-breakpoint
CREATE INDEX `candidates_status_updated_idx` ON `candidates` (`status`,`updated_at`);