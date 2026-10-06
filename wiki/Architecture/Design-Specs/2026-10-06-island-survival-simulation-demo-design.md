---
type: design-spec
status: draft
created: 2026-10-06
tags: [demo, simulation, multi-agent, judgment, systemone, llm, ui, examples]
related:
  - "[[../../Planning/Implementation-Plans/2026-10-05-systemone-decision-backends|System One Decision Backends plan]]"
  - "[[2026-10-01-systemone-decision-backends-design|System One Decision Backends design]]"
---

# Island Survival Simulation Demo: Design Spec

## 1. Summary

A small, visually inspectable multi-agent island-survival simulation under
`apps/examples/src/demos/island-sim/`. One LLM call generates the initial world;
each tick every agent makes a decision; a deterministic engine validates and
executes those decisions and owns the authoritative state; a browser UI renders
the island, an event timeline, and a per-agent subjective-state inspector.

The demo is also a dogfooding vehicle: it exercises `.withJudgment()`,
`.withOutputSchema()`, `.withEvents()`, `.withHook()`, and the replay/tracing
surfaces, and it produces an honest framework gap register (section 12).

Finding this design is built on (probe: `wiki/Research/Prototypes/p-island-decision/`):
`agent.judge()` returns a calibrated action decision in ~130 ms versus ~7 s for a
structured `run()` decision on a local model, so decisions are judgment-first.

## 2. Goals

- Watchable: a stranger can open one URL, hit New Simulation, and follow
  consequential decisions in an event log within seconds.
- Emergent: social outcomes (trade networks, alliances, conflict, cooperation)
  arise from interactions, never scripted.
- Honest simulation: the engine, not the LLM, owns world state; LLMs only
  propose.
- Dogfooding: real use of the judgment primitive, structured output, events,
  hooks, and replay, with a gap report fed back to the framework.
- Offline-first: with no API key, the demo still runs an interesting,
  deterministic simulation.

## 3. Non-goals (MVP constraints)

- 8 agents, one small island (~12x12), ~10 resource nodes.
- ~12 action types, simple needs model, simple trust model.
- No persistent database, no multiplayer, no pathfinding beyond adjacency, no 3D.
- One world-generation call per New Simulation; one decision call per agent per
  tick; no world regeneration mid-run.
- Fidelity is subordinate to watchability and emergent interaction.

## 4. Architecture

```
LLM
 |- World Generator        (one .withOutputSchema call per New Simulation)
 |- Decision Maker          (agent.judge() per agent per tick)
 \- Narrative (optional)    (one .withOutputSchema call, separate agent)

Simulation Engine (pure, deterministic given inputs)
 |- World State
 |- Rules (needs, weather, resources, construction)
 |- Action Execution + validation
 |- Time (tick clock)
 \- Event System

UI (Bun.serve)
 |- Island Renderer (SVG)
 |- Agent Inspector (subjective state)
 \- Event Timeline
```

The engine is pure: `(WorldState, Decision[]) -> (WorldState, SimEvent[])`.
LLM components sit behind interfaces (`WorldGenerator`, `DecisionMaker`) so the
offline/scripted implementations are drop-in substitutes and the engine is
testable without a model.

### File layout

```
apps/examples/src/demos/island-sim/
  index.ts              # Bun.serve bootstrap: UI + JSON API + SSE; owns tick loop
  README.md             # how to run, what it shows, offline vs live
  world/
    schema.ts           # Effect Schemas: WorldState, AgentState, Resource, Structure, Decision
    generator.ts        # LLM world generation + validate/regenerate
    fallback.ts         # canned valid WorldState for no-key mode
  engine/
    state.ts            # types + pure reducers
    perceive.ts         # builds per-agent partial perception (never global state)
    actions.ts          # action vocabulary, validators, executors
    needs.ts            # needs decay + weather effects
    social.ts           # trust/reputation updates
    resources.ts        # depletion, regrowth, discovery
    rng.ts              # seeded mulberry32 (deterministic)
    events.ts           # SimEvent types
    tick.ts             # orchestration: perceive -> decide -> validate -> execute -> emit
  decision/
    types.ts            # Perception, DecisionMaker interface, ScriptedDecisionMaker (Decision shape lives in world/schema.ts)
    judgment.ts         # JudgmentDecisionMaker (agent.judge over a selectable backend)
    narrative.ts        # optional structured goal/reasoning/plan call
  ui/
    page.ts             # self-contained HTML/CSS/SVG/JS
```

