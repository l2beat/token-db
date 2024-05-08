ALTER TABLE "token_metadatas" ALTER COLUMN "token_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "token_metadatas" ALTER COLUMN "source" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tokens" ALTER COLUMN "network_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tokens" ALTER COLUMN "address" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "token_metadatas" ADD COLUMN "external_id" varchar(256) NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_source_external_id" ON "token_metadatas" ("source","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_network_address" ON "tokens" ("network_id","address");