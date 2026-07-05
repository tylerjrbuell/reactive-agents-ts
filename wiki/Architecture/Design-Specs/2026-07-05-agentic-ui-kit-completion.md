# Agentic UI Kit — Completion Design (second wave: full 3-framework parity + genUI depth)

**Date:** 2026-07-05
**Status:** Approved for planning
**Parent spec:** `wiki/Architecture/Design-Specs/2026-07-02-agentic-ui-harness-components.md` (canonical — positioning, wire protocol, families, success criteria). This doc records the **completion scope** and the session decisions that close the parent spec's deferred second wave to 100%.

---

## 1. North Star (recentered 2026-07-05)

**We are not building an agentic component library.** We are building **the only web UI kit wired to production agent substrate** — durability, human-in-the-loop, safe generative UI, cost control — exposed as drop-in primitives for React, Vue, and Svelte. The components are the last mile; the power is what they plug into.

**DX promise (the product, one sentence):**
> Add a **durable, resumable, human-in-the-loop, budget-safe** agent feature to a Next/Nuxt/SvelteKit app in **<10 lines client-side**, in **your** framework, **testable with zero tokens**.

Every binding must deliver that sentence identically. It is an **acceptance gate** on each binding, not an afterthought.

**Inspiration & delta:** Vercel AI SDK `streamUI` / json-render inspired the generative-UI family. We do everything it does — then own five layers underneath it (durable resume, agent-initiated durable HITL, async inbox, public-endpoint cost guards, zero-token testing) that decide whether an agent feature actually ships. And we ship all three frameworks, not React-only.

**Depth decision:** genUI (`AgentSurface`) gets **first-class depth** (rich registry, `action` round-trip, progressive partial-tree render) AND the durable/HITL/inbox/resume families are **equally load-bearing**. Full parity, no family shortchanged.

## 2. Why this is a completion, not a new build

Parent spec §5 shipped **React complete** but explicitly deferred: "reference components React-first, **ported as second wave**"; parent §3 flagged Vue/Svelte as duplicated/off-core. Verified state 2026-07-05:

| Package | Hooks/stores | Components | ui-core wired |
|---|---|---|---|
| `react` (reference) | 8 | 8 | yes |
| `svelte` | 7 (no `createTaskInbox`) | **0** | yes |
| `vue` | 3 legacy | **0** | **no** (hand-coded `_tag` types) |

Parent spec §4.1 mandated *"all protocol logic, parsing, and state transitions live in ui-core."* React landed some shared logic **locally** instead (registry/reconcile, inbox poll, interaction-respond). This wave finishes that mandate so bindings are thin.

## 3. Session Decisions (locked)

1. **Styling:** headless-first + opt-in styled layer, every component, all frameworks. (logic + ARIA + `data-*` + slots/render-props; styled default is a separate import.)
2. **Generative UI scope:** full parity — `AgentSurface` + registry ported to Svelte + Vue, even though the server does not emit `UiTreeDelta` yet (reserved tag; forward-compat already in protocol). First-class depth.
3. **Cortex dogfood / demo app / templates:** **out of scope this wave** ("packages first"). Parent §6 demo (`apps/ui-demo`) and §8 P5 templates are a separate follow-on.
4. **Vue component render:** `defineComponent` + `h` render functions (pure `.ts`, no `.vue` SFC compiler — tsup build unchanged, consistent 3-framework build story).
5. **Vision depth:** full depth on genUI **and** all families equally.

## 4. Architecture — lift shared logic into ui-core (robustness backbone)

Triplicating component logic across 3 frameworks is the central robustness risk. Fix: framework-agnostic controllers move to `ui-core`; each binding becomes reactivity glue only. Lift out of `packages/react` (currently React-local):

- **`ui-core/registry/`** — UI-tree node schema `{ type, props, children, key, action? }`, `uiTreeSchema(registry)` (structured-output schema generated FROM the registry so hallucinated nodes are unrepresentable), and a **pure partial-tree reconcile/merge** for progressive render. (from `react/src/components/render/registry.ts`)
- **`ui-core/inbox/`** — durable-run **poll + merge** controller for the task inbox. (from `react/src/hooks/use-task-inbox.ts`)
- **`ui-core/interaction/`** — interaction-response + approval-decision **POST helpers** (client side of the durable rails). (currently per-binding)

