import { WorldState } from "../world/schema.js";
import { WorldGenerator } from "./world/generator.js";
import { DecisionMaker } from "./decision/types.js";
import { runTick } from "./engine/tick.js";
import { Rng, makeRng } from "./engine/rng.js";
import { renderPage } from "./ui/page.js";

/**
 * Strip hidden facts and any other private fields for viewer-safe projection.
 */
export function viewerSafeState(world: WorldState) {
  return {
    island: world.island,
    terrain: world.terrain,
    weather: world.weather,
    clock: world.clock,
    resources: world.resources,
    structures: world.structures,
    agents: world.agents,
    // recentEvents: we don't have a field for recent events in world; we could compute from cassette or events log.
    // For simplicity, we'll omit recentEvents or set to empty array.
    recentEvents: [] as any, // placeholder
  };
}

/**
 * Simulation controller.
 */
export class SimController {
  world: WorldState | null = null;
  running = false;
  speed = 1; // ticks per second when running
  selectedAgentId: string | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private rng: Rng;

  constructor(
    private worldGenerator: WorldGenerator,
    private makeDecisionMaker: () => DecisionMaker
  ) {
    // Initialize RNG with a seed from the world generator? We'll set when we have a world.
    this.rng = makeRng(Date.now());
  }

  async newSimulation() {
    // Generate a world using the world generator.
    const result = await this.worldGenerator.generate(Date.now());
    this.world = result.world;
    this.rng = makeRng(result.world.seed);
    // Reset controller state.
    this.running = false;
    this.speed = 1;
    this.selectedAgentId = null;
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  async step() {
    if (!this.world) return;
    const maker = this.makeDecisionMaker();
    const result = await runTick(this.world, maker, this.rng);
    this.world = result.world;
    // In a real implementation, we would emit events to subscribers (e.g., via SSE).
    // For now, we just update the world.
  }

  play() {
    if (!this.world) return;
    this.running = true;
    this.scheduleTick();
  }

  pause() {
    this.running = false;
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  setSpeed(n: number) {
    this.speed = n;
    if (this.running) {
      this.scheduleTick();
    }
  }

  selectAgent(id: string) {
    this.selectedAgentId = id;
  }

  private scheduleTick() {
    if (!this.running) return;
    const interval = 1000 / this.speed; // ms per tick
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
    }
    this.tickTimer = setTimeout(async () => {
      await this.step();
      this.scheduleTick();
    }, interval);
  }

  // Getters
  getWorld(): WorldState | null {
    return this.world;
  }
  getRunning(): boolean {
    return this.running;
  }
  getSpeed(): number {
    return this.speed;
  }
  getSelectedAgentId(): string | null {
    return this.selectedAgentId;
  }
}

/**
 * Create a controller with dependencies.
 */
export function makeController(deps: {
  worldGenerator: WorldGenerator;
  makeDecisionMaker: () => DecisionMaker;
}): SimController {
  return new SimController(deps.worldGenerator, deps.makeDecisionMaker);
}

/**
 * Create an HTTP server that serves the simulation page and API.
 */
export function createServer(controller: SimController, port: number = 0) {
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/") {
        // Serve the HTML page.
        return new Response(renderPage(), {
          headers: { "content-type": "text/html" },
        });
      }
      if (url.pathname === "/api/state") {
        if (!controller.world) {
          return new Response(JSON.stringify({ error: "no world" }), { status: 400 });
        }
        const safe = viewerSafeState(controller.world);
        return new Response(JSON.stringify(safe), {
          headers: { "content-type": "application/json" },
        });
      }
      // For simplicity, we ignore other routes.
      return new Response("Not found", { status: 404 });
    },
  });
  return {
    server,
    stop: () => {
      server.stop(true);
    },
  };
}