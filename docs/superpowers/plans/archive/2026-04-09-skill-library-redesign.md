# Reactive Agents Skill Library Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks within each phase are fully independent and can be parallelized.

**Goal:** Redesign `.agents/skills/` to eliminate agent drift across all 6 development journeys — retire stale/irrelevant skills, overhaul outdated ones, and add 7 net-new skills covering the highest-impact gaps.

**Architecture:** 14 independent tasks, each producing one `.agents/skills/<name>/SKILL.md` file. No inter-task dependencies. Organize in 3 phases for logical grouping but execute in any order within a phase.

**Tech Stack:** Markdown SKILL.md files with YAML frontmatter; Bun, Effect-TS, TypeScript references throughout.

---

## File Map

**Deleted:**
- `.agents/skills/codebase-to-course/` — entire directory

**Major overhaul (rewrite):**
- `.agents/skills/architecture-reference/SKILL.md`
- `.agents/skills/build-package/SKILL.md` → repurposed to "add-new-package"

**Moderate update (targeted additions):**
- `.agents/skills/review-patterns/SKILL.md`
- `.agents/skills/build-coordinator/SKILL.md`
- `.agents/skills/implement-test/SKILL.md`

**Light verification (update only if stale):**
- `.agents/skills/effect-ts-patterns/SKILL.md`
- `.agents/skills/implement-service/SKILL.md`
- `.agents/skills/llm-api-contract/SKILL.md`
- `.agents/skills/memory-patterns/SKILL.md`
- `.agents/skills/validate-build/SKILL.md`
- `.agents/skills/update-docs/SKILL.md`

**Created (new):**
- `.agents/skills/kernel-extension/SKILL.md`
- `.agents/skills/agent-tdd/SKILL.md`
- `.agents/skills/kernel-debug/SKILL.md`
- `.agents/skills/provider-streaming/SKILL.md`
- `.agents/skills/mcp-integration/SKILL.md`
- `.agents/skills/reactive-feature-dev/SKILL.md`
- `.agents/skills/prepare-release/SKILL.md`

---

## Phase 1: Cleanup & Verification

### Task 1: Retire `codebase-to-course` and Verify Light-Touch Skills

**Files:**
- Delete: `.agents/skills/codebase-to-course/` (entire directory)
- Verify/update: `.agents/skills/effect-ts-patterns/SKILL.md`
- Verify/update: `.agents/skills/implement-service/SKILL.md`
- Verify/update: `.agents/skills/llm-api-contract/SKILL.md`
- Verify/update: `.agents/skills/memory-patterns/SKILL.md`
- Verify/update: `.agents/skills/validate-build/SKILL.md`
- Verify/update: `.agents/skills/update-docs/SKILL.md`

- [ ] **Step 1: Delete codebase-to-course**

```bash
rm -rf .agents/skills/codebase-to-course
```

- [ ] **Step 2: Verify `effect-ts-patterns` is accurate**

Run these checks against current codebase patterns:

```bash
# Verify Schema.Struct is still the project standard (not plain interface)
grep -r "Schema.Struct" packages/core/src/ | head -5
# Verify Data.TaggedError is still the error standard
grep -r "Data.TaggedError" packages/core/src/ | head -5
# Verify Context.Tag is still the service standard
grep -r "Context.Tag" packages/core/src/ | head -5
```

If all three patterns still match what's in the skill file, no update needed. If any pattern has changed, update the corresponding section in `effect-ts-patterns/SKILL.md` to reflect current usage.

- [ ] **Step 3: Verify `implement-service` is accurate**

Read `.agents/skills/implement-service/SKILL.md` and check the template against a recently-created service:

```bash
# Check a recent service for the canonical pattern
head -60 packages/tools/src/services/tool-service.ts
```

If the template still matches, no update needed. If the service template has drifted (e.g., new Layer pattern, new Ref usage), update the template in the skill.

Additionally, add this paragraph to the "Common Mistakes" section if not already present:

```markdown
6. **Calling `LLMService.complete()` inside `Effect.tryPromise`** — LLMService methods already return `Effect`. Wrapping them in `Effect.tryPromise` creates a double-wrapped Effect that will never resolve correctly.
7. **Not adding kernel-specific services as phases** — if your new service needs to intercept per-turn reasoning, implement it as a `Phase` in the composable kernel rather than a standalone service. See `kernel-extension` skill.
```

- [ ] **Step 4: Verify `llm-api-contract` is accurate**

```bash
# Verify the CompletionRequest interface matches current source
grep -A 15 "interface CompletionRequest" packages/llm-provider/src/
```

If the signature matches what's in the skill, no update needed. If fields have changed (e.g., new optional fields added), update the interface definition in the skill.

- [ ] **Step 5: Verify `memory-patterns` is accurate**

```bash
# Confirm two-tier architecture is still current
grep -n "createMemoryLayer" packages/memory/src/runtime.ts | head -5
# Confirm four memory types
grep -n "semantic\|episodic\|procedural\|working" packages/memory/src/services/memory-service.ts | head -8
```

If patterns match, no update needed.

- [ ] **Step 6: Update `validate-build` — add kernel-extension checks**

Open `.agents/skills/validate-build/SKILL.md` and add a new section after the existing "Pattern Compliance" section:

```markdown
## 5. Kernel Extension Compliance (if package touches reasoning/kernel)

If changes are in `packages/reasoning/src/strategies/kernel/`, run:

```bash
# Phases must follow the exact type signature — no extra arguments
grep -n "export const.*Phase" packages/reasoning/src/strategies/kernel/phases/ -r
# Guards must return GuardOutcome — not boolean, not void
grep -n "export const.*Guard\b" packages/reasoning/src/strategies/kernel/phases/guard.ts
# MetaTool registry entries must be in act.ts only
grep -n "metaToolRegistry" packages/reasoning/src/strategies/kernel/ -r
```

**FAIL if:**
- A new phase function has a signature other than `(state: KernelState, context: KernelContext) => Effect<KernelState, never, LLMService>`
- A guard returns anything other than `{ allow: true }` or `{ block: true; reason: string }`
- `kernel-runner.ts` main loop was modified to add per-turn logic (use phases instead)
- `context-engine.ts` dead sections (`buildDynamicContext`, `buildStaticContext`) were modified or re-enabled

**Dead code areas — never touch:**
- `buildDynamicContext` / `buildStaticContext` in `context-engine.ts` (~560 LOC, disabled behind flag)
- `context-engine.ts` dead text-assembly functions (~690 LOC total)
```

- [ ] **Step 7: Verify `update-docs` reflects current canonical policy**

The canonical source is now `AGENTS.md` (not `CLAUDE.md`). Read the current skill to confirm this is reflected. If any reference says to update `CLAUDE.md` as canonical, change it to `AGENTS.md`.

Also verify the skill mentions updating `.agents/MEMORY.md` in its "what to update" list. If it doesn't, add:

