---
type: design-spec
status: approved
created: 2026-10-01
updated: 2026-10-05
tags: [judgment, decision-models, ollama, systemone, clef, local-ai, privacy]
---

# System One Decision Backends: protocol core, capability negotiation, Ollama descriptor

**Authority:** approved via brainstorming 2026-10-01; revised through 2026-10-05 against the live
Ollama System One OpenAPI, the Cloudflare Clef launch, and the current `judgment`/`runtime` source.
**Companion plan:** `wiki/Planning/Implementation-Plans/2026-10-05-systemone-decision-backends.md`

---

## 1. Intent

Ollama v0.35.0+ ships a **decision API** (`POST /v1/systemone`, the "System One" / Nimble model) that
answers `choice`, `noul`, and `score` questions with calibrated probability distributions. It is the
same primitive family `@reactive-agents/judgment` was built around; `packages/judgment/src/types.ts`
anticipated exactly this: *"A future open-source System One model, or a second judgment vendor,
implements `JudgmentBackend` against these same spec/answer types with zero change to
`JudgmentService` or any consumer."*

**Outcome:** judgments become completely local and private by pointing the judgment primitive at a
local Ollama decision model, and adding further decision providers becomes a small mechanical change.

**Success criteria**

- `.withJudgment({ backend: "ollama" })` produces distribution-derived answers from a local Ollama
  server: `ChoiceAnswer`/`ScoreAnswer` with `calibrated: true`, a real `NoulAnswer.probability`
  (Noul has no `calibrated` field by design). No API key, no outbound network.
- Every backend-agnostic consumer (`agent.judge()`, `judgeRank()`, adaptive strategy selection,
  guardrail battery, complexity router, comprehension sites) works against it unchanged.
- A second System One provider needs only a descriptor file + tests. A non-System-One provider needs
  only a `JudgmentBackend` module + tests. Neither touches the engine, the service, or a consumer.
- Existing `jev`/`llm` behavior is byte-for-byte unchanged; selection heuristic untouched.

### 1.1 Protocol equivalence

Ollama's `POST /v1/systemone` is the *same wire protocol* TypeSafe's SDK targets at the same path
(source: `docs.ollama.com/api/systemone`, Ollama v0.35.0+). Identical `state` + named `questions`
body, identical `choice`/`noul`/`score` answer variants, identical `probabilities`/`confidence`
semantics and `1 - H(p)/ln(N)` confidence formula. Ollama adds two optional top-level fields:
`keep_alive` and `images`. That equivalence is why the new wire layer mirrors `translate.ts`, and why
one engine can serve the whole family.

### 1.2 Landscape

Decision APIs are now a category, not one vendor:

| Provider | Protocol | Transport | Notes |
| --- | --- | --- | --- |
| TypeSafe Jev | System One | `@typesafe-ai/sdk`, `/v1/systemone` | existing `jev` backend; text only |
| Ollama (local) | System One | HTTP `/v1/systemone` | `nimble`, `tev` (text); `clef`, `clef-flash` (vision) |
| Cloudflare Clef / Clef-Flash | System One | Workers AI `/ai/run` | hosted tier-1; up to 4 images; deferred (§11) |
| OpenAI Decisions API | **unknown** | unpublished | GPT-6 Luna, limited preview (DevDay 2026-09-29); may return a single selection, not a distribution |

OpenAI's API is not documented as System One and has no published request schema. The design
therefore commits to **two extension tiers** (§5): a shared System One engine for the compatible
family, and `JudgmentBackend` as the universal seam for anything else. Capability negotiation (§3) is
what lets consumers absorb either tier without hardcoded assumptions.

## 2. Architecture

```
packages/judgment/src/backends/
├── systemone/                 ← NEW: one shared System One protocol core
│   ├── wire.ts                ← wire types + Effect schemas + RA-spec↔wire encoding (SDK-free)
│   ├── engine.ts              ← SystemOneProviderDescriptor + fetch-based engine
│   └── providers/
│       └── ollama.ts          ← Ollama descriptor + makeOllamaBackend()
├── jev-backend.ts             ← declares capabilities; otherwise unchanged (TypeSafe SDK)
└── llm-backend.ts             ← declares capabilities; otherwise unchanged (LLMService emulation)
```

Engine and wire are separate files from the start, not "if it grows past ~250 lines": encoding (the
null/string normalization rules, §2.2) and transport (descriptor hooks, limit enforcement, error
mapping) are independently testable concerns. Grouping under `systemone/providers/` mirrors
`@reactive-agents/llm-provider`'s `providers/` layout and gives the next provider an obvious home.

Data flow: consumers → `JudgmentService.ask()` → `JudgmentBackend.evaluate()` → `systemone/engine` →
`systemone/wire` encode → provider HTTP → `systemone/wire` decode → `JudgmentAnswers`. `withEvents`
EventBus decoration is backend-agnostic and picks up the `backend: "ollama"` label unchanged.

