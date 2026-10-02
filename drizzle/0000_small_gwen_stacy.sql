CREATE TABLE `member_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`code_version` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `member_sessions_expiry` ON `member_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `usage_buckets` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `usage_buckets_expiry` ON `usage_buckets` (`expires_at`);