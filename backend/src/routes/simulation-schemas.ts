import { Type } from '@sinclair/typebox';
import { NarrativeStateSchema, ScenarioDefinitionSchema, TransitionRecordSchema } from '../domain/narrative/schemas.js';
import { ProposedDecisionSchema } from '../domain/referee/schemas.js';
import { SIMULATION_STATUSES } from '../domain/simulation/types.js';

export const ErrorSchema = Type.Object({ error: Type.Object({ code: Type.String(), message: Type.String() }) });
const nullableString = Type.Union([Type.String(), Type.Null()]);
const VerdictSchema = Type.Object({
  verdict: Type.Union([Type.Literal('APPROVED'), Type.Literal('REJECTED')]),
  approved: Type.Boolean(), decisionId: Type.String(), providerId: Type.String(),
  actionType: Type.String(), storyletId: Type.String(), outcomeId: Type.String(), stateVersion: Type.Integer(),
  policySetId: Type.String(), policySetVersion: Type.String(), reasonCode: Type.String(),
  reasons: Type.Array(Type.String()), evidence: Type.Array(Type.String()),
  evaluatedPolicies: Type.Array(Type.Object({
    status: Type.String(), reasonCode: Type.String(), message: Type.String(), policyId: Type.String(),
    description: Type.String(), evidence: Type.Optional(Type.Array(Type.String())),
  })),
  violatedPolicies: Type.Array(Type.Object({
    status: Type.String(), reasonCode: Type.String(), message: Type.String(), policyId: Type.String(),
    description: Type.String(), evidence: Type.Optional(Type.Array(Type.String())),
  })),
});

export const EvaluationSchema = Type.Object({
  runId: Type.String(), scenarioId: Type.String(),
  providerProvenance: Type.Union([Type.Object({ provider: Type.String(), model: Type.String() }), Type.Null()]),
  status: Type.String(), outcome: Type.Union([Type.Literal('PASS'), Type.Literal('FAIL'), Type.Literal('INCONCLUSIVE')]),
  reasonCode: Type.String(), summary: Type.String(), terminal: Type.Boolean(),
  totalDecisions: Type.Integer(), approvedDecisions: Type.Integer(), rejectedDecisions: Type.Integer(),
  policyViolations: Type.Array(Type.Object({ sequence: Type.Integer(), decisionId: Type.String(), policyId: Type.String(), reasonCode: Type.String(), message: Type.String() })),
  finalStateVersion: Type.Integer(), finalWorld: NarrativeStateSchema.properties.world,
  startedAt: nullableString, completedAt: Type.String(), policySetId: Type.String(), policySetVersion: Type.String(),
});

export const RunSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  configuration: Type.Object({
    scenario: ScenarioDefinitionSchema, scenarioVersion: Type.String(), initialVariant: Type.String(),
    providerId: Type.String(), modelId: nullableString, decisionTimeoutMs: Type.Integer(),
  }),
  status: Type.Union(SIMULATION_STATUSES.map((status) => Type.Literal(status))),
  revision: Type.Integer(), eventSequence: Type.Integer(), narrative: NarrativeStateSchema,
  records: Type.Array(Type.Object({ sequence: Type.Integer(), decision: ProposedDecisionSchema, referee: VerdictSchema,
    transition: Type.Union([TransitionRecordSchema, Type.Null()]), recordedAt: Type.String() })),
  evaluation: Type.Union([EvaluationSchema, Type.Null()]),
  error: Type.Union([Type.Object({ code: Type.String(), message: Type.String(), phase: Type.String(), sequence: Type.Optional(Type.Integer()) }), Type.Null()]),
  createdAt: Type.String(), startedAt: nullableString, completedAt: nullableString, updatedAt: Type.String(),
});

export const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) }, { additionalProperties: false });
export const EmptyQuery = Type.Object({}, { additionalProperties: false });
export const CreateRunSchema = Type.Object({
  scenarioId: Type.Literal('ssh-brute-force'),
  initialVariant: Type.Union([Type.Literal('externalSource'), Type.Literal('protectedInternalSource')]),
}, { additionalProperties: false });
export const ErrorResponses = Object.fromEntries([400, 401, 403, 404, 409, 413, 429, 500, 503].map((code) => [code, ErrorSchema]));

export const AuditEventSchema = Type.Object({
  id: Type.String({ format: 'uuid' }), runId: Type.String({ format: 'uuid' }),
  sequence: Type.Integer({ minimum: 1 }), eventType: Type.String(),
  storyletId: nullableString, nodeId: nullableString, stateVersion: Type.Integer({ minimum: 0 }),
  payload: Type.Union([
    Type.Object({ status: Type.String() }, { additionalProperties: false }),
    Type.Object({ decisionSequence: Type.Integer(), verdict: Type.String(), violatedPolicyIds: Type.Array(Type.String()) }, { additionalProperties: false }),
    Type.Object({ transition: TransitionRecordSchema }, { additionalProperties: false }),
    Type.Object({ status: Type.String(), outcome: Type.String(), reasonCode: Type.String() }, { additionalProperties: false }),
  ]),
  createdAt: Type.String(),
});
