---
title: Chat & Sessions
description: >-
  Build conversational agents with multi-turn memory using agent.chat() and
  agent.session().
sidebar:
  order: 9
---

`agent.chat()` enables multi-turn conversation with automatic routing — simple questions go directly to the LLM, complex tasks spin up the full ReAct loop. `agent.session()` wraps a conversation with persistent context. When **`.withTools()`** is on, the **`recall`** meta-tool (Conductor's Suite) is the supported way for the model to read/write working notes across turns — not legacy note builtins.

## Single-Turn Chat

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("assistant")
  .withProvider("anthropic")
  .withTools()
  .build();

const reply = await agent.chat("What is the capital of France?");
console.log(reply.message);    // "Paris"
```

## Multi-Turn Session

`agent.session()` maintains conversation history across turns:

```typescript
const session = agent.session();

const r1 = await session.chat("My name is Alex.");
console.log(r1.message); // "Nice to meet you, Alex!"

const r2 = await session.chat("What's my name?");
console.log(r2.message); // "Your name is Alex."

// Inspect current history
console.log(session.history());
// [
//   { role: "user", content: "My name is Alex." },
//   { role: "assistant", content: "Nice to meet you, Alex!" },
//   ...
// ]
```

## Routing: Direct vs. Tool Path

The session automatically routes each message. Messages with action keywords ("search for", "fetch", "create a", etc.) route to the full ReAct loop with tools; conversational messages go directly to the LLM:

```typescript
const session = agent.session();

// Conversational — goes directly to the LLM (fast, cheap)
const r1 = await session.chat("What's 2 + 2?");
console.log(r1.message); // "4"

// Action keyword — routes to the tool path
const r2 = await session.chat("Search the web for today's top AI news");
console.log(r2.toolsUsed); // ["web-search"]
```

Override routing explicitly with `useTools`:

```typescript
const reply = await session.chat("Summarize the README", { useTools: true });
```

## Persisted Sessions

Sessions can be persisted to SQLite so they survive process restarts. Enable persistence when calling `agent.session()`:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withMemory()   // memory layer required for SQLite-backed session persistence
  .build();

// Create or resume a session by ID
const session = agent.session({ id: "user-123-support", persist: true });

const reply = await session.chat("Where were we?");
// On subsequent runs with the same ID, prior history is restored from the DB

// Flush to storage when done
await session.end();
```

Sessions are stored in the memory database under the `chat_sessions` table. Calling `session.end()` flushes the final history to storage — the database record is kept, so the session can still be resumed later by ID.

## Session with System Context

Give the agent standing context at build time with `.withTaskContext()` — the key-value pairs are injected into the system context of every chat turn:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTaskContext({
    user: "Senior engineer at Acme Corp",
    project: "TypeScript monorepo with Bun",
    style: "Answer in a direct, technical style",
  })
  .build();

const session = agent.session();
const reply = await session.chat("How do I add a new package?");
// Agent knows it's a Bun monorepo and answers accordingly
```

For one-off context on a single turn, pass `extraContext` in the chat options (used on the direct-LLM path):

```typescript
const reply = await session.chat("What should I check first?", {
  extraContext: "The deploy failed with a TLS handshake error.",
});
```

## Streaming Chat

Stream tokens from a chat turn using `agent.runStream()`:

```typescript
process.stdout.write("Assistant: ");
for await (const event of agent.runStream("Explain recursion with an example")) {
  if (event._tag === "TextDelta") process.stdout.write(event.text);
  if (event._tag === "StreamCompleted") console.log("\nDone!");
}
```

## Interactive CLI Loop

Build a terminal chatbot in a few lines:

```typescript
import * as readline from "readline";
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("cli-bot")
  .withProvider("anthropic")
  .withTools()
  .build();

const session = agent.session();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const ask = () => {
  rl.question("You: ", async (input) => {
    if (input.trim() === "exit") return rl.close();
    const reply = await session.chat(input.trim());
    console.log(`Assistant: ${reply.message}\n`);
    ask();
  });
};

ask();
```

## Chat Reply Shape

```typescript
interface ChatReply {
  message: string;          // the assistant's response text
  toolsUsed?: string[];     // tools called (when tools were needed)
  fromMemory?: boolean;     // true if response used prior run context
  tokens?: number;          // token count for this turn (when available)
  steps?: number;           // reasoning steps taken (tool path only)
  cost?: number;            // estimated cost in USD (when available)
}
```

## Session Cleanup

Call `session.end()` to flush history to memory (if persistence is enabled) and clear the in-memory conversation:

```typescript
const session = agent.session({ persist: true, id: "user-123" });

await session.chat("Hello, what can you do?");
await session.chat("Search for TypeScript best practices");

// Flush to storage and clear in-memory history
await session.end();
```