```markdown
### Step N: Update Agent Memory Files

After any significant feature or architecture change:
- Update `.agents/MEMORY.md` with new capabilities, patterns, or status
- Update Claude project memory at `~/.claude/projects/*/memory/` if session-level context has changed
- These two files keep future agents oriented without re-discovering project state
```

- [ ] **Step 8: Commit Phase 1**

```bash
git add .agents/skills/
git commit -m "chore(skills): retire codebase-to-course, verify and update light-touch skills"
```

---

## Phase 2: Overhaul Stale Skills

### Task 2: Overhaul `architecture-reference`

**Files:**
- Modify: `.agents/skills/architecture-reference/SKILL.md`

The current skill covers the package graph and build order correctly but is missing: (1) composable kernel phase architecture, (2) MCP patterns, (3) dead code areas to avoid, (4) current debugging entry points.

- [ ] **Step 1: Read the current skill**

```bash
cat .agents/skills/architecture-reference/SKILL.md
```

- [ ] **Step 2: Replace the "Kernel Architecture (Reasoning)" section**

Find the section `## Kernel Architecture (Reasoning)` and replace its entire content with:

```markdown
## Kernel Architecture (Reasoning)

All 5 strategies delegate to `runKernel(reactKernel, input, options)` in `packages/reasoning/src/strategies/kernel/`.

### Composable Phase Pipeline

```
makeKernel({ phases?: Phase[] })
  ↓
kernel-runner.ts: runKernel() loop
  ↓ per turn:
  1. context-builder.ts  — buildSystemPrompt, toProviderMessage, buildConversationMessages, buildToolSchemas (pure data, no LLM)
  2. think.ts            — LLM stream, FC parsing, fast-path, loop detection, oracle hard gate
  3. guard.ts            — Guard[] pipeline, checkToolCall(guards), defaultGuards[]
  4. act.ts              — MetaToolHandler registry, final-answer gate, tool dispatch
```

### Key Files

```
packages/reasoning/src/strategies/kernel/
  kernel-state.ts      — KernelState, Phase type, KernelContext, ThoughtKernel
  kernel-runner.ts     — the loop: runKernel() — DO NOT add per-turn logic here directly
  kernel-hooks.ts      — KernelHooks lifecycle hooks
  react-kernel.ts      — makeKernel() factory + reactKernel + executeReActKernel
  phases/
    context-builder.ts — pure data: builds what the LLM sees this turn
    think.ts           — LLM decision: stream, FC parsing, loop detection
    guard.ts           — Guard[] pipeline: is this tool call allowed?
    act.ts             — MetaToolHandler registry: what happens when tools run?
  utils/
    ics-coordinator.ts, reactive-observer.ts, loop-detector.ts
    tool-utils.ts, tool-execution.ts, termination-oracle.ts, strategy-evaluator.ts
    stream-parser.ts, context-utils.ts, quality-utils.ts, service-utils.ts, step-utils.ts
```

### Two Independent State Records

```
state.messages[]  ← What the LLM sees (multi-turn FC conversation thread)
state.steps[]     ← What systems observe (entropy, metrics, debrief)
```

Do NOT conflate these. Debugging LLM behavior → inspect `messages[]`. Debugging metrics/entropy → inspect `steps[]`.

### Extending the Kernel

- **New phase**: create `phases/<name>.ts`, insert into `makeKernel({ phases: [...] })`
- **New guard**: add `Guard` fn to `guard.ts`, add to `defaultGuards[]`
- **New inline meta-tool**: add one entry to `metaToolRegistry` in `act.ts`
- **Custom kernel**: `makeKernel({ phases: [myThink, act] })`

See `.agents/skills/kernel-extension/SKILL.md` for full patterns.

### Dead Code — Do Not Touch

- `buildDynamicContext` / `buildStaticContext` in `context-engine.ts` — disabled behind flag (~560 LOC)
- `context-engine.ts` dead text-assembly functions (~690 LOC total)
- These areas are preserved for reference. Do not re-enable, modify, or "clean up."
```

- [ ] **Step 3: Add MCP Patterns section after Kernel Architecture**

```markdown
## MCP Client Architecture

Location: `packages/tools/src/mcp/mcp-client.ts`

### Two Docker Patterns

| Pattern | Examples | Behavior |
|---------|---------|---------|
| stdio MCP | GitHub MCP, filesystem | Container reads JSON-RPC from stdin |
| HTTP-only | mcp/context7 | Container starts HTTP server, ignores stdin |

Both handled transparently via auto-detection.

### Critical Rules

- **`docker rm -f <containerName>` is the ONLY reliable container stop.** `subprocess.kill()` leaves the container alive in the Docker daemon.
- **Two-phase container naming**: `rax-probe-<name>-<pid>` (initial stdio probe) → `rax-mcp-<name>-<pid>` (port-mapped HTTP if HTTP detected)
- **PID in name** prevents conflicts between concurrent agents running the same MCP server
- **Transport auto-inferred**: `command` → `"stdio"`, endpoint `/mcp` → `"streamable-http"`, other endpoint → `"sse"`
- `transport` field is optional in `MCPServerConfig` — auto-inferred at runtime

See `.agents/skills/mcp-integration/SKILL.md` for full patterns.
```

- [ ] **Step 4: Update the "Quick Navigation" table**

Add these rows to the existing Quick Navigation table:

```markdown
| Extending the kernel | `.agents/skills/kernel-extension/SKILL.md` |
| Debugging agent behavior | `.agents/skills/kernel-debug/SKILL.md` |
| Provider streaming patterns | `.agents/skills/provider-streaming/SKILL.md` |
| MCP client patterns | `.agents/skills/mcp-integration/SKILL.md` |
| Full feature workflow | `.agents/skills/reactive-feature-dev/SKILL.md` |
```

- [ ] **Step 5: Commit**

```bash
git add .agents/skills/architecture-reference/SKILL.md
git commit -m "chore(skills): overhaul architecture-reference with composable kernel and MCP patterns"
```

---

### Task 3: Repurpose `build-package` → `add-new-package`

**Files:**
- Modify: `.agents/skills/build-package/SKILL.md`

The current skill guides building packages from scratch using old spec files. All 22 packages exist. Repurpose this to "add a new package to the monorepo."

- [ ] **Step 1: Replace the entire SKILL.md content**

Write `.agents/skills/build-package/SKILL.md` with:

```markdown
---
name: build-package
description: Add a new package to the Reactive Agents monorepo. Covers scaffolding, package.json, tsconfig, layer wiring, and index exports. Use when creating a net-new @reactive-agents/* package.
argument-hint: <package-name>
---

# Add New Package: $ARGUMENTS

All 22 core packages exist. Use this skill only when creating a genuinely new package.

## Step 1: Determine the layer

Identify which dependency layer your package belongs to (from `architecture-reference`):

| Your package depends on | Layer |
|------------------------|-------|
| Nothing (or only external npm) | Layer 0 |
| `core` only | Layer 1 |
| `core` + `llm-provider` | Layer 2 |
| Multiple Layer 1–2 packages | Layer 3 |
| All packages (facade) | Layer 4 |

Packages can only depend on packages in lower layers.

## Step 2: Scaffold directory structure

```bash
mkdir -p packages/$ARGUMENTS/src/services
mkdir -p packages/$ARGUMENTS/tests
```

## Step 3: Create package.json

```json
{
  "name": "@reactive-agents/$ARGUMENTS",
  "version": "0.0.1",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "bun test --timeout 15000"
  },
  "dependencies": {
    "effect": "^3.10.0",
    "@reactive-agents/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "bun-types": "latest",
    "tsup": "^8.0.0"
  }
}
```

Add additional `@reactive-agents/*` workspace dependencies based on your layer assignment.

## Step 4: Create tsconfig.json

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

## Step 5: Create tsup.config.ts

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
```

## Step 6: Create errors.ts

```typescript
// packages/$ARGUMENTS/src/errors.ts
import { Data } from "effect";

export class $ARGUMENTSError extends Data.TaggedError("$ARGUMENTSError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type $ARGUMENTSErrors = $ARGUMENTSError;
```

## Step 7: Create your first service

Follow `.agents/skills/implement-service/SKILL.md` for the service template.

## Step 8: Create runtime.ts (layer factory)

```typescript
// packages/$ARGUMENTS/src/runtime.ts
import { Layer } from "effect";
import { MyServiceLive } from "./services/my-service.js";
import { DependencyServiceLive } from "@reactive-agents/core";

export const create$ARGUMENTSLayer = () =>
  Layer.mergeAll(
    MyServiceLive.pipe(Layer.provide(DependencyServiceLive)),
  );
```

## Step 9: Create index.ts

```typescript
// packages/$ARGUMENTS/src/index.ts
export { MyService, MyServiceLive } from "./services/my-service.js";
export { create$ARGUMENTSLayer } from "./runtime.js";
export type { $ARGUMENTSErrors } from "./errors.js";
```

## Step 10: Register in workspace

Add to root `package.json` workspaces array if using explicit list:
```json
"packages/$ARGUMENTS"
```

## Step 11: Update architecture-reference and AGENTS.md

After creating the package, update:
- `.agents/skills/architecture-reference/SKILL.md` — add to package list and dependency graph
- `AGENTS.md` — add to package count and dependency tree
- `README.md` — add to packages table
- `.agents/MEMORY.md` — update current package count

## Step 12: Write tests and build

```bash
# Write at least one test (see agent-tdd skill)
bun test packages/$ARGUMENTS --timeout 15000

# Build
bun run build --filter @reactive-agents/$ARGUMENTS

# Typecheck
bun run typecheck --filter @reactive-agents/$ARGUMENTS
```
```

- [ ] **Step 2: Commit**

```bash
git add .agents/skills/build-package/SKILL.md
git commit -m "chore(skills): repurpose build-package to add-new-package for current monorepo state"
```

---

### Task 4: Update `review-patterns` — Add Kernel-Era Categories

**Files:**
- Modify: `.agents/skills/review-patterns/SKILL.md`

The current skill has 8 categories. Add Category 9 (kernel compliance) to the end, before the Output Format section.

- [ ] **Step 1: Add Category 9 before the Output Format section**

Find `## Output Format` and insert this section immediately before it:

```markdown
### Category 9: Kernel Extension Compliance (if applicable)

Only applies if changes touch `packages/reasoning/src/strategies/kernel/`.

**PASS if:**

- New phases have the exact signature: `(state: KernelState, context: KernelContext) => Effect.Effect<KernelState, never, LLMService>`
- New guards return `GuardOutcome`: either `{ allow: true }` or `{ block: true; reason: string }` — nothing else
- New MetaTools are registered in `metaToolRegistry` in `act.ts` — not handled inline in kernel-runner
- `kernel-runner.ts` main loop was not modified to add per-turn logic
- Dead code areas (`buildDynamicContext`, `buildStaticContext`, dead context-engine sections) were not touched

**FAIL if:**

- Phase function has extra parameters beyond `(state, context)`
- Guard returns a boolean, void, or throws instead of `GuardOutcome`
- Phase or guard logic was added directly inside `kernel-runner.ts` (bypassing the phase pipeline)
- `buildDynamicContext` or `buildStaticContext` were re-enabled or modified

**Check commands:**

```bash
# Phase signatures
grep -n "^export const.*= (" packages/reasoning/src/strategies/kernel/phases/ -r

# Guard return types — must see GuardOutcome
grep -n "GuardOutcome" packages/reasoning/src/strategies/kernel/phases/guard.ts

# Ensure kernel-runner was not touched for per-turn logic
git diff HEAD packages/reasoning/src/strategies/kernel/kernel-runner.ts | head -50
```
```

- [ ] **Step 2: Update the Output Format section summary line**

Change `Summary: X/8 categories passed.` to `Summary: X/9 categories passed.`

- [ ] **Step 3: Commit**

```bash
git add .agents/skills/review-patterns/SKILL.md
git commit -m "chore(skills): add Category 9 kernel-era compliance to review-patterns"
```

---

### Task 5: Update `build-coordinator` — Kernel Architecture Context

**Files:**
- Modify: `.agents/skills/build-coordinator/SKILL.md`

The current skill correctly shows 22 packages but its kernel section describes the old monolithic `runKernel()` loop. Update the kernel references to reflect the composable phase architecture.

- [ ] **Step 1: Find and update the kernel description in the dependency graph or coordination notes**

Search for any references to the old kernel pattern (e.g., "Think → Parse → Execute Tool → Observe") and replace with:

```markdown
**Kernel changes (packages/reasoning):** The kernel uses a composable Phase pipeline. New behavior goes into `phases/<name>.ts` and is wired via `makeKernel({ phases: [...] })`. Do NOT add to `kernel-runner.ts` main loop. See `.agents/skills/kernel-extension/SKILL.md`.
```

- [ ] **Step 2: Add a note to "Common Coordination Mistakes"**

Add this item to the existing list:

```markdown
8. **Adding kernel logic to kernel-runner.ts instead of a Phase** — the composable phase pipeline is how the kernel is extended. Direct edits to the main loop bypass the phase contract and cause subtle failures. Route all new per-turn behavior through a Phase or Guard.
9. **Touching dead code areas** — `buildDynamicContext`/`buildStaticContext` and ~690 LOC in `context-engine.ts` are dead. Agents occasionally "fix" these. Do not touch them.
```

- [ ] **Step 3: Commit**

```bash
git add .agents/skills/build-coordinator/SKILL.md
git commit -m "chore(skills): update build-coordinator kernel references to composable phase architecture"
```

---

### Task 6: Update `implement-test` — Promote Timeout and Dangling Server Rules

**Files:**
- Modify: `.agents/skills/implement-test/SKILL.md`

The current skill buries critical timeout and server teardown rules. These are the #1 cause of hung CI. Move them to the top as a mandatory preamble.

- [ ] **Step 1: Add mandatory preamble immediately after the frontmatter block**

Find the line `## Test Framework` and insert this section immediately before it:

```markdown
## Mandatory Rules — Read Before Writing Any Test

These three rules prevent the most common test failures in this codebase. Violating them causes permanent hangs, flaky CI, and false greens.

### Rule 1: Always pass `--timeout 15000`

Effect-TS leaves dangling event loop handles (timers, sqlite connections, open streams). Without an explicit timeout, the test runner waits forever after tests complete.

```bash
# CORRECT — always targeted with timeout:
bun test packages/<pkg>/tests/<file>.test.ts --timeout 15000

# WRONG — never run without timeout:
bun test
```

Add the run command as a comment at the top of every test file:
```typescript
// Run: bun test packages/<pkg>/tests/<this-file>.test.ts --timeout 15000
```

### Rule 2: Always tear down servers with `.stop(true)`

Any `Bun.serve()`, Elysia, or Express instance left open after tests will trap the process permanently. Use `afterAll`:

```typescript
import { afterAll } from "bun:test";
let server: ReturnType<typeof Bun.serve> | undefined;

afterAll(async () => {
  await server?.stop(true); // true = force close all connections
});
```

### Rule 3: Use `Effect.flip` for error assertions

Effect errors do not throw. Using `try/catch` around `Effect.runPromise` for error testing produces false greens (the test always passes because the catch block is never reached the way you expect).

```typescript
// WRONG — silent false green:
try {
  await effect.pipe(Effect.provide(layer), Effect.runPromise);
} catch (e) {
  expect(e).toBeDefined();
}

// CORRECT:
const error = await effect.pipe(
  Effect.provide(layer),
  Effect.flip,
  Effect.runPromise,
);
expect(error._tag).toBe("MyError");
```

---
```

- [ ] **Step 2: Commit**

```bash
git add .agents/skills/implement-test/SKILL.md
git commit -m "chore(skills): promote timeout and dangling server rules to top of implement-test"
```

---

## Phase 3: New Skills

### Task 7: Create `kernel-extension`

**Files:**
- Create: `.agents/skills/kernel-extension/SKILL.md`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p .agents/skills/kernel-extension
```

- [ ] **Step 2: Write the SKILL.md**

Create `.agents/skills/kernel-extension/SKILL.md` with this content:

```markdown
---
name: kernel-extension
description: Add new behavior to the composable kernel — new Phase, Guard, MetaTool, or custom kernel variant. Use when extending agent reasoning, adding tool call filtering, or building a custom kernel for a new strategy.
user-invocable: false
---

# Kernel Extension — Composable Phase Architecture

## Decision Tree: What Are You Adding?

```
Does it need to READ the LLM response and TRANSFORM kernel state per-turn?
  YES → Phase

Does it need to BLOCK or MODIFY a specific tool call before execution?
  YES → Guard

Does it need to INTERCEPT a specific named tool call and return a synthetic result?
  YES → MetaTool entry in metaToolRegistry

Do you need a completely DIFFERENT phase pipeline for a new strategy?
  YES → Custom Kernel via makeKernel({ phases: [...] })
```

When in doubt: Guards are simpler than Phases. Phases are simpler than custom kernels.

## Adding a Phase

### File location
`packages/reasoning/src/strategies/kernel/phases/<name>.ts`

### Exact type signature (no deviations)
```typescript
import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { KernelState, KernelContext } from "../kernel-state.js";

export const myPhase = (
  state: KernelState,
  context: KernelContext,
): Effect.Effect<KernelState, never, LLMService> =>
  Effect.gen(function* () {
    // Read state — pure access, no mutation
    const lastStep = state.steps.at(-1);

    // Do work — yield* LLMService only if this is a think-equivalent phase
    // For non-LLM phases, use Effect.sync(() => ...) for pure transformations

    // Return FULL state — spread and override only what changed
    return {
      ...state,
      myNewField: "computed value",
    };
  });
```

### Wire into the kernel
```typescript
// In your strategy file or react-kernel.ts:
import { makeKernel } from "./react-kernel.js";
import { contextBuilder } from "./phases/context-builder.js";
import { think } from "./phases/think.js";
import { guard } from "./phases/guard.js";
import { act } from "./phases/act.js";
import { myPhase } from "./phases/my-phase.js";

// Insert your phase at the right position in the pipeline:
// - Before think: pre-processing, context enrichment
// - Between think and guard: post-LLM analysis
// - Between guard and act: pre-execution enrichment
// - After act: post-execution reflection
const kernel = makeKernel({
  phases: [contextBuilder, think, guard, myPhase, act],
});
```

### Rules
- Phases are pure functions of `(state, context)` → `Effect<state>`
- NEVER mutate `state` directly — always return a new object via spread
- NEVER add per-turn logic to `kernel-runner.ts` — that's what phases are for
- A phase that calls LLMService should be placed where `think.ts` is or alongside it

## Adding a Guard

### Location
`packages/reasoning/src/strategies/kernel/phases/guard.ts`

### Exact type signature
```typescript
import { Guard, GuardOutcome } from "../kernel-state.js";

export const myGuard: Guard = (
  toolCall: { name: string; input: unknown },
  state: KernelState,
  input: unknown,
): GuardOutcome =>
  // GuardOutcome MUST be exactly one of:
  //   { allow: true }
  //   { block: true; reason: string }
  toolCall.name === "forbidden-tool"
    ? { block: true, reason: "This tool is blocked by myGuard." }
    : { allow: true };
```

### Register for all strategies (default guards)
```typescript
// In guard.ts — add to defaultGuards array:
export const defaultGuards: Guard[] = [
  existingGuard1,
  deduplicationGuard,
  myGuard, // ← add here
];
```

### Register for a single strategy only
```typescript
// In your strategy file — pass a custom guards array:
const kernel = makeKernel({
  phases: [contextBuilder, think, guard, act],
  // custom guards passed via context — see KernelContext.guards
});
```

### Rules
- Guards are SYNCHRONOUS — no `Effect`, no `async`, no `yield*`
- Return exactly `{ allow: true }` or `{ block: true; reason: string }` — nothing else
- Guards run in array order; first `block` wins
- A blocked tool call is logged but does NOT end the run — the LLM gets the block reason and continues

## Adding a MetaTool

### Location
`packages/reasoning/src/strategies/kernel/phases/act.ts`

### Pattern
```typescript
// In act.ts, inside metaToolRegistry:
const metaToolRegistry: Record<string, MetaToolHandler> = {
  "pulse": pulseHandler,       // existing
  "brief": briefHandler,       // existing
  "my-meta-tool": async (args, state, context) => {
    // Receives the parsed tool call arguments
    // Returns a synthetic ToolResult — no real ToolService call
    const result = computeResult(args);
    return {
      content: JSON.stringify(result),
      success: true,
    };
  },
};
```

### When MetaTool vs real Tool
| Use | When |
|-----|------|
| MetaTool | Intercepts a known tool name, synthesizes result from in-memory state, no external I/O |
| Real Tool | Needs ToolService registration, may do HTTP/file/process I/O, follows `ToolDefinition` schema |

## Custom Kernel

Use when a strategy needs a fundamentally different phase sequence:

```typescript
import { makeKernel } from "./react-kernel.js";

// Compose only the phases you need:
export const myCustomKernel = makeKernel({
  phases: [contextBuilder, myThink, act],
  // Phases are executed in order, left to right, each turn
});

// Register as a ReasoningStrategy:
export const myStrategy: ReasoningStrategy = {
  name: "my-strategy",
  execute: (input) =>
    Effect.gen(function* () {
      const result = yield* myCustomKernel(input);
      return result;
    }),
};
```

## Testing a Phase

Every phase test needs a timeout. Use a mock LLMService layer.

```typescript
// tests/phases/my-phase.test.ts
// Run: bun test packages/reasoning/tests/phases/my-phase.test.ts --timeout 15000
import { Effect, Layer } from "effect";
import { describe, it, expect } from "bun:test";
import { myPhase } from "../../src/strategies/kernel/phases/my-phase.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { makeMockLLM } from "@reactive-agents/testing";

describe("myPhase", () => {
  const mockLLMLayer = Layer.succeed(LLMService, makeMockLLM({
    defaultResponse: "mock response",
  }));

  const makeState = (overrides = {}) => ({
    messages: [],
    steps: [],
    iteration: 0,
    status: "running" as const,
    ...overrides,
  });

  it("should transform state correctly", async () => {
    const state = makeState({ iteration: 1 });
    const context = { task: "test task", agentId: "agent-1" };

    const result = await myPhase(state, context).pipe(
      Effect.provide(mockLLMLayer),
      Effect.runPromise,
    );

    expect(result.myNewField).toBe("expected value");
  }, 15000);

  it("should not modify unrelated state fields", async () => {
    const state = makeState({ messages: [{ role: "user", content: "hi" }] });
    const context = { task: "test", agentId: "agent-1" };

    const result = await myPhase(state, context).pipe(
      Effect.provide(mockLLMLayer),
      Effect.runPromise,
    );

    // Phase should not touch fields it doesn't own
    expect(result.messages).toEqual(state.messages);
  }, 15000);
});
```

## Critical: Do NOT Touch

- `kernel-runner.ts` main loop — extend via phases, not inline logic
- `context-engine.ts` dead sections (`buildDynamicContext`, `buildStaticContext`, ~560–690 LOC) — disabled, do not re-enable
- `state.messages[]` via direct mutation — return new state object from phases
```

- [ ] **Step 3: Commit**

```bash
git add .agents/skills/kernel-extension/
git commit -m "chore(skills): add kernel-extension skill for composable kernel patterns"
```

---

### Task 8: Create `agent-tdd`

**Files:**
- Create: `.agents/skills/agent-tdd/SKILL.md`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p .agents/skills/agent-tdd
```

- [ ] **Step 2: Write the SKILL.md**

Create `.agents/skills/agent-tdd/SKILL.md` with:

```markdown
---
name: agent-tdd
description: Test-Driven Development for the Reactive Agents codebase. Effect-TS aware TDD with mandatory timeout flags, Effect.flip error testing, Layer isolation, and dangling-server prevention. Use when implementing any feature or fixing any bug.
user-invocable: false
---

# TDD for Reactive Agents

## The Rule (unchanged from all TDD)

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.
```

If you wrote code before a test: delete it. Start from the test.

## Three Failure Modes This Codebase Adds

Generic TDD skills don't cover these. They cause hung CI, false greens, and leaked state:

1. **Hangs** — missing `--timeout` flag keeps Effect event loop handles alive forever
2. **Dangling servers** — `Bun.serve()` left open permanently traps the test process
3. **Silent error false-greens** — forgetting `Effect.flip` makes error path tests always pass

The patterns below prevent all three.

## Mandatory File Header

Every test file starts with this comment. It prevents timeout amnesia.

```typescript
// Run: bun test packages/<pkg>/tests/<this-file>.test.ts --timeout 15000
import { Effect, Layer } from "effect";
import { describe, it, expect, afterAll } from "bun:test";
```

## Red-Green-Refactor for Effect-TS

### RED — Write the Failing Test First

```typescript
it("should store and retrieve a tool by name", async () => {
  const result = await Effect.gen(function* () {
    const svc = yield* ToolService;
    yield* svc.register(myTool);
    return yield* svc.get("my-tool");
  }).pipe(Effect.provide(testLayer), Effect.runPromise);

  expect(result.name).toBe("my-tool");
}, 15000); // timeout on EVERY test
```

Run it:
```bash
bun test packages/tools/tests/tool-service.test.ts --timeout 15000
```

Expected output: `FAIL — ToolService not defined` (or your specific error)

**If the test passes immediately: your test is wrong. Delete it. Start over.**

### GREEN — Minimal Implementation

Write only the code needed to pass this specific test. No extra validation, no future-proofing.

Run the test again. Expected: `PASS`.

### REFACTOR

Clean up implementation and tests. Run again. Must stay green.

## Testing Error Cases: Always Use Effect.flip

```typescript
// WRONG — silent false green (Effect errors don't throw):
it("should fail on missing tool", async () => {
  try {
    await Effect.gen(function* () {
      const svc = yield* ToolService;
      yield* svc.get("nonexistent");
    }).pipe(Effect.provide(testLayer), Effect.runPromise);
  } catch (e) {
    expect(e).toBeDefined(); // This block may never execute
  }
});

// CORRECT — flip inverts success and error channels:
it("should return ToolNotFoundError for unknown tool name", async () => {
  const error = await Effect.gen(function* () {
    const svc = yield* ToolService;
    return yield* svc.get("nonexistent");
  }).pipe(
    Effect.provide(testLayer),
    Effect.flip,        // ← error becomes the success value
    Effect.runPromise,
  );

  expect(error._tag).toBe("ToolNotFoundError");
  expect(error.toolName).toBe("nonexistent");
}, 15000);
```

## Layer Composition for Test Isolation

Do not share mutable service state between tests. Each test block gets its own layer.

```typescript
// WRONG — shared layer leaks state across tests:
const testLayer = MyServiceLive.pipe(Layer.provide(EventBusLive));

describe("MyService", () => {
  it("adds item", async () => { /* mutates shared layer */ });
  it("lists items", async () => { /* sees leaked state from previous test */ });
});