### 2.1 Engine: `systemone/engine.ts`

```ts
export interface SystemOneProviderDescriptor {
  /** Backend label. Surfaces in JudgmentEvaluated/JudgmentFailed events. */
  readonly name: string;
  /** Path appended to the resolved endpoint. Default when omitted: "/v1/systemone". */
  readonly path?: string;
  /** Resolve the base URL from an explicit config value + provider env conventions. */
  readonly resolveEndpoint: (explicit?: string) => string;
  /** Model sent when neither the call nor the config supplies one. */
  readonly defaultModel: string;
  /** Per-request timeout when config.timeoutMs is absent. */
  readonly defaultTimeoutMs: number;
  /** Wire-protocol limits enforced BEFORE the request (§6). min/maxCriteria apply to choice+score only. */
  readonly limits: {
    readonly minQuestions: number;
    readonly maxQuestions: number;
    readonly minCriteria: number;
    readonly maxCriteria: number;
    /** Max serialized body bytes with NO images (Ollama: 65_536). */
    readonly maxBodyBytes?: number;
    /**
     * Present when the endpoint accepts the optional top-level `images` array.
     * Its presence is what makes the derived `capabilities.images` true.
     */
    readonly images?: {
      /** Max serialized body bytes WITH images (Ollama: 33_554_432). */
      readonly maxBodyBytes: number;
      /** Optional count ceiling (Workers AI: 4; Ollama: size-bound, omitted). */
      readonly max?: number;
    };
  };
  /** Optional auth/identity headers; closes over the provider factory's own config. */
  readonly headers?: (config: SystemOneHttpConfig) => Record<string, string>;
  /** Extra request-body fields (Ollama: keep_alive); closes over the provider factory's config. */
  readonly extraBodyFields?: (config: SystemOneHttpConfig) => Record<string, unknown>;
  /** Remediation hint appended to the mapped error. Gets the resolved model so hints can name it. */
  readonly describeHttpError?: (ctx: {
    readonly status: number;
    readonly body: string;
    readonly model: string;
  }) => string | undefined;
}

export interface SystemOneHttpConfig {
  readonly baseUrl?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  /** Auth seam for hosted System One providers. Unused by the local Ollama path. */
  readonly apiKey?: string;
  readonly headers?: Record<string, string>;
  /** Test seam. Mirrors TypeSafeClientConfig.fetch; defaults to globalThis.fetch. */
  readonly fetch?: typeof globalThis.fetch;
}

export const makeSystemOneHttpBackend = (
  descriptor: SystemOneProviderDescriptor,
  config?: SystemOneHttpConfig,
): JudgmentBackend;
```

No `providerOptions` bag: descriptor hooks are defined inside the provider factory and close over its
typed config, so `keepAlive` reaches `extraBodyFields` without an untyped extension channel.
`SystemOneHttpConfig` carries only what the engine consumes.

**Engine responsibilities**

1. **Request build.** Encode `state` + `QuestionSpecs` (+ optional `images`) into
   `{ model, state, questions, ...(images?.length ? { images } : {}), ...extraBodyFields }`.
   Model precedence: per-call → `config.model` → `descriptor.defaultModel`.
2. **Entry encoding** (§2.2, in `wire.ts`).
3. **Image encoding.** `images` is an ordered array of base64 strings passed through **verbatim**: no
   URL/data-URL resolution, no decoding, no re-encoding (Ollama rejects URLs and data URLs). Images
   against a text-only endpoint (`limits.images` absent) → `JudgmentUnsupported`; over
   `limits.images.max` → `JudgmentUnsupported` naming the count. A text-only *model* on a
   vision-capable endpoint (Ollama `nimble`) is not distinguishable client-side and surfaces as a
   mapped server 400.
4. **Limit enforcement** (§6) before sending. Never truncate, never silently chunk. The serialized
   body is measured once and is both what is sent and what the ceiling applies to:
   `limits.images.maxBodyBytes` when images are present, else `limits.maxBodyBytes`.
5. **HTTP execution.** Single `fetch` with `AbortSignal.timeout(timeoutMs)`,
   `Content-Type: application/json`, descriptor + config headers merged (config wins).
6. **Response decode.** Effect `Schema.Union` over the three answer variants via `Schema.decodeUnknown`
   (`Effect.mapError` → `JudgmentBadResponse`, never a raw throw). Every requested id must be present
   **and** its wire `type` must match the requested spec's `type`, the same "never partial-trust a
   missing answer" guarantee as `fromSdkResult`. Response `model`/`usage` are ignored.
7. **Error mapping** (§7) onto the existing tagged `JudgmentError` union.

