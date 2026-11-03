import { AiProviderError } from './errors.js';
import { GeminiDecisionProvider } from './providers/gemini.js';
import { OllamaDecisionProvider } from './providers/ollama.js';
import type { AiConfig, AiDecisionProvider, ProviderDependencies } from './types.js';

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
    default:
      throw new AiProviderError('PROVIDER_NOT_CONFIGURED');
  }
}
