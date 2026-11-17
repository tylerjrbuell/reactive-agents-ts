/**
 * interaction-structured.test.ts — structured multi-part `request_user_input`.
 *
 * The model sends `questions` (typed, id-keyed); the host (live askUser rail) or
 * the durable resume path answers with an id-keyed map. The kernel validates the
 * map against the request and feeds back the typed StructuredAnswer JSON, or a
 * tool-result error that keeps the run going so the model can ask again.
 * Legacy `{ kind, prompt, schema }` calls are pinned in interaction-live.test.ts.
 *
 * The first block drives the REAL kernel (`runKernel` + scripted LLM) and reads
 * the literal tool_result text the model receives on its next turn.
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { LLMService, TestLLMService, TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import type { LLMMessage } from "@reactive-agents/llm-provider";
import { TextParseDriver, REQUEST_USER_INPUT_TOOL_NAME, type Question } from "@reactive-agents/tools";
import type { InteractionQuestion } from "@reactive-agents/core";
import { handleActing } from "../../../src/kernel/capabilities/act/act.js";
import type { AskUserRail, AskUserRequest } from "../../../src/kernel/capabilities/act/user-interaction.js";
import { runInteractionResumeReentry } from "../../../src/kernel/loop/runner-resume-reentry.js";
import { runKernel } from "../../../src/kernel/loop/runner.js";
import { reactKernel } from "../../../src/kernel/loop/react-kernel.js";
import { buildRunEnvelope, provideTestEnvelope } from "../../../src/kernel/envelope/run-envelope.js";
import { mockToolServiceLayer } from "../../../src/testing/tool-service-mock.js";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelInput,
  type KernelState,
  type ToolServiceInstance,
} from "../../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../src/context/context-profile.js";
import type { StepId } from "../../../src/types/step.js";

// ─── Type-level: tools' Question is assignable to core's InteractionQuestion ───
const _questionMirror = (q: Question): InteractionQuestion => q;
void _questionMirror;

const QUESTIONS: readonly Question[] = [
  {
    id: "speed",
    prompt: "Which shipping speed?",
    type: "single-choice",
    options: [{ label: "Standard", value: "standard" }, { label: "Express", value: "express" }],
  },
  { id: "insured", prompt: "Insure the parcel?", type: "boolean" },
  { id: "parcels", prompt: "How many parcels?", type: "number", min: 1, max: 10 },
];

const ASK_ARGS = { questions: QUESTIONS };
const GOOD_ANSWERS = { speed: "express", insured: true, parcels: 3 };

// ─── Real kernel, scripted LLM ────────────────────────────────────────────────

const ASK_SCHEMA = { name: REQUEST_USER_INPUT_TOOL_NAME, description: "ask user", parameters: [] };

function recordingLLM(scenario: Parameters<typeof TestLLMService>[0]) {
  const turns: (readonly LLMMessage[])[] = [];
  const base = TestLLMService(scenario);
  const record = (req: { messages: readonly LLMMessage[]; purpose?: string }) => {
    if (req.purpose === undefined || req.purpose === "think") turns.push(req.messages);
  };
  const layer = Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      complete: (req) => {
        record(req as never);
        return base.complete(req);
      },
      stream: (req) => {
        record(req as never);
        return base.stream(req);
      },
    }),
  );
  return { layer, turns };
}

const toolLayer = () =>
  mockToolServiceLayer({
    execute: () => Effect.succeed({ success: true, result: "ok" }),
    getTool: () => Effect.fail(new Error("no schema")),
    listTools: () => Effect.succeed([ASK_SCHEMA]),
  });

/** Drive the real kernel: turn 1 asks, turn 2 answers. Returns what the model read on turn 2. */
async function driveKernel(
  askArgs: Record<string, unknown>,
  askUser: AskUserRail,
): Promise<{ asked: AskUserRequest[]; toolResult: string | undefined }> {
  const asked: AskUserRequest[] = [];
  const { layer, turns } = recordingLLM([
    { toolCall: { name: REQUEST_USER_INPUT_TOOL_NAME, args: askArgs } },
    { text: "Thanks, all done." },
  ] as never);
  const input = {
    task: "Ship the parcel after asking the user for the details.",
    availableToolSchemas: [ASK_SCHEMA],
    allToolSchemas: [ASK_SCHEMA],
    metaTools: { userInteraction: true },
  } as KernelInput;
  await Effect.runPromise(
    provideTestEnvelope(
      runKernel(reactKernel, input, { maxIterations: 4, strategy: "react", kernelType: "react" } as never),
      buildRunEnvelope({
        askUser: (req) => {
          asked.push(req);
          return askUser(req);
        },
      }),
    ).pipe(Effect.provide(Layer.merge(layer, toolLayer()))),
  );
  const second = turns[1] ?? [];
  const result = second.find((m) => m.role === "tool_result" || m.role === "tool");
  return { asked, toolResult: typeof result?.content === "string" ? result.content : undefined };
}

