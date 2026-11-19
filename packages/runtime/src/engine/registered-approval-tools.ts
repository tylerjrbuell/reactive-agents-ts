/**
 * registered-approval-tools.ts — the tools an approval policy must gate,
 * read from the LIVE tool registry at the start of each reasoning pass.
 *
 * The builder folds approval-needing tools into `policy.tools` at build time
 * (`configureApprovalPolicy`), but only the tools it can see then: built-ins,
 * the shell and custom tools. MCP tools are discovered when their server
 * connects, after build; sub-agent tools (`.withAgentTool`, default
 * `requiresApproval: true`) and tools added with `agent.registerTool()` are
 * registered after build too. None of them reached the gate, under any
 * strategy (security finding during audit G6, 2026-11-18).
 *
 * This reads the registry once per pass and returns the names that need
 * approval ({@link toolNeedsApproval}). `buildRunEnvelopeFromConfig` adds them
 * to the gated set, so the kernel gate (block and detach) and code-action's
 * refusal check see them. No approval policy ⇒ no registry read, empty list.
 */
import { Effect } from "effect";
import { ToolService } from "@reactive-agents/tools";
import type { ReactiveAgentsConfig } from "../types.js";
import { requiresApprovalToolNames } from "../builder/build-effect/approval-autofeed.js";

/**
 * Names of registered tools an active approval policy must gate. Empty when
 * the agent has no approval policy or no ToolService. Only ever ADDS names: a
 * registry read failure adds none, and the build-time list still applies.
 */
export const registeredApprovalTools = (
  config: Pick<ReactiveAgentsConfig, "approvalPolicy">,
): Effect.Effect<readonly string[], never> =>
  config.approvalPolicy === undefined
    ? Effect.succeed([])
    : Effect.serviceOption(ToolService).pipe(
        Effect.flatMap((opt) =>
          opt._tag === "Some"
            ? opt.value.listTools().pipe(Effect.map(requiresApprovalToolNames))
            : Effect.succeed<readonly string[]>([]),
        ),
        Effect.catchAll(() => Effect.succeed<readonly string[]>([])),
      );
