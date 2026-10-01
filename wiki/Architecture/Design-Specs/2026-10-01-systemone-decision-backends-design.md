---
type: design-spec
status: approved
created: 2026-10-01
tags: [judgment, decision-models, ollama, systemone, local-ai, privacy]
---

# System One Decision Backends — shared HTTP protocol core + Ollama descriptor

**Authority:** approved via brainstorming session 2026-10-01 (design presented in sections, user approved the two-layer revision).
**Companion plan:** `wiki/Planning/Implementation-Plans/2026-10-01-systemone-decision-backends.md` (written via writing-plans after spec review).

---

## 1. Context & intent

Ollama v0.35.0+ ships a **decision API** (`POST /v1/systemone`, "System One" / Nimble model) that answers `choice`, `noul`, and `score` questions with calibrated probability distributions — the same primitive family `@reactive-agents/judgment` was built around. `packages/judgment/src/types.ts` anticipated this: *"A future open-source System One model, or a second judgment vendor, implements `JudgmentBackend` against these same spec/answer types with zero change to `JudgmentService` or any consumer."*

**Intended outcome:** judgments can be made **completely local and private** by pointing the judgment primitive at Ollama's Nimble model, and the architecture makes adding further System One-protocol providers (hosted or local) a small, mechanical change.

**Success criteria:**

- `.withJudgment({ backend: "ollama" })` produces calibrated (`calibrated: true`) `ChoiceAnswer`/`ScoreAnswer`/`NoulAnswer` from a local Ollama server, with no API key and no outbound network.
- All existing backend-agnostic consumers (`agent.judge()`, `judgeRank()`, adaptive strategy selection, guardrail battery, complexity router, comprehension sites) work against it unchanged.
- A second System One-HTTP provider needs only a new descriptor file + tests — zero engine, service, or consumer changes.
- Existing `jev`/`llm` behavior is byte-for-byte unchanged (selection heuristic untouched; jev stays on `@typesafe-ai/sdk`).

**Precedent followed:** the `@reactive-agents/llm-provider` layering — one shared OpenAI-compatible protocol core with thin per-provider adapters (openai/groq/xai/litellm/ollama). Here: one shared **System One HTTP core** + thin **provider descriptors** (ollama first).

## 2. Architecture

```
packages/judgment/src/backends/
├── systemone-http.ts   ← NEW: protocol engine (fetch-based JudgmentBackend factory)
├── ollama.ts           ← NEW: provider descriptor + makeOllamaBackend()
├── jev-backend.ts      ← UNCHANGED (TypeSafe SDK)
└── llm-backend.ts      ← UNCHANGED (LLMService emulation)
```

Data flow (unchanged at the edges): consumers → `JudgmentService.ask()` → `JudgmentBackend.evaluate()` → (new path) `systemone-http` engine → provider HTTP endpoint. `withEvents` EventBus decoration is backend-agnostic and picks up the new `backend: "ollama"` label with no change.

### 2.1 Protocol engine — `systemone-http.ts`

