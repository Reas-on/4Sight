import { NarrativeConditionError, NarrativeValidationError } from './errors.js';
import {
  getWorldFieldDefinition,
  isNumericWorldField,
  isScalarWorldField,
  validateFieldValue,
} from './fields.js';
import type { Condition, ConditionValue, WorldState } from './types.js';
import { assertBoundedNarrativeData } from './limits.js';

function readField(world: WorldState, field: string): unknown {
  if (!isScalarWorldField(field)) {
    throw new NarrativeConditionError(
      'UNSUPPORTED_FIELD',
      `Condition references unsupported world state field "${field}"`,
    );
  }
  if (!Object.hasOwn(world, field)) {
    throw new NarrativeConditionError(
      'MISSING_FIELD',
      `World state is missing required field "${field}"`,
    );
  }
  return world[field];
}

function valuesEqual(left: unknown, right: ConditionValue): boolean {
  return Object.is(left, right);
}

function assertConditionValue(condition: Condition, value: unknown): ConditionValue {
  const field = 'field' in condition ? condition.field : undefined;
  if (field === undefined) {
    throw new NarrativeConditionError('INVALID_CONDITION', 'Condition is missing a field');
  }
  const error = validateFieldValue(field, value);
  if (error !== null) {
    throw new NarrativeConditionError('INVALID_CONDITION_VALUE', error);
  }
  return value as ConditionValue;
}

export function evaluateCondition(condition: Condition, world: WorldState): boolean {
  assertBoundedNarrativeData(condition);
  return evaluateBoundedCondition(condition, world);
}

function evaluateBoundedCondition(condition: Condition, world: WorldState): boolean {
  switch (condition.op) {
    case 'equals': {
      const expected = assertConditionValue(condition, condition.value);
      return valuesEqual(readField(world, condition.field), expected);
    }
    case 'not_equals': {
      const expected = assertConditionValue(condition, condition.value);
      return !valuesEqual(readField(world, condition.field), expected);
    }
    case 'greater_than': {
      if (!isNumericWorldField(condition.field)) {
        throw new NarrativeConditionError(
          'INVALID_OPERATOR',
          `Operator "greater_than" requires a numeric field, received "${condition.field}"`,
        );
      }
      if (typeof condition.value !== 'number' || !Number.isFinite(condition.value)) {
        throw new NarrativeConditionError(
          'INVALID_CONDITION_VALUE',
          'Operator "greater_than" requires a finite numeric value',
        );
      }
      return (readField(world, condition.field) as number) > condition.value;
    }
    case 'less_than': {
      if (!isNumericWorldField(condition.field)) {
        throw new NarrativeConditionError(
          'INVALID_OPERATOR',
          `Operator "less_than" requires a numeric field, received "${condition.field}"`,
        );
      }
      if (typeof condition.value !== 'number' || !Number.isFinite(condition.value)) {
        throw new NarrativeConditionError(
          'INVALID_CONDITION_VALUE',
          'Operator "less_than" requires a finite numeric value',
        );
      }
      return (readField(world, condition.field) as number) < condition.value;
    }
    case 'all': {
      if (condition.conditions.length === 0) {
        throw new NarrativeConditionError(
          'INVALID_CONDITION',
          'Operator "all" requires at least one nested condition',
        );
      }
      return condition.conditions.every((nested) => evaluateBoundedCondition(nested, world));
    }
    case 'any': {
      if (condition.conditions.length === 0) {
        throw new NarrativeConditionError(
          'INVALID_CONDITION',
          'Operator "any" requires at least one nested condition',
        );
      }
      return condition.conditions.some((nested) => evaluateBoundedCondition(nested, world));
    }
    case 'not':
      return !evaluateBoundedCondition(condition.condition, world);
    default: {
      const unsupported = condition as { op?: unknown };
      throw new NarrativeConditionError(
        'UNSUPPORTED_OPERATOR',
        `Unsupported condition operator "${String(unsupported.op)}"`,
      );
    }
  }
}

export function assertConditionReferences(condition: Condition, path: string): void {
  switch (condition.op) {
    case 'equals':
    case 'not_equals': {
      if (!isScalarWorldField(condition.field)) {
        throw new NarrativeValidationError(
          `${path}.field references unsupported world state field "${condition.field}"`,
        );
      }
      const field = getWorldFieldDefinition(condition.field);
      if (!field.conditionable) {
        throw new NarrativeValidationError(
          `${path}.field references non-conditionable field "${condition.field}"`,
        );
      }
      const error = validateFieldValue(condition.field, condition.value);
      if (error !== null) {
        throw new NarrativeValidationError(`${path}.value is invalid: ${error}`);
      }
      return;
    }
    case 'greater_than':
    case 'less_than': {
      if (!isNumericWorldField(condition.field)) {
        throw new NarrativeValidationError(
          `${path}.field must reference a numeric field for operator "${condition.op}"`,
        );
      }
      if (typeof condition.value !== 'number' || !Number.isFinite(condition.value)) {
        throw new NarrativeValidationError(
          `${path}.value must be a finite number for operator "${condition.op}"`,
        );
      }
      return;
    }
    case 'all':
    case 'any': {
      if (!Array.isArray(condition.conditions) || condition.conditions.length === 0) {
        throw new NarrativeValidationError(
          `${path}.conditions must contain at least one condition`,
        );
      }
      condition.conditions.forEach((nested, index) => {
        assertConditionReferences(nested, `${path}.conditions[${index}]`);
      });
      return;
    }
    case 'not':
      assertConditionReferences(condition.condition, `${path}.condition`);
      return;
    default: {
      const unsupported = condition as { op?: unknown };
      throw new NarrativeValidationError(
        `${path} uses unsupported condition operator "${String(unsupported.op)}"`,
      );
    }
  }
}