## 5. World data model

All shapes are Effect Schemas in `world/schema.ts`; decoded (not cast) before use.

- `WorldState`: `id`, `seed`, `clock { tick, day, hour }`, `island { width, height }`,
  `terrain: TerrainTile[]` (tile id, biome, elevation), `weather { condition, tempC }`,
  `resources: ResourceNode[]`, `structures: Structure[]`, `agents: AgentState[]`,
  `hidden: HiddenFacts`, `eventLog: SimEvent[]`.
- `AgentState`: `id`, `name`, `personality { traits, riskTolerance }`,
  `skills: Record<string, number>`, `needs { hunger, thirst, energy }` (0..10),
  `goals: string[]`, `inventory: ItemStack[]`, `location: TileId`,
  `relationships: Record<AgentId, { trust, lastInteraction }>`,
  `beliefs: Belief[]`, `memory: MemoryEntry[]` (bounded), `plan: string[]`,
  `status: alive | injured | ill | dead`, `homeStructureId?`.
- `ResourceNode`: `id`, `kind`, `tile`, `quantity`, `regrowthPerDay`.
- `Structure`: `id`, `kind`, `tile`, `ownerId`, `durability`.
- `HiddenFacts`: `startingSecrets: string[]` (never passed to `perceive()`),
  e.g. poisoned spring, buried cache locations.
- `Decision`: `{ goal, reasoningSummary, plan: string[], action: { type, target? } }`.
  For the judgment path, `action`/`target` come from `agent.judge()`; `goal`,
  `reasoningSummary`, and `plan` are templated (or supplied by `.withOutputSchema`
  narration).

## 6. Decision architecture (judgment-first)

`DecisionMaker` is an interface:

```ts
interface DecisionMaker {
  decide(input: { agent: AgentState; perception: Perception; world: WorldState }): Promise<Decision>;
}
```

### 6.1 Judgment core

`JudgmentDecisionMaker` builds an `agent.judge()` call per agent per tick with the
perception as the explicit `state:` argument (this is the partial-observability
boundary), and named questions:

- `action`: `choice` over the 12-action vocabulary, each with a one-line
  description.
- `target`: `choice` over entities visible to that agent only.
- `urgency`: `score` over a 5-level survival-urgency rubric.
- `coop` / `risk`: `noul` (for example, "is this agent a safe trade partner?").

Returns `{ value, probabilities, confidence, calibrated }`. The engine records
the full distribution for the UI and for replay.

### 6.2 Backend selection

Order of preference, resolved from env/config, with graceful fallback:

1. `ollama` - `.withJudgment({ backend: "ollama", model: "nimble" })`: local,
   private, calibrated. Ships with the active System One plan
   (`2026-10-05-systemone-decision-backends`); the demo targets this API and
   needs no changes when it lands. Alternate models: `clef`/`clef-flash`, `tev`.
2. `jev` - TypeSafe System One; works today when `TYPESAFE_API_KEY` resolves.
3. `llm` - emulation over the configured provider. Slow and `calibrated: false`;
   fallback only.
4. `scripted` - deterministic heuristic, no model. Default when no backend is
   reachable.

The demo must run end-to-end on `scripted` alone. Judgment failures degrade to
`scripted`, never crash a tick.

### 6.3 Narrative (optional)

By default, `goal`, `reasoningSummary`, and `plan` are templated from the
judgment result (zero extra tokens, deterministic): for example,
`goal = "Find food"`, `reasoningSummary = "gather selected at 0.78 confidence;
runner-up move 0.12"`, `plan = ["travel_to(berries)", "gather"]`.

With `--narrate`, one `.withOutputSchema(NarrativeSchema)` call per agent
produces richer free text. This uses a separate agent instance from the
judgment agent, because `.withOutputSchema()` is agent-global and sticky (gap 2).

## 7. World generation

On New Simulation, one structured call:

```
ReactiveAgents.create()
  .withProvider(provider)
  .withOutputSchema(WorldStateSchema, { mode: "fast", onParseFail: "degrade" })
  .build()
  .run(worldGenPrompt)
```

