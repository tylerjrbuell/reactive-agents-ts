/**
 * TDD: RunHandle / RunController
 *
 * RunController — pure state machine, no agent required.
 * RunHandle — AsyncGenerator<AgentStreamEvent> + control verbs returned by runStream().
 *
 * Checkpoint in runner.ts (pause/stop between iterations) requires the reasoning
 * path (real LLM). The integration tests below use withTestScenario (inline path)
 * so pause/stop state is tracked but the checkpoint never fires mid-run.
 */
import { describe, it, expect } from "bun:test";
import { RunController } from "../src/run-controller.js";
import { ReactiveAgents } from "../src/builder.js";

// ─── RunController unit tests ──────────────────────────────────────────────

describe("RunController", () => {
    it("starts with running status", () => {
        const ctrl = new RunController(new AbortController());
        expect(ctrl.status()).toBe("running");
    });

    it("pause() transitions to paused", () => {
        const ctrl = new RunController(new AbortController());
        ctrl.pause();
        expect(ctrl.status()).toBe("paused");
    });

    it("resume() after pause() transitions back to running", () => {
        const ctrl = new RunController(new AbortController());
        ctrl.pause();
        ctrl.resume();
        expect(ctrl.status()).toBe("running");
    });

    it("stop() transitions to stopped", () => {
        const ctrl = new RunController(new AbortController());
        ctrl.stop();
        expect(ctrl.status()).toBe("stopped");
    });

    it("terminate() transitions to terminated and aborts signal", () => {
        const abortCtrl = new AbortController();
        const ctrl = new RunController(abortCtrl);
        ctrl.terminate();
        expect(ctrl.status()).toBe("terminated");
        expect(abortCtrl.signal.aborted).toBe(true);
    });

    it("checkpoint() resolves immediately when running", async () => {
        const ctrl = new RunController(new AbortController());
        const result = await ctrl.checkpoint();
        expect(result).toBeUndefined();
    });

    it("checkpoint() awaits resume() when paused", async () => {
        const ctrl = new RunController(new AbortController());
        ctrl.pause();

        let resolved = false;
        const checkpointPromise = ctrl.checkpoint().then((r) => {
            resolved = true;
            return r;
        });

        // Yield to microtask queue — checkpoint should still be pending
        await Promise.resolve();
        expect(resolved).toBe(false);

        ctrl.resume();
        await checkpointPromise;
        expect(resolved).toBe(true);
    });

    it("checkpoint() returns { stop: true } when stopped", async () => {
        const ctrl = new RunController(new AbortController());
        ctrl.stop();
        const result = await ctrl.checkpoint();
        expect(result).toEqual({ stop: true });
    });

    it("stop() while paused releases checkpoint with { stop: true }", async () => {
        const ctrl = new RunController(new AbortController());
        ctrl.pause();

        const checkpointPromise = ctrl.checkpoint();
        ctrl.stop(); // releases the pause
        const result = await checkpointPromise;

        expect(result).toEqual({ stop: true });
        expect(ctrl.status()).toBe("stopped");
    });

    it("terminate() while paused releases checkpoint", async () => {
        const ctrl = new RunController(new AbortController());
        ctrl.pause();

        const checkpointPromise = ctrl.checkpoint();
        ctrl.terminate(); // hard abort, releases pause
        const result = await checkpointPromise;

        // After terminate, stopRequested is NOT set — terminate uses abort, not stop
        expect(result).toBeUndefined();
        expect(ctrl.status()).toBe("terminated");
    });

    it("pause() is a no-op when not running", () => {
        const ctrl = new RunController(new AbortController());
        ctrl.stop();
        ctrl.pause(); // should not change status
        expect(ctrl.status()).toBe("stopped");
    });

    it("resume() is a no-op when not paused", () => {
        const ctrl = new RunController(new AbortController());
        ctrl.resume(); // no-op — not paused
        expect(ctrl.status()).toBe("running");
    });

    it("markCompleted() transitions running to completed", () => {
        const ctrl = new RunController(new AbortController());
        ctrl.markCompleted();
        expect(ctrl.status()).toBe("completed");
    });

    it("markCompleted() is a no-op when stopped", () => {
        const ctrl = new RunController(new AbortController());
        ctrl.stop();
        ctrl.markCompleted();
        expect(ctrl.status()).toBe("stopped");
    });
});

// ─── RunHandle integration tests ──────────────────────────────────────────

describe("RunHandle", () => {
    it("runStream() returns object with control methods", async () => {
        const agent = await ReactiveAgents.create()
            .withTestScenario([{ text: "done" }])
            .build();

        const handle = agent.runStream("test");
        expect(typeof handle.pause).toBe("function");
        expect(typeof handle.resume).toBe("function");
        expect(typeof handle.stop).toBe("function");
        expect(typeof handle.terminate).toBe("function");
        expect(typeof handle.status).toBe("function");

        // Drain to avoid leaked resources
        for await (const _ of handle) { /* drain */ }
        await agent.dispose();
    });

    it("RunHandle is still async iterable (for await works)", async () => {
        const agent = await ReactiveAgents.create()
            .withTestScenario([{ text: "FINAL ANSWER: done" }])
            .build();

        const events: string[] = [];
        for await (const ev of agent.runStream("test")) {
            events.push(ev._tag);
        }

        expect(events).toContain("StreamCompleted");
        await agent.dispose();
    });

    it("RunHandle.next() works (AsyncGenerator protocol)", async () => {
        const agent = await ReactiveAgents.create()
            .withTestScenario([{ text: "FINAL ANSWER: hi" }])
            .build();

        const handle = agent.runStream("test");
        const first = await handle.next();
        expect(first.done).toBe(false);

        // Drain
        for await (const _ of handle) { /* drain */ }
        await agent.dispose();
    });

    it("status() starts as running", async () => {
        const agent = await ReactiveAgents.create()
            .withTestScenario([{ text: "done" }])
            .build();

        const handle = agent.runStream("test");
        expect(handle.status()).toBe("running");

        for await (const _ of handle) { /* drain */ }
        await agent.dispose();
    });

    it("status() is completed after stream finishes", async () => {
        const agent = await ReactiveAgents.create()
            .withTestScenario([{ text: "done" }])
            .build();

        const handle = agent.runStream("test");
        for await (const _ of handle) { /* drain */ }

        expect(handle.status()).toBe("completed");
        await agent.dispose();
    });

    it("terminate() via RunHandle aborts stream → StreamCancelled", async () => {
        const agent = await ReactiveAgents.create()
            .withName("run-handle-terminate")
            .withTestScenario([{ text: "slow response", delayMs: 500 }])
            .build();

        const handle = agent.runStream("test");
        const tags: string[] = [];

        const timer = setTimeout(() => handle.terminate(), 50);
        try {
            for await (const ev of handle) {
                tags.push(ev._tag);
            }
        } finally {
            clearTimeout(timer);
        }

        expect(tags).toContain("StreamCancelled");
        expect(tags).not.toContain("StreamCompleted");
        expect(handle.status()).toBe("terminated");
        await agent.dispose();
    }, 10_000);

    it("passing signal to runStream still works alongside RunHandle", async () => {
        const agent = await ReactiveAgents.create()
            .withTestScenario([{ text: "done" }])
            .build();

        const ctrl = new AbortController();
        const events: string[] = [];
        for await (const ev of agent.runStream("test", { signal: ctrl.signal })) {
            events.push(ev._tag);
        }

        expect(events).toContain("StreamCompleted");
        await agent.dispose();
    });
});