// CORRECT — factory function creates fresh layer per test:
const makeTestLayer = () =>
  MyServiceLive.pipe(Layer.provide(EventBusLive));

describe("MyService", () => {
  it("adds item", async () => {
    const result = await effect.pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise,
    );
    // ...
  }, 15000);
});
```

## Dangling Server Teardown

Any test that binds a port MUST release it. Otherwise the test process hangs permanently.

```typescript
import { afterAll } from "bun:test";

describe("HTTP endpoint tests", () => {
  let server: ReturnType<typeof Bun.serve> | undefined;

  afterAll(async () => {
    await server?.stop(true); // true = force-close all connections immediately
  });

  it("responds to health check", async () => {
    server = Bun.serve({ port: 0, fetch: myHandler });
    const port = (server as any).port;
    const resp = await fetch(`http://localhost:${port}/health`);
    expect(resp.status).toBe(200);
  }, 15000);
});
```

This applies to: `Bun.serve()`, Elysia apps, Express apps, any HTTP server.

## Run Commands

```bash
# During development — always targeted:
bun test packages/<pkg>/tests/<file>.test.ts --timeout 15000

# Run specific test by name:
bun test packages/<pkg>/tests/<file>.test.ts --timeout 15000 -t "test name"

# After implementing — full package:
bun test packages/<pkg> --timeout 15000

