import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool, PoolClient } from 'pg';
import type { Database } from '../../db/client.js';
import * as schema from '../../db/schema.js';
import { ApplicationError } from '../../application/simulation/contracts.js';

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export class TransactionManager {
  private client: PoolClient | null = null;
  private database: Database | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private alive = false;
  private pending = 0;
  private accepting = false;

  constructor(private readonly pool: Pool, private readonly onLost: () => void = () => undefined) {}

  async acquire(): Promise<void> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ locked: boolean }>('select pg_try_advisory_lock(4174, 1) as locked');
      if (!result.rows[0]?.locked) throw new ApplicationError('EXECUTOR_ALREADY_ACTIVE', 503);
      await client.query("set statement_timeout = '10s'");
      await client.query("set idle_in_transaction_session_timeout = '15s'");
    } catch (error) { client.release(true); throw error; }
    this.client = client;
    this.database = drizzle(client, { schema });
    this.alive = true;
    this.accepting = true;
    client.on('error', () => { this.alive = false; this.accepting = false; this.onLost(); });
  }

  transaction<T>(operation: (tx: Transaction) => Promise<T>): Promise<T> {
    if (!this.accepting) return Promise.reject(new ApplicationError('EXECUTOR_UNAVAILABLE', 503));
    if (this.pending >= 64) return Promise.reject(new ApplicationError('DATABASE_CAPACITY_REACHED', 429));
    this.pending += 1;
    const task = this.tail.catch(() => undefined).then(async () => {
      if (!this.alive || !this.database) throw new ApplicationError('EXECUTOR_UNAVAILABLE', 503);
      return this.database.transaction(operation);
    });
    const bounded = task.finally(() => { this.pending -= 1; });
    this.tail = bounded;
    return bounded;
  }

  isReady(): boolean {
    return this.alive && this.accepting;
  }

  async close(): Promise<void> {
    this.accepting = false;
    await this.tail.catch(() => undefined);
    const alive = this.alive;
    this.alive = false;
    if (this.client) {
      try { if (alive) await this.client.query('select pg_advisory_unlock(4174, 1)'); }
      finally { this.client.release(true); this.client = null; this.database = null; }
    }
  }
}
