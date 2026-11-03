import {
  ASSET_CLASSIFICATIONS,
  ESCALATION_STATUSES,
  INCIDENT_STATUSES,
  NARRATIVE_EVENT_PATTERN,
  RESPONSE_STATUSES,
  SOURCE_CLASSIFICATIONS,
  type NarrativeEventId,
  type NumericWorldField,
  type ScalarWorldField,
} from './types.js';

export interface WorldFieldDefinition {
  readonly kind: 'enum' | 'boolean' | 'integer';
  readonly values?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  readonly settable: boolean;
  readonly incrementable: boolean;
  readonly conditionable: boolean;
}

export const WORLD_FIELDS: Readonly<Record<ScalarWorldField, WorldFieldDefinition>> = {
  workflowStage: { kind: 'integer', min: 0, max: 10, settable: true, incrementable: true, conditionable: true },
  sourceClassification: {
    kind: 'enum',
    values: SOURCE_CLASSIFICATIONS,
    settable: true,
    incrementable: false,
    conditionable: true,
  },
  sourceProtected: {
    kind: 'boolean',
    settable: true,
    incrementable: false,
    conditionable: true,
  },
  assetClassification: {
    kind: 'enum',
    values: ASSET_CLASSIFICATIONS,
    settable: true,
    incrementable: false,
    conditionable: true,
  },
  assetProtected: {
    kind: 'boolean',
    settable: true,
    incrementable: false,
    conditionable: true,
  },
  threatConfidence: {
    kind: 'integer',
    min: 0,
    max: 100,
    settable: true,
    incrementable: true,
    conditionable: true,
  },
  incidentStatus: {
    kind: 'enum',
    values: INCIDENT_STATUSES,
    settable: true,
    incrementable: false,
    conditionable: true,
  },
  escalationStatus: {
    kind: 'enum',
    values: ESCALATION_STATUSES,
    settable: true,
    incrementable: false,
    conditionable: true,
  },
  responseStatus: {
    kind: 'enum',
    values: RESPONSE_STATUSES,
    settable: true,
    incrementable: false,
    conditionable: true,
  },
  escalationAttempts: {
    kind: 'integer',
    min: 0,
    max: 10,
    settable: true,
    incrementable: true,
    conditionable: true,
  },
};

export const APPENDABLE_FIELD = 'completedEvents' as const;

export function isScalarWorldField(value: string): value is ScalarWorldField {
  return Object.hasOwn(WORLD_FIELDS, value);
}

export function isNumericWorldField(value: string): value is NumericWorldField {
  return value === 'threatConfidence' || value === 'escalationAttempts' || value === 'workflowStage';
}

export function getWorldFieldDefinition(field: ScalarWorldField): WorldFieldDefinition {
  return WORLD_FIELDS[field];
}

export function validateFieldValue(field: string, value: unknown): string | null {
  if (!isScalarWorldField(field)) return `Unknown world state field "${field}"`;

  const definition = WORLD_FIELDS[field];

  if (definition.kind === 'enum') {
    if (typeof value !== 'string' || !definition.values?.includes(value)) {
      return `Field "${field}" must be one of: ${definition.values?.join(', ')}`;
    }
    return null;
  }

  if (definition.kind === 'boolean') {
    return typeof value === 'boolean' ? null : `Field "${field}" must be a boolean`;
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return `Field "${field}" must be an integer`;
  }
  if (value < (definition.min ?? Number.NEGATIVE_INFINITY)) {
    return `Field "${field}" must be at least ${definition.min}`;
  }
  if (value > (definition.max ?? Number.POSITIVE_INFINITY)) {
    return `Field "${field}" must be at most ${definition.max}`;
  }
  return null;
}

export function validateIncrement(field: string, by: unknown): string | null {
  if (!isNumericWorldField(field)) return `Field "${field}" cannot be incremented`;
  if (!WORLD_FIELDS[field].incrementable) return `Field "${field}" cannot be incremented`;
  if (typeof by !== 'number' || !Number.isInteger(by)) {
    return `Increment for "${field}" must be an integer`;
  }
  return null;
}

export function isNarrativeEventId(value: unknown): value is NarrativeEventId {
  return typeof value === 'string' && NARRATIVE_EVENT_PATTERN.test(value);
}
