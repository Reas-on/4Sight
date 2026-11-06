# Compatibility and Provider Contract

Migration date: 2026-11-06
Adapter: `backend/src/ai/providers/modelapi.ts`
Provider ID: `modelapi-gpt`
Model: `gpt-6.1-sol`

## 1. Protocol decision

ModelAPI exposes an OpenAI-compatible Chat Completions endpoint:

```text
POST https://api.modelapi.vn/v1/chat/completions
```

The adapter sends:

- bounded system and user prompts from `buildDecisionPrompt`
- `response_format: { type: "json_object" }`
- `stream: false`
- `max_tokens: 2048`
- configured `reasoning_effort`
- no `temperature` parameter, because the provider reports temperature as unsupported
- no tools, no function calls, no fallback model, and no redirects

The response must contain exactly one assistant choice with `finish_reason: "stop"` and a non-empty string `content`. Multiple choices, truncated output, null/non-string content, tool calls, refusals, error envelopes, and malformed JSON are rejected as `INVALID_AI_OUTPUT`.

## 2. Strict JSON Schema finding

A live probe of the real decision schema with `response_format.type = "json_schema"` and `strict: true` returned HTTP 400:

```text
Invalid schema for response_format '4sight_decision':
In context=('properties', 'parameters'), 'required' is required to be supplied
and to be an array including every key in properties. Missing 'incidentId'.
```

The 4Sight schema intentionally makes `parameters.sourceId` and `parameters.incidentId` optional. ModelAPI requires every declared property under strict mode, so strict provider-native JSON Schema is not compatible with the existing contract without changing the domain schema.

The same request with `response_format: { type: "json_object" }` returned HTTP 200, `finish_reason: stop`, and valid content:

```json
{"actionType":"triage_alert","parameters":{},"storyletId":"triage-ssh-brute-force","outcomeId":"confirm-threat"}
```

`normalizeDecision` parsed it successfully. Local TypeBox validation and the unchanged Referee remain authoritative.

## 3. Error mapping

The generic OpenAI-compatible status mapping is preserved:

| HTTP status | Error code | Retryable |
|---:|---|---|
| 400 | `PROVIDER_REQUEST_REJECTED` | No |
| 401 / 403 | `PROVIDER_AUTH_ERROR` | No |
| 404 | `MODEL_NOT_FOUND` | No |
| 408 / 504 | `PROVIDER_TIMEOUT` | Yes |
| 429 | `PROVIDER_RATE_LIMITED` | Yes |
| 5xx | `PROVIDER_UNAVAILABLE` | Yes |

ModelAPI reports a missing model as HTTP 503 with a body error code of `model_not_found`, not HTTP 404. A ModelAPI-specific body classifier maps that case to `MODEL_NOT_FOUND` without exposing the upstream message. It also maps provider `invalid_api_key` / authentication error codes to `PROVIDER_AUTH_ERROR`.

Live missing-model verification after the classifier change:

```json
{"status":"PASS","code":"MODEL_NOT_FOUND","elapsedMs":1718}
```

The raw upstream response was:

```json
{"status":503,"body":"{\"error\":{\"code\":\"model_not_found\",\"message\":\"No available channel for model ...\"}}"}
```

## 4. Request and resource bounds

- Per-attempt timeout: existing `AI_REQUEST_TIMEOUT_MS`
- Additional attempts: existing `AI_MAX_RETRIES`, maximum 3
- Total inference budget: existing `inferenceBudget`
- Prompt/context: at most 32 KiB
- Complete response: at most 64 KiB before parsing
- Decision text: at most 16 KiB
- Output tokens: 2,048
- Oversized error bodies and success bodies: rejected or bounded
- Redirects: disabled
- Cancellation and retry delays: honor the run signal

## 5. Credential and origin isolation

- ModelAPI origin/path is fixed and validated; scenario data cannot change it.
- The API key is never placed in the request body or prompt.
- Known configured keys are scrubbed from Additional Context and scenario text.
- Upstream error bodies and raw prompts/responses are not logged.
- The model cannot choose a provider, model, endpoint, tool, or Referee verdict.
- No automatic provider/model fallback exists.

## 6. Contract test coverage

`backend/src/ai/tests/modelapi.test.ts` provides 34 passing cases covering:

- successful normalization and provenance
- exact trusted endpoint, redirect policy, headers, request body, and reasoning effort
- `response_format: json_object`
- reasoning-field exclusion from the decision
- invalid decisions and extra authoritative fields
- truncated, tool-shaped, multiple-choice, missing-content, and error envelopes
- markdown rejection
- HTTP status mapping and secret suppression
- ModelAPI `model_not_found` and `invalid_api_key` body mapping
- retry bounds, Retry-After, cancellation, and total-budget behavior
- timeout and oversized response handling
- missing-credential rejection
- unsafe endpoint rejection
- Additional Context credential redaction

Additional integration coverage verifies configuration, default model, provider selection, and multi-provider listing.
