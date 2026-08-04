# Cortex Parameterized Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Cortex user define an agent template with `{{variable}}` placeholders, save it, and fill the blanks via a launch modal each run — resolved server-side before the agent builds.

**Architecture:** A single server-authoritative pure resolver substitutes `{{token}}` in every string field of a run payload from supplied values (falling back to per-variable defaults). The Lab auto-seeds a typed `VariableDef[]` by scanning `{{...}}` tokens; the launch modal is schema-driven and shows a live preview by delegating to a server endpoint (no duplicated resolver, no parity guard on the logic). Cron runs resolve from defaults. No framework (`packages/**`) changes — resolution happens before `buildCortexAgent`.

**Tech Stack:** TypeScript, Bun (server), Elysia (HTTP), Effect-TS (services), SvelteKit/Svelte 5 (UI), `bun test`.

**Spec:** `wiki/Architecture/Design-Specs/2026-06-06-cortex-parameterized-runs-design.md`

**Working directory for all commands:** `apps/cortex` (unless a path says otherwise).

---

## Reference: shapes you will touch (read before starting)

- **UI config type:** `apps/cortex/ui/src/lib/types/agent-config.ts` — `interface AgentConfig` (flat fields incl. `prompt`, `systemPrompt`, `taskContext: Record<string,string>`, `persona`). `defaultConfig()` returns the default.
- **Run launch params (server):** `apps/cortex/server/services/runner-service.ts` — `interface LaunchParams` (has `prompt` + all config string fields). `CortexRunnerServiceLive.start(params)` builds the agent then calls `agent.run(params.prompt, { taskId: runId })`.
- **POST handler:** `apps/cortex/server/api/runs.ts` — Elysia `.post("/")` maps `body` → `runner.start(...)`; `body` schema is the `t.Object({...})` at the end of that route.
- **Gateway (cron) build:** `apps/cortex/server/services/gateway-process-manager.ts` — reads a stored `config` object, extracts `_temperature` etc., calls `buildCortexAgent({...})`; cron task prompt is `config.prompt`.
- **Run body builder (UI):** `apps/cortex/ui/src/lib/cortex-runs-post-body.ts` — `cortexRunsPostBody(prompt, cfg)` returns the JSON body for `POST /api/runs`.
- **Lab launch:** `apps/cortex/ui/src/routes/lab/+page.svelte` — calls `cortexRunsPostBody(builderConfig.prompt.trim(), builderConfig)` to launch.
- **Agent builder panel:** `apps/cortex/ui/src/lib/components/AgentConfigPanel.svelte` — sectioned config editor (where the Variables editor goes).
- **Parity test:** `apps/cortex/server/tests/config-parity.test.ts`.

**Test commands:**
- Server unit: `bun test server/<path>.test.ts`
- UI unit: `bun test ui/src/lib/<path>.test.ts`
- Typecheck: `bun run typecheck`

---

## File Structure

**New files**
- `apps/cortex/server/services/resolve-template.ts` — the single pure resolver + `VariableDef` type (server copy). One responsibility: substitute `{{token}}` in any JSON value.
- `apps/cortex/server/services/resolve-template.test.ts` — resolver unit tests.
- `apps/cortex/server/api/template-resolve.ts` — `POST /api/template/resolve` preview endpoint (thin wrapper over the resolver).
- `apps/cortex/server/api/template-resolve.test.ts` — endpoint test.
- `apps/cortex/ui/src/lib/template/scan-template-vars.ts` — client authoring scanner (auto-seed).
- `apps/cortex/ui/src/lib/template/scan-template-vars.test.ts` — scanner tests.
- `apps/cortex/ui/src/lib/components/ParamFillModal.svelte` — launch fill modal (schema-driven + live preview).
- `apps/cortex/ui/src/lib/components/ParamFillModal.test.ts` — modal validation tests.

**Modified files**
- `apps/cortex/ui/src/lib/types/agent-config.ts` — add `VariableDef` + `variables: VariableDef[]` + default.
- `apps/cortex/server/services/runner-service.ts` — `LaunchParams += variables/variableValues`; resolve at top of `start`.
- `apps/cortex/server/api/runs.ts` — body schema += `variables/variableValues`; thread; unresolved → 400.
- `apps/cortex/server/services/gateway-process-manager.ts` — resolve config from defaults before build.
- `apps/cortex/ui/src/lib/cortex-runs-post-body.ts` — emit `variables/variableValues`.
- `apps/cortex/ui/src/lib/components/AgentConfigPanel.svelte` — Variables editor section.
- `apps/cortex/ui/src/routes/lab/+page.svelte` — open `ParamFillModal` on Run when variables present.
- `apps/cortex/server/tests/config-parity.test.ts` — cover `variables`.

---

## Shared contract (use these EXACT signatures in every task)

```ts
// VariableDef — declared in BOTH ui/src/lib/types/agent-config.ts and
// server/services/resolve-template.ts (parallel copies, parity-tested).
export type VariableType = "string" | "number" | "enum" | "multiline";

export interface VariableDef {
  name: string;                 // matches {{name}}
  type: VariableType;
  description?: string;
  default?: string | number;
  required: boolean;            // author sets; default true in the editor
  enumValues?: string[];        // type === "enum"
  secret?: boolean;             // reserved; Phase 1 → unresolved
}

// Resolver — server only.
export interface ResolveResult<T> {
  value: T;                     // deep copy with {{tokens}} substituted in string leaves
  unresolved: string[];         // deduped token names left unsubstituted
}

export function resolveTemplate<T>(
  input: T,
  variables: readonly VariableDef[],
  values: Readonly<Record<string, string | number>>,
): ResolveResult<T>;

// Token grammar (both scanner + resolver): /\{\{\s*([\w.]+)\s*\}\}/g
```