- `Schema.decode` the result against `WorldStateSchema`.
- Reject invalid states and regenerate up to `maxAttempts` (default 3).
- On exhaustion, or with no provider, use `world/fallback.ts` (a hand-authored
  valid island) so New Simulation always produces a playable world.
- Hidden facts are stored in `WorldState.hidden` and never included in
  `perceive()` output.

## 8. Simulation engine

### 8.1 Tick loop

```text
for each agent (parallel):
  perception = perceive(agent, world)
  decision   = decisionMaker.decide({ agent, perception, world })
  plan       = decision.plan (clamped to a small max length)

validate + execute decisions in deterministic order (agent id):
  invalid -> no-op + action_failed event

world changes:
  needs decay, weather advance, resources deplete/regrow,
  trust/reputation update, injuries/illness, construction completes,
  births/deaths if applicable

emit SimEvents; clock += 1 tick
```

One tick is one in-world hour; 24 ticks is one day. The UI shows `Day N, HH:00`.

### 8.2 Partial observability

`perceive(agent, world)` returns only:

- the agent's own state (needs, inventory, skills, relationships, memory),
- tiles and entities within the agent's vision radius,
- agents currently visible,
- the last N memory entries and events the agent witnessed or was told,
- believed facts (`beliefs`), which may be wrong.

It never returns `WorldState.hidden`, other agents' private state, or entities
outside the vision radius. This is enforced by a unit test that plants canary
strings in `hidden` and asserts they never appear in any perception.

### 8.3 Actions

Vocabulary (exactly): `move`, `gather`, `hunt`, `build`, `craft`, `eat`,
`drink`, `rest`, `trade`, `share`, `talk`, `inspect`.

Executors validate then mutate: `move` requires adjacency and passable terrain;
`gather`/`hunt` require a matching resource/animal on the tile and a skill roll
(seeded RNG); `build`/`craft` require materials and time; `eat`/`drink` require
the item or a water source; `trade`/`share`/`talk` require a co-located agent and
update trust. Invalid actions produce `action_failed` and consume the tick.

### 8.4 Needs, weather, emergence

Needs decay per tick; weather (seeded, deterministic) multiplies
gathering/hunting yield and energy drain. Low needs cause injury or illness.
Trust rises on successful share/trade/talk and falls on failed trade or refusal;
reputation is derived from the trust matrix. Scarcity, depletion, discovery, and
conflicting personality-driven goals produce cooperation and conflict. No social
outcome is explicitly programmed.

## 9. Determinism and replay

- `engine/rng.ts` is a seeded PRNG (mulberry32); the seed is chosen at New
  Simulation and stored in `WorldState.seed`.
- The engine is a pure function of `(WorldState, Decision[])` plus the RNG
  stream, so a run is reproducible given the recorded decisions.
- Each tick records a `DecisionRecord`:
  `{ tick, agentId, action, target, probabilities, confidence, calibrated, narrative }`.
- A `RunCassette` = `{ seed, initialWorldState, decisionRecords[], engineRngDraws }`.
  Replaying a cassette with `ScriptedDecisionMaker` fed from the records
  reproduces the run with no model. The UI offers export/import of a cassette.
- This is the concrete meaning of "deterministic once initialized": same seed
  and same recorded decisions -> identical run.

## 10. UI and control API

Single self-contained page served by `Bun.serve` (no build step, no framework).

Panels:

- **Island renderer**: SVG grid, terrain color/glyph per tile, resource nodes,
  structures, agents as labeled dots colored by worst need; movement animated
  between ticks; weather indicator; clock.
- **Event timeline**: ordered `SimEvent` list, newest first, with consequential
  events (death, trade, discovery, construction) emphasized.
- **Agent inspector**: click an agent to see its subjective state: beliefs,
  goals, needs, inventory, recent memories, current plan, trust toward others,
  and the judgment distribution/confidence behind its last action.

Controls: New Simulation, Start/Pause, Step One Tick, Speed, Select Agent.

HTTP surface:

- `GET /` -> the page.
- `GET /api/state` -> current world snapshot (viewer-safe projection).
- `POST /api/new` -> new simulation (world-gen).
- `POST /api/step` -> one tick.
- `POST /api/play` / `POST /api/pause` -> run control.
- `POST /api/speed` -> ticks-per-second.
- `GET /api/events` -> SSE stream of `SimEvent`s and framework activity events.

