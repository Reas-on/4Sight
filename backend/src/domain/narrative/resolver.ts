import { evaluateCondition } from './conditions.js';
import { NarrativeDeadEndError } from './errors.js';
import type {
  NarrativeState,
  NextStoryletResolution,
  ScenarioDefinition,
  StoryletDefinition,
} from './types.js';

function compareStorylets(left: StoryletDefinition, right: StoryletDefinition): number {
  if (left.priority !== right.priority) return right.priority - left.priority;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function isConsumed(state: NarrativeState, storylet: StoryletDefinition): boolean {
  return storylet.oneShot && state.completedStorylets.includes(storylet.id);
}

export function getEligibleStorylets(
  state: NarrativeState,
  definition: ScenarioDefinition,
): readonly StoryletDefinition[] {
  return definition.storylets
    .filter((storylet) => !isConsumed(state, storylet))
    .filter((storylet) => evaluateCondition(storylet.preconditions, state.world))
    .sort(compareStorylets);
}

export function resolveNextStorylet(
  state: NarrativeState,
  definition: ScenarioDefinition,
): NextStoryletResolution {
  const sequence = state.step + 1;

  if (state.terminal) {
    return {
      status: 'terminal',
      sequence,
      eligibleStoryletIds: [],
    };
  }

  const eligible = getEligibleStorylets(state, definition);

  if (eligible.length === 0) {
    const error = new NarrativeDeadEndError(
      `No eligible storylet remains for scenario "${definition.id}" at state version ${state.version}`,
    );
    return {
      status: 'dead_end',
      sequence,
      eligibleStoryletIds: [],
      error: error.toInfo(),
    };
  }

  const [selected] = eligible;
  if (selected === undefined) {
    const error = new NarrativeDeadEndError(
      `No eligible storylet remains for scenario "${definition.id}" at state version ${state.version}`,
    );
    return {
      status: 'dead_end',
      sequence,
      eligibleStoryletIds: [],
      error: error.toInfo(),
    };
  }

  return {
    status: 'eligible',
    storylet: selected,
    sequence,
    eligibleStoryletIds: eligible.map((storylet) => storylet.id),
  };
}
