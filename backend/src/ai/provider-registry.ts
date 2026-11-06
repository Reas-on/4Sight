import { AiProviderError } from './errors.js';
import { GeminiDecisionProvider } from './providers/gemini.js';
import { OllamaDecisionProvider } from './providers/ollama.js';
import { ModelApiDecisionProvider } from './providers/modelapi.js';
import type { AiConfig, AiDecisionProvider, AiProviderName, ProviderDependencies } from './types.js';

export interface ProviderModelOption {
  readonly providerId: string;
  readonly modelId: string | null;
  readonly configured: boolean;
}

export function listProviderModels(config: AiConfig): readonly ProviderModelOption[] {
  return Object.freeze([
    Object.freeze({ providerId: 'modelapi-gpt' as const, modelId: config.modelapiModel ?? null,
      configured: Boolean(config.modelapiApiKey && config.modelapiModel) }),
    Object.freeze({ providerId: 'gemini' as const, modelId: config.geminiModel ?? null,
      configured: Boolean(config.geminiApiKey && config.geminiModel) }),
    Object.freeze({ providerId: 'ollama' as const, modelId: config.ollamaModel ?? null,
      configured: Boolean(config.ollamaModel) }),
  ]);
}

export function createSelectedProvider(
  config: AiConfig,
  providerId: string,
  options: ProviderDependencies & { readonly additionalContext?: string } = {},
): AiDecisionProvider {
  if (providerId !== 'gemini' && providerId !== 'ollama' && providerId !== 'modelapi-gpt') {
    throw new AiProviderError('PROVIDER_NOT_CONFIGURED');
  }
  return createConfiguredProvider(Object.freeze({ ...config, provider: providerId as AiProviderName }), options);
}

export function createConfiguredProvider(
  config: AiConfig,
  options: ProviderDependencies & { readonly additionalContext?: string } = {},
): AiDecisionProvider {
  const common = {
    requestTimeoutMs: config.requestTimeoutMs,
    maxRetries: config.maxRetries,
    ...(options.additionalContext === undefined ? {} : { additionalContext: options.additionalContext }),
  };
  switch (config.provider) {
    case 'gemini':
      return Object.freeze(new GeminiDecisionProvider({
        ...common,
        ...(config.geminiApiKey === undefined ? {} : { apiKey: config.geminiApiKey }),
        ...(config.geminiModel === undefined ? {} : { model: config.geminiModel }),
      }, options));
    case 'ollama':
      return Object.freeze(new OllamaDecisionProvider({
        ...common, baseUrl: config.ollamaBaseUrl,
        ...(config.ollamaModel === undefined ? {} : { model: config.ollamaModel }),
      }, options));
    case 'modelapi-gpt':
      return Object.freeze(new ModelApiDecisionProvider({
        ...common,
        ...(config.modelapiApiKey === undefined ? {} : { apiKey: config.modelapiApiKey }),
        ...(config.modelapiModel === undefined ? {} : { model: config.modelapiModel }),
        ...(config.modelapiReasoningEffort === undefined ? {} : { reasoningEffort: config.modelapiReasoningEffort }),
      }, options));
    default:
      throw new AiProviderError('PROVIDER_NOT_CONFIGURED');
  }
}
