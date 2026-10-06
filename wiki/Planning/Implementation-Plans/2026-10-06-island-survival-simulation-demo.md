---
type: implementation-plan
status: active
created: 2026-10-06
completed: null
authored-by: OpenCode
related:
  - "[[../../Architecture/Design-Specs/2026-10-06-island-survival-simulation-demo-design|Island Survival Simulation Demo design spec]]"
  - "[[2026-10-05-systemone-decision-backends|System One Decision Backends plan]]"
---

# Island Survival Simulation Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a watchable, offline-first multi-agent island-survival simulation demo where one LLM call generates the world, `agent.judge()` picks each agent's action per tick, and a pure deterministic engine owns and renders the state.

**Architecture:** A pure simulation engine (`(WorldState, Decision[]) -> (WorldState, SimEvent[])`) with a seeded PRNG and explicit partial-observability perception. LLM behavior sits behind two interfaces, `WorldGenerator` and `DecisionMaker`, whose live implementations use `.withOutputSchema()` and `.withJudgment()` and whose scripted implementations make the demo run with no model. A single `Bun.serve` page renders SVG island, event timeline, and subjective-state inspector.

**Tech Stack:** TypeScript (strict), Bun, Effect Schema (`effect`), `reactive-agents` facade, Bun.serve, node: built-ins.

**Spec:** `wiki/Architecture/Design-Specs/2026-10-06-island-survival-simulation-demo-design.md`

## Global Constraints

Every task inherits these. Values are copied from the spec.

- Runtime: Bun >= 1.1.0. Use `node:` built-ins and `globalThis`, no new Bun-specific APIs in new code.
- Types: Effect Schema for all decoded data; no `any`, no `as any`, no `@ts-ignore`. No raw `throw` in engine code; invalid operations return a result with a reason.
- Naming: kebab-case filenames, PascalCase types, camelCase functions. JSDoc on every public export.
- No em dashes (U+2014) in any file. Use hyphens, colons, parentheses.
- No AI co-author trailers in commits. One concern per commit. Work lands on `dev`.
- MVP: 8 agents, ~12x12 island, ~10 resource nodes, exactly 12 action types, 1 tick = 1 in-world hour, 24 ticks = 1 day.
- No new npm dependencies. `apps/examples` already depends on `effect`, `reactive-agents`, and the workspace packages.
- Viewer-safe projection: `WorldState.hidden` must never reach the browser or any perception.
- Degrade, never fail: any judgment/LLM error falls back to `ScriptedDecisionMaker`; an exhausted world generator falls back to `makeFallbackWorld`.
- Tests: `bun test <path> --timeout 15000`. No network, no servers left running. Inject fakes; use the `test` provider for provider paths.
- All files live under `apps/examples/src/demos/island-sim/`.

## Review Focus

Inputs and conditions the spec implies that are most likely to bite a user. Each is pinned to the owning task's tests.

1. **No API key, or the judgment backend is unreachable.** New Simulation must still produce a playable world and every tick must still act. Owning tests: Task 1 (fallback world), Task 9 (judgment degrade), Task 11 (offline controller).
2. **Malformed or out-of-range world JSON from the model.** Must be rejected and regenerated, then fall back; never start with a half-valid world. Owning test: Task 10.
3. **Hidden facts leaking.** They must not appear in any perception or any browser payload. Owning tests: Task 5 (perception canary), Task 11 (viewer projection).
4. **Replay drift.** The same cassette must reproduce identical events; the engine RNG must be seeded and consumed deterministically, and parallel decisions must not consume it. Owning tests: Task 2 (RNG), Task 8 (replay identity).
5. **An invalid action (move into ocean, gather an absent resource, eat nothing).** Must fail with an `action-failed` event and leave state consistent, never throw or corrupt. Owning tests: Task 3.
6. **A judgment answer with an unexpected choice value or low confidence.** Must map to a safe action or degrade, never emit a `Decision` outside the action vocabulary. Owning test: Task 9.

---

## File Structure

```
apps/examples/src/demos/island-sim/
  world/schema.ts        Effect Schemas + types + parseWorld
  world/fallback.ts      makeFallbackWorld(seed)
  world/generator.ts     makeLlmWorldGenerator, makeScriptedWorldGenerator
  engine/rng.ts          makeRng(seed)
  engine/events.ts       SimEvent union
  engine/actions.ts      ACTION_TYPES, applyAction
  engine/needs.ts        decayNeeds, applyWeather
  engine/social.ts       applyTrust
  engine/resources.ts    regrowResources
  engine/perceive.ts     perceive, renderPerception
  engine/tick.ts         runTick
  engine/cassette.ts     RunCassette, recorder, makeReplayDecisionMaker, replayRun
  decision/types.ts      Decision, DecisionMaker, ScriptedDecisionMaker
  decision/judgment.ts   makeJudgmentDecisionMaker, templateNarrative
  ui/page.ts             renderPage()
  index.ts               SimController + createServer + main
```

Each file has one responsibility. Tests are colocated as `<name>.test.ts`.

---

### Task 1: World schema and fallback world

**Files:**
- Create: `apps/examples/src/demos/island-sim/world/schema.ts`
- Create: `apps/examples/src/demos/island-sim/world/fallback.ts`
- Test: `apps/examples/src/demos/island-sim/world/schema.test.ts`

