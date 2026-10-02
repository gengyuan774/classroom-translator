CREATE TABLE `account_classes` (
	`account_id` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	`status` text NOT NULL,
	`segment_count` integer NOT NULL,
	`demo` integer NOT NULL,
	`object_key` text NOT NULL,
	`revision` integer NOT NULL,
	PRIMARY KEY(`account_id`, `id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `account_classes_history` ON `account_classes` (`account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `account_materials` (
	`account_id` text NOT NULL,
	`class_id` text NOT NULL,
	`id` text NOT NULL,
	`object_key` text NOT NULL,
	PRIMARY KEY(`account_id`, `class_id`, `id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `account_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `account_sessions_expiry` ON `account_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`subject_hash` text NOT NULL,
	`label` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_identity` ON `accounts` (`provider`,`subject_hash`);