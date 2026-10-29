---
type: implementation-plan
status: completed
created: 2026-10-28
tags: [implementation-plan, cortex, llm-provider, providers, models, tool-schema, strategies, reliability]
---

# Cortex Reliability & Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax.
>
> **Owner: <warden>** tasks go through that warden with a MissionBrief (`.claude/skills/mission-brief`) and are logged in the pilot log. **Owner: main** tasks are done by the dispatcher or a general subagent.

**Goal:** Cortex chat works with every provider the framework supports, every model each provider actually offers, and every selectable strategy. No hand-maintained lists drift.

**Architecture:** Every fix lands at the narrowest owning layer:
- **Tool schemas** are normalized once in `llm-provider`, for every provider, with strict mode used only where the schema is compatible.
- **Provider and model lists** are derived from the framework. Model discovery becomes an `llm-provider` primitive with a fallback to the presets.
- **Strategies:** a chat strategy matrix proves every selectable strategy end to end.

**Tech Stack:** TypeScript, Effect-TS, Bun test, Elysia (Cortex server), SvelteKit (Cortex UI).

**Plan family:** this plan is 1 of 3, split on 2026-10-28 from one combined draft.
- Plan 2: [[2026-10-28-cortex-run-visibility]]
- Plan 3: [[2026-10-28-plan-and-goal-primitives]]

This plan depends on neither of them. Run it first.

## Global Constraints

- **Types.** No `any`, no `as any`, no new `as unknown as`. Every new public export gets JSDoc.
- **Effect-TS.** Follow `CODING_STANDARDS.md` and `effect-ts-patterns`: no `throw` in new code, tagged errors, and every new service gets tests.
- **Domain wardens (AGENTS.md table).** A task inside a warden's domain is dispatched to that warden with a MissionBrief and logged in `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md`. Parent-marked rows are done by the dispatcher.
- **Ratchets.** The `with*` method count stays at or below its ceiling (`builder-wither-ratchet.test.ts`). File-size ceilings in `scripts/check-file-size.sh` are exact, and wardens never edit `scripts/`. `check-cross-cutting.sh` and `check-ledger-writes.sh` must stay green.
- **Commits.** No `Co-Authored-By` trailer (`.githooks/commit-msg` rejects it). Use Conventional Commits, one concern per commit, and keep the workspace typecheck green after every commit.
- **Tests.** Run scoped tests with `bun test <path> --timeout 15000`. CI has no API keys and no Ollama, so tests use the test provider or an injected `fetch`. New test files require `bun run --cwd apps/docs metrics` and `metrics:sync-readme` in the same commit.
- **Cortex** imports packages from `dist`. Run `bunx turbo run build --filter=<pkg>...` before running Cortex tests.
- **Execution.** Use subagent-driven development: a fresh implementer per task, then a fresh reviewer, then a whole-branch review at the end. Apply the dispatcher FSM, and never re-prompt a warden to review its own work.

## Review Focus

1. **A malformed MCP tool schema must never fail a run**, on any provider or strategy. Missing `items`, nested `anyOf`/`oneOf`/`allOf`, and a `type` given as an array are all covered. Pinned in Tasks 1 and 2.
2. **Normalization is a no-op for well-formed schemas.** Every built-in tool schema comes out deep-equal. Pinned in Task 1.
3. **No key reaches the wrong host.** A provider key is sent only to that provider's own model endpoint. Pinned in Task 4.
4. **The UI never shows an empty picker.** When discovery fails (no key, offline, 401, timeout), it falls back to presets and says why. Pinned in Tasks 4 and 5.
5. **The provider lists cannot drift again.** The UI fallback list is pinned against the server list. Pinned in Task 3.
6. **Distinct lookups are never blocked as repetition, and true loops still are.** Pinned in Task 6.

## Order

1 → 2. Tasks 3, 4, 6 and 7 can run in parallel with them. Task 5 needs Tasks 3 and 4. Task 6 fixes a harness defect that corrupts multi-lookup chat answers, so it should run early.

