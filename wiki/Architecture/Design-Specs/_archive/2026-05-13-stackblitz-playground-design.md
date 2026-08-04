# Stackblitz Playground Design

**Date:** 2026-05-13  
**Status:** Approved  
**Scope:** v0.11 — interactive browser demo embedded in docs site  
**Approach:** Stackblitz Embed + BYOK (Approach A)

---

## Problem

Users visiting docs.reactiveagents.dev cannot try the framework without cloning the repo, installing dependencies, and configuring an API key. The barrier is too high for evaluation and marketing. We need a zero-install path to running a real agent.

## Goals

- Users run a real agent (not a mock) within seconds of landing on the playground page
- No install required — all execution in WebContainer via Stackblitz
- BYOK: user provides their own API key (we absorb no inference cost)
- Support Gemini (free tier), Anthropic, OpenAI, and Ollama endpoints
- Code is editable — users can modify the agent and rerun
- Minimal maintenance burden

## Non-Goals

- First-party WebContainer integration (deferred to v0.12 consideration)
- Chrome extension Ollama bridge (scoped to v0.12)
- Paying for inference / shared API key
- Test-provider deterministic mode (defeats demo purpose)

---

## Architecture

```
GitHub repo
  apps/stackblitz/
    01-hello-agent/        ← standalone npm project
    02-tool-integration/   ← standalone npm project
    03-strategy-demo/      ← standalone npm project

docs site (Starlight)
  guides/playground.mdx
    └─ <Tabs> (Starlight built-in component)
         ├─ "Hello Agent"      → <iframe> embed
         ├─ "Tool Integration" → <iframe> embed
         └─ "Strategy Demo"    → <iframe> embed
```

Each `apps/stackblitz/<name>/` is a **standalone npm project** — no `workspace:*` references. Dependencies resolve from the npm registry against the published `reactive-agents@latest`. Stackblitz boots them in a WebContainer, runs `npm start`.

---

## Example Project Structure

Every scenario follows the same layout:

```
apps/stackblitz/<name>/
  package.json        ← npm deps only: reactive-agents@latest + tsx
  tsconfig.json       ← minimal: moduleResolution bundler, target ES2022
  .stackblitzrc       ← openFile, startCommand
  src/
    agent.ts          ← demo code
```

### package.json template

```json
{
  "name": "reactive-agents-<name>",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "tsx src/agent.ts"
  },
  "dependencies": {
    "reactive-agents": "latest"
  },
  "devDependencies": {
    "tsx": "^4",
    "typescript": "^5"
  }
}
```

### .stackblitzrc

```json
{
  "startCommand": "npm start",
  "openFile": "src/agent.ts"
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true
  }
}
```

---

## Provider Selection Pattern

Each `agent.ts` reads provider + key from environment. Stackblitz Secrets (⚙️ → Secrets) injects them as env vars — keys never leave the browser session.

```ts
import { ReactiveAgents } from "reactive-agents";

type PN = "gemini" | "anthropic" | "openai" | "ollama";

const provider = (process.env.PROVIDER ?? "gemini") as PN;
const apiKey =
  process.env.GEMINI_API_KEY ??
  process.env.ANTHROPIC_API_KEY ??
  process.env.OPENAI_API_KEY;

if (!apiKey && provider !== "ollama") {
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  No API key found. Add one in Secrets:

  GEMINI_API_KEY     → free tier at ai.google.dev  ← recommended
  ANTHROPIC_API_KEY  → console.anthropic.com
  OPENAI_API_KEY     → platform.openai.com

  Or use local Ollama:
  PROVIDER=ollama
  OLLAMA_BASE_URL=http://localhost:11434
  (requires OLLAMA_ORIGINS=* on your Ollama server)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);
  process.exit(0);
}
```

---

## The Three Scenarios

### 01-hello-agent
- Single Q&A query, no tools
- Shows: `ReactiveAgents.create()`, `.withProvider()`, `.run()`
- Goal: minimal surface area, first-run success

### 02-tool-integration
- Web search tool + calculator
- Shows: `.withTools([webSearch, calculator])`, streaming output, tool call events
- Goal: demonstrate real agentic tool-use

### 03-strategy-demo
- User toggles strategy via env var (`STRATEGY=react | plan-execute | chain-of-thought`)
- Runs same task with two strategies and prints side-by-side token + step count
- Shows: `.withStrategy()`, strategy effects on reasoning
- Goal: make strategy switching tangible

---

## Docs Page: `guides/playground.mdx`

