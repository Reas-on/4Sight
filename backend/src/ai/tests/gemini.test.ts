import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiDecisionProvider } from '../providers/gemini.js';
import { MAX_RESPONSE_BYTES } from '../types.js';
import { context, deferred, geminiResponse, validOutput } from './helpers.js';

afterEach(() => vi.useRealTimers());

const options = { apiKey: 'test-server-key', model: 'configured-test-model', requestTimeoutMs: 1000, maxRetries: 0 };

describe('Gemini official SDK adapter', () => {
  it('normalizes structured SDK output and sends separated instructions/schema', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(geminiResponse());
    const provider = new GeminiDecisionProvider(options, { fetch: transport });

    const result = await provider.decide(context());

    expect(result).toMatchObject({ ...validOutput, providerId: 'gemini' });
    expect(result.decisionId).toMatch(/^ai-[a-f0-9]+-v0-s1$/);
    expect(Object.isFrozen(result)).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0]!;
    expect(String(url)).toContain('/models/configured-test-model:generateContent');
    expect(init?.redirect).toBe('error');
    const body = JSON.parse(String(init?.body));
    expect(body.systemInstruction.parts[0].text).toContain('Referee alone');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseJsonSchema.additionalProperties).toBe(false);
    expect(body.generationConfig.responseJsonSchema.properties.actionType.enum).toContain('perimeter_block');
    expect(String(init?.body)).not.toContain(options.apiKey);
    expect(provider.provenance).toEqual({ provider: 'gemini', model: options.model });
  });

  it.each([
    { ...validOutput, verdict: 'APPROVED' },
    { ...validOutput, effects: [{ field: 'incidentStatus', value: 'resolved' }] },
    { ...validOutput, parameters: { command: 'arbitrary command' } },
    { actionType: 'triage_alert', parameters: {} },
  ])('rejects extra authoritative or incomplete fields without repairing them', async (output) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(geminiResponse(output));
    const provider = new GeminiDecisionProvider({ ...options, maxRetries: 2 }, { fetch: transport });
    await expect(provider.decide(context())).rejects.toMatchObject({ code: 'INVALID_AI_OUTPUT' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('rejects truncated or tool-shaped SDK candidates', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ candidates: [{
      finishReason: 'MAX_TOKENS', content: { parts: [{ text: JSON.stringify(validOutput) }] },
    }] }));
    await expect(new GeminiDecisionProvider(options, { fetch: transport }).decide(context()))
      .rejects.toMatchObject({ code: 'INVALID_AI_OUTPUT' });
  });

  it.each([[401, 'PROVIDER_AUTH_ERROR'], [403, 'PROVIDER_AUTH_ERROR'], [404, 'MODEL_NOT_FOUND'], [400, 'PROVIDER_REQUEST_REJECTED']])(
    'classifies HTTP %s as non-retryable %s and suppresses upstream secrets', async (status, code) => {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('Authorization: secret-upstream', { status: Number(status) }));
      const operation = new GeminiDecisionProvider({ ...options, maxRetries: 2 }, { fetch: transport }).decide(context());
      await expect(operation).rejects.toMatchObject({ code });
      await expect(operation).rejects.not.toThrow('secret-upstream');
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );

  it('bounds retries, disables SDK retries, and respects Retry-After', async () => {
    vi.useFakeTimers();
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '1' } }))
      .mockResolvedValueOnce(geminiResponse());
    const operation = new GeminiDecisionProvider({ ...options, maxRetries: 1 }, { fetch: transport }).decide(context());
    await vi.advanceTimersByTimeAsync(999);
    expect(transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await operation).actionType).toBe('triage_alert');
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('recognizes Gemini HTTP 400 invalid-key details as a non-retryable authentication error', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: {
      message: 'Do not disclose this upstream text', details: [{ reason: 'API_KEY_INVALID' }],
    } }, { status: 400 }));
    await expect(new GeminiDecisionProvider({ ...options, maxRetries: 2 }, { fetch: transport }).decide(context()))
      .rejects.toMatchObject({ code: 'PROVIDER_AUTH_ERROR' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('times out even if transport ignores cancellation', async () => {
    vi.useFakeTimers();
    const pending = deferred<Response>();
    const transport = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
    const operation = new GeminiDecisionProvider({ ...options, requestTimeoutMs: 10 }, { fetch: transport }).decide(context());
    const rejection = expect(operation).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(10);
    await rejection;
    expect(transport.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    pending.resolve(geminiResponse());
  });

  it('enforces response bytes before SDK JSON parsing', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{'.repeat(MAX_RESPONSE_BYTES + 1)));
    await expect(new GeminiDecisionProvider(options, { fetch: transport }).decide(context()))
      .rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_TOO_LARGE' });
  });

  it('rejects malformed SDK envelope data without classifying it as a retryable outage', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ candidates: [{
      finishReason: 'STOP', content: { parts: 'invalid-parts' },
    }] }));
    await expect(new GeminiDecisionProvider({ ...options, maxRetries: 2 }, { fetch: transport }).decide(context()))
      .rejects.toMatchObject({ code: 'INVALID_AI_OUTPUT' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('refuses missing credentials and never invokes transport', () => {
    const transport = vi.fn<typeof fetch>();
    expect(() => new GeminiDecisionProvider({ ...options, apiKey: '' }, { fetch: transport }))
      .toThrow(expect.objectContaining({ code: 'PROVIDER_NOT_CONFIGURED' }));
    expect(transport).not.toHaveBeenCalled();
  });
});
