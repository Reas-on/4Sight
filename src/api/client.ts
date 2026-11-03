import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import contract from "./contract.json";

export class ApiError extends Error {
  constructor(readonly code: string, readonly status = 0) {
    super(code.replaceAll("_", " "));
  }
}

const validators = new Map<string, ValidateFunction>();
export function validate<T>(kind: keyof typeof contract, value: unknown): T {
  let check = validators.get(kind);
  if (!check) {
    const ajv = new Ajv({ strict: false, allErrors: false });
    addFormats(ajv);
    check = ajv.compile(contract[kind]);
    validators.set(kind, check);
  }
  if (!check(value)) throw new ApiError("INVALID_BACKEND_RESPONSE");
  return value as T;
}

export async function checkResponse(response: Response): Promise<void> {
  if (response.ok) return;
  let code = "BACKEND_REQUEST_FAILED";
  try {
    const body = await response.json();
    if (typeof body?.error?.code === "string" && /^[A-Z0-9_]{1,80}$/.test(body.error.code)) code = body.error.code;
  } catch { /* Never show raw HTML/proxy errors. */ }
  throw new ApiError(code, response.status);
}

export async function request<T>(path: string, kind: keyof typeof contract, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  try {
    const response = await fetch(`/api/v1${path}`, {
      ...init, credentials: "same-origin", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
      headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
    });
    await checkResponse(response);
    const text = await response.text();
    if (text.length > 512_000) throw new ApiError("INVALID_BACKEND_RESPONSE");
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new ApiError("INVALID_BACKEND_RESPONSE"); }
    return validate<T>(kind, value);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof ApiError) throw error;
    throw new ApiError(error instanceof Error && error.name === "TimeoutError" ? "BACKEND_TIMEOUT" : "BACKEND_UNAVAILABLE");
  }
}

export const isTerminal = (status: string) => ["COMPLETED", "FAILED", "CANCELLED"].includes(status);