**Interfaces:**
- Produces:
  - `ActionType` (union of the 12 literals), `ActionRequest = { type: ActionType; target?: string }`
  - `Needs = { hunger: number; thirst: number; energy: number }`
  - `AgentState`, `ResourceNode`, `Structure`, `TerrainTile`, `Weather`, `HiddenFacts`, `WorldState`
  - `WorldStateSchema`
  - `parseWorld(input: unknown): WorldState | undefined` (returns `undefined` on decode failure; never throws)
  - `fallsBack`: `makeFallbackWorld(seed: number): WorldState`

- [ ] **Step 1: Write the failing tests**

```ts
// world/schema.test.ts
import { describe, it, expect } from "bun:test";
import { WorldStateSchema, parseWorld, type WorldState } from "./schema.js";
import { makeFallbackWorld } from "./fallback.js";

describe("world schema", () => {
  it("fallback world is schema-valid with 8 agents and a hidden fact", () => {
    const w = makeFallbackWorld(42);
    expect(parseWorld(w)).toBeDefined();
    expect(w.agents).toHaveLength(8);
    expect(w.hidden.secrets.length).toBeGreaterThan(0);
    expect(w.seed).toBe(42);
    expect(w.clock).toEqual({ tick: 0, day: 1, hour: 0 });
  });
  it("rejects a world missing required fields", () => {
    expect(parseWorld({ id: "x" })).toBeUndefined();
  });
  it("rejects an agent with a negative need", () => {
    const w = makeFallbackWorld(1);
    const bad = { ...w, agents: [{ ...w.agents[0], needs: { hunger: -1, thirst: 5, energy: 5 } }] };
    expect(parseWorld(bad)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/examples/src/demos/island-sim/world/schema.test.ts --timeout 15000`
Expected: FAIL, cannot resolve `./schema.js`.

- [ ] **Step 3: Implement `world/schema.ts`**

Define all schemas with `Schema.Struct`. `Needs` and need fields use `Schema.Number.pipe(Schema.greaterThanOrEqualTo(0), Schema.lessThanOrEqualTo(10))`. `ActionType` is `Schema.Literal("move","gather","hunt","build","craft","eat","drink","rest","trade","share","talk","inspect")`. Export inferred `type`s. `parseWorld` uses `Schema.decodeUnknownOption(WorldStateSchema)` and returns `Option.getOrUndefined`. Include `island: { width, height }`, `terrain: TerrainTile[]` where `TerrainTile = { tile: string; biome: Biome; elevation: number }` and `Biome` is a `Schema.Literal` of `"ocean" | "beach" | "forest" | "grass" | "rock" | "freshwater"`, `weather: { condition: WeatherCondition; tempC: number }`, `resources`, `structures`, `agents`, and `hidden: { secrets: string[] }`.

- [ ] **Step 4: Implement `world/fallback.ts`**

`makeFallbackWorld(seed)` returns a hand-authored 12x12 island: beach ring, forest/grass interior, one freshwater stream; ~10 resource nodes (berries, fish, wood, stone, water); 8 named agents with distinct traits, needs, skills, locations `"A1"`-style tile ids, and at least two relationships seeded; one structure (a lean-to); `hidden.secrets = ["the northern spring is poisoned", "a cache is buried at D4"]`; and a `rng`-free deterministic layout so the same seed yields the same world.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test apps/examples/src/demos/island-sim/world/schema.test.ts --timeout 15000`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/examples/src/demos/island-sim/world/schema.ts apps/examples/src/demos/island-sim/world/fallback.ts apps/examples/src/demos/island-sim/world/schema.test.ts
git commit -m "feat(island-sim): world schema and deterministic fallback world"
```

---

### Task 2: Seeded deterministic RNG

**Files:**
- Create: `apps/examples/src/demos/island-sim/engine/rng.ts`
- Test: `apps/examples/src/demos/island-sim/engine/rng.test.ts`

**Interfaces:**
- Produces: `Rng = { next(): number; int(min: number, max: number): number; pick<T>(xs: readonly T[]): T }`; `makeRng(seed: number): Rng` (mulberry32).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "bun:test";
import { makeRng } from "./rng.js";

