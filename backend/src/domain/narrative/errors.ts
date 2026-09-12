import type { NarrativeErrorInfo } from './types.js';

export class NarrativeError extends Error {
  readonly code: string;
  readonly details?: readonly string[];

  constructor(code: string, message: string, details?: readonly string[]) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  toInfo(): NarrativeErrorInfo {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

export class NarrativeValidationError extends NarrativeError {
  constructor(message: string, details?: readonly string[]) {
    super('NARRATIVE_VALIDATION_ERROR', message, details);
  }
}

export class NarrativeConditionError extends NarrativeError {
  constructor(code: string, message: string, details?: readonly string[]) {
    super(code, message, details);
  }
}

export class NarrativeEffectError extends NarrativeError {
  constructor(code: string, message: string, details?: readonly string[]) {
    super(code, message, details);
  }
}

export class NarrativeTransitionError extends NarrativeError {
  constructor(code: string, message: string, details?: readonly string[]) {
    super(code, message, details);
  }
}

export class NarrativeDeadEndError extends NarrativeError {
  constructor(message: string, details?: readonly string[]) {
    super('NARRATIVE_DEAD_END', message, details);
  }
}

export class NarrativeStepLimitError extends NarrativeError {
  constructor(message: string, details?: readonly string[]) {
    super('NARRATIVE_STEP_LIMIT', message, details);
  }
}

export function toNarrativeErrorInfo(error: unknown): NarrativeErrorInfo {
  if (error instanceof NarrativeError) return error.toInfo();
  return {
    code: 'NARRATIVE_UNKNOWN_ERROR',
    message: error instanceof Error ? error.message : String(error),
  };
}
