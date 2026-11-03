import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const app = buildApp({ env });

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      process.exit(0);
    } catch {
      app.log.error({ code: 'SHUTDOWN_FAILED' }, 'graceful shutdown failed');
      process.exit(1);
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', () => {
    app.log.error({ code: 'UNHANDLED_REJECTION' }, 'unhandled promise rejection');
  });

  process.on('uncaughtException', () => {
    app.log.fatal({ code: 'UNCAUGHT_EXCEPTION' }, 'uncaught exception');
    process.exit(1);
  });

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
  } catch {
    app.log.fatal({ code: 'STARTUP_FAILED' }, 'failed to start server');
    process.exit(1);
  }
}

main().catch(() => {
  console.error('Failed to start: invalid configuration or unavailable dependency.');
  process.exitCode = 1;
});
