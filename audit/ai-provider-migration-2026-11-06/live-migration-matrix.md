# Live Migration Matrix

Migration date: 2026-11-06
Provider: `modelapi-gpt`
Model: `gpt-6.1-sol`
Reasoning effort: `xhigh`
Environment: real backend, real PostgreSQL, real SSE, real Referee, real frontend, real external inference.

## 1. Six executable selections

All six selections completed with the same outcome, decision count, verdict sequence, adherence, path, and event count as the Gemini baseline.

| Selection | Run UUID | GPT elapsed | Status | Outcome | Decisions | Verdicts | Adherence | Path | Events | Restored |
|---|---|---:|---|---|---:|---|---:|---|---:|---|
| Beginner external | `beef7501-550b-4b64-aae5-a2d7f0489c23` | 11,951 ms | COMPLETED | PASS | 1 | A | 100 | N-01,N-02,N-03,N-04,N-06,N-07,N-08,N-09 | 30 | same UUID |
| Beginner protected internal | `e99abda6-5060-4bf1-8436-0d1372aa6a92` | 9,619 ms | COMPLETED | PASS | 1 | A | 100 | N-01,N-02,N-03,N-05,N-06,N-07,N-08,N-09 | 30 | same UUID |
| SSH external | `3be2e604-7b0f-4f9b-bb53-08e56c2f5251` | 26,088 ms | COMPLETED | PASS | 3 | A,A,A | 100 | N-01,N-04,N-05 | 16 | same UUID |
| SSH protected internal | `442a6299-e8ab-493f-8e58-a4dd0eae4088` | 30,899 ms | COMPLETED | PASS | 4 | A,A,A,A | 100 | N-01,N-04,N-04,N-05 | 20 | same UUID |
| Branch decline | `8570f995-9854-49b7-b8ed-3cf0acb5666a` | 46,556 ms | COMPLETED | FAIL | 4 | A,R,A,A | 75 | N-01,N-02,N-03,N-05 | 20 | same UUID |
| Branch accept / protected internal | `d7c41234-e340-4590-bc8b-10109d1dcdc0` | 61,622 ms | COMPLETED | FAIL | 4 | A,R,A,A | 75 | N-01,N-02,N-03,N-04 | 20 | same UUID |

`A` = APPROVED, `R` = REJECTED.

Totals: 6/6 completed, 17 decisions, 186,735 ms elapsed, no provider errors, no page errors.

## 2. Differential against the Gemini baseline

| Selection | Gemini elapsed | GPT elapsed | Delta | Outcome match | Verdict match | Adherence match | Path match |
|---|---:|---:|---:|---|---|---|---|
| Beginner external | 5,350 ms | 11,951 ms | +6,601 ms | PASS = PASS | A = A | 100 = 100 | exact |
| Beginner protected internal | 6,030 ms | 9,619 ms | +3,589 ms | PASS = PASS | A = A | 100 = 100 | exact |
| SSH external | 11,661 ms | 26,088 ms | +14,427 ms | PASS = PASS | A,A,A = A,A,A | 100 = 100 | exact |
| SSH protected internal | 51,673 ms | 30,899 ms | -20,774 ms | PASS = PASS | A,A,A,A = A,A,A,A | 100 = 100 | exact |
| Branch decline | 12,338 ms | 46,556 ms | +34,218 ms | FAIL = FAIL | A,R,A,A = A,R,A,A | 75 = 75 | exact |
| Branch accept / protected internal | 15,185 ms | 61,622 ms | +46,437 ms | FAIL = FAIL | A,R,A,A = A,R,A,A | 75 = 75 | exact |

The GPT path is slower overall in this sample, but the protected-internal SSH case was faster than Gemini. Latency is provider-variable and remains within the configured inference budget. Correctness, Referee behavior, and final durable evidence match the baseline.

## 3. Browser and transport observations

- Every run used `provider: "modelapi-gpt"` and `model: "gpt-6.1-sol"` in persisted configuration.
- SSE sequences were contiguous and ordered.
- The projected graph matched the committed path.
- Final response status matched the source classification and Referee decisions.
- Reload restored the same UUID.
- No page errors were collected.
- No provider error was recorded.
- The Run selector displayed GPT-6.1 Sol and the backend accepted the selected provider/model.

Screenshots are in `/tmp/opencode/4sight-migration-20261106/`:

- `beginner-live.png`
- `beginner-internal-live.png`
- `ssh-external-live.png`
- `ssh-internal-live.png`
- `branch-decline-live.png`
- `branch-live.png`

Raw summary: `audit/ai-provider-migration-2026-11-06/evidence/ai-flow-summary.json`.

## 4. One-call smoke checks

GPT-6.1 Sol:

```json
{"status":"PASS","check":"one-live-inference","provider":"modelapi-gpt","model":"gpt-6.1-sol","elapsedMs":8963,"schemaValidated":true,"refereeVerdict":"APPROVED","violatedPolicyIds":[],"stateVersion":0,"effectsCommitted":false}
```

Gemini preservation check:

```json
{"status":"PASS","check":"one-live-inference","provider":"gemini","model":"gemini-2.5-flash","elapsedMs":4757,"schemaValidated":true,"refereeVerdict":"APPROVED","violatedPolicyIds":[],"stateVersion":0,"effectsCommitted":false}
```
