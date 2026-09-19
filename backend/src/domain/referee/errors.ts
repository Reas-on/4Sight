import type { RefereeErrorInfo } from './types.js';

export class RefereeError extends Error {
  readonly code: string;
  readonly details?: readonly string[];

  constructor(code: string, message: string, details?: readonly string[]) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  toInfo(): RefereeErrorInfo {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

export class RefereeValidationError extends RefereeError {
  constructor(message: string, details?: readonly string[]) {
    super('REFEREE_VALIDATION_ERROR', message, details);
  }
}

export class RefereeEvaluationError extends RefereeError {
  constructor(code: string, message: string, details?: readonly string[]) {
    super(code, message, details);
  }
}

export function toRefereeErrorInfo(error: unknown): RefereeErrorInfo {
  if (error instanceof RefereeError) return error.toInfo();
  return {
    code: 'REFEREE_UNKNOWN_ERROR',
    message: error instanceof Error ? error.message : String(error),
  };
}
