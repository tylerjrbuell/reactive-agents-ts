---
title: Cortex Parameterized Runs — template variables + fill-at-launch (design)
date: 2026-06-06
type: design-spec
status: approved-pending-user-review
scope: apps/cortex (UI Lab + server run path); no framework (packages/**) changes
phase: Track B — parameterized runs (foundation; sweep is Phase 2, not built here)
related:
  - wiki/Research/2026-06-06-cortex-agent-building-audit.md
  - .agents/MEMORY.md (project_cortex_overhaul_2026_06_06)
---

# Cortex Parameterized Runs (design)

## Goal

Let a Cortex user define an agent **template** once — with `{{variable}}` placeholders
in any string config field — save it, then **fill the blanks via a launch modal** each
run. One run per launch. The variable schema is designed so a future **sweep/matrix**
phase (run the same template across a set of values) reuses it without rework.

## Non-goals (explicitly out of scope)

- **Parameter sweep / matrix runs** — Phase 2. Schema carries the hooks (`enumValues`);
  no sweep UI, server iteration, or comparison view is built here. (Respects North Star
  §9 anti-scaffold: foundation ships *with* a consumer — the fill modal + single run —
  not as bare scaffold.)
- **Secret / env management store** — a separate future spec. This spec only **reserves**
  the seam: `VariableDef.secret` flag + the `{{secret.NAME}}` namespace. No secret
  storage, masking, MCP-env UI, or `.env` layering is built. Phase-1 behavior for any
  `{{secret.X}}` token is a clear "secret store not configured" unresolved error.
- **Framework (`packages/**`) changes** — none. Resolution happens in Cortex *before*
  `buildCortexAgent`; the resolved config is what the framework already accepts.
- **Persisting last-used variable values** — Phase 1 prefills the modal from `default`
  only. Per-agent value history can be added later.

## Architecture

```
┌─ Lab (AgentConfigPanel) ──────────────────────────────────────────┐
│ author writes  {{topic}}  in any string field                     │
│ scanTemplateVars(config) → auto-seed VariableDef in Variables UI  │
│ user enriches (type/default/enum/required) → Save agent           │
│ variables[] persists INSIDE cortex_agents.config blob (no migration)│
└───────────────────────────────────────────────────────────────────┘
                              │ "▶ Run"
                              ▼
┌─ ParamFillModal (client) ─────────────────────────────────────────┐
│ render one typed field per VariableDef (from schema, no resolver)  │
│ validate required / number / enum (from schema, client-side)       │
│ live preview → POST /api/template/resolve (debounced) ── delegates │
│                to the ONE server resolver ─────────────────────────┼──┐
└───────────────────────────────────────────────────────────────────┘  │
                              │ submit { ...config, variableValues }     │
                              ▼                                          │
┌─ Server run path ─────────────────────────────────────────────────┐  │
│ resolveTemplate(config, values) ← single source of truth ─────────┼──┘
│   → { config: resolvedConfig, unresolved: string[] }              │
│ unresolved non-empty → 400 (interactive) / fail run (cron)         │
│ else → buildCortexAgent(resolvedConfig)  (unchanged downstream)    │
└───────────────────────────────────────────────────────────────────┘
```

**Single resolver, server-authoritative.** `resolveTemplate` exists once, server-side.
The client never re-implements substitution — for live preview it calls
`POST /api/template/resolve`, so the previewed text is produced by the *same function*
that runs at launch. In-sync by construction; **no duplicated resolver, no parity guard.**

Rationale for not sharing a module: Cortex UI (SvelteKit/Vite, `$lib: src/lib`) and
server (Bun, `include: server/**`) are separate TS projects that deliberately do **not**
cross-import (see `server/tests/config-parity.test.ts` — the `AgentConfig` *type* is kept
as parallel definitions). A shared `shared/` dir is awkward under Vite `server.fs.allow`.
Delegation via an endpoint avoids both a fragile cross-boundary import and a
hand-maintained twin.

## Data model

### VariableDef (new; lives in the Cortex `AgentConfig`)

```ts
export type VariableType = "string" | "number" | "enum" | "multiline";

export interface VariableDef {
  /** Matches the {{name}} token. Unique within a config. */
  name: string;
  type: VariableType;
  description?: string;
  /** Prefill for the modal; fallback for cron runs. number when type==="number". */
  default?: string | number;
  /** Defaults to true. Required + no value + no default → unresolved. */
  required: boolean;
  /** type==="enum" only. Also the Phase-2 sweep axis (value set). */
  enumValues?: string[];
  /** RESERVED tie-in for the future secret store. Phase 1: see Secret seam. */
  secret?: boolean;
}
```

Added to the Cortex `AgentConfig` (UI `ui/src/lib/types/agent-config.ts` **and** server
`server/services/cortex-agent-config.ts` — these are already parallel and parity-tested):

```ts
// AgentConfig gains:
readonly variables?: VariableDef[];
```

`variables` is serialized inside the existing `cortex_agents.config` TEXT blob — **no DB
migration**.

### Run request

`POST /api/runs` body (built by `ui/src/lib/cortex-runs-post-body.ts`) gains:

```ts
variableValues?: Record<string, string | number>;
```

## Components

### 1. `scanTemplateVars(config): string[]` — client (Lab authoring)

Pure. Walks all string values in the config, extracts `{{token}}` matches via
`/\{\{\s*([\w.]+)\s*\}\}/g`, dedupes, **excludes** the `secret.` namespace (those are not
user-fillable variables). Used by the Lab to auto-seed `VariableDef` entries for any token
not already declared.

### 2. `resolveTemplate(config, values): { config, unresolved }` — server (single source)

`server/services/resolve-template.ts`. Pure. Deep-walks every string field of the config
and replaces each `{{token}}`:

- `token` matches a `VariableDef.name` → substitute `values[name]` (coerced to string),
  else the var's `default` (coerced), else → record `name` in `unresolved`, leave token.
- `token` is `secret.X` → Phase 1: record `secret.X` in `unresolved` (clear error message
  upstream: *"secret store not configured (coming soon)"*). Never silently left/blank.
- Returns the resolved config (deep copy, untouched non-string fields) + `unresolved[]`.

Number coercion: a `type:"number"` value is substituted as its string form. (Tokens live
in strings; the *target field* — e.g. a prompt — is text.)

### 3. `POST /api/template/resolve` — server endpoint (live preview)

Body `{ config, variableValues }` → returns `{ resolved: ResolvedPreview, unresolved }`
where `ResolvedPreview` surfaces the substituted prompt/systemPrompt/taskContext for
display. Thin wrapper over `resolveTemplate`. Debounced client calls (~250ms).

### 4. `ParamFillModal.svelte` — client

Props: `variables: VariableDef[]`, `onSubmit(values)`. Renders one field per var
(string→text, multiline→textarea, number→number input, enum→select), prefilled from
`default`. Client-side validation from schema: required non-empty, number parses,
enum ∈ enumValues. Live preview pane (calls endpoint #3). Submit → run launch with
`variableValues`. Schema-driven — **no resolver logic client-side.**

### 5. Variables editor — in `AgentConfigPanel.svelte`

New "Variables" section. Lists auto-seeded + manual `VariableDef`s. Per-row: name (from
token, read-only when auto-seeded), type select, default, required toggle, enum values
(when type=enum), description. "Rescan template" button re-runs `scanTemplateVars` to pick
up newly typed `{{tokens}}`.

### 6. Server run-path wiring

In the launch path (`server/services/runner-service.ts` → `cortex-to-agent-config.ts` /
`build-cortex-agent.ts`): before building, call `resolveTemplate(config, variableValues)`.
- **Interactive** (`/api/runs`): `unresolved` non-empty → 400 with the list.
- **Cron / gateway** (`gateway-process-manager.ts`): no UI → resolve from defaults only;
  `unresolved` non-empty → fail the run, `cortex_runs.error_message = "unresolved
  variable: <names>"`. (No silent blanks reach the model.)

