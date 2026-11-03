CREATE TABLE "simulation_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"step_sequence" integer NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text,
	"execution_record" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_run_step" UNIQUE("run_id","step_sequence")
);
--> statement-breakpoint
CREATE TABLE "simulation_evaluations" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"evaluation" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulation_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" text NOT NULL,
	"storylet_id" text,
	"node_id" text,
	"state_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_run_sequence" UNIQUE("run_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "simulation_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"access_hash" text NOT NULL,
	"scenario_id" text NOT NULL,
	"scenario_version" text NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text,
	"status" text NOT NULL,
	"evaluation_outcome" text,
	"current_state_version" integer DEFAULT 0 NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"event_sequence" integer DEFAULT 0 NOT NULL,
	"configuration_snapshot" jsonb NOT NULL,
	"failure" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_status_valid" CHECK ("simulation_runs"."status" in ('CREATED','RUNNING','PAUSED','COMPLETED','FAILED','CANCELLED')),
	CONSTRAINT "run_versions_valid" CHECK ("simulation_runs"."revision" >= 0 and "simulation_runs"."current_state_version" >= 0 and "simulation_runs"."current_step" >= 0 and "simulation_runs"."event_sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "simulation_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"state_version" integer NOT NULL,
	"narrative_state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_run_version" UNIQUE("run_id","state_version")
);
--> statement-breakpoint
ALTER TABLE "simulation_decisions" ADD CONSTRAINT "simulation_decisions_run_id_simulation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."simulation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_evaluations" ADD CONSTRAINT "simulation_evaluations_run_id_simulation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."simulation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_events" ADD CONSTRAINT "simulation_events_run_id_simulation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."simulation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_snapshots" ADD CONSTRAINT "simulation_snapshots_run_id_simulation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."simulation_runs"("id") ON DELETE no action ON UPDATE no action;