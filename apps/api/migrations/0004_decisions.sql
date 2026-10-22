ALTER TABLE `candidates` ADD `decision` text DEFAULT 'undecided' NOT NULL;--> statement-breakpoint
ALTER TABLE `candidates` ADD `note` text;--> statement-breakpoint
ALTER TABLE `candidates` ADD `decided_at` integer;--> statement-breakpoint
ALTER TABLE `candidates` ADD `decided_by` text;