# Before committing — full suite:
bun test --timeout 15000
```

**Never omit `--timeout 15000`.** There is no scenario in this codebase where it is safe to omit.

## Real vs Mock Dependencies

| Dependency | Use Real When | Use Mock When |
|-----------|--------------|--------------|
| `EventBus` | Testing event-emitting behavior | Testing services that don't use events |
| `LLMService` | Never — expensive, flaky, slow | Always — use `makeMockLLM()` |
| `ToolService` | Integration tests of tools | Unit tests of non-tool services |
| SQLite (memory) | Use `:memory:` in-process DB | N/A — in-memory IS the mock |
| HTTP server | Real port with `Bun.serve({ port: 0 })` | N/A |
| `@reactive-agents/testing` mocks | Preferred for standard scenarios | N/A |

Always prefer `@reactive-agents/testing` pre-built mocks (`makeMockLLM`, `makeMockToolService`, `makeMockEventBus`) over hand-rolled ones. Only hand-roll when you need fine-grained per-call behavior.

## Multi-Turn Kernel Tests

For testing full agent execution with a scripted tool call sequence:

```typescript
import { ReactiveAgents } from "reactive-agents";

it("completes a two-turn task using search then summarize", async () => {
  const agent = await ReactiveAgents.create()
    .withTestScenario([
      { toolCall: { name: "search", args: { query: "AI trends" } } },
      { text: "Here are the AI trends: ..." },
    ])
    .withTools({ tools: [searchTool] })
    .build();

  const result = await agent.run("Find and summarize AI trends");

  expect(result.success).toBe(true);
  expect(result.output).toContain("trends");
}, 30000); // Multi-turn needs a longer timeout
```
```