| Task | Owner | Depends on |
|---|---|---|
| 1. Normalize tool schemas for every provider | provider-warden | — |
| 2. Chat strategy matrix | main | 1 |
| 3. Provider list from the framework | main | — |
| 4. Live model discovery primitive | provider-warden | — |
| 5. Cortex pickers use discovery | main | 3, 4 |
| 6. Repetition guard boundary fix | kernel-warden (+ harness-warden probe) | — |
| 7. Meta-tool config honesty (`harnessSkill`, `withMetaTools`) | runtime-warden / kernel-warden | — |

---

### Task 1: Tool schemas are normalized once for every provider (bug fix)

**Owner:** provider-warden. **Priority: first.** This is a live failure in Cortex chat.

**Problem (observed 2026-10-28, Cortex chat, `openai:gpt-4o`, adaptive strategy):**

`400 Invalid schema for function 'umami_run_funnel': In context=('properties', 'steps', 'anyOf', '0'), array schema missing items.`

The MCP server's tool schema has an `anyOf` branch with `type: "array"` and no `items`. Two problems let it through:

- **Nothing repairs malformed schemas before they reach a provider.**
  - `toStrictToolSchema` (`providers/openai.ts:182-226`) never adds a missing `items`.
  - It recurses into `anyOf` only to set `additionalProperties` on object branches, and never into array branches or nested `anyOf`/`oneOf`/`allOf`.
  - `anthropic.ts:123`, `gemini.ts:115`, `local.ts:335` and `litellm.ts:83` pass `inputSchema` through raw.
- **The failure isn't strategy-specific.** It depends on which tools are visible. Adaptive appears to keep this MCP tool visible where other strategies prune it. The executor confirms this before asserting it in the commit.

**Fix: one boundary.** A provider-agnostic `normalizeToolSchema` runs once, inside the shared adapter path, before any provider-specific transform. Strict mode is applied only where the result can satisfy it.

**Files:**
- Modify `packages/llm-provider/src/schema-utils.ts` and add:
  - `normalizeToolSchema(schema: unknown): { readonly schema: JSONSchema; readonly repairs: readonly SchemaRepair[] }`. It is pure and recursive over `properties`, `items`, `anyOf`, `oneOf`, `allOf` and `additionalProperties`. Repairs:
    - an `array` with no `items` gets `items: {}`;
    - an `object` with no `properties` gets `properties: {}`;
    - a non-object root is wrapped as an `object`;
    - `type` arrays such as `["string","null"]` become `anyOf`;
    - an empty `required` entry is dropped.
  - `interface SchemaRepair { readonly path: string; readonly kind: "array-items" | "object-properties" | "root-object" | "type-array" | "required-pruned" }`
  - `isStrictCompatible(schema: JSONSchema): boolean`. It returns false when any node lacks a concrete `type`, or when it uses keywords that OpenAI strict mode rejects. The provider-warden verifies that list against OpenAI's structured-outputs docs.
- Modify `packages/llm-provider/src/providers/openai.ts`:
  - `toStrictToolSchema` recurses into every `anyOf` branch, array `items` and nested object, not only top-level properties.
  - `toOpenAITool` uses `strict` only when `isStrictCompatible(normalized)`. Otherwise it sends that tool with `strict` off. One bad MCP tool must never fail the run.
- Modify `anthropic.ts`, `gemini.ts`, `local.ts` and `litellm.ts` to send `normalizeToolSchema(...).schema`. Gemini has its own subset rules; extend them only if a test shows a failure.
- Observability: when repairs are non-empty, emit one structured log or trace event per tool per run (`tool-schema-repaired`, carrying `toolName` and `repairs`) through the existing provider logging path. No `console`.
- Test: `packages/llm-provider/tests/tool-schema-normalize.test.ts`, plus extensions to `openai-tools.test.ts`.

