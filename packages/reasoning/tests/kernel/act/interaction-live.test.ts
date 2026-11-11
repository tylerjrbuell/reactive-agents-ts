/**
 * interaction-live.test.ts — the live ask-user rail (`RunEnvelope.rails.askUser`).
 *
 * With `askUser` on the envelope, a `request_user_input` call is answered inline:
 * the run keeps going (status "thinking"), and the answer is the call's tool
 * result in `state.messages`, which is what the next think reads. An unanswered
 * question gives an honest tool result. Without `askUser` the durable pause is
 * unchanged (interaction-pause.test.ts covers that path; one case here pins it
 * under an envelope too).
 */
import { describe, it, expect } from "bun:test";
import { Effect, Option } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { TextParseDriver, REQUEST_USER_INPUT_TOOL_NAME } from "@reactive-agents/tools";
import { handleActing } from "../../../src/kernel/capabilities/act/act.js";
import type { AskUserRail, AskUserRequest } from "../../../src/kernel/capabilities/act/user-interaction.js";
import { buildRunEnvelope, provideTestEnvelope } from "../../../src/kernel/envelope/run-envelope.js";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelHooks,
  type KernelState,
  type ToolServiceInstance,
} from "../../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../src/context/context-profile.js";
import type { StepId } from "../../../src/types/step.js";

function successToolService(): Option.Option<ToolServiceInstance> {
  return Option.some({
    execute: (req) => Effect.succeed({ success: true, result: { ok: req.toolName } }),
    getTool: () => Effect.fail(new Error("no schema")),
    listTools: () => Effect.succeed([]),
  });
}

function baseState(): KernelState {
  return {
    ...initialKernelState({ maxIterations: 5, strategy: "react-kernel", kernelType: "react", taskId: "live-ask" }),
    status: "acting",
    steps: [{ id: "thought-1" as StepId, type: "thought", content: "ask", timestamp: new Date() }],
    meta: {
      pendingNativeToolCalls: [
        {
          id: "ask-1",
          name: REQUEST_USER_INPUT_TOOL_NAME,
          arguments: { kind: "choice", prompt: "Which shipping speed?", schema: { options: ["standard", "express"] } },
        },
      ],
      lastThought: "ask",
      lastThinking: null,
    },
  };
}

function ctx(hooks: KernelHooks = noopHooks): KernelContext {
  return {
    input: {
      task: "book the shipment",
      availableToolSchemas: [{ name: REQUEST_USER_INPUT_TOOL_NAME, description: "ask user", parameters: [] }],
      metaTools: { userInteraction: true },
    } as KernelContext["input"],
    profile: CONTEXT_PROFILES["mid"],
    compression: { budget: 800, previewItems: 3, autoStore: true, codeTransform: true },
    toolService: successToolService(),
    hooks,
    toolCallingDriver: new TextParseDriver(),
  };
}

const run = (askUser: AskUserRail | undefined, hooks?: KernelHooks) =>
  Effect.runPromise(
    provideTestEnvelope(
      handleActing(baseState(), ctx(hooks)),
      buildRunEnvelope(askUser ? { askUser } : {}),
    ).pipe(Effect.provide(TestLLMServiceLayer())),
  );

describe("request_user_input — live askUser rail", () => {
  it("answers inline: run continues and the answer is the call's tool result", async () => {
    const asked: AskUserRequest[] = [];
    const result = await run((req) => {
      asked.push(req);
      return Effect.succeed({ answered: true, value: "express" });
    });

    expect(asked).toHaveLength(1);
    expect(asked[0]!.kind).toBe("choice");
    expect(asked[0]!.prompt).toBe("Which shipping speed?");
    expect(asked[0]!.schema).toEqual({ options: ["standard", "express"] });

    expect(result.status).toBe("thinking");
    expect(result.meta.terminatedBy).toBeUndefined();
    expect(result.meta.awaitingInteractionFor).toBeUndefined();
    expect(result.iteration).toBe(1);
    // The next think assembles its prompt from messages: the pair must be there.
    const toolResult = result.messages.find((m) => m.role === "tool_result");
    expect(toolResult).toMatchObject({ toolCallId: "ask-1", toolName: REQUEST_USER_INPUT_TOOL_NAME });
    expect(toolResult?.content).toBe('The user responded: "express"');
    const call = result.messages.find((m) => m.role === "assistant");
    expect(call?.toolCalls?.[0]).toMatchObject({ id: "ask-1", name: REQUEST_USER_INPUT_TOOL_NAME });
    // Steps record the request + answer (ledger and trace read these).
    const action = result.steps.find((s) => s.type === "action");
    expect(action?.metadata?.toolUsed).toBe(REQUEST_USER_INPUT_TOOL_NAME);
    expect(result.steps.some((s) => s.type === "observation" && s.content.includes("express"))).toBe(true);
    expect(result.toolsUsed.has(REQUEST_USER_INPUT_TOOL_NAME)).toBe(true);
  });

  it("unanswered question gives an honest tool result and the run continues", async () => {
    const result = await run(() => Effect.succeed({ answered: false, reason: "timed out after 60000ms" }));
    expect(result.status).toBe("thinking");
    const toolResult = result.messages.find((m) => m.role === "tool_result");
    expect(toolResult?.content).toBe("The user did not answer: timed out after 60000ms");
    const obs = result.steps.find((s) => s.type === "observation");
    expect(obs?.metadata?.observationResult?.success).toBe(false);
  });

  it("a defect in the rail reads as unanswered, never a crash", async () => {
    const result = await run(() => Effect.die("boom"));
    expect(result.status).toBe("thinking");
    expect(result.messages.find((m) => m.role === "tool_result")?.content).toBe(
      "The user did not answer: the ask-user handler failed",
    );
  });

  it("trace records the request: ToolCallStarted/Completed hooks fire for the call", async () => {
    const actions: string[] = [];
    const observations: string[] = [];
    const hooks: KernelHooks = {
      ...noopHooks,
      onAction: (_s, tool, _input, opts) => Effect.sync(() => { actions.push(`${tool}:${opts?.callId}`); }),
      onObservation: (_s, result) => Effect.sync(() => { observations.push(result); }),
    };
    await run(() => Effect.succeed({ answered: true, value: { speed: "express" } }), hooks);
    expect(actions).toEqual([`${REQUEST_USER_INPUT_TOOL_NAME}:ask-1`]);
    expect(observations).toEqual(['The user responded: {"speed":"express"}']);
  });

  it("no askUser on the envelope keeps the durable pause", async () => {
    const result = await run(undefined);
    expect(result.meta.terminatedBy).toBe("awaiting-interaction");
    expect(result.meta.awaitingInteractionFor?.prompt).toBe("Which shipping speed?");
    expect(result.steps.some((s) => s.type === "observation")).toBe(false);
  });
});
