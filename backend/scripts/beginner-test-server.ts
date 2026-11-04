import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { GeminiDecisionProvider } from '../src/ai/providers/gemini.js';
import { BRANCH_SCENARIO_ID } from '../src/domain/narrative/scenarios/policy-branch.js';
import { createBranchFixtureProvider } from '../src/domain/simulation/fixtures.js';
import { setTimeout } from 'node:timers/promises';

if (process.env.BEGINNER_TEST_SERVER !== 'true') throw new Error('Explicit BEGINNER_TEST_SERVER=true required');
const env = loadEnv();
const admin = new Pool({ connectionString: env.DATABASE_URL });
const database = `beginner_browser_${randomUUID().replaceAll('-', '')}`;
await admin.query(`CREATE DATABASE ${database}`);
const url = new URL(env.DATABASE_URL); url.pathname = `/${database}`;
const pool = new Pool({ connectionString: url.href });
try { await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) }); }
finally { await pool.end(); }
const app = buildApp({
  env: { ...env, DATABASE_URL: url.href, HOST: '127.0.0.1', PORT: 3101, LOG_LEVEL: 'silent', SIMULATION_MODE: 'ai',
    SIMULATION_ALLOWED_ORIGIN: 'http://127.0.0.1:4173' },
  simulationProviderFactory: (_variant, scenarioId) => scenarioId === BRANCH_SCENARIO_ID
    ? { ...createBranchFixtureProvider(), id: 'gemini', decisionTimeoutMs: 5000, provenance: { provider: 'gemini', model: 'gemini-2.5-flash' },
      decide: async context => { await setTimeout(1600, undefined, { signal: context.signal }); return createBranchFixtureProvider().decide(context); } }
    : new GeminiDecisionProvider({ apiKey: 'test-only-key', model: 'gemini-2.5-flash', requestTimeoutMs: 5000, maxRetries: 0 }, {
    fetch: async (_url, init) => {
      await setTimeout(1600, undefined, { signal: init?.signal ?? undefined });
      const body = JSON.parse(String(init?.body));
      const context = JSON.parse(body.contents[0].parts[0].text).backendContext;
      // The protected variant intentionally proposes an unsafe block to exercise
      // the genuine Referee/rejection route. This is test-only provider transport.
      const output = { actionType: 'perimeter_block', parameters: { sourceId: '203.0.113.25', incidentId: 'demo-ssh-001' },
        storyletId: context.selectedStoryletId, outcomeId: context.world.sourceClassification === 'internal' ? 'escalation-approved' : 'block-approved',
        reasoning: 'The source repeatedly failed SSH authentication.' };
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(output) }] } }] });
    },
  }),
});
const close = async () => {
  await app.close();
  await admin.query(`DROP DATABASE IF EXISTS ${database}`);
  await admin.end();
  process.exit(0);
};
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
await app.listen({ host: '127.0.0.1', port: 3101 });
console.log('Beginner browser test API ready: isolated PostgreSQL, mocked Gemini transport.');
