ALTER TYPE "source" ADD VALUE 'axelar-gateway';--> statement-breakpoint
ALTER TABLE "network_rpcs" ALTER COLUMN "network_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "network_rpcs" ALTER COLUMN "url" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "networks" ALTER COLUMN "chain_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "networks" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "networks" ADD COLUMN "axelar_gateway" char(42);