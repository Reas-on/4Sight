import { NarrativeError } from '../narrative/errors.js';
import { RefereeError } from '../referee/errors.js';
import type {
  SimulationErrorInfo,
  SimulationErrorPhase,
} from './types.js';

export class SimulationError extends Error {
  readonly code: string;
  readonly details?: readonly string[];

  constructor(code: string, message: string, details?: readonly string[]) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export class SimulationConfigurationError extends SimulationError {
  constructor(message: string, details?: readonly string[]) {
    super('SIMULATION_CONFIGURATION_ERROR', message, details);
  }
}

export class SimulationNotFoundError extends SimulationError {
  constructor(runId: string) {
    super('SIMULATION_NOT_FOUND', `Simulation run "${runId}" does not exist`);
  }
}

export class SimulationLifecycleError extends SimulationError {
  constructor(message: string, details?: readonly string[]) {
    super('INVALID_LIFECYCLE_TRANSITION', message, details);
  }
}

export class SimulationProviderError extends SimulationError {
  constructor(code: string, message: string, details?: readonly string[]) {
    super(code, message, details);
  }
}

export class SimulationDecisionTimeoutError extends SimulationError {
  constructor(timeoutMs: number, sequence: number) {
    super(
      'DECISION_TIMEOUT',
      `Decision provider did not respond within ${timeoutMs}ms`,
      [`sequence=${sequence}`, `timeoutMs=${timeoutMs}`],
    );
  }
}

export class SimulationAbortedError extends SimulationError {
  constructor(sequence: number) {
    super('SIMULATION_ABORTED', 'Decision request was aborted', [
      `sequence=${sequence}`,
    ]);
  }
}

export class SimulationNarrativeError extends SimulationError {
  constructor(code: string, message: string, details?: readonly string[]) {
    super(code, message, details);
  }
}

export class SimulationRefereeError extends SimulationError {
  constructor(code: string, message: string, details?: readonly string[]) {
    super(code, message, details);
  }
}

export function toSimulationErrorInfo(
  error: unknown,
  phase: SimulationErrorPhase,
  sequence?: number,
): SimulationErrorInfo {
  const base =
    error instanceof SimulationError || error instanceof NarrativeError || error instanceof RefereeError
      ? {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: Object.freeze([...error.details]) }),
        }
      : {
          code: 'SIMULATION_UNKNOWN_ERROR',
          message: error instanceof Error ? error.message : String(error),
        };

  return Object.freeze({
    ...base,
    phase,
    ...(sequence === undefined ? {} : { sequence }),
  });
}
