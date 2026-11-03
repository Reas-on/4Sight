import { createHash } from 'node:crypto';
import { Type, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { validateProposedDecision } from '../domain/referee/schemas.js';
import { REFEREE_ACTION_TYPES, type ProposedDecision } from '../domain/referee/types.js';
import type { DecisionContext } from '../domain/simulation/types.js';
import { AiProviderError } from './errors.js';
import { MAX_DECISION_BYTES } from './types.js';

export const AiDecisionSchema = Type.Object({
  actionType: Type.Union(REFEREE_ACTION_TYPES.map((value) => Type.Literal(value))),
  parameters: Type.Object({
    sourceId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    incidentId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  }, { additionalProperties: false }),
  storyletId: Type.String({ minLength: 1, maxLength: 200, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }),
  outcomeId: Type.String({ minLength: 1, maxLength: 200, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }),
  reasoning: Type.Optional(Type.String({ maxLength: 4000 })),
}, { additionalProperties: false });

function generationSchema(schema: TSchema): Record<string, unknown> {
  if (Array.isArray(schema.anyOf)) {
    return { type: 'string', enum: schema.anyOf.map((item: TSchema) => item.const) };
  }
  return {
    type: schema.type,
    ...(schema.properties === undefined ? {} : {
      properties: Object.fromEntries(Object.entries(schema.properties as Record<string, TSchema>)
        .map(([key, child]) => [key, generationSchema(child)])),
      required: schema.required ?? [],
      additionalProperties: false,
    }),
  };
}

export const AI_RESPONSE_JSON_SCHEMA = generationSchema(AiDecisionSchema);

export function normalizeDecision(
  text: string,
  context: DecisionContext,
  providerId: string,
): ProposedDecision {
  if (Buffer.byteLength(text, 'utf8') > MAX_DECISION_BYTES) {
    throw new AiProviderError('PROVIDER_RESPONSE_TOO_LARGE');
  }
  let output: unknown;
  try { output = JSON.parse(text); } catch { throw new AiProviderError('INVALID_AI_OUTPUT'); }
  if (!Value.Check(AiDecisionSchema, output)) throw new AiProviderError('INVALID_AI_OUTPUT');
  const runKey = createHash('sha256').update(context.runId).digest('hex').slice(0, 24);
  try {
    return validateProposedDecision({
      ...output,
      decisionId: `ai-${runKey}-v${context.state.version}-s${context.sequence}`,
      providerId,
    });
  } catch { throw new AiProviderError('INVALID_AI_OUTPUT'); }
}