```ts
export interface SystemOneProviderDescriptor {
  /** Backend label — surfaces in JudgmentEvaluated/JudgmentFailed events. */
  readonly name: string;
  /** Path appended to the resolved endpoint. Default (when omitted): "/v1/systemone". */
  readonly path?: string;
  /** Resolve the base URL from an explicit config value + provider env conventions. */
  readonly resolveEndpoint: (explicit?: string) => string;
  /** Model sent when the caller/consumer doesn't pass one per-call. */
  readonly defaultModel: string;
  /** Per-request timeout when config.timeoutMs is absent (providers differ: jev 3000, ollama 30000). */
  readonly defaultTimeoutMs: number;
  /** Wire-protocol limits enforced BEFORE the request (see §4). */
  readonly limits: {
    readonly maxQuestions: number;
    readonly minCriteria: number;
    readonly maxCriteria: number;
    /** Optional hard request-body ceiling in bytes (Ollama: 64 KiB). */
    readonly maxBodyBytes?: number;
  };
  /** Optional auth/identity headers (empty for local Ollama; the seam hosted providers need). */
  readonly headers?: (config: SystemOneHttpConfig) => Record<string, string>;
  /** Extra request-body fields from resolved config (Ollama: `keep_alive`). */
  readonly extraBodyFields?: (config: SystemOneHttpConfig) => Record<string, unknown>;
  /** Provider-specific remediation hints keyed onto error messages (Ollama 404 → "ollama pull <model>"). */
  readonly describeHttpError?: (status: number, body: string) => string | undefined;
}

export interface SystemOneHttpConfig {
  readonly baseUrl?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly apiKey?: string;
  readonly headers?: Record<string, string>;
  /** Test seam — mirrors TypeSafeClientConfig.fetch; defaults to globalThis.fetch. */
  readonly fetch?: typeof globalThis.fetch;
  /** Provider extension values (e.g. keepAlive for ollama) read by descriptor hooks. */
  readonly providerOptions?: Readonly<Record<string, string | number>>;
}

export const makeSystemOneHttpBackend = (
  descriptor: SystemOneProviderDescriptor,
  config?: SystemOneHttpConfig,
): JudgmentBackend;
```

Engine responsibilities:

