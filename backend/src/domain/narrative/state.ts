import type { NarrativeState, WorldState } from './types.js';

export function cloneWorldState(world: WorldState): WorldState {
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

export function freezeWorldState(world: WorldState): WorldState {
  return Object.freeze({
    ...world,
    completedEvents: Object.freeze([...world.completedEvents]),
  });
}

export function freezeNarrativeState(state: NarrativeState): NarrativeState {
  return Object.freeze({
    ...state,
    initialWorld: freezeWorldState(state.initialWorld),
    world: freezeWorldState(state.world),
    completedStorylets: Object.freeze([...state.completedStorylets]),
  });
}
