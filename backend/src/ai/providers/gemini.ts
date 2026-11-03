import { GoogleGenAI } from '@google/genai';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { DecisionContext } from '../../domain/simulation/types.js';
import { validateBudget, validateModel } from '../config.js';
import { AI_RESPONSE_JSON_SCHEMA, normalizeDecision } from '../decision-normalizer.js';
import { AiProviderError, geminiHttpError, retryAfterMilliseconds } from '../errors.js';
import { buildDecisionPrompt } from '../prompt.js';
import { inferenceBudget, readBoundedResponse, runInference } from '../request.js';
import { MAX_OUTPUT_TOKENS, type AiDecisionProvider, type ProviderDependencies } from '../types.js';

export interface GeminiOptions {
  readonly apiKey?: string;
  readonly model?: string;
  readonly requestTimeoutMs: number;
  readonly maxRetries: number;
  readonly additionalContext?: string;
}

const GeminiEnvelopeSchema = Type.Object({
  candidates: Type.Array(Type.Object({
    finishReason: Type.Literal('STOP'),
    content: Type.Object({
      parts: Type.Array(Type.Object({
        text: Type.String(),
        thought: Type.Optional(Type.Boolean()),
        thoughtSignature: Type.Optional(Type.String()),
      }, { additionalProperties: false }), { minItems: 1 }),
    }),
  }), { minItems: 1, maxItems: 1 }),
});

export class GeminiDecisionProvider implements AiDecisionProvider {
  readonly id = 'gemini';
  readonly provenance;
  readonly decisionTimeoutMs: number;
  readonly #client: GoogleGenAI;
  readonly #options: GeminiOptions;

  constructor(options: GeminiOptions, dependencies: ProviderDependencies = {}) {
    if (!options.apiKey?.trim()) throw new AiProviderError('PROVIDER_NOT_CONFIGURED');
    const model = validateModel(options.model);
    validateBudget(options.requestTimeoutMs, options.maxRetries);
    this.#options = Object.freeze({ ...options, model });
    this.provenance = Object.freeze({ provider: 'gemini' as const, model });
    this.decisionTimeoutMs = inferenceBudget(options.requestTimeoutMs, options.maxRetries) + 100;
    const transport = dependencies.fetch ?? globalThis.fetch;
    this.#client = new GoogleGenAI({
      apiKey: options.apiKey,
      vertexai: false,
      httpOptions: {
        baseUrl: 'https://generativelanguage.googleapis.com',
        retryOptions: { attempts: 1 },
        fetch: async (input, init) => {
          const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
          if (url.origin !== 'https://generativelanguage.googleapis.com') {
            throw new AiProviderError('PROVIDER_CONFIG_ERROR');
          }
          const response = await transport(input, { ...init, redirect: 'error' });
          if (!response.ok) {
            const body = response.body
              ? await readBoundedResponse(response, init?.signal ?? new AbortController().signal) : '';
            throw geminiHttpError(response.status, body, retryAfterMilliseconds(response.headers.get('retry-after')));
          }
          const text = await readBoundedResponse(response, init?.signal ?? new AbortController().signal);
          let envelope: unknown;
          try { envelope = JSON.parse(text); } catch { throw new AiProviderError('INVALID_AI_OUTPUT'); }
          if (!Value.Check(GeminiEnvelopeSchema, envelope)) {
            throw new AiProviderError('INVALID_AI_OUTPUT');
          }
          return new Response(text, { status: response.status, headers: { 'content-type': 'application/json' } });
        },
      },
    });
    Object.freeze(this);
  }

  async decide(context: DecisionContext) {
    if (context.signal.aborted) throw new AiProviderError('PROVIDER_CANCELLED');
    const prompt = buildDecisionPrompt(context, this.#options.additionalContext, [this.#options.apiKey ?? '']);
    return runInference(this.#options.requestTimeoutMs, this.#options.maxRetries, context.signal, async (signal) => {
      const response = await this.#client.models.generateContent({
        model: this.provenance.model,
        contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
        config: {
          systemInstruction: prompt.system,
          responseMimeType: 'application/json',
          responseJsonSchema: AI_RESPONSE_JSON_SCHEMA,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          candidateCount: 1,
          automaticContinuation: false,
          abortSignal: signal,
          httpOptions: { timeout: this.#options.requestTimeoutMs, retryOptions: { attempts: 1 } },
        },
      });
      const candidate = response.candidates?.[0];
      if (response.candidates?.length !== 1 || candidate?.finishReason !== 'STOP' ||
          !candidate.content?.parts?.length) throw new AiProviderError('INVALID_AI_OUTPUT');
      const parts = candidate.content.parts;
      if (parts.some((part) => !part || typeof part.text !== 'string' ||
          part.functionCall || part.executableCode || part.codeExecutionResult || part.inlineData || part.fileData)) {
        throw new AiProviderError('INVALID_AI_OUTPUT');
      }
      const text = parts.filter((part) => !part.thought).map((part) => part.text ?? '').join('');
      return normalizeDecision(text, context, this.id);
    });
  }
}