```mdx
---
title: Interactive Playground
description: Run Reactive Agents in your browser — no install needed.
sidebar:
  order: 2
  badge:
    text: New
    variant: tip
---

import { Tabs, TabItem } from '@astrojs/starlight/components';

Powered by [StackBlitz WebContainers](https://stackblitz.com) — runs Node.js 
directly in your browser. No install, no CLI, no Docker.

## Quick setup

Add your API key in the Stackblitz **Secrets** panel (⚙️ icon in sidebar):

| Provider | Free tier | Secret name |
|----------|-----------|-------------|
| **Gemini** ← recommended | Yes, generous | `GEMINI_API_KEY` |
| Anthropic | No | `ANTHROPIC_API_KEY` |
| OpenAI | No | `OPENAI_API_KEY` |
| Ollama (local) | Yes | `PROVIDER=ollama` + `OLLAMA_BASE_URL` |

<Tabs>
  <TabItem label="Hello Agent">
    <iframe
      src="https://stackblitz.com/github/tylerjrbuell/reactive-agents-ts/tree/main/apps/stackblitz/01-hello-agent?embed=1&file=src%2Fagent.ts&terminal=start&theme=dark"
      style="width:100%;height:600px;border:0;border-radius:8px"
      loading="lazy"
    />
  </TabItem>
  <TabItem label="Tool Integration">
    <iframe
      src="https://stackblitz.com/github/tylerjrbuell/reactive-agents-ts/tree/main/apps/stackblitz/02-tool-integration?embed=1&file=src%2Fagent.ts&terminal=start&theme=dark"
      style="width:100%;height:600px;border:0;border-radius:8px"
      loading="lazy"
    />
  </TabItem>
  <TabItem label="Strategy Demo">
    <iframe
      src="https://stackblitz.com/github/tylerjrbuell/reactive-agents-ts/tree/main/apps/stackblitz/03-strategy-demo?embed=1&file=src%2Fagent.ts&terminal=start&theme=dark"
      style="width:100%;height:600px;border:0;border-radius:8px"
      loading="lazy"
    />
  </TabItem>
</Tabs>
```

---

## Ollama Local Setup

Docs page includes an `<Aside type="tip">` with collapsible Ollama instructions:

```
1. Ensure Ollama is running: ollama serve
2. Allow cross-origin requests:
   Mac/Linux: OLLAMA_ORIGINS=* ollama serve
   Windows:   set OLLAMA_ORIGINS=* && ollama serve
3. In Stackblitz Secrets add:
   PROVIDER = ollama
   OLLAMA_BASE_URL = http://localhost:11434
```

**Browser compatibility note:** Chrome 94+ allows HTTPS pages to call localhost via HTTP (loopback exception). Firefox requires `network.websocket.allowInsecureFromHTTPS=true` in `about:config`. Safari blocks this — Ollama local won't work in Safari.

---

## v0.12 Extension Hook

Each `agent.ts` reads `process.env.OLLAMA_BRIDGE_EXTENSION`. If set, it substitutes the base URL with an extension-intercepted scheme. No-op in v0.11 but wires the hook for the v0.12 Chrome DevTools extension without requiring code changes to the examples.

```ts
const ollamaBase =
  process.env.OLLAMA_BRIDGE_EXTENSION
    ? "reactive-agents://ollama-bridge"
    : (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434");
```

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| No key set | Print clear setup instructions, `process.exit(0)` (not crash) |
| Wrong key | Provider SDK error surfaced with provider-specific fix hint |
| Ollama unreachable | Connection refused message + CORS/ORIGINS reminder |
| Model not found | Print `ollama pull <model>` command |
| Rate limit | Retry hint with exponential backoff suggestion |

---

## Testing

- Each scenario has a `test` provider fallback used only in CI: `PROVIDER=test npm test`
- `apps/stackblitz/*/package.json` has `"test": "tsx src/agent.ts"` in test mode
- CI runs all three scenarios in test-provider mode to ensure they boot and exit cleanly

---

## Acceptance Criteria

- [ ] All 3 scenarios boot in Stackblitz and print setup instructions when no key is set
- [ ] With a valid Gemini key, all 3 scenarios complete successfully
- [ ] With Ollama running + CORS configured, scenario 01 runs via local model
- [ ] Docs playground page loads, iframes render lazily on scroll
- [ ] Tabs switch between scenarios without page reload
- [ ] No `workspace:*` references in any `apps/stackblitz/` package
- [ ] v0.12 extension hook env var is present but no-op

---

## File Checklist

```
apps/stackblitz/01-hello-agent/package.json
apps/stackblitz/01-hello-agent/tsconfig.json
apps/stackblitz/01-hello-agent/.stackblitzrc
apps/stackblitz/01-hello-agent/src/agent.ts

apps/stackblitz/02-tool-integration/package.json
apps/stackblitz/02-tool-integration/tsconfig.json
apps/stackblitz/02-tool-integration/.stackblitzrc
apps/stackblitz/02-tool-integration/src/agent.ts

apps/stackblitz/03-strategy-demo/package.json
apps/stackblitz/03-strategy-demo/tsconfig.json
apps/stackblitz/03-strategy-demo/.stackblitzrc
apps/stackblitz/03-strategy-demo/src/agent.ts

apps/docs/src/content/docs/guides/playground.mdx
```
