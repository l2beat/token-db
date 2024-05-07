DO $$ BEGIN
 CREATE TYPE "source" AS ENUM('coingecko');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bridge_escrows" (
	"id" char(21) PRIMARY KEY NOT NULL,
	"token_id" char(21),
	"network_id" char(21),
	"address" char(42)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bridges" (
	"id" char(21) PRIMARY KEY NOT NULL,
	"name" varchar(256)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deployments" (
	"id" char(21) PRIMARY KEY NOT NULL,
	"token_id" char(21),
	"tx_hash" char(66),
	"block_number" integer,
	"timestamp" timestamp,
	"from" char(42),
	"to" char(42),
	"is_deployer_eoa" boolean,
	CONSTRAINT "deployments_token_id_unique" UNIQUE("token_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "network_rpcs" (
	"id" char(21) PRIMARY KEY NOT NULL,
	"network_id" char(21),
	"url" varchar(256)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "networks" (
	"id" char(21) PRIMARY KEY NOT NULL,
	"chain_id" integer,
	"name" varchar(256)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "token_bridges" (
	"id" char(21) PRIMARY KEY NOT NULL,
	"token_id" char(21),
	"source_token_id" char(21),
	"bridge_escrow_id" char(21),
	CONSTRAINT "token_bridges_token_id_unique" UNIQUE("token_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "token_metadatas" (
	"id" char(21) PRIMARY KEY NOT NULL,
	"token_id" char(21),
	"source" "source",
	"name" varchar(256),
	"symbol" varchar(16),
	"decimals" integer,
	"logo_url" varchar(256),
	"contract_name" varchar(256)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tokens" (
	"id" char(21) PRIMARY KEY NOT NULL,
	"network_id" char(21),
	"address" char(42)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bridge_escrows" ADD CONSTRAINT "bridge_escrows_token_id_bridges_id_fk" FOREIGN KEY ("token_id") REFERENCES "bridges"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bridge_escrows" ADD CONSTRAINT "bridge_escrows_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "networks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deployments" ADD CONSTRAINT "deployments_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "network_rpcs" ADD CONSTRAINT "network_rpcs_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "networks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "token_bridges" ADD CONSTRAINT "token_bridges_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "token_bridges" ADD CONSTRAINT "token_bridges_source_token_id_tokens_id_fk" FOREIGN KEY ("source_token_id") REFERENCES "tokens"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "token_bridges" ADD CONSTRAINT "token_bridges_bridge_escrow_id_bridge_escrows_id_fk" FOREIGN KEY ("bridge_escrow_id") REFERENCES "bridge_escrows"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "token_metadatas" ADD CONSTRAINT "token_metadatas_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tokens" ADD CONSTRAINT "tokens_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "networks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