describe("structured request_user_input — real kernel, scripted LLM", () => {
  it("3-part question (single-choice + boolean + number): the model reads the typed answer map", async () => {
    const { asked, toolResult } = await driveKernel(ASK_ARGS, () =>
      Effect.succeed({ answered: true, value: GOOD_ANSWERS }),
    );
    expect(asked).toHaveLength(1);
    expect(asked[0]!.structured).toBe(true);
    expect(asked[0]!.questions.map((q) => q.id)).toEqual(["speed", "insured", "parcels"]);
    expect(JSON.parse(toolResult ?? "null")).toEqual({
      status: "answered",
      answers: {
        speed: { status: "answered", value: "express" },
        insured: { status: "answered", value: true },
        parcels: { status: "answered", value: 3 },
      },
    });
  }, 30000);

  it("invalid answers: the model reads a rejection naming the fault and the run goes on", async () => {
    const { toolResult } = await driveKernel(ASK_ARGS, () =>
      Effect.succeed({ answered: true, value: { speed: "overnight", insured: true, parcels: 99 } }),
    );
    expect(toolResult).toContain("The answers were rejected");
    expect(toolResult).toContain("'speed' must be one of: standard, express");
    expect(toolResult).toContain("'parcels' must be between 1 and 10");
  }, 30000);

  it("malformed request: the host is never asked and the model reads why", async () => {
    const { asked, toolResult } = await driveKernel(
      { questions: [{ id: "a", prompt: "Pick", type: "single-choice" }] },
      () => Effect.succeed({ answered: true, value: {} }),
    );
    expect(asked).toHaveLength(0);
    expect(toolResult).toContain("The request was rejected");
    expect(toolResult).toContain("needs a non-empty options list");
  }, 30000);
});

// ─── handleActing level ───────────────────────────────────────────────────────

function successToolService(): Option.Option<ToolServiceInstance> {
  return Option.some({
    execute: (req) => Effect.succeed({ success: true, result: { ok: req.toolName } }),
    getTool: () => Effect.fail(new Error("no schema")),
    listTools: () => Effect.succeed([]),
  });
}

function baseState(args: Record<string, unknown>): KernelState {
  return {
    ...initialKernelState({ maxIterations: 5, strategy: "react-kernel", kernelType: "react", taskId: "structured-ask" }),
    status: "acting",
    steps: [{ id: "thought-1" as StepId, type: "thought", content: "ask", timestamp: new Date() }],
    meta: {
      pendingNativeToolCalls: [{ id: "ask-1", name: REQUEST_USER_INPUT_TOOL_NAME, arguments: args }],
      lastThought: "ask",
      lastThinking: null,
    },
  };
}

const ctx: KernelContext = {
  input: {
    task: "book the shipment",
    availableToolSchemas: [ASK_SCHEMA],
    metaTools: { userInteraction: true },
  } as KernelContext["input"],
  profile: CONTEXT_PROFILES["mid"],
  compression: { budget: 800, previewItems: 3, autoStore: true, codeTransform: true },
  toolService: successToolService(),
  hooks: noopHooks,
  toolCallingDriver: new TextParseDriver(),
};

const act = (args: Record<string, unknown>, askUser?: AskUserRail) =>
  Effect.runPromise(
    provideTestEnvelope(handleActing(baseState(args), ctx), buildRunEnvelope(askUser ? { askUser } : {})).pipe(
      Effect.provide(TestLLMServiceLayer()),
    ),
  );

const toolResultOf = (s: KernelState) => s.messages.find((m) => m.role === "tool_result");