describe("rng", () => {
  it("same seed yields the same sequence", () => {
    const a = makeRng(7), b = makeRng(7);
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });
  it("different seeds diverge", () => {
    expect(makeRng(1).next()).not.toBe(makeRng(2).next());
  });
  it("int is inclusive and in range", () => {
    const r = makeRng(3);
    for (let i = 0; i < 200; i++) {
      const n = r.int(2, 5);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/examples/src/demos/island-sim/engine/rng.test.ts --timeout 15000`
Expected: FAIL, cannot resolve `./rng.js`.

- [ ] **Step 3: Implement `engine/rng.ts`**

Standard mulberry32: internal `state: number`, `next()` advances and returns a float in `[0,1)`. `int(min,max)` returns `min + Math.floor(next() * (max - min + 1))`. `pick` indexes with `int(0, xs.length - 1)` and throws only on an empty array (programmer error, permitted).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/examples/src/demos/island-sim/engine/rng.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/examples/src/demos/island-sim/engine/rng.ts apps/examples/src/demos/island-sim/engine/rng.test.ts
git commit -m "feat(island-sim): seeded deterministic rng"
```

---

### Task 3: Events, action vocabulary, and needs decay

**Files:**
- Create: `apps/examples/src/demos/island-sim/engine/events.ts`
- Create: `apps/examples/src/demos/island-sim/engine/actions.ts`
- Create: `apps/examples/src/demos/island-sim/engine/needs.ts`
- Test: `apps/examples/src/demos/island-sim/engine/actions.test.ts`

**Interfaces:**
- Consumes: `WorldState`, `ActionRequest`, `Rng` from Tasks 1-2.
- Produces:
  - `SimEvent` union (see below)
  - `ActionResult = { ok: boolean; world: WorldState; events: SimEvent[]; reason?: string }`
  - `applyAction(world: WorldState, agentId: string, action: ActionRequest, rng: Rng): ActionResult`
  - `decayNeeds(agent: AgentState, weather: Weather): AgentState`
  - `needsCritical(agent: AgentState): "hunger" | "thirst" | "energy" | undefined`

`SimEvent` is a discriminated union on `kind`, including at least: `agent-moved`, `resource-gathered`, `hunted`, `built`, `crafted`, `ate`, `drank`, `rested`, `traded`, `shared`, `talked`, `inspected`, `action-failed`, `weather`, `needs-critical`, `agent-died`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { applyAction } from "./actions.js";
import { makeRng } from "./rng.js";

const findAgentByInventory = (w, kind) => w.agents.find(a => a.inventory.some(i => i.kind === kind))!;

describe("applyAction", () => {
  it("move to an adjacent tile succeeds and records an event", () => {
    const w = makeFallbackWorld(5);
    const a = w.agents[0];
    const r = applyAction(w, a.id, { type: "move", target: adjacentTile(w, a.location) }, makeRng(1));
    expect(r.ok).toBe(true);
    expect(r.world.agents[0].location).toBe(adjacentTile(w, a.location));
    expect(r.events.some(e => e.kind === "agent-moved")).toBe(true);
  });
  it("move to a non-adjacent tile fails and leaves state unchanged", () => {
    const w = makeFallbackWorld(5);
    const before = structuredClone(w);
    const r = applyAction(w, w.agents[0].id, { type: "move", target: "Z9" }, makeRng(1));
    expect(r.ok).toBe(false);
    expect(r.world).toEqual(before);
    expect(r.events[0]).toMatchObject({ kind: "action-failed" });
  });
  it("gather with no matching resource fails", () => {
    const w = makeFallbackWorld(5);
    const r = applyAction(w, w.agents[0].id, { type: "gather", target: "diamonds" }, makeRng(1));
    expect(r.ok).toBe(false);
  });
  it("eat with food reduces hunger by the food value", () => {
    const w = makeFallbackWorld(5);
    const a = findAgentByInventory(w, "berries");
    const r = applyAction(w, a.id, { type: "eat", target: "berries" }, makeRng(1));
    expect(r.ok).toBe(true);
    const after = r.world.agents.find(x => x.id === a.id)!;
    expect(after.needs.hunger).toBeLessThan(a.needs.hunger);
  });
  it("never returns a Decision action type outside the vocabulary (compile-time) and never throws", () => {
    const w = makeFallbackWorld(5);
    // @ts-expect-error unknown action type
    const r = applyAction(w, w.agents[0].id, { type: "teleport" }, makeRng(1));
    expect(r.ok).toBe(false);
  });
});
```

Add a local helper `adjacentTile(world, tile)` that returns a known passable neighbor used by the fallback layout.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/examples/src/demos/island-sim/engine/actions.test.ts --timeout 15000`
Expected: FAIL, cannot resolve `./actions.js`.

- [ ] **Step 3: Implement `engine/events.ts`**

Export the `SimEvent` union as a plain TypeScript discriminated union (not a schema; these are engine-internal). Every variant carries `tick` and the acting `agentId` where relevant.

- [ ] **Step 4: Implement `engine/actions.ts`**

`applyAction` clones the world (`structuredClone`), dispatches on `action.type`, validates (adjacency for move, resource/animal on the current tile for gather/hunt, a matching inventory item for eat/craft, a water source on the tile for drink, a co-located agent for trade/share/talk), and on success mutates the clone and returns events. On any failure returns `{ ok: false, world, events: [failEvent], reason }` where `world` is the untouched clone. Skill rolls for gather/hunt use `rng`.

- [ ] **Step 5: Implement `engine/needs.ts`**

`decayNeeds` increments hunger/thirst by 1 per tick (2 in `heat`/`storm`), decrements energy by 1 (rest restores it in `applyAction`), clamps to 0-10. `needsCritical` returns the first need at `>= 9`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test apps/examples/src/demos/island-sim/engine/actions.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/examples/src/demos/island-sim/engine/events.ts apps/examples/src/demos/island-sim/engine/actions.ts apps/examples/src/demos/island-sim/engine/needs.ts apps/examples/src/demos/island-sim/engine/actions.test.ts
git commit -m "feat(island-sim): action vocabulary, validators, needs decay"
```

---

### Task 4: Social trust and resource dynamics

**Files:**
- Create: `apps/examples/src/demos/island-sim/engine/social.ts`
- Create: `apps/examples/src/demos/island-sim/engine/resources.ts`
- Test: `apps/examples/src/demos/island-sim/engine/social.test.ts`

**Interfaces:**
- Consumes: `WorldState`, `AgentState`.
- Produces:
  - `applyTrust(a: AgentState, b: AgentState, delta: number): { a: AgentState; b: AgentState }` (clamps trust to `[-1, 1]`, updates `lastInteraction`)
  - `reputationOf(agent: AgentState, others: readonly AgentState[]): number` (mean inbound trust)
  - `regrowResources(world: WorldState, daysElapsed: number): WorldState`
  - `depleteResource(world: WorldState, resourceId: string, amount: number): WorldState`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { applyTrust, reputationOf } from "./social.js";
import { regrowResources, depleteResource } from "./resources.js";

describe("social", () => {
  it("applyTrust clamps to [-1,1] and updates both sides", () => {
    const w = makeFallbackWorld(9);
    const { a, b } = applyTrust(w.agents[0], w.agents[1], 5);
    expect(a.relationships[b.id].trust).toBeLessThanOrEqual(1);
    expect(b.relationships[a.id].trust).toBeLessThanOrEqual(1);
  });
  it("reputationOf is the mean inbound trust", () => {
    const w = makeFallbackWorld(9);
    const r = reputationOf(w.agents[0], w.agents.slice(1));
    expect(Number.isFinite(r)).toBe(true);
  });
});

describe("resources", () => {
  it("depleteResource reduces quantity and never below zero", () => {
    const w = makeFallbackWorld(9);
    const id = w.resources[0].id;
    const w2 = depleteResource(w, id, 9999);
    expect(w2.resources.find(r => r.id === id)!.quantity).toBe(0);
  });
  it("regrowResources never exceeds the original quantity", () => {
    const w = makeFallbackWorld(9);
    const id = w.resources[0].id;
    const depleted = depleteResource(w, id, 9999);
    const regrown = regrowResources(depleted, 10);
    expect(regrown.resources.find(r => r.id === id)!.quantity).toBeLessThanOrEqual(
      w.resources.find(r => r.id === id)!.quantity,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/examples/src/demos/island-sim/engine/social.test.ts --timeout 15000`
Expected: FAIL.

- [ ] **Step 3: Implement `engine/social.ts` and `engine/resources.ts`**

Return new agent/world objects (no mutation of inputs). `regrowResources` adds `regrowthPerDay * daysElapsed` per node, capped at the node's initial quantity, where initial quantity is carried on the node as `initialQuantity`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/examples/src/demos/island-sim/engine/social.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/examples/src/demos/island-sim/engine/social.ts apps/examples/src/demos/island-sim/engine/resources.ts apps/examples/src/demos/island-sim/engine/social.test.ts
git commit -m "feat(island-sim): trust reputation and resource dynamics"
```

Note: if `initialQuantity` is not on `ResourceNode`, add it in Task 1's schema and fallback before this task.

---

### Task 5: Partial-observability perception

**Files:**
- Create: `apps/examples/src/demos/island-sim/engine/perceive.ts`
- Test: `apps/examples/src/demos/island-sim/engine/perceive.test.ts`

**Interfaces:**
- Consumes: `WorldState`.
- Produces:
  - `Perception = { tick: number; self: AgentState; visibleTiles: TerrainTile[]; visibleAgents: Array<{ id; name; location }>; visibleResources: ResourceNode[]; relationships: AgentState["relationships"]; memory: AgentState["memory"] }`
  - `perceive(world: WorldState, agentId: string): Perception`
  - `renderPerception(p: Perception): string`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { perceive, renderPerception } from "./perceive.js";

describe("perceive", () => {
  it("never includes hidden facts, even as canaries", () => {
    const w = makeFallbackWorld(11);
    w.hidden.secrets = ["CANARY_SECRET_7431", "poisoned spring canary"];
    for (const a of w.agents) {
      const text = renderPerception(perceive(w, a.id));
      expect(text).not.toContain("CANARY_SECRET_7431");
      expect(text).not.toContain("poisoned spring canary");
    }
  });
  it("only includes entities within the vision radius", () => {
    const w = makeFallbackWorld(11);
    const p = perceive(w, w.agents[0].id);
    const self = w.agents[0].location;
    for (const r of p.visibleResources) expect(distance(self, r.tile)).toBeLessThanOrEqual(2);
  });
  it("includes the agent's own memory and relationships", () => {
    const w = makeFallbackWorld(11);
    w.agents[0].memory = [{ tick: 0, text: "saw berries" }];
    const p = perceive(w, w.agents[0].id);
    expect(p.memory).toHaveLength(1);
    expect(Object.keys(p.relationships)).toEqual(Object.keys(w.agents[0].relationships));
  });
});
```

Add a local `distance(a,b)` helper (Chebyshev on `column-letter + row-number` tile ids).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/examples/src/demos/island-sim/engine/perceive.test.ts --timeout 15000`
Expected: FAIL.

- [ ] **Step 3: Implement `engine/perceive.ts`**

Vision radius 2 (Chebyshev). `visibleTiles` are tiles within radius; `visibleAgents` and `visibleResources` likewise. `renderPerception` produces a compact human/LLM text block with self, location, visible entities, relationships, and memory, and nothing from `world.hidden` or other agents' private fields beyond id/name/location.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/examples/src/demos/island-sim/engine/perceive.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/examples/src/demos/island-sim/engine/perceive.ts apps/examples/src/demos/island-sim/engine/perceive.test.ts
git commit -m "feat(island-sim): partial-observability perception"
```

---

### Task 6: DecisionMaker seam and scripted decisions

**Files:**
- Create: `apps/examples/src/demos/island-sim/decision/types.ts`
- Test: `apps/examples/src/demos/island-sim/decision/types.test.ts`

**Interfaces:**
- Consumes: `ActionRequest`, `WorldState` (Task 1), `Perception` (Task 5).
- Produces:
  - `Decision = { goal: string; reasoningSummary: string; plan: string[]; action: ActionRequest; confidence?: number; probabilities?: Record<string, number>; calibrated?: boolean }`
  - `DecisionMaker = { decide(input: { world: WorldState; agentId: string; perception: Perception }): Promise<Decision> }`
  - `makeScriptedDecisionMaker(): DecisionMaker` (deterministic heuristic: highest need -> eat/drink/rest, else gather nearest visible resource, else inspect)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { perceive } from "../engine/perceive.js";
import { makeScriptedDecisionMaker } from "./types.js";

describe("scripted decisions", () => {
  it("chooses eat when hunger is critical and food is present", async () => {
    const w = makeFallbackWorld(21);
    const a = w.agents.find(x => x.inventory.some(i => i.kind === "berries"))!;
    a.needs.hunger = 10;
    const d = await makeScriptedDecisionMaker().decide({ world: w, agentId: a.id, perception: perceive(w, a.id) });
    expect(d.action.type).toBe("eat");
  });
  it("is deterministic for identical input", async () => {
    const w = makeFallbackWorld(21);
    const m = makeScriptedDecisionMaker();
    const a = w.agents[0];
    const one = await m.decide({ world: w, agentId: a.id, perception: perceive(w, a.id) });
    const two = await m.decide({ world: w, agentId: a.id, perception: perceive(w, a.id) });
    expect(one).toEqual(two);
  });
  it("always returns an action inside the vocabulary", async () => {
    const w = makeFallbackWorld(21);
    const vocab = new Set(["move","gather","hunt","build","craft","eat","drink","rest","trade","share","talk","inspect"]);
    for (const a of w.agents) {
      const d = await makeScriptedDecisionMaker().decide({ world: w, agentId: a.id, perception: perceive(w, a.id) });
      expect(vocab.has(d.action.type)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/examples/src/demos/island-sim/decision/types.test.ts --timeout 15000`
Expected: FAIL.

- [ ] **Step 3: Implement `decision/types.ts`**

The scripted heuristic reads only the `Perception`. It never touches `world.hidden`. It chooses targets from `visibleResources`/`visibleAgents`. `plan` is a short string list derived from the chosen action.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/examples/src/demos/island-sim/decision/types.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/examples/src/demos/island-sim/decision/types.ts apps/examples/src/demos/island-sim/decision/types.test.ts
git commit -m "feat(island-sim): decision-maker seam and scripted decisions"
```

---

### Task 7: Tick orchestration

**Files:**
- Create: `apps/examples/src/demos/island-sim/engine/tick.ts`
- Test: `apps/examples/src/demos/island-sim/engine/tick.test.ts`

**Interfaces:**
- Consumes: All engine modules and `DecisionMaker`.
- Produces:
  - `TickResult = { world: WorldState; events: SimEvent[]; decisions: Record<string, Decision> }`
  - `runTick(world: WorldState, maker: DecisionMaker, rng: Rng): Promise<TickResult>`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { makeRng } from "./rng.js";
import { makeScriptedDecisionMaker } from "../decision/types.js";
import { runTick } from "./tick.js";

describe("runTick", () => {
  it("advances the clock by one hour and day every 24 ticks", async () => {
    let w = makeFallbackWorld(31);
    w.clock.hour = 23;
    const r = await runTick(w, makeScriptedDecisionMaker(), makeRng(1));
    expect(r.world.clock.hour).toBe(0);
    expect(r.world.clock.day).toBe(2);
    expect(r.world.clock.tick).toBe(1);
  });
  it("produces one decision per living agent and only actions in the vocabulary", async () => {
    const w = makeFallbackWorld(31);
    const r = await runTick(w, makeScriptedDecisionMaker(), makeRng(1));
    expect(Object.keys(r.decisions)).toHaveLength(w.agents.filter(a => a.status !== "dead").length);
  });
  it("is deterministic for identical world, maker, and seed", async () => {
    const w = makeFallbackWorld(31);
    const a = await runTick(structuredClone(w), makeScriptedDecisionMaker(), makeRng(99));
    const b = await runTick(structuredClone(w), makeScriptedDecisionMaker(), makeRng(99));
    expect(a.events).toEqual(b.events);
    expect(a.world.agents.map(x => x.location)).toEqual(b.world.agents.map(x => x.location));
  });
  it("decays needs each tick", async () => {
    const w = makeFallbackWorld(31);
    const before = w.agents[0].needs.hunger;
    const r = await runTick(w, makeScriptedDecisionMaker(), makeRng(1));
    expect(r.world.agents[0].needs.hunger).toBeGreaterThanOrEqual(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/examples/src/demos/island-sim/engine/tick.test.ts --timeout 15000`
Expected: FAIL.

- [ ] **Step 3: Implement `engine/tick.ts`**

Order: snapshot decisions via `Promise.all` over living agents (decisions run in parallel and must not touch `rng`); then apply actions sequentially in agent-id order using `rng`; then decay needs, advance weather on day rollover, regrow resources on day rollover, update trust from this tick's events; collect events; advance clock. RNG is consumed only in the deterministic sequential phase. Deaths (a need at 10 for 2 ticks, or a hunt injury) emit `agent-died`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/examples/src/demos/island-sim/engine/tick.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/examples/src/demos/island-sim/engine/tick.ts apps/examples/src/demos/island-sim/engine/tick.test.ts
git commit -m "feat(island-sim): deterministic tick orchestration"
```

---

### Task 8: Decision cassette record and replay

**Files:**
- Create: `apps/examples/src/demos/island-sim/engine/cassette.ts`
- Test: `apps/examples/src/demos/island-sim/engine/cassette.test.ts`

**Interfaces:**
- Consumes: `runTick`, `DecisionMaker`, `WorldState`.
- Produces:
  - `DecisionRecord = { tick: number; agentId: string; decision: Decision }`
  - `RunCassette = { seed: number; initialWorld: WorldState; records: DecisionRecord[] }`
  - `class CassetteRecorder { constructor(world, maker): void; step(): Promise<TickResult>; toCassette(): RunCassette }`
  - `makeReplayDecisionMaker(cassette: RunCassette): DecisionMaker`
  - `replayRun(cassette: RunCassette): Promise<{ world: WorldState; events: SimEvent[] }>`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { makeScriptedDecisionMaker } from "../decision/types.js";
import { CassetteRecorder, runTick, makeReplayDecisionMaker, replayRun } from "./cassette.js";
import { makeRng } from "./rng.js";

describe("cassette", () => {
  it("replays 3 recorded ticks to an identical world and event stream", async () => {
    const w = makeFallbackWorld(77);
    const rec = new CassetteRecorder(w, makeScriptedDecisionMaker());
    const live = [];
    for (let i = 0; i < 3; i++) live.push(await rec.step());
    const cassette = rec.toCassette();
    const replay = await replayRun(cassette);
    expect(replay.world.agents.map(a => a.location)).toEqual(live[2].world.agents.map(a => a.location));
    expect(replay.events).toEqual([...live[0].events, ...live[1].events, ...live[2].events]);
  });
  it("replay decision maker returns the recorded decision for the tick", async () => {
    const w = makeFallbackWorld(77);
    const rec = new CassetteRecorder(w, makeScriptedDecisionMaker());
    await rec.step();
    const maker = makeReplayDecisionMaker(rec.toCassette());
    const d = await maker.decide({ world: w, agentId: w.agents[0].id, perception: undefined as never });
    expect(d.action.type).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/examples/src/demos/island-sim/engine/cassette.test.ts --timeout 15000`
Expected: FAIL.

- [ ] **Step 3: Implement `engine/cassette.ts`**

`CassetteRecorder.step` runs `runTick` with a fresh `makeRng(cassette.seed + tick)` (or a single stored `Rng`), records each decision keyed by `(tick, agentId)`, and appends. `replayRun` reconstructs the world from `initialWorld` and drives `runTick` with `makeReplayDecisionMaker`, using the same RNG derivation so the engine stream matches. Export the cassette to JSON via a small `serializeCassette`/`deserializeCassette` pair used by the UI (Task 11).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/examples/src/demos/island-sim/engine/cassette.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/examples/src/demos/island-sim/engine/cassette.ts apps/examples/src/demos/island-sim/engine/cassette.test.ts
git commit -m "feat(island-sim): decision cassette record and replay"
```

---

### Task 9: Judgment decision maker and narrative templating

**Files:**
- Create: `apps/examples/src/demos/island-sim/decision/judgment.ts`
- Test: `apps/examples/src/demos/island-sim/decision/judgment.test.ts`

**Interfaces:**
- Consumes: `Decision`, `DecisionMaker`, `Perception`, `renderPerception`, `ActionType`.
- Produces:
  - `JudgmentAgentLike = { judge(input: { state: unknown; questions: Record<string, unknown> }): Promise<Record<string, JudgmentAnswerLike>> }` where `JudgmentAnswerLike` is a structural subset (`{ kind: "choice"; value: string; confidence: number; calibrated: boolean; probabilities: Record<string, number> } | { kind: "score"; ... } | { kind: "noul"; probability: number }`).
  - `makeJudgmentDecisionMaker(agent: JudgmentAgentLike, opts?: { minConfidence?: number }): DecisionMaker`
  - `templateNarrative(action: ActionRequest, probabilities: Record<string, number>, goal: string): Pick<Decision, "goal" | "reasoningSummary" | "plan">`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { perceive } from "../engine/perceive.js";
import { makeJudgmentDecisionMaker, templateNarrative } from "./judgment.js";

const fakeAgent = (answers: Record<string, unknown>) => ({ judge: async () => answers });

describe("judgment decision maker", () => {
  it("maps a choice answer to a Decision with the action and calibrated confidence", async () => {
    const w = makeFallbackWorld(55);
    const agent = fakeAgent({
      action: { kind: "choice", value: "gather", confidence: 0.8, calibrated: true, probabilities: { gather: 0.8, move: 0.15, rest: 0.05 } },
      target: { kind: "choice", value: "berries", confidence: 0.9, calibrated: true, probabilities: { berries: 0.9 } },
      urgency: { kind: "score", value: 2.1, confidence: 0.6, calibrated: true, probabilities: {} },
    });
    const d = await makeJudgmentDecisionMaker(agent).decide({ world: w, agentId: w.agents[0].id, perception: perceive(w, w.agents[0].id) });
    expect(d.action.type).toBe("gather");
    expect(d.action.target).toBe("berries");
    expect(d.confidence).toBe(0.8);
    expect(d.calibrated).toBe(true);
  });
  it("falls back to inspect when the model returns an out-of-vocabulary action", async () => {
    const w = makeFallbackWorld(55);
    const agent = fakeAgent({
      action: { kind: "choice", value: "teleport", confidence: 1, calibrated: true, probabilities: {} },
    });
    const d = await makeJudgmentDecisionMaker(agent).decide({ world: w, agentId: w.agents[0].id, perception: perceive(w, w.agents[0].id) });
    expect(d.action.type).toBe("inspect");
  });
  it("templateNarrative is deterministic and names the top alternatives", () => {
    const n = templateNarrative({ type: "gather", target: "berries" }, { gather: 0.8, move: 0.15 }, "Find food");
    expect(n.reasoningSummary).toContain("0.80");
    expect(n.plan.length).toBeGreaterThan(0);
    expect(n).toEqual(templateNarrative({ type: "gather", target: "berries" }, { gather: 0.8, move: 0.15 }, "Find food"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/examples/src/demos/island-sim/decision/judgment.test.ts --timeout 15000`
Expected: FAIL.

- [ ] **Step 3: Implement `decision/judgment.ts`**

Build one `judge()` call per decide: `questions.action` is a `choice` over the 12 actions, `questions.target` a `choice` over visible targets from the perception, `questions.urgency` a `score`. The `state` passed is the rendered perception (never the raw world). Map `action.value` through the vocabulary; an unknown value or `confidence < (opts?.minConfidence ?? 0)` yields `inspect`. `templateNarrative` formats goal, a summary naming the top two probabilities and the confidence, and a one-step plan.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/examples/src/demos/island-sim/decision/judgment.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/examples/src/demos/island-sim/decision/judgment.ts apps/examples/src/demos/island-sim/decision/judgment.test.ts
git commit -m "feat(island-sim): judgment decision maker and narrative templating"
```

---

### Task 10: World generator with validation and fallback

**Files:**
- Create: `apps/examples/src/demos/island-sim/world/generator.ts`
- Test: `apps/examples/src/demos/island-sim/world/generator.test.ts`

**Interfaces:**
- Consumes: `WorldState`, `WorldStateSchema`, `parseWorld`, `makeFallbackWorld`.
- Produces:
  - `StructuredAgentLike = { run(input: string): Promise<{ object?: unknown; objectError?: string }> }`
  - `WorldGenerator = { generate(seed: number): Promise<{ world: WorldState; source: "llm" | "fallback"; attempts: number }> }`
  - `makeLlmWorldGenerator(agent: StructuredAgentLike, opts?: { maxAttempts?: number; fallback?: (seed: number) => WorldState }): WorldGenerator`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "./fallback.js";
import { makeLlmWorldGenerator } from "./generator.js";

describe("world generator", () => {
  it("uses a valid structured world on the first attempt", async () => {
    const valid = makeFallbackWorld(1);
    const gen = makeLlmWorldGenerator({ run: async () => ({ object: valid }) });
    const r = await gen.generate(1);
    expect(r.source).toBe("llm");
    expect(r.attempts).toBe(1);
  });
  it("regenerates past an invalid response, then succeeds", async () => {
    const valid = makeFallbackWorld(2);
    let calls = 0;
    const gen = makeLlmWorldGenerator({ run: async () => (++calls === 1 ? { object: { id: "bad" } } : { object: valid }) });
    const r = await gen.generate(2);
    expect(r.source).toBe("llm");
    expect(r.attempts).toBe(2);
  });
  it("falls back after exhausting attempts", async () => {
    const gen = makeLlmWorldGenerator({ run: async () => ({ object: { junk: true } }) }, { maxAttempts: 2 });
    const r = await gen.generate(3);
    expect(r.source).toBe("fallback");
    expect(r.attempts).toBe(2);
    expect(r.world.agents).toHaveLength(8);
  });
  it("falls back when the agent throws", async () => {
    const gen = makeLlmWorldGenerator({ run: async () => { throw new Error("provider down"); } });
    const r = await gen.generate(4);
    expect(r.source).toBe("fallback");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/examples/src/demos/island-sim/world/generator.test.ts --timeout 15000`
Expected: FAIL.

- [ ] **Step 3: Implement `world/generator.ts`**

`generate` loops `maxAttempts` (default 3): calls `agent.run(prompt)` where `prompt` instructs a complete `WorldState` JSON with the spec's required sections; `parseWorld(result.object)`; on success returns `{ world, source: "llm", attempts }`. On any failure (throw, `objectError`, parse miss) it continues. After exhaustion returns `{ world: fallback(seed), source: "fallback", attempts }`. The live wiring of the structured agent (`.withOutputSchema(WorldStateSchema)`) lives in Task 11's `main`, not here, so this stays testable with a fake.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/examples/src/demos/island-sim/world/generator.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/examples/src/demos/island-sim/world/generator.ts apps/examples/src/demos/island-sim/world/generator.test.ts
git commit -m "feat(island-sim): validated world generator with fallback"
```

---

### Task 11: UI page, controller, and server

**Files:**
- Create: `apps/examples/src/demos/island-sim/ui/page.ts`
- Create: `apps/examples/src/demos/island-sim/index.ts`
- Create: `apps/examples/src/demos/island-sim/README.md`
- Test: `apps/examples/src/demos/island-sim/index.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `renderPage(): string` (self-contained HTML/CSS/SVG/JS)
  - `viewerSafeState(world: WorldState): { island; terrain; weather; clock; resources; structures; agents; recentEvents }` (never `hidden`)
  - `SimController` with `newSimulation()`, `step()`, `play()`, `pause()`, `setSpeed(n)`, `selectAgent(id)`, and getters `world`, `running`, `speed`, `selectedAgentId`
  - `makeController(deps: { worldGenerator: WorldGenerator; makeDecisionMaker: () => DecisionMaker }): SimController`
  - `createServer(controller: SimController, port?: number): { server: BunServer; stop: () => void }`
  - `main(): Promise<void>` (builds live structured and judgment agents when provider/config resolve, else scripted; starts `createServer`)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "./world/fallback.js";
import { makeScriptedDecisionMaker } from "./decision/types.js";
import { viewerSafeState, makeController, createServer } from "./index.js";

describe("ui projection", () => {
  it("viewerSafeState never includes hidden facts (canary)", () => {
    const w = makeFallbackWorld(5);
    w.hidden.secrets = ["CANARY_UI_991"];
    expect(JSON.stringify(viewerSafeState(w))).not.toContain("CANARY_UI_991");
  });
});

describe("controller", () => {
  it("newSimulation produces a world, and step advances one tick (offline)", async () => {
    const controller = makeController({
      worldGenerator: { generate: async (seed) => ({ world: makeFallbackWorld(seed), source: "fallback", attempts: 0 }) },
      makeDecisionMaker: () => makeScriptedDecisionMaker(),
    });
    await controller.newSimulation();
    const before = controller.world!.clock.tick;
    await controller.step();
    expect(controller.world!.clock.tick).toBe(before + 1);
  });
});

describe("server", () => {
  it("serves the page and /api/state without hidden facts", async () => {
    const controller = makeController({
      worldGenerator: { generate: async (seed) => ({ world: makeFallbackWorld(seed), source: "fallback", attempts: 0 }) },
      makeDecisionMaker: () => makeScriptedDecisionMaker(),
    });
    await controller.newSimulation();
    const { server, stop } = createServer(controller, 0);
    try {
      const base = `http://localhost:${server.port}`;
      const page = await fetch(base + "/");
      expect(page.headers.get("content-type")).toContain("text/html");
      const state = await fetch(base + "/api/state");
      const json = await state.json();
      expect(json).not.toHaveProperty("hidden");
    } finally {
      stop();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/examples/src/demos/island-sim/index.test.ts --timeout 15000`
Expected: FAIL.

- [ ] **Step 3: Implement `ui/page.ts`**

`renderPage()` returns one HTML string: an SVG island renderer driven by `/api/state`, an event timeline fed by `/api/events` (SSE) and refreshed state, and an inspector panel for the selected agent showing beliefs, goals, needs, inventory, memory, plan, relationships, and the last judgment confidence. Controls: New Simulation, Start/Pause, Step, Speed, agent select. No external assets or CDNs.

- [ ] **Step 4: Implement `index.ts`**

`viewerSafeState` strips `hidden` (and any future private field). `makeController` holds `world`, `running`, `speed`, `selectedAgentId`, and a tick timer; `step` calls `runTick` with a per-controller `Rng` seeded from `world.seed`. `createServer` routes the JSON API and SSE, wraps `renderPage()`, and `stop()` calls `server.stop(true)`. `main` selects live agents when a provider/judgment backend resolves (structured world-gen agent via `.withOutputSchema(WorldStateSchema)`, judgment agent via `.withJudgment({ backend })`) and otherwise scripted, then starts the server on port 3007. Log the mode and URL.

- [ ] **Step 5: Implement `README.md`**

Document: what the demo shows; run with `bun run apps/examples/src/demos/island-sim/index.ts`; the offline vs live modes; judgment backend selection (`ollama`/`jev`/`llm`/`scripted`); env vars; and the cassette export/replay.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test apps/examples/src/demos/island-sim/index.test.ts --timeout 15000`
Expected: PASS (3 tests).

- [ ] **Step 7: Run the full suite for this demo and a typecheck**

Run: `bun test apps/examples/src/demos/island-sim --timeout 15000`
Expected: all tests PASS.
Run: `bun run typecheck`
Expected: no errors in `apps/examples`.

- [ ] **Step 8: Commit**

```bash
git add apps/examples/src/demos/island-sim/ui/page.ts apps/examples/src/demos/island-sim/index.ts apps/examples/src/demos/island-sim/README.md apps/examples/src/demos/island-sim/index.test.ts
git commit -m "feat(island-sim): svg ui, controller, server, and readme"
```

---

## Self-Review

**Spec coverage.** Section 4 architecture maps to the file structure and Tasks 1-11. Section 5 data model = Task 1. Section 6 judgment-first decisions = Tasks 6 (seam), 9 (judgment + narrative). Section 7 world generation = Task 10. Section 8 engine = Tasks 2-5, 7. Section 9 determinism = Tasks 2, 8. Section 10 UI/API = Task 11. Section 11 offline = Tasks 6, 9, 10, 11. Section 12 dogfooding = Task 11 wiring plus the debrief. Section 13 testing = every task. Section 14 acceptance = Tasks 1, 5, 8, 10, 11.

**Step scan.** Each step names one action and one checkable result. No step says "handle edge cases" or "add tests". Signatures and assertions are pinned; bodies are left to the implementer except where the algorithm is non-obvious (mulberry32, deterministic ordering in `runTick`).

**Type consistency.** `ActionRequest`, `Decision`, `Perception`, `SimEvent`, `WorldState`, `DecisionMaker`, `WorldGenerator`, `TickResult`, `RunCassette` are defined once and referenced by the same names throughout. `applyAction` returns `ActionResult`; `runTick` returns `TickResult`; `makeJudgmentDecisionMaker` and `makeScriptedDecisionMaker` both return `DecisionMaker`; `makeLlmWorldGenerator` returns `WorldGenerator`.

**Review Focus.** Items 1-6 each name the owning task's test. No uncovered input class was found beyond these.

**Proportion.** The plan is longer than the spec because the spec is compact and the modules are numerous; each task carries only signatures, test assertions, and the values the spec fixes, not implementation bodies.

---

## Execution Notes

- The judgment backend `ollama` (`.withJudgment({ backend: "ollama", model: "nimble" })`) ships with the separate System One plan; until then, Task 11's live wiring should prefer `ollama` when available, else `jev` (when `TYPESAFE_API_KEY` resolves), else `llm`, else scripted. No demo code changes are needed when the System One backend lands.
- After the build, write a debrief at `wiki/Research/Debriefs/2026-10-<date>-island-sim-debrief.md` recording which parts of the gap register (spec section 12) held up, and append the demo to the examples index if one exists.
