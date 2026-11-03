ALTER TABLE "simulation_runs" ADD COLUMN "access_expires_at" timestamp with time zone DEFAULT now() + interval '7 days' NOT NULL;
--> statement-breakpoint
UPDATE "simulation_runs" SET "access_expires_at" = "created_at" + interval '7 days';
