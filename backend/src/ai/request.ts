import { AiProviderError } from './errors.js';
import { MAX_RESPONSE_BYTES } from './types.js';

export function inferenceBudget(timeoutMs: number, maxRetries: number): number {
  return timeoutMs * (maxRetries + 1) + 2000 * maxRetries;
}

function retryDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function withSignal<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = (): void => reject(signal.reason);
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return operation();
    }).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

export async function runInference<T>(
  timeoutMs: number,
  maxRetries: number,
  parentSignal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const deadline = new AbortController();
  const budget = inferenceBudget(timeoutMs, maxRetries);
  const endsAt = Date.now() + budget;
  const deadlineTimer = setTimeout(() => deadline.abort(new AiProviderError('PROVIDER_TIMEOUT')), budget);
  const signal = AbortSignal.any([parentSignal, deadline.signal]);
  try {
    for (let attempt = 0; ; attempt += 1) {
      if (signal.aborted) throw new AiProviderError(parentSignal.aborted ? 'PROVIDER_CANCELLED' : 'PROVIDER_TIMEOUT');
      const attemptController = new AbortController();
      const attemptTimer = setTimeout(() => attemptController.abort(new AiProviderError('PROVIDER_TIMEOUT')), timeoutMs);
      const attemptSignal = AbortSignal.any([signal, attemptController.signal]);
      let failure: AiProviderError;
      try {
        const result = await withSignal(() => operation(attemptSignal), attemptSignal);
        if (signal.aborted) throw new AiProviderError('PROVIDER_CANCELLED');
        return result;
      } catch (error) {
        if (parentSignal.aborted) throw new AiProviderError('PROVIDER_CANCELLED');
        if (deadline.signal.aborted) throw new AiProviderError('PROVIDER_TIMEOUT');
        failure = attemptController.signal.aborted
          ? new AiProviderError('PROVIDER_TIMEOUT')
          : error instanceof AiProviderError ? error
          : new AiProviderError(error instanceof SyntaxError ? 'INVALID_AI_OUTPUT'
            : error instanceof Error && error.name === 'TimeoutError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE');
      } finally {
        clearTimeout(attemptTimer);
      }
      if (!failure.retryable || attempt >= maxRetries) throw failure;
      const wait = Math.max(Math.min(250 * 2 ** attempt, 2000), failure.retryAfterMs ?? 0);
      if (wait >= endsAt - Date.now()) throw failure;
      try { await retryDelay(wait, signal); }
      catch { throw new AiProviderError(parentSignal.aborted ? 'PROVIDER_CANCELLED' : 'PROVIDER_TIMEOUT'); }
    }
  } finally {
    clearTimeout(deadlineTimer);
  }
}

export async function readBoundedResponse(response: Response, signal: AbortSignal): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (contentLength > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new AiProviderError('PROVIDER_RESPONSE_TOO_LARGE');
  }
  if (!response.body) throw new AiProviderError('INVALID_AI_OUTPUT');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await withSignal(() => reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new AiProviderError('PROVIDER_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
