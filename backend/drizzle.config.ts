import { defineConfig } from 'drizzle-kit';
import { loadEnv } from './src/config/env';

const env = loadEnv();

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
});
