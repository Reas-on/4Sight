# Provider Configuration

Migration date: 2026-11-06
Repository: `/home/white_ember/4sight-sandbox`
Base commit: `a13a1c448f4417fa71b76ef1cdb8c0c95dcc99f7`

## 1. Requested identity

| Field | Requested value |
|---|---|
| Display name | GPT-6.1 Sol |
| Selector | `opencode/gpt-6.1-sol` |
| API model ID | `gpt-6.1-sol` |
| Provider | OpenCode Models / Console |
| Expected external endpoint | `https://opencode.ai/inference/openai/v1/responses` |
| Expected SDK | `@ai-sdk/openai` |

## 2. Actual OpenCode configuration

OpenCode version: `1.18.31`

Source: `~/.config/opencode/opencode.jsonc`

| Field | Observed value |
|---|---|
| Provider ID | `modelapi-gpt` |
| Provider display name | ModelAPI GPT |
| npm adapter | `@ai-sdk/openai-compatible` |
| Base URL | `https://api.modelapi.vn/v1` |
| Model ID | `gpt-6.1-sol` |
| Model display name | GPT 6.1 Sol |
| Reasoning | enabled |
| Reasoning effort | `xhigh` |
| Context limit | `1,000,000` |
| Output limit | `128,000` |
| Variants | `low`, `medium`, `high`, `xhigh` |

`opencode models --verbose modelapi-gpt` resolves only `modelapi-gpt/gpt-6.1-sol`. Reported capabilities:

- `temperature`: unsupported
- `reasoning`: true
- `toolcall`: true
- input/output: text only
- cost fields: zero

`opencode auth list` showed credentials for `DeepSeek`, `modelapi`, and `modelapi-gpt`. No OpenCode Console provider or credential was present.

## 3. Provider identity finding

The requested selector `opencode/gpt-6.1-sol` does not match the locally configured OpenCode provider. The verified provider is `modelapi-gpt/gpt-6.1-sol`, reached through ModelAPI's OpenAI-compatible API.

The migration therefore integrates the actual configured GPT-6.1 Sol provider rather than inventing an OpenCode Console endpoint. 4Sight stores the provider as `modelapi-gpt` with model `gpt-6.1-sol`.

This is a provider-identity discrepancy, not a model-access or compatibility blocker.

## 4. Verified external API

| Check | Result |
|---|---|
| `GET https://api.modelapi.vn/v1/models` | HTTP 200; lists `gpt-6.1-sol` |
| `POST https://api.modelapi.vn/v1/chat/completions` | HTTP 200; response model `gpt-6.1-sol` |
| Authentication | HTTP Bearer credential from OpenCode's `modelapi-gpt` API auth entry |
| Direct structured probe | `json_object` returned valid decision JSON in 4,396 ms |
| `xhigh` reasoning | Accepted by the live model |
| Missing model probe | HTTP 503 with body code `model_not_found` |

No credential, authorization header, or auth-store value was printed, copied into the repository, or included in migration artifacts.

## 5. 4Sight configuration

Environment variables:

| Variable | Value / behavior |
|---|---|
| `AI_PROVIDER` | Defaults to `modelapi-gpt` in `.env.example`; accepts `modelapi-gpt`, `gemini`, `ollama` |
| `MODELAPI_API_KEY` | Server-side credential; not committed |
| `MODELAPI_MODEL` | Default `gpt-6.1-sol` |
| `MODELAPI_REASONING_EFFORT` | `low`, `medium`, `high`, or `xhigh`; default `xhigh` |
| `GEMINI_API_KEY` | Preserved |
| `GEMINI_MODEL` | Preserved |
| `OLLAMA_BASE_URL` | Preserved |
| `OLLAMA_MODEL` | Preserved |

The ModelAPI origin and path are fixed to `https://api.modelapi.vn/v1`. Unsafe schemes, credentials, query strings, fragments, alternate origins, and alternate paths are rejected.

## 6. Default and selectable providers

The model list is ordered:

1. `modelapi-gpt` / `gpt-6.1-sol`
2. `gemini` / configured Gemini model
3. `ollama` / configured Ollama model

Each entry carries a `configured` flag. The frontend selects the first configured model, so GPT-6.1 Sol becomes the default when its credential is present. Gemini and Ollama remain selectable when configured. Fixture mode still exposes only the deterministic fixture.

## 7. Credential handling

Live acceptance used a transient environment value read from the existing OpenCode auth store. Finalization provisioned that authorized credential into the untracked `backend/.env` as `MODELAPI_API_KEY` with mode `0600`, and set `AI_PROVIDER=modelapi-gpt`, `MODELAPI_MODEL=gpt-6.1-sol`, and `MODELAPI_REASONING_EFFORT=xhigh`. The credential value was not printed or committed; the repository documents only the variable name.
