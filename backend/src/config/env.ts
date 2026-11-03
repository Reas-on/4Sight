import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { parseAiConfig } from '../ai/config.js';
import type { AiConfig } from '../ai/types.js';

const EnvSchema = Type.Object({
  NODE_ENV: Type.Union(
    [Type.Literal('development'), Type.Literal('test'), Type.Literal('production')],
  ),
  HOST: Type.String({ minLength: 1 }),
  PORT: Type.Integer({ minimum: 1, maximum: 65535 }),
  LOG_LEVEL: Type.Union([
    Type.Literal('fatal'),
    Type.Literal('error'),
    Type.Literal('warn'),
    Type.Literal('info'),
    Type.Literal('debug'),
    Type.Literal('trace'),
    Type.Literal('silent'),
  ]),
  DATABASE_URL: Type.String({ minLength: 1, pattern: '^postgres(ql)?://' }),
  DB_POOL_MAX: Type.Integer({ minimum: 1, maximum: 100 }),
  DB_CONNECTION_TIMEOUT_MS: Type.Integer({ minimum: 100, maximum: 60_000 }),
  DB_IDLE_TIMEOUT_MS: Type.Integer({ minimum: 1_000, maximum: 600_000 }),
  SIMULATION_ENABLED: Type.Optional(Type.Boolean()),
  SIMULATION_MODE: Type.Optional(Type.Union([Type.Literal('ai'), Type.Literal('fixture')])),
  SIMULATION_ACCESS_TOKEN: Type.Optional(Type.String({ minLength: 32, maxLength: 200, pattern: '^[A-Za-z0-9._~-]+$' })),
  SIMULATION_ALLOWED_ORIGIN: Type.Optional(Type.String({ pattern: '^https?://[^/]+$' })),
});

export type Env = Static<typeof EnvSchema>;

let loaded = false;

function loadEnvFiles(): void {
  if (loaded) return;
  loaded = true;
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDir, '../../../.env'),
    resolve(moduleDir, '../../.env'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      loadDotenv({ path, override: false, quiet: true });
    }
  }
}

export function loadEnv(): Env {
  loadEnvFiles();

  const raw = {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    HOST: process.env.HOST ?? '127.0.0.1',
    PORT: Number(process.env.PORT ?? 3000),
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
    DATABASE_URL: process.env.DATABASE_URL,
    DB_POOL_MAX: Number(process.env.DB_POOL_MAX ?? 10),
    DB_CONNECTION_TIMEOUT_MS: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 5000),
    DB_IDLE_TIMEOUT_MS: Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30000),
    SIMULATION_ENABLED: process.env.SIMULATION_ENABLED === undefined ? true
      : process.env.SIMULATION_ENABLED === 'true' ? true : process.env.SIMULATION_ENABLED === 'false' ? false : process.env.SIMULATION_ENABLED,
    SIMULATION_MODE: process.env.SIMULATION_MODE ?? 'ai',
    ...(process.env.SIMULATION_ACCESS_TOKEN ? { SIMULATION_ACCESS_TOKEN: process.env.SIMULATION_ACCESS_TOKEN } : {}),
    ...(process.env.SIMULATION_ALLOWED_ORIGIN ? { SIMULATION_ALLOWED_ORIGIN: process.env.SIMULATION_ALLOWED_ORIGIN } : {}),
  };

  if (!Value.Check(EnvSchema, raw)) {
    const details = [...Value.Errors(EnvSchema, raw)]
      .map((error) => `${error.path.replace(/^\//, '') || 'environment'}: ${error.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  if (raw.SIMULATION_ALLOWED_ORIGIN) {
    try {
      const origin = new URL(raw.SIMULATION_ALLOWED_ORIGIN);
      if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== raw.SIMULATION_ALLOWED_ORIGIN) throw new Error();
    } catch { throw new Error('Invalid environment configuration: SIMULATION_ALLOWED_ORIGIN must be an exact HTTP(S) origin'); }
  }

  return raw;
}

export function loadAiConfig(): AiConfig {
  loadEnvFiles();
  return parseAiConfig(process.env);
}