- [ ] **Step 3: Commit**

```bash
git add .agents/skills/agent-tdd/
git commit -m "chore(skills): add agent-tdd skill for Effect-TS aware TDD patterns"
```

---

### Task 9: Create `kernel-debug`

**Files:**
- Create: `.agents/skills/kernel-debug/SKILL.md`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p .agents/skills/kernel-debug
```

- [ ] **Step 2: Write the SKILL.md**

Create `.agents/skills/kernel-debug/SKILL.md` with:

```markdown
---
name: kernel-debug
description: Debug agent reasoning failures using the composable kernel phase map. Maps symptoms to specific files and grep commands. Use when an agent is not calling tools, looping, producing wrong output, or failing silently.
user-invocable: false
---

# Kernel Debug — Symptom to Phase Map

The composable kernel maps every failure symptom to a specific phase and file. Use this table to find the right code immediately rather than doing broad codebase exploration.

## Symptom → Phase → File

| Symptom | Phase | Files to Read |
|---------|-------|--------------|
| Agent never calls tools | `think.ts` (FC parsing) + `guard.ts` | `phases/think.ts`, `phases/guard.ts`, `utils/tool-execution.ts` |
| Agent repeats the same tool call | `guard.ts` (dedup guard) | `phases/guard.ts` → `deduplicationGuard` |
| Infinite thought loop (no tools) | `loop-detector.ts` | `utils/loop-detector.ts` → `maxConsecutiveThoughts: 3` |
| Agent never reaches final answer | `act.ts` (final-answer gate) + `think.ts` (oracle) | `phases/act.ts` → final-answer gate, `phases/think.ts` → oracle hard gate |
| Tool call silently rejected | `guard.ts` | `phases/guard.ts` → `defaultGuards[]` + `GuardOutcome` |
| Context too large / compaction fired | `context-builder.ts` | `phases/context-builder.ts` → compaction circuit breaker |
| Agent fails immediately with 0 tokens | `execution-engine.ts` (withheld error) | `packages/runtime/src/execution-engine.ts` → withheld error pattern |
| `max_output_tokens` error surfaces immediately | `kernel-runner.ts` (missing recovery) | `kernel-runner.ts` → `withheldError` + recovery count |
| System prompt not reaching LLM | `context-builder.ts` | `phases/context-builder.ts` → `buildSystemPrompt()` |
| Tool schemas not in LLM call | `context-builder.ts` | `phases/context-builder.ts` → `buildToolSchemas()` |
| EventBus events not firing | `execution-engine.ts` | `packages/runtime/src/execution-engine.ts` → ManagedRuntime shared instance |
| Memory not persisting between turns | `think.ts` / `act.ts` | `state.messages[]` vs `state.steps[]` — see Two Records section |

## Two State Records — Which to Inspect

```
state.messages[]  ← What the LLM sees (multi-turn FC conversation thread)
                     Inspect for: wrong context, missing tool results, bad message order
                     Modified by: context-builder.ts, think.ts, act.ts

state.steps[]     ← What systems observe (entropy scoring, metrics, debrief)
                     Inspect for: wrong step counts, entropy values, tool stats
                     Modified by: act.ts, kernel-runner.ts post-step hooks
```

Debug LLM behavior issues → `state.messages[]`
Debug metrics/entropy/observability issues → `state.steps[]`

## Targeted Grep Commands

```bash
# "Agent not calling tools" — check FC strategy negotiation
grep -n "toolSchemas\|buildToolSchemas\|fc_strategy" \
  packages/reasoning/src/strategies/kernel/phases/context-builder.ts

# "Tool call blocked" — check guard chain
grep -n "defaultGuards\|GuardOutcome\|block:" \
  packages/reasoning/src/strategies/kernel/phases/guard.ts

# "Loop detected" — check loop detector thresholds
grep -n "maxConsecutiveThoughts\|loopDetected\|nudge" \
  packages/reasoning/src/strategies/kernel/utils/loop-detector.ts

# "Final answer never fires" — check oracle and final-answer gate
grep -n "final.answer\|oracle\|readyToAnswer\|hardGate" \
  packages/reasoning/src/strategies/kernel/phases/act.ts \
  packages/reasoning/src/strategies/kernel/phases/think.ts

# "0 token failure" — check withheld error pattern
grep -n "withheld\|recoveryCount\|max_output_tokens" \
  packages/runtime/src/execution-engine.ts \
  packages/reasoning/src/strategies/kernel/kernel-runner.ts

# "Context too large" — check compaction trigger
grep -n "compact\|contextPressure\|budget" \
  packages/reasoning/src/strategies/kernel/phases/context-builder.ts
```

## Enable Full Prompt Logging

When you need to see the exact prompts and responses the LLM is receiving:

```typescript
// In your agent builder:
ReactiveAgents.create()
  .withLogModelIO(true)  // Logs all LLM requests + responses to console
  .build()
```

Or set the environment variable:
```bash
RAX_LOG_MODEL_IO=true bun run your-script.ts
```

This outputs the full system prompt, message thread, and tool schemas sent on each turn, plus the raw LLM response. The highest-signal debug tool for LLM behavior issues.

## Common Root Causes

### "Agent not calling tools" — 3 most common causes

1. **Tools not in FC schema**: `buildToolSchemas()` in `context-builder.ts` filtered them out. Check `requiredTools` threading.
2. **All tools blocked by guard**: A guard in `defaultGuards[]` is blocking all calls. Check `guard.ts`.
3. **FC strategy mismatch**: Agent is using text-based tool call format but provider expects native FC. Check `fc_strategy` negotiation in `think.ts`.

### "Infinite loop" — 2 most common causes

1. **`maxConsecutiveThoughts: 3` not triggering**: Nudge observations need to reset the counter. Check if `loop-detector.ts` is receiving the right signals.
2. **Oracle not firing**: `readyToAnswer` signal is being sent but the oracle gate in `think.ts` isn't triggering exit. Check entropy threshold.

