import { Layer } from "effect";

import { EventBusLive } from "@reactive-agents/core";
import { ToolServiceLive } from "./tool-service.js";

/**
 * Creates the full Tools layer with all dependencies wired.
 * Requires EventBus to be provided (or uses EventBusLive by default).
 */
export const createToolsLayer = () =>
  ToolServiceLive.pipe(Layer.provide(EventBusLive));

/**
 * ToolServiceLive layer that requires EventBus to be provided externally.
 * Use this when composing with a shared EventBus from the runtime.
 */
export const ToolsLayer = ToolServiceLive;