**Resolution rule per token `t`:**
1. `t` starts with `secret.` → push `t` to `unresolved`, leave literal `{{t}}`.
2. else find `v = variables.find(x => x.name === t)`:
   - `raw = values[t] ?? v?.default`
   - `raw != null` → replace with `String(raw)`.
   - `raw == null` and (`v` undefined **or** `v.required !== false`) → push `t`, leave literal.
   - `raw == null` and `v.required === false` → replace with `""`.

---

### Task 1: `VariableDef` type + `AgentConfig.variables` (UI) + parity

**Files:**
- Modify: `apps/cortex/ui/src/lib/types/agent-config.ts`
- Modify: `apps/cortex/server/tests/config-parity.test.ts`

- [ ] **Step 1: Add the type + field + default**

In `apps/cortex/ui/src/lib/types/agent-config.ts`, above `export interface AgentConfig {`, add:

```ts
export type VariableType = "string" | "number" | "enum" | "multiline";

/** A template variable. `{{name}}` tokens in any string config field resolve against these. */
export interface VariableDef {
  name: string;
  type: VariableType;
  description?: string;
  default?: string | number;
  required: boolean;
  enumValues?: string[];
  /** Reserved for the future secret store; Phase 1 leaves `{{secret.X}}` unresolved. */
  secret?: boolean;
}
```

Inside `interface AgentConfig`, after the `skills` field, add:

```ts
  /** Template variables for parameterized runs. `{{name}}` in any string field resolves against these. */
  variables: VariableDef[];
```

In `defaultConfig()`, after `skills: { paths: [] },` add:

```ts
    variables: [],
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/cortex && bun run typecheck`
Expected: PASS (no new errors).

- [ ] **Step 3: Extend the parity test**

Open `apps/cortex/server/tests/config-parity.test.ts`. Find the existing assertion list of expected `AgentConfig` keys (it enumerates UI config fields). Add `"variables"` to that expected-keys set so the test asserts the field exists. (If the test reads keys off `defaultConfig()` dynamically, no edit is needed — confirm by reading the test; if dynamic, skip this step and note it.)

- [ ] **Step 4: Run parity test**

Run: `cd apps/cortex && bun test server/tests/config-parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/ui/src/lib/types/agent-config.ts apps/cortex/server/tests/config-parity.test.ts
git commit -m "feat(cortex): VariableDef type + AgentConfig.variables field"
```

---

### Task 2: Server pure resolver `resolveTemplate`

**Files:**
- Create: `apps/cortex/server/services/resolve-template.ts`
- Test: `apps/cortex/server/services/resolve-template.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/cortex/server/services/resolve-template.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { resolveTemplate, scanTokens, type VariableDef } from "./resolve-template.js";

const v = (over: Partial<VariableDef> & { name: string }): VariableDef => ({
  type: "string",
  required: true,
  ...over,
});

describe("resolveTemplate", () => {
  test("substitutes a value into a string field", () => {
    const r = resolveTemplate(
      { prompt: "Summarize {{topic}}" },
      [v({ name: "topic" })],
      { topic: "kernels" },
    );
    expect(r.value.prompt).toBe("Summarize kernels");
    expect(r.unresolved).toEqual([]);
  });

  test("falls back to default when no value supplied", () => {
    const r = resolveTemplate(
      { prompt: "Hi {{name}}" },
      [v({ name: "name", default: "world" })],
      {},
    );
    expect(r.value.prompt).toBe("Hi world");
    expect(r.unresolved).toEqual([]);
  });

  test("missing required with no default → unresolved, token left literal", () => {
    const r = resolveTemplate(
      { prompt: "Hi {{name}}" },
      [v({ name: "name" })],
      {},
    );
    expect(r.value.prompt).toBe("Hi {{name}}");
    expect(r.unresolved).toEqual(["name"]);
  });

  test("optional missing → empty string", () => {
    const r = resolveTemplate(
      { prompt: "Hi {{name}}!" },
      [v({ name: "name", required: false })],
      {},
    );
    expect(r.value.prompt).toBe("Hi !");
    expect(r.unresolved).toEqual([]);
  });

  test("unknown token (no VariableDef) → unresolved", () => {
    const r = resolveTemplate({ prompt: "{{ghost}}" }, [], {});
    expect(r.unresolved).toEqual(["ghost"]);
  });

  test("secret namespace → unresolved, left literal", () => {
    const r = resolveTemplate({ prompt: "key={{secret.API}}" }, [], {});
    expect(r.value.prompt).toBe("key={{secret.API}}");
    expect(r.unresolved).toEqual(["secret.API"]);
  });

  test("number value substituted as string", () => {
    const r = resolveTemplate(
      { prompt: "n={{count}}" },
      [v({ name: "count", type: "number" })],
      { count: 7 },
    );
    expect(r.value.prompt).toBe("n=7");
  });

  test("walks nested strings; leaves non-strings untouched; does not mutate input", () => {
    const input = {
      systemPrompt: "You are {{role}}",
      taskContext: { env: "{{env}}" },
      maxTokens: 512,
      nested: { deep: ["{{role}}", 1, true] },
    };
    const r = resolveTemplate(
      input,
      [v({ name: "role" }), v({ name: "env" })],
      { role: "an analyst", env: "prod" },
    );
    expect(r.value.systemPrompt).toBe("You are an analyst");
    expect(r.value.taskContext.env).toBe("prod");
    expect(r.value.maxTokens).toBe(512);
    expect(r.value.nested.deep).toEqual(["an analyst", 1, true]);
    expect(input.systemPrompt).toBe("You are {{role}}"); // unmutated
  });

  test("dedupes repeated unresolved tokens", () => {
    const r = resolveTemplate({ a: "{{x}}", b: "{{x}}" }, [], {});
    expect(r.unresolved).toEqual(["x"]);
  });

  test("whitespace-tolerant tokens", () => {
    const r = resolveTemplate({ p: "{{  topic  }}" }, [v({ name: "topic" })], { topic: "z" });
    expect(r.value.p).toBe("z");
  });
});

describe("scanTokens", () => {
  test("extracts and dedupes var tokens, excludes secret namespace", () => {
    expect(scanTokens("{{a}} {{a}} {{b}} {{secret.K}}")).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/cortex && bun test server/services/resolve-template.test.ts`