- [ ] **Step 1: Write the failing tests.**
  - **The observed failure:** a fixture `{type:"object",properties:{steps:{anyOf:[{type:"array"},{type:"string"}]}}}` normalizes so that `steps.anyOf[0].items` deep-equals `{}`, with one repair at path `properties.steps.anyOf.0`.
  - **Deep nesting:** the same repair happens at depth inside `items`, `oneOf` and `allOf`.
  - **Well-formed schemas:** a schema that needs no repair comes back deep-equal with zero repairs. This proves the change is a no-op for every built-in tool. Run it over all registered built-in tool schemas.
  - **OpenAI strict mode:**
    - `toOpenAITool(fixture, true)`: when the normalized schema is not strict-compatible, `strict` is absent and `parameters` contains `items`;
    - a fully typed nested schema gets strict-transformed in every `anyOf` branch, with `additionalProperties:false` and all keys required.
  - **Other providers:** each sends a normalized schema. Assert through each provider's tool-mapping function.
- [ ] **Step 2: Run** `bun test packages/llm-provider/tests/tool-schema-normalize.test.ts packages/llm-provider/tests/openai-tools.test.ts --timeout 15000`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test packages/llm-provider --timeout 15000` and `bunx turbo run typecheck --filter=@reactive-agents/llm-provider`. Expected: PASS. Then do a manual live check in a scratch script: run `openai:gpt-4o` with the same Umami MCP server, or the fixture as a custom tool, once with adaptive and once with reactive. Expected: no 400. Record the result, not the key.
- [ ] **Step 5: Commit** `fix(llm-provider): normalize tool schemas once for every provider; strict only when compatible`. Log the warden task.

---

### Task 2: Every selectable strategy works in Cortex chat (regression net)

**Owner:** main. Run after Task 1.

**Problem:** Cortex chat lets the user pick any strategy (`AgentConfigPanel.svelte` strategy section, `STRATEGY_FALLBACK` at `:358`), but nothing proves each one runs end-to-end through `ChatSessionService.chatStream`. The Task 1 failure surfaced only under adaptive.

**Files:**
- Create: `apps/cortex/server/tests/chat-strategy-matrix.test.ts`
- Modify: any Cortex wiring the matrix shows to be broken. Fix it at the narrowest owning layer: a framework bug goes to that package's warden, with no Cortex workaround.

- [ ] **Step 1: Write the matrix test.** For each strategy Cortex offers, with the strategy list read from the same source the UI uses (not a hand-copied list), and using the test provider:
  - **Turn 1:** a plain question. Assert it reaches `StreamCompleted` with non-empty output.
  - **Turn 2, same session:** a tool turn (a scripted call to a simple custom tool). Assert it reaches `StreamCompleted`, the turn persists, and history carries over.
  - **Tool schema:** expose a malformed-schema tool, the Task 1 fixture registered as a custom tool. Assert no strategy fails on it.
  - **Errors:** each failure message names the strategy.
- [ ] **Step 2: Run** `bunx turbo run build --filter=@reactive-agents/runtime...`, then `bun test apps/cortex/server/tests/chat-strategy-matrix.test.ts --timeout 30000`. Fix each red cell at its owning layer, routed by the warden table, and re-run.
- [ ] **Step 3: Check in the browser:** with the real provider, switch strategies mid-session (reactive → adaptive → plan-execute → reflexion) and send a tool-using message under each.
- [ ] **Step 4: Commit** `test(cortex): chat strategy matrix proves every selectable strategy end-to-end`, with the fixes as separate commits per owning layer.

---

### Task 3: Cortex offers every framework provider

**Owner:** main. Can run in parallel with Tasks 1–2.

**Problem:** Cortex lists only 6 of the framework's 8 providers. `groq` and `xai` are missing (`packages/llm-provider/src/types.ts:14-30`, `LLMProviderType`). The list is also hand-copied in three places, which is why it drifted:
- `apps/cortex/ui/src/lib/inference-presets.ts:6` (`CHAT_PROVIDERS`)
- `apps/cortex/ui/src/lib/components/AgentConfigPanel.svelte:309` (`PROVIDERS`)
- `apps/cortex/ui/src/routes/settings/+page.svelte:39-45` (`PROVIDERS`, which also lacks `test`)

**Fix:** make one source, derived from the framework, so a future provider appears in Cortex with no UI edit.

**Files:**
- Modify: `apps/cortex/server/api/models.ts`. Add `GET /api/models/providers` returning `readonly { id: string; label: string; local: boolean }[]`, built from `LLMProviderType.literals` minus `"custom"` (matching runtime `ProviderNameSchema`). Labels come from one server-side map, with `id` as the fallback label.
- Create: `apps/cortex/ui/src/lib/providers.ts`. `loadProviders(): Promise<readonly ProviderOption[]>` fetches and caches the list, and `PROVIDER_FALLBACK` holds the static 8 for an offline server. `CHAT_PROVIDERS` / `ChatProviderId` become derived from the fallback, so existing type imports keep compiling.
- Modify: `inference-presets.ts`, `AgentConfigPanel.svelte`, `settings/+page.svelte`, `ChatPanel.svelte:261` and `ChatSessionList.svelte:135`, so all of them read the one list.
- Check that the server's `listFrameworkModelsForProvider("groq" | "xai")` and `getProviderDefaultModel` return models. If either is empty, the provider still shows, with free-text model entry.
- Test: `apps/cortex/server/tests/providers-endpoint.test.ts`, `apps/cortex/ui/src/lib/providers.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - The endpoint's ids equal `LLMProviderType.literals` without `custom`, plus `test`.
  - The ids include `groq` and `xai`.
  - `PROVIDER_FALLBACK` ids equal the endpoint ids. This drift pin fails if the fallback goes stale.
  - A chat session whose `provider: "groq"` is restored is recognised by the session list, not dropped.
