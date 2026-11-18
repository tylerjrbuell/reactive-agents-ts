/**
 * Type-only fixture for tool-builder-withtools-types.test.ts, which compiles
 * this file with the TypeScript compiler and expects zero diagnostics. Never
 * imported at runtime. A `@ts-expect-error` that stops erroring is itself a
 * diagnostic, so both directions are pinned.
 *
 * `ToolsOptions` is the real `.withTools()` options type (type-only import,
 * so the pin follows the runtime contract instead of a copy of it).
 */
import { Effect } from "effect";
import type { ToolsOptions } from "../../../runtime/src/builder/types.js";
import { ToolBuilder, type BuiltTool } from "../../src/tool-builder.js";

type ToolEntry = NonNullable<ToolsOptions["tools"]>[number];

const withEffectHandler = ToolBuilder.create("get_service_health")
  .description("Get health metrics for a service.")
  .param("service", "string", "Service name", { required: true })
  .handler((args) => Effect.succeed(JSON.stringify({ service: args.service })))
  .build();

// A built tool with an Effect handler goes straight into withTools.
export const fits: ToolsOptions = { tools: [withEffectHandler] };
export const entry: ToolEntry = withEffectHandler;

// The constructor form, chained the same way, fits too.
export const fromConstructor: ToolEntry = new ToolBuilder("ping")
  .description("Echo")
  .handler(({ message }) => Effect.succeed(`pong: ${String(message)}`))
  .build();

// The handler keeps its own type: calling it gives back the Effect.
export const ran: Effect.Effect<string> = withEffectHandler.handler({ service: "x" });

const withoutHandler = ToolBuilder.create("no-handler").description("Definition only").build();
// The definition alone is still usable.
export const def: ToolEntry["definition"] = withoutHandler.definition;
// @ts-expect-error a built tool without a handler cannot run, so withTools rejects it.
export const rejected: ToolEntry = withoutHandler;

// A bare `new ToolBuilder()` without .handler() is rejected the same way.
// @ts-expect-error no handler was set.
export const rejectedCtor: ToolEntry = new ToolBuilder("bare").description("d").build();

// withTools runs handlers as Effects; a plain-value handler is rejected there.
const plain = ToolBuilder.create("plain")
  .description("Plain value")
  .handler(() => "pong")
  .build();
// @ts-expect-error withTools needs an Effect-returning handler.
export const rejectedPlain: ToolEntry = plain;

// A bare `ToolBuilder` annotation accepts both states (toolBuilderToEntry's parameter).
export const anyState: ToolBuilder[] = [ToolBuilder.create("a"), ToolBuilder.create("b").handler(() => 1)];

// BuiltTool resolves per state.
export const noHandlerShape: BuiltTool<undefined> = { definition: withoutHandler.definition };
