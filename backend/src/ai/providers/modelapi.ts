import type { DecisionContext } from '../../domain/simulation/types.js';
import { MODELAPI_BASE_URL, validateBudget, validateModel, validateModelApiUrl, validateReasoningEffort } from '../config.js';
import { normalizeDecision } from '../decision-normalizer.js';
import { AiProviderError, modelApiHttpError, retryAfterMilliseconds } from '../errors.js';
import { buildDecisionPrompt } from '../prompt.js';
import { inferenceBudget, readBoundedResponse, runInference } from '../request.js';
import { MAX_OUTPUT_TOKENS, type AiDecisionProvider, type ModelApiReasoningEffort, type ProviderDependencies } from '../types.js';

export interface ModelApiOptions {
  readonly apiKey?: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly reasoningEffort?: ModelApiReasoningEffort;
  readonly requestTimeoutMs: number;
  readonly maxRetries: number;
  readonly additionalContext?: string;
}

function extractContent(envelope: unknown): string {
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope) || 'error' in envelope) {
    throw new AiProviderError('INVALID_AI_OUTPUT');
  }
  const choices = (envelope as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length !== 1) throw new AiProviderError('INVALID_AI_OUTPUT');
  const choice = choices[0];
  if (typeof choice !== 'object' || choice === null) throw new AiProviderError('INVALID_AI_OUTPUT');
  const { finish_reason: finishReason, message } = choice as { finish_reason?: unknown; message?: unknown };
  if (finishReason !== 'stop' || typeof message !== 'object' || message === null) {
    throw new AiProviderError('INVALID_AI_OUTPUT');
  }
  const { role, content, tool_calls: toolCalls, refusal } = message as {
    role?: unknown; content?: unknown; tool_calls?: unknown; refusal?: unknown;
  };
  if (role !== 'assistant' || typeof content !== 'string' || content.trim() === '' ||
      (toolCalls !== undefined && (!Array.isArray(toolCalls) || toolCalls.length > 0)) ||
      (refusal !== undefined && refusal !== null && refusal !== '')) {
    throw new AiProviderError('INVALID_AI_OUTPUT');
  }
  return content;
}

export class ModelApiDecisionProvider implements AiDecisionProvider {
  readonly id = 'modelapi-gpt';
  readonly provenance;
  readonly decisionTimeoutMs: number;
  readonly #options: ModelApiOptions;
  readonly #endpoint: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: ModelApiOptions, dependencies: ProviderDependencies = {}) {
    if (!options.apiKey?.trim()) throw new AiProviderError('PROVIDER_NOT_CONFIGURED');
    const model = validateModel(options.model);
    const reasoningEffort = validateReasoningEffort(options.reasoningEffort);
    validateBudget(options.requestTimeoutMs, options.maxRetries);
    this.#endpoint = validateModelApiUrl(options.baseUrl ?? MODELAPI_BASE_URL);
    this.#options = Object.freeze({ ...options, model, reasoningEffort });
    this.#fetch = dependencies.fetch ?? globalThis.fetch;
    this.provenance = Object.freeze({ provider: 'modelapi-gpt' as const, model });
    this.decisionTimeoutMs = inferenceBudget(options.requestTimeoutMs, options.maxRetries) + 100;
    Object.freeze(this);
  }

  async decide(context: DecisionContext) {
    if (context.signal.aborted) throw new AiProviderError('PROVIDER_CANCELLED');
    const prompt = buildDecisionPrompt(context, this.#options.additionalContext, [this.#options.apiKey ?? '']);
    return runInference(this.#options.requestTimeoutMs, this.#options.maxRetries, context.signal, async (signal) => {
      const response = await this.#fetch(this.#endpoint, {
        method: 'POST', signal, redirect: 'error',
        headers: {
          authorization: `Bearer ${this.#options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.provenance.model,
          messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
          response_format: { type: 'json_object' },
          stream: false,
          max_tokens: MAX_OUTPUT_TOKENS,
          reasoning_effort: this.#options.reasoningEffort,
        }),
      });
      if (!response.ok) {
        const retryAfterMs = retryAfterMilliseconds(response.headers.get('retry-after'));
        let body = '';
        try { body = await readBoundedResponse(response, signal); }
        catch { void response.body?.cancel().catch(() => undefined); }
        throw modelApiHttpError(response.status, body, retryAfterMs);
      }
      const text = await readBoundedResponse(response, signal);
      let envelope: unknown;
      try { envelope = JSON.parse(text); } catch { throw new AiProviderError('INVALID_AI_OUTPUT'); }
      return normalizeDecision(extractContent(envelope), context, this.id);
    });
  }
}