Wire types and schemas live in `wire.ts`; descriptor interface, engine, and error mapping in
`engine.ts`. The wire layer is plain JSON boundary types with **no vendor SDK**, so the "only
`translate.ts` touches `@typesafe-ai/sdk`" isolation rule holds. `wire.ts` deliberately mirrors
`translate.ts`'s `toSdkEntry`/`toSdkQuestions` rather than sharing it (`translate.ts` imports SDK
helpers and must stay SDK-bound); each file cross-references the other so a future de-duplication
attempt does not break that isolation.

### 2.2 Entry encoding (the correctness core)

`SystemOneContent` is a nonempty string, an object, or an array (**never `null`**), and
`instructions` is a **required** field on all three question types:

| Position | Rule |
| --- | --- |
| `state` | non-blank string / object / array pass through; `null`, `undefined`, and blank (`""`/whitespace) → `{}`. Required because `judgeRank()` sends `state: null` |
| `instructions` (all types) | same normalization. Ollama marks it required, so omission is not an option; `{}` is the neutral "undescribed" marker (the TypeSafe SDK type allows a literal `null` here, `SystemOneContent` does not) |
| `choice.criteria` values | must be `string \| null`: string verbatim; `null` verbatim (Ollama uses the key as the description); object/array → `JSON.stringify` |
| `score.criteria` items | must be **strings**: string verbatim; `null` → `""`; object/array → `JSON.stringify`. RA `ScoreCriteria` entries are `JudgmentEntry`, so this coercion is mandatory |
| `noul.criteria` | optional `{true?, false?}`, values must be **strings** (omitted sides default to `"No"`/`"Yes"`): present non-string → `JSON.stringify`; `null`/`undefined` → omit that side |
| question keys / choice labels | passed through verbatim; blank ones rejected (§6) |

### 2.3 Ollama descriptor: `systemone/providers/ollama.ts`

```ts
export interface OllamaJudgmentConfig {
  readonly baseUrl?: string;              // else OLLAMA_ENDPOINT / OLLAMA_HOST / OLLAMA_BASE chain
  readonly model?: string;                // default "nimble"; "clef"/"clef-flash" (vision), "tev"
  readonly timeoutMs?: number;            // default 30_000 (cold-load tolerant)
  readonly keepAlive?: string | number;   // passed through as keep_alive ("10m", 0, -1)
  readonly fetch?: typeof globalThis.fetch; // test seam
}

export const makeOllamaBackend = (config?: OllamaJudgmentConfig): JudgmentBackend;
```

| Field | Value | Why |
| --- | --- | --- |
| `name` | `"ollama"` | event label; distinguishes local from cloud judgment in observability |
| `resolveEndpoint` | `resolveOllamaEndpoint()` from `@reactive-agents/llm-provider` (already exported; judgment already depends on llm-provider) | single canonical resolution: OLLAMA_ENDPOINT → OLLAMA_HOST → OLLAMA_BASE → localhost, plus bare-`host:port` normalization and trailing-slash trim. No fourth env convention invented |
| `defaultModel` | `"nimble"` | Ollama's own decision model. Overridable per call/agent: `clef` (27B) and `clef-flash` (9B) are Cloudflare's System One-compatible models; `tev` is another text option |
| `defaultTimeoutMs` | `30_000` | local models cold-load; a first call can take tens of seconds. Mirrors `llm-config.ts`'s cold-load-tolerant `ollamaTimeoutMs`. Distinct from `DEFAULT_TIMEOUT_MS = 3000` in `types.ts`, which `jev-backend.ts` never actually applies (it forwards `config.timeoutMs`; that constant is currently unused) |
| `limits` | `{ minQuestions: 1, maxQuestions: 64, minCriteria: 2, maxCriteria: 26, maxBodyBytes: 65_536, images: { maxBodyBytes: 33_554_432 } }` | Ollama API reference. `noul.criteria` is a fixed optional `{true,false}` and is exempt from min/maxCriteria |
| `extraBodyFields` | closed over `keepAlive` → `{ keep_alive: value }` **when `keepAlive !== undefined`** | keeps the decision model warm. `0` is a meaningful value ("unload after the request") and must survive a truthiness test |
| `describeHttpError` | `{ status, body, model }`, where `body` is the **server's** error text, not our request, so hints must not depend on what we sent. 404 → ``local model not found: run `ollama pull <model>` ``; 400 → one hint covering both documented causes: the model must be local GGUF with a scoring-capable runner (cloud and MLX/Safetensors rejected, System One unavailable on Ollama Cloud), and images require vision weights (`clef`/`clef-flash`) | actionable remediation for the Ollama-specific failure modes; taking the resolved `model` lets the 404 hint name it exactly |
| `headers` | omitted | local server needs no auth; hosted providers add this hook without an engine change |

`listModels` is **not** implemented: `/api/tags` cannot distinguish decision-capable models from chat
models, and a misleading catalog is worse than the honest `JudgmentUnsupported` the service already
returns when the method is absent.

### 2.4 Response translation

