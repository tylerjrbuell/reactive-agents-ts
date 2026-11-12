/**
 * Multimodal task input: `agent.run` / `runStream` / `chat` accept
 * `string | ContentPart[]`. Image parts reach the provider request; an
 * authoritative no-vision model fails fast with a typed UnsupportedModalityError;
 * text-only runs keep the plain-string form.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import type { ContentPart } from "@reactive-agents/core";
import {
  LLMService,
  TestLLMService,
  fallbackCapability,
  registerProbedCapability,
  _resetProbedRegistryForTesting,
} from "@reactive-agents/llm-provider";
import { ReactiveAgents } from "../src/builder.js";
import { UnsupportedModalityError } from "../src/errors.js";
import {
  appendTaskText,
  checkTaskInputModality,
  modelInputCapabilities,
  prependTaskText,
  taskInputText,
  toTaskInputPayload,
} from "../src/agent/task-input.js";
import { withHistoryBlock } from "../src/agent/history-block.js";

type Req = import("@reactive-agents/llm-provider").CompletionRequest;

const IMAGE: ContentPart = {
  type: "image",
  source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" },
};
const AUDIO: ContentPart = {
  type: "audio",
  source: { type: "base64", media_type: "audio/wav", data: "UklGRg==" },
};
const TEXT: ContentPart = { type: "text", text: "What is in this picture?" };

const register = (model: string, caps: { vision: boolean; audioIn?: boolean }): void =>
  registerProbedCapability({
    ...fallbackCapability("test", model),
    source: "probe",
    supportsVision: caps.vision,
    ...(caps.audioIn !== undefined ? { supportsAudioIn: caps.audioIn } : {}),
  });

const capturingLayer = (captured: Req[]): Layer.Layer<LLMService> => {
  const base = TestLLMService([{ text: "FINAL ANSWER: a cat" }]);
  return Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      complete: (r) => {
        captured.push(r);
        return base.complete(r);
      },
      stream: (r) => {
        captured.push(r);
        return base.stream(r);
      },
    }),
  );
};

const build = async (model: string, captured: Req[]) =>
  ReactiveAgents.create()
    .withName("mm")
    .withProvider("test")
    .withModel(model)
    .withReplayLLM(capturingLayer(captured))
    .build();

/** True when any message in any captured request carries an image part. */
const sawImage = (captured: readonly Req[]): boolean =>
  captured.some((r) =>
    r.messages.some(
      (m) => Array.isArray(m.content) && (m.content as readonly { type: string }[]).some((p) => p.type === "image"),
    ),
  );

afterEach(() => _resetProbedRegistryForTesting());

describe("task-input helpers", () => {
  it("text-only parts collapse to a plain string payload (no parts key)", () => {
    expect(toTaskInputPayload("hi")).toEqual({ question: "hi" });
    expect(toTaskInputPayload([{ type: "text", text: "hi" }])).toEqual({ question: "hi" });
  });

  it("payload keeps parts only when a non-text part exists; question is the text projection", () => {
    const payload = toTaskInputPayload([TEXT, IMAGE]);
    expect(payload.question).toBe(TEXT.type === "text" ? TEXT.text : "");
    expect(payload.parts).toEqual([TEXT, IMAGE]);
  });

  it("history and steering text keep media parts", () => {
    const withHistory = withHistoryBlock([TEXT, IMAGE], [{ role: "user", content: "earlier", timestamp: 1 }]);
    expect(Array.isArray(withHistory)).toBe(true);
    expect(taskInputText(withHistory)).toContain("--- Current message ---");
    expect((withHistory as readonly ContentPart[]).some((p) => p.type === "image")).toBe(true);
    const steered = appendTaskText([TEXT, IMAGE], "\nJSON please");
    expect(taskInputText(steered)).toEndWith("\nJSON please");
    expect(prependTaskText("x", (t) => `>${t}`)).toBe(">x");
  });

  it("modelInputCapabilities reports vision/audioIn and authority", () => {
    register("mic-model", { vision: true, audioIn: true });
    expect(modelInputCapabilities("test", "mic-model")).toEqual({ vision: true, audioIn: true, authoritative: true });
    const unknown = modelInputCapabilities("test", "never-heard-of-it");
    expect(unknown.authoritative).toBe(false);
  });
});

describe("modality preflight", () => {
  it("image + authoritative no-vision model -> typed error {partType, model}", () => {
    register("blind", { vision: false });
    const err = checkTaskInputModality([TEXT, IMAGE], "test", "blind");
    expect(err).toBeInstanceOf(UnsupportedModalityError);
    expect(err?.partType).toBe("image");
    expect(err?.model).toBe("blind");
  });

  it("audio fails only when supportsAudioIn is authoritatively false", () => {
    register("deaf", { vision: true, audioIn: false });
    expect(checkTaskInputModality([TEXT, AUDIO], "test", "deaf")?.partType).toBe("audio");
    register("unknown-ears", { vision: true });
    expect(checkTaskInputModality([TEXT, AUDIO], "test", "unknown-ears")).toBeUndefined();
  });

  it("non-authoritative (fallback) capability never blocks; text-only never blocks", () => {
    expect(checkTaskInputModality([TEXT, IMAGE], "test", "unregistered")).toBeUndefined();
    register("blind", { vision: false });
    expect(checkTaskInputModality("just text", "test", "blind")).toBeUndefined();
  });
});

