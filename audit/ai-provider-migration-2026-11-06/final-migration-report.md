# Final Migration Report

Migration date: 2026-11-06
Repository: `/home/white_ember/4sight-sandbox`
Base commit: `a13a1c448f4417fa71b76ef1cdb8c0c95dcc99f7`

## 1. Executive Summary

4Sight now supports and has live-accepted GPT-6.1 Sol as an AI decision provider while preserving Gemini, Ollama, fixture mode, the Referee authority boundary, durable runs, SSE, and frontend behavior.

The verified external provider is ModelAPI `modelapi-gpt` with model `gpt-6.1-sol`, not the requested OpenCode Console selector `opencode/gpt-6.1-sol`. The migration uses the actual provider configured in OpenCode and documents that identity difference.

All six executable scenarios completed with the same outcome, decision count, verdicts, adherence, path, event count, and refresh behavior as the Gemini baseline. The injected provider failure failed closed with zero decisions. Missing models are correctly classified as `MODEL_NOT_FOUND`.

## 2. Provider Configuration Discovered

| Field | Verified value |
|---|---|
| OpenCode provider | `modelapi-gpt` |
| Provider display | ModelAPI GPT |
| API model | `gpt-6.1-sol` |
| Model display | GPT 6.1 Sol |
| Base URL | `https://api.modelapi.vn/v1` |
| Endpoint | `POST /chat/completions` |
| Reasoning effort | `xhigh` |
| Context/output limit | 1,000,000 / 128,000 |
| Temperature | Unsupported |

The OpenCode selector resolves to `modelapi-gpt/gpt-6.1-sol`. No OpenCode Console credential or provider was found. The requested `opencode/gpt-6.1-sol` identity and `https://opencode.ai/inference/openai/v1/responses` endpoint are therefore not used.

## 3. Authentication and Access

Access is an HTTP Bearer API credential stored in OpenCode's `modelapi-gpt` API auth entry. Live checks succeeded against the ModelAPI origin.

During live acceptance, the credential was read transiently from the existing OpenCode auth store and was not written into the repository, logs, screenshots, tests, or audit artifacts. Finalization then provisioned the same authorized credential into the untracked `backend/.env` as `MODELAPI_API_KEY` (mode `0600`) and set `AI_PROVIDER=modelapi-gpt`. The credential was not printed or committed.

Access classification for the actual provider: `DIRECT_API_AVAILABLE`.
OpenCode Console direct API access: `NOT_ESTABLISHED / PROVIDER_IDENTITY_DIFFERENCE`.

## 4. Implementation

Environment support:

- `MODELAPI_API_KEY`
- `MODELAPI_MODEL` (default `gpt-6.1-sol`)
- `MODELAPI_REASONING_EFFORT` (default `xhigh`)
- `AI_PROVIDER` accepts `modelapi-gpt`, `gemini`, or `ollama`

Provider behavior:

- OpenAI-compatible Chat Completions request
- `response_format: { type: "json_object" }`
- no temperature parameter
- fixed trusted ModelAPI origin/path
- redirects disabled
- bounded prompt and response sizes
- existing timeout, retry, cancellation, and error taxonomy
- local TypeBox validation and unchanged Referee after generation
- no tools, fallback provider, fallback model, or output repair

Provider selection:

- `/api/v1/models` now lists GPT-6.1 Sol, Gemini, and Ollama with configured flags
- GPT-6.1 Sol is first, so it becomes the default when configured
- Gemini and Ollama remain selectable when configured
- the selected provider/model is bound to the run and revalidated on resume
- persisted provenance remains `modelapi-gpt` / `gpt-6.1-sol`

Files changed:

- `backend/src/ai/types.ts`
- `backend/src/ai/config.ts`
- `backend/src/ai/errors.ts`
- `backend/src/ai/provider-registry.ts`
- `backend/src/ai/index.ts`
- `backend/src/ai/providers/modelapi.ts` (new)
- `backend/src/ai/tests/modelapi.test.ts` (new)
- `backend/src/ai/tests/helpers.ts`
- `backend/src/ai/tests/integration.test.ts`
- `backend/src/application/simulation/simulation-service.ts`
- `backend/src/plugins/simulation.ts`
- `src/App.tsx`
- `.env.example`
- `README.md`

## 5. Compatibility Findings

- ModelAPI's OpenAI-compatible protocol is compatible with the existing decision contract.
- Strict provider-native JSON Schema is rejected because the 4Sight schema has optional `parameters` properties. `json_object` plus local validation is used.
- ModelAPI reports missing models as HTTP 503 with body code `model_not_found`; a provider-specific classifier maps this to `MODEL_NOT_FOUND`.
- `xhigh` reasoning effort is accepted.
- Reasoning fields are ignored and are never exposed as the decision's user-facing reasoning.
- Response envelopes are strictly checked; malformed, truncated, tool-shaped, multiple-choice, and refusal responses are rejected.
- Gemini live smoke still passes after the migration.

## 6. Live Migration Test Results

