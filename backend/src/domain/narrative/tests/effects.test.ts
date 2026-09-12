import { describe, expect, it } from 'vitest';
import { applyEffects } from '../effects.js';
import { NarrativeEffectError } from '../errors.js';
import { sshBruteForceInitialStates } from '../scenarios/ssh-brute-force.js';
import type {
  ConditionValue,
  Effect,
  NarrativeEventId,
  NumericWorldField,
  ScalarWorldField,
} from '../types.js';

const world = sshBruteForceInitialStates.externalSource;

const set = (field: ScalarWorldField, value: ConditionValue): Effect => ({
  type: 'set',
  field,
  value,
});

const increment = (field: NumericWorldField, by: number): Effect => ({
  type: 'increment',
  field,
  by,
});

const append = (value: NarrativeEventId): Effect => ({
  type: 'append',
  field: 'completedEvents',
  value,
});

describe('applyEffects', () => {
  it('sets an approved state field without mutating the input', () => {
    const next = applyEffects(world, [set('incidentStatus', 'triaged')]);

    expect(next.incidentStatus).toBe('triaged');
    expect(next).not.toBe(world);
    expect(world.incidentStatus).toBe('detected');
  });

  it('increments an approved numeric field', () => {
    const next = applyEffects(world, [increment('escalationAttempts', 1)]);

    expect(next.escalationAttempts).toBe(1);
    expect(world.escalationAttempts).toBe(0);
  });

  it('appends a validated event identifier without mutating the input collection', () => {
    const event: NarrativeEventId = 'event:test-detection';
    const next = applyEffects(world, [append(event)]);

    expect(next.completedEvents).toContain(event);
    expect(next.completedEvents).toHaveLength(1);
    expect(world.completedEvents).toHaveLength(0);
    expect(next.completedEvents).not.toBe(world.completedEvents);
  });

  it('rejects an invalid enum value', () => {
    const effect = {
      type: 'set',
      field: 'incidentStatus',
      value: 'invalid-status',
    } as unknown as Effect;

    expect(() => applyEffects(world, [effect])).toThrow(NarrativeEffectError);
    expect(world.incidentStatus).toBe('detected');
  });

  it('rejects exceeding a numeric field boundary', () => {
    expect(() => applyEffects(world, [increment('escalationAttempts', 11)])).toThrow(
      /above 10/,
    );
    expect(world.escalationAttempts).toBe(0);
  });

  it('rejects duplicate appended events', () => {
    const event: NarrativeEventId = 'event:existing';
    const withEvent = applyEffects(world, [append(event)]);

    expect(() => applyEffects(withEvent, [append(event)])).toThrow(/already been recorded/);
  });

  it('rejects the entire transition when any effect is invalid', () => {
    const invalid = increment('escalationAttempts', 99) as Effect;
    const effects: Effect[] = [set('incidentStatus', 'triaged'), invalid];

    expect(() => applyEffects(world, effects)).toThrow(NarrativeEffectError);
    expect(world.incidentStatus).toBe('detected');
    expect(world.escalationAttempts).toBe(0);
  });

  it('rejects unsupported effect evidence', () => {
    const effect = {
      type: 'remove',
      field: 'completedEvents',
      value: 'event:test',
    } as unknown as Effect;

    expect(() => applyEffects(world, [effect])).toThrow(/Unsupported effect type/);
  });
});
