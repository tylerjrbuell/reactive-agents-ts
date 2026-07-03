/**
 * @reactive-agents/ui-core — headless core for agent UI bindings.
 * Effect-free and dependency-free by design: this package runs in browsers.
 */
export * from "./protocol/events.js";
export * from "./parse-partial.js";
export { connectRunStream, type ConnectOptions, type FetchLike } from "./stream/connect.js";
export {
  initialRunState,
  reduceRunState,
  type RunState,
  type ReduceOptions,
} from "./state/run-machine.js";
