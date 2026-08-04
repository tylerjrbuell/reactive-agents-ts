# v0.11 Polish + Phase D Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Stackblitz playground env-var injection, update v0.11 docs (quickstart + what's new), and write the Phase D (CodeAgentStrategy) implementation plan.

**Architecture:** Three independent tracks dispatched as parallel subagents. Track A fixes `.env` loading in embedded Stackblitz iframes. Track B adds `@reactive-agents/observe` to quickstart and expands the What's New page for v0.11. Track C writes the Phase D design plan. No cross-track dependencies — all can start immediately.

**Tech Stack:** Astro/Starlight MDX, TypeScript, tsx/Node 20+ `--env-file`, wiki Markdown

---

## Track A — Stackblitz Playground Env-Var Fix

**Problem:** Stackblitz `?embed=1` hides the Secrets/Settings panel. Users can't configure API keys. Each project uses `npx tsx src/agent.ts` which doesn't load `.env` automatically.

**Fix:** Add `.env` placeholder file to each of the 3 projects + update `start` script to `npx tsx --env-file=.env src/agent.ts` (tsx 4.x passes Node 20 `--env-file` through). Update `playground.mdx` quick setup to direct users to edit `.env` in the editor.

**Files:**
- Create: `apps/stackblitz/01-hello-agent/.env`
- Modify: `apps/stackblitz/01-hello-agent/package.json`
- Create: `apps/stackblitz/02-tool-integration/.env`
- Modify: `apps/stackblitz/02-tool-integration/package.json`
- Create: `apps/stackblitz/03-strategy-demo/.env`
- Modify: `apps/stackblitz/03-strategy-demo/package.json`
- Modify: `apps/docs/src/content/docs/guides/playground.mdx`

### Task A1: Add `.env` files to all 3 Stackblitz projects

- [ ] **Step 1: Create `apps/stackblitz/01-hello-agent/.env`**

```bash
# Reactive Agents — Hello Agent playground
# Edit this file directly in the Stackblitz editor, then restart the terminal.
#
# Get a FREE Gemini key (recommended): https://ai.google.dev
# Anthropic: https://console.anthropic.com
# OpenAI:    https://platform.openai.com

GOOGLE_API_KEY=your_gemini_key_here
# ANTHROPIC_API_KEY=your_anthropic_key_here
# OPENAI_API_KEY=your_openai_key_here

# Optional: ask a custom question
# QUESTION=What is the capital of France?

# Local Ollama (Chrome only, requires: OLLAMA_ORIGINS=* ollama serve)
# PROVIDER=ollama
# OLLAMA_ENDPOINT=http://localhost:11434
# MODEL=llama3.2
```

- [ ] **Step 2: Create `apps/stackblitz/02-tool-integration/.env`**

```bash
# Reactive Agents — Tool Integration playground
# Edit this file directly in the Stackblitz editor, then restart the terminal.
#
# Get a FREE Gemini key (recommended): https://ai.google.dev
# Anthropic: https://console.anthropic.com
# OpenAI:    https://platform.openai.com

GOOGLE_API_KEY=your_gemini_key_here
# ANTHROPIC_API_KEY=your_anthropic_key_here
# OPENAI_API_KEY=your_openai_key_here

# Optional: give the agent a custom task
# TASK=Calculate the factorial of 12 using code-execute, then write the result to the scratchpad.

# Local Ollama (Chrome only, requires: OLLAMA_ORIGINS=* ollama serve)
# PROVIDER=ollama
# OLLAMA_ENDPOINT=http://localhost:11434
# MODEL=llama3.2
```

- [ ] **Step 3: Create `apps/stackblitz/03-strategy-demo/.env`**

```bash
# Reactive Agents — Strategy Demo playground
# Edit this file directly in the Stackblitz editor, then restart the terminal.
#
# Get a FREE Gemini key (recommended): https://ai.google.dev
# Anthropic: https://console.anthropic.com
# OpenAI:    https://platform.openai.com

GOOGLE_API_KEY=your_gemini_key_here
# ANTHROPIC_API_KEY=your_anthropic_key_here
# OPENAI_API_KEY=your_openai_key_here

# Optional: compare a different strategy (vs the default "reactive")
# STRATEGY_B=plan-execute-reflect
# Available: reactive | plan-execute-reflect | tree-of-thought | reflexion | adaptive

# Optional: custom task
# TASK=Why is immutability important in functional programming?

# Local Ollama (Chrome only, requires: OLLAMA_ORIGINS=* ollama serve)
# PROVIDER=ollama
# OLLAMA_ENDPOINT=http://localhost:11434
# MODEL=llama3.2
```

