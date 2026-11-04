import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../app.js';
import { loadEnv } from '../../../config/env.js';
import { branchScenario } from '../../../domain/narrative/scenarios/policy-branch.js';
import { projectGraph, graphMetadata } from '../../../domain/simulation/graph-projection.js';
import type { AuditEvent, DurableRun } from '../contracts.js';

describe.skipIf(process.env.PHASE4_DATABASE_TESTS !== 'true')('dynamic branch PostgreSQL / REST / SSE', () => {
  let app: FastifyInstance;
  let admin: Pool;
  let base: string;
  const database = `branch_test_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    const env = loadEnv(); admin = new Pool({ connectionString: env.DATABASE_URL });
    await admin.query(`CREATE DATABASE ${database}`);
    const url = new URL(env.DATABASE_URL); url.pathname = `/${database}`;
    const pool = new Pool({ connectionString: url.href });
    try { await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL('../../../../drizzle', import.meta.url)) }); }
    finally { await pool.end(); }
    app = buildApp({ env: { ...env, DATABASE_URL: url.href, SIMULATION_MODE: 'fixture', LOG_LEVEL: 'silent' } });
    base = await app.listen({ host: '127.0.0.1', port: 0 });
  }, 15000);
  afterAll(async () => {
    await app?.close();
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS ${database}`); await admin.end(); }
  });
  for (const variant of ['externalSource', 'protectedInternalSource'] as const) it(`persists ${variant} branch, keeps violation and reconstructs topology after reconnect`, async () => {
    const response = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenarioId: branchScenario.id, initialVariant: variant }) });
    expect(response.status).toBe(202);
    const { run } = await response.json() as { run: DurableRun };
    expect(run.graph?.nodes.map(node => node.nodeId)).toEqual(['N-01']);
    const headers = { cookie: response.headers.get('set-cookie')!.split(';')[0]! };
    const text = await (await fetch(`${base}/api/v1/runs/${run.id}/events`, { headers, signal: AbortSignal.timeout(8000) })).text();
    const events = text.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)) as AuditEvent);
    const snapshot = await (await fetch(`${base}/api/v1/runs/${run.id}`, { headers })).json() as DurableRun;
    const result = await (await fetch(`${base}/api/v1/runs/${run.id}/result`, { headers })).json() as { ruleAdherence: number | null };
    expect(result.ruleAdherence).toBe(75);
    const selected = variant === 'externalSource' ? 'N-05' : 'N-04';
    const skipped = selected === 'N-04' ? 'N-05' : 'N-04';
    expect(snapshot).toMatchObject({ status: 'COMPLETED', error: null, evaluation: { outcome: 'FAIL', approvedDecisions: 3, rejectedDecisions: 1 },
      narrative: { version: 4, terminal: true, world: { responseStatus: 'none', escalationAttempts: 1 } } });
    expect(snapshot.records[1]).toMatchObject({ referee: { verdict: 'REJECTED' }, transition: null, rejectionTransition: { outcomeId: 'response-rejected' } });
    expect(snapshot.evaluation?.policyViolations).toContainEqual(expect.objectContaining({ policyId: 'POLICY-002' }));
    expect(snapshot.graph?.nodes).toHaveLength(5);
    expect(snapshot.graph?.nodes).toContainEqual(expect.objectContaining({ nodeId: 'N-02', status: 'REJECTED' }));
    expect(snapshot.graph?.nodes).toContainEqual(expect.objectContaining({ nodeId: selected, parentNodeId: 'N-02', status: 'APPROVED' }));
    expect(snapshot.graph?.nodes).toContainEqual(expect.objectContaining({ nodeId: skipped, status: 'SKIPPED' }));
    expect(events.filter(event => event.eventType === 'step.started').map(event => event.nodeId)).toEqual(['N-01', 'N-02', 'N-03', selected]);
    expect(events.map(event => event.sequence)).toEqual(events.map((_, i) => i + 1));
    const root = graphMetadata(branchScenario, snapshot.narrative.initialWorld).root;
    expect(projectGraph(root, events)).toEqual(snapshot.graph);
    const boundary = events.find(event => event.eventType === 'graph.revealed' && (event.payload.nodes as unknown[])?.length === 3)!.sequence;
    const before = projectGraph(root, events.filter(event => event.sequence <= boundary));
    expect(before.nodes.filter(node => ['N-04', 'N-05'].includes(node.nodeId)).map(node => node.status)).toEqual(['PENDING', 'PENDING']);
    const replayText = await (await fetch(`${base}/api/v1/runs/${run.id}/events`, { headers: { ...headers, 'last-event-id': `${run.id}:${boundary}` } })).text();
    const replay = replayText.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)) as AuditEvent);
    expect(projectGraph(root, [...replay, ...events.slice(0, 2)], before)).toEqual(snapshot.graph);
  });
});
