import { setTimeout } from 'node:timers/promises';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { createExternalSourceProvider, createUnsafeProtectedBlockProvider } from '../src/domain/simulation/fixtures.js';

if (process.env.PHASE5_TEST_SERVER !== 'true') throw new Error('Explicit PHASE5_TEST_SERVER=true required');
const app = buildApp({
  env: { ...loadEnv(), HOST: '127.0.0.1', PORT: 3001, LOG_LEVEL: 'silent', SIMULATION_ENABLED: true,
    SIMULATION_MODE: 'fixture', SIMULATION_ALLOWED_ORIGIN: 'http://127.0.0.1:4173' },
  simulationProviderFactory: (variant) => {
    const fixture = variant === 'externalSource' ? createExternalSourceProvider() : createUnsafeProtectedBlockProvider();
    return { id: fixture.id, decisionTimeoutMs: 5000, decide: async (context) => {
      await setTimeout(1500, undefined, { signal: context.signal });
      return fixture.decide(context);
    } };
  },
});
const close = async () => { await app.close(); process.exit(0); };
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
await app.listen({ host: '127.0.0.1', port: 3001 });
console.log('Phase 5 test-only fixture API ready. No live inference.');
