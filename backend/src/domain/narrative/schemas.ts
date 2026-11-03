import { Type, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { assertConditionReferences } from './conditions.js';
import { validateEffectDefinition } from './effects.js';
import { NarrativeValidationError } from './errors.js';
import { assertBoundedNarrativeData } from './limits.js';
import {
  ASSET_CLASSIFICATIONS,
  ESCALATION_STATUSES,
  INCIDENT_STATUSES,
  RESPONSE_STATUSES,
  SOURCE_CLASSIFICATIONS,
  type NarrativeState,
  type ScenarioDefinition,
  type TransitionRecord,
  type WorldState,
} from './types.js';

function stringEnum(values: readonly string[]): TSchema {
  return Type.Union(values.map((value) => Type.Literal(value)));
}

const EventIdSchema = Type.String({ pattern: '^event:[a-z0-9-]+$', maxLength: 200 });
const ConditionValueSchema = Type.Union([Type.String(), Type.Number(), Type.Boolean()]);

export const WorldStateSchema = Type.Object(
  {
    sourceClassification: stringEnum(SOURCE_CLASSIFICATIONS),
    sourceProtected: Type.Boolean(),
    assetClassification: stringEnum(ASSET_CLASSIFICATIONS),
    assetProtected: Type.Boolean(),
    threatConfidence: Type.Integer({ minimum: 0, maximum: 100 }),
    incidentStatus: stringEnum(INCIDENT_STATUSES),
    escalationStatus: stringEnum(ESCALATION_STATUSES),
    responseStatus: stringEnum(RESPONSE_STATUSES),
    escalationAttempts: Type.Integer({ minimum: 0, maximum: 10 }),
    completedEvents: Type.Array(EventIdSchema, { uniqueItems: true, maxItems: 100 }),
    workflowStage: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
  },
  { additionalProperties: false },
);

const ConditionSchema = Type.Recursive(
  (This) =>
    Type.Union([
      Type.Object(
        {
          op: Type.Literal('equals'),
          field: Type.String(),
          value: ConditionValueSchema,
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          op: Type.Literal('not_equals'),
          field: Type.String(),
          value: ConditionValueSchema,
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          op: Type.Literal('greater_than'),
          field: Type.String(),
          value: Type.Number(),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          op: Type.Literal('less_than'),
          field: Type.String(),
          value: Type.Number(),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          op: Type.Literal('all'),
          conditions: Type.Array(This, { minItems: 1, maxItems: 32 }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          op: Type.Literal('any'),
          conditions: Type.Array(This, { minItems: 1, maxItems: 32 }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          op: Type.Literal('not'),
          condition: This,
        },
        { additionalProperties: false },
      ),
    ]),
  { $id: 'NarrativeCondition' },
);

const EffectSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal('set'),
      field: Type.String(),
      value: ConditionValueSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('increment'),
      field: Type.String(),
      by: Type.Integer({ minimum: -100, maximum: 100 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('append'),
      field: Type.Literal('completedEvents'),
      value: EventIdSchema,
    },
    { additionalProperties: false },
  ),
]);

const StoryletOutcomeSchema = Type.Object(
  {
    id: Type.String({ pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }),
    description: Type.String({ minLength: 1, maxLength: 4000 }),
    effects: Type.Array(EffectSchema, { minItems: 1, maxItems: 32 }),
  },
  { additionalProperties: false },
);

const StoryletDefinitionSchema = Type.Object(
  {
    id: Type.String({ pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }),
    description: Type.String({ minLength: 1, maxLength: 4000 }),
    graphNodeId: Type.Optional(Type.String({ minLength: 1 })),
    priority: Type.Integer({ minimum: -1000, maximum: 1000 }),
    oneShot: Type.Boolean(),
    terminal: Type.Boolean(),
    preconditions: ConditionSchema,
    action: Type.Object(
      {
        id: Type.String({ pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }),
        description: Type.String({ minLength: 1 }),
      },
      { additionalProperties: false },
    ),
    outcomes: Type.Array(StoryletOutcomeSchema, { minItems: 1, maxItems: 16 }),
  },
  { additionalProperties: false },
);

export const ScenarioDefinitionSchema = Type.Object(
  {
    id: Type.String({ pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }),
    title: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    technique: Type.String({ minLength: 1 }),
    maxTransitions: Type.Integer({ minimum: 1, maximum: 100 }),
    storylets: Type.Array(StoryletDefinitionSchema, { minItems: 1, maxItems: 100 }),
  },
  { additionalProperties: false },
);

export const TransitionRecordSchema = Type.Object(
  {
    sequence: Type.Integer({ minimum: 1 }),
    storyletId: Type.String({ minLength: 1 }),
    outcomeId: Type.String({ minLength: 1 }),
    previousStateVersion: Type.Integer({ minimum: 0 }),
    nextStateVersion: Type.Integer({ minimum: 1 }),
    appliedEffects: Type.Array(EffectSchema, { minItems: 1 }),
    graphNodeId: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export const NarrativeStateSchema = Type.Object(
  {
    scenarioId: Type.String({ minLength: 1 }),
    initialWorld: WorldStateSchema,
    world: WorldStateSchema,
    version: Type.Integer({ minimum: 0, maximum: 100 }),
    step: Type.Integer({ minimum: 0, maximum: 100 }),
    completedStorylets: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { uniqueItems: true, maxItems: 100 }),
    currentStoryletId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    terminal: Type.Boolean(),
  },
  { additionalProperties: false },
);

function formatSchemaErrors(schema: TSchema, value: unknown): string[] {
  return [...Value.Errors(schema, value)].map(
    (error) => `${error.path === '' ? '/' : error.path}: ${error.message}`,
  );
}

function assertSchema(schema: TSchema, value: unknown, label: string): void {
  assertBoundedNarrativeData(value);
  if (!Value.Check(schema, value)) {
    throw new NarrativeValidationError(
      `Invalid ${label}`,
      formatSchemaErrors(schema, value),
    );
  }
}

export function validateWorldState(value: unknown): WorldState {
  assertSchema(WorldStateSchema, value, 'world state');
  return value as WorldState;
}

export function validateNarrativeState(value: unknown): NarrativeState {
  assertSchema(NarrativeStateSchema, value, 'narrative state');
  return value as NarrativeState;
}

export function validateTransitionRecord(value: unknown): TransitionRecord {
  assertSchema(TransitionRecordSchema, value, 'transition record');
  return value as TransitionRecord;
}

export function validateScenarioDefinition(value: unknown): ScenarioDefinition {
  assertSchema(ScenarioDefinitionSchema, value, 'scenario definition');
  const definition = value as ScenarioDefinition;
  const storyletIds = new Set<string>();

  definition.storylets.forEach((storylet, storyletIndex) => {
    if (storyletIds.has(storylet.id)) {
      throw new NarrativeValidationError(
        `Duplicate storylet identifier "${storylet.id}"`,
        [`storylets[${storyletIndex}].id`],
      );
    }
    storyletIds.add(storylet.id);

    assertConditionReferences(
      storylet.preconditions,
      `storylets[${storyletIndex}].preconditions`,
    );

    const outcomeIds = new Set<string>();
    storylet.outcomes.forEach((outcome, outcomeIndex) => {
      if (outcomeIds.has(outcome.id)) {
        throw new NarrativeValidationError(
          `Duplicate outcome identifier "${outcome.id}" in storylet "${storylet.id}"`,
          [`storylets[${storyletIndex}].outcomes[${outcomeIndex}].id`],
        );
      }
      outcomeIds.add(outcome.id);

      outcome.effects.forEach((effect, effectIndex) => {
        validateEffectDefinition(
          effect,
          `storylets[${storyletIndex}].outcomes[${outcomeIndex}].effects[${effectIndex}]`,
        );
      });
    });
  });

  return definition;
}
