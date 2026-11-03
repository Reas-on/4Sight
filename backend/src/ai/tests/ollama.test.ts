import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaDecisionProvider } from '../providers/ollama.js';
import { MAX_RESPONSE_BYTES } from '../types.js';
import { context, deferred, ollamaResponse, validOutput } from './helpers.js';

afterEach(() => vi.useRealTimers());

const options = { baseUrl: 'http://127.0.0.1:11434', model: 'configured-local:model', requestTimeoutMs: 1000, maxRetries: 0 };

describe('Ollama HTTP adapter', () => {
  it('normalizes nonstreaming structured output and uses only the trusted endpoint', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(ollamaResponse());
    const result = await new OllamaDecisionProvider(options, { fetch: transport }).decide(context());
    expect(result).toMatchObject({ ...validOutput, providerId: 'ollama' });
    const [url, init] = transport.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    expect(init?.redirect).toBe('error');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: options.model, stream: false, format: { additionalProperties: false } });
    expect(body.messages.map((message: { role: string }) => message.role)).toEqual(['system', 'user']);
    expect(body.options.num_predict).toBeGreaterThan(0);
  });

  it.each([
    { ...validOutput, actionType: 'execute_command' },
    { ...validOutput, runId: 'model-supplied-run' },
    { ...validOutput, stateVersion: 99 },
    { ...validOutput, parameters: null },
  ])('rejects invalid model decisions', async (output) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(ollamaResponse(output));
    await expect(new OllamaDecisionProvider(options, { fetch: transport }).decide(context()))
      .rejects.toMatchObject({ code: 'INVALID_AI_OUTPUT' });
  });

  it('does not strip markdown or invent missing parameters', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ done: true, message: {
      role: 'assistant', content: '```json\n{}\n```',
    } }));
    await expect(new OllamaDecisionProvider(options, { fetch: transport }).decide(context()))
      .rejects.toMatchObject({ code: 'INVALID_AI_OUTPUT' });
  });

  it('reports a missing downloaded model without retry', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('model missing', { status: 404 }));
    await expect(new OllamaDecisionProvider({ ...options, maxRetries: 2 }, { fetch: transport }).decide(context()))
      .rejects.toMatchObject({ code: 'MODEL_NOT_FOUND' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('retries connection failures with exponential backoff and a strict attempt limit', async () => {
    vi.useFakeTimers();
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed: secret endpoint'));
    const operation = new OllamaDecisionProvider({ ...options, maxRetries: 2 }, { fetch: transport }).decide(context());
    const rejection = expect(operation).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(249);
    expect(transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(499);
    expect(transport).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('cancels retry delays without making another request', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }));
    const operation = new OllamaDecisionProvider({ ...options, maxRetries: 2 }, { fetch: transport }).decide(context(controller.signal));
    const rejection = expect(operation).rejects.toMatchObject({ code: 'PROVIDER_CANCELLED' });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await rejection;
    await vi.advanceTimersByTimeAsync(2000);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('does not exceed the total budget to honor a rate-limit retry hint', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '3600' } }));
    await expect(new OllamaDecisionProvider({ ...options, maxRetries: 2 }, { fetch: transport }).decide(context()))
      .rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('times out and aborts its request', async () => {
    vi.useFakeTimers();
    const pending = deferred<Response>();
    const transport = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
    const operation = new OllamaDecisionProvider({ ...options, requestTimeoutMs: 10 }, { fetch: transport }).decide(context());
    const rejection = expect(operation).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(10);
    await rejection;
    expect(transport.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    pending.resolve(ollamaResponse());
  });

  it('retries a timed-out inference within the same bounded decision budget', async () => {
    vi.useFakeTimers();
    const pending = deferred<Response>();
    const transport = vi.fn<typeof fetch>().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(ollamaResponse());
    const operation = new OllamaDecisionProvider({ ...options, requestTimeoutMs: 10, maxRetries: 1 }, { fetch: transport }).decide(context());
    await vi.advanceTimersByTimeAsync(260);
    expect((await operation).actionType).toBe('triage_alert');
    expect(transport).toHaveBeenCalledTimes(2);
    pending.resolve(ollamaResponse({ ...validOutput, actionType: 'perimeter_block' }));
  });

  it('rejects oversized bodies before parsing, including streamed bodies', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    })));
    await expect(new OllamaDecisionProvider(options, { fetch: transport }).decide(context()))
      .rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_TOO_LARGE' });
  });
});