| Wire answer | `JudgmentAnswer` |
| --- | --- |
| `{ type: "choice", choice, probabilities, confidence }` | `{ kind: "choice", value: choice, probabilities, confidence, calibrated: true }` |
| `{ type: "noul", noul }` | `{ kind: "noul", probability: noul }` |
| `{ type: "score", score, probabilities, confidence, legend }` | `{ kind: "score", value: score, probabilities, confidence, calibrated: true }`; `legend` dropped (`ScoreAnswer` has no such field; probabilities are already keyed by zero-based index strings) |

This is the headline upgrade over the `llm` emulation backend: local **and** calibrated. All
`passes()` / confidence-floor gating in guardrails, cost routing, and adaptive strategy works on real
distributions with no vendor key.

`calibrated: true` means exactly what it means for `jev`: the answer derives from a real probability
distribution. It is **not** a claim of correctness. Ollama's docs are explicit that `confidence` is
distribution concentration ("not calibrated correctness"), the caveat the judgment-layer docs already
carry. `score` is the probability-weighted average on the rubric's own scale (0…N−1, max 25), not
normalized to 0–1; this matches `jev` and differs from the `llm` backend's clamped value.

## 3. Capability negotiation (existing-infrastructure improvement)

Today a `JudgmentBackend` advertises only `name`; every limit is either inferred from SDK docs or
hardcoded at the consumer. Two constants carry that coupling:

- `DEFAULT_JUDGE_RANK_CHUNK_CAP = 30` in `packages/runtime/src/judgment-rank.ts`, commented "must stay
  ≤ the resolved backend's maxQuestions, verified by test rather than re-plumbed".
- `CHUNK_CAP = 30` in `packages/reasoning/src/kernel/capabilities/comprehend/judgment-classification.ts`.

Neither knows the backend's real ceiling. Ollama caps at 64 questions and 26 criteria; a future
provider capping at 16 would make every consumer send an over-limit batch. Fix the abstraction, not
the constant.

```ts
// types.ts
export type JudgmentQuestionKind = "noul" | "choice" | "score";

export interface JudgmentCapabilities {
  /** Max questions per ask()/evaluate() call. Omitted = unbounded. */
  readonly maxQuestions?: number;
  /** Question kinds the backend answers. */
  readonly supportedKinds: ReadonlyArray<JudgmentQuestionKind>;
  /**
   * True when answers carry a complete, real per-candidate distribution.
   * False = ChoiceAnswer.probabilities is a best-effort synthesis (the `llm`
   * backend) and consumers must gate on `confidence`, not `probabilities`.
   */
  readonly distributions: boolean;
  /** True when `confidence` is distribution-derived (false = model self-report). */
  readonly calibrated: boolean;
  /** True when the backend accepts the optional `images` channel (vision models). */
  readonly images: boolean;
  /** True when listModels() resolves a real catalog. */
  readonly modelCatalog: boolean;
}

export const DEFAULT_JUDGMENT_CAPABILITIES: JudgmentCapabilities = {
  supportedKinds: ["noul", "choice", "score"],
  distributions: false,
  calibrated: false,
  images: false,
  modelCatalog: false,
};

/** Read a service's capabilities, tolerating a service that predates them. */
export const capabilitiesOf = (
  svc: JudgmentService["Type"],
): Effect.Effect<JudgmentCapabilities>;

export interface JudgmentBackend {
  readonly name: string;
  /** Optional. Backends that omit it get DEFAULT_JUDGMENT_CAPABILITIES. */
  readonly capabilities?: JudgmentCapabilities;
  readonly evaluate: (input: {
    readonly state: JudgmentEntry;
    readonly questions: QuestionSpecs;
    readonly model?: string;
    readonly images?: readonly string[];
  }) => Effect.Effect<JudgmentAnswers, JudgmentError>;
  readonly listModels?: () => Effect.Effect<ReadonlyArray<JudgmentModel>, JudgmentError>;
}
```

`JudgmentService` gains **two additive, optional** members:

```ts
readonly ask: <Q extends QuestionSpecs>(input: {
  readonly state: JudgmentEntry;
  readonly questions: Q;
  readonly model?: string;
  readonly images?: readonly string[];
}) => Effect.Effect<JudgmentAnswers<Q>, JudgmentError>;
/** Optional so the ~25 existing JudgmentService test fakes across 8 packages keep typechecking. */
readonly capabilities?: () => Effect.Effect<JudgmentCapabilities>;
```

`capabilitiesOf(svc)` is the single read path: `svc.capabilities?.() ?? Effect.succeed(DEFAULT_JUDGMENT_CAPABILITIES)`.
Consumers use it, never `svc.capabilities` directly.

`makeJudgmentServiceLive` composes defaults then overlays `backend.capabilities`
(`modelCatalog` derives from `backend.listModels !== undefined` when not declared), exposes
`capabilities()`, and **pre-validates the request before delegating**: every question's kind must be
in `supportedKinds`, and a non-empty `images` requires `images: true`. Both fail `JudgmentUnsupported`.
`withEvents` forwards `capabilities` unchanged.