describe("structured request_user_input — act phase", () => {
  it("timeout maps to timeoutAnswer: every question is timeout", async () => {
    const s = await act(ASK_ARGS, () => Effect.succeed({ answered: false, reason: "timed out after 60000ms" }));
    expect(s.status).toBe("thinking");
    expect(JSON.parse(toolResultOf(s)?.content ?? "null")).toEqual({
      status: "timeout",
      answers: { speed: { status: "timeout" }, insured: { status: "timeout" }, parcels: { status: "timeout" } },
    });
  });

  it("a non-timeout refusal keeps the honest 'did not answer' text", async () => {
    const s = await act(ASK_ARGS, () => Effect.succeed({ answered: false, reason: "dismissed by the user" }));
    expect(toolResultOf(s)?.content).toBe("The user did not answer: dismissed by the user");
  });

  it("legacy single-question call is unchanged and carries normalized questions", async () => {
    const asked: AskUserRequest[] = [];
    const s = await act(
      { kind: "choice", prompt: "Which speed?", schema: { options: ["standard", "express"] } },
      (req) => {
        asked.push(req);
        return Effect.succeed({ answered: true, value: "express" });
      },
    );
    expect(toolResultOf(s)?.content).toBe('The user responded: "express"');
    expect(asked[0]!.structured).toBe(false);
    expect(asked[0]!.questions[0]).toMatchObject({ id: "answer", type: "single-choice" });
  });

  it("durable: a structured call pauses with its questions stored", async () => {
    const s = await act(ASK_ARGS);
    expect(s.meta.terminatedBy).toBe("awaiting-interaction");
    expect(s.meta.awaitingInteractionFor?.kind).toBe("structured");
    expect(JSON.parse(s.meta.awaitingInteractionFor?.schemaJson ?? "{}").questions).toHaveLength(3);
  });

  it("durable: a malformed request does not pause; the model reads the error", async () => {
    const s = await act({ questions: [] });
    expect(s.meta.awaitingInteractionFor).toBeUndefined();
    expect(s.status).toBe("thinking");
    expect(toolResultOf(s)?.content).toContain("The request was rejected: questions must not be empty");
  });

  // Live Cortex plan trace 01M7N75MCD0EGQ00SSTF3NA81R: mimo-v2.6 mixed the legacy
  // `prompt`/`kind` keys with a `questions` entry lacking id/prompt and a "choice" type.
  // The tools layer now heals this call (prompt promoted, id synthesized, choice -> single-choice).
  it("a mixed legacy/structured call is healed: it parses and the user is asked", async () => {
    const asked: AskUserRequest[] = [];
    const s = await act(
      {
        prompt: "Which git repository should I inspect?",
        kind: "choice",
        questions: [{ options: ["The repository I'm currently in", "I'll specify a path"], type: "choice" }],
      },
      (req) => {
        asked.push(req);
        return Effect.succeed({ answered: true, value: "I'll specify a path" });
      },
    );
    expect(asked).toHaveLength(1);
    expect(asked[0]!.questions[0]).toMatchObject({ prompt: "Which git repository should I inspect?", type: "single-choice" });
    expect(toolResultOf(s)?.content ?? "").not.toContain("The request was rejected");
  });

  it("a genuinely ambiguous call (entries with no prompt and no options, no top-level prompt) is rejected with a worked example", async () => {
    const s = await act({ questions: [{ type: "text" }] });
    expect(s.status).toBe("thinking");
    const content = toolResultOf(s)?.content ?? "";
    expect(content).toContain("The request was rejected: invalid questions: each needs id, prompt and type");
    expect(content).toContain('"questions":[{"id":');
  });
});

// ─── Durable resume ───────────────────────────────────────────────────────────

describe("structured request_user_input — durable resume", () => {
  const resume = async (valueJson: string) => {
    const paused = await act(ASK_ARGS);
    const pending = paused.meta.awaitingInteractionFor!;
    return Effect.runPromise(
      runInteractionResumeReentry({
        state: paused,
        effectiveInput: {
          task: "t",
          interactionResponse: { interactionId: pending.interactionId, valueJson },
        } as KernelInput,
      }),
    );
  };

  it("valid id-keyed map: the typed StructuredAnswer is the call's result and the pause clears", async () => {
    const s = await resume(JSON.stringify(GOOD_ANSWERS));
    expect(s.status).toBe("thinking");
    expect(s.meta.awaitingInteractionFor).toBeUndefined();
    expect(JSON.parse(toolResultOf(s)?.content ?? "null")).toMatchObject({
      status: "answered",
      answers: { speed: { value: "express" }, insured: { value: true }, parcels: { value: 3 } },
    });
  });

  it("invalid map: the model reads a rejection and the run continues", async () => {
    const s = await resume(JSON.stringify({ speed: "express", insured: "yes" }));
    expect(s.status).toBe("thinking");
    expect(toolResultOf(s)?.content).toContain("The answers were rejected");
    expect(toolResultOf(s)?.content).toContain("'insured' must be true or false");
    expect(toolResultOf(s)?.content).toContain("'parcels' is required");
  });

  it("legacy pause still resumes with the raw value text", async () => {
    const paused = await act({ kind: "choice", prompt: "Which speed?", schema: { options: ["a", "b"] } });
    const s = await Effect.runPromise(
      runInteractionResumeReentry({
        state: paused,
        effectiveInput: {
          task: "t",
          interactionResponse: { interactionId: paused.meta.awaitingInteractionFor!.interactionId, valueJson: '"a"' },
        } as KernelInput,
      }),
    );
    expect(toolResultOf(s)?.content).toBe('The user responded: "a"');
  });
});
