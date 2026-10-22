CREATE TABLE `invites` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_by` text,
	`accepted_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invites_org_idx` ON `invites` (`org_id`);--> statement-breakpoint
CREATE TABLE `usage_counters` (
	`org_id` text NOT NULL,
	`metric` text NOT NULL,
	`period` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`org_id`, `metric`, `period`),
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`received_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `organizations` ADD `plan` text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE `organizations` ADD `polar_customer_id` text;--> statement-breakpoint
ALTER TABLE `organizations` ADD `polar_subscription_id` text;--> statement-breakpoint
ALTER TABLE `organizations` ADD `subscription_status` text;--> statement-breakpoint
ALTER TABLE `organizations` ADD `current_period_end` integer;--> statement-breakpoint
ALTER TABLE `organizations` ADD `cancel_at_period_end` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `organizations` ADD `subscription_updated_at` integer;--> statement-breakpoint
INSERT INTO `usage_counters` (`org_id`, `metric`, `period`, `count`)
SELECT `org_id`, 'jobs_month', strftime('%Y-%m', 'now'), count(*)
FROM `jobs`
WHERE `created_at` >= CAST(strftime('%s', strftime('%Y-%m-01', 'now')) AS INTEGER) * 1000
GROUP BY `org_id`;