- [ ] **Step 2: Run** `bunx turbo run build --filter=@reactive-agents/llm-provider`, then `bun test apps/cortex/server/tests/providers-endpoint.test.ts apps/cortex/ui/src/lib/providers.test.ts --timeout 15000`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests, `bun test apps/cortex --timeout 15000` and `bun run --cwd apps/cortex/ui check`. Then check in the browser that Groq and xAI appear in chat, Lab and Settings, with key-presence handling the same as the other hosted providers.
- [ ] **Step 5: Commit** `feat(cortex): provider lists derive from the framework (adds groq, xai)`.

---

### Task 4: Live model discovery as an `llm-provider` primitive

**Owner:** provider-warden. Can run in parallel with Tasks 1–3.

**Problem:** only Ollama lists its models live (Cortex `server/api/models.ts:62`, `/api/tags`). Every hosted provider shows the static `ModelPresets` (`llm-provider/src/model-catalog.ts:28` `listFrameworkModelsForProvider`), so each new model release needs a code change. Discovery belongs in the framework, not in Cortex, so every app and the CLI get it.

**Files:**
- Create: `packages/llm-provider/src/model-discovery.ts`, which owns the provider listing endpoints. The provider-warden verifies each one against the provider's current official docs before coding:

  | Provider | Endpoint | Auth | Shape |
  |---|---|---|---|
  | anthropic | `GET https://api.anthropic.com/v1/models` | `x-api-key` + `anthropic-version` | paginated `data[].id` |
  | openai | `GET https://api.openai.com/v1/models` | Bearer | `data[].id` |
  | groq | `GET https://api.groq.com/openai/v1/models` | Bearer | OpenAI-compatible |
  | xai | `GET https://api.x.ai/v1/models` | Bearer | OpenAI-compatible |
  | gemini | `GET https://generativelanguage.googleapis.com/v1beta/models` | key in header (`x-goog-api-key`) | keep only `supportedGenerationMethods` ∋ `generateContent` |
  | litellm | `GET {baseUrl}/v1/models` | optional key | — |
  | ollama | `GET {host}/api/tags` | — | honors `OLLAMA_HOST` the same way the provider does |
  | test | static | — | — |

- Modify: `packages/llm-provider/src/index.ts` (exports), `src/errors.ts` (tagged error).
- Test: `packages/llm-provider/tests/model-discovery.test.ts`

