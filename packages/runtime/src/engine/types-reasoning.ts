/**
 * Shared narrow type for the ReasoningService consumed by extracted phase
 * modules. Sourced from the canonical Tag in `@reactive-agents/reasoning` so
 * the parameter shape stays in lockstep with the actual service contract.
 *
 * Three modules previously inlined a local `ReasoningServiceLike` with subtly
 * different parameter shapes (some used `Record<string, unknown>`; one had
 * `taskType?: string` when the actual service requires `taskType: string`).
 * The mismatches surface only in the dts build (parameters are contravariant,
 * so a looser target rejects the stricter source). Hoisting to a single
 * canonical alias eliminates the divergence.
 */
import type { Context } from "effect";
import type { ReasoningService } from "@reactive-agents/reasoning";

export type ReasoningServiceLike = Context.Tag.Service<typeof ReasoningService>;
