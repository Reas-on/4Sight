import {
  SimulationAbortedError,
  SimulationDecisionTimeoutError,
} from './errors.js';
import type { DecisionContext, DecisionProvider } from './types.js';

export interface DecisionRequestOptions {
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly sequence: number;
}

export function requestDecision(
  provider: DecisionProvider,
  context: DecisionContext,
  options: DecisionRequestOptions,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      options.signal.removeEventListener('abort', onAbort);
    };

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const succeed = (value: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const onAbort = (): void => {
      fail(new SimulationAbortedError(options.sequence));
    };

    if (options.signal.aborted) {
      fail(new SimulationAbortedError(options.sequence));
      return;
    }

    timer = setTimeout(() => {
      fail(new SimulationDecisionTimeoutError(options.timeoutMs, options.sequence));
    }, options.timeoutMs);
    options.signal.addEventListener('abort', onAbort, { once: true });

    Promise.resolve()
      .then(() => {
        if (options.signal.aborted) {
          throw new SimulationAbortedError(options.sequence);
        }
        return provider.decide(context);
      })
      .then(
        (decision) => {
          succeed(decision);
        },
        (error: unknown) => {
          fail(
            error instanceof Error
              ? error
              : new Error(`Decision provider failed: ${String(error)}`),
          );
        },
      );
  });
}
