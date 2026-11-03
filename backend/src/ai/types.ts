import type { DecisionProvider } from '../domain/simulation/types.js';

export type AiProviderName = 'gemini' | 'ollama';

export interface AiConfig {
  readonly provider?: AiProviderName;
  readonly geminiApiKey?: string;
  readonly geminiModel?: string;
  readonly ollamaBaseUrl: string;
  readonly ollamaModel?: string;
  readonly requestTimeoutMs: number;
  readonly maxRetries: number;
}

export interface InferencePrompt {
  readonly system: string;
  readonly user: string;
}

export interface AiDecisionProvider extends DecisionProvider {
  readonly provenance: { readonly provider: AiProviderName; readonly model: string };
  readonly decisionTimeoutMs: number;
}

export interface ProviderDependencies {
  readonly fetch?: typeof globalThis.fetch;
}

export const MAX_CONTEXT_BYTES = 32_768;
export const MAX_DECISION_BYTES = 16_384;
export const MAX_RESPONSE_BYTES = 65_536;
export const MAX_OUTPUT_TOKENS = 2048;
