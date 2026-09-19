import { Type, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { RefereeValidationError } from './errors.js';
import {
  REFEREE_ACTION_TYPES,
  POLICY_STATUSES,
  type ProposedDecision,
  type RefereePolicyFinding,
  type RefereePolicySet,
} from './types.js';

function stringEnum(values: readonly string[]): TSchema {
  return Type.Union(values.map((value) => Type.Literal(value)));
}

const DecisionIdSchema = Type.String({
  minLength: 1,
  maxLength: 200,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
});
const StoryletIdSchema = Type.String({
  minLength: 1,
  maxLength: 200,
  pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
});

const DecisionParametersSchema = Type.Object(
  {
    sourceId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    incidentId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { additionalProperties: false },
);

export const ProposedDecisionSchema = Type.Object(
  {
    decisionId: DecisionIdSchema,
    providerId: Type.String({ minLength: 1, maxLength: 200 }),
    actionType: stringEnum(REFEREE_ACTION_TYPES),
    parameters: Type.Optional(DecisionParametersSchema),
    storyletId: StoryletIdSchema,
    outcomeId: StoryletIdSchema,
    reasoning: Type.Optional(Type.String({ maxLength: 4000 })),
  },
  { additionalProperties: false },
);

export const RefereePolicyFindingSchema = Type.Object(
  {
    status: stringEnum(POLICY_STATUSES),
    reasonCode: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
    evidence: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

function formatSchemaErrors(schema: TSchema, value: unknown): string[] {
  return [...Value.Errors(schema, value)].map(
    (error) => `${error.path === '' ? '/' : error.path}: ${error.message}`,
  );
}

function assertSchema(schema: TSchema, value: unknown, label: string): void {
  if (!Value.Check(schema, value)) {
    throw new RefereeValidationError(
      `Invalid ${label}`,
      formatSchemaErrors(schema, value),
    );
  }
}

export function validateProposedDecision(value: unknown): ProposedDecision {
  assertSchema(ProposedDecisionSchema, value, 'proposed decision');
  const decision = value as ProposedDecision;
  const parameters =
    decision.parameters === undefined
      ? undefined
      : Object.freeze({ ...decision.parameters });

  return Object.freeze({
    decisionId: decision.decisionId,
    providerId: decision.providerId,
    actionType: decision.actionType,
    ...(parameters === undefined ? {} : { parameters }),
    storyletId: decision.storyletId,
    outcomeId: decision.outcomeId,
    ...(decision.reasoning === undefined ? {} : { reasoning: decision.reasoning }),
  });
}

export function validateRefereePolicySet(value: unknown): RefereePolicySet {
  if (typeof value !== 'object' || value === null) {
    throw new RefereeValidationError('Invalid referee policy set');
  }

  const policySet = value as RefereePolicySet;
  if (typeof policySet.id !== 'string' || policySet.id.length === 0) {
    throw new RefereeValidationError('Referee policy set requires a non-empty identifier');
  }
  if (typeof policySet.version !== 'string' || policySet.version.length === 0) {
    throw new RefereeValidationError('Referee policy set requires a non-empty version');
  }
  if (!Array.isArray(policySet.policies) || policySet.policies.length === 0) {
    throw new RefereeValidationError('Referee policy set requires at least one policy');
  }

  const policyIds = new Set<string>();
  const policies = Array.from(policySet.policies, (policy, index) => {
    if (typeof policy !== 'object' || policy === null) {
      throw new RefereeValidationError(`Invalid referee policy at index ${index}`);
    }
    if (typeof policy.policyId !== 'string' || policy.policyId.length === 0) {
      throw new RefereeValidationError(
        `Referee policy at index ${index} requires a non-empty identifier`,
      );
    }
    if (typeof policy.description !== 'string' || policy.description.length === 0) {
      throw new RefereeValidationError(
        `Referee policy "${policy.policyId}" requires a description`,
      );
    }
    if (typeof policy.evaluate !== 'function') {
      throw new RefereeValidationError(
        `Referee policy "${policy.policyId}" requires an evaluate function`,
      );
    }
    if (policyIds.has(policy.policyId)) {
      throw new RefereeValidationError(
        `Duplicate referee policy identifier "${policy.policyId}"`,
      );
    }
    policyIds.add(policy.policyId);
    return Object.freeze({
      policyId: policy.policyId,
      description: policy.description,
      evaluate: policy.evaluate,
    });
  });

  return Object.freeze({
    id: policySet.id,
    version: policySet.version,
    policies: Object.freeze(policies),
  });
}

export function validateRefereePolicyFinding(value: unknown): RefereePolicyFinding {
  assertSchema(RefereePolicyFindingSchema, value, 'referee policy finding');
  const finding = value as RefereePolicyFinding;
  return Object.freeze({
    status: finding.status,
    reasonCode: finding.reasonCode,
    message: finding.message,
    ...(finding.evidence === undefined
      ? {}
      : { evidence: Object.freeze([...finding.evidence]) }),
  });
}