Expected: FAIL with "Cannot find module './resolve-template.js'".

- [ ] **Step 3: Implement the resolver**

Create `apps/cortex/server/services/resolve-template.ts`:

```ts
/**
 * Server-authoritative template resolver for Cortex parameterized runs.
 *
 * Pure. Substitutes `{{token}}` in every string leaf of a JSON-ish value from
 * supplied values (falling back to per-variable defaults). The `secret.`
 * namespace is reserved for a future secret store and resolves to "unresolved"
 * in Phase 1. This is the SINGLE resolver — the UI delegates to it via
 * `POST /api/template/resolve`; there is no client twin.
 */

export type VariableType = "string" | "number" | "enum" | "multiline";

export interface VariableDef {
  name: string;
  type: VariableType;
  description?: string;
  default?: string | number;
  required: boolean;
  enumValues?: string[];
  secret?: boolean;
}

export interface ResolveResult<T> {
  value: T;
  unresolved: string[];
}

const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Extract deduped `{{token}}` names from a string, excluding the `secret.` namespace. */
export function scanTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const name = m[1]!;
    if (name.startsWith("secret.")) continue;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

function resolveString(
  text: string,
  byName: Map<string, VariableDef>,
  values: Readonly<Record<string, string | number>>,
  unresolved: Set<string>,
): string {
  return text.replace(TOKEN, (_full, nameRaw: string) => {
    const name = nameRaw;
    if (name.startsWith("secret.")) {
      unresolved.add(name);
      return `{{${name}}}`;
    }
    const def = byName.get(name);
    const raw = values[name] ?? def?.default;
    if (raw != null) return String(raw);
    if (def === undefined || def.required !== false) {
      unresolved.add(name);
      return `{{${name}}}`;
    }
    return "";
  });
}

function walk(
  node: unknown,
  byName: Map<string, VariableDef>,
  values: Readonly<Record<string, string | number>>,
  unresolved: Set<string>,
): unknown {
  if (typeof node === "string") return resolveString(node, byName, values, unresolved);
  if (Array.isArray(node)) return node.map((n) => walk(n, byName, values, unresolved));
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(node as Record<string, unknown>)) {
      out[k] = walk(val, byName, values, unresolved);
    }
    return out;
  }
  return node;
}

export function resolveTemplate<T>(
  input: T,
  variables: readonly VariableDef[],
  values: Readonly<Record<string, string | number>>,
): ResolveResult<T> {
  const byName = new Map(variables.map((v) => [v.name, v]));
  const unresolved = new Set<string>();
  const value = walk(input, byName, values, unresolved) as T;
  return { value, unresolved: [...unresolved] };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/cortex && bun test server/services/resolve-template.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/server/services/resolve-template.ts apps/cortex/server/services/resolve-template.test.ts
git commit -m "feat(cortex): server-authoritative template resolver (resolveTemplate)"
```

---

### Task 3: Client authoring scanner `scanTemplateVars`

**Files:**
- Create: `apps/cortex/ui/src/lib/template/scan-template-vars.ts`
- Test: `apps/cortex/ui/src/lib/template/scan-template-vars.test.ts`

This is the **authoring** scanner — given a config object, return token names to auto-seed `VariableDef`s. (The server resolver is separate; the client does not resolve.)

- [ ] **Step 1: Write the failing test**

Create `apps/cortex/ui/src/lib/template/scan-template-vars.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { scanTemplateVars } from "./scan-template-vars.js";

describe("scanTemplateVars", () => {
  test("collects tokens from all string fields, deduped", () => {
    const cfg = {
      prompt: "Summarize {{topic}} for {{audience}}",
      systemPrompt: "Tone for {{audience}}",
      taskContext: { env: "{{env}}" },
      maxTokens: 512,
    };
    expect(scanTemplateVars(cfg).sort()).toEqual(["audience", "env", "topic"]);
  });

  test("excludes the secret namespace", () => {
    expect(scanTemplateVars({ prompt: "{{a}} {{secret.K}}" })).toEqual(["a"]);
  });

  test("whitespace tolerant", () => {
    expect(scanTemplateVars({ p: "{{  x  }}" })).toEqual(["x"]);
  });

  test("no tokens → empty", () => {
    expect(scanTemplateVars({ prompt: "plain" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/cortex && bun test ui/src/lib/template/scan-template-vars.test.ts`
Expected: FAIL with "Cannot find module './scan-template-vars.js'".

- [ ] **Step 3: Implement**

Create `apps/cortex/ui/src/lib/template/scan-template-vars.ts`:

```ts
/** Authoring scanner: extract `{{token}}` names from every string field of a config object. */

const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

export function scanTemplateVars(config: unknown): string[] {
  const out: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      for (const m of node.matchAll(TOKEN)) {
        const name = m[1]!;
        if (name.startsWith("secret.")) continue;
        if (!out.includes(name)) out.push(name);
      }
    } else if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node !== null && typeof node === "object") {
      Object.values(node as Record<string, unknown>).forEach(visit);
    }
  };
  visit(config);
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/cortex && bun test ui/src/lib/template/scan-template-vars.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/ui/src/lib/template/scan-template-vars.ts apps/cortex/ui/src/lib/template/scan-template-vars.test.ts
git commit -m "feat(cortex): client authoring scanner scanTemplateVars"
```

---

### Task 4: Preview endpoint `POST /api/template/resolve`

**Files:**
- Create: `apps/cortex/server/api/template-resolve.ts`
- Test: `apps/cortex/server/api/template-resolve.test.ts`
- Modify: wherever routers are mounted (find with grep in Step 5).

- [ ] **Step 1: Write the failing test**

Create `apps/cortex/server/api/template-resolve.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { templateResolveRouter } from "./template-resolve.js";

async function post(body: unknown) {
  const app = templateResolveRouter();
  return app.handle(
    new Request("http://localhost/api/template/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/template/resolve", () => {
  test("returns resolved payload + empty unresolved", async () => {
    const res = await post({
      payload: { prompt: "Hi {{name}}" },
      variables: [{ name: "name", type: "string", required: true }],
      values: { name: "Ada" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { resolved: { prompt: string }; unresolved: string[] };
    expect(json.resolved.prompt).toBe("Hi Ada");
    expect(json.unresolved).toEqual([]);
  });

  test("reports unresolved required", async () => {
    const res = await post({
      payload: { prompt: "Hi {{name}}" },
      variables: [{ name: "name", type: "string", required: true }],
      values: {},
    });
    const json = (await res.json()) as { unresolved: string[] };
    expect(json.unresolved).toEqual(["name"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/cortex && bun test server/api/template-resolve.test.ts`
Expected: FAIL with "Cannot find module './template-resolve.js'".

- [ ] **Step 3: Implement the router**

Create `apps/cortex/server/api/template-resolve.ts`:

```ts
import { Elysia, t } from "elysia";
import { resolveTemplate, type VariableDef } from "../services/resolve-template.js";

/** Live-preview endpoint: the UI delegates to the one server resolver. */
export const templateResolveRouter = () =>
  new Elysia({ prefix: "/api/template" }).post(
    "/resolve",
    ({ body }) => {
      const b = body as {
        payload: unknown;
        variables?: VariableDef[];
        values?: Record<string, string | number>;
      };
      const { value, unresolved } = resolveTemplate(
        b.payload,
        b.variables ?? [],
        b.values ?? {},
      );
      return { resolved: value, unresolved };
    },
    {
      body: t.Object({
        payload: t.Unknown(),
        variables: t.Optional(t.Array(t.Unknown())),
        values: t.Optional(t.Record(t.String(), t.Union([t.String(), t.Number()]))),
      }),
    },
  );
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/cortex && bun test server/api/template-resolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Mount the router**

Find where existing routers are mounted: `cd apps/cortex && rg -n "runsRouter\(" server/`. In that file (e.g. `server/index.ts`), import and `.use(templateResolveRouter())` alongside the other `.use(...)` calls:

```ts
import { templateResolveRouter } from "./api/template-resolve.js";
// ... in the app composition:
  .use(templateResolveRouter())
```

- [ ] **Step 6: Typecheck**

Run: `cd apps/cortex && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/cortex/server/api/template-resolve.ts apps/cortex/server/api/template-resolve.test.ts apps/cortex/server/index.ts
git commit -m "feat(cortex): POST /api/template/resolve preview endpoint"
```

---

### Task 5: Resolve in the runner (`start`)

**Files:**
- Modify: `apps/cortex/server/services/runner-service.ts`
- Test: `apps/cortex/server/services/resolve-template.test.ts` (add a `resolveLaunchParams`-shape case) — OR a new `runner-resolve.test.ts`. We test the helper, not the full Effect service.

Add a tiny typed wrapper so the runner stays clean and is unit-testable without the Effect runtime.

- [ ] **Step 1: Write the failing test**

Append to `apps/cortex/server/services/resolve-template.test.ts`:

```ts
import { resolveLaunchPayload } from "./resolve-template.js";

