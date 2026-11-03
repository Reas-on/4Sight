import { SimulationProviderError } from '../domain/simulation/errors.js';

export const AI_ERROR_CODES = [
  'PROVIDER_NOT_CONFIGURED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT',
  'PROVIDER_RATE_LIMITED', 'PROVIDER_AUTH_ERROR', 'MODEL_NOT_FOUND',
  'INVALID_AI_OUTPUT', 'PROVIDER_CANCELLED', 'PROVIDER_RESPONSE_TOO_LARGE',
  'PROVIDER_CONFIG_ERROR', 'PROVIDER_REQUEST_REJECTED', 'AI_CONTEXT_TOO_LARGE',
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

const MESSAGES: Record<AiErrorCode, string> = {
  PROVIDER_NOT_CONFIGURED: 'The selected AI provider requires configuration.',
  PROVIDER_UNAVAILABLE: 'The AI provider is temporarily unavailable.',
  PROVIDER_TIMEOUT: 'The AI inference request exceeded its time budget.',
  PROVIDER_RATE_LIMITED: 'The AI provider rate limit was reached.',
  PROVIDER_AUTH_ERROR: 'The AI provider rejected authentication.',
  MODEL_NOT_FOUND: 'The configured AI model is unavailable or not installed.',
  INVALID_AI_OUTPUT: 'The AI response does not satisfy the proposed-decision contract.',
  PROVIDER_CANCELLED: 'The AI inference request was cancelled.',
  PROVIDER_RESPONSE_TOO_LARGE: 'The AI provider response exceeded the size limit.',
  PROVIDER_CONFIG_ERROR: 'The AI provider configuration is invalid.',
  PROVIDER_REQUEST_REJECTED: 'The AI provider rejected the inference request.',
  AI_CONTEXT_TOO_LARGE: 'The AI decision context exceeded the size limit.',
};

export class AiProviderError extends SimulationProviderError {
  declare readonly code: AiErrorCode;
  readonly retryAfterMs: number | undefined;

  constructor(code: AiErrorCode, retryAfterMs?: number) {
    super(code, MESSAGES[code]);
    this.retryAfterMs = retryAfterMs;
  }

  get retryable(): boolean {
    return ['PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT', 'PROVIDER_RATE_LIMITED'].includes(this.code);
  }
}

export function httpProviderError(status: number, retryAfterMs?: number): AiProviderError {
  if (status === 401 || status === 403) return new AiProviderError('PROVIDER_AUTH_ERROR');
  if (status === 404) return new AiProviderError('MODEL_NOT_FOUND');
  if (status === 429) return new AiProviderError('PROVIDER_RATE_LIMITED', retryAfterMs);
  if (status === 408 || status === 504) return new AiProviderError('PROVIDER_TIMEOUT');
  if (status >= 500) return new AiProviderError('PROVIDER_UNAVAILABLE', retryAfterMs);
  return new AiProviderError('PROVIDER_REQUEST_REJECTED');
}

export function retryAfterMilliseconds(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  const delay = value.trim() !== '' && Number.isFinite(seconds)
    ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay >= 0 ? Math.ceil(delay) : undefined;
}

export function geminiHttpError(status: number, body: string, retryAfterMs?: number): AiProviderError {
  let payload: unknown;
  try { payload = JSON.parse(body); } catch { return httpProviderError(status, retryAfterMs); }
  if (typeof payload === 'object' && payload !== null && 'error' in payload &&
      typeof payload.error === 'object' && payload.error !== null && 'details' in payload.error &&
      Array.isArray(payload.error.details)) {
    for (const detail of payload.error.details as unknown[]) {
      if (typeof detail !== 'object' || detail === null) continue;
      if ('reason' in detail && ['API_KEY_INVALID', 'API_KEY_EXPIRED', 'API_KEY_SERVICE_BLOCKED'].includes(String(detail.reason))) {
        return new AiProviderError('PROVIDER_AUTH_ERROR');
      }
      if ('retryDelay' in detail && typeof detail.retryDelay === 'string' && /^\d+(?:\.\d+)?s$/.test(detail.retryDelay)) {
        retryAfterMs = Math.max(retryAfterMs ?? 0, Number(detail.retryDelay.slice(0, -1)) * 1000);
      }
    }
  }
  return httpProviderError(status, retryAfterMs);
}
