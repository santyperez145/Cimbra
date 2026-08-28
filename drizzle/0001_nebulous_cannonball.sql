CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`currency` text NOT NULL,
	`country` text NOT NULL,
	`account_reference` text NOT NULL,
	`balance` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_accounts_org_created` ON `accounts` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_accounts_customer` ON `accounts` (`customer_id`);--> statement-breakpoint
CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`account_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`product` text NOT NULL,
	`format` text NOT NULL,
	`last4` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cards_org_created` ON `cards` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_cards_account` ON `cards` (`account_id`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`country` text NOT NULL,
	`tax_id_last4` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_customers_org_created` ON `customers` (`organization_id`,`created_at`);