describe("resolveLaunchPayload", () => {
  test("resolves prompt + string fields, returns unresolved", () => {
    const r = resolveLaunchPayload(
      {
        prompt: "Do {{task}}",
        systemPrompt: "You are {{role}}",
        variables: [
          { name: "task", type: "string", required: true },
          { name: "role", type: "string", required: true, default: "helper" },
        ],
        variableValues: { task: "research" },
      },
    );
    expect(r.value.prompt).toBe("Do research");
    expect(r.value.systemPrompt).toBe("You are helper");
    expect(r.unresolved).toEqual([]);
  });

  test("strips variables/variableValues from the resolved output", () => {
    const r = resolveLaunchPayload({
      prompt: "{{x}}",
      variables: [{ name: "x", type: "string", required: true }],
      variableValues: { x: "ok" },
    });
    expect("variables" in r.value).toBe(false);
    expect("variableValues" in r.value).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/cortex && bun test server/services/resolve-template.test.ts`
Expected: FAIL with "resolveLaunchPayload is not a function" / not exported.

- [ ] **Step 3: Implement `resolveLaunchPayload`**

Append to `apps/cortex/server/services/resolve-template.ts`:

```ts
/**
 * Resolve a Cortex launch payload: pull `variables`/`variableValues` out, resolve
 * `{{tokens}}` in everything else from the values (defaults applied), and return
 * the cleaned payload (no variables/variableValues keys) + unresolved tokens.
 */
export function resolveLaunchPayload<
  T extends {
    variables?: VariableDef[];
    variableValues?: Record<string, string | number>;
  },
>(payload: T): ResolveResult<Omit<T, "variables" | "variableValues">> {
  const { variables, variableValues, ...rest } = payload;
  return resolveTemplate(
    rest as Omit<T, "variables" | "variableValues">,
    variables ?? [],
    variableValues ?? {},
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/cortex && bun test server/services/resolve-template.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `start`**

In `apps/cortex/server/services/runner-service.ts`:

(a) Extend `LaunchParams` — after the `skills` field, add:

```ts
  readonly variables?: import("./resolve-template.js").VariableDef[];
  readonly variableValues?: Record<string, string | number>;
```

(b) Add the import at the top (with the other service imports):

```ts
import { resolveLaunchPayload } from "./resolve-template.js";
```

(c) Rename the `start` arg and resolve first. Change:

```ts
      start: (params) =>
        Effect.gen(function* () {
          const providerRaw = params.provider ?? process.env.CORTEX_RUNNER_PROVIDER ?? "test";
```

to:

```ts
      start: (rawParams) =>
        Effect.gen(function* () {
          const { value: params, unresolved } = resolveLaunchPayload(rawParams);
          if (unresolved.length > 0) {
            return yield* Effect.fail(
              new CortexError({
                message: `Unresolved template variable(s): ${unresolved.join(", ")}`,
              }),
            );
          }
          const providerRaw = params.provider ?? process.env.CORTEX_RUNNER_PROVIDER ?? "test";
```

The rest of the method body already uses `params.*` and now operates on the resolved copy unchanged. (`params.prompt` at the `agent.run` call is now the resolved prompt.)

- [ ] **Step 6: Typecheck**

Run: `cd apps/cortex && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/cortex/server/services/resolve-template.ts apps/cortex/server/services/resolve-template.test.ts apps/cortex/server/services/runner-service.ts
git commit -m "feat(cortex): resolve template variables in runner.start before build"
```

---

### Task 6: Thread variables through `POST /api/runs` (400 on unresolved)

**Files:**
- Modify: `apps/cortex/server/api/runs.ts`

The runner already fails on unresolved (Task 5), which the route maps to 500. Map it to **400** and pass the new fields through.

- [ ] **Step 1: Add the body fields**

In `apps/cortex/server/api/runs.ts`, inside the `t.Object({ ... })` body schema for `.post("/")`, add (next to `skills`):

```ts
          variables: t.Optional(t.Array(t.Unknown())),
          variableValues: t.Optional(t.Record(t.String(), t.Union([t.String(), t.Number()]))),
```

- [ ] **Step 2: Thread into `runner.start`**

In the `runner.start({ ... })` object, add (next to the `skills` spread):

```ts
            ...(Array.isArray(b.variables) && b.variables.length ? { variables: b.variables } : {}),
            ...(b.variableValues && typeof b.variableValues === "object" && !Array.isArray(b.variableValues)
              ? { variableValues: b.variableValues as Record<string, string | number> }
              : {}),
```

- [ ] **Step 3: Map unresolved to 400**

In the `.post("/")` `catch` block, change:

```ts
        } catch (e) {
          set.status = 500;
          return { error: e instanceof Error ? e.message : String(e) };
        }
```

to:

```ts
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          set.status = msg.startsWith("Unresolved template variable") ? 400 : 500;
          return { error: msg };
        }
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/cortex && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/server/api/runs.ts
git commit -m "feat(cortex): thread variables/variableValues through POST /api/runs (400 on unresolved)"
```

---

### Task 7: Gateway (cron) resolve-from-defaults

**Files:**
- Modify: `apps/cortex/server/services/gateway-process-manager.ts`

Cron runs have no modal → resolve from variable **defaults** before building; fail the run if a required variable has no default.

- [ ] **Step 1: Locate the seam**

In `gateway-process-manager.ts`, find where the stored `config` object is read just before the field-extraction block (the `const _temperature = ...` lines) and the eventual `agent.run(...)`. Confirm the cron task prompt is `config.prompt`.

- [ ] **Step 2: Resolve the config up front**

Immediately after `config` is obtained (and before the `_temperature`/`_systemPrompt`/etc. extraction), insert:

```ts
import { resolveTemplate, type VariableDef } from "./resolve-template.js"; // add at top with other imports

// ... where `config` is available:
const _vars = Array.isArray((config as { variables?: VariableDef[] }).variables)
  ? ((config as { variables?: VariableDef[] }).variables as VariableDef[])
  : [];
const _resolved = resolveTemplate(config, _vars, {}); // cron uses defaults only
if (_resolved.unresolved.length > 0) {
  // Fail this scheduled run with a clear message; do not build with literal tokens.
  throw new Error(`Unresolved template variable(s): ${_resolved.unresolved.join(", ")}`);
}
config = _resolved.value;
```

If `config` is declared `const`, change its declaration to `let` so the reassignment compiles. If the surrounding code is not in a try/catch that records `error_message`, wrap the build+run so the thrown error is written to `cortex_runs.error_message` the same way other gateway failures are recorded (follow the existing failure-recording pattern in this file).

- [ ] **Step 3: Typecheck**

Run: `cd apps/cortex && bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Run gateway tests**

Run: `cd apps/cortex && bun test server/tests/gateway-process-manager.test.ts`
Expected: PASS (no regressions; existing configs have no `variables` → no-op resolve).

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/server/services/gateway-process-manager.ts
git commit -m "feat(cortex): gateway cron runs resolve template vars from defaults"
```

---

### Task 8: UI run-body emits variables/variableValues

**Files:**
- Modify: `apps/cortex/ui/src/lib/cortex-runs-post-body.ts`
- Test: `apps/cortex/ui/src/lib/cortex-runs-post-body.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/cortex/ui/src/lib/cortex-runs-post-body.test.ts` (import `defaultConfig` if not already):

```ts
test("emits variables + variableValues when present", () => {
  const cfg = { ...defaultConfig(), prompt: "Do {{task}}", variables: [
    { name: "task", type: "string" as const, required: true },
  ] };
  const body = cortexRunsPostBody("Do {{task}}", cfg, { task: "research" });
  expect(body.variables).toEqual(cfg.variables);
  expect(body.variableValues).toEqual({ task: "research" });
});

test("omits variable fields when no variables", () => {
  const body = cortexRunsPostBody("hi", defaultConfig());
  expect("variables" in body).toBe(false);
  expect("variableValues" in body).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/cortex && bun test ui/src/lib/cortex-runs-post-body.test.ts`
Expected: FAIL (signature has no 3rd arg / fields absent).

- [ ] **Step 3: Implement**

In `apps/cortex/ui/src/lib/cortex-runs-post-body.ts`, change the signature and append the fields. Update:

```ts
export function cortexRunsPostBody(prompt: string, cfg: AgentConfig): Record<string, unknown> {
```

to:

```ts
export function cortexRunsPostBody(
  prompt: string,
  cfg: AgentConfig,
  variableValues?: Record<string, string | number>,
): Record<string, unknown> {
```

At the end of the returned object (before the closing `}` of the `return { ... }`), add:

```ts
    ...(cfg.variables?.length ? { variables: cfg.variables } : {}),
    ...(cfg.variables?.length && variableValues && Object.keys(variableValues).length
      ? { variableValues }
      : {}),
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/cortex && bun test ui/src/lib/cortex-runs-post-body.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/ui/src/lib/cortex-runs-post-body.ts apps/cortex/ui/src/lib/cortex-runs-post-body.test.ts
git commit -m "feat(cortex): run body emits variables + variableValues"
```

---

### Task 9: `ParamFillModal` component (schema-driven + live preview)

**Files:**
- Create: `apps/cortex/ui/src/lib/components/ParamFillModal.svelte`
- Create: `apps/cortex/ui/src/lib/components/param-fill-validate.ts` (pure validation, unit-testable)
- Test: `apps/cortex/ui/src/lib/components/param-fill-validate.test.ts`

Split the validation into a pure module so it is testable without a DOM. The Svelte file is thin UI over it.

- [ ] **Step 1: Write the failing validation test**

Create `apps/cortex/ui/src/lib/components/param-fill-validate.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { validateParamValues, initialValues } from "./param-fill-validate.js";
import type { VariableDef } from "../types/agent-config.js";

const v = (o: Partial<VariableDef> & { name: string }): VariableDef => ({ type: "string", required: true, ...o });

describe("initialValues", () => {
  test("prefills from defaults", () => {
    expect(initialValues([v({ name: "a", default: "x" }), v({ name: "b" })])).toEqual({ a: "x", b: "" });
  });
});

describe("validateParamValues", () => {
  test("flags missing required", () => {
    expect(validateParamValues([v({ name: "a" })], { a: "" })).toEqual({ a: "Required" });
  });
  test("passes when required filled", () => {
    expect(validateParamValues([v({ name: "a" })], { a: "ok" })).toEqual({});
  });
  test("rejects non-numeric number field", () => {
    expect(validateParamValues([v({ name: "n", type: "number" })], { n: "abc" })).toEqual({ n: "Must be a number" });
  });
  test("rejects enum value not in list", () => {
    expect(validateParamValues([v({ name: "e", type: "enum", enumValues: ["a", "b"] })], { e: "c" })).toEqual({
      e: "Must be one of: a, b",
    });
  });
  test("optional empty is allowed", () => {
    expect(validateParamValues([v({ name: "a", required: false })], { a: "" })).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/cortex && bun test ui/src/lib/components/param-fill-validate.test.ts`
Expected: FAIL with "Cannot find module './param-fill-validate.js'".

- [ ] **Step 3: Implement the validation module**

Create `apps/cortex/ui/src/lib/components/param-fill-validate.ts`:

```ts
import type { VariableDef } from "../types/agent-config.js";

export type ParamValues = Record<string, string>;
export type ParamErrors = Record<string, string>;

export function initialValues(vars: readonly VariableDef[]): ParamValues {
  const out: ParamValues = {};
  for (const v of vars) out[v.name] = v.default != null ? String(v.default) : "";
  return out;
}

export function validateParamValues(
  vars: readonly VariableDef[],
  values: ParamValues,
): ParamErrors {
  const errors: ParamErrors = {};
  for (const v of vars) {
    const raw = values[v.name] ?? "";
    if (raw.trim() === "") {
      if (v.required !== false) errors[v.name] = "Required";
      continue;
    }
    if (v.type === "number" && Number.isNaN(Number(raw))) {
      errors[v.name] = "Must be a number";
    } else if (v.type === "enum" && v.enumValues && !v.enumValues.includes(raw)) {
      errors[v.name] = `Must be one of: ${v.enumValues.join(", ")}`;
    }
  }
  return errors;
}

/** Coerce string inputs to the typed values the run body expects. */
export function toVariableValues(
  vars: readonly VariableDef[],
  values: ParamValues,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const v of vars) {
    const raw = values[v.name] ?? "";
    if (raw.trim() === "" && v.required === false) continue;
    out[v.name] = v.type === "number" ? Number(raw) : raw;
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/cortex && bun test ui/src/lib/components/param-fill-validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the Svelte modal**

Create `apps/cortex/ui/src/lib/components/ParamFillModal.svelte`. It renders one field per `VariableDef`, validates on submit via the pure module, debounces a preview call to `POST /api/template/resolve`, and emits `variableValues` on confirm. Match the existing modal styling in the repo (find a sibling modal, e.g. `rg -l "role=\"dialog\"\|class=\"modal" ui/src/lib/components` and mirror its shell markup/classes).

```svelte
<script lang="ts">
  import type { VariableDef } from "../types/agent-config.js";
  import { CORTEX_SERVER_URL } from "../constants.js";
  import {
    initialValues,
    validateParamValues,
    toVariableValues,
    type ParamValues,
    type ParamErrors,
  } from "./param-fill-validate.js";

  interface Props {
    open: boolean;
    variables: VariableDef[];
    /** The unresolved config payload (e.g. { prompt, systemPrompt, taskContext }) for preview. */
    previewPayload: Record<string, unknown>;
    onConfirm: (values: Record<string, string | number>) => void;
    onCancel: () => void;
  }
  let { open, variables, previewPayload, onConfirm, onCancel }: Props = $props();

  let values: ParamValues = $state(initialValues(variables));
  let errors: ParamErrors = $state({});
  let preview = $state<string>("");
  let previewUnresolved = $state<string[]>([]);
  let previewTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    // Re-seed when the variable set changes (e.g. reopened for a different agent).
    values = initialValues(variables);
  });

  function schedulePreview() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, 250);
  }

  async function refreshPreview() {
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/template/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payload: previewPayload,
          variables,
          values: toVariableValues(variables, values),
        }),
      });
      if (!res.ok) return;
      const json = (await res.json()) as { resolved: Record<string, unknown>; unresolved: string[] };
      preview = typeof json.resolved.prompt === "string" ? json.resolved.prompt : JSON.stringify(json.resolved, null, 2);
      previewUnresolved = json.unresolved;
    } catch {
      /* preview is best-effort */
    }
  }

  function submit() {
    errors = validateParamValues(variables, values);
    if (Object.keys(errors).length > 0) return;
    onConfirm(toVariableValues(variables, values));
  }