**Interfaces:**
- `interface DiscoveredModel { readonly id: string; readonly label: string; readonly source: "live" | "preset"; readonly contextWindow?: number; readonly supportsThinking: boolean | null }`
- `class ModelDiscoveryError extends Data.TaggedError("ModelDiscoveryError")<{ provider: string; reason: "no-credentials" | "unreachable" | "http" | "parse"; status?: number; message: string }>`
- `listProviderModels(provider: ProviderName, opts?: { apiKey?: string; baseUrl?: string; timeoutMs?: number; fetch?: typeof fetch }): Effect.Effect<readonly DiscoveredModel[], ModelDiscoveryError>`
  - Credentials come from the same env resolution the provider layer uses, unless passed in. A key is sent only to that provider's own endpoint.
  - The default timeout is 5000 ms. `fetch` is injectable for tests.
- `resolveProviderModels(provider, opts?): Effect.Effect<{ readonly models: readonly DiscoveredModel[]; readonly live: boolean; readonly error?: ModelDiscoveryError }, never>`. This is the call apps should use.
  - It merges live results with `listFrameworkModelsForProvider` presets: live first, then presets not already listed, deduplicated by id.
  - If discovery fails, it falls back to presets only and returns `live: false` plus the error. It never fails outright.
  - Results are cached per `(provider, baseUrl, key fingerprint)` for 10 minutes. The fingerprint is a hash, so the raw key is never used as a cache key.
- Chat-capable filter, a pure `isChatModel(provider, id)` with a documented list per provider. It drops embedding, TTS, transcription, image, moderation and realtime models, for example the OpenAI ids `text-embedding-*`, `tts-*`, `whisper-*`, `dall-e-*`, `omni-moderation-*` and `*-realtime-*`.
- `supportsThinking` comes from `resolveCapability(provider, id)`, with `null` when unknown. Unknown models are still listed.

- [ ] **Step 1: Write the failing tests.** All use an injected `fetch`, so there are no keys and no network, matching CI.
  - **Per provider:** a recorded-shape fixture parses to the expected ids. Anthropic pagination follows `has_more`/`last_id`, and Gemini drops non-`generateContent` models.
  - **Filtering:** OpenAI non-chat ids are filtered out.
  - **Errors:**
    - no key gives `no-credentials`, with no fetch made;
    - HTTP 401 gives `http` with status 401;
    - a timeout gives `unreachable`;
    - malformed JSON gives `parse`.
  - **Resolve:** the result contains live and preset models in order, with no duplicates. On failure it returns presets only, `live: false`, and the error present.
  - **Cache:** a second call within the TTL makes no second fetch. A different key fingerprint does fetch.
  - **Key isolation:** an assertion on the injected fetch shows a key is never sent to another provider's host.
- [ ] **Step 2: Run** `bun test packages/llm-provider/tests/model-discovery.test.ts --timeout 15000`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use `Effect.tryPromise` with tagged errors and no `throw`.
- [ ] **Step 4: Run** the test, `bun test packages/llm-provider --timeout 15000`, and `bunx turbo run typecheck --filter=@reactive-agents/llm-provider`. Expected: PASS. Then do a manual live check with a scratch script in the scratchpad, against Ollama plus whichever keys are in `.env`. Record the counts per provider in the commit body, never the keys.
- [ ] **Step 5: Commit** `feat(llm-provider): live model discovery with preset fallback (listProviderModels / resolveProviderModels)`. Log the warden task.

---

### Task 5: Cortex model pickers use live discovery (after Tasks 3 and 4)

**Owner:** main

**Files:**
- Modify: `apps/cortex/server/api/models.ts`. `GET /api/models/:provider` (with an optional `endpoint` query for ollama/litellm) returns `{ models, live, error? }` from `resolveProviderModels`. The current `/framework/:provider` and `/ollama` routes become thin aliases of it, so there is one code path, and are removed once the UI has moved over. Keep `default` from `getProviderDefaultModel`. Ollama's per-model `api/show` thinking probe moves into this route, reused unchanged.
- Modify: `apps/cortex/ui/src/lib/framework-models.ts` and `framework-model-options-local.ts`. There is one loader per provider. The UI shows a small "showing built-in list" note when `live` is false, along with the error reason (for example "add GROQ_API_KEY in Settings").
- Test: `apps/cortex/server/tests/models-endpoint.test.ts` (inject the discovery layer or fetch), plus the existing `framework-model-options-local.test.ts` updated.