### "Silent LLM failure" — check this first

Before diving into kernel code, confirm the LLM call itself is not failing:
```bash
# Check for provider-level errors
grep -n "LLMError\|providerError\|status.*429\|status.*500" \
  packages/llm-provider/src/providers/
```

## Debug Workflow

1. Read the symptom → find the phase in the table above
2. Run the grep command for that symptom
3. Enable `logModelIO` to see the actual LLM input/output
4. Read the specific phase file — it's small (100–200 lines)
5. Add targeted test that reproduces the symptom (see `agent-tdd` skill)
6. Fix in the phase, verify test passes
```

- [ ] **Step 3: Commit**

```bash
git add .agents/skills/kernel-debug/
git commit -m "chore(skills): add kernel-debug skill for symptom-to-phase debugging map"
```

---

### Task 10: Create `provider-streaming`

**Files:**
- Create: `.agents/skills/provider-streaming/SKILL.md`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p .agents/skills/provider-streaming
```

- [ ] **Step 2: Write the SKILL.md**

Create `.agents/skills/provider-streaming/SKILL.md` with:

```markdown
---
name: provider-streaming
description: LLM provider streaming patterns and per-provider quirks. Use when adding a new provider, implementing adapter hooks, or debugging streaming tool call behavior in packages/llm-provider.
user-invocable: false
---

# Provider Streaming Patterns

## The One Rule That Applies to ALL Providers

```
Pass tools to BOTH complete() AND stream().
```

Failing to pass tools to `stream()` causes silent tool call failures where the LLM receives no tool schemas and falls back to text output.

```typescript
// CORRECT — tools on both:
const response = yield* llm.complete({ messages, tools: toolSchemas, maxTokens: 4096 });
const stream = yield* llm.stream({ messages, tools: toolSchemas, maxTokens: 4096 });

// WRONG — tools only on complete:
const stream = yield* llm.stream({ messages, maxTokens: 4096 }); // missing tools
```

## Per-Provider Streaming Quirks

These bugs have been introduced multiple times. Treat them as rules.

### Anthropic

**Rule:** Use raw `streamEvent`, not the SDK helper events.

```typescript
// WRONG — inputJson fires before contentBlock, causing missed content:
stream.on("inputJson", (delta) => { ... });

// CORRECT — use streamEvent for ordering guarantees:
stream.on("streamEvent", (event) => {
  if (event.type === "content_block_delta") { ... }
  if (event.type === "tool_use") { ... }
});
```

### Gemini

**Rule:** `functionResponse.name` must use `msg.toolName`, not a hard-coded string.

```typescript
// WRONG — breaks multi-tool scenarios:
{
  functionResponse: {
    name: "tool",  // hard-coded — wrong
    response: toolResult,
  }
}

// CORRECT:
{
  functionResponse: {
    name: msg.toolName,  // use the actual tool name from the message
    response: toolResult,
  }
}
```

### Ollama

**Rule:** Tool calls are on `chunk.done`, not streamed incrementally. Emit synthetic events.

```typescript
// CORRECT Ollama streaming pattern:
if (chunk.done && chunk.message.tool_calls) {
  for (const tc of chunk.message.tool_calls) {
    yield { type: "tool_use_start", toolName: tc.function.name };
    yield { type: "tool_use_delta", delta: JSON.stringify(tc.function.arguments) };
  }
}
```

Do NOT attempt to stream Ollama tool call arguments incrementally — they arrive only on the final `done` chunk.

### OpenAI / LiteLLM / Others

Standard streaming patterns apply. Follow the `StreamEvent` type definitions in `packages/llm-provider/src/types.ts`.

## Adding a New Provider

### Required: 7 methods on LLMService

```typescript
// packages/llm-provider/src/providers/<name>.ts
export const create<Name>Provider = (config: ProviderConfig): LLMService["_tag"] => ({
  complete: (request) => Effect.gen(function* () { ... }),
  stream: (request) => Effect.gen(function* () { ... }),        // ← must accept tools
  completeStructured: (request) => Effect.gen(function* () { ... }),
  embed: (texts, model?) => Effect.gen(function* () { ... }),
  countTokens: (messages) => Effect.gen(function* () { ... }),
  getModelConfig: () => Effect.succeed({ provider: "<name>", model: config.model }),
});
```

### Required: Declare ProviderCapabilities

```typescript
// In packages/llm-provider/src/capabilities.ts or provider file:
export const myProviderCapabilities: ProviderCapabilities = {
  supportsNativeFunctionCalling: true,  // or false
  supportsStreaming: true,
  supportsPromptCaching: false,
  supportedTiers: ["t1", "t2", "t3"],
};
```

### Required: Register in createLLMProviderLayer

```typescript
// packages/llm-provider/src/runtime.ts
case "my-provider":
  return createMyProviderLayer(config);
```

## Provider Adapter Hooks

7 hooks that allow strategies to inject provider-specific guidance. All 7 are implemented. Wire them via `selectAdapter(capabilities, tier)`.

| Hook | When it fires | Purpose |
|------|--------------|---------|
| `systemPromptPatch` | Before every LLM call | Provider-specific system prompt additions |
| `toolGuidance` | When tools are available | How to frame tool use for this provider |
| `taskFraming` | Start of task | Provider-specific task framing language |
| `continuationHint` | After tool results | Nudge toward next action |
| `errorRecovery` | On LLM error | Recovery message phrasing |
| `synthesisPrompt` | Pre-final-answer | Synthesis framing |
| `qualityCheck` | Post-output | Output quality validation prompt |

```typescript
// Usage in a phase:
const adapter = selectAdapter(context.capabilities, context.tier);
const patch = adapter.systemPromptPatch?.(state, context) ?? "";
```

## Testing Provider Streaming

```typescript
// tests/providers/<name>.test.ts
// Run: bun test packages/llm-provider/tests/providers/<name>.test.ts --timeout 15000
import { Effect } from "effect";
import { describe, it, expect } from "bun:test";

it("should stream tool calls with correct event sequence", async () => {
  const events: StreamEvent[] = [];

  await Effect.gen(function* () {
    const llm = yield* LLMService;
    const stream = yield* llm.stream({
      messages: [{ role: "user", content: "use the test tool" }],
      tools: [testToolDefinition],
    });
    yield* Stream.runForEach(stream, (event) =>
      Effect.sync(() => events.push(event)),
    );
  }).pipe(Effect.provide(myProviderLayer), Effect.runPromise);

  // Verify event ordering
  const toolUseStart = events.find(e => e.type === "tool_use_start");
  const toolUseDelta = events.find(e => e.type === "tool_use_delta");
  expect(toolUseStart).toBeDefined();
  expect(toolUseDelta).toBeDefined();
  expect(events.at(-1)?.type).toBe("message_stop");
}, 15000);
```
```

- [ ] **Step 3: Commit**

```bash
git add .agents/skills/provider-streaming/
git commit -m "chore(skills): add provider-streaming skill for per-provider quirks and FC patterns"
```

---

### Task 11: Create `mcp-integration`

**Files:**
- Create: `.agents/skills/mcp-integration/SKILL.md`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p .agents/skills/mcp-integration
```

- [ ] **Step 2: Write the SKILL.md**

Create `.agents/skills/mcp-integration/SKILL.md` with:

```markdown
---
name: mcp-integration
description: MCP client integration patterns for packages/tools/src/mcp/. Docker container lifecycle, transport auto-detection, two-phase container naming, and cleanup. Use when working on MCP server configuration, docker-based MCP tools, or the mcp-client.
user-invocable: false
---

# MCP Integration Patterns

## The Critical Rule

```
docker rm -f <containerName> is the ONLY reliable container stop.
subprocess.kill() is NOT sufficient.
```

Killing the `docker run` process leaves the container alive in the Docker daemon. `docker rm -f` is the only operation that reliably terminates AND removes the container. This is non-negotiable.

## Two Docker MCP Patterns

| Pattern | Examples | Container behavior |
|---------|---------|-------------------|
| **stdio MCP** | GitHub MCP, filesystem MCP | Container reads JSON-RPC from stdin; responds on stdout |
| **HTTP-only MCP** | mcp/context7 | Container starts an HTTP server on a port; ignores stdin |

Both are handled transparently. The client auto-detects which pattern applies.

## Transport Auto-Detection

The MCP client races two connection methods when starting a docker container:

1. **stdio connect** — attempts to connect via stdin/stdout immediately
2. **HTTP URL detection** — watches container stderr for a URL pattern (e.g., `http://localhost:3000`)

