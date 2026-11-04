import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { loadEnv } from '../../../config/env.js';
import { sshBruteForceScenario } from '../../../domain/narrative/scenarios/ssh-brute-force.js';
import { EXTERNAL_SOURCE_DECISIONS, UNSAFE_PROTECTED_BLOCK_DECISIONS } from '../../../domain/simulation/fixtures.js';
import { TransactionManager } from '../../../infrastructure/persistence/transaction-manager.js';
import { PostgresSimulationRepository } from '../../../infrastructure/persistence/simulation-repository.js';
import type { RunConfiguration } from '../contracts.js';

const enabled = process.env.PHASE4_DATABASE_TESTS === 'true';
describe.skipIf(!enabled)('PostgreSQL simulation transaction boundary', () => {
  let pool: Pool;
  let transactions: TransactionManager;
  let repo: PostgresSimulationRepository;
  const configuration: RunConfiguration = {
    scenario: sshBruteForceScenario, scenarioVersion: '1.0.0', initialVariant: 'externalSource',
    providerId: 'fixture-external-source', modelId: null, decisionTimeoutMs: 1000,
  };
  beforeAll(async () => {
    pool = new Pool({ connectionString: loadEnv().DATABASE_URL, max: 4 });
    transactions = new TransactionManager(pool);
    await transactions.acquire();
    repo = new PostgresSimulationRepository(transactions);
    await repo.recover();
  });
  afterAll(async () => {
    await transactions?.close();
    await pool?.end();
  });
  async function create(variant: RunConfiguration['initialVariant'] = 'externalSource') {
    const run = await repo.create({ ...configuration, initialVariant: variant }, 'test-capability');
    return run;
  }

  it('persists creation, version zero, capability hash and stable ordered audit identity', async () => {
    const run = await create();
    expect(run.status).toBe('CREATED');
    expect(run.narrative.version).toBe(0);
    expect((await repo.events(run.id, 0)).map((event) => event.sequence)).toEqual([1, 2]);
    expect(await repo.events(run.id, 0)).toEqual(await repo.events(run.id, 0));
    await expect(repo.authorize(run.id, 'wrong')).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });
    await expect(repo.authorize(run.id, 'test-capability')).resolves.toBeUndefined();
    const row = await pool.query('select access_hash, configuration_snapshot from simulation_runs where id=$1', [run.id]);
    expect(row.rows[0].access_hash).not.toBe('test-capability');
    expect(JSON.stringify(row.rows[0].configuration_snapshot)).not.toContain('apiKey');
  });

  it('atomically commits evidence, snapshot and ordered events; prevents duplicate writes', async () => {
    const created = await create();
    const running = await repo.lifecycle(created.id, 'start');
    const attempts = await Promise.allSettled([
      repo.commitDecision(running.id, running.revision, 0, EXTERNAL_SOURCE_DECISIONS[0]),
      repo.commitDecision(running.id, running.revision, 0, EXTERNAL_SOURCE_DECISIONS[0]),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    const run = await repo.read(created.id);
    expect(run.narrative.version).toBe(1);
    expect(run.records).toHaveLength(1);
    expect(run.records[0]?.referee.verdict).toBe('APPROVED');
    expect(run.records[0]?.decision.parameters?.incidentId).toMatch(/^sha256:/);
    const events = await repo.events(run.id, 0);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(events.map((event) => event.eventType)).toEqual(['run.created', 'graph.revealed', 'run.start', 'decision.evaluated', 'transition.committed', 'graph.revealed']);
  });

  it('rolls back inserted decision, snapshot and events on a database constraint failure', async () => {
    const created = await create();
    const running = await repo.lifecycle(created.id, 'start');
    const suffix = randomUUID().replaceAll('-', '');
    const constraint = `phase4_fault_${suffix}`;
    await pool.query(`alter table simulation_events add constraint ${constraint} check (not (run_id='${created.id}' and event_type='transition.committed'))`);
    try {
      await expect(repo.commitDecision(created.id, running.revision, 0, EXTERNAL_SOURCE_DECISIONS[0])).rejects.toThrow();
      const after = await repo.read(created.id);
      expect(after.narrative).toEqual(running.narrative);
      expect(after.revision).toBe(running.revision);
      expect(after.records).toEqual([]);
      expect((await repo.events(created.id, 0)).map((event) => event.sequence)).toEqual([1, 2, 3]);
      const snapshots = await pool.query('select count(*)::int as count from simulation_snapshots where run_id=$1', [created.id]);
      expect(snapshots.rows[0].count).toBe(1);
    } finally { await pool.query(`alter table simulation_events drop constraint ${constraint}`); }
    const recovered = await repo.commitDecision(created.id, running.revision, 0, EXTERNAL_SOURCE_DECISIONS[0]);
    expect(recovered.narrative.version).toBe(1);
    expect(recovered.records).toHaveLength(1);
    expect((await repo.events(created.id, 0)).filter((event) => event.eventType === 'transition.committed')).toHaveLength(1);
  });

  it('persists meaningful PASS and policy FAIL with final evidence and immutable terminal runs', async () => {
    const external = await create();
    let run = await repo.lifecycle(external.id, 'start');
    for (const decision of EXTERNAL_SOURCE_DECISIONS) {
      run = await repo.commitDecision(run.id, run.revision, run.narrative.version, decision);
    }
    expect(run.evaluation).toMatchObject({ outcome: 'PASS', approvedDecisions: 3, terminal: true });
    const trace = await pool.query(`select
      (select count(*)::int from simulation_decisions where run_id=$1) as decisions,
      (select count(*)::int from simulation_snapshots where run_id=$1) as snapshots,
      (select count(*)::int from simulation_events e join simulation_snapshots s on s.run_id=e.run_id and s.state_version=e.state_version
        where e.run_id=$1 and e.event_type='transition.committed') as audited_transitions,
      (select evaluation->>'outcome' from simulation_evaluations where run_id=$1) as outcome`, [run.id]);
    expect(trace.rows[0]).toEqual({ decisions: 3, snapshots: 4, audited_transitions: 3, outcome: 'PASS' });
    await expect(repo.lifecycle(run.id, 'cancel')).rejects.toMatchObject({ code: 'INVALID_LIFECYCLE_TRANSITION' });
    await expect(repo.commitDecision(run.id, run.revision, run.narrative.version, EXTERNAL_SOURCE_DECISIONS[0]))
      .rejects.toMatchObject({ code: 'STALE_RUN_REVISION' });

    const internal = await create('protectedInternalSource');
    let unsafe = await repo.lifecycle(internal.id, 'start');
    for (const decision of UNSAFE_PROTECTED_BLOCK_DECISIONS) {
      unsafe = await repo.commitDecision(unsafe.id, unsafe.revision, unsafe.narrative.version, decision);
    }
    expect(unsafe.evaluation).toMatchObject({ outcome: 'FAIL', approvedDecisions: 1, rejectedDecisions: 1 });
    expect(unsafe.narrative.version).toBe(1);
    expect(unsafe.records[1]?.referee.violatedPolicies.map((policy) => policy.policyId)).toContain('POLICY-002');
    const [stored] = (await pool.query('select evaluation from simulation_evaluations where run_id=$1', [unsafe.id])).rows;
    await pool.query("update simulation_evaluations set evaluation=jsonb_set(evaluation,'{outcome}','\"PASS\"') where run_id=$1", [unsafe.id]);
    await expect(repo.read(unsafe.id)).rejects.toMatchObject({ code: 'PERSISTED_EVIDENCE_MISMATCH' });
    await pool.query('update simulation_evaluations set evaluation=$2 where run_id=$1', [unsafe.id, stored.evaluation]);
  });

  it('pause/resume fences a stale worker even when state version has not changed', async () => {
    const created = await create();
    const running = await repo.lifecycle(created.id, 'start');
    await repo.lifecycle(created.id, 'pause');
    const resumed = await repo.lifecycle(created.id, 'resume');
    await expect(repo.commitDecision(created.id, running.revision, 0, EXTERNAL_SOURCE_DECISIONS[0]))
      .rejects.toMatchObject({ code: 'STALE_RUN_REVISION' });
    expect((await repo.commitDecision(created.id, resumed.revision, 0, EXTERNAL_SOURCE_DECISIONS[0])).narrative.version).toBe(1);
  });

  it('cancellation fences late results, and independent runs retain independent state', async () => {
    const first = await create();
    const second = await create();
    const active = await repo.lifecycle(first.id, 'start');
    await repo.lifecycle(first.id, 'cancel');
    await expect(repo.commitDecision(first.id, active.revision, 0, EXTERNAL_SOURCE_DECISIONS[0]))
      .rejects.toMatchObject({ code: 'STALE_RUN_REVISION' });
    const cancelled = await repo.read(first.id);
    expect(cancelled.evaluation).toMatchObject({ outcome: 'INCONCLUSIVE', totalDecisions: 0 });
    expect(cancelled.narrative.version).toBe(0);
    expect((await repo.read(second.id)).status).toBe('CREATED');
  });

  it('enforces one executor and recovers interrupted RUNNING runs with committed snapshots', async () => {
    const duplicate = new TransactionManager(pool);
    await expect(duplicate.acquire()).rejects.toMatchObject({ code: 'EXECUTOR_ALREADY_ACTIVE' });
    const created = await create();
    const active = await repo.lifecycle(created.id, 'start');
    const committed = await repo.commitDecision(created.id, active.revision, 0, EXTERNAL_SOURCE_DECISIONS[0]);
    const paused = await create();
    await repo.lifecycle(paused.id, 'start');
    await repo.lifecycle(paused.id, 'pause');
    await transactions.close();
    transactions = new TransactionManager(pool);
    await transactions.acquire();
    repo = new PostgresSimulationRepository(transactions);
    expect(await repo.recover()).toBeGreaterThan(0);
    const recovered = await repo.read(created.id);
    expect(recovered.status).toBe('FAILED');
    expect(recovered.error?.code).toBe('PROCESS_INTERRUPTED');
    expect(recovered.evaluation?.outcome).toBe('INCONCLUSIVE');
    expect(recovered.narrative).toEqual(committed.narrative);
    expect(recovered.records).toEqual(committed.records);
    expect((await repo.events(created.id, 0)).at(-1)?.eventType).toBe('run.finished');
    expect((await repo.read(paused.id)).status).toBe('PAUSED');
  });

  it('recovers a run left by an abruptly exited child process without replaying its committed decision', async () => {
    await transactions.close();
    const child = `
      import {Pool} from 'pg';
      import {loadEnv} from './src/config/env.ts';
      import {TransactionManager} from './src/infrastructure/persistence/transaction-manager.ts';
      import {PostgresSimulationRepository} from './src/infrastructure/persistence/simulation-repository.ts';
      import {sshBruteForceScenario} from './src/domain/narrative/scenarios/ssh-brute-force.ts';
      import {EXTERNAL_SOURCE_DECISIONS} from './src/domain/simulation/fixtures.ts';
      const pool = new Pool({connectionString:loadEnv().DATABASE_URL});
      const tx = new TransactionManager(pool); await tx.acquire();
      const repo = new PostgresSimulationRepository(tx);
      let run = await repo.create({scenario:sshBruteForceScenario,scenarioVersion:'1.0.0',initialVariant:'externalSource',providerId:'fixture-external-source',modelId:null,decisionTimeoutMs:1000},'crash-fixture');
      run = await repo.lifecycle(run.id,'start');
      run = await repo.commitDecision(run.id,run.revision,0,EXTERNAL_SOURCE_DECISIONS[0]);
      process.stdout.write(JSON.stringify({id:run.id,version:run.narrative.version}));
      process.exit(0);
    `;
    const output = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', child], {
      cwd: process.cwd(), timeout: 10_000, encoding: 'utf8',
    });
    const left = JSON.parse(output) as { id: string; version: number };
    transactions = new TransactionManager(pool);
    await transactions.acquire();
    repo = new PostgresSimulationRepository(transactions);
    await repo.recover();
    const recovered = await repo.read(left.id);
    expect(recovered.status).toBe('FAILED');
    expect(recovered.error?.code).toBe('PROCESS_INTERRUPTED');
    expect(recovered.narrative.version).toBe(left.version);
    expect(recovered.records).toHaveLength(1);
    expect(recovered.evaluation?.outcome).toBe('INCONCLUSIVE');
  }, 15_000);
});