- [ ] **Step 1: Write the failing tests.**
  - With discovery stubbed live, the endpoint returns the merged list with `live: true`.
  - With discovery failing, it returns presets, `live: false`, and `error.reason`.
  - The ollama route still honors `endpoint`.
  - The UI loader maps `live: false` to the fallback note.
- [ ] **Step 2: Run** `bunx turbo run build --filter=@reactive-agents/llm-provider`, then the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test apps/cortex --timeout 15000` and `bun run --cwd apps/cortex/ui check`. Then do a browser check that every provider's picker loads live where a key exists and falls back cleanly where it does not.
- [ ] **Step 5: Commit** `feat(cortex): model pickers resolve live models per provider with preset fallback`.

---

### Task 6: Repetition guard — distinct arguments are not repetition (boundary fix)

**Owner:** kernel-warden. harness-warden runs the before/after probe.

**Problem (found by the 2026-10-28 todo probe):**
- `repetitionGuard` (`packages/reasoning/src/kernel/capabilities/act/guard.ts:338-420`) and `isParallelBatchSafeTool` (`decide/tool-gating.ts:106-138`) treat a user tool as safe to repeat only when its name contains one of a few words such as `get`, `read`, `search` or `query`.
- The distinct-target exemption only recognises the argument keys `path/file/target/url/id/command` (`guard.ts:97`).
- So `inventory_lookup({sku:"C300"})`, a lookup with a new argument value, was replaced on its third call with "Stop repeating this tool". The model then invented a total.
- This is the third instance of this defect class. Per project feedback, fix the boundary and do not add a fourth carve-out.

**Fix:** a call is a repetition only when its canonicalized full arguments equal those of a prior call to the same tool in the window. Name-based heuristics may still tighten that rule for side-effecting tools, but they never block distinct arguments.

**Files:** `kernel/capabilities/act/guard.ts`, `decide/tool-gating.ts`, and their tests. Keep each file at or below its ceiling.

- [ ] **Step 1: Write the failing tests.**
  - Five calls to a user tool `inventory_lookup` with five distinct `sku` values all run.
  - Three identical calls trip the guard on the third, exactly as today.
  - The existing distinct-target, path and file tests stay green.
  - Argument canonicalization: key order and whitespace do not make two calls distinct.
- [ ] **Step 2: Run** `bun test packages/reasoning/src/kernel/capabilities/act packages/reasoning/src/kernel/capabilities/decide --timeout 15000`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test packages/reasoning --timeout 15000`, then typecheck and `bash scripts/check-file-size.sh`. Expected: PASS.
- [ ] **Step 5: Before/after probe.** Dispatch harness-warden. It reruns the probe's L task with the original `sku` argument name on qwen3:14b and gemma4:12b, n=5 per arm (before vs after), and reports guard trips and success. Record the result in the commit body.
- [ ] **Step 6: Commit** `fix(kernel): repetition is identical arguments, not a tool-name heuristic`. Log the warden task.

---

### Task 7: Meta-tool configuration that does what it says

**Owner:** runtime-warden for runtime changes, kernel-warden for `resolve-think-surface.ts`. Dispatch them as two briefs.

**Problems (probe side findings):**
1. **The default `harnessSkill: true` has no effect.** `runtime-construction.ts:340-376` generates the skill text, but `reason/resolve-think-surface.ts:224` injects it only when `brief` or `pulse` is on, and both are off by default. That makes it a write-only configuration field (the wire-or-delete rule).
2. **`.withMetaTools({ todo: true })` silently drops `recall`.** The wither means "exactly what you name" (`builder/withers/tools.ts:143`), so enabling one tool disables `recall`, which large tool results depend on.

**Fix:**
1. **harnessSkill:** decide between wiring and deleting on evidence.
   - If the skill text is meant to reach the model when only `recall` is on, wire it. That changes what the model sees, so it is routed through ablation-warden before it becomes default.
   - Otherwise make the default honest: `harnessSkill` resolves to off when no tool it describes is injectable, and the JSDoc says so.
   - Whichever way it goes, add a test proving the field's effect.
