# Bundle: providers-retry-error-accumulation
Date: 2026-05-25
Budget: 90 min
Issues: #75

## Context

HS-16 (audit-2026-05-21). 5 LLM provider adapters share identical structured-output retry-loop scaffold:

```ts
let lastError: unknown = null;
const maxRetries = request.maxParseRetries ?? 2;
for (let attempt = 0; attempt <= maxRetries; attempt++) {
  // ...
  lastError = decoded.left;  // overwrite each turn
  // ...
  } catch (e) { lastError = e; }  // overwrite each turn
}
return yield* Effect.fail(new LLMParseError({
  message: ...,
  rawOutput: String(lastError),   // only final attempt survives
  expectedSchema: schemaStr,
}));
```

Only the final attempt's error reaches `LLMParseError.rawOutput`. Intermediate parse errors (often the most informative — early attempts can fail differently than late ones with retry context appended) are lost.

## Drift report (2026-05-25)

- `anthropic.ts`: claim 346 → actual 404 (drift +58, pattern intact)
- `openai.ts`: claim 486 → actual 563 (drift +77, pattern intact)
- `gemini.ts`: claim 575 → actual 659 (drift +84, pattern intact)
- `local.ts`: claim 691 → actual 881 (drift +190, pattern intact)
- `litellm.ts`: claim 479-481 → actual 655 (drift +174, pattern intact)

🟡 line drift across all 5; semantic `lastError = e` overwrite confirmed at every site.

## Acceptance criteria (per issue)

- **#75**: After fix, `grep -n "lastError = e" packages/llm-provider/src/providers/*.ts` returns the same 5 sites but each is **paired with** a `parseAttempts.push({attempt, error: ...})` line. `LLMParseError` exposes `attempts?: ReadonlyArray<ParseAttemptError>` carrying every attempt's error. `rawOutput` preserved for back-compat. A RED test demonstrates `attempts.length === maxRetries + 1` when all attempts fail.

## Baseline (2026-05-25, branch bundle/providers-retry-error-accumulation)

- `bun test packages/llm-provider/` → 260 pass / 0 fail / 33 files / 587 expect calls
- `bunx turbo run typecheck --filter=@reactive-agents/llm-provider` → green

## Execution units (ordered)

1. **Unit 1 — errors.ts**: extend `LLMParseError` with optional `attempts?: ReadonlyArray<ParseAttemptError>`. Define `ParseAttemptError` interface. Export both. RED: schema-level test on the error class — construct with `attempts`, assert round-trip. (~10 min)
2. **Unit 2 — 5 providers**: declare `const parseAttempts: ParseAttemptError[] = []` adjacent to `lastError`; push at each overwrite site (both `decoded.left` and `catch (e)` branches); pass `attempts: parseAttempts` to `LLMParseError`. Same shape across all 5 — mechanical. RED: per-provider unit test forcing 3 failed attempts; assert `attempts.length === 3` with distinct attempt indices. (~50 min)
3. **Unit 3 — barrel export**: re-export `ParseAttemptError` type from `index.ts`. (~2 min)

## Risk register

- **Risk:** Test runs against real LLM providers fail without API keys / network. → **Mitigation:** Use direct unit tests against the parse retry loop via `TestLLMService` or by extracting the parse loop to a testable helper. If the loop isn't easily extractable, write per-provider tests using existing mocked-fetch patterns in `packages/llm-provider/tests/`.
- **Risk:** Effect Schema TaggedError doesn't allow optional fields directly. → **Mitigation:** Use Schema.optional via `attempts?: ReadonlyArray<...>` syntax in `TaggedError` payload; verified supported by existing patterns.
- **Risk:** `parseAttempts` push on `decoded.left` doubles with `catch (e)` in same loop iteration on certain paths. → **Mitigation:** Read each site to confirm `decoded.left` and `catch (e)` are mutually exclusive branches.

## Verification protocol

- `rtk bun test packages/llm-provider/` — full pass, no net-new failures
- `rtk bun run build` — green
- `rtk bunx turbo run typecheck --filter=@reactive-agents/llm-provider` — green
- Re-grep: `rtk grep -A2 "lastError = e" packages/llm-provider/src/providers/*.ts` — every site has adjacent `parseAttempts.push(...)`
- Re-grep: `rtk grep -c "attempts:" packages/llm-provider/src/providers/*.ts` — ≥5

## Out-of-scope (explicit)

- **Other providers' retry loops** (e.g., circuit-breaker, transport-level retry) — only the **structured-output parse retry** loop is in scope. HTTP-level retry uses different patterns.
- **`rawOutput` deprecation** — keep both, mark `attempts` as the preferred surface. Caller migration is a follow-up.
- **Issue #93** (`focusedTools` runtime-construction typecheck) — claim drifted to test files. Will comment requesting reframe.
- **Issue #84** (4 `@internal` OpenAI exports) — barrel does NOT re-export them; only `OpenAIProviderLive` is in `index.ts:120`. Will comment requesting close.
