import type { Pool } from 'pg';
import fp from 'fastify-plugin';
import type { Database } from '../db/client.js';
import { createDatabase, createPool } from '../db/client.js';
import type { Env } from '../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    pool: Pool;
  }
}

interface DatabasePluginOptions {
  env: Env;
}

export const databasePlugin = fp<DatabasePluginOptions>(
  async (app, options) => {
    const pool = createPool(options.env);
    pool.on('error', () => app.log.error({ code: 'DATABASE_POOL_ERROR' }, 'database pool connection failed'));
    const db = createDatabase(pool);

    app.decorate('pool', pool);
    app.decorate('db', db);

    app.addHook('onClose', async () => {
      await pool.end();
    });

    app.log.info('database connection pool created');
  },
  { name: 'database' },
);
