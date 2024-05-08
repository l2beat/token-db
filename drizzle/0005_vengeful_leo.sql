DROP INDEX IF EXISTS "unique_source_external_id";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_token_id_source" ON "token_metadatas" ("token_id","source");