describe("agent.run with parts", () => {
  it("image part reaches the provider request", async () => {
    register("seer", { vision: true });
    const captured: Req[] = [];
    const agent = await build("seer", captured);
    try {
      const result = await agent.run([TEXT, IMAGE]);
      expect(result.success).toBe(true);
      expect(sawImage(captured)).toBe(true);
    } finally {
      await agent.dispose();
    }
  });

  it("no-vision model + image rejects with UnsupportedModalityError before any model call", async () => {
    register("blind", { vision: false });
    const captured: Req[] = [];
    const agent = await build("blind", captured);
    try {
      const failure = await agent.run([TEXT, IMAGE]).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(failure).toBeInstanceOf(UnsupportedModalityError);
      expect((failure as UnsupportedModalityError).partType).toBe("image");
      expect((failure as UnsupportedModalityError).model).toBe("blind");
      expect(captured.length).toBe(0);
    } finally {
      await agent.dispose();
    }
  });

  it("runEffect: no-vision model + image fails the Effect with the typed error", async () => {
    register("blind", { vision: false });
    const captured: Req[] = [];
    const agent = await build("blind", captured);
    try {
      const either = await Effect.runPromise(Effect.either(agent.runEffect([TEXT, IMAGE])));
      expect(either._tag).toBe("Left");
      const left = either._tag === "Left" ? either.left : undefined;
      // runEffect's existing contract wraps rejections in a FiberFailure; the typed error is its cause.
      expect(String(left)).toContain("UnsupportedModalityError");
      expect(String(left)).toContain('Model "blind" does not accept image input');
      expect(captured.length).toBe(0);
    } finally {
      await agent.dispose();
    }
  });

  it("text-only task: no image, plain string seed (unchanged)", async () => {
    register("seer", { vision: true });
    const captured: Req[] = [];
    const agent = await build("seer", captured);
    try {
      await agent.run("What is 2 + 2?");
      expect(captured.length).toBeGreaterThan(0);
      expect(sawImage(captured)).toBe(false);
      expect(
        captured.every((r) => r.messages.every((m) => typeof m.content === "string" || Array.isArray(m.content))),
      ).toBe(true);
      const user = captured[0]!.messages.find((m) => m.role === "user");
      expect(typeof user?.content).toBe("string");
    } finally {
      await agent.dispose();
    }
  });

  it("all-text parts behave like the plain string", async () => {
    register("seer", { vision: true });
    const captured: Req[] = [];
    const agent = await build("seer", captured);
    try {
      await agent.run([{ type: "text", text: "What is 2 + 2?" }]);
      const user = captured[0]!.messages.find((m) => m.role === "user");
      expect(typeof user?.content).toBe("string");
    } finally {
      await agent.dispose();
    }
  });
});

describe("agent.runStream / chat with parts", () => {
  it("runStream: image reaches the provider", async () => {
    register("seer", { vision: true });
    const captured: Req[] = [];
    const agent = await build("seer", captured);
    try {
      const tags: string[] = [];
      for await (const ev of agent.runStream([TEXT, IMAGE])) tags.push(ev._tag);
      expect(tags).toContain("StreamCompleted");
      expect(sawImage(captured)).toBe(true);
    } finally {
      await agent.dispose();
    }
  });

  it("runStream: no-vision model + image rejects with the typed error", async () => {
    register("blind", { vision: false });
    const captured: Req[] = [];
    const agent = await build("blind", captured);
    try {
      const failure = await (async () => {
        try {
          for await (const _ of agent.runStream([TEXT, IMAGE])) void _;
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(failure).toBeInstanceOf(UnsupportedModalityError);
      expect(captured.length).toBe(0);
    } finally {
      await agent.dispose();
    }
  });

  it("chat: image routes through the agentic path and reaches the provider", async () => {
    register("seer", { vision: true });
    const captured: Req[] = [];
    const agent = await build("seer", captured);
    try {
      const reply = await agent.chat([TEXT, IMAGE]);
      expect(typeof reply.message).toBe("string");
      expect(sawImage(captured)).toBe(true);
    } finally {
      await agent.dispose();
    }
  });
});

describe("AgentSession accepts TaskInput", () => {
  it("session.chat: image part reaches the provider", async () => {
    register("seer", { vision: true });
    const captured: Req[] = [];
    const agent = await build("seer", captured);
    try {
      const reply = await agent.session().chat([TEXT, IMAGE]);
      expect(typeof reply.message).toBe("string");
      expect(sawImage(captured)).toBe(true);
    } finally {
      await agent.dispose();
    }
  });

  it("session.chat: no-vision model + image rejects with the typed error", async () => {
    register("blind", { vision: false });
    const captured: Req[] = [];
    const agent = await build("blind", captured);
    try {
      const failure = await agent.session().chat([TEXT, IMAGE]).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect((failure as UnsupportedModalityError).partType).toBe("image");
      expect(captured.length).toBe(0);
    } finally {
      await agent.dispose();
    }
  });

  it("session.runStream: image part reaches the provider", async () => {
    register("seer", { vision: true });
    const captured: Req[] = [];
    const agent = await build("seer", captured);
    try {
      for await (const _ of agent.session().runStream([TEXT, IMAGE])) void _;
      expect(sawImage(captured)).toBe(true);
    } finally {
      await agent.dispose();
    }
  });
});

describe("listPendingApprovals declared type", () => {
  it("includes optional subAgent", () => {
    type Item = Awaited<ReturnType<import("../src/reactive-agent.js").ReactiveAgent["listPendingApprovals"]>>[number];
    const item: Item = { runId: "r", gateId: "g", toolName: "t", args: {}, task: "x", updatedAt: 1, subAgent: "researcher" };
    expect(item.subAgent).toBe("researcher");
  });
});
