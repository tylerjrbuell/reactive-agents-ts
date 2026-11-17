import { describe, expect, it } from "bun:test";
import { deskInterruptToast, interruptAnswerOf, interruptToast, pauseToast } from "./run-controls.js";

describe("interruptToast", () => {
  it("promises Continue only when the run was saved", () => {
    const saved = interruptToast("stop", { ok: true, persisted: true }, "on the Runs page");
    expect(saved).toMatchObject({ tone: "success", title: "Stopped" });
    expect(saved.detail).toContain("on the Runs page");
    const paused = interruptToast("pause", { ok: true, persisted: true }, "on the Runs page");
    expect(paused.title).toBe("Paused");
  });

  it("says plainly that a run without Durable runs cannot continue", () => {
    const t = interruptToast("pause", { ok: true, persisted: false }, "x");
    expect(t.tone).toBe("warning");
    expect(t.detail).toContain("Durable runs");
    expect(t.title).toBe("Stopped");
  });

  it("points a chat at /durable and a desk run at the Lab", () => {
    expect(pauseToast({ ok: true, persisted: false }).detail).toContain("with /durable");
    expect(pauseToast({ ok: true, persisted: false }).detail).not.toContain("Lab");
    expect(deskInterruptToast("stop", { ok: true, persisted: false }).detail).toContain("Lab · Execution");
  });

  it("reports a run that was not running and a server that did not answer", () => {
    expect(interruptToast("stop", { ok: true, persisted: false, stopped: false }, "x").title).toBe("Nothing was running");
    expect(interruptToast("stop", { ok: false }, "x").title).toBe("Could not stop the run");
  });

  it("the chat toast points at the reply", () => {
    expect(pauseToast({ ok: true, persisted: true }).detail).toContain("under the reply");
  });
});

describe("interruptAnswerOf", () => {
  it("reads persisted from the server body and treats a refusal as not ok", async () => {
    expect(await interruptAnswerOf(new Response(JSON.stringify({ ok: true, persisted: true })))).toEqual({ ok: true, persisted: true });
    expect(await interruptAnswerOf(new Response(JSON.stringify({ ok: true })))).toEqual({ ok: true, persisted: false });
    expect(await interruptAnswerOf(new Response("nope", { status: 500 }))).toEqual({ ok: false });
    expect(await interruptAnswerOf(new Response("not json"))).toEqual({ ok: true, persisted: false });
  });

  it("the desk toast points at the Runs page", () => {
    expect(deskInterruptToast("stop", { ok: true, persisted: true }).detail).toContain("Runs page");
  });
});
