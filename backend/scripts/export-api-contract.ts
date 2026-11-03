import { writeFileSync } from 'node:fs';
import { Type } from '@sinclair/typebox';
import { AuditEventSchema, CreateRunSchema, EvaluationSchema, ModelListSchema, RunSchema, ScenarioListSchema } from '../src/routes/simulation-schemas.js';

const contract = {
  run: RunSchema,
  event: AuditEventSchema,
  create: CreateRunSchema,
  created: Type.Object({ run: RunSchema }),
  result: Type.Object({ evaluation: EvaluationSchema, ruleAdherence: Type.Union([Type.Number(), Type.Null()]) }),
  scenarios: ScenarioListSchema,
  models: ModelListSchema,
};
writeFileSync(new URL('../../src/api/contract.json', import.meta.url), `${JSON.stringify(contract, null, 2)}\n`);
console.log('Exported backend API schemas.');
