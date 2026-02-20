import { Layer } from "effect";
import { EventBusLive } from "./services/event-bus.js";
import { AgentServiceLive } from "./services/agent-service.js";
import { TaskServiceLive } from "./services/task-service.js";
import { ContextWindowManagerLive } from "./services/context-window-manager.js";

/**
 * Complete core services layer.
 * Provides: EventBus, AgentService, TaskService, ContextWindowManager
 *
 * Usage:
 *   myProgram.pipe(Effect.provide(CoreServicesLive))
 */
export const CoreServicesLive = Layer.mergeAll(
  AgentServiceLive,
  TaskServiceLive,
  ContextWindowManagerLive,
).pipe(Layer.provide(EventBusLive));
