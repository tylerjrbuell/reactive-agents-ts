---
date: 2026-06-30
type: audit-report
scope: prompting + context-management + structured-output
method: 3 parallel read-only investigators (Explore) → targeted hotspot review
status: 3 fixed (branch fix/prompt-context-so-audit), 2 verified, rest open
---

# Audit: Prompting, Context Management & Structured Output

> **Resolution (2026-07-01)** — branch `fix/prompt-context-so-audit`:
> - **SO-1 FIXED** — `json-repair.ts` literal fixers made string-aware
>   (`replaceOutsideStrings`) + single-quote normalization moved ahead of literal
>   fixing. Tests: 3 added, GREEN.
> - **CM-1 FIXED** — `message-window.ts` recent window is now an index range +
>   ungrouped old user instructions preserved verbatim. Test added, GREEN.
> - **SO-2 FIXED** — `field-provenance.ts` boundary-aware string match
>   (`findWithBoundary`) + recursion into nested objects/arrays (dotted paths);
>   `grounded-extract.ts` abstention loop guards dotted keys. Tests: 3 added, GREEN.
> - **SO-5 VERIFIED (minor)** — `grounded-extract.ts:172-180` already falls back
>   to the full contract when `Schema.partial` is a no-op; for Zod (`Schema.declare`
>   bridge) Phase-A leniency is effectively off, but harmless. Left as documented.
> - **PR-3 VERIFIED (not a bug)** — `context-manager.ts:119-156` hybrid steering
>   *intentionally* reinforces guidance via a short one-line recent-turn reminder
>   (`buildShortGuidanceReminder`, ≤120 chars) alongside the full system-prompt
>   block. Deliberate dual-channel for weak-model attention; bounded cost. Dismissed.
> - Reasoning package: `tsc --noEmit` clean; 236 unit tests GREEN. (observability
>   DTS build failure is pre-existing/unrelated — otlp-exporter opentelemetry drift.)
> - **Still open:** SO-3, SO-4 (stream reparse perf), CM-2, CM-3 (token estimate),
>   CM-4, CM-5, PR-1 (sanitizeToolName collision), PR-2 (tool cap).

Read-only review of all prompt-assembly, context-management/compression, and
structured-output code. 3 parallel investigators mapped the subsystems; hotspot
files were then read directly for concrete defects. Findings ranked by severity.

**Severity:** 🔴 correctness/data-loss · 🟡 perf/quality · 🔵 optimization

Two findings tagged **[VERIFY]** — claims about runtime behavior not yet confirmed.

---

## Structured Output

### 🔴 SO-1 — `json-repair.ts:123-138` repair corrupts string DATA
`fixPythonLiterals` + `fixNonFinite` use global regex with **no in-string guard**:
```js
.replace(/\bTrue\b/g, "true")   // {"title":"True Story"}  → "true Story"
.replace(/\bNaN\b/g, "null")    // {"name":"NaN Industries"} → "null Industries"
```
Only fires on the repair path (parse already failed, line 57), but when it fires
it silently mutates legit field values. The other repair fns (`stripComments`,
`fixSingleQuotes`, `fixUnescapedNewlines`) ARE string-aware char-walkers — these
two regress to naive global replace.
**Fix:** make literal/non-finite replacement string-aware (value positions only).

### 🔴 SO-2 — `field-provenance.ts:76-110` grounding = substring presence
- `corpus.indexOf(String(val))` (min 2 chars) → values like `"US"`, `"OK"`, year
  `2026`, small ints trivially appear in any large corpus → `confidence=0.9`
  falsely. Tolerant numeric match (`findNumericInCorpus`, line 44) widens the
  false-positive surface. The 0.9/0.4 binary oversells substring coincidence as
  evidence — undermines the grounded-output value prop.
- **Nested-blind:** only top-level fields grounded. Nested object/array →
  `String(val)="[object Object]"` → never matches → every nested field pinned at
  0.4 regardless of truth.
**Fix:** recurse into nested values; require word/token-boundary match, not bare substring.

### 🟡 SO-3 — `stream-object.ts:34-44` O(N²) reparse per delta
Every `TextDelta` reparses the **entire** accumulated buffer:
`parsePartial(stripThinking(buffer))` + `JSON.stringify(partial)` for dedup.
M deltas × N-char output → O(N²); compounded by `partial-parse.ts` Tier-1 reverse
snapshot walk → pathological O(N³).
**Fix:** incremental walk state, or reparse only on structural chars (`,}]`) / every K chars.

### 🟡 SO-4 — `partial-parse.ts:192-200` unbounded Tier-1 walkback
`walkBuffer` records a snapshot at every `,{}[]` → O(N) snapshots. Reverse loop
builds candidate (slice+parse) per snapshot. Usually hits first try, but a deep
dangling partial forces deep walkback → O(N²).
**Fix:** bound walkback to last few snapshots; deeper = fall to Tier-3 repair.

