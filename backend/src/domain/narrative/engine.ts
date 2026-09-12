import { evaluateCondition } from './conditions.js';
import { applyEffects } from './effects.js';
import {
  NarrativeStepLimitError,
  NarrativeTransitionError,
} from './errors.js';
import { resolveNextStorylet } from './resolver.js';
import {
  validateNarrativeState,
  validateScenarioDefinition,
  validateTransitionRecord,
  validateWorldState,
} from './schemas.js';
import { freezeNarrativeState } from './state.js';
import type {
  AdvanceNarrativeInput,
  AdvanceNarrativeResult,
  NarrativeState,
  ScenarioDefinition,
  StoryletDefinition,
  StoryletOutcome,
  TransitionRecord,
  WorldState,
} from './types.js';

export interface AppliedStoryletOutcome {
  readonly state: NarrativeState;
  readonly record: TransitionRecord;
  readonly storylet: StoryletDefinition;
  readonly outcome: StoryletOutcome;
}

function assertStateMatchesDefinition(
  state: NarrativeState,
  definition: ScenarioDefinition,
): void {
  if (state.scenarioId !== definition.id) {
    throw new NarrativeTransitionError(
      'SCENARIO_MISMATCH',
      `Narrative state belongs to scenario "${state.scenarioId}", not "${definition.id}"`,
    );
  }
}

function findStorylet(
  definition: ScenarioDefinition,
  storyletId: string,
): StoryletDefinition | undefined {
  return definition.storylets.find((storylet) => storylet.id === storyletId);
}

function findOutcome(
  storylet: StoryletDefinition,
  outcomeId: string,
): StoryletOutcome | undefined {
  return storylet.outcomes.find((outcome) => outcome.id === outcomeId);
}

export function initializeScenario(
  definition: ScenarioDefinition,
  initialWorld: WorldState,
): NarrativeState {
  const validDefinition = validateScenarioDefinition(definition);
  const validInitialWorld = validateWorldState(initialWorld);

  return freezeNarrativeState({
    scenarioId: validDefinition.id,
    initialWorld: validInitialWorld,
    world: validInitialWorld,
    version: 0,
    step: 0,
    completedStorylets: [],
    currentStoryletId: null,
    terminal: false,
  });
}

export function applyStoryletOutcome(
  state: NarrativeState,
  definition: ScenarioDefinition,
  storyletId: string,
  outcomeId: string,
): AppliedStoryletOutcome {
  const validDefinition = validateScenarioDefinition(definition);
  const validState = validateNarrativeState(state);
  assertStateMatchesDefinition(validState, validDefinition);

  if (validState.terminal) {
    throw new NarrativeTransitionError(
      'TERMINAL_STATE',
      'Cannot apply a storylet outcome to a terminal narrative state',
    );
  }

  if (validState.step >= validDefinition.maxTransitions) {
    throw new NarrativeStepLimitError(
      `Scenario "${validDefinition.id}" reached its maximum of ${validDefinition.maxTransitions} transitions`,
      [`step=${validState.step}`, `maxTransitions=${validDefinition.maxTransitions}`],
    );
  }

  const storylet = findStorylet(validDefinition, storyletId);
  if (storylet === undefined) {
    throw new NarrativeTransitionError(
      'UNKNOWN_STORYLET',
      `Storylet "${storyletId}" does not exist in scenario "${validDefinition.id}"`,
    );
  }

  if (storylet.oneShot && validState.completedStorylets.includes(storylet.id)) {
    throw new NarrativeTransitionError(
      'CONSUMED_STORYLET',
      `One-shot storylet "${storylet.id}" has already been completed`,
    );
  }

  if (!evaluateCondition(storylet.preconditions, validState.world)) {
    throw new NarrativeTransitionError(
      'PRECONDITION_FAILED',
      `Preconditions for storylet "${storylet.id}" are not satisfied`,
    );
  }

  const outcome = findOutcome(storylet, outcomeId);
  if (outcome === undefined) {
    throw new NarrativeTransitionError(
      'UNKNOWN_OUTCOME',
      `Storylet "${storylet.id}" does not define outcome "${outcomeId}"`,
    );
  }

  const nextWorld = applyEffects(validState.world, outcome.effects);
  const nextVersion = validState.version + 1;
  const nextStep = validState.step + 1;
  const completedStorylets = validState.completedStorylets.includes(storylet.id)
    ? [...validState.completedStorylets]
    : [...validState.completedStorylets, storylet.id];

  const record = validateTransitionRecord(
    Object.freeze({
      sequence: nextStep,
      storyletId: storylet.id,
      outcomeId: outcome.id,
      previousStateVersion: validState.version,
      nextStateVersion: nextVersion,
      appliedEffects: Object.freeze(
        outcome.effects.map((effect) => Object.freeze({ ...effect })),
      ),
      ...(storylet.graphNodeId === undefined ? {} : { graphNodeId: storylet.graphNodeId }),
    }),
  );

  const nextState = freezeNarrativeState({
    scenarioId: validState.scenarioId,
    initialWorld: validState.initialWorld,
    world: nextWorld,
    version: nextVersion,
    step: nextStep,
    completedStorylets,
    currentStoryletId: storylet.id,
    terminal: validState.terminal || storylet.terminal,
  });

  return {
    state: nextState,
    record,
    storylet,
    outcome,
  };
}

export function advanceNarrative(
  state: NarrativeState,
  definition: ScenarioDefinition,
  input: AdvanceNarrativeInput,
): AdvanceNarrativeResult {
  const validDefinition = validateScenarioDefinition(definition);
  const validState = validateNarrativeState(state);
  assertStateMatchesDefinition(validState, validDefinition);

  if (validState.terminal) {
    return { status: 'terminal', state: validState };
  }

  if (validState.step >= validDefinition.maxTransitions) {
    throw new NarrativeStepLimitError(
      `Scenario "${validDefinition.id}" reached its maximum of ${validDefinition.maxTransitions} transitions`,
      [`step=${validState.step}`, `maxTransitions=${validDefinition.maxTransitions}`],
    );
  }

  const resolution = resolveNextStorylet(validState, validDefinition);

  if (resolution.status === 'terminal') {
    return { status: 'terminal', state: validState };
  }

  if (resolution.status === 'dead_end') {
    return {
      status: 'dead_end',
      state: validState,
      error: resolution.error,
    };
  }

  if (input.storyletId !== undefined && input.storyletId !== resolution.storylet.id) {
    throw new NarrativeTransitionError(
      'STORYLET_MISMATCH',
      `Selected storylet "${input.storyletId}" does not match eligible storylet "${resolution.storylet.id}"`,
    );
  }

  const applied = applyStoryletOutcome(
    validState,
    validDefinition,
    resolution.storylet.id,
    input.outcomeId,
  );

  return {
    status: 'advanced',
    state: applied.state,
    record: applied.record,
    storylet: applied.storylet,
    outcome: applied.outcome,
  };
}

export { getEligibleStorylets, resolveNextStorylet } from './resolver.js';
