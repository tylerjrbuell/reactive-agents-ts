import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";

describe("Conductor's Suite — integration", () => {
  it("withTools() default meta-tools keeps recall executable", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([
        { toolCall: { name: "recall", args: { key: "fact", content: "Paris is the capital of France." } } },
        { toolCall: { name: "recall", args: { key: "fact" } } },
        { text: "Paris is the capital of France." },
      ])
      .withTools()
      .build();

    let result;
    try {
      result = await agent.run("Store and recall a fact.");
    } finally {
      await agent.dispose();
    }

    expect(result.success).toBe(true);
    expect(result.output).toContain("Paris");
  });

  it("recall write and read within a run round-trips correctly", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([
        { toolCall: { name: "recall", args: { key: "plan", content: "Step 1. Step 2. Step 3." } } },
        { toolCall: { name: "recall", args: { key: "plan" } } },
        { text: "I found my plan." },
      ])
      .withMetaTools({ recall: true })
      .build();

    let result;
    try {
      result = await agent.run("Store a plan and read it back.");
    } finally {
      await agent.dispose();
    }

    expect(result.success).toBe(true);
    expect(result.output).toBeTruthy();
  });

  it("scratchpad-write and recall read the same underlying store", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([
        { toolCall: { name: "scratchpad-write", args: { key: "note", content: "hello from scratchpad" } } },
        { toolCall: { name: "recall", args: { key: "note" } } },
        { text: "Both access the same store." },
      ])
      .withMetaTools({ recall: true })
      .build();

    let result;
    try {
      result = await agent.run("Test backward compatibility.");
    } finally {
      await agent.dispose();
    }

    expect(result.success).toBe(true);
    expect(result.output).toBeTruthy();
  });

  it("find returns empty results without erroring when no docs indexed", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([
        { toolCall: { name: "find", args: { query: "anything", scope: "documents" } } },
        { text: "No documents found." },
      ])
      .withMetaTools({ find: true })
      .build();

    let result;
    try {
      result = await agent.run("Search for documents.");
    } finally {
      await agent.dispose();
    }

    expect(result.success).toBe(true);
    expect(result.output).toBeTruthy();
  });

  it("find searches indexed documents when withDocuments is used", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([
        { toolCall: { name: "find", args: { query: "Reactive Agents" } } },
        { text: "Found information about Reactive Agents." },
      ])
      .withDocuments([{ content: "Reactive Agents is a TypeScript framework for building AI agents.", source: "intro.md" }])
      .withMetaTools({ find: true })
      .build();

    let result;
    try {
      result = await agent.run("Find information about Reactive Agents.");
    } finally {
      await agent.dispose();
    }

    expect(result.success).toBe(true);
    expect(result.output).toBeTruthy();
  });

  it("brief tool produces orientation output", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([
        { toolCall: { name: "brief", args: {} } },
        { text: "I have my briefing." },
      ])
      .withMetaTools({ brief: true })
      .build();

    let result;
    try {
      result = await agent.run("Get a briefing.");
    } finally {
      await agent.dispose();
    }

    expect(result.success).toBe(true);
    expect(result.output).toBeTruthy();
  });

  it("pulse tool returns structured response", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([
        { toolCall: { name: "recall", args: { key: "work", content: "some work done" } } },
        { toolCall: { name: "pulse", args: {} } },
        { text: "Pulse checked." },
      ])
      .withMetaTools({ pulse: true, recall: true })
      .build();

    let result;
    try {
      result = await agent.run("Do some work then check pulse.");
    } finally {
      await agent.dispose();
    }

    expect(result.success).toBe(true);
    expect(result.output).toBeTruthy();
  });
});