- [ ] **Step 4: Verify `.env` files exist in all 3 project dirs**

```bash
ls apps/stackblitz/*/  .env
```

Expected: 3 `.env` files listed.

### Task A2: Update `start` scripts to use `--env-file`

- [ ] **Step 5: Update `apps/stackblitz/01-hello-agent/package.json`**

Change `"start"` from `"npx tsx src/agent.ts"` to:

```json
{
  "name": "reactive-agents-01-hello-agent",
  "version": "1.0.0",
  "type": "module",
  "packageManager": "npm@10.9.0",
  "engines": { "node": ">=20" },
  "description": "Reactive Agents hello-agent demo — runs in Stackblitz, no install needed",
  "scripts": {
    "start": "npx tsx --env-file=.env src/agent.ts"
  },
  "dependencies": {
    "reactive-agents": "latest"
  },
  "devDependencies": {
    "tsx": "^4",
    "typescript": "^5"
  }
}
```

- [ ] **Step 6: Update `apps/stackblitz/02-tool-integration/package.json`** (same pattern)

```json
"scripts": {
  "start": "npx tsx --env-file=.env src/agent.ts"
}
```

- [ ] **Step 7: Update `apps/stackblitz/03-strategy-demo/package.json`** (same pattern)

```json
"scripts": {
  "start": "npx tsx --env-file=.env src/agent.ts"
}
```

### Task A3: Update playground.mdx quick setup section

- [ ] **Step 8: Replace the "Quick setup" section in `apps/docs/src/content/docs/guides/playground.mdx`**

Replace lines 13–27 (the table and Aside):

```mdx
## Quick setup

<Aside type="tip" title="Edit .env in the editor">
Each playground project has a `.env` file pre-loaded in the editor. Replace `your_gemini_key_here` with your actual key, then click the terminal **restart** button (↺) to re-run.
</Aside>

Get a free Gemini API key at [ai.google.dev](https://ai.google.dev) — no credit card required.

| Provider | Free tier? | `.env` variable |
|----------|-----------|----------------|
| **Google Gemini** ← recommended | ✅ Yes — generous free tier | `GOOGLE_API_KEY` |
| Anthropic Claude | ❌ Pay-as-you-go | `ANTHROPIC_API_KEY` |
| OpenAI | ❌ Pay-as-you-go | `OPENAI_API_KEY` |
| Local Ollama | ✅ Free | `PROVIDER=ollama` + `OLLAMA_ENDPOINT` |

<Aside type="note">
**Why not Secrets?** The embedded iframe hides the Stackblitz Secrets panel. Editing `.env` directly in the editor is the reliable alternative — it works the same way and keeps keys out of URLs.
</Aside>
```

- [ ] **Step 9: Commit**

```bash
git add apps/stackblitz/ apps/docs/src/content/docs/guides/playground.mdx
git commit -m "fix(playground): add .env files + --env-file flag for embedded iframe key config"
```

---

## Track B — v0.11 Docs Updates

**Files:**
- Modify: `apps/docs/src/content/docs/guides/quickstart.mdx`
- Modify: `apps/docs/src/content/docs/guides/whats-new.mdx`

### Task B1: Add `@reactive-agents/observe` to quickstart

The quickstart "What's Next?" card grid at the bottom is the right place. Also add a brief mention after Step 5 (Add Capabilities) for OTel tracing.

- [ ] **Step 1: Add OTel tracing mention after the `.withGuardrails()` code block in Step 5**

After the `## What's Next?` heading's `<CardGrid>` block in `apps/docs/src/content/docs/guides/quickstart.mdx`, add a `LinkCard` for observe. Find the existing `<CardGrid>` block and add:

```mdx
  <LinkCard
    title="OpenTelemetry Tracing"
    description="Export spans from every agent run to Jaeger, Grafana Tempo, Langfuse, or any OTLP backend."
    href="/features/observe/"
  />
```

- [ ] **Step 2: Verify the docs build passes**

```bash
cd apps/docs && bun run build 2>&1 | tail -20
```

Expected: build succeeds, page count ≥ 78.

- [ ] **Step 3: Commit**

```bash
git add apps/docs/src/content/docs/guides/quickstart.mdx
git commit -m "docs(quickstart): add observe card to What's Next"
```