## Data flow (single run, Phase 1)

1. Author template in Lab; scanner auto-seeds vars; enrich; **Save agent**
   (`variables` in config blob).
2. **▶ Run** → if `variables.length > 0`, open `ParamFillModal` (else launch as today).
3. Fill values (prefilled from defaults); live preview via endpoint; submit.
4. `POST /api/runs` with `variableValues`.
5. Server `resolveTemplate` → resolved config → `buildCortexAgent` → run proceeds
   unchanged.

## Cron / gateway runs

Scheduled saved-agent runs resolve from variable **defaults** (no UI at fire time). A
required variable with no default fails the run fast with a clear `error_message`. This is
the Phase-1 contract; richer scheduled-value binding is future work.

## Secret seam (reserved, not built)

- `VariableDef.secret: true` and the `{{secret.NAME}}` token namespace are reserved.
- Phase 1: `resolveTemplate` records any `{{secret.X}}` as `unresolved` with message
  *"secret store not configured (coming soon)"* — surfaced as a launch error, never blank.
- The secret store (API keys, MCP server env, masking, `.env` layering) is a **separate
  future spec**. This spec adds only the namespace reservation + the value-source seam in
  the resolver (the `secret.` branch), so the later store plugs into one place.

## Phase 2 — sweep (NOT built now)