Rule (parent §4.1): fixing a protocol/logic bug touches ui-core **once**, never three packages. A binding is ≤ a few hundred LOC of reactivity glue.

Dependency direction unchanged: `ui-core` depends on nothing; `react`/`vue`/`svelte` depend on `ui-core`. Never the reverse.

## 5. Deliverables (parity target = the 8 React components + inbox controller, in all 3)

Component families (parent §5 v1), each headless + styled, in React (backfill onto lifted ui-core) / Svelte (`.svelte`) / Vue (`defineComponent`+`h`):

| Family | Surface | Unique power it exposes |
|---|---|---|
| **Interact** | `AgentPrompt`, `ChoiceCard`, `ApprovalGate` + `use/createInteractions` | agent-initiated **durable** HITL; answer after reload / another device |
| **Resume** | `use/createResumableRun` + cursor reattach | run survives reload / restart / device switch |
| **Inbox** | `TaskInbox` + `use/createTaskInbox` | detached async agent jobs, email-like |
| **Render** | `AgentSurface` + registry | **safe** generative UI (allowlist registry, progressive, `action` round-trip) |
| **Observe** | `CostMeter` (`use/createRunCost`), `StepTimeline` (`use/createRunSteps`) | live cost + tool/step trace off real substrate |
| **Devtools** | `AgentDevtools` | floating overlay: runs, event stream, cost burn, replay |

Plus: **Vue rewire** — kill hand-coded `_tag` union in `vue/types.ts`; rewire `useAgentStream`/`useAgent`/`useStructuredObject` onto `connectRunStream`/`reduceRunState`; add missing composables (`useRun`, `useResumableRun`, `useInteractions`, `useRunCost`, `useRunSteps`, `useTaskInbox`). **Additive** — old export names keep working (re-export).

## 6. Robustness gate — shared contract-fixture suite

Parent §7: one shared `RunFixture` set (already ui-core's **public** testing API — `recordRunFixture` / `mockAgentEndpoint`) drives react + vue + svelte binding tests, so parity drift is caught **mechanically**, not by eye. This is what makes "robust" real. Keyless, zero-token, `test`-provider only (feedback_ci_parity_no_keys_no_ollama). Component render smoke via happy-dom per framework.

**Stabilization:** once parity + contract suite are green across all three, drop the `@unstable` headers on react/vue/svelte and bump to a stable minor. Semver/release action — happens at release time, not mid-build.

## 7. Decomposition — 4 plans (too big for one)

Each lands green on `main` independently.

1. **ui-core shared controllers + React backfill** — lift registry/reconcile, inbox, interaction helpers into ui-core; rewire React's `AgentSurface`/`useTaskInbox`/`useInteractions` onto them with **zero behavior change** (proves the lift). *Foundation.*
2. **Svelte second wave** — `createTaskInbox` + all 8 components (headless + styled) + component tests + contract-fixture parity.
3. **Vue full parity** — rewire legacy 3 onto ui-core + 6 new composables + all 8 components + tests + contract-fixture parity.
4. **Parity gate + stabilize + docs** — shared contract suite across all three, de-`@unstable`, API-reference docs per exported hook/component.

## 8. Out of scope (explicit)

Cortex adoption of the new components · `apps/ui-demo` flagship demo · `create-reactive-agent --template next-inbox` scaffold · Trust/`<Claim>`/`<TrustBadge>` v2 family · new framework targets beyond react/vue/svelte. All are parent-spec P5 or v2.

## 9. Success criteria (this wave)

1. All three bindings expose the full v1 family surface (§5) — hooks/composables/stores **and** components.
2. Vue no longer carries hand-coded `_tag` types; all protocol/state logic resolves to ui-core.
3. Zero duplicated protocol/parse/reconcile/inbox logic across binding packages (grep-verifiable).
4. Shared contract-fixture suite passes for react + vue + svelte (mechanical parity).
5. The DX promise (§1) is demonstrable in each framework in <10 lines client-side.
6. A recorded fixture replays a binding test in CI with zero tokens, zero network.
7. Gap log (`wiki/Research/2026-07-agentic-ui-gap-log.md`) gains new entries for any framework friction hit.