Framework events from `.withEvents()` ride a separate "engine activity" lane in
the timeline, so the UI shows both simulation events and real agent reasoning
events.

## 11. Offline and test-provider mode

- No API key and no judgment backend -> `scripted` decision maker plus
  `world/fallback.ts`. The demo is fully watchable and deterministic.
- A `--provider test` mode uses the deterministic `test` provider for both world
  generation (with `withTestScenario`) and, optionally, `llm`-backend judgment,
  so the demo can be smoke-tested in CI with no network.
- Live mode is opt-in via provider/judgment flags and env.

## 12. Framework dogfooding and gap register

Surfaces exercised: `.withJudgment()`, `.withOutputSchema()`, `.withEvents()`,
`.withHook()` (per-call tokens/cost), `.withTracing()`/replay (cassette),
optional `.withMemory()` behind the `DecisionMaker` seam.

Alignment with active work: this demo is a first real consumer of the
`2026-10-05-systemone-decision-backends` plan. When `.withJudgment({ backend:
"ollama" })` ships, the demo runs local and calibrated with no demo changes.

### Gaps observed (from the probe and this design)

1. No structured output on the session/chat path (`.withOutputSchema` is ignored
   by `session.chat()`/`agent.chat()`).
2. Output schema is agent-global and sticky; there is no per-call override and
   no `runText()`. Typed decisions and free-text narration cannot share an agent.
3. No per-agent scoped-memory primitive. `judge()`'s explicit `state:` helps;
   `run()` does not, so `perceive()` must be hand-built and trusted.
4. No tick/batch-decision primitive. N agents means N hand-scheduled calls with
   no aggregate token budget or isolation guarantee.
5. Determinism is LLM-layer (`.withReplayLLM`/`.withTracing`), not decision-layer;
   no record/replay of decisions across `judge()` and `run()`.
6. Local cost is invisible (Ollama reports `cost: 0`); tokens are the only signal.

### Proposed features (the demo is the forcing function)

- `runBatch()`: parallel structured decisions with per-agent isolation and a
  per-agent token cap.
- `run(input, { schema })` and `run(input, { schema: null })` (or `runText()`):
  per-call structured output override.
- Structured `session.chat()`.
- Per-agent memory namespaces plus a `perceive()` assembly helper for
  partial-observability apps.
- Decision cassette: `recordDecisions()` / `replayDecisions()` spanning
  `judge()` and `run()`.
- A judgment result convenience that exposes the distribution/confidence for UIs.

## 13. Testing strategy

- Pure engine unit tests: RNG determinism, `perceive()` excludes hidden canaries,
  action validation (adjacency/resources/inventory), needs decay, trust updates,
  replay identity (same cassette -> same events).
- World generation: valid state validates; invalid state regenerates; exhausted
  attempts fall back.
- Decision seam: `ScriptedDecisionMaker` deterministic; `judgment.ts` maps a
  mocked `judge()` response to a valid `Decision`; backend failure degrades to
  scripted.
- UI API: JSON endpoints return viewer-safe projections; SSE emits events.
- All tests run without network using the `test` provider and scripted paths.
- Commands: `bun test apps/examples/src/demos/island-sim --timeout 15000` and a
  smoke run of `index.ts --offline`.

## 14. Acceptance criteria

1. `New Simulation` with no key produces a valid, playable world from the
   fallback and runs deterministically.
2. `New Simulation` with a live provider produces a schema-valid world; invalid
   generations are rejected and regenerated.
3. Agents act only on perceived information; the canary test passes.
4. The UI renders island, agents, event log, and inspector; controls work.
5. Clicking an agent shows beliefs, goals, needs, inventory, memories, plan,
   trust, and last judgment distribution.
6. A run can be exported as a cassette and replayed identically with no model.
7. The gap register (section 12) is recorded in a debrief after the build.

## 15. Open questions / future

- Whether `.withMemory()` earns its cost for long runs (probe says no for short
  histories; revisit after the System One backend lands).
- Multi-island or larger populations, and whether emergent group formation needs
  an explicit "group" primitive or stays in the trust graph.
- Whether vision (`clef`/`clef-flash`) should let agents read the rendered map
  directly, a possible future demo variant.
