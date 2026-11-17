/**
 * Per-conversation tool wiring for channel-routed agents.
 *
 * Two router capabilities bind to ONE conversation, so the agent that serves it is built per
 * conversation (see `perConversation` in the resolver) and these tools are installed on the builder
 * before `build()`:
 *  - the `follow-up` tool, from the session's `FollowUpPort` (`makeFollowUpTool`), registered only
 *    where the route's tool exposure allows a mutating tool (never on a `ReadOnly` surface);
 *  - the fold boundary: every custom tool's result carries the messages that arrived while the turn
 *    ran (`RoutedTurn.takeFolded`), so the model sees them at its next decision. The framework has no
 *    kernel-level mid-turn injection point, so a turn that only calls built-in tools drains nothing
 *    and the router runs the leftover text as one follow-up turn.
 */
import { Effect } from "effect";
import { makeFollowUpTool } from "@reactive-agents/channels";
import type { FollowUpPort, ToolExposure } from "@reactive-agents/channels";
import type { ToolDefinition } from "@reactive-agents/tools";
import type { ReactiveAgentBuilder } from "../builder.js";
import { asBuilderState } from "../builder/withers/_state.js";
import type { ToolsOptions } from "../builder/types.js";

/** The running turn's fold drain; set by the resolver around each `send`. */
export interface TurnSlot {
  takeFolded: (() => ReadonlyArray<string>) | undefined;
}

type ToolEntry = NonNullable<ToolsOptions["tools"]>[number];

/** The tool name the router's follow-up capability registers under. */
export const FOLLOW_UP_TOOL_NAME = "follow-up";

/** Convert the channels `FollowUpTool` for `port` into a registrable tool (definition + handler). */
export const followUpToolEntry = (port: FollowUpPort): ToolEntry => {
  const tool = makeFollowUpTool(port);
  const definition: ToolDefinition = {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters.map((p) => ({ ...p })),
    riskLevel: "low",
    timeoutMs: 10_000,
    requiresApproval: false,
    mutatesExternalState: true,
    category: "productivity",
    source: "function",
  };
  return { definition, handler: (args) => tool.execute(args) };
};

/** Wrap a tool so its result also carries messages folded into the running turn. */
export const withFoldBoundary = (entry: ToolEntry, slot: TurnSlot): ToolEntry => ({
  definition: entry.definition,
  handler: (args) =>
    Effect.map(entry.handler(args), (result) => {
      const folded = slot.takeFolded?.() ?? [];
      return folded.length === 0
        ? result
        : { result, userMessages: folded, note: "The user sent these messages while you were working. Take them into account." };
    }),
});

const exposesFollowUp = (exposure: ToolExposure): boolean =>
  exposure._tag === "AgentDefault" || (exposure._tag === "Allowlist" && exposure.tools.includes(FOLLOW_UP_TOOL_NAME));

/**
 * Install the per-conversation tools on `builder` (after tool narrowing, before `build()`).
 * Returns the names of the tools it added.
 */
export const installConversationTools = (
  builder: ReactiveAgentBuilder,
  input: { readonly exposure: ToolExposure; readonly followUp?: FollowUpPort; readonly slot: TurnSlot },
): readonly string[] => {
  const state = asBuilderState(builder);
  const options: ToolsOptions = state._toolsOptions ?? {};
  const added: ToolEntry[] = input.followUp && exposesFollowUp(input.exposure) ? [followUpToolEntry(input.followUp)] : [];
  const tools = [...(options.tools ?? []), ...added].map((t) => withFoldBoundary(t, input.slot));
  const addedNames = added.map((t) => t.definition.name);
  state._toolsOptions = {
    ...options,
    tools,
    ...(options.allowedTools ? { allowedTools: [...options.allowedTools, ...addedNames] } : {}),
  };
  return addedNames;
};