### Task B2: Expand What's New for v0.11

The current v0.11 section in `whats-new.mdx` only covers mandatory decision rationale. Need to add the other shipped v0.11 features: `@reactive-agents/observe`, `@reactive-agents/replay`, compose API, RunHandle + killswitches, `create-reactive-agent` CLI.

- [ ] **Step 4: Replace the existing `## v0.11.x` section** in `apps/docs/src/content/docs/guides/whats-new.mdx`

Replace the `## v0.11.x — Mandatory decision rationale (May 2026)` block (everything from that heading until the `---` divider before v0.10) with:

```mdx
## v0.11.x — Production tooling + full observability (May 2026)

The focus: developer tooling that makes agents production-observable and repeatable, plus the first `create-reactive-agent` scaffolder.

### New packages

- **`@reactive-agents/observe`** — Zero-config OpenTelemetry tracing. Set `OTEL_EXPORTER_OTLP_ENDPOINT` and every run emits a workflow → LLM → tool span hierarchy, OpenInference-compliant, to any OTLP backend (Jaeger, Grafana Tempo, Langfuse, Arize Phoenix). See [OpenTelemetry Tracing](/features/observe/).
- **`@reactive-agents/replay`** — Deterministic trace replay. Record any run to a snapshot file and re-run it with a different model or prompt without calling the LLM again. Enables regression testing and prompt A/B comparisons. See [Snapshot & Replay](/features/snapshot-replay/).

### New tooling

- **`create-reactive-agent` CLI** — `bunx create-reactive-agent my-app` scaffolds a runnable agent project in seconds. Supports `--template minimal|standard|tool-use|multi-agent|gateway`, `--provider`, `--model`, `--pm bun|npm|yarn|pnpm`. See [create-reactive-agent](/features/create-reactive-agent/).

### New runtime controls

- **`RunHandle`** — `.run()` now returns a handle with `.cancel()` to stop a running agent mid-flight and `.result` (a Promise that resolves on completion or cancellation). See [Compose API](/reference/compose-api/).
- **Killswitches** — `.withKillswitch(signal)` wires an `AbortSignal` into the agent loop. When the signal fires, the loop exits cleanly after the current step. Compose with `AbortController` for timeout-based cancellation. See [Compose API](/reference/compose-api/).
- **Compose API** (`@stable`) — The full fluent compose surface (`pipe`, `chain`, `race`, `parallel`, `withKillswitch`, `withTimeout`) is now `@stable` as of v0.11. See [Compose API](/reference/compose-api/).

### Decision tracing

Every tool call now carries the model's stated *why*. Rationale capture went from an optional nudge to a coaxed contract across all three execution paths:

- **Kernel-injected system prompt** — Unconditionally appends a MANDATORY rationale instruction regardless of `toolSchemaDetail`. Model must precede each tool call with `<rationale call="N">{"why":"…","confidence":0-1}</rationale>`.
- **Native function-calling capture** — `parseRationaleBlocks()` reads side-channel blocks from `thought` + `thinking` content and attaches each rationale to the matching `ToolCallSpec` by 1-indexed position.
- **plan-execute-reflect enforcement** — `LLMPlanStepSchema` now carries a `rationale: { why, confidence? }` field; planner marks it MANDATORY for every `tool_call` step. Failures after retry emit `plan_rationale_missing` metric — no synthetic fallback invented.
- **`AgentDebrief.rationale[]`** — Unified milestone-decision log: tool selections, curator decisions, strategy switches, reactive interventions, and terminations. All render in `debrief.markdown` under `## Decision Rationale`.

