import fp from 'fastify-plugin';
import type { Env } from '../config/env.js';
import { loadAiConfig } from '../config/env.js';
import { createConfiguredProvider } from '../ai/provider-registry.js';
import { createExternalSourceProvider, createProtectedInternalProvider } from '../domain/simulation/fixtures.js';
import { SimulationService, type ProviderFactory } from '../application/simulation/simulation-service.js';
import { RecoveryService } from '../application/simulation/recovery-service.js';
import { TransactionManager } from '../infrastructure/persistence/transaction-manager.js';
import { PostgresSimulationRepository } from '../infrastructure/persistence/simulation-repository.js';
import { simulationRoutes } from '../routes/simulation-routes.js';
import { ApplicationError } from '../application/simulation/contracts.js';

export interface SimulationPluginOptions {
  env: Env;
  providerFactory?: ProviderFactory;
}

declare module 'fastify' {
  interface FastifyInstance {
    simulationReady?: () => boolean;
  }
}

export const simulationPlugin = fp<SimulationPluginOptions>(async (app, { env, providerFactory }) => {
  if (!['127.0.0.1', 'localhost', '::1'].includes(env.HOST) && !env.SIMULATION_ACCESS_TOKEN) {
    throw new ApplicationError('SIMULATION_ACCESS_TOKEN_REQUIRED', 503);
  }
  if (env.DB_POOL_MAX < 2) throw new ApplicationError('SIMULATION_POOL_TOO_SMALL', 503);
  let service: SimulationService;
  const transactions = new TransactionManager(app.pool, () => service?.abort());
  app.decorate('simulationReady', () => transactions.isReady());
  const repository = new PostgresSimulationRepository(transactions);
  const ai = loadAiConfig();
  const fixtureMode = env.SIMULATION_MODE === 'fixture';
  const factory = providerFactory ?? (fixtureMode
    ? (variant) => variant === 'externalSource' ? createExternalSourceProvider() : createProtectedInternalProvider()
    : () => createConfiguredProvider(ai));
  service = new SimulationService(repository, factory, (code) => app.log.error({ code }, 'simulation worker failed'));
  await app.register(simulationRoutes, {
    service,
    ...(env.SIMULATION_ACCESS_TOKEN ? { accessToken: env.SIMULATION_ACCESS_TOKEN } : {}),
    ...(env.SIMULATION_ALLOWED_ORIGIN ? { allowedOrigin: env.SIMULATION_ALLOWED_ORIGIN } : {}),
    models: () => fixtureMode ? [{ providerId: 'fixture', modelId: null, configured: true }]
      : [{ providerId: ai.provider ?? 'unconfigured', modelId: (ai.provider === 'gemini' ? ai.geminiModel : ai.ollamaModel) ?? null,
        configured: Boolean(ai.provider && (ai.provider === 'gemini' ? ai.geminiApiKey && ai.geminiModel : ai.ollamaModel)) }],
  });
  app.addHook('onReady', async () => {
    await transactions.acquire();
    try {
      const recovered = await new RecoveryService(repository).recoverInterruptedRuns();
      app.log.info({ recovered }, 'simulation executor ready');
    } catch {
      await transactions.close();
      throw new ApplicationError('SIMULATION_RECOVERY_FAILED', 503);
    }
  });
  app.addHook('preClose', async () => {
    try { await service.shutdown(); } catch { app.log.error({ code: 'SHUTDOWN_RECOVERY_FAILED' }, 'simulation shutdown failed'); }
    finally { await transactions.close(); }
  });
}, { name: 'simulation', dependencies: ['database'] });