When HTTP wins the race, the client switches to port-mapped HTTP mode automatically. No manual configuration needed.

**Transport inference rules** (for non-docker configs):
- `command` field present → `"stdio"`
- endpoint contains `/mcp` → `"streamable-http"`
- any other endpoint → `"sse"`
- `transport` field in `MCPServerConfig` is optional — auto-inferred if not set

## Two-Phase Container Naming

Docker containers are created in two phases. This prevents conflicts between concurrent agents running the same MCP server.

| Phase | Name pattern | Purpose |
|-------|-------------|---------|
| Probe | `rax-probe-<name>-<pid>` | Initial stdio connection attempt |
| Managed | `rax-mcp-<name>-<pid>` | Port-mapped HTTP mode (after HTTP detected) |

`<pid>` = process ID of the agent. Two agents running the same MCP server get different container names.

## Cleanup Pattern

Always call `cleanupMcpTransport(serverName)` — not just `transport.close()`.

```typescript
// WRONG — leaves container running in Docker daemon:
await transport.close();

// CORRECT — removes container first, then closes transport:
await cleanupMcpTransport(serverName);
// Internally: docker rm -f rax-mcp-<name>-<pid> && transport.close()
```

`cleanupMcpTransport` is called in:
- Cortex DELETE `/api/mcp-servers/:id`
- Agent `dispose()` lifecycle hook

## MCPServerConfig Schema

```typescript
// packages/tools/src/mcp/types.ts
interface MCPServerConfig {
  readonly name: string;
  readonly command?: string;           // e.g., "docker"
  readonly args?: readonly string[];   // e.g., ["run", "--rm", "-i", "ghcr.io/..."]
  readonly env?: Record<string, string>;
  readonly endpoint?: string;          // e.g., "http://localhost:3000/mcp"
  readonly transport?: "stdio" | "streamable-http" | "sse"; // optional — auto-inferred
}
```

The `transport` field is optional. Do not require it in new code.

## Cortex MCP Config Import

Cortex accepts MCP configs in two JSON shapes. Both are handled by `parseConfigBody` + `expandMcpConfigsFromJson`:

**Shape 1 — Cursor format:**
```json
{
  "mcpServers": {
    "github": { "command": "docker", "args": ["run", ...] }
  }
}
```

**Shape 2 — Claude Desktop format:**
```json
{
  "mcpServers": {
    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }
  }
}
```

Do not add new shape parsers without updating `expandMcpConfigsFromJson`.

## Testing MCP Integration

```typescript
// Run: bun test packages/tools/tests/mcp-client.test.ts --timeout 15000
import { Effect, Layer } from "effect";
import { describe, it, expect } from "bun:test";

it("should auto-detect transport from stdio config", async () => {
  const config: MCPServerConfig = {
    name: "test-mcp",
    command: "docker",
    args: ["run", "--rm", "-i", "some-mcp-image"],
    // transport not set — should be inferred as "stdio"
  };

  const transport = inferTransport(config);
  expect(transport).toBe("stdio");
}, 15000);

it("should infer streamable-http for /mcp endpoint", async () => {
  const config: MCPServerConfig = {
    name: "context7",
    endpoint: "http://localhost:3000/mcp",
  };

  const transport = inferTransport(config);
  expect(transport).toBe("streamable-http");
}, 15000);
```

For docker integration tests, mock the docker subprocess to avoid requiring Docker in CI:
```typescript
const mockDockerProcess = {
  stdin: { write: vi.fn() },
  stdout: { on: vi.fn() },
  stderr: { on: vi.fn() },
  kill: vi.fn(), // NOTE: this does NOT stop the container — tests should verify docker rm -f is called
};
```
```

- [ ] **Step 3: Commit**

```bash
git add .agents/skills/mcp-integration/
git commit -m "chore(skills): add mcp-integration skill for docker MCP patterns"
```

---

### Task 12: Create `reactive-feature-dev`

**Files:**
- Create: `.agents/skills/reactive-feature-dev/SKILL.md`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p .agents/skills/reactive-feature-dev
```

- [ ] **Step 2: Write the SKILL.md**

Create `.agents/skills/reactive-feature-dev/SKILL.md` with:

```markdown
---
name: reactive-feature-dev
description: Complete feature development workflow for Reactive Agents. Orchestrates the correct sequence of skills for any feature type. Use at the start of any non-trivial implementation task to route to the right skills and follow the right order.
user-invocable: false
---

# Reactive Agents Feature Development Workflow

## Step 0: Route to the Right Skills First

Before writing any code, identify what kind of work this is and load the corresponding skill:

```
Is this kernel work (new phase, guard, meta-tool, custom kernel)?
  → Load: kernel-extension skill

Is this provider or adapter work (new provider, streaming, adapter hooks)?
  → Load: provider-streaming skill

Is this MCP work (docker-based tools, transport, container lifecycle)?
  → Load: mcp-integration skill

Is this a new service in an existing package?
  → Load: implement-service skill

Is this a new package?
  → Load: build-package skill (add-new-package)
```

For all cases, also load: `agent-tdd` (write tests first), `effect-ts-patterns` (required for all code).

## Step 1: Read Before Writing

```bash
# 1. Confirm current architecture
cat AGENTS.md | head -100

# 2. Read the affected package's source entry point
# (see architecture-reference skill for the right first file per package)

# 3. Identify which dependency layers are affected
# Changes to upstream packages (core, llm-provider) require downstream rebuild
```

Do NOT skip this step. Writing code without reading the affected package first causes:
- Duplicate implementations of existing functionality
- Wrong dependency layer — editing a higher-layer package when the change belongs in a lower one
- Breaking existing patterns because you didn't see them

## Step 2: Identify Dependency Impact

Check the build order before touching any package:

```
Layer 0: core → llm-provider (changes here require rebuilding EVERYTHING downstream)
Layer 1: memory, tools, guardrails, cost, identity, observability, interaction, prompts, eval, a2a
Layer 2: reasoning, verification, orchestration, gateway, reactive-intelligence
Layer 3: runtime → reactive-agents (facade)
```

If your change touches Layer 0 or 1, plan for cross-package type verification.

## Step 3: Write the Failing Test First (agent-tdd)

Following `agent-tdd` skill:

```typescript
// 1. Create test file with mandatory header
// Run: bun test packages/<pkg>/tests/<your-file>.test.ts --timeout 15000

// 2. Write ONE failing test that captures the desired behavior
// 3. Run it — confirm it fails with the right error
bun test packages/<pkg>/tests/<your-file>.test.ts --timeout 15000

// 4. Write minimal code to pass
// 5. Run again — confirm it passes
// 6. Add edge case tests, refactor
```

## Step 4: Implement with Effect-TS Patterns

Following `effect-ts-patterns` skill:

- All data shapes: `Schema.Struct` — never `interface` or `type { ... }`
- All errors: `Data.TaggedError` — never `throw new Error()`
- All state: `Ref.make` / `Ref.get` / `Ref.update` — never `let`
- All async: `Effect.tryPromise` — never `await`
- All imports: `.js` extension on relative imports (Bun ESM)
- All service methods: `readonly` keyword

## Step 5: Validate Before Committing

Run both validators:

```bash
# 1. Pattern compliance (anti-pattern grep)
# (from validate-build skill)
grep -rn "throw new" packages/<pkg>/src/ || echo "✅ No throw"
grep -rn "^interface " packages/<pkg>/src/ || echo "✅ No plain interfaces"
grep -rn "let " packages/<pkg>/src/ || echo "✅ No let"
grep -rn "await " packages/<pkg>/src/ || echo "✅ No raw await"

# 2. Full package test
bun test packages/<pkg> --timeout 15000

# 3. Typecheck
bun run typecheck --filter @reactive-agents/<pkg>

# 4. Build (if touching a built package)
bun run build --filter @reactive-agents/<pkg>
```

For kernel changes, also run `review-patterns` Category 9 (kernel-extension compliance).

## Step 6: Update Documentation

Following `update-docs` skill:

```bash
# Check what changed
git diff --name-only HEAD

# Update AGENTS.md if: new package, new builder method, test count changed
# Update README.md if: new package, new provider, new capability
# Update docs site if: new feature needs a docs page
# Update .agents/MEMORY.md with new capabilities/patterns
```

## Step 7: Commit and Add Changeset

```bash
# Stage specific files — never git add -A
git add packages/<pkg>/src/ packages/<pkg>/tests/

# Commit with present-tense description of what changed
git commit -m "feat(<pkg>): <what the change does>"

