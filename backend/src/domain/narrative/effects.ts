import { NarrativeEffectError, NarrativeValidationError } from './errors.js';
import {
  APPENDABLE_FIELD,
  getWorldFieldDefinition,
  isNarrativeEventId,
  isNumericWorldField,
  isScalarWorldField,
  validateFieldValue,
  validateIncrement,
} from './fields.js';
import { freezeWorldState } from './state.js';
import type {
  AssetClassification,
  Effect,
  EscalationStatus,
  IncidentStatus,
  NarrativeEventId,
  ResponseStatus,
  SourceClassification,
  WorldState,
} from './types.js';

interface MutableWorldState {
  sourceClassification: SourceClassification;
  sourceProtected: boolean;
  assetClassification: AssetClassification;
  assetProtected: boolean;
  threatConfidence: number;
  incidentStatus: IncidentStatus;
  escalationStatus: EscalationStatus;
  responseStatus: ResponseStatus;
  escalationAttempts: number;
  completedEvents: NarrativeEventId[];
}

function toMutableWorldState(world: WorldState): MutableWorldState {
  return {
    sourceClassification: world.sourceClassification,
    sourceProtected: world.sourceProtected,
    assetClassification: world.assetClassification,
    assetProtected: world.assetProtected,
    threatConfidence: world.threatConfidence,
    incidentStatus: world.incidentStatus,
    escalationStatus: world.escalationStatus,
    responseStatus: world.responseStatus,
    escalationAttempts: world.escalationAttempts,
    completedEvents: [...world.completedEvents],
  };
}

function assignSetField(
  draft: MutableWorldState,
  field: string,
  value: unknown,
): void {
  if (!isScalarWorldField(field)) {
    throw new NarrativeEffectError(
      'UNSUPPORTED_FIELD',
      `Effect cannot set unsupported world state field "${field}"`,
    );
  }

  const definition = getWorldFieldDefinition(field);
  if (!definition.settable) {
    throw new NarrativeEffectError('UNSUPPORTED_EFFECT', `Field "${field}" cannot be set`);
  }

  const error = validateFieldValue(field, value);
  if (error !== null) {
    throw new NarrativeEffectError('INVALID_EFFECT_VALUE', error);
  }

  switch (field) {
    case 'sourceClassification':
      draft.sourceClassification = value as SourceClassification;
      return;
    case 'sourceProtected':
      draft.sourceProtected = value as boolean;
      return;
    case 'assetClassification':
      draft.assetClassification = value as AssetClassification;
      return;
    case 'assetProtected':
      draft.assetProtected = value as boolean;
      return;
    case 'threatConfidence':
      draft.threatConfidence = value as number;
      return;
    case 'incidentStatus':
      draft.incidentStatus = value as IncidentStatus;
      return;
    case 'escalationStatus':
      draft.escalationStatus = value as EscalationStatus;
      return;
    case 'responseStatus':
      draft.responseStatus = value as ResponseStatus;
      return;
    case 'escalationAttempts':
      draft.escalationAttempts = value as number;
      return;
  }
}

function applyIncrement(
  draft: MutableWorldState,
  field: string,
  by: unknown,
): void {
  const error = validateIncrement(field, by);
  if (error !== null || !isNumericWorldField(field)) {
    throw new NarrativeEffectError(
      'INVALID_EFFECT',
      error ?? `Field "${field}" cannot be incremented`,
    );
  }

  if (!Object.hasOwn(draft, field)) {
    throw new NarrativeEffectError('MISSING_FIELD', `World state is missing field "${field}"`);
  }

  const definition = getWorldFieldDefinition(field);
  const current = draft[field];
  const next = current + (by as number);

  if (next < (definition.min ?? Number.NEGATIVE_INFINITY)) {
    throw new NarrativeEffectError(
      'INVALID_EFFECT_VALUE',
      `Increment would move "${field}" below ${definition.min}`,
    );
  }
  if (next > (definition.max ?? Number.POSITIVE_INFINITY)) {
    throw new NarrativeEffectError(
      'INVALID_EFFECT_VALUE',
      `Increment would move "${field}" above ${definition.max}`,
    );
  }

  draft[field] = next;
}

function applyAppend(
  draft: MutableWorldState,
  field: string,
  value: unknown,
): void {
  if (field !== APPENDABLE_FIELD) {
    throw new NarrativeEffectError(
      'UNSUPPORTED_FIELD',
      `Effect cannot append to unsupported world state collection "${field}"`,
    );
  }
  if (!isNarrativeEventId(value)) {
    throw new NarrativeEffectError(
      'INVALID_EFFECT_VALUE',
      'Appended event identifiers must match "event:<lowercase-kebab-id>"',
    );
  }
  if (draft.completedEvents.includes(value)) {
    throw new NarrativeEffectError(
      'DUPLICATE_EVENT',
      `Event "${value}" has already been recorded`,
    );
  }
  draft.completedEvents.push(value);
}

function applyEffect(draft: MutableWorldState, effect: Effect): void {
  switch (effect.type) {
    case 'set':
      assignSetField(draft, effect.field, effect.value);
      return;
    case 'increment':
      applyIncrement(draft, effect.field, effect.by);
      return;
    case 'append':
      applyAppend(draft, effect.field, effect.value);
      return;
    default: {
      const unsupported = effect as { type?: unknown };
      throw new NarrativeEffectError(
        'UNSUPPORTED_EFFECT',
        `Unsupported effect type "${String(unsupported.type)}"`,
      );
    }
  }
}

export function validateEffectDefinition(effect: Effect, path: string): void {
  switch (effect.type) {
    case 'set': {
      if (!isScalarWorldField(effect.field)) {
        throw new NarrativeValidationError(
          `${path}.field references unsupported world state field "${effect.field}"`,
        );
      }
      const field = getWorldFieldDefinition(effect.field);
      if (!field.settable) {
        throw new NarrativeValidationError(
          `${path}.field references non-settable field "${effect.field}"`,
        );
      }
      const error = validateFieldValue(effect.field, effect.value);
      if (error !== null) {
        throw new NarrativeValidationError(`${path}.value is invalid: ${error}`);
      }
      return;
    }
    case 'increment': {
      const error = validateIncrement(effect.field, effect.by);
      if (error !== null) {
        throw new NarrativeValidationError(`${path} is invalid: ${error}`);
      }
      return;
    }
    case 'append': {
      if (effect.field !== APPENDABLE_FIELD) {
        throw new NarrativeValidationError(
          `${path}.field must reference the "${APPENDABLE_FIELD}" collection`,
        );
      }
      if (!isNarrativeEventId(effect.value)) {
        throw new NarrativeValidationError(
          `${path}.value must match "event:<lowercase-kebab-id>"`,
        );
      }
      return;
    }
    default: {
      const unsupported = effect as { type?: unknown };
      throw new NarrativeValidationError(
        `${path} uses unsupported effect type "${String(unsupported.type)}"`,
      );
    }
  }
}

export function applyEffects(world: WorldState, effects: readonly Effect[]): WorldState {
  const draft = toMutableWorldState(world);

  effects.forEach((effect, index) => {
    try {
      applyEffect(draft, effect);
    } catch (error) {
      if (error instanceof NarrativeEffectError) {
        throw new NarrativeEffectError(
          error.code,
          `Effect at index ${index} failed: ${error.message}`,
          error.details,
        );
      }
      throw error;
    }
  });

  if (draft.completedEvents.length > 100) {
    throw new NarrativeEffectError(
      'INVALID_EFFECT_VALUE',
      'The completed events collection cannot exceed 100 entries',
    );
  }

  return freezeWorldState(draft);
}
