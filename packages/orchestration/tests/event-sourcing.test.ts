import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { makeEventSourcing } from "../src/durable/event-sourcing.js";
import type { Workflow, DomainEvent, Checkpoint, WorkflowStep } from "../src/types.js";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const makeTestStep = (id: string): WorkflowStep => ({
  id,
  name: `Step ${id}`,
  input: {},
  output: undefined,
  status: "pending",
  startedAt: undefined,
  completedAt: undefined,
  error: undefined,
  retryCount: 0,
  maxRetries: 3,
});

const makeTestWorkflow = (id: string, steps: WorkflowStep[]): Workflow => ({
  id: id as any,
  name: "Test Workflow",
  pattern: "sequential",
  steps,
  state: "running",
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe("EventSourcing", () => {
  it("saves and loads checkpoints", async () => {
    const es = await run(makeEventSourcing);
    const workflow = makeTestWorkflow("wf-1", [makeTestStep("step-1")]);

    const checkpoint: Checkpoint = {
      id: "cp-1",
      workflowId: workflow.id,
      timestamp: new Date(),
      state: workflow,
      eventIndex: 0,
    };

    await run(es.saveCheckpoint(checkpoint));
    const loaded = await run(es.loadLatestCheckpoint(workflow.id));

    expect(loaded.id).toBe("cp-1");
    expect(loaded.workflowId).toBe(workflow.id);
  });

  it("loads latest checkpoint when multiple exist", async () => {
    const es = await run(makeEventSourcing);
    const workflow = makeTestWorkflow("wf-2", [makeTestStep("step-1")]);

    const cp1: Checkpoint = {
      id: "cp-1",
      workflowId: workflow.id,
      timestamp: new Date(Date.now() - 10000),
      state: { ...workflow, state: "running" as const },
      eventIndex: 5,
    };

    const cp2: Checkpoint = {
      id: "cp-2",
      workflowId: workflow.id,
      timestamp: new Date(),
      state: { ...workflow, state: "paused" as const },
      eventIndex: 10,
    };

    await run(es.saveCheckpoint(cp1));
    await run(es.saveCheckpoint(cp2));

    const loaded = await run(es.loadLatestCheckpoint(workflow.id));
    expect(loaded.id).toBe("cp-2");
  });

  it("fails to load checkpoint for unknown workflow", async () => {
    const es = await run(makeEventSourcing);

    const error = await run(
      es.loadLatestCheckpoint("nonexistent" as any).pipe(Effect.flip),
    );

    expect(error._tag).toBe("CheckpointError");
  });

  it("replays events from checkpoint", async () => {
    const es = await run(makeEventSourcing);
    const workflow = makeTestWorkflow("wf-3", [makeTestStep("step-1")]);

    const checkpoint: Checkpoint = {
      id: "cp-1",
      workflowId: workflow.id,
      timestamp: new Date(),
      state: { ...workflow, state: "running" as const },
      eventIndex: 0,
    };

    const events: DomainEvent[] = [
      {
        type: "StepStarted",
        workflowId: workflow.id,
        timestamp: new Date(),
        payload: { stepId: "step-1", agentId: "agent-1" },
      },
      {
        type: "StepCompleted",
        workflowId: workflow.id,
        timestamp: new Date(),
        payload: { stepId: "step-1", output: "result" },
      },
      {
        type: "WorkflowCompleted",
        workflowId: workflow.id,
        timestamp: new Date(),
        payload: { result: ["result"] },
      },
    ];

    const replayed = await run(es.replayFromCheckpoint(checkpoint, events));

    expect(replayed.state).toBe("completed");
    expect(replayed.steps[0]?.status).toBe("completed");
    expect(replayed.steps[0]?.output).toBe("result");
  });

  it("reconstructs step state from events", async () => {
    const es = await run(makeEventSourcing);
    const workflow = makeTestWorkflow("wf-4", [makeTestStep("step-1")]);

    const checkpoint: Checkpoint = {
      id: "cp-1",
      workflowId: workflow.id,
      timestamp: new Date(),
      state: workflow,
      eventIndex: 0,
    };

    const events: DomainEvent[] = [
      {
        type: "StepStarted",
        workflowId: workflow.id,
        timestamp: new Date(),
        payload: { stepId: "step-1", agentId: "agent-1" },
      },
    ];

    const replayed = await run(es.replayFromCheckpoint(checkpoint, events));

    expect(replayed.steps[0]?.status).toBe("running");
    expect(replayed.steps[0]?.agentId).toBe("agent-1");
  });

  it("handles step failure events", async () => {
    const es = await run(makeEventSourcing);
    const workflow = makeTestWorkflow("wf-5", [makeTestStep("step-1")]);

    const checkpoint: Checkpoint = {
      id: "cp-1",
      workflowId: workflow.id,
      timestamp: new Date(),
      state: workflow,
      eventIndex: 0,
    };

    const events: DomainEvent[] = [
      {
        type: "StepStarted",
        workflowId: workflow.id,
        timestamp: new Date(),
        payload: { stepId: "step-1", agentId: "agent-1" },
      },
      {
        type: "StepFailed",
        workflowId: workflow.id,
        timestamp: new Date(),
        payload: { stepId: "step-1", error: "Something went wrong" },
      },
    ];

    const replayed = await run(es.replayFromCheckpoint(checkpoint, events));

    expect(replayed.steps[0]?.status).toBe("failed");
    expect(replayed.steps[0]?.error).toBe("Something went wrong");
  });

  it("handles workflow paused and resumed events", async () => {
    const es = await run(makeEventSourcing);
    const workflow = makeTestWorkflow("wf-6", [makeTestStep("step-1")]);

    const checkpoint: Checkpoint = {
      id: "cp-1",
      workflowId: workflow.id,
      timestamp: new Date(),
      state: workflow,
      eventIndex: 0,
    };

    const events: DomainEvent[] = [
      {
        type: "WorkflowPaused",
        workflowId: workflow.id,
        timestamp: new Date(),
        payload: { reason: "Manual pause" },
      },
    ];

    const replayed = await run(es.replayFromCheckpoint(checkpoint, events));
    expect(replayed.state).toBe("paused");
  });

  it("handles workflow failed event", async () => {
    const es = await run(makeEventSourcing);
    const workflow = makeTestWorkflow("wf-7", [makeTestStep("step-1")]);

    const checkpoint: Checkpoint = {
      id: "cp-1",
      workflowId: workflow.id,
      timestamp: new Date(),
      state: workflow,
      eventIndex: 0,
    };

    const events: DomainEvent[] = [
      {
        type: "WorkflowFailed",
        workflowId: workflow.id,
        timestamp: new Date(),
        payload: { error: "Unrecoverable error" },
      },
    ];

    const replayed = await run(es.replayFromCheckpoint(checkpoint, events));
    expect(replayed.state).toBe("failed");
  });

  it("handles empty event list in replay", async () => {
    const es = await run(makeEventSourcing);
    const workflow = makeTestWorkflow("wf-8", [makeTestStep("step-1")]);

    const checkpoint: Checkpoint = {
      id: "cp-1",
      workflowId: workflow.id,
      timestamp: new Date(),
      state: { ...workflow, state: "running" as const },
      eventIndex: 0,
    };

    const replayed = await run(es.replayFromCheckpoint(checkpoint, []));
    expect(replayed.state).toBe("running");
    expect(replayed.steps[0]?.status).toBe("pending");
  });

  it("replays only events after checkpoint index", async () => {
    const es = await run(makeEventSourcing);
    const workflow = makeTestWorkflow("wf-9", [makeTestStep("step-1")]);

    const checkpoint: Checkpoint = {
      id: "cp-1",
      workflowId: workflow.id,
      timestamp: new Date(),
      state: { ...workflow, state: "running" as const, steps: [{ ...makeTestStep("step-1"), status: "running" as const }] },
      eventIndex: 2,
    };

    const events: DomainEvent[] = [
      { type: "StepStarted", workflowId: workflow.id, timestamp: new Date(), payload: { stepId: "step-1", agentId: "a" } },
      { type: "StepCompleted", workflowId: workflow.id, timestamp: new Date(), payload: { stepId: "step-1", output: "x" } },
      { type: "StepStarted", workflowId: workflow.id, timestamp: new Date(), payload: { stepId: "step-1", agentId: "b" } },
    ];

    const replayed = await run(es.replayFromCheckpoint(checkpoint, events));

    expect(replayed.steps[0]?.status).toBe("running");
    expect(replayed.steps[0]?.agentId).toBe("b");
  });

  it("saves multiple checkpoints per workflow", async () => {
    const es = await run(makeEventSourcing);
    const workflow = makeTestWorkflow("wf-10", [makeTestStep("step-1")]);

    await run(
      es.saveCheckpoint({
        id: "cp-1",
        workflowId: workflow.id,
        timestamp: new Date(),
        state: { ...workflow, state: "running" as const },
        eventIndex: 5,
      }),
    );

    await run(
      es.saveCheckpoint({
        id: "cp-2",
        workflowId: workflow.id,
        timestamp: new Date(),
        state: { ...workflow, state: "paused" as const },
        eventIndex: 10,
      }),
    );

    await run(
      es.saveCheckpoint({
        id: "cp-3",
        workflowId: workflow.id,
        timestamp: new Date(),
        state: { ...workflow, state: "running" as const },
        eventIndex: 15,
      }),
    );

    const loaded = await run(es.loadLatestCheckpoint(workflow.id));
    expect(loaded.id).toBe("cp-3");
    expect(loaded.eventIndex).toBe(15);
  });
});
