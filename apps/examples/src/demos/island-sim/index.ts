import { ReactiveAgents } from "reactive-agents";
import type { WorldState } from "./world/schema.js";
import type { WorldGenerator } from "./world/generator.js";
import { makeLlmWorldGenerator } from "./world/generator.js";
import type { DecisionMaker } from "./decision/types.js";
import { makeScriptedDecisionMaker } from "./decision/types.js";
import { runTick } from "./engine/tick.js";
import { type Rng, makeRng } from "./engine/rng.js";
import type { SimEvent } from "./engine/events.js";
import { renderPage } from "./ui/page.js";
import { makeFallbackWorld } from "./world/fallback.js";
import { WorldBlueprintSchema } from "./world/blueprint.js";
import { NarrationLogSchema, makeTemplateNarrator, makeLlmNarrator, type Narrator } from "./narrator/narrator.js";
import { makeLlmDecisionMaker } from "./decision/llm.js";
import { ActionRequestSchema } from "./world/schema.js";

type SequencedEvent = { sequence: number; event: SimEvent };
const MAX_RETAINED_EVENTS = 300;

/** Remove hidden island facts before exposing simulation state to the viewer. */
export function viewerSafeState(world: WorldState) {
  const gameplay = world.gameplay;
  return {
    island: world.island,
    terrain: world.terrain,
    weather: world.weather,
    clock: world.clock,
    resources: world.resources,
    structures: world.structures,
    agents: world.agents,
    gameplay: gameplay ? {
      campCache: gameplay.campCache,
      objectives: gameplay.objectives,
      alliances: gameplay.alliances.map((alliance) => ({
        id: alliance.id,
        name: alliance.name,
        members: alliance.members,
        formedAtTick: alliance.formedAtTick,
        stashUnits: alliance.stash.reduce((total, item) => total + item.qty, 0),
      })),
      exiles: gameplay.exiles,
      nextTwistTick: gameplay.nextTwistTick,
      twistCount: gameplay.twistCount,
    } : undefined,
  };
}

/** Own simulation state, deterministic ticks, playback controls, and the recent event window. */
export class SimController {
  world: WorldState | null = null;
  running = false;
  speed = 1;
  selectedAgentId: string | null = null;
  private gameOver = false;
  private tickTimer: NodeJS.Timeout | null = null;
  private rng: Rng;
  private eventSequence = 0;
  private retainedEvents: SequencedEvent[] = [];
  private lastNarrationDay = 0;

  constructor(
    private readonly worldGenerator: WorldGenerator,
    private readonly makeDecisionMaker: () => DecisionMaker,
    private readonly narrator: Narrator = makeTemplateNarrator(),
  ) {
    this.rng = makeRng(Date.now());
  }

  /** Generate and install a new island, clearing its prior event history. */
  async newSimulation(): Promise<void> {
    this.pause();
    const result = await this.worldGenerator.generate(Date.now());
    this.world = result.world;
    this.rng = makeRng(result.world.seed);
    this.retainedEvents = [];
    this.eventSequence = 0;
    this.speed = 1;
    this.gameOver = false;
    this.lastNarrationDay = 0;
    this.selectedAgentId = null;
  }

  /** Advance exactly one in-world hour and retain all resulting narrative events. */
  async step(): Promise<void> {
    if (!this.world) return;
    const result = await runTick(this.world, this.makeDecisionMaker(), this.rng);
    this.world = result.world;
    this.retainedEvents.push(...result.events.map((event) => ({
      sequence: ++this.eventSequence,
      event,
    })));
    if (this.retainedEvents.length > MAX_RETAINED_EVENTS) {
      this.retainedEvents.splice(0, this.retainedEvents.length - MAX_RETAINED_EVENTS);
    }
    const rescued = result.events.some((event) => event.kind === "rescue-arrived");
    const lost = this.world.agents.length > 0 && this.world.agents.every((agent) => agent.status === "dead");
    if (rescued || lost) {
      this.gameOver = true;
      this.pause();
    }
    this.narrateClosedDay();
  }

  /** When a day closes, hand the day's events to the narrator and retain the recap. */
  private narrateClosedDay(): void {
    const world = this.world;
    if (!world || world.clock.day <= this.lastNarrationDay) return;
    this.lastNarrationDay = world.clock.day;
    const day = world.clock.day - 1;
    const dayStartTick = Math.max(0, (day - 1) * 24);
    const dayEndTick = (day - 1) * 24 + 23;
    void Promise.resolve(this.narrator.narrate({ world, day, dayStartTick, dayEndTick, events: this.retainedEvents }));
  }

