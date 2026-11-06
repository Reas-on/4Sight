import { AiProviderError } from './errors.js';
import type { AiConfig, ModelApiReasoningEffort } from './types.js';

export const MODELAPI_BASE_URL = 'https://api.modelapi.vn/v1';
export const DEFAULT_MODELAPI_MODEL = 'gpt-6.1-sol';
export const DEFAULT_MODELAPI_REASONING_EFFORT: ModelApiReasoningEffort = 'xhigh';

function optional(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

export function validateModel(model: string | undefined): string {
  if (!model) throw new AiProviderError('PROVIDER_NOT_CONFIGURED');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model) || model.includes('..')) {
    throw new AiProviderError('PROVIDER_CONFIG_ERROR');
  }
  return model;
}

export function validateOllamaUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new AiProviderError('PROVIDER_CONFIG_ERROR'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/') {
    throw new AiProviderError('PROVIDER_CONFIG_ERROR');
  }
  return url.origin;
}

export function validateModelApiUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new AiProviderError('PROVIDER_CONFIG_ERROR'); }
  if (url.protocol !== 'https:' || url.origin !== 'https://api.modelapi.vn' ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/v1') {
    throw new AiProviderError('PROVIDER_CONFIG_ERROR');
  }
  return `${url.origin}/v1/chat/completions`;
}

export function validateReasoningEffort(value: string | undefined): ModelApiReasoningEffort {
  const effort = value?.trim() || DEFAULT_MODELAPI_REASONING_EFFORT;
  if (!['low', 'medium', 'high', 'xhigh'].includes(effort)) {
    throw new AiProviderError('PROVIDER_CONFIG_ERROR');
  }
  return effort as ModelApiReasoningEffort;
}

export function validateBudget(timeoutMs: number, maxRetries: number): void {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 120_000 ||
      !Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3) {
    throw new AiProviderError('PROVIDER_CONFIG_ERROR');
  }
}

export function parseAiConfig(source: NodeJS.ProcessEnv): AiConfig {
  const provider = optional(source.AI_PROVIDER);
  if (provider !== undefined && provider !== 'gemini' && provider !== 'ollama' && provider !== 'modelapi-gpt') {
    throw new AiProviderError('PROVIDER_CONFIG_ERROR');
  }
  const requestTimeoutMs = Number(source.AI_REQUEST_TIMEOUT_MS ?? 30_000);
  const maxRetries = Number(source.AI_MAX_RETRIES ?? 2);
  validateBudget(requestTimeoutMs, maxRetries);
  const geminiApiKey = optional(source.GEMINI_API_KEY);
  const geminiModel = optional(source.GEMINI_MODEL);
  const ollamaModel = optional(source.OLLAMA_MODEL);
  const modelapiApiKey = optional(source.MODELAPI_API_KEY);
  const modelapiModel = optional(source.MODELAPI_MODEL) ?? DEFAULT_MODELAPI_MODEL;
  const modelapiReasoningEffort = validateReasoningEffort(source.MODELAPI_REASONING_EFFORT);
  return Object.freeze({
    ...(provider === undefined ? {} : { provider }),
    ...(geminiApiKey === undefined ? {} : { geminiApiKey }),
    ...(geminiModel === undefined ? {} : { geminiModel }),
    ollamaBaseUrl: source.OLLAMA_BASE_URL?.trim() || 'http://127.0.0.1:11434',
    ...(ollamaModel === undefined ? {} : { ollamaModel }),
    ...(modelapiApiKey === undefined ? {} : { modelapiApiKey }),
    modelapiModel,
    modelapiReasoningEffort,
    requestTimeoutMs,
    maxRetries,
  });
}
