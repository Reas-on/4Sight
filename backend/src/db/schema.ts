import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid, integer, jsonb, unique, check } from 'drizzle-orm/pg-core';
import type { RunConfiguration } from '../application/simulation/contracts.js';
import type { NarrativeState } from '../domain/narrative/types.js';
import type { SimulationErrorInfo, SimulationEvaluation, SimulationRecord, SimulationStatus } from '../domain/simulation/types.js';

export const appMetadata = pgTable('app_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const simulationRuns = pgTable('simulation_runs', {
  id: uuid('id').primaryKey(),
  accessHash: text('access_hash').notNull(),
  scenarioId: text('scenario_id').notNull(),
  scenarioVersion: text('scenario_version').notNull(),
  providerId: text('provider_id').notNull(),
  modelId: text('model_id'),
  status: text('status').$type<SimulationStatus>().notNull(),
  evaluationOutcome: text('evaluation_outcome'),
  currentStateVersion: integer('current_state_version').notNull().default(0),
  currentStep: integer('current_step').notNull().default(0),
  revision: integer('revision').notNull().default(0),
  eventSequence: integer('event_sequence').notNull().default(0),
  configuration: jsonb('configuration_snapshot').$type<RunConfiguration>().notNull(),
  failure: jsonb('failure').$type<SimulationErrorInfo>(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (t) => [
  check('run_status_valid', sql`${t.status} in ('CREATED','RUNNING','PAUSED','COMPLETED','FAILED','CANCELLED')`),
  check('run_versions_valid', sql`${t.revision} >= 0 and ${t.currentStateVersion} >= 0 and ${t.currentStep} >= 0 and ${t.eventSequence} >= 0`),
]);

export const simulationSnapshots = pgTable('simulation_snapshots', {
  id: uuid('id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => simulationRuns.id),
  stateVersion: integer('state_version').notNull(),
  narrative: jsonb('narrative_state').$type<NarrativeState>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (t) => [unique('snapshot_run_version').on(t.runId, t.stateVersion)]);

export const simulationDecisions = pgTable('simulation_decisions', {
  id: uuid('id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => simulationRuns.id),
  stepSequence: integer('step_sequence').notNull(),
  providerId: text('provider_id').notNull(),
  modelId: text('model_id'),
  record: jsonb('execution_record').$type<SimulationRecord>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (t) => [unique('decision_run_step').on(t.runId, t.stepSequence)]);

export const simulationEvents = pgTable('simulation_events', {
  id: uuid('id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => simulationRuns.id),
  sequence: integer('sequence').notNull(),
  eventType: text('event_type').notNull(),
  storyletId: text('storylet_id'),
  nodeId: text('node_id'),
  stateVersion: integer('state_version').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (t) => [unique('event_run_sequence').on(t.runId, t.sequence)]);

export const simulationEvaluations = pgTable('simulation_evaluations', {
  runId: uuid('run_id').primaryKey().references(() => simulationRuns.id),
  evaluation: jsonb('evaluation').$type<SimulationEvaluation>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});