  /** Resume autonomous island simulation. */
  play(): void {
    if (!this.world || this.running) return;
    this.running = true;
    this.scheduleTick();
  }

  /** Pause autonomous island simulation and clear its pending timer. */
  pause(): void {
    this.running = false;
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /** Set playback pace to a finite positive number of simulation ticks per second. */
  setSpeed(ticksPerSecond: number): void {
    if (!Number.isFinite(ticksPerSecond) || ticksPerSecond <= 0) return;
    this.speed = Math.min(ticksPerSecond, 20);
    if (this.running) this.scheduleTick();
  }

  /** Select a castaway for server-side clients. */
  selectAgent(id: string): void {
    this.selectedAgentId = id;
  }

  /** Return the current world, if initialized. */
  getWorld(): WorldState | null {
    return this.world;
  }

  /** Return whether automatic playback is active. */
  getRunning(): boolean {
    return this.running;
  }

  /** Return current playback speed. */
  getSpeed(): number {
    return this.speed;
  }

  /** Return the selected castaway identifier. */
  getSelectedAgentId(): string | null {
    return this.selectedAgentId;
  }

  /** Return whether the story has reached an ending (rescue or all lost). */
  isGameOver(): boolean {
    return this.gameOver;
  }

  /** Return the narrator's retained chronicle, newest last. */
  getChronicle() {
    return this.narrator.chronicle();
  }

  /** Read retained events newer than a client cursor. */
  getEventsAfter(sequence: number): { events: SequencedEvent[]; latestSequence: number } {
    return {
      events: this.retainedEvents.filter((item) => item.sequence > sequence),
      latestSequence: this.eventSequence,
    };
  }

  private scheduleTick(): void {
    if (!this.running) return;
    if (this.tickTimer) clearTimeout(this.tickTimer);
    this.tickTimer = setTimeout(() => {
      void this.step()
        .catch(() => this.pause())
        .finally(() => this.scheduleTick());
    }, 1000 / this.speed);
  }
}

/** Create a controller from injectable world, decision, and narrator strategies. */
export function makeController(deps: {
  worldGenerator: WorldGenerator;
  makeDecisionMaker: () => DecisionMaker;
  narrator?: Narrator;
}): SimController {
  return new SimController(deps.worldGenerator, deps.makeDecisionMaker, deps.narrator ?? makeTemplateNarrator());
}

/** Create the interactive HTTP server for the island simulation. */
export function createServer(controller: SimController, port: number = 0) {
  const server = Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/") {
        return new Response(renderPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (url.pathname === "/api/state" && request.method === "GET") {
        const world = controller.getWorld();
        if (!world) return Response.json({ error: "no world" }, { status: 400 });
        return Response.json({
          ...viewerSafeState(world),
          simulation: { running: controller.getRunning(), speed: controller.getSpeed(), gameOver: controller.isGameOver() },
        });
      }
      if (url.pathname === "/api/events" && request.method === "GET") {
        const requested = Number(url.searchParams.get("after") ?? 0);
        const after = Number.isSafeInteger(requested) && requested >= 0 ? requested : 0;
        return Response.json(controller.getEventsAfter(after));
      }
      if (url.pathname === "/api/chronicle" && request.method === "GET") {
        return Response.json(controller.getChronicle());
      }
      if (request.method !== "POST") return new Response("Not found", { status: 404 });
      if (url.pathname === "/api/new-simulation") {
        await controller.newSimulation();
        return Response.json({ success: true });
      }
      if (url.pathname === "/api/play") {
        controller.play();
        return Response.json({ success: true });
      }
      if (url.pathname === "/api/pause") {
        controller.pause();
        return Response.json({ success: true });
      }
      if (url.pathname === "/api/step") {
        await controller.step();
        return Response.json({ success: true });
      }
      if (url.pathname === "/api/speed") {
        const body: unknown = await request.json();
        if (typeof body !== "object" || body === null || !("speed" in body) || typeof body.speed !== "number") {
          return Response.json({ error: "speed must be a number" }, { status: 400 });
        }
        controller.setSpeed(body.speed);
        return Response.json({ success: true, speed: controller.getSpeed() });
      }
      return new Response("Not found", { status: 404 });
    },
  });
  return { server, stop: () => server.stop(true) };
}

/** Result contract consumed by the examples runner. */
export type ExampleResult = {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
};

/** Optional provider selection accepted by the examples runner. */
export type RunConfig = {
  provider?: string;
  model?: string;
};

