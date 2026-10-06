---
type: implementation-plan
status: active
created: 2026-10-05
completed: null
authored-by: OpenCode
related: [[../Architecture/Design-Specs/2026-10-01-systemone-decision-backends-design|System One Decision Backends design spec]]
---

# System One Decision Backends Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local, private, calibrated judgment backend over Ollama's System One decision API, and make the judgment layer's provider seam scale to the next decision API without touching consumers.

**Architecture:** One shared fetch-based System One protocol engine plus thin provider descriptors (`ollama` first), sitting behind the existing `JudgmentBackend` interface. Two additive infrastructure changes carry the future: backend-declared **capabilities** that consumers read instead of hardcoding limits, and a runtime **backend registry** that replaces the duplicated judgment-layer construction. Non-System-One providers (OpenAI's Decisions API) implement `JudgmentBackend` directly and get the same integration.

**Tech Stack:** TypeScript (strict), Effect-TS ^3.10 (`Schema`, `Data.TaggedError`, `Context.Tag`, `Layer`, `Effect.tryPromise`), Bun test runner, tsup, Turborepo, changesets.

**Spec:** `wiki/Architecture/Design-Specs/2026-10-01-systemone-decision-backends-design.md`. Read it first; every value below is copied from it. The spec argues *why*; this plan fixes *which files, names, signatures, and tests*.

## Global Constraints

Every task inherits these. Exact values, verbatim from the spec.

- **Ollama wire limits:** `minQuestions: 1`, `maxQuestions: 64`, `minCriteria: 2`, `maxCriteria: 26`, `maxBodyBytes: 65_536` (no images), `images.maxBodyBytes: 33_554_432` (with images). Choice criteria 2-26 keys; score criteria 2-26 levels; `noul.criteria` exempt from criteria limits.
- **Ollama defaults:** model `"nimble"`, timeout `30_000` ms, path `"/v1/systemone"`.
- **Endpoint precedence:** `baseUrl` → `OLLAMA_ENDPOINT` → `OLLAMA_HOST` → `OLLAMA_BASE` → `http://localhost:11434`, resolved only via `resolveOllamaEndpoint()` imported from `@reactive-agents/llm-provider`. Do not invent a fourth convention or read `process.env` directly.
- **No new error classes.** Every failure lands on the existing `JudgmentError` union (`JudgmentUnauthorized`, `JudgmentRateLimited`, `JudgmentTimeout`, `JudgmentBadResponse`, `JudgmentConnectionError`, `JudgmentUnsupported`).
- **No new question kinds, no answer-shape change, no streaming.** `noul`/`choice`/`score` only; `evaluate` stays a unary Effect.
- **Additive only.** `jev` and `llm` behavior is byte-for-byte unchanged; they gain a `capabilities` declaration and nothing else. Effective chunk caps must stay `min(30, >=30) = 30` so shadow telemetry stays comparable.
- **`capabilities` is OPTIONAL on `JudgmentService`.** ~25 test fakes across 8 packages construct `JudgmentService` literals; a required method breaks all of them. Consumers read capabilities only through `capabilitiesOf(svc)`.
- **No `any`, no `as any`, no `@ts-ignore`, no raw `throw` in production paths, no raw `await`.** Types via `Schema.Struct` for decoded data; errors via `Data.TaggedError`; state via `Ref`.
- **No new Bun-specific APIs.** Use `node:` built-ins and `globalThis` (`fetch`, `TextEncoder`, `AbortSignal.timeout`).
- **Tests:** `bun test <pkg-or-file> --timeout 15000`. No server processes, no network, no dangling handles. Inject fakes (`fetch`, `LLMService`, `JudgmentService`). Prove a named backend by pointing it at the unreachable port `http://127.0.0.1:1`.
- **Files:** kebab-case filenames, PascalCase types, camelCase functions. JSDoc on every public export. No em dashes (U+2014) in any file you create or edit; use commas, colons, parentheses, or hyphens.
- **Branch/commit:** work lands on `dev`, not `main`. One concern per commit. Never bump versions or edit CHANGELOG by hand.
- **Warden routing (standing convention, AGENTS.md "Team-Ownership Dev Contract").** Domain-scoped edits go through the owning warden via `Agent` dispatch with a MissionBrief (MissionBrief-in, UpwardReport-out); the parent dispatches, verifies, and integrates, and never asks a warden to self-review.
  - Tasks 1-4 (`packages/judgment/**`) and the facade/docs part of Task 8: no warden owns these paths; the main thread implements directly.
  - Tasks 5 and 6 (`packages/runtime/**`): **runtime-warden** owns the primary scope.
  - Task 7: split by domain. `packages/runtime/src/judgment-rank.ts` -> **runtime-warden**; `packages/reasoning/src/kernel/capabilities/comprehend/judgment-classification.ts` -> **kernel-warden**. Dispatch as two briefs, not one.
  - Every routed task: append one YAML block to `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md` with `warden: <name>`, and run the parent verifier (typecheck + the task's targeted tests) on the report.

## Review Focus

Inputs and failure modes the spec implies that a user will actually hit. Each is pinned to the task that owns the code.

1. **`keepAlive: 0`** means "unload the model after this request" and is falsy. A truthiness test silently drops it and the user's explicit intent is ignored. -> Task 4 test asserts `keep_alive: 0` reaches the body.
2. **`state: null`** (what `judgeRank()` always sends) and **an omitted `instructions`** (what `{ type: "noul", instructions?: ... }` permits) must encode to `{}`, never `null` and never an absent field, or Ollama 400s on a call that looks perfectly reasonable. -> Task 2 tests assert both.
3. **`images` passed to `jev` or `llm`** must fail loudly as `JudgmentUnsupported`, never be silently dropped into a text-only request that returns a confident wrong answer. -> Task 1 test asserts the guard fires without calling `evaluate`.
4. **An oversized `state`** (a large tool result folded into the judgment) must fail client-side naming the byte size and the ceiling that applied, before any network round trip. -> Task 3 test asserts `fetch` is never called.
5. **Ollama not running, or the model not pulled,** must produce an actionable message (``ollama pull <model>``), and a **cold first call** must not die at a 3s timeout. -> Task 4 tests assert the 404 hint names the resolved model and that the default timeout is `30_000`.

---

### Task 1: Capability negotiation primitive

The infrastructure change that lets every consumer stop hardcoding backend limits. Everything else depends on the names defined here.

**Files:**
- Modify: `packages/judgment/src/types.ts`
- Modify: `packages/judgment/src/services/judgment-service.ts`
- Modify: `packages/judgment/src/backends/jev-backend.ts`
- Modify: `packages/judgment/src/backends/llm-backend.ts`
- Modify: `packages/judgment/src/index.ts`
- Test: `packages/judgment/tests/capabilities.test.ts` (create)

**Interfaces:**
- Consumes: existing `JudgmentBackend`, `JudgmentAnswers`, `JudgmentError`, `JudgmentUnsupported`, `QuestionSpecs`, `JudgmentService`, `makeJudgmentServiceLive`, `withEvents`.
- Produces (later tasks rely on these exact names):
  - `type JudgmentQuestionKind = "noul" | "choice" | "score"`
  - `interface JudgmentCapabilities { readonly maxQuestions?: number; readonly supportedKinds: ReadonlyArray<JudgmentQuestionKind>; readonly distributions: boolean; readonly calibrated: boolean; readonly images: boolean; readonly modelCatalog: boolean }`
  - `const DEFAULT_JUDGMENT_CAPABILITIES: JudgmentCapabilities`
  - `const capabilitiesOf: (svc: JudgmentService["Type"]) => Effect.Effect<JudgmentCapabilities>`
  - `JudgmentBackend.capabilities?: JudgmentCapabilities`
  - `JudgmentBackend.evaluate` and `JudgmentService.ask` inputs each gain `readonly images?: readonly string[]`
  - `JudgmentService.capabilities?: () => Effect.Effect<JudgmentCapabilities>`

- [ ] **Step 1: Write the failing tests** in `packages/judgment/tests/capabilities.test.ts`.

Five tests, all against `makeJudgmentServiceLive` / `withEvents` with a local fake backend (follow the `fakeBackend` pattern already in `judgment-service.test.ts`):

```ts
it("defaults: a backend that omits capabilities gets DEFAULT_JUDGMENT_CAPABILITIES with modelCatalog derived from listModels")
// expect(await run(svc.capabilities!())).toEqual({ supportedKinds: ["noul","choice","score"], distributions: false, calibrated: false, images: false, modelCatalog: false })
// and modelCatalog: true when the fake also defines listModels

it("overlay: a backend-supplied capabilities record wins field-by-field over the defaults")
// fake declares { maxQuestions: 64, distributions: true, calibrated: true, images: true, supportedKinds: [...], modelCatalog: false }
// expect exactly that back, not a merge with defaults leaking calibrated:false

it("withEvents forwards capabilities() unchanged")

it("kind guard: a noul question against supportedKinds:['choice'] fails JudgmentUnsupported and never calls evaluate")
// assert the fake's evaluate call count is 0

it("image guard: a non-empty images array against images:false fails JudgmentUnsupported and never calls evaluate")

it("capabilitiesOf falls back to DEFAULT_JUDGMENT_CAPABILITIES for a service literal that omits the method")
// const legacy = { ask: () => Effect.succeed({}), listModels: () => Effect.die(new Error("x")) }
// expect(await Effect.runPromise(capabilitiesOf(legacy))).toEqual(DEFAULT_JUDGMENT_CAPABILITIES)
```

- [ ] **Step 2: Run them and verify they fail**

Run: `bun test packages/judgment/tests/capabilities.test.ts --timeout 15000`
Expected: FAIL, `capabilitiesOf` / `DEFAULT_JUDGMENT_CAPABILITIES` not exported.

- [ ] **Step 3: Add the types to `packages/judgment/src/types.ts`**

Add `JudgmentQuestionKind`, `JudgmentCapabilities`, and `DEFAULT_JUDGMENT_CAPABILITIES` exactly as in the Interfaces block above (spec §3). Add `readonly capabilities?: JudgmentCapabilities` to `JudgmentBackend` and `readonly images?: readonly string[]` to its `evaluate` input. JSDoc each field, copying the `distributions` wording from the spec (it is the one consumers will misread).

Do **not** put `capabilitiesOf` here: `types.ts` cannot import `JudgmentService` without creating a cycle.

- [ ] **Step 4: Add the service side to `packages/judgment/src/services/judgment-service.ts`**

- Widen the `ask` input with `readonly images?: readonly string[]` and forward it to `backend.evaluate(input)`.
- Add `readonly capabilities?: () => Effect.Effect<JudgmentCapabilities>` to the `Context.Tag` interface, marked optional with a JSDoc line naming the reason (the ~25 existing fakes).
- Export `capabilitiesOf(svc)` returning `svc.capabilities?.() ?? Effect.succeed(DEFAULT_JUDGMENT_CAPABILITIES)`.
- In `makeJudgmentServiceLive`, compute once at construction: `{ ...DEFAULT_JUDGMENT_CAPABILITIES, modelCatalog: backend.listModels !== undefined, ...backend.capabilities }`, expose it as `capabilities: () => Effect.succeed(caps)`, and guard `ask` before delegating: any question whose `type` is not in `caps.supportedKinds`, or a non-empty `input.images` when `caps.images` is false, fails `new JudgmentUnsupported({ message })` naming the offending kind / the backend name.
- In `withEvents`, forward `capabilities: inner.capabilities` so the decorated layer keeps it.

- [ ] **Step 5: Declare capabilities on the two existing backends**

`jev-backend.ts`: add `capabilities: { distributions: true, calibrated: true, modelCatalog: true, supportedKinds: ["noul","choice","score"], images: false }` to the returned object.
`llm-backend.ts`: omit the field entirely (it takes the defaults) and add a one-line comment saying so.

- [ ] **Step 6: Export from `packages/judgment/src/index.ts`**

Add to the existing type-export block: `JudgmentCapabilities`, `JudgmentQuestionKind`. Add to the value-export block: `DEFAULT_JUDGMENT_CAPABILITIES`. Add `capabilitiesOf` to the `./services/judgment-service.js` export line.

- [ ] **Step 7: Run the new tests, then the whole package, then typecheck**

Run: `bun test packages/judgment --timeout 15000`
Expected: PASS, including the pre-existing `judgment-service.test.ts`, `jev-backend.test.ts`, `llm-backend.test.ts`, `translate.test.ts` unchanged.

Run: `bun run typecheck`
Expected: clean workspace-wide. This is the step that proves `capabilities` stayed optional: if any of the ~25 fakes in `eval`, `guardrails`, `tools`, `cost`, `reasoning`, `interaction`, `judge-server`, or `runtime` now errors, the method was made required. Fix by making it optional, not by editing the fakes.

- [ ] **Step 8: Commit**

```bash
git add packages/judgment/src/types.ts packages/judgment/src/services/judgment-service.ts \
        packages/judgment/src/backends/jev-backend.ts packages/judgment/src/backends/llm-backend.ts \
        packages/judgment/src/index.ts packages/judgment/tests/capabilities.test.ts
git commit -m "feat(judgment): backend capability negotiation with service-level kind/image guards"
```

---

### Task 2: System One wire layer

The encoding rules in spec §2.2 are where this feature actually breaks or works. Pure functions, no fetch, fully testable in isolation.

**Files:**
- Create: `packages/judgment/src/backends/systemone/wire.ts`
- Test: `packages/judgment/tests/systemone-wire.test.ts`

**Interfaces:**
- Consumes: `JudgmentEntry`, `QuestionSpecs`, `QuestionSpec`, `JudgmentAnswers`, `JudgmentBadResponse` from `../../types.js`.
- Produces:
  - `type SystemOneContent = string | Record<string, unknown> | readonly unknown[]`
  - `interface SystemOneRequestBody { readonly model: string; readonly state: SystemOneContent; readonly questions: Record<string, unknown>; readonly images?: readonly string[] }`
  - `const encodeSystemOneRequest: (input: { readonly model: string; readonly state: JudgmentEntry; readonly questions: QuestionSpecs; readonly images?: readonly string[] }) => SystemOneRequestBody`
  - `const decodeSystemOneAnswers: (raw: unknown, specs: QuestionSpecs) => Effect.Effect<JudgmentAnswers, JudgmentBadResponse>`

- [ ] **Step 1: Write the failing encoding tests**

One `describe("encodeSystemOneRequest")` block, one test per §2.2 row. Assert with `toEqual` on the exact body so a stray `null` or omitted field fails:

```ts
it("state: non-blank string, object, and array pass through unchanged")
it("state: null, undefined, empty string, and whitespace-only all encode to {}")
it("instructions: omitted, null, and blank all encode to {} on every question type")
it("instructions: a real string passes through verbatim")
it("choice.criteria: string verbatim, null verbatim, object and array JSON.stringify-ed")
it("score.criteria: string verbatim, null becomes '', object and array JSON.stringify-ed")
it("noul.criteria: string verbatim, non-string JSON.stringify-ed, null/undefined side omitted")
it("questions keys and choice labels pass through verbatim")
it("images omitted from the body when absent or empty; present verbatim and in order otherwise")
it("a nested structured state round-trips into the exact { model, state, questions } body")
```

- [ ] **Step 2: Run them and verify they fail**

Run: `bun test packages/judgment/tests/systemone-wire.test.ts --timeout 15000`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `wire.ts`**

`encodeSystemOneRequest`: one `toContent(entry)` helper for the `state`/`instructions` rule (non-blank string, object, and array pass through; everything else becomes `{}`), one `toChoiceCriteria`, one `toScoreCriteria`, one `toNoulCriteria`, then a `switch (spec.type)` assembling each question with `type`, `instructions`, and `criteria` always present. Include only `images` when `images?.length` is truthy. Build the questions record with `Object.create(null)` (the `judgeRank` `__proto__` precedent).

Header comment: state that this file deliberately mirrors `translate.ts`'s `toSdkEntry`/`toSdkQuestions` and must stay SDK-free, and that `translate.ts` must stay SDK-bound. Cross-reference both ways (add the matching comment to `translate.ts` in this step).

`decodeSystemOneAnswers`: `Schema.Union` over three `Schema.Struct` variants tagged by `Schema.Literal("choice" | "noul" | "score")`, decoded with `Schema.decodeUnknown` and `Effect.mapError` to `new JudgmentBadResponse({ message })`. Then, for each key of `specs`, require the answer to exist and its wire `type` to equal the spec's `type`; otherwise fail `JudgmentBadResponse` naming the question id. Map to the `JudgmentAnswer` shapes from spec §2.4 (`calibrated: true` for choice and score; `legend` dropped). Ignore response `model` and `usage`.

- [ ] **Step 4: Write the failing decode tests, then implement against them**

```ts
it("decodes all three kinds with calibrated:true and probabilities verbatim")
it("fails JudgmentBadResponse when a requested id is missing from answers")
it("fails JudgmentBadResponse when the wire type does not match the requested spec type")
it("fails JudgmentBadResponse on an unknown wire type")
it("tolerates excess response fields (model, usage)")
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `bun test packages/judgment/tests/systemone-wire.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/judgment/src/backends/systemone/wire.ts \
        packages/judgment/src/translate.ts \
        packages/judgment/tests/systemone-wire.test.ts
git commit -m "feat(judgment): System One wire encoding and answer decoding"
```

---

### Task 3: System One protocol engine

**Files:**
- Create: `packages/judgment/src/backends/systemone/engine.ts`
- Test: `packages/judgment/tests/systemone-engine.test.ts`

**Interfaces:**
- Consumes: `encodeSystemOneRequest`, `decodeSystemOneAnswers` (Task 2); the `JudgmentError` classes and `JudgmentBackend` (Task 1).
- Produces:
  - `interface SystemOneProviderDescriptor` and `interface SystemOneHttpConfig` exactly as in spec §2.1
  - `const makeSystemOneHttpBackend: (descriptor: SystemOneProviderDescriptor, config?: SystemOneHttpConfig) => JudgmentBackend`

- [ ] **Step 1: Write the test descriptor and the failing tests**

Define one module-local synthetic descriptor in the test file (never import Ollama's; the engine/descriptor seam is what is under test). Give it `name: "synthetic"`, `defaultModel: "test-model"`, `defaultTimeoutMs: 5_000`, `limits: { minQuestions: 1, maxQuestions: 4, minCriteria: 2, maxCriteria: 5, maxBodyBytes: 512, images: { maxBodyBytes: 4096, max: 2 } }`, an `extraBodyFields` returning `{ synthetic: true }`, a `headers` returning `{ "X-Descriptor": "1" }`, and a `describeHttpError` returning `"hint for <model>"` on 404.

Inject a fake `fetch` capturing `{ url, init }` and returning a canned 200. Then:

```ts
it("model precedence: per-call model beats config.model beats descriptor.defaultModel")
it("posts to resolveEndpoint(baseUrl) + path, defaulting path to /v1/systemone")
it("sends Content-Type plus merged headers with config headers winning over descriptor headers")
it("spreads extraBodyFields into the body")
it("omits images from the body when absent; includes them verbatim and in order when present")
it("sets capabilities from descriptor.limits: maxQuestions, images:true, calibrated:true, distributions:true, modelCatalog:false")
```

Limit rejections, each asserting the fake `fetch` was **never called**:

```ts
it("0 questions and maxQuestions+1 questions fail JudgmentUnsupported naming the count")
it("1 and maxCriteria+1 choice criteria fail JudgmentUnsupported naming the question id")
it("1 and maxCriteria+1 score levels fail JudgmentUnsupported naming the question id")
it("a blank question key and a blank choice label fail JudgmentUnsupported naming the offender")
it("a body over maxBodyBytes fails JudgmentUnsupported naming the byte size and the text ceiling")
it("the same body with images is measured against images.maxBodyBytes instead and passes")
it("images over limits.images.max fail JudgmentUnsupported naming the count")
it("images against a descriptor with no limits.images fail JudgmentUnsupported")
```

Decode and error mapping:

```ts
it("decodes a 200 into JudgmentAnswers via decodeSystemOneAnswers")
it("maps a rejected fetch to JudgmentConnectionError")
it("maps an abort from AbortSignal.timeout to JudgmentTimeout carrying timeoutMs")
//   fake fetch: return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }))))
//   descriptor defaultTimeoutMs small enough, or config.timeoutMs: 5
it("maps 401/403 to JudgmentUnauthorized, 429 to JudgmentRateLimited with retryAfterMs parsed from Retry-After")
it("maps 400, 404, 413, and 5xx to JudgmentBadResponse, appending the describeHttpError hint")
it("assert _tag on every error row, never message text, except where the hint is the assertion")
```

- [ ] **Step 2: Run them and verify they fail**

Run: `bun test packages/judgment/tests/systemone-engine.test.ts --timeout 15000`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `engine.ts`**

`makeSystemOneHttpBackend(descriptor, config = {})` returns `{ name: descriptor.name, capabilities, evaluate }` with no `listModels`. `evaluate`:

1. Resolve `model` (per-call, then `config.model`, then `descriptor.defaultModel`) and `timeoutMs` (config, then descriptor default).
2. Enforce every §6 limit against `descriptor.limits` **before** encoding, returning `Effect.fail(new JudgmentUnsupported({ message }))`. Message copy: name the backend, the rule, and the offending value.
3. `encodeSystemOneRequest`, `JSON.stringify` once, measure with `new TextEncoder().encode(body).length` against the image-aware ceiling, then send that same string.
4. `Effect.tryPromise({ try: () => (config.fetch ?? globalThis.fetch)(url, { method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMs) }), catch: toJudgmentError })`.
5. Non-2xx: read the text body, build the message from the §7 table, append `descriptor.describeHttpError?.({ status, body, model })` when it returns a string, fail `JudgmentBadResponse` (or the status-specific tag for 401/403/429).
6. 2xx: `response.json()` then `decodeSystemOneAnswers(json, questions)`.

`toJudgmentError(cause)`: `cause.name === "TimeoutError"` -> `JudgmentTimeout({ message, timeoutMs })`; otherwise `JudgmentConnectionError({ message })`. Parse `Retry-After` and `retry-after-ms` into `retryAfterMs` only when finite.

Derive `capabilities` from `descriptor.limits`: `{ maxQuestions: limits.maxQuestions, supportedKinds: ["noul","choice","score"], distributions: true, calibrated: true, images: limits.images !== undefined, modelCatalog: false }`.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `bun test packages/judgment/tests/systemone-engine.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/judgment/src/backends/systemone/engine.ts packages/judgment/tests/systemone-engine.test.ts
git commit -m "feat(judgment): shared System One HTTP protocol engine with descriptor seam"
```

---

### Task 4: Ollama descriptor

**Files:**
- Create: `packages/judgment/src/backends/systemone/providers/ollama.ts`
- Modify: `packages/judgment/src/index.ts`
- Test: `packages/judgment/tests/ollama-backend.test.ts`

**Interfaces:**
- Consumes: `makeSystemOneHttpBackend`, `SystemOneProviderDescriptor` (Task 3); `resolveOllamaEndpoint` from `@reactive-agents/llm-provider`.
- Produces:
  - `interface OllamaJudgmentConfig { readonly baseUrl?: string; readonly model?: string; readonly timeoutMs?: number; readonly keepAlive?: string | number; readonly fetch?: typeof globalThis.fetch }`
  - `const makeOllamaBackend: (config?: OllamaJudgmentConfig) => JudgmentBackend`
  - `packages/judgment` public exports: `makeSystemOneHttpBackend`, `SystemOneProviderDescriptor`, `SystemOneHttpConfig`, `makeOllamaBackend`, `OllamaJudgmentConfig`

- [ ] **Step 1: Write the failing tests**

Set and restore `OLLAMA_HOST`/`OLLAMA_ENDPOINT`/`OLLAMA_BASE` around each test (follow `packages/llm-provider/src/ollama-endpoint.test.ts`). Inject a fake `fetch` through `OllamaJudgmentConfig.fetch` and assert on the captured request:

```ts
it("name is 'ollama' and it posts to <resolved endpoint>/v1/systemone")
it("honors OLLAMA_HOST when baseUrl is absent; baseUrl wins when present")
it("defaults model to 'nimble' and timeoutMs to 30_000")
it("passes model:'clef' and model:'clef-flash' through to the body")
it("omits keep_alive when keepAlive is undefined")
it("sends keep_alive when keepAlive is '10m', -1, and 0")   // Review Focus #1: 0 is falsy but meaningful
it("capabilities() reports maxQuestions:64, distributions:true, calibrated:true, images:true, modelCatalog:false")
it("has no listModels, so JudgmentService.listModels fails JudgmentUnsupported")
it("maps a 404 to JudgmentBadResponse whose message contains 'ollama pull' and the resolved model name")
it("maps a 400 to a message naming the local-GGUF requirement and clef/clef-flash for images")
```

- [ ] **Step 2: Run them and verify they fail**

Run: `bun test packages/judgment/tests/ollama-backend.test.ts --timeout 15000`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `ollama.ts`**

Build the descriptor object inside `makeOllamaBackend` so its hooks close over `config` (no `providerOptions` bag). Values exactly as in spec §2.3's table: `name: "ollama"`, `resolveEndpoint: resolveOllamaEndpoint`, `defaultModel: "nimble"`, `defaultTimeoutMs: 30_000`, `limits: { minQuestions: 1, maxQuestions: 64, minCriteria: 2, maxCriteria: 26, maxBodyBytes: 65_536, images: { maxBodyBytes: 33_554_432 } }`.

`extraBodyFields`: `config.keepAlive !== undefined ? { keep_alive: config.keepAlive } : {}`. Use `!== undefined`, never a truthiness test.

`describeHttpError({ status, body, model })`, in this order. Note `body` is the **server's error response text**, not our request, so the hints must not depend on what we sent:
- `status === 404` -> `` `local model not found: run \`ollama pull ${model}\`` ``
- `status === 400` -> one hint covering both documented causes: the model must be local GGUF weights with a scoring-capable runner (cloud and MLX/Safetensors models are rejected, and System One is unavailable on Ollama Cloud), and images require a model with vision weights (`clef` or `clef-flash`). Append the server's own `body` text when it is short enough to be useful.
- otherwise `undefined`

Omit `headers` and `listModels`. Return `makeSystemOneHttpBackend(descriptor, { baseUrl: config.baseUrl, model: config.model, timeoutMs: config.timeoutMs, fetch: config.fetch })`.

- [ ] **Step 4: Export from `packages/judgment/src/index.ts`**

Add a `// System One protocol core` export block: `makeSystemOneHttpBackend` and the `SystemOneProviderDescriptor` / `SystemOneHttpConfig` types from `./backends/systemone/engine.js`; `makeOllamaBackend` and the `OllamaJudgmentConfig` type from `./backends/systemone/providers/ollama.js`.

- [ ] **Step 5: Run the package tests, then typecheck and build**

Run: `bun test packages/judgment --timeout 15000`
Expected: PASS.

Run: `bun run typecheck && bun run build`
Expected: clean. `tsup` picks the new files up through `index.ts`; no config change needed.

- [ ] **Step 6: Commit**

```bash
git add packages/judgment/src/backends/systemone/providers/ollama.ts \
        packages/judgment/src/index.ts packages/judgment/tests/ollama-backend.test.ts
git commit -m "feat(judgment): Ollama System One decision backend (nimble, clef, clef-flash)"
```

---

### Task 5: Runtime backend registry and builder options

Removes the duplicated judgment-layer construction and wires `ollama` once.

**Ownership:** `packages/runtime/**` -> **runtime-warden** (see Global Constraints, warden routing). The new `judgment-layer.ts` plus the `builder/types.ts` and `runtime.ts` edits are one brief. Log one YAML block to the pilot log on completion.

**Files:**
- Create: `packages/runtime/src/judgment-layer.ts`
- Modify: `packages/runtime/src/builder/types.ts` (`JudgmentBuilderOptions`, ~L663-681)
- Modify: `packages/runtime/src/runtime.ts` (`judgmentOptLayer` ~L734-763, `lightJudgmentOptLayer` ~L1478-1505)
- Test: `packages/runtime/tests/builder-judgment.test.ts` (extend)

**Interfaces:**
- Consumes: `makeJevBackend`, `makeLlmBackend`, `makeOllamaBackend`, `makeJudgmentServiceLive`, `withEvents`, `JudgmentBackend` (Tasks 1-4); `LLMService`, `EventBus`.
- Produces:
  - `type JudgmentBackendName = "jev" | "llm" | "ollama"`, declared in `builder/types.ts` (next to `JudgmentBuilderOptions`) and imported by `judgment-layer.ts`, so neither module cycles
  - `interface JudgmentLayerDeps { readonly llmLayer: Layer.Layer<LLMService>; readonly eventBusLayer: Layer.Layer<EventBus> }`
  - `const resolveBackendName: (jc: JudgmentBuilderOptions | undefined) => JudgmentBackendName`
  - `const buildJudgmentLayer: (jc: JudgmentBuilderOptions | undefined, deps: JudgmentLayerDeps) => Layer.Layer<JudgmentService, never, never>`
  - `JudgmentBuilderOptions.backend?: JudgmentBackendName` and `JudgmentBuilderOptions.ollama?: { readonly keepAlive?: string | number }`

- [ ] **Step 1: Write the failing tests** in `builder-judgment.test.ts`

Reuse the file's existing `makeFakeLLM` and `agentsToDispose` teardown. The existing BACKEND SELECTION test already proves a backend by pointing it at `http://127.0.0.1:1`; copy that shape:

```ts
it("OLLAMA SELECTION: backend:'ollama' routes to the ollama backend, not the fake LLM")
//   .withJudgment({ backend: "ollama", baseUrl: "http://127.0.0.1:1", ollama: { keepAlive: 0 } })
//   (the namespaced keepAlive rides along so the registry's `jc?.ollama?.keepAlive` read is exercised;
//    its body-level effect is asserted in Task 4)
//   await expect(agent.judge({ state: null, questions: noulQuestion })).rejects.toBeTruthy()
//   expect(fakeLlmCallCount.count).toBe(0)
//   subscribe to EventBus first and assert a JudgmentFailed event with backend:"ollama" and errorTag:"JudgmentConnectionError"

it("resolveBackendName: explicit backend always wins; else jev when an apiKey resolves; else llm")
//   delete process.env.TYPESAFE_API_KEY for the llm case and restore it in a finally block,
//   matching the existing test's env handling

it("both runtime tiers resolve the same backend for the same options")
//   build a root agent and a light/sub-agent path with identical judgmentOptions and assert
//   both emit JudgmentFailed with the same backend label
```

- [ ] **Step 2: Run them and verify they fail**

Run: `bun test packages/runtime/tests/builder-judgment.test.ts --timeout 15000`
Expected: FAIL, `backend: "ollama"` is not assignable to `"jev" | "llm"`.

- [ ] **Step 3: Widen `JudgmentBuilderOptions`**

In `builder/types.ts`: change `backend?: "jev" | "llm"` to `backend?: JudgmentBackendName` (import the type from `./judgment-layer.js` or re-declare and re-export to avoid a cycle; prefer declaring `JudgmentBackendName` in `builder/types.ts` and importing it into `judgment-layer.ts`). Add `readonly ollama?: { readonly keepAlive?: string | number }` with JSDoc noting it applies only to `backend: "ollama"` and is ignored elsewhere. Generalize the `baseUrl` docstring to "backend base URL override (TypeSafe for `jev`, Ollama server root for `ollama`)". Update the interface-level JSDoc that currently describes only jev/llm selection.

- [ ] **Step 4: Implement `judgment-layer.ts`**

`resolveBackendName(jc)`: `jc?.backend ?? (jc?.apiKey ?? process.env.TYPESAFE_API_KEY ? "jev" : "llm")`. Copy the existing expression from `runtime.ts:737-738` so behavior is identical.

`BACKENDS` registry exactly as in spec §4, typed with `satisfies Record<JudgmentBackendName, (jc) => Effect.Effect<JudgmentBackend, never, LLMService>>`. The `ollama` entry reads `keepAlive: jc?.ollama?.keepAlive`.

`buildJudgmentLayer(jc, deps)`: `Layer.unwrapEffect(Effect.map(BACKENDS[resolveBackendName(jc)](jc), makeJudgmentServiceLive))` piped through `Layer.provide(deps.llmLayer)`, then wrapped in `withEvents("agent.judge", resolveBackendName(jc))` provided with `Layer.merge(serviceLayer, deps.eventBusLayer)`. Preserve the existing composition order from `runtime.ts:759-761`.

- [ ] **Step 5: Replace both runtime sites**

In `runtime.ts`, replace the whole `judgmentOptLayer` IIFE (~L734-763) with `options.enableJudgment ? buildJudgmentLayer(options.judgmentOptions, { llmLayer: observableLlmLayer, eventBusLayer }) : Layer.empty`, and the whole `lightJudgmentOptLayer` IIFE (~L1478-1505) with the same call passing `llmLayer`. Delete the now-unused `makeJevBackend` / `makeLlmBackend` / `makeJudgmentServiceLive` / `withJudgmentEvents` imports if nothing else in the file uses them; keep the `JudgmentService` type import if the layer type annotation still needs it. Preserve the existing comment block explaining that the layer is genuinely absent without `.withJudgment()`.

- [ ] **Step 6: Run the runtime tests and typecheck**

Run: `bun test packages/runtime/tests/builder-judgment.test.ts packages/runtime/tests/agent-list-judgment-models.test.ts packages/runtime/tests/judgment-context.test.ts --timeout 15000`
Expected: PASS, including the four pre-existing tests in `builder-judgment.test.ts` unchanged.

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/judgment-layer.ts packages/runtime/src/builder/types.ts \
        packages/runtime/src/runtime.ts packages/runtime/tests/builder-judgment.test.ts
git commit -m "refactor(runtime): single judgment backend registry, add ollama backend selection"
```

---

### Task 6: `agent.judge()` image channel

**Ownership:** `packages/runtime/**` -> **runtime-warden** (see Global Constraints, warden routing).

**Files:**
- Modify: `packages/runtime/src/reactive-agent.ts` (`JudgeInput` ~L164-170, `judge()` ~L613-666)
- Test: `packages/runtime/tests/judge-images.test.ts` (create)

**Interfaces:**
- Consumes: `JudgmentService.ask`'s `images?` input and the §3 service-level image guard (Task 1).
- Produces: `JudgeInput<Q>` gains `readonly images?: readonly string[]` on its intersection member.

- [ ] **Step 1: Write the failing tests**

Build an agent with `.withJudgment({ backend: "llm" })` and `.withReplayLLM(fakeLlmLayer)` where the fake layer is a `Layer.succeed(JudgmentService, ...)` capturing the `ask` input (follow `agent-list-judgment-models.test.ts`'s `fakeJudgmentService` + `.withLayers(...)` pattern):

```ts
it("forwards images to JudgmentService.ask verbatim and in order")
it("omits images from the ask input when the caller passes none or an empty array")
it("images coexist with includeContext (state merging is untouched)")
it("a text-only backend rejects images with JudgmentUnsupported rather than dropping them")
//   use the llm backend (capabilities.images defaults to false) and assert the rejection
```

- [ ] **Step 2: Run them and verify they fail**

Run: `bun test packages/runtime/tests/judge-images.test.ts --timeout 15000`
Expected: FAIL, `images` is not a property of `JudgeInput`.

- [ ] **Step 3: Implement**

Add `readonly images?: readonly string[]` to the intersection member of `JudgeInput` (the `& { questions; model? }` part, so it applies to both union arms). In `judge()`, destructure `images` alongside `questions` and `model` and pass it to `judgmentOpt.value.ask({ state: mergedState, questions, model, images })`. Extend the `@param input` JSDoc with the image contract from spec §4: base64 PNG/JPEG/WebP, caller order, passed through verbatim, requires a vision decision model (`clef`/`clef-flash`), no URL or data-URL fetching, rejected by text-only backends.

Do not add validation here; the §3 service guard owns it.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `bun test packages/runtime/tests/judge-images.test.ts packages/runtime/tests/judge-input-export.test.ts --timeout 15000`
Expected: PASS, `judge-input-export.test.ts` unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/reactive-agent.ts packages/runtime/tests/judge-images.test.ts
git commit -m "feat(runtime): optional images channel on agent.judge() for vision decision models"
```

---

### Task 7: Consumer capability adaptation

Replaces the two hardcoded `30` constants with the advertised ceiling. Behavior-preserving today.

**Ownership:** split by domain (see Global Constraints, warden routing). `packages/runtime/src/judgment-rank.ts` -> **runtime-warden**; `packages/reasoning/src/kernel/capabilities/comprehend/judgment-classification.ts` -> **kernel-warden**. Two MissionBriefs, both inheriting Task 1's `capabilitiesOf` interface.

**Files:**
- Modify: `packages/runtime/src/judgment-rank.ts` (`judgeRank`, ~L165-202)
- Modify: `packages/reasoning/src/kernel/capabilities/comprehend/judgment-classification.ts` (`CHUNK_CAP` L46, `chunkQuestions` L49-62, `judgmentComprehendShadow` L158-188)
- Test: `packages/runtime/tests/judgment-rank.test.ts` (extend)
- Test: `packages/reasoning/tests/kernel/capabilities/comprehend/judgment-classification.test.ts` (extend)

**Interfaces:**
- Consumes: `capabilitiesOf`, `JudgmentCapabilities` (Task 1).
- Produces: `chunkQuestions(toolNames: readonly string[], maxQuestions?: number): readonly QuestionSpecs[]`.

- [ ] **Step 1: Write the failing tests**

In `judgment-rank.test.ts`, extend `makeMockJudgment` to accept an optional `capabilities` record and return it from a `capabilities` method (leaving it off by default, which also proves the optional-method path still works):

```ts
it("clamps to capabilities().maxQuestions: 7 candidates with maxQuestions:3 fires ceil(7/3)=3 ask() calls")
it("an explicit opts.chunkCap still wins when it is tighter than maxQuestions")
it("a service that omits capabilities() keeps the DEFAULT_JUDGE_RANK_CHUNK_CAP behavior")
//   the existing (b)/(c) batching tests must still pass untouched
```

In `judgment-classification.test.ts`, add:

```ts
it("chunkQuestions respects a maxQuestions tighter than CHUNK_CAP")
it("a 40-tool roster with an unbounded backend still chunks at CHUNK_CAP=30 (existing test unchanged)")
```

- [ ] **Step 2: Run them and verify they fail**

Run: `bun test packages/runtime/tests/judgment-rank.test.ts --timeout 15000`
Expected: FAIL on the new clamp tests; the pre-existing (a)-(f) tests still PASS.

- [ ] **Step 3: Implement the `judgeRank` clamp**

Inside the existing `Effect.gen`, after the `chunkCap` positivity guard, add `const caps = yield* capabilitiesOf(judgment)` and compute `const effectiveCap = Math.min(chunkCap, caps.maxQuestions ?? Number.POSITIVE_INFINITY)`. Use `effectiveCap` in the `chunkArray` call. Keep the existing `Effect.die` guard on a non-positive **user** `chunkCap` exactly as is. Replace the `DEFAULT_JUDGE_RANK_CHUNK_CAP` doc comment's "must stay <= the backend ceiling, verified by test" wording with a line pointing at `capabilitiesOf`.

- [ ] **Step 4: Implement the comprehension clamp**

Change `chunkQuestions` to take `maxQuestions?: number` and compute `const cap = Math.min(CHUNK_CAP, maxQuestions ?? Number.POSITIVE_INFINITY)` internally, using `cap` everywhere it currently uses `CHUNK_CAP`. In `judgmentComprehendShadow`, after resolving `judgment`, add `const caps = yield* capabilitiesOf(judgment)` and pass `caps.maxQuestions` to `chunkQuestions`. Import `capabilitiesOf` from `@reactive-agents/judgment`. Update the `CHUNK_CAP` doc comment to say it is now a ceiling, not a fixed batch size.

- [ ] **Step 5: Run both packages' judgment tests and typecheck**

Run: `bun test packages/runtime/tests/judgment-rank.test.ts packages/reasoning/tests/kernel/capabilities/comprehend --timeout 15000`
Expected: PASS.

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/judgment-rank.ts packages/runtime/tests/judgment-rank.test.ts \
        packages/reasoning/src/kernel/capabilities/comprehend/judgment-classification.ts \
        packages/reasoning/tests/kernel/capabilities/comprehend/judgment-classification.test.ts
git commit -m "feat(judgment): consumers chunk to the backend's advertised maxQuestions"
```

---

### Task 8: Facade exports, documentation, release

**Files:**
- Modify: `packages/reactive-agents/src/index.ts` (~L117-152 judgment export blocks)
- Modify: `packages/judgment/package.json` (description, keywords)
- Modify: `AGENTS.md` (package-tree judgment line ~L39; Per-Layer Quick Reference table)
- Modify: `.changeset/config.json` (add `@reactive-agents/judgment` to the `fixed` group)
- Create: `.changeset/systemone-decision-backends.md`
- Modify: `apps/docs/src/content/docs/features/judgment-layer.md`
- Modify: `apps/docs/src/content/docs/reference/builder-api.md`
- Modify: `apps/docs/src/content/docs/cookbook/judgment-recipes.md`
- Modify: `README.md` (judgment mention)
- Modify: `wiki/Planning/Planning-Index.md`

**Interfaces:**
- Consumes: every public symbol from Tasks 1-4.
- Produces: `reactive-agents` re-exports of `makeSystemOneHttpBackend`, `makeOllamaBackend`, `capabilitiesOf`, `DEFAULT_JUDGMENT_CAPABILITIES`, and the `SystemOneProviderDescriptor` / `SystemOneHttpConfig` / `OllamaJudgmentConfig` / `JudgmentCapabilities` / `JudgmentQuestionKind` types.

- [ ] **Step 1: Add the facade re-exports**

In `packages/reactive-agents/src/index.ts`, extend the existing judgment value-export block (~L133) with `makeSystemOneHttpBackend`, `makeOllamaBackend`, `capabilitiesOf`, `DEFAULT_JUDGMENT_CAPABILITIES`, and the type-export block (~L139-152) with the five new types. Keep the existing section comments.

- [ ] **Step 2: Verify the facade compiles and exports**

Run: `bun run typecheck && bun run build`
Expected: clean. Then confirm the symbols resolve:

Run: `bun -e "const m = await import('./packages/reactive-agents/src/index.ts'); console.log(typeof m.makeOllamaBackend, typeof m.capabilitiesOf)"`
Expected: `function function`

- [ ] **Step 3: Fix the changeset lockstep gap**

`.changeset/config.json`'s `fixed` group lists 34 packages but **omits `@reactive-agents/judgment`**, so a judgment changeset would not move in lockstep with the rest. Add `"@reactive-agents/judgment"` to that array, alphabetically after `"@reactive-agents/interaction"`.

- [ ] **Step 4: Create `.changeset/systemone-decision-backends.md`**

```markdown
---
"@reactive-agents/judgment": minor
"@reactive-agents/runtime": minor
"@reactive-agents/reasoning": minor
"reactive-agents": minor
---

Judgments can now run completely local and private. `.withJudgment({ backend: "ollama" })`
points the Choice/Score/Noul primitive at Ollama's System One decision API
(`ollama pull nimble`, or Cloudflare's `clef` / `clef-flash` for vision), with
calibrated distributions, no API key, and no outbound network.

[then: the capability negotiation addition, the images channel on agent.judge(),
the ollama.keepAlive builder option, and the note that jev/llm behavior is
unchanged. Follow the prose density of .changeset/a2a-repair.md.]
```

- [ ] **Step 5: Update the docs site**

`features/judgment-layer.md`: add an `ollama` row to the backends table; add a "Local & private judgment (Ollama)" section with the `ollama pull nimble` prerequisite and a `.withJudgment({ backend: "ollama" })` example; add a "Decision models" subsection covering `model: "clef"` / `"clef-flash"` / `"tev"` and the `images: string[]` argument on `agent.judge()` (base64 only, vision model required, 32 MiB ceiling); add a "Backend capabilities" subsection defining `maxQuestions` / `supportedKinds` / `distributions` / `calibrated` / `images` / `modelCatalog` and noting consumers adapt automatically; update the "Backend-agnostic by design" bullet to describe the two extension tiers (spec §5) so a future "add OpenAI" ask does not assume the engine generalizes. Update the `backend: "jev" | "llm"` mention at ~L57 to include `"ollama"`.

`reference/builder-api.md`: widen the `backend` union and document `ollama: { keepAlive }`.
`cookbook/judgment-recipes.md`: add a local-privacy recipe and a screenshot-classification recipe (Clef + `images`).
`README.md`: update the judgment mention for the new backend.

- [ ] **Step 6: Update the repo docs**

`AGENTS.md`: update the package-tree `@reactive-agents/judgment` line (~L39) to name the System One engine and the Ollama backend; add a judgment row to the Per-Layer Quick Reference table (first file `src/services/judgment-service.ts`, key exports `JudgmentService`, `makeJevBackend`, `makeLlmBackend`, `makeOllamaBackend`, `capabilitiesOf`).
`packages/judgment/package.json`: the description currently says "provider-abstracted over TypeSafe/Jev and an LLM-emulation fallback"; add the Ollama System One backend. Add `ollama`, `decision-models`, `systemone` to keywords.

- [ ] **Step 7: Update the wiki index status**

This plan and the spec were registered in `wiki/Planning/Planning-Index.md` at authoring time (row dated 2026-10-05). Flip that row's status cell from "🟢 ACTIVE: 8 tasks, not started" to shipped-with-commit-details once Steps 1-6 and the Task 8 gate are green, matching the wording style of the two judgment rows below it ("SHIPPED + MERGED to `dev` (`<sha>`)").

- [ ] **Step 8: Run the full verification gate**

Run: `bun test packages/judgment packages/runtime packages/reasoning --timeout 15000`
Expected: PASS, 0 fail.

Run: `bun run typecheck && bun run build`
Expected: clean.

Run: `grep -rn "workspace:" apps/stackblitz/ && echo FAIL || echo PASS`
Expected: `PASS`.

- [ ] **Step 9: Commit**

```bash
git add packages/reactive-agents/src/index.ts packages/judgment/package.json AGENTS.md \
        .changeset/config.json .changeset/systemone-decision-backends.md \
        apps/docs/src/content/docs README.md wiki/Planning/Planning-Index.md
git commit -m "docs(judgment): System One decision backends, capabilities, and Ollama vision models"
```

---

## Verification checklist (whole plan)

- [ ] `bun test packages/judgment packages/runtime packages/reasoning --timeout 15000` passes with 0 failures
- [ ] `bun run typecheck` clean workspace-wide (this is what proves `capabilities` stayed optional and the ~25 service fakes still compile)
- [ ] `bun run build` clean
- [ ] No new `TODO`/`FIXME` without a tracking issue
- [ ] `grep -rn "as any" packages/judgment/src packages/runtime/src/judgment-layer.ts` returns nothing new
- [ ] Manual smoke (optional, requires a local Ollama): `ollama pull nimble`, then a `.withJudgment({ backend: "ollama" })` agent answering one `noul` question returns `calibrated`-shaped answers with no API key set
