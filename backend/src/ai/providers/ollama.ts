import type { DecisionContext } from '../../domain/simulation/types.js';
import { validateBudget, validateModel, validateOllamaUrl } from '../config.js';
import { AI_RESPONSE_JSON_SCHEMA, normalizeDecision } from '../decision-normalizer.js';
import { AiProviderError, httpProviderError, retryAfterMilliseconds } from '../errors.js';
import { buildDecisionPrompt } from '../prompt.js';
import { inferenceBudget, readBoundedResponse, runInference } from '../request.js';
import { MAX_OUTPUT_TOKENS, type AiDecisionProvider, type ProviderDependencies } from '../types.js';

export interface OllamaOptions {
  readonly baseUrl: string;
  readonly model?: string;
  readonly requestTimeoutMs: number;
  readonly maxRetries: number;
  readonly additionalContext?: string;
}

export class OllamaDecisionProvider implements AiDecisionProvider {
  readonly id = 'ollama';
  readonly provenance;
  readonly decisionTimeoutMs: number;
  readonly #options: OllamaOptions;
  readonly #endpoint: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: OllamaOptions, dependencies: ProviderDependencies = {}) {
    const model = validateModel(options.model);
    validateBudget(options.requestTimeoutMs, options.maxRetries);
    this.#endpoint = `${validateOllamaUrl(options.baseUrl)}/api/chat`;
    this.#options = Object.freeze({ ...options, model });
    this.#fetch = dependencies.fetch ?? globalThis.fetch;
    this.provenance = Object.freeze({ provider: 'ollama' as const, model });
    this.decisionTimeoutMs = inferenceBudget(options.requestTimeoutMs, options.maxRetries) + 100;
    Object.freeze(this);
  }

  async decide(context: DecisionContext) {
    if (context.signal.aborted) throw new AiProviderError('PROVIDER_CANCELLED');
    const prompt = buildDecisionPrompt(context, this.#options.additionalContext);
    return runInference(this.#options.requestTimeoutMs, this.#options.maxRetries, context.signal, async (signal) => {
      const response = await this.#fetch(this.#endpoint, {
        method: 'POST', signal, redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.provenance.model,
          messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
          format: AI_RESPONSE_JSON_SCHEMA,
          stream: false,
          options: { temperature: 0, num_predict: MAX_OUTPUT_TOKENS },
        }),
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw httpProviderError(response.status, retryAfterMilliseconds(response.headers.get('retry-after')));
      }
      const text = await readBoundedResponse(response, signal);
      let envelope: unknown;
      try { envelope = JSON.parse(text); } catch { throw new AiProviderError('INVALID_AI_OUTPUT'); }
      if (typeof envelope !== 'object' || envelope === null || !('done' in envelope) || envelope.done !== true ||
          !('message' in envelope) || typeof envelope.message !== 'object' || envelope.message === null ||
          !('role' in envelope.message) || envelope.message.role !== 'assistant' ||
          !('content' in envelope.message) || typeof envelope.message.content !== 'string' ||
          ('tool_calls' in envelope.message && (!Array.isArray(envelope.message.tool_calls) || envelope.message.tool_calls.length > 0)) ||
          ('done_reason' in envelope && envelope.done_reason !== 'stop') || 'error' in envelope) {
        throw new AiProviderError('INVALID_AI_OUTPUT');
      }
      return normalizeDecision(envelope.message.content, context, this.id);
    });
  }
}
