CREATE TABLE `account_memberships` (
	`account_id` text PRIMARY KEY NOT NULL,
	`tier` text NOT NULL,
	`expires_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `member_redemptions` (
	`account_id` text NOT NULL,
	`code_version` text NOT NULL,
	`redeemed_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `code_version`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `phone_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`phone_e164` text NOT NULL,
	`verification_sid` text NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `phone_challenges_expiry` ON `phone_challenges` (`expires_at`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `phone_e164` text;