2. **withMetaTools:** keep the exact-set semantics. Changing them would break callers silently. Instead, when a call leaves out a meta-tool that defaults to on (`recall`), log one notice saying it was dropped and how to keep it. Update the JSDoc and the docs example to spell out the full set.

- [ ] **Step 1: Write the failing tests.**
  - With the default config, the system prompt contains the harness skill text if and only if the resolved setting says it should.
  - `.withMetaTools({ todo: true })` logs the dropped-`recall` notice exactly once.
  - `.withMetaTools({ todo: true, recall: true })` logs nothing.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** If "wire" is chosen, get the ablation-warden verdict before changing the default.
- [ ] **Step 4: Run** `bun test packages/runtime/tests packages/reasoning --timeout 15000` and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** one commit per finding. Log the warden tasks.

---


---

## Doc verification (2026-10-28)

Checked against the providers' current official docs. Results:

| Item | Source | Fact | Result |
|---|---|---|---|
| OpenAI strict-mode schema keywords | https://platform.openai.com/docs/guides/structured-outputs ("Supported schemas") | Unsupported: `allOf`, `not`, `dependentRequired`, `dependentSchemas`, `if`/`then`/`else`. Root must be an object, not `anyOf`. `additionalProperties: false` required. Limits: 5000 object properties, 10 nesting levels. `$ref`/definitions ARE supported. | FIXED (depth/size limits added to `isStrictCompatible`). The extra bans (`oneOf`, `patternProperties`, `propertyNames`, `unevaluatedProperties`, `$ref`) are doc-silent or stricter than docs; kept as conservative, since falling back to non-strict is safe. |
| Gemini model listing auth | https://ai.google.dev/gemini-api/docs/api-key and https://ai.google.dev/api/models | `x-goog-api-key` header; `models[]`, `nextPageToken`, `pageSize` max 1000, `supportedGenerationMethods`, `inputTokenLimit`. | VERIFIED |
| xAI `GET /v1/models` | https://docs.x.ai/developers/rest-api-reference/inference/models | Returns `{ "object": "list", "data": [{ "id", "owned_by", ... }] }`; Bearer auth (https://docs.x.ai/developers/quickstart). Parsed by the OpenAI-style parser. | VERIFIED |
| Groq `/models` `active` | https://console.groq.com/docs/api-reference | Each entry has `active` (bool), `context_window`, `owned_by`. Code did not filter `active: false`. | FIXED (entries with `active: false` are skipped; test added) |

## Live checks (2026-10-28)

Scratch scripts run foreground against the workspace sources; keys loaded from `.env`, never printed or recorded.

### Task 1 Step 4: malformed array schema, `openai:gpt-4o`

Fixture: `apps/cortex/server/tests/fixtures/malformed-schema-mcp-server.ts` over stdio MCP (`run_funnel` carries `steps: anyOf[{type:"array"}, {type:"string"}]` with no `items`, the Umami shape). Prompt asked the model to call `run_funnel`; `maxIterations: 3`.

| Strategy | Result |
|---|---|
| adaptive (selected reactive) | PASS. No 400, run succeeded, tool listed and returned a result. |
| reactive | PASS. No 400, `matrix/run_funnel` called and returned, run succeeded. |

The pre-fix 400 was not reproduced in this session (no pre-fix revert was run), so this confirms the fix holds live, not that the original failure was re-observed.

### Task 3 Step 4: live model discovery (`resolveProviderModels`)

| Provider | live | total | live-sourced | Notes |
|---|---|---|---|---|
| anthropic | true | 15 | 14 | |
| openai | true | 93 | 93 | |
| gemini | true | 35 | 35 | key present via GOOGLE_API_KEY |
| groq | true | 6 | 6 | |
| xai | true | 9 | 8 | |
| ollama | true | 30 | 30 | local |
| litellm | false | 1 | 0 | `unreachable` (no LITELLM_BASE_URL / no server); fell back to presets cleanly, did not throw |

Not measured: the no-key fallback path for a hosted provider (every hosted provider had a key). It is covered only by unit tests.