/** Run a deterministic 100-hour offline simulation for the examples runner. */
export async function run(_config: RunConfig = {}): Promise<ExampleResult> {
  const startedAt = Date.now();
  try {
    const controller = makeController({
      worldGenerator: {
        generate: async (seed) => ({ world: makeFallbackWorld(seed), source: "fallback", attempts: 0 }),
      },
      makeDecisionMaker: () => makeScriptedDecisionMaker(),
    });
    await controller.newSimulation();
    for (let index = 0; index < 100; index += 1) await controller.step();
    const world = controller.getWorld();
    return {
      passed: world !== null && world.clock.tick === 100,
      output: world ? `Simulated 100 hours with ${world.agents.filter((agent) => agent.status !== "dead").length} survivors.` : "Simulation did not initialize.",
      steps: 100,
      tokens: 0,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      passed: false,
      output: error instanceof Error ? error.message : String(error),
      steps: 0,
      tokens: 0,
      durationMs: Date.now() - startedAt,
    };
  }
}

async function main(): Promise<void> {
  let worldGenerator: WorldGenerator = {
    generate: async (seed) => ({ world: makeFallbackWorld(seed), source: "fallback", attempts: 0 }),
  };
  let narrator: Narrator = makeTemplateNarrator();
  let llmMakeDecisionMaker: (() => DecisionMaker) | null = null;
  try {
    const provider = "ollama";
    const model = process.env.ISLAND_SIM_MODEL ?? "cogito:14b";
    const agent = await ReactiveAgents.create()
      .withName("island-sim-blueprint")
      .withProvider(provider)
      .withModel(model)
      .withMaxIterations(1)
      .withOutputSchema(WorldBlueprintSchema)
      .build();
    worldGenerator = makeLlmWorldGenerator({
      run: async (prompt) => {
        const result = await agent.run(prompt);
        return {
          ...(result.object === undefined ? {} : { object: result.object }),
          ...(result.objectError === undefined ? {} : { objectError: result.objectError }),
        };
      },
    });
    console.info(`Island blueprint generator configured: ${provider}/${model}`);

    try {
      const narratorAgent = await ReactiveAgents.create()
        .withName("island-story-narrator")
        .withProvider(provider)
        .withModel(model)
        .withMaxIterations(1)
        .withSystemPrompt("You are the resident narrator of a castaway survival chronicle. Write short, evocative reality-TV recaps.")
        .withOutputSchema(NarrationLogSchema)
        .build();
      narrator = makeLlmNarrator({
        run: async (prompt) => {
          const result = await narratorAgent.run(prompt);
          return {
            ...(result.object === undefined ? {} : { object: result.object }),
            ...(result.objectError === undefined ? {} : { objectError: result.objectError }),
          };
        },
      });
      console.info(`Narrator agent configured: ${provider}/${model}`);
    } catch (error) {
      console.info(`Narrator using the deterministic template: ${error instanceof Error ? error.message : String(error)}`);
    }

    let makeDecisionMakersLocal: () => DecisionMaker = () => makeScriptedDecisionMaker();
    if (process.env.ISLAND_SIM_LLM_DECISIONS === "1") {
      try {
        const survivorAgent = await ReactiveAgents.create()
          .withName("island-survivor-mind")
          .withProvider(provider)
          .withModel(model)
          .withMaxIterations(1)
          .withSystemPrompt("You are one castaway's instincts. Respond with JSON only.")
          .withOutputSchema(ActionRequestSchema)
          .build();
        makeDecisionMakersLocal = () => makeLlmDecisionMaker({
          run: async (prompt: string) => {
            const result = await survivorAgent.run(prompt);
            return {
              ...(result.object === undefined ? {} : { object: result.object }),
              ...(result.objectError === undefined ? {} : { objectError: result.objectError }),
            };
          },
        }, () => makeScriptedDecisionMaker());
        console.info(`LLM survivor decisions enabled (high latency/expense): ${provider}/${model}`);
      } catch (error) {
        console.info(`LLM survivor decisions unavailable; using scripted minds: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    llmMakeDecisionMaker = makeDecisionMakersLocal;
  } catch (error) {
    console.info(`Using deterministic island fallback: ${error instanceof Error ? error.message : String(error)}`);
  }

  const controller = makeController({
    worldGenerator,
    makeDecisionMaker: llmMakeDecisionMaker ?? (() => makeScriptedDecisionMaker()),
    narrator,
  });
  await controller.newSimulation();
  controller.play();
  const { server, stop } = createServer(controller, Number(process.env.PORT ?? 3007));
  console.info(`Island survival demo listening on http://localhost:${server.port}`);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (import.meta.main) await main();
