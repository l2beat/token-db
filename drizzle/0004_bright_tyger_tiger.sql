DROP INDEX IF EXISTS "unique_source_external_id";--> statement-breakpoint
ALTER TABLE "token_metadatas" ALTER COLUMN "external_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "token_metadatas" ALTER COLUMN "source" SET DATA TYPE varchar(256);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_token_id_source" ON "token_metadatas" ("token_id","source");