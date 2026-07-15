CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`key_prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked` integer DEFAULT 0 NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer
);
