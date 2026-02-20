import { Effect, Context, Layer, Ref } from "effect";
import type { Agent, AgentConfig, AgentId } from "../types/agent.js";
import { generateAgentId } from "../id.js";
import { AgentError, AgentNotFoundError } from "../errors/errors.js";
import { EventBus } from "./event-bus.js";

// ─── Service Tag ───

export class AgentService extends Context.Tag("AgentService")<
  AgentService,
  {
    /** Create a new agent from config. */
    readonly create: (config: AgentConfig) => Effect.Effect<Agent, AgentError>;

    /** Retrieve an agent by ID. */
    readonly get: (id: AgentId) => Effect.Effect<Agent, AgentNotFoundError>;

    /** List all registered agents. */
    readonly list: () => Effect.Effect<readonly Agent[], never>;

    /** Delete an agent by ID. */
    readonly delete: (id: AgentId) => Effect.Effect<void, AgentNotFoundError>;
  }
>() {}

// ─── Live Implementation ───

export const AgentServiceLive = Layer.effect(
  AgentService,
  Effect.gen(function* () {
    const eventBus = yield* EventBus;
    const store = yield* Ref.make<Map<string, Agent>>(new Map());

    return {
      create: (config: AgentConfig) =>
        Effect.gen(function* () {
          const now = new Date();
          const agent: Agent = {
            id: generateAgentId(),
            name: config.name,
            description: config.description,
            capabilities: config.capabilities ?? [],
            config: config.config ?? {},
            state: config.initialState ?? {},
            createdAt: now,
            updatedAt: now,
          };
          yield* Ref.update(store, (m) => new Map(m).set(agent.id, agent));
          yield* eventBus.publish({ _tag: "AgentCreated", agentId: agent.id });
          return agent;
        }),

      get: (id: AgentId) =>
        Effect.gen(function* () {
          const m = yield* Ref.get(store);
          const agent = m.get(id);
          if (!agent) {
            return yield* Effect.fail(
              new AgentNotFoundError({
                agentId: id,
                message: `Agent ${id} not found`,
              }),
            );
          }
          return agent;
        }),

      list: () =>
        Effect.gen(function* () {
          const m = yield* Ref.get(store);
          return Array.from(m.values());
        }),

      delete: (id: AgentId) =>
        Effect.gen(function* () {
          const m = yield* Ref.get(store);
          if (!m.has(id)) {
            return yield* Effect.fail(
              new AgentNotFoundError({
                agentId: id,
                message: `Agent ${id} not found`,
              }),
            );
          }
          yield* Ref.update(store, (m) => {
            const next = new Map(m);
            next.delete(id);
            return next;
          });
        }),
    };
  }),
);