### 🟡 SO-5 — Standard-Schema lenient parse likely a no-op **[VERIFY]**
`schema-contract.ts:144-151`: Zod/Valibot/ArkType bridge via opaque
`Schema.declare`. Grounded extract Phase A uses `Schema.partial(effectSchema)` for
lenient parsing — `partial` of a *declared* schema can't loosen required fields
(no AST structure). So lenient/abstention phase may only truly work for native
Effect schemas; Standard-Schema users get all-or-nothing.
**Action:** verify, then document or build a real partial path.

### 🔵 SO-6 — `schema-contract.ts:118-122` async validators hard-fail
Valibot/ArkType async refinements → `"async validation unsupported"` → always
invalid. Documented gap; support an async validate path if users hit it.

---

## Context Management

### 🔴 CM-1 — `message-window.ts:62-95` non-turn messages silently dropped
Window keeps `firstUser` + turn-grouped (assistant-with-toolCalls + tool_results)
only. A mid-thread **plain user clarification** or **assistant text msg with no
toolCalls** belongs to no turn group → dropped entirely when over budget. Can
lose user instructions.
**Fix:** preserve ungrouped user/assistant messages or fold into the summary.

### 🟡 CM-2 — `message-window.ts:49-95` keeps N recent turns by COUNT, not size
Estimator sums all content, but compaction keeps "recent N turns full" regardless
of each turn's bytes. One 50k-char tool_result in the kept window → still over
budget after "compression". Per-result truncation lives in a separate stage
(`assembly/stages/project-results.ts`).
**Action:** confirm the two stages compose; else window emits over-budget threads.

### 🟡 CM-3 — `message-window.ts:53` `length/4` token estimate, no real tokenizer
Global 4-chars/token underestimates code/JSON (~3) and CJK (~1-2) → window fires
too late → provider-side overflow. Same magic `4` duplicated in
`tool-formatting.ts` (CHARS_PER_TOKEN) and `context-utils.ts:239`.
**Fix:** per-provider tokenizer, or tighten tier margin (0.75 → ~0.65).

### 🔵 CM-4 — `message-window.ts:81` summary = raw `slice(0,60)`
Mid-word cut, no structure. Relies entirely on the `extractedFact` safety net; if
deterministic extraction is empty, summary is noise.

### 🔵 CM-5 — `tool-execution.ts:835` `extractObservationFacts` (falsified 44% lever) still wired
Memory flags it falsified; deterministic `extractFactDeterministic` is the kept
path. Confirm the LLM variant is gated off, else dead LLM call per observation.

---

## Prompting

### 🔴 PR-1 — `context-utils.ts:36-38` `sanitizeToolName` collision
`replace(/[^a-zA-Z0-9_-]/g, "_")`: `github.list.commits` and `github/list/commits`
both → `github_list_commits`. Inbound de-sanitization maps display→canonical; two
canonicals collapsing to one display = ambiguous → wrong tool dispatched.
**Fix:** collision-detect at registration (warn/suffix), or reversible encoding.

### 🟡 PR-2 — `think.ts:131-191` `computePromptSchemas` no upper bound on visible tools
Lazy union = required+relevant+used+discovered+allowed+META. An MCP server with
100 "discovered" tools → all visible → prompt bloat, no tier cap.
**Fix:** tier-scaled cap with relevance ranking (frontier high, local tight).

### 🔵 PR-3 — `context-manager.ts:114-128` hybrid steering may double-inject guidance **[VERIFY]**
`user-message` mode strips guidance from system prompt; `hybrid` keeps it in
system prompt AND may add a user-turn copy. Confirm no duplicate guidance tokens.

---

## Solid (no change)
- Canonical single assembly path (`assembly/project.ts` 5-stage); no legacy parallel assembler (RA_ASSEMBLY removed 2026-06-02).
- Date-precision env block for KV-cache stability.
- `partial-parse` DROP semantics (no truncated values surfaced).
- Single cast-concentration boundary `asVendorSchema` (schema-contract.ts:99).
- Native structured output per-provider (OpenAI `json_schema` strict, Gemini `responseSchema`, Anthropic `{` prefill) correctly capability-gated.

---

## Recommended fix order
1. **SO-1** json-repair string corruption (silent data loss)
2. **CM-1** message-window dropping ungrouped messages (lost instructions)
3. **SO-2** field-provenance false grounding (unreliable confidence signal)

Then resolve the two **[VERIFY]** items (SO-5, PR-3) before touching them.

## Subsystem maps (reference)
Full file:line maps produced by the 3 investigators captured in session; key seams:
- **Prompting:** `assembly/project.ts` · `assembly/stages/*` · `context/prompt-composer.ts` · `context/prompt-sections-default.ts` · `context-engine.ts` · `kernel/capabilities/reason/think.ts`
- **Context:** `kernel/capabilities/attend/context-utils.ts` · `context/message-window.ts` · `kernel/capabilities/attend/tool-formatting.ts` · `context/verbosity-detector.ts`
- **Structured output:** `structured-output/{schema-contract,pipeline,partial-parse,json-repair}.ts` · `structured-output/grounded/{grounded-extract,field-provenance}.ts` · `runtime/src/engine/stream-object.ts` · `llm-provider/src/providers/{anthropic,openai,gemini}.ts`
