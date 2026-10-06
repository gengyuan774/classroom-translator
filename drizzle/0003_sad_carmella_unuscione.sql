CREATE TABLE `account_passwords` (
	`username` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_passwords_account` ON `account_passwords` (`account_id`);