Server iterates the cartesian product of selected variables' value sets (`enumValues` or
explicit lists) through the **same `resolveTemplate`** → N runs + a comparison view. The
schema already carries `enumValues`. Nothing is scaffolded for it here.

## Error handling

| Case | Behavior |
|------|----------|
| Required var, no value, no default (interactive) | 400; modal highlights field |
| Required var, no value, no default (cron) | run fails; `error_message` lists names |
| `{{secret.X}}` (Phase 1) | unresolved → "secret store not configured (coming soon)" |
| number value not parseable | modal blocks submit (client validation) |
| enum value ∉ enumValues | modal blocks submit |
| no `{{tokens}}` / empty `variables` | launch path unchanged (no modal) |

## Testing

- **`resolveTemplate`** (server unit): substitution across nested string fields; default
  fallback; missing-required → `unresolved`; `{{secret.X}}` → `unresolved`; number→string
  substitution; non-string fields untouched; deep-copy (no input mutation).
- **`scanTemplateVars`** (client unit): token extraction across fields; `secret.`
  exclusion; dedupe; whitespace-tolerant `{{ topic }}`.
- **`POST /api/template/resolve`** (server): returns resolved preview + unresolved;
  matches `resolveTemplate` output (same function — confirms delegation path).
- **`ParamFillModal`** (client): renders per-type fields; prefill-from-default; required /
  number / enum validation; emits `variableValues`.
- **Run path** (server): `variableValues` → resolved prompt reaches `buildCortexAgent`;
  unresolved required → 400; cron-from-defaults path.
- **`cortexRunsPostBody`**: threads `variableValues` when present, omits when empty.

## File summary

**New**
- `apps/cortex/server/services/resolve-template.ts` — the single resolver (+ unit test).
- `apps/cortex/server/api/template-resolve.ts` (or route in existing api) — preview endpoint.
- `apps/cortex/ui/src/lib/template/scan-template-vars.ts` — client scanner (+ unit test).
- `apps/cortex/ui/src/lib/components/ParamFillModal.svelte` (+ test).

**Modified**
- `apps/cortex/ui/src/lib/types/agent-config.ts` — `VariableDef` + `variables?`.
- `apps/cortex/server/services/cortex-agent-config.ts` — parallel `VariableDef` + `variables?`.
- `apps/cortex/ui/src/lib/components/AgentConfigPanel.svelte` — Variables editor section.
- `apps/cortex/ui/src/lib/cortex-runs-post-body.ts` — `variableValues`.
- `apps/cortex/server/services/build-cortex-agent.ts` / `cortex-to-agent-config.ts` /
  `runner-service.ts` — call `resolveTemplate` before build; thread `variables`/`variableValues`.
- `apps/cortex/server/services/gateway-process-manager.ts` — resolve-from-defaults on cron.
- `apps/cortex/server/tests/config-parity.test.ts` — extend to cover `variables`.

## Open questions (none blocking)

- Variables editor placement in `AgentConfigPanel` (which section) — UX detail, decide at
  implementation.
- Preview pane layout in `ParamFillModal` — UX detail.