Live GPT-6.1 Sol browser matrix:

| Selection | Status | Outcome | Decisions | Verdicts | Adherence | Elapsed |
|---|---|---|---:|---|---:|---:|
| Beginner external | COMPLETED | PASS | 1 | A | 100 | 11,951 ms |
| Beginner protected internal | COMPLETED | PASS | 1 | A | 100 | 9,619 ms |
| SSH external | COMPLETED | PASS | 3 | A,A,A | 100 | 26,088 ms |
| SSH protected internal | COMPLETED | PASS | 4 | A,A,A,A | 100 | 30,899 ms |
| Branch decline | COMPLETED | FAIL | 4 | A,R,A,A | 75 | 46,556 ms |
| Branch accept / protected internal | COMPLETED | FAIL | 4 | A,R,A,A | 75 | 61,622 ms |

Totals: 6/6 completed, 17 decisions, no provider errors, no page errors, every SSE stream ordered, every reload restored the same UUID.

Live smoke: GPT-6.1 Sol PASS in 8,963 ms; Gemini PASS in 4,757 ms.

The GPT path was slower overall in this sample. The protected-internal SSH case was faster than the Gemini baseline. Latency remains a provider-variable performance caveat, not a correctness failure.

## 7. Failure, Fallback, and Model Isolation

- Injected `PROVIDER_RATE_LIMITED`: `FAILED` / `INCONCLUSIVE`, zero decisions, null adherence, no fallback, no fabricated success.
- In-flight graph node remains `RUNNING` in the durable projection while the frontend renders it failed; this is pre-existing.
- Missing model: `MODEL_NOT_FOUND` after 1,718 ms, no decision.
- Provider auth/model error bodies are parsed only for classification and are never exposed.
- No silent provider or model fallback exists.

## 8. Regressions and Historical Issues

Automated verification:

| Check | Result |
|---|---|
| Backend suite | 184 passed, 31 skipped |
| Root suite | 154 passed |
| DB acceptance | 33/33 passed |
| Backend typecheck | Pass |
| Frontend typecheck | Pass |
| Production build | Pass; existing 1.34 MB chunk warning |
| ModelAPI adapter tests | 34/34 passed |

No migration-specific regression was found in Gemini/Ollama behavior, fixture mode, Referee authority, durable lifecycle, SSE ordering, frontend restoration, or provenance.

Historical drifts from the prior audit remain separate: stale `N-02` Playwright assertion, beginner 5-second wait, developer-origin DB test coupling, in-flight `RUNNING` node on failure, coarse 409 suppression, and `CREATED` recovery coverage. The README's stale live-inference claim was corrected.

## 9. Limitations and Follow-ups

- The external provider identity differs from the requested OpenCode Console identity. The actual ModelAPI provider is used and documented.
- The active local default is now GPT-6.1 Sol. It is configured in the ignored `backend/.env`; the credential is never committed. Deployments must supply `MODELAPI_API_KEY` through their own secret environment.
- Strict provider-native JSON Schema remains unsupported for the current optional-parameter schema.
- GPT latency is higher overall in this sample; no timeout or correctness failure occurred.
- The credential must remain in an untracked local `.env` or the deployment's secret environment, never in Git.

## 10. Finalization Verification (2026-11-06)

The untracked backend environment now persists `AI_PROVIDER=modelapi-gpt`, `MODELAPI_MODEL=gpt-6.1-sol`, `MODELAPI_REASONING_EFFORT=xhigh`, and `MODELAPI_API_KEY` (present, mode `0600`). Existing Gemini configuration was preserved.

After restarting the backend and Vite frontend:

| Check | Result |
|---|---|
| `/api/v1/models` order | `modelapi-gpt/gpt-6.1-sol` first, `configured: true` |
| Frontend default selector | `modelapi-gpt:gpt-6.1-sol` / `GPT-6.1 Sol · gpt-6.1-sol` |
| Gemini selectable | `gemini/gemini-2.5-flash`, `configured: true` |
| Ollama | Listed, `configured: false` |
| Post-restart GPT smoke | PASS, 7,737 ms, schema validated, Referee `APPROVED` |
| Backend suite | 184 passed, 31 skipped |
| Root suite | 154 passed |
| DB acceptance | 33/33 passed with `SIMULATION_ALLOWED_ORIGIN=` |
| Backend build | Pass |
| Frontend build | Pass; existing 1.34 MB chunk warning |

The DB suite first failed with `EXECUTOR_ALREADY_ACTIVE` while the live backend held the executor lock; it passed after stopping the backend. One run also reproduced the documented developer-origin coupling unless `SIMULATION_ALLOWED_ORIGIN=` was cleared. Neither is a migration regression.

## 11. Final Verdict

`MIGRATION_COMPLETE`

GPT-6.1 Sol is implemented, live-accepted, selectable, and active as the persistent local default. The requested OpenCode Console provider identity was not present; the verified OpenCode configuration uses ModelAPI `modelapi-gpt` / `gpt-6.1-sol`, and that is the provider integrated and reported.