1. **Request build.** Serialize `state` + `QuestionSpecs` into the System One JSON body (`{ model, state, questions, ...extraBodyFields }`). Per-call `evaluate`'s `model` argument overrides `config.model`, which overrides `descriptor.defaultModel`.
2. **Entry encoding.** `state` and `instructions` pass through structured (System One's `SystemOneContent` accepts a non-empty string, object, or array). `null`/`undefined` state serializes to `{}` — legal under the non-empty rule and required because `judgeRank()` sends `state: null`. `choice` criteria values and `score` criteria items MUST be strings on the wire: non-string `JudgmentEntry` values are `JSON.stringify`-ed; `null` criteria descriptions stay `null` (choice) / become `""` (score, whose wire items are strings only, and RA `ScoreCriteria` entries are required).
3. **Limit enforcement (§4) before sending** — never truncate, never silently chunk.
4. **HTTP execution.** Single `fetch` with `AbortSignal.timeout(timeoutMs)`, `Content-Type: application/json`, descriptor + config headers merged (config wins).
5. **Response decode.** Effect `Schema.Struct`s for the three answer variants; every requested question id must be present with the matching `type`, or the decode throws → `JudgmentBadResponse` ("never partial-trust a missing answer", same guarantee as `fromSdkResult`).
6. **Error mapping (§5).** Transport/HTTP/timeout failures onto the existing tagged `JudgmentError` union.

Wire types live in `systemone-http.ts` (or a sibling `systemone-wire.ts` if the file grows past ~250 lines). They are plain JSON boundary types — no vendor SDK, so the "only `translate.ts` touches the SDK" isolation rule is untouched.

### 2.2 Ollama descriptor — `ollama.ts`

```ts
export interface OllamaJudgmentConfig {
  readonly baseUrl?: string;      // else OLLAMA_ENDPOINT / OLLAMA_HOST / OLLAMA_BASE env chain
  readonly model?: string;        // default "nimble"
  readonly timeoutMs?: number;    // default 30_000 (cold-load tolerant)
  readonly keepAlive?: string | number; // passed through as keep_alive (e.g. "10m", 0, -1)
  readonly fetch?: typeof globalThis.fetch; // test seam
}

export const makeOllamaBackend = (config?: OllamaJudgmentConfig): JudgmentBackend;
```

Descriptor values:

| Field | Value | Why |
| --- | --- | --- |
| `name` | `"ollama"` | Event label; distinguishes local vs cloud judgment in observability |
| `resolveEndpoint` | delegates to `resolveOllamaEndpoint()` imported from `@reactive-agents/llm-provider` (already exported; judgment already depends on llm-provider) | Single canonical Ollama endpoint resolution — reuses the OLLAMA_ENDPOINT/OLLAMA_HOST/OLLAMA_BASE precedence and bare-`host:port` normalization; no fourth env convention invented |
| `defaultModel` | `"nimble"` | The decision model Ollama ships (`ollama pull nimble`) |
| `defaultTimeoutMs` | `30_000` | Local models cold-load into memory; first call can take tens of seconds. Mirrors `llm-config.ts`'s cold-load-tolerant `ollamaTimeoutMs` precedent. NOT the 3000 `DEFAULT_TIMEOUT_MS` jev uses — documented explicitly |
| `limits` | `{ maxQuestions: 64, minCriteria: 2, maxCriteria: 26, maxBodyBytes: 65_536 }` | Ollama API reference constraints (tighter than TypeSafe's 255-option cap) |
| `extraBodyFields` | `keepAlive` → `{ keep_alive: value }` | Keeps the decision model warm between judgment calls; explicit knob, default omitted (server default 5m) |
| `describeHttpError` | 404 → `"local model not found — run \\`ollama pull <model>\\`"`; 400 mentioning cloud/unsupported → guidance that decision models must be local GGUF | Actionable remediation for the two failure modes unique to Ollama |
| `headers` | omitted (none) | Local server needs no auth; hosted providers add this hook without engine change |

`listModels` is **not** implemented on the ollama backend: `/api/tags` cannot distinguish decision-capable models from chat models, and a misleading catalog is worse than the honest `JudgmentUnsupported` the service already returns when the method is absent.

### 2.3 Response translation (calibration)

| Wire answer | `JudgmentAnswer` | `calibrated` |
| --- | --- | --- |
| `{ type: "choice", choice, probabilities, confidence }` | `{ kind: "choice", value: choice, probabilities, confidence, calibrated: true }` | `true` — logit-derived distribution; confidence is `1 − H(p)/ln(N)`, the same formula TypeSafe documents |
| `{ type: "noul", noul }` | `{ kind: "noul", probability: noul }` | (noul has no confidence field by design) |
| `{ type: "score", score, probabilities, confidence, legend }` | `{ kind: "score", value: score, probabilities, confidence, calibrated: true }` | `true`; `legend` is informational and dropped (probabilities are already keyed by zero-based index strings, matching what `ScoreAnswer.probabilities` carries for jev) |

This is the headline upgrade over the `llm` emulation backend: local-but-calibrated. All `passes()` / confidence-floor gating in guardrails, cost routing, adaptive strategy, etc. works with real distributions and no vendor key.

## 3. Builder & runtime wiring

- `JudgmentBuilderOptions.backend` widens: `"jev" | "llm" | "ollama"`.
- **Selection semantics (approved): explicit opt-in only.** The default heuristic stays exactly `jev if a TypeSafe key resolves else llm`. Nothing changes for any existing user; we never auto-route to Ollama because we cannot know `nimble` is pulled.
- Field reuse: `baseUrl` docstring generalizes to "backend base URL override (TypeSafe for `jev`, Ollama server for `ollama`)". `model`, `timeoutMs` pass through. New builder option `keepAlive?: string | number` (meaningful for `ollama` only; ignored elsewhere, documented).
- `packages/runtime/src/runtime.ts` — both judgment-wiring sites (root runtime ~L734 and sub-agent mirror ~L1476) gain an `ollama` branch:

```ts
backendName === "ollama"
  ? makeJudgmentServiceLive(
      makeOllamaBackend({
        baseUrl: jc?.baseUrl,
        model: jc?.model,
        timeoutMs: jc?.timeoutMs,
        keepAlive: jc?.keepAlive,
      }),
    )
  : ...
```

  composed with the existing `withJudgmentEvents(site, backendName)` — free EventBus observability. `backendName`'s local type widens to `"jev" | "llm" | "ollama"`.
- Sub-agent cross-cutting inheritance of `_judgmentOptions` already propagates `backend`; no additional work.
- `packages/judgment/src/index.ts` exports: `makeSystemOneHttpBackend`, `SystemOneProviderDescriptor` / `SystemOneHttpConfig` types, `makeOllamaBackend`, `OllamaJudgmentConfig`.
- `reactive-agents` facade re-exports the new symbols alongside existing `makeJevBackend`/`makeLlmBackend`.

No new error classes. No changes to `JudgmentService`, `withEvents`, `translate.ts`, `jev-backend.ts`, `llm-backend.ts`, or any consumer package.

## 4. Capability limits (pre-request validation)

Ollama's caps are tighter than the RA/TypeSafe type ceilings, so the engine enforces per-descriptor limits and fails **fast, locally, before any network call**:

| Rule | Source | Violation → error |
| --- | --- | --- |
| 1–64 questions per `evaluate` | Ollama `maxProperties: 64` | `JudgmentUnsupported("Backend \"ollama\" supports at most 64 questions per request (got N)")` |
| choice criteria 2–26 keys | Ollama `choice` min/maxProperties | `JudgmentUnsupported` (same shape, naming the question id) |
| score criteria 2–26 levels | Ollama `score` min/maxItems | `JudgmentUnsupported` |
| state non-empty after serialization | Ollama `SystemOneContent` | n/a — `{}` policy makes this unreachable; defensive check still encoded |
| rendered body ≤ 64 KiB | Ollama 413 | Not pre-checked (rendered prompt size isn't client-observable) — server 413 maps per §5 |
| blank question keys | Ollama `propertyNames: \S` | `JudgmentUnsupported` naming the offending key |

Rationale for `JudgmentUnsupported` over `JudgmentBadResponse`: these are backend capability limits, not malformed replies; consumers already degrade identically on any `JudgmentError` tag, and the distinct tag keeps trace data honest ("harness asked for more than this backend can do" vs "server misbehaved"). `judgeRank()` chunks upstream (its chunk cap mirrors the TypeSafe ceiling) — the plan notes its `DEFAULT_JUDGE_RANK_CHUNK_CAP` must be ≤ the resolved backend's `maxQuestions`, verified by test rather than re-plumbed (YAGNI: current caps already satisfy this; a comment records the coupling).

Question keys and choice labels are otherwise passed through verbatim.

## 5. Error mapping

Existing tagged union only — every case lands on a tag consumers already handle ("degrade, never fail"):

| Condition | `JudgmentError` |
| --- | --- |
| `fetch` rejects (connection refused / DNS / abort by non-timeout) | `JudgmentConnectionError` |
| `AbortSignal.timeout` fires | `JudgmentTimeout({ timeoutMs })` |
| 401 / 403 | `JudgmentUnauthorized` |
| 429 | `JudgmentRateLimited` (`retryAfterMs` from `Retry-After` when parseable) |
| 400 | `JudgmentBadResponse` + `describeHttpError` hint when provided |
| 404 | `JudgmentBadResponse` + `"ollama pull <model>"` hint |
| 413 | `JudgmentBadResponse("request body exceeds 64 KiB")` |
| 5xx | `JudgmentBadResponse("HTTP <status>: …")` |
| 200 with missing/mismatched-type/unknown-type answer | `JudgmentBadResponse` (decode throw) |

`Effect.tryPromise` + `catch:` mapping, mirroring `jev-backend.ts`'s `toJudgmentError` structure. No SDK-level retry exists here; the engine does NOT add its own retry loop (single-shot, consumer-degrades; retries for local backends would mask cold-load latency rather than fix anything — `timeoutMs` is the knob).

## 6. Configuration & environment

- Endpoint: `baseUrl` arg → `OLLAMA_ENDPOINT` → `OLLAMA_HOST` → `OLLAMA_BASE` → `http://localhost:11434` (all via the shared `resolveOllamaEndpoint`).
- API key: none. Local requests need no key; `apiKey`/`headers` hooks exist solely for future hosted System One providers.
- No telemetry, no outbound calls beyond the resolved endpoint — this is the privacy story we document.

## 7. Testing

`packages/judgment/tests/systemone-http.test.ts` (engine, fake `fetch` injected; no server processes, no dangling handles):

1. Request shape: model precedence (per-call > config > descriptor default), body fields, header merge, `extraBodyFields` passthrough.
2. Entry encoding: structured state passes through; `null` state → `{}`; object-valued choice criterion description → JSON string; score criteria stringified.
3. Limit rejections: 65 questions, 1 and 27 criteria, blank key → `JudgmentUnsupported` before fetch is called (assert fetch mock untouched).
4. Answer decode: all three kinds, `calibrated: true`, probabilities verbatim, missing answer / unknown `type` → `JudgmentBadResponse`.
5. Error mapping: each §5 row, including timeout via fake fetch that rejects on `signal` (or a `delay(0)` body) — assert tags, not messages.

`packages/judgment/tests/ollama-backend.test.ts` (descriptor):

1. `name === "ollama"`; endpoint resolution honors `OLLAMA_HOST` (set/restore in-test); default model `nimble`; default timeout 30000.
2. `keep_alive` present only when `keepAlive` set; string and number forms.
3. 404 error message contains `ollama pull`.

Runtime tests (extend existing judgment wiring test file(s) if present, else add to `packages/runtime/tests/`):

1. `.withJudgment({ backend: "ollama" })` at root constructs the ollama branch (assert via a fake fetch injected through an added test seam OR via `JudgmentEvaluated` events carrying `backend: "ollama"` — prefer the event assertion; no new production seam just for tests).
2. Default selection unchanged: with no `backend` and no `TYPESAFE_API_KEY`, still `llm`; with key, still `jev` (guard the explicit-opt-in decision against accidental future auto-routing).

`bun test packages/judgment packages/runtime --timeout 15000` + `bun run typecheck` + `bun run build` must pass.

## 8. Documentation updates

| Trigger | Files |
| --- | --- |
| New backend | `apps/docs/src/content/docs/features/judgment-layer.md` (backends table row + new "Local & private judgment (Ollama)" section with `ollama pull nimble` + `.withJudgment({ backend: "ollama" })` example) |
| Builder option change | `apps/docs/src/content/docs/reference/builder-api.md` (backend union, `keepAlive`), `README.md` judgment mention, `AGENTS.md` per-layer table judgment row |
| Cookbook | `apps/docs/src/content/docs/cookbook/judgment-recipes.md` — one local-privacy recipe |
| Release | changeset (`minor` for `@reactive-agents/judgment` + `@reactive-agents/runtime`), `CHANGELOG` handled by automation |
| Wiki | this spec + companion plan appended to `wiki/Planning/Planning-Index.md`; `wiki/Hot.md` refreshed at session close |

## 9. Non-goals (explicit)

- **No migration of `jev` off `@typesafe-ai/sdk`.** The SDK is the isolation boundary for that vendor and its retry semantics; replacing it is a separate, riskier change. The engine exists so a *new* System One-HTTP provider is cheap — including a hypothetical future hosted TypeSafe-compatible one.
- **No auto-detection/probing** of Ollama availability or `nimble` presence at build or first run (explicit opt-in approved).
- **No `listModels` for ollama** (see §2.2).
- **No new provider for anything but Ollama now** — the descriptor pattern is the extensibility story; nothing else ships on faith.
- **No usage-token accounting** from Ollama's `usage` field into EventBus events (current `JudgmentEvaluated` has latency, no tokens; adding usage is a separate cross-backend concern).

## 10. Research discipline notes

- Rule compliance: additive interface widening only; no default-on behavior change; existing consumers are the regression surface (their tests must pass untouched); ablation-relevance: the ollama backend is opt-in, so `llm`/`jev` paths are the untouched control tier.
- Failure-mode watch: FM-A1 class (silent fallback) — mitigated by explicit selection + `JudgmentConnectionError` surfacing loudly in `JudgmentFailed` events with `backend: "ollama"`.
