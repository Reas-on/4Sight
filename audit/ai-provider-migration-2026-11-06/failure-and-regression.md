# Failure and Regression Report

Migration date: 2026-11-06

## 1. Injected provider failure

The real app was built with an in-process provider factory whose `decide` always throws `AiProviderError('PROVIDER_RATE_LIMITED')`. The provider identity was `modelapi-gpt` / `gpt-6.1-sol`. No application source was changed for the injection.

Observed run: `179113df-cc8e-49a5-80bb-2248bb0f47b7`

| Field | Observed |
|---|---|
| Status | `FAILED` |
| Outcome | `INCONCLUSIVE` |
| Error code | `PROVIDER_RATE_LIMITED` |
| Error phase | `provider` |
| Decisions | 0 |
| Rule adherence | `null` / rendered `N/A` |
| Page errors | none |
| Fallback provider | none |
| Fabricated success | none |

Graph state:

| Node | Persisted status | Rendered status |
|---|---|---|
| N-01 | APPROVED | complete |
| N-02 | APPROVED | complete |
| N-03 | APPROVED | complete |
| N-04 | RUNNING | failed |

This matches the historical failure-handling signature. The durable projection still leaves the in-flight node as `RUNNING` while the frontend maps it to `failed` for a failed run. That is a pre-existing projection limitation, not a GPT-6.1 Sol regression.

Raw evidence: `audit/ai-provider-migration-2026-11-06/evidence/failure-flow.json`.

## 2. Model isolation

A live call with `gpt-audit-missing-20261106` was rejected after 1,718 ms as `MODEL_NOT_FOUND` and produced no decision.

During the first probe, ModelAPI returned HTTP 503 with body code `model_not_found`, which the generic status mapper initially classified as `PROVIDER_UNAVAILABLE`. The adapter now parses the bounded error envelope and maps this provider-specific case to `MODEL_NOT_FOUND`. Unit coverage was added for both `model_not_found` and `invalid_api_key`.

## 3. Automated tests

| Check | Result |
|---|---|
| Backend full suite | 184 passed, 31 skipped; 16 files passed, 4 skipped |
| Root frontend/unit suite | 154 passed; 20 files |
| Backend DB acceptance | 33/33 passed |
| Backend typecheck | Pass |
| Frontend typecheck | Pass |
| Production build | Pass; 1,343.18 kB main chunk warning remains |
| ModelAPI adapter suite | 34/34 passed |
| GPT-6.1 Sol live smoke | PASS, 8,963 ms |
| Gemini live smoke | PASS, 4,757 ms |
| Live browser matrix | 6/6 completed |
| Injected rate-limit run | Failed closed correctly |

## 4. Regression assessment

No migration-specific regression was observed in:

- Gemini or Ollama unit behavior
- fixture-mode selection
- Referee authority
- durable run creation, pause/resume/cancel paths
- SSE ordering and replay
- frontend run restoration
- provider/model provenance
- final outcome/adherence calculation

The frontend now displays `GPT-6.1 Sol · gpt-6.1-sol` for the ModelAPI entry while persisted provenance remains the actual `modelapi-gpt` / `gpt-6.1-sol`.

## 5. Historical issues not reclassified

The prior independent audit documented existing test/documentation drift:

- stale Phase 5 Playwright `N-02` assertion
- beginner Playwright 5-second Results wait with 15-second pass
- developer-origin DB security test coupling
- stale README live-inference claim, now updated
- in-flight graph node left `RUNNING` on terminal provider failure
- coarse 409 suppression in one executor path
- recovery finalizes `RUNNING` but not `CREATED`

These are not attributed to the GPT-6.1 Sol migration. The README live-inference claim was corrected as part of this migration. The other items remain historical follow-ups.