</script>

{#if open}
  <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Fill run variables">
    <div class="modal-card">
      <h2>Fill run variables</h2>
      {#each variables as v (v.name)}
        <label>
          <span>{v.name}{v.required !== false ? " *" : ""}</span>
          {#if v.description}<small>{v.description}</small>{/if}
          {#if v.type === "enum" && v.enumValues}
            <select bind:value={values[v.name]} onchange={schedulePreview}>
              {#each v.enumValues as opt}<option value={opt}>{opt}</option>{/each}
            </select>
          {:else if v.type === "multiline"}
            <textarea bind:value={values[v.name]} oninput={schedulePreview}></textarea>
          {:else}
            <input
              type={v.type === "number" ? "number" : "text"}
              bind:value={values[v.name]}
              oninput={schedulePreview}
            />
          {/if}
          {#if errors[v.name]}<span class="err">{errors[v.name]}</span>{/if}
        </label>
      {/each}

      {#if preview}
        <div class="preview">
          <strong>Preview</strong>
          <pre>{preview}</pre>
          {#if previewUnresolved.length}
            <span class="err">Unresolved: {previewUnresolved.join(", ")}</span>
          {/if}
        </div>
      {/if}

      <div class="actions">
        <button onclick={onCancel}>Cancel</button>
        <button onclick={submit}>Run</button>
      </div>
    </div>
  </div>
{/if}
```

(Style classes: reuse the project's modal classes; the names above are placeholders to be matched to a sibling modal's CSS during implementation. Functionality, not styling, is the spec contract.)

- [ ] **Step 6: Typecheck**

Run: `cd apps/cortex && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/cortex/ui/src/lib/components/ParamFillModal.svelte apps/cortex/ui/src/lib/components/param-fill-validate.ts apps/cortex/ui/src/lib/components/param-fill-validate.test.ts
git commit -m "feat(cortex): ParamFillModal (schema-driven fill + live preview)"
```

---

### Task 10: Variables editor in `AgentConfigPanel`

**Files:**
- Modify: `apps/cortex/ui/src/lib/components/AgentConfigPanel.svelte`

Add a "Variables" section that auto-seeds from `{{...}}` and lets the author enrich each var.

- [ ] **Step 1: Add a rescan + seed helper to the script block**

In `AgentConfigPanel.svelte` `<script>`, import the scanner and add a seed function:

```ts
import { scanTemplateVars } from "../template/scan-template-vars.js";
import type { VariableDef } from "../types/agent-config.js";

function rescanVariables() {
  const found = scanTemplateVars(config);
  const existing = new Map((config.variables ?? []).map((v) => [v.name, v]));
  config.variables = found.map(
    (name) => existing.get(name) ?? { name, type: "string", required: true },
  );
}
```

(`config` is the panel's bound config object — match the actual prop/state name used in the file.)

- [ ] **Step 2: Add the Variables section markup**

Add a new section (mirror the markup/classes of an existing section like the Inference/`numCtx` section you added earlier). For each `config.variables` entry, render: name (read-only), `type` select (`string`/`number`/`enum`/`multiline`), `default` input, `required` checkbox, `enumValues` (comma-separated, shown when `type === "enum"`), `description` input. Add a "Rescan template" button calling `rescanVariables()`:

```svelte
<section class="config-section">
  <header>
    <h3>Variables</h3>
    <button type="button" onclick={rescanVariables}>Rescan template</button>
  </header>
  {#if (config.variables ?? []).length === 0}
    <p class="hint">Use <code>{{ '{{name}}' }}</code> in any field, then Rescan.</p>
  {/if}
  {#each config.variables ?? [] as v (v.name)}
    <div class="var-row">
      <span class="var-name">{v.name}</span>
      <select bind:value={v.type}>
        <option value="string">string</option>
        <option value="number">number</option>
        <option value="enum">enum</option>
        <option value="multiline">multiline</option>
      </select>
      <input placeholder="default" bind:value={v.default} />
      <label><input type="checkbox" bind:checked={v.required} /> required</label>
      {#if v.type === "enum"}
        <input
          placeholder="comma,separated,values"
          value={(v.enumValues ?? []).join(",")}
          oninput={(e) => (v.enumValues = (e.currentTarget as HTMLInputElement).value.split(",").map((s) => s.trim()).filter(Boolean))}
        />
      {/if}
      <input placeholder="description" bind:value={v.description} />
    </div>
  {/each}
</section>
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/cortex && bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/cortex/ui/src/lib/components/AgentConfigPanel.svelte
git commit -m "feat(cortex): Variables editor (auto-seed + enrich) in AgentConfigPanel"
```

---

### Task 11: Wire the modal into Lab launch

**Files:**
- Modify: `apps/cortex/ui/src/routes/lab/+page.svelte`

On "▶ Run", if `builderConfig.variables.length > 0`, open `ParamFillModal`; otherwise launch as today. On confirm, pass `variableValues` into `cortexRunsPostBody`.

- [ ] **Step 1: Import + state**

In the Lab `<script>`:

```ts
import ParamFillModal from "$lib/components/ParamFillModal.svelte";

let showParamModal = $state(false);
```

- [ ] **Step 2: Gate the launch**

Find the existing run-launch handler that calls `cortexRunsPostBody(builderConfig.prompt.trim(), builderConfig)`. Extract the actual fetch into a function that accepts optional values:

```ts
async function launchRun(variableValues?: Record<string, string | number>) {
  const body = cortexRunsPostBody(builderConfig.prompt.trim(), builderConfig, variableValues);
  // ... existing fetch(`${CORTEX_SERVER_URL}/api/runs`, { method: "POST", body: JSON.stringify(body) }) ...
}

function onRunClick() {
  if ((builderConfig.variables ?? []).length > 0) {
    showParamModal = true;
  } else {
    void launchRun();
  }
}
```

Point the existing Run button's handler at `onRunClick`.

- [ ] **Step 3: Render the modal**

Near the end of the template:

```svelte
<ParamFillModal
  open={showParamModal}
  variables={builderConfig.variables ?? []}
  previewPayload={{
    prompt: builderConfig.prompt,
    systemPrompt: builderConfig.systemPrompt,
    taskContext: builderConfig.taskContext,
  }}
  onConfirm={(values) => { showParamModal = false; void launchRun(values); }}
  onCancel={() => (showParamModal = false)}
/>
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/cortex && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Manual smoke (record result)**

Start the full UI dev stack: `cd apps/cortex && bun run start`. In the Lab: put `{{topic}}` in the Prompt, click **Rescan template** (var appears), click **▶ Run** → modal opens → fill `topic` → preview shows substituted prompt → Run → confirm the run's prompt is resolved (no `{{topic}}`). Note the result in the commit message or PR.

- [ ] **Step 6: Commit**

```bash
git add apps/cortex/ui/src/routes/lab/+page.svelte
git commit -m "feat(cortex): open ParamFillModal on Lab run when template has variables"
```

---

### Task 12: Full verification

- [ ] **Step 1: Run the Cortex test suite**

Run: `cd apps/cortex && bun test`
Expected: PASS (no regressions; new resolver/scanner/validate/endpoint/body tests green).

- [ ] **Step 2: Typecheck**

Run: `cd apps/cortex && bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Update the audit + memory pointers**

- In `wiki/Research/2026-06-06-cortex-agent-building-audit.md`, note parameterized-runs Phase 1 shipped (if relevant).
- Update `.agents/MEMORY.md` Cortex overhaul entry: Track B parameterized-runs Phase 1 shipped; sweep (Phase 2) + secret store remain.

- [ ] **Step 4: Commit**

```bash
git add wiki/ .agents/MEMORY.md
git commit -m "docs(cortex): parameterized-runs Phase 1 shipped; sweep + secret store pending"
```

---

## Notes for the implementer

- **No framework changes.** Everything is in `apps/cortex`. If you find yourself editing `packages/**`, stop — the design forbids it.
- **`secret.` namespace is reserved, not implemented.** `{{secret.X}}` must end up in `unresolved` with the clear message — never silently blank.
- **One resolver.** Server `resolveTemplate` is the only substitution logic. The client never re-implements it (preview goes through `/api/template/resolve`). The client scanner (`scanTemplateVars`) is *authoring-only* and does not resolve.
- **Svelte 5 runes** (`$state`/`$props`/`$effect`) — match the version already used in the repo's components; if the repo uses Svelte 4 stores in these files, mirror that instead.
- **Styling** is not the contract — reuse existing modal/section classes; match a sibling component.
```