See [Decision Tracing](/concepts/decision-tracing/) for the full pipeline and [Debrief & Chat](/features/debrief-chat/) for the result shape.
```

- [ ] **Step 5: Verify build**

```bash
cd apps/docs && bun run build 2>&1 | tail -20
```

Expected: build succeeds, all links valid.

- [ ] **Step 6: Commit**

```bash
git add apps/docs/src/content/docs/guides/whats-new.mdx
git commit -m "docs(whats-new): expand v0.11 section — observe, replay, RunHandle, killswitches, compose stable"
```

---

## Track C — Phase D (CodeAgentStrategy) Design Plan

**Goal:** Write a complete implementation plan for the 6th reasoning strategy: `CodeAgentStrategy`. The strategy composes tools as function calls inside LLM-generated code blocks, executing them in a sandboxed environment. This plan lives in the wiki and will be handed off for execution.

**Files:**
- Create: `wiki/Planning/Implementation-Plans/2026-05-14-phase-d-code-as-action.md`

**Context to read before writing:**
- `packages/reasoning/src/strategies/` — existing strategy files (reactive.ts, plan-execute.ts, etc.)
- `packages/reasoning/src/kernel/loop/react-kernel.ts` — strategy interface / `makeKernel` usage
- `packages/reasoning/src/strategies/index.ts` (or registry file) — strategy registration pattern
- `wiki/Hot.md` — current project state, Phase D validation gate requirements

**Key design decisions to resolve in the plan:**
1. **Sandbox approach** — Node `vm.runInNewContext` (fast, in-process) vs Worker thread (isolated heap) vs subprocess (max isolation). Recommend Worker thread for v0.11.1 (balance isolation + speed).
2. **Tool binding** — Generate a function signature for each registered tool; inject into sandbox scope. LLM writes code calling those functions; code evaluator intercepts calls, routes to real tool implementations.
3. **Validation gate** — ≥20% accuracy lift on qwen3:14b benchmark suite, ≥25% token reduction vs `plan-execute-reflect` on same 10-task test suite.
4. **Strategy ID** — `"code-action"` (matches existing naming convention: `"reactive"`, `"plan-execute-reflect"`, `"tree-of-thought"`, `"reflexion"`, `"adaptive"`).

### Task C1: Read strategy registration pattern

- [ ] **Step 1: Read `packages/reasoning/src/strategies/` to understand registration**

```bash
ls packages/reasoning/src/strategies/
cat packages/reasoning/src/strategies/index.ts  # or registry.ts if that exists
```

Note: look for how each strategy declares its ID, how it hooks into the kernel, and where it gets registered for the `withReasoning({ defaultStrategy })` builder option.

- [ ] **Step 2: Read `packages/reasoning/src/kernel/loop/react-kernel.ts` lines 1-80**

Focus on the `makeKernel` signature and how strategies are dispatched from the loop.

### Task C2: Write the Phase D plan document

- [ ] **Step 3: Create `wiki/Planning/Implementation-Plans/2026-05-14-phase-d-code-as-action.md`**

The document must include:

```markdown
# Phase D — CodeAgentStrategy ("code-action") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development ...

**Goal:** Implement a 6th reasoning strategy where the LLM generates executable code blocks
that compose tool calls as ordinary function calls, then executes those blocks in a Worker-thread
sandbox — yielding tighter token budgets and more structured multi-tool orchestration.

**Architecture:** [3 sentences covering sandbox choice, tool-binding injection, strategy registry integration]

**Tech Stack:** TypeScript, Node.js Worker threads, `@reactive-agents/core`, Effect-TS
```

Then include tasks covering:
1. Strategy skeleton (`packages/reasoning/src/strategies/code-action.ts`) with strategy ID, kernel phase wiring
2. Tool binding generator — given `ToolSpec[]`, emit function stubs that route calls to real tools via Worker `postMessage`
3. Worker sandbox harness — `packages/reasoning/src/strategies/code-action/sandbox-worker.ts`
4. Strategy kernel phases — `plan`, `execute-code`, `observe`, `reflect`
5. Builder integration — `.withReasoning({ defaultStrategy: "code-action" })`
6. Validation test suite — 10 tasks, baseline vs code-action token/accuracy comparison
7. Docs stub — `apps/docs/src/content/docs/features/code-action.mdx`

Each task must have real code, real commands, TDD steps (write test → fail → implement → pass → commit).

- [ ] **Step 4: Commit the plan**

```bash
git add wiki/Planning/Implementation-Plans/2026-05-14-phase-d-code-as-action.md
git commit -m "plan(phase-d): add CodeAgentStrategy design plan to wiki"
```

---

## Dispatch Order

All three tracks are independent. Dispatch as parallel subagents:

| Subagent | Track | Est. time | Blocking? |
|----------|-------|-----------|-----------|
| SA-1 | Track A — Stackblitz fix | ~15 min | Unblocks: playground works for Show-HN |
| SA-2 | Track B — Docs (quickstart + whats-new) | ~20 min | Unblocks: v0.11 release docs |
| SA-3 | Track C — Phase D plan | ~30 min | Unblocks: Phase D execution |

After all three complete: push 16+ pending commits to `origin/main`, then run `bun run check:versions` before any `changeset version` + publish.