Declared values: `jev` → `{ distributions: true, calibrated: true, modelCatalog: true }`;
`llm` → defaults; `ollama` (engine-derived from `descriptor.limits`) →
`{ maxQuestions: 64, distributions: true, calibrated: true, images: true, modelCatalog: false }`.
`images: true` means the *endpoint* accepts the field; the chosen model must still have vision weights.

Consumers stop guessing:

- `judgeRank()`: `effectiveCap = Math.min(opts.chunkCap ?? DEFAULT_JUDGE_RANK_CHUNK_CAP, caps.maxQuestions ?? Infinity)`,
  still rejecting a non-positive user override. Turns "verified by test" into a runtime guarantee.
- comprehension `chunkQuestions()`: already parameterized by a cap; pass `caps.maxQuestions` when tighter.

Behavior-preserving today (every current backend's effective cap stays 30), so shadow telemetry stays
comparable; a future tighter backend degrades into correct chunking instead of a hard error.

## 4. Runtime wiring

`packages/runtime/src/runtime.ts` builds the judgment layer **twice** with near-identical code
(`judgmentOptLayer` ~L734, `lightJudgmentOptLayer` ~L1478, the one sub-agents inherit), differing
only in which `LLMService` layer they provide. Patching both for `ollama` would make a third copy of
the same branch. Extract one helper:

```ts
// packages/runtime/src/judgment-layer.ts
export type JudgmentBackendName = "jev" | "llm" | "ollama";

export interface JudgmentLayerDeps {
  /** observableLlmLayer (root) | llmLayer (light) */
  readonly llmLayer: Layer.Layer<LLMService>;
  readonly eventBusLayer: Layer.Layer<EventBus>;
}

export const resolveBackendName = (jc: JudgmentBuilderOptions | undefined): JudgmentBackendName;

export const buildJudgmentLayer = (
  jc: JudgmentBuilderOptions | undefined,
  deps: JudgmentLayerDeps,
): Layer.Layer<JudgmentService, never, never>;
```

Selection stays exactly as today: explicit `jc.backend` wins, else `jev` when an API key resolves
(`jc.apiKey ?? process.env.TYPESAFE_API_KEY`), else `llm`. Construction is a registry keyed by the
union:

```ts
const BACKENDS = {
  jev:    (jc) => Effect.succeed(makeJevBackend({ apiKey: jc?.apiKey, baseUrl: jc?.baseUrl, model: jc?.model, timeoutMs: jc?.timeoutMs, defaultConfidenceFloor: jc?.defaultConfidenceFloor })),
  ollama: (jc) => Effect.succeed(makeOllamaBackend({ baseUrl: jc?.baseUrl, model: jc?.model, timeoutMs: jc?.timeoutMs, keepAlive: jc?.ollama?.keepAlive })),
  llm:    ()   => Effect.map(LLMService, makeLlmBackend),
} satisfies Record<JudgmentBackendName, (jc: JudgmentBuilderOptions | undefined) => Effect.Effect<JudgmentBackend, never, LLMService>>;
```

`buildJudgmentLayer` wraps the result in `withEvents("agent.judge", backendName)`. Both runtime sites
call it; providing the LLM layer to a non-`llm` backend is a no-op. Adding a provider is one registry
entry plus one union member; neither runtime site changes again.

**Builder options.** `JudgmentBuilderOptions.backend` widens to `JudgmentBackendName`. Provider-only
knobs get a namespace instead of piling onto the shared record: `ollama?: { readonly keepAlive?: string | number }`.
Shared connection fields (`apiKey`, `baseUrl`, `model`, `timeoutMs`, `defaultConfidenceFloor`) stay
top-level for compatibility; `baseUrl`'s docstring generalizes to "backend base URL override
(TypeSafe for `jev`, Ollama server root for `ollama`)".

**Image channel.** `agent.judge()` gains optional `images` on the `JudgeInput` intersection member
(`packages/runtime/src/reactive-agent.ts:164-170`) and forwards it to `ask()`. Base64 only, caller
order, verbatim; no URL fetching. Text-only backends reject it via the §3 guard rather than dropping
it silently.

**Exports.** `packages/judgment/src/index.ts` adds `makeSystemOneHttpBackend`,
`SystemOneProviderDescriptor`, `SystemOneHttpConfig`, `makeOllamaBackend`, `OllamaJudgmentConfig`,
`JudgmentCapabilities`, `JudgmentQuestionKind`, `DEFAULT_JUDGMENT_CAPABILITIES`, `capabilitiesOf`.
The `reactive-agents` facade re-exports them alongside `makeJevBackend`/`makeLlmBackend`.

No new error classes. No answer-shape change. `translate.ts`, `jev-backend.ts`, and `llm-backend.ts`
change only to declare capabilities.

## 5. Extension model

The `systemone/` engine is **protocol-specific, not the general extension point**.

- **Tier 1: System One family** (TypeSafe/Jev, Ollama incl. Clef/Clef-Flash, Cloudflare Workers AI,
  aggregators exposing `typesafe/jev-*`): a descriptor under `backends/systemone/providers/`.
  Endpoint/auth/model/limits only. A vision endpoint sets `limits.images`; a hosted one sets
  `headers`/`apiKey`.
- **Tier 2: a different decision-API family** (OpenAI Decisions if its published contract diverges,
  or any single-selection API): a `JudgmentBackend` module under `backends/` with its own wire
  translation and error mapping. It inherits all framework integration through the interface plus
  capabilities, including the `images` channel, which is generic, not System One-specific.

**Adding a tier-1 provider:** descriptor file → registry entry + union member + `ollama`-style options
namespace → capabilities (engine derives from `limits`) → descriptor tests.
**Adding a tier-2 provider:** backend module using the existing `JudgmentError` union → registry entry
+ union member + namespace → capabilities (`distributions: false` if it returns no distribution, but
`ChoiceAnswer.probabilities` must still be populated as a documented best-effort synthesis; reduced
`supportedKinds` if it lacks noul/score; `images: true` only if it accepts them) → backend tests.

Either way consumers, `JudgmentService`, and the chunking sites are untouched.

## 6. Wire limits (pre-request validation)

Ollama's caps are tighter than the RA/TypeSafe type ceilings, so the engine fails **fast, locally,
before any network call**:

| Rule | Source | Violation |
| --- | --- | --- |
| 1–64 questions per `evaluate` | `questions.minProperties/maxProperties: 1/64` | `JudgmentUnsupported` naming the backend and the count |
| choice criteria 2–26 keys | `choice.criteria` min/maxProperties | `JudgmentUnsupported` naming the question id |
| score criteria 2–26 levels | `score.criteria` min/maxItems | `JudgmentUnsupported` naming the question id |
| blank question keys | `questions.propertyNames: \S` | `JudgmentUnsupported` naming the key |
| blank choice labels | `choice.criteria.propertyNames: \S` | `JudgmentUnsupported` naming the question id + label |
| body ≤ `limits.maxBodyBytes` (64 KiB) without images, ≤ `limits.images.maxBodyBytes` (32 MiB) with | 413 "…64 KiB without images or 32 MiB with images" | `JudgmentUnsupported` naming the encoded byte size and which ceiling applied. Client-observable (we serialize it), so pre-checked; §7's 413 mapping stays as a defensive fallback for a tighter proxy |
| `images` on a text-only endpoint | no wire contract | `JudgmentUnsupported`; also enforced service-side (§3) |
| `images.length > limits.images.max` | provider docs (Workers AI: 4) | `JudgmentUnsupported` naming the count |
| images to a text-only **model** on a vision endpoint | Ollama 400 "unsupported model or runner" | not pre-checkable (vision is a per-model property); mapped 400 + `describeHttpError` hint |
| non-null `instructions` / non-null `state` | `instructions` required; `SystemOneContent` excludes `null` | n/a: §2.2 encoding is total; a defensive check is still encoded so an encoder regression surfaces locally |

`JudgmentUnsupported` over `JudgmentBadResponse` because these are capability limits, not malformed
replies: consumers degrade identically on any `JudgmentError`, and the distinct tag keeps trace data
honest ("the harness asked for more than this backend can do" vs "the server misbehaved"). Because the
limits are now *advertised* (§3), consumers chunk to fit before ever triggering the rejection.

## 7. Error mapping

Existing tagged union only: every case lands on a tag consumers already handle ("degrade, never fail"):

| Condition | `JudgmentError` |
| --- | --- |
| `fetch` rejects (connection refused / DNS / non-timeout abort) | `JudgmentConnectionError` |
| abort from our own `AbortSignal.timeout` | `JudgmentTimeout({ timeoutMs })`; detect `error.name === "TimeoutError"` (we only ever abort on timeout) |
| 401 / 403 | `JudgmentUnauthorized` (not in Ollama's surface; closed for hosted providers) |
| 429 | `JudgmentRateLimited`, `retryAfterMs` from `Retry-After`/`retry-after-ms` when parseable (hosted only) |
| 400 (invalid request, unsupported model/runner, prompt exceeds loaded context, images to a non-vision model, cloud model requested) | `JudgmentBadResponse` + `describeHttpError` hint when provided |
| 404 (local model not found) | `JudgmentBadResponse` + ``ollama pull <model>`` hint |
| 413 | `JudgmentBadResponse` naming the ceiling, defensive; §6 should make it unreachable |
| 5xx (model loading / rendering / scoring failed) | `JudgmentBadResponse("HTTP <status>: …")` |
| 200 with a missing / mismatched-type / unknown-type answer | `JudgmentBadResponse` (decode failure) |

`Effect.tryPromise` + `catch:` mapping, mirroring `jev-backend.ts`'s `toJudgmentError`. The engine adds
**no** retry loop: single-shot, consumers degrade. Retrying a local backend would mask cold-load
latency rather than fix anything; `timeoutMs` is the knob.

## 8. Configuration

- **Endpoint:** `baseUrl` → `OLLAMA_ENDPOINT` → `OLLAMA_HOST` → `OLLAMA_BASE` → `http://localhost:11434`,
  all via `resolveOllamaEndpoint()`. `baseUrl` is the server **root**, not the full path; the engine
  appends `/v1/systemone`.
- **API key:** none locally. `apiKey`/`headers` exist solely for hosted System One providers.
- **Images:** optional base64 PNG/JPEG/WebP, passed verbatim and scored with `state`; requires a
  vision decision model (`clef`/`clef-flash`). 32 MiB ceiling with images, 64 KiB without. URLs and
  data URLs rejected by the server and never resolved by us.
- **Privacy:** no telemetry, no outbound calls beyond the resolved endpoint. `backend: "ollama"` does
  not require the LLM provider to be Ollama; the decision call bypasses the configured `LLMService`.

## 9. Testing

All tests use injected fakes: no server processes, no dangling handles. `bun test packages/judgment
packages/runtime --timeout 15000` plus `bun run typecheck` and `bun run build` must pass.

**`tests/systemone-wire.test.ts`** (pure encoding): the six §2.2 rows; `null`/`undefined`/`""`/whitespace
→ `{}` for both `state` and `instructions`; choice `null` preserved; score `null` → `""`; noul side
omitted; nested structured state round-trips to the exact body.

**`tests/systemone-engine.test.ts`** (a **synthetic descriptor**, not Ollama's, so the engine/descriptor
seam is what is under test): model precedence; body fields; header merge (config wins);
`extraBodyFields` passthrough; every §6 rejection fires **before** `fetch` (assert the mock untouched);
all three answer kinds decode with `calibrated: true` and probabilities verbatim; missing /
mismatched / unknown `type` → `JudgmentBadResponse`; every §7 row including timeout via a fake fetch
that rejects when its `signal` aborts; `describeHttpError` hint present and naming the model;
images verbatim/in-order, absent when empty, ceiling switches to `images.maxBodyBytes`.

**`tests/ollama-backend.test.ts`**: `name === "ollama"`; endpoint honors `OLLAMA_HOST` (set/restore);
default model `nimble`, timeout `30_000`; `keep_alive` present only when `keepAlive !== undefined`
, including `0`; 404 message contains `ollama pull` and the model; `capabilities()` reports
`{ maxQuestions: 64, distributions: true, calibrated: true, images: true, modelCatalog: false }`;
`model: "clef"` / `"clef-flash"` reach the wire.

**Capability tests** (`judgment-service.test.ts`, `runtime/tests/judgment-rank.test.ts`): defaults when
the backend omits `capabilities`, overlay when supplied, `withEvents` forwards; kind enforcement
rejects a `noul` against `supportedKinds: ["choice"]` without calling `evaluate`; image enforcement
rejects against `images: false` without calling `evaluate`; `judgeRank` clamps to `maxQuestions: 3`
(7 candidates → 3 calls) and an explicit tighter `chunkCap` still wins; `chunkCap <= 0` rejection
unchanged; `capabilitiesOf` falls back to defaults for a service literal that omits the method.

**Runtime tests** (`builder-judgment.test.ts`, extending the existing BACKEND SELECTION pattern that
proves a named backend by pointing it at an unreachable local port):
`.withJudgment({ backend: "ollama", baseUrl: "http://127.0.0.1:1" })` → `agent.judge()` rejects and the
`JudgmentFailed` event carries `backend: "ollama"` + `errorTag: "JudgmentConnectionError"`; default
selection unchanged (no key → `llm`, key → `jev`); both runtime tiers resolve the same backend through
`buildJudgmentLayer`; `agent.judge({ images })` reaches the backend when `images: true`.

## 10. Documentation

| Trigger | Files |
| --- | --- |
| New backend | `apps/docs/src/content/docs/features/judgment-layer.md`: backends table row + a "Local & private judgment (Ollama)" section with `ollama pull nimble` and `.withJudgment({ backend: "ollama" })` |
| Decision models & vision | same file: `model: "clef"` / `"clef-flash"` / `"tev"`, the optional `images: string[]` argument (base64 only, vision model required, 32 MiB ceiling), and a note that Clef is also on Cloudflare Workers AI |
| Capabilities | same file, a "Backend capabilities" subsection: `maxQuestions`/`supportedKinds`/`distributions`/`calibrated`/`images`/`modelCatalog`, and that consumers adapt automatically |
| Extension model | same file + a contributor note on the two tiers (§5), so future "add OpenAI/other" asks do not assume the engine generalizes |
| Builder options | `apps/docs/src/content/docs/reference/builder-api.md` (backend union, `ollama.keepAlive`), `README.md` judgment mention |
| Repo docs | `AGENTS.md` package-tree judgment line (~L39) + a judgment row in the Per-Layer Quick Reference table (currently absent); `packages/judgment/package.json` description/keywords (currently name only TypeSafe/LLM) |
| Cookbook | `apps/docs/src/content/docs/cookbook/judgment-recipes.md`: one local-privacy recipe, one screenshot-classification recipe (Clef + `images`) |
| Release | changeset (`minor` for `@reactive-agents/judgment` + `@reactive-agents/runtime`); CHANGELOG by automation |
| Wiki | spec + plan linked from `wiki/Planning/Planning-Index.md`; `wiki/Hot.md` refreshed at session close |

## 11. Non-goals

- **No migration of `jev` off `@typesafe-ai/sdk`.** The SDK is that vendor's isolation boundary and
  owns its retry semantics.
- **No OpenAI Decisions backend now.** Preview-only, no published contract. The trigger is a documented
  request/response schema plus a stable model id, not a press release.
- **No Cloudflare Workers AI descriptor now.** Same payload, but a Cloudflare-specific REST envelope
  and auth; deferred until the envelope is pinned. Local Clef through Ollama already covers the models.
- **No auto-detection or probing** of Ollama availability or model presence (explicit opt-in only).
- **No `listModels` for ollama** (§2.3).
- **No streaming.** System One is request/response; `evaluate` stays a unary Effect.
- **No new question kinds.** `noul`/`choice`/`score` stay the primitive set; `supportedKinds` lets a
  provider advertise a subset, and a new kind is an additive widening.
- **No multimodal `state`.** `state` stays text/JSON (`SystemOneContent` excludes multimodal input);
  images travel in the separate `images` channel. Image decoding, transcoding, URL fetching, and
  resizing are out of scope.
- **No usage-token accounting** from the response `usage` field (`JudgmentEvaluated` carries latency
  only; tokens are a separate cross-backend concern).
- **No per-backend retry loop and no auto-failover** between backends. Selection is explicit; consumers degrade.
- **No user-supplied backend plugin API.** `backend` stays a closed union and the registry is static.
  `registerJudgmentBackend(...)` is a real future ask but needs its own authority/lifecycle review; the
  seam is shaped so it can be added without reworking the engine.

## 12. Alternatives rejected

1. **Point the TypeSafe SDK at `resolveOllamaEndpoint()`.** The protocol is identical, so
   `makeJevBackend({ baseUrl: ollamaUrl, model: "nimble" })` would nearly work. Rejected: it couples
   the Ollama path to a third-party SDK's version, retry policy (the SDK retries 5xx twice, silently
   retrying Ollama's model-loading failures and masking exactly the cold-load latency `timeoutMs`
   bounds), and error taxonomy; its typed request cannot express `keep_alive` or `images` without a
   cast; and it does not generalize to a hosted provider that diverges.
2. **A single self-contained `makeOllamaBackend`** (inline fetch + serialization). Rejected: contradicts
   "second provider = descriptor only" and re-creates the per-provider drift `llm-provider` already solved.
3. **Route Ollama through the LLM provider with JSON-schema output.** Rejected: that is the `llm`
   emulation backend, uncalibrated by construction: it cannot produce real probabilities.
4. **Auto-detect Ollama / probe for the model at build time.** Rejected: slow, nondeterministic, and
   availability does not imply decision capability.
5. **Ship an OpenAI Decisions backend now.** Rejected: building against a paraphrase would freeze a
   guessed wire format before the contract stabilizes.

## 13. Research discipline

- **Rule compliance:** additive interface widening only (`JudgmentBackend.capabilities?`,
  `JudgmentService.capabilities?`, `images?` inputs, `backend`/`ollama?` builder options). No
  default-on behavior change. The registry extraction (§4) is behavior-preserving, with the two
  runtime tiers as the regression surface. Existing consumers' tests pass with only the deliberate
  capability adapter at the two chunking sites. Effective chunk caps are unchanged
  (`min(30, ≥30) = 30`), so shadow telemetry stays comparable. The `llm`/`jev` paths are the untouched
  control tier; `ollama` is opt-in.
- **Landscape resilience:** the durable bet is `JudgmentBackend` + `JudgmentCapabilities`, not the
  System One engine. Clef/Clef-Flash landed as a pure tier-1 addition: same engine, a new `model`
  value, one optional wire field, exactly the cheap path the layout predicted. A tier-2 provider
  exercises the interface path `llm`/`jev` already do.
- **Failure-mode watch:** FM-A1 class (silent fallback) is mitigated by explicit selection, by
  `JudgmentConnectionError` surfacing loudly in `JudgmentFailed` with `backend: "ollama"`, and by the
  §3 guards that make an unsupported kind or an image channel fail loudly instead of being dropped.