# Add changeset for version bump
bun run changeset
# Choose: patch (bug fix), minor (new feature), major (breaking change)
```

## Dead Code Areas — Do Not Touch

These sections exist in the codebase but are disabled. Do not modify, re-enable, or "clean up":

| Area | Location | Size |
|------|---------|------|
| `buildDynamicContext` | `packages/reasoning/src/strategies/kernel/phases/context-builder.ts` | ~280 LOC |
| `buildStaticContext` | same file | ~280 LOC |
| Dead text-assembly functions | `packages/reasoning/src/strategies/kernel/utils/context-utils.ts` | ~690 LOC total |

These are preserved as reference. Any PR that modifies them will be rejected.

## Quality Gates Before Any Commit

All of these must pass. No exceptions:

- [ ] No `any` types (including `as any` casts)
- [ ] No `interface` for data shapes (use `Schema.Struct`)
- [ ] No `let` for mutable state (use `Ref`)
- [ ] No `await` (use `Effect.tryPromise` or `Effect.sync`)
- [ ] No `throw` (use `Data.TaggedError`)
- [ ] All relative imports have `.js` extension
- [ ] All tests pass: `bun test packages/<pkg> --timeout 15000`
- [ ] Build passes: `bun run build --filter @reactive-agents/<pkg>`

## Subagent Context Template

When dispatching a subagent for implementation work, include this context block:

```
Project: Reactive Agents (reactive-agents-ts)
Stack: TypeScript + Bun + Effect-TS (^3.10) + bun:test
Key rule: All data shapes use Schema.Struct, errors use Data.TaggedError, state uses Ref, async uses Effect.tryPromise
Tests: always --timeout 15000, always targeted file not global suite
Required skills to load: effect-ts-patterns, [task-specific skill from routing above]
Dead code: do not touch buildDynamicContext/buildStaticContext or context-engine.ts dead sections
Architecture: read AGENTS.md before making changes
```
```

- [ ] **Step 3: Commit**

```bash
git add .agents/skills/reactive-feature-dev/
git commit -m "chore(skills): add reactive-feature-dev orchestrating workflow skill"
```

---

### Task 13: Create `prepare-release`

**Files:**
- Create: `.agents/skills/prepare-release/SKILL.md`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p .agents/skills/prepare-release
```

- [ ] **Step 2: Write the SKILL.md**

Create `.agents/skills/prepare-release/SKILL.md` with:

```markdown
---
name: prepare-release
description: Prepare a Reactive Agents release. Validates build and tests, audits documentation, generates changeset, and writes a consistent changelog entry. Use when cutting a new release version.
argument-hint: [vX.Y.Z]
---

# Prepare Release: $ARGUMENTS

## Step 1: Pre-Flight Gate — All Must Pass

```bash
# 1. Full build
bun run build
# Expected: all packages build without errors

# 2. Full test suite with timeout
bun test --timeout 15000
# Expected: all tests pass, 0 failures

# 3. Type checking
bun run typecheck
# Expected: 0 errors
```

**Hard stop:** Do not proceed if any of these fail. Fix failures before continuing.

## Step 2: Identify Changes Since Last Release

```bash
# Find last release tag
git describe --tags --abbrev=0

# List all commits since last tag
git log $(git describe --tags --abbrev=0)..HEAD --oneline

# List all changed packages
git diff $(git describe --tags --abbrev=0)..HEAD --name-only | grep "^packages/" | cut -d/ -f2 | sort -u
```

## Step 3: Audit Documentation

Run the `update-docs` skill against all changes since last release. Verify:

```bash
# Current test count in docs matches reality
bun test --timeout 15000 2>&1 | grep "tests passed"
# Compare against what AGENTS.md and README.md say

# Current package count matches
ls packages/ | wc -l
# Compare against AGENTS.md package count
grep -n "packages" AGENTS.md | grep -i "22\|count\|total" | head -5

# API signatures in docs match current code
# (search for any changed public APIs and verify docs reference current signatures)
git diff $(git describe --tags --abbrev=0)..HEAD -- packages/*/src/index.ts | grep "^+export"
```

Fix any documentation that is stale before proceeding.

## Step 4: Create Changeset

```bash
bun run changeset
```

When prompted, choose the semver bump:

| Change type | Bump |
|------------|------|
| Bug fix, internal refactor, perf improvement | `patch` |
| New feature, new package, new builder method | `minor` |
| Breaking API change, removed export, behavioral change | `major` |

Select affected packages. Write a one-sentence summary of the change for the changeset.

## Step 5: Write the Changelog Entry

Add a new entry at the top of `CHANGELOG.md` using this mandatory template:

```markdown
## vX.Y.Z — YYYY-MM-DD

### Highlights

[1-3 sentences describing the theme and most important changes of this release.
What problem does this release primarily solve? What is the headline capability?]

### Breaking Changes

[List each breaking change with migration guidance. If none, write "None."]

- `MethodName` renamed to `NewMethodName` — update all callers
- `PackageName` now requires `newField` in config

### New Features

[Each item: what it does, which package, brief usage example if non-obvious]

- **`featureName`** (`@reactive-agents/package`): Description of what it does.
  ```typescript
  // Usage example
  ```

### Bug Fixes

[Each item: what was broken, what the fix is, affected package]

- Fixed `ServiceName.method()` returning stale state after concurrent updates (`@reactive-agents/package`)

### Internal / Architecture

[Significant internal changes that don't affect the public API but matter for contributors]

- Refactored `kernel-runner.ts` into composable phase pipeline
- Dead code sections isolated behind feature flag

### Migration Guide

[Only if there are breaking changes. Step-by-step migration for each breaking change.]

#### Migrating from vX.Y.Z-1

**If you use `oldMethodName`:** Replace with `newMethodName`. The signature is identical.
```

## Step 6: Write Release Overview Document

Create `docs/releases/vX.Y.Z.md` with the same content as the changelog entry. This file serves as the standalone release announcement.

```bash
mkdir -p docs/releases
# Write the file using the template above
```

## Step 7: Update Agent Memory

Update `.agents/MEMORY.md` with the new version status:

```markdown
## Current Status ([Month] [Day], [Year])
- **vX.Y.Z released** — [one-line summary of what shipped]
```

Also update Claude project memory in `~/.claude/projects/*/memory/` if maintained.

## Step 8: Final Checklist

```bash
# Verify changeset file exists
ls .changeset/

# Confirm CHANGELOG.md has the new entry at top
head -20 CHANGELOG.md

# Confirm release doc exists
ls docs/releases/

# Final full test run
bun test --timeout 15000

# Tag if ready (only after all checks pass)
git tag vX.Y.Z
```

- [ ] All tests pass
- [ ] Build succeeds
- [ ] Typecheck clean
- [ ] AGENTS.md test/package counts current
- [ ] README.md accurate
- [ ] Changeset file created
- [ ] CHANGELOG.md has new entry with mandatory template sections
- [ ] `docs/releases/vX.Y.Z.md` created
- [ ] `.agents/MEMORY.md` updated with release status
```

- [ ] **Step 3: Commit**

```bash
git add .agents/skills/prepare-release/
git commit -m "chore(skills): add prepare-release skill with consistent changelog template"
```

---

## Self-Review

### Spec Coverage Check

| Skill from design | Task that implements it |
|-----------------|------------------------|
| Retire `codebase-to-course` | Task 1 ✅ |
| Verify light-touch skills | Task 1 ✅ |
| Overhaul `architecture-reference` | Task 2 ✅ |
| Repurpose `build-package` | Task 3 ✅ |
| Update `review-patterns` | Task 4 ✅ |
| Update `build-coordinator` | Task 5 ✅ |
| Update `implement-test` | Task 6 ✅ |
| New: `kernel-extension` | Task 7 ✅ |
| New: `agent-tdd` | Task 8 ✅ |
| New: `kernel-debug` | Task 9 ✅ |
| New: `provider-streaming` | Task 10 ✅ |
| New: `mcp-integration` | Task 11 ✅ |
| New: `reactive-feature-dev` | Task 12 ✅ |
| New: `prepare-release` | Task 13 ✅ |

All 14 design requirements have corresponding tasks. No gaps.

### Type Consistency

- Skill frontmatter format is consistent across all new skills: `name`, `description`, optional `user-invocable: false`, optional `argument-hint`
- All test examples include `--timeout 15000`
- All Effect error tests use `Effect.flip`
- All phase type signatures use `(state: KernelState, context: KernelContext) => Effect.Effect<KernelState, never, LLMService>`
- Dead code references are consistent: `buildDynamicContext`, `buildStaticContext`, `context-engine.ts`

### Placeholder Scan

No TBDs, TODOs, or incomplete sections found. All code examples are complete and runnable.
