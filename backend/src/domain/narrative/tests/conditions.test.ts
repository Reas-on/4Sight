import { describe, expect, it } from 'vitest';
import { evaluateCondition } from '../conditions.js';
import { NarrativeConditionError } from '../errors.js';
import { sshBruteForceInitialStates } from '../scenarios/ssh-brute-force.js';
import type { Condition, ConditionValue, NumericWorldField, ScalarWorldField, WorldState } from '../types.js';

const world = sshBruteForceInitialStates.externalSource;

const equals = (field: ScalarWorldField, value: ConditionValue): Condition => ({
  op: 'equals',
  field,
  value,
});

const notEquals = (field: ScalarWorldField, value: ConditionValue): Condition => ({
  op: 'not_equals',
  field,
  value,
});

const greaterThan = (field: NumericWorldField, value: number): Condition => ({
  op: 'greater_than',
  field,
  value,
});

const lessThan = (field: NumericWorldField, value: number): Condition => ({
  op: 'less_than',
  field,
  value,
});

const all = (...conditions: Condition[]): Condition => ({ op: 'all', conditions });
const any = (...conditions: Condition[]): Condition => ({ op: 'any', conditions });
const not = (condition: Condition): Condition => ({ op: 'not', condition });

describe('evaluateCondition', () => {
  it.each<[string, Condition, boolean]>([
    ['equals match', equals('sourceClassification', 'external'), true],
    ['equals mismatch', equals('sourceClassification', 'internal'), false],
    ['not_equals match', notEquals('incidentStatus', 'resolved'), true],
    ['not_equals mismatch', notEquals('incidentStatus', 'detected'), false],
    ['greater_than match', greaterThan('threatConfidence', 70), true],
    ['greater_than mismatch', greaterThan('threatConfidence', 85), false],
    ['less_than match', lessThan('threatConfidence', 90), true],
    ['less_than mismatch', lessThan('threatConfidence', 85), false],
    [
      'all match',
      all(equals('sourceClassification', 'external'), greaterThan('threatConfidence', 70)),
      true,
    ],
    [
      'all mismatch',
      all(equals('sourceClassification', 'internal'), greaterThan('threatConfidence', 70)),
      false,
    ],
    [
      'any match',
      any(equals('sourceClassification', 'internal'), greaterThan('threatConfidence', 80)),
      true,
    ],
    [
      'any mismatch',
      any(equals('sourceClassification', 'internal'), greaterThan('threatConfidence', 90)),
      false,
    ],
    ['not match', not(equals('sourceClassification', 'internal')), true],
    ['not mismatch', not(equals('sourceClassification', 'external')), false],
    [
      'nested composition',
      all(
        not(equals('sourceProtected', true)),
        any(equals('assetClassification', 'server'), equals('assetClassification', 'workstation')),
      ),
      true,
    ],
  ])('evaluates %s', (_label, condition, expected) => {
    expect(evaluateCondition(condition, world)).toBe(expected);
  });

  it('mutates nothing while evaluating', () => {
    const frozen = Object.freeze({
      ...world,
      completedEvents: Object.freeze([...world.completedEvents]),
    });
    const snapshot = JSON.stringify(frozen);

    expect(evaluateCondition(equals('sourceClassification', 'external'), frozen)).toBe(true);
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });

  it('rejects unsupported operators', () => {
    const condition = {
      op: 'contains',
      field: 'sourceClassification',
      value: 'external',
    } as unknown as Condition;

    expect(() => evaluateCondition(condition, world)).toThrow(NarrativeConditionError);
    expect(() => evaluateCondition(condition, world)).toThrow(/Unsupported condition operator/);
  });

  it('rejects unsupported field references', () => {
    const condition = {
      op: 'equals',
      field: 'unknownField',
      value: 'external',
    } as unknown as Condition;

    expect(() => evaluateCondition(condition, world)).toThrow(/Unknown world state field/);
  });

  it('treats missing values as an explicit error', () => {
    const incomplete = { ...world } as Record<string, unknown>;
    delete incomplete.threatConfidence;

    expect(() =>
      evaluateCondition(greaterThan('threatConfidence', 70), incomplete as unknown as WorldState),
    ).toThrow(/missing required field/);
  });

  it('rejects empty all/any conditions', () => {
    expect(() => evaluateCondition(all(), world)).toThrow(/requires at least one nested condition/);
    expect(() => evaluateCondition(any(), world)).toThrow(/requires at least one nested condition/);
  });
});
