import { describe, expect, test, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { renderHook, render, fireEvent, act } from "@testing-library/react";
import type { FetchLike, PendingInteractionWire } from "@reactive-agents/ui-core";
import { useInteractions } from "../src/hooks/use-interactions.js";
import { AgentPrompt } from "../src/components/AgentPrompt.js";
import { ApprovalGate } from "../src/components/ApprovalGate.js";

beforeAll(() => {
  if (!globalThis.document) GlobalRegistrator.register();
});

describe("Interact", () => {
  test("useInteractions.respond posts and returns success", async () => {
    let body: unknown;
    const fetchImpl: FetchLike = async (_i, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ success: true, output: "done" }), { status: 200 });
    };
    const { result } = renderHook(() => useInteractions({ interactionEndpoint: "/api/interaction", fetchImpl }));
    let res: { success: boolean; output: string } = { success: false, output: "" };
    await act(async () => {
      res = await result.current.respond("r1", "i1", "blue");
    });
    expect(res.success).toBe(true);
    expect(body).toEqual({ runId: "r1", interactionId: "i1", value: "blue" });
  });

  test("AgentPrompt renders a choice interaction and submits the picked value", () => {
    const interaction: PendingInteractionWire = {
      runId: "r1",
      interactionId: "i1",
      kind: "choice",
      prompt: "Pick one",
      schema: { options: ["red", "blue"] },
    };
    let submitted: unknown;
    const { getByText } = render(<AgentPrompt interaction={interaction} onRespond={(v) => (submitted = v)} />);
    expect(getByText("Pick one")).toBeDefined();
    fireEvent.click(getByText("blue"));
    expect(submitted).toBe("blue");
  });

  test("AgentPrompt with malformed (non-array) schema.options does not throw", () => {
    const interaction: PendingInteractionWire = {
      runId: "r1",
      interactionId: "i1",
      kind: "choice",
      prompt: "Pick one",
      schema: { options: "not-an-array" },
    };
    const { container } = render(<AgentPrompt interaction={interaction} onRespond={() => {}} />);
    expect(container.querySelector("[data-ra-choice]")).not.toBeNull();
    expect(container.querySelectorAll("[data-ra-choice-option]").length).toBe(0);
  });

  test("ApprovalGate fires approve/deny", () => {
    let decision = "";
    const { getByText } = render(
      <ApprovalGate approval={{ runId: "r1", gateId: "g1", toolName: "shell", args: {} }} onDecide={(d) => (decision = d)} />,
    );
    fireEvent.click(getByText(/approve/i));
    expect(decision).toBe("approve");
  });
});
