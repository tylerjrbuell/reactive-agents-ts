# Cortex App — Phase 2: UI Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** Phase 1 server must be complete and running.

**Goal:** Scaffold the SvelteKit app, wire up the design system extracted from the Stitch mockup, implement the WebSocket client store and base agent store, and build the top-level layout component with navigation.

**Architecture:** `apps/cortex/ui/` is a SvelteKit app (client-side routing only, no SSR). Design tokens are extracted from `cortex-design-export.html` and defined in `app.css` + `tailwind.config.ts`. All server communication goes through typed Svelte stores. The `+layout.svelte` mounts the top nav and command palette shell.

**Tech Stack:** SvelteKit, Svelte 5, Tailwind CSS, TypeScript, Material Symbols Outlined icons.

**Design mockup reference:** `docs/superpowers/specs/cortex-design-export.html`
> ⚠️ The mockup is a starting point. The production build must be more polished, accurate, and responsive. Key elements to exceed: richer animations on agent nodes, more accurate signal monitor data rendering, tighter spacing, and proper light mode support matching the docs site.

---

## File Map

```
apps/cortex/ui/
  package.json
  svelte.config.js
  vite.config.ts
  tailwind.config.ts
  postcss.config.js
  src/
    app.html
    app.css                         # Design tokens + global styles from mockup
    app.d.ts
    routes/
      +layout.svelte                # Top nav + command palette shell
      +layout.ts                    # client-only config
      +page.svelte                  # Stage view (Phase 3)
      run/[runId]/
        +page.svelte                # Run view (Phase 4)
      workshop/
        +page.svelte                # Workshop view (Phase 5)
    lib/
      stores/
        ws-client.ts                # WebSocket client with reconnection + replay
        agent-store.ts              # All connected agents + cognitive state
        index.ts                    # Re-exports all stores
      components/
        Toast.svelte                # Connection moment toast
        CommandPalette.svelte       # Cmd+K shell (wired in Phase 5)
      constants.ts                  # Color tokens, animation durations
```

---

## Task 1: SvelteKit Scaffold

**Files:**
- Create: `apps/cortex/ui/package.json`
- Create: `apps/cortex/ui/svelte.config.js`
- Create: `apps/cortex/ui/vite.config.ts`
- Create: `apps/cortex/ui/tailwind.config.ts`
- Create: `apps/cortex/ui/postcss.config.js`
- Create: `apps/cortex/ui/src/app.html`
- Create: `apps/cortex/ui/src/app.d.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@reactive-agents/cortex-ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json"
  },
  "devDependencies": {
    "@sveltejs/adapter-static": "^3.0.0",
    "@sveltejs/kit": "^2.0.0",
    "@sveltejs/vite-plugin-svelte": "^3.0.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "svelte": "^5.0.0",
    "svelte-check": "^3.0.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0"
  },
  "dependencies": {
    "d3": "^7.9.0",
    "@svelteflow/svelte-flow": "^0.0.35"
  }
}
```

- [ ] **Step 2: Create svelte.config.js**

```javascript
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: "build",
      assets: "build",
      fallback: "index.html",  // SPA fallback for client-side routing
      precompress: false,
      strict: false,
    }),
    alias: {
      $lib: "src/lib",
    },
  },
};
```

- [ ] **Step 3: Create vite.config.ts**

```typescript
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    proxy: {
      "/api": "http://localhost:4321",
      "/ws": { target: "ws://localhost:4321", ws: true },
    },
  },
});
```

- [ ] **Step 4: Create tailwind.config.ts**

Extracted directly from the mockup's Tailwind config + extended for production:

```typescript
import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{html,js,svelte,ts}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // ─── Cortex design system (from cortex-design-export.html) ───
        "background":               "#111317",
        "surface":                  "#111317",
        "surface-dim":              "#111317",
        "surface-container-lowest": "#0c0e12",
        "surface-container-low":    "#1a1c20",
        "surface-container":        "#1e2024",
        "surface-container-high":   "#282a2e",
        "surface-container-highest":"#333539",
        "surface-bright":           "#37393e",
        "on-surface":               "#e2e2e8",
        "on-surface-variant":       "#cbc3d7",
        "outline":                  "#958ea0",
        "outline-variant":          "#494454",
        "inverse-surface":          "#e2e2e8",
        "inverse-on-surface":       "#2f3035",

        // Primary (violet)
        "primary":                  "#d0bcff",
        "primary-fixed":            "#e9ddff",
        "primary-fixed-dim":        "#d0bcff",
        "primary-container":        "#a078ff",
        "on-primary":               "#3c0091",
        "on-primary-container":     "#340080",
        "on-primary-fixed":         "#23005c",
        "on-primary-fixed-variant": "#5516be",
        "inverse-primary":          "#6d3bd7",

        // Secondary (cyan)
        "secondary":                "#4cd7f6",
        "secondary-fixed":          "#acedff",
        "secondary-fixed-dim":      "#4cd7f6",
        "secondary-container":      "#03b5d3",
        "on-secondary":             "#003640",
        "on-secondary-container":   "#00424e",
        "on-secondary-fixed":       "#001f26",
        "on-secondary-fixed-variant":"#004e5c",

        // Tertiary (amber/gold)
        "tertiary":                 "#f7be1d",
        "tertiary-fixed":           "#ffdf9a",
        "tertiary-fixed-dim":       "#f7be1d",
        "tertiary-container":       "#b68a00",
        "on-tertiary":              "#3f2e00",
        "on-tertiary-container":    "#372700",
        "on-tertiary-fixed":        "#251a00",
        "on-tertiary-fixed-variant":"#5a4300",

        // Error
        "error":                    "#ffb4ab",
        "error-container":          "#93000a",
        "on-error":                 "#690005",
        "on-error-container":       "#ffdad6",
      },
      fontFamily: {
        headline: ["Space Grotesk", "sans-serif"],
        body:     ["Inter", "sans-serif"],
        label:    ["Space Grotesk", "sans-serif"],
        mono:     ["JetBrains Mono", "monospace"],
        geist:    ["Geist Variable", "sans-serif"],
      },
      borderRadius: {
        DEFAULT: "0.125rem",
        sm:      "0.125rem",
        md:      "0.25rem",
        lg:      "0.25rem",
        xl:      "0.5rem",
        "2xl":   "0.75rem",
        full:    "0.75rem",
      },
      animation: {
        "sonar-pulse": "sonar-pulse 3s cubic-bezier(0, 0.2, 0.8, 1) infinite",
        "ekg-draw":    "ekg-draw 5s linear infinite",
        "pulse-amber": "pulse-amber 2s ease-in-out infinite",
        "fade-up":     "fade-up 0.3s ease-out",
        "slide-right": "slide-right 0.3s ease-out",
      },
      keyframes: {
        "sonar-pulse": {
          "0%":   { transform: "scale(0.8)", opacity: "0.8" },
          "100%": { transform: "scale(3.5)", opacity: "0" },
        },
        "ekg-draw": {
          "to": { "stroke-dashoffset": "0" },
        },
        "pulse-amber": {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0.5" },
        },
        "fade-up": {
          "from": { opacity: "0", transform: "translateY(8px)" },
          "to":   { opacity: "1", transform: "translateY(0)" },
        },
        "slide-right": {
          "from": { opacity: "0", transform: "translateX(16px)" },
          "to":   { opacity: "1", transform: "translateX(0)" },
        },
      },
      boxShadow: {
        "neural": "0 0 24px rgba(208, 188, 255, 0.06)",
        "neural-strong": "0 0 50px rgba(208, 188, 255, 0.15)",
        "glow-primary": "0 0 20px rgba(208, 188, 255, 0.3)",
        "glow-secondary": "0 0 20px rgba(76, 215, 246, 0.3)",
        "glow-tertiary": "0 0 15px rgba(247, 190, 29, 0.2)",
        "glow-error": "0 0 15px rgba(255, 180, 171, 0.2)",
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 5: Create postcss.config.js**

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 6: Create src/app.html**

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
    <link
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
    <link
      href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
      rel="stylesheet"
    />
    %sveltekit.head%
  </head>
  <body class="bg-background text-on-surface font-body overflow-hidden h-screen w-screen" data-sveltekit-preload-data="hover">
    <div id="svelte">%sveltekit.body%</div>
  </body>
</html>
```

- [ ] **Step 7: Create src/app.d.ts**

```typescript
// See https://kit.svelte.dev/docs/types#app
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}
export {};
```

- [ ] **Step 8: Create src/routes/+layout.ts (disable SSR)**

```typescript
export const prerender = false;
export const ssr = false;
```

- [ ] **Step 9: Install dependencies**

```bash
cd apps/cortex/ui && bun install
```

- [ ] **Step 10: Commit**

```bash
git add apps/cortex/ui/
git commit -m "feat(cortex-ui): SvelteKit scaffold with Tailwind config + design tokens from mockup"
```

---

## Task 2: Global CSS Design System

**Files:**
- Create: `apps/cortex/ui/src/app.css`
- Create: `apps/cortex/ui/src/lib/constants.ts`

- [ ] **Step 1: Create app.css**

Extracted and extended from `cortex-design-export.html`:

```css
/* apps/cortex/ui/src/app.css */
@import "@fontsource-variable/geist";
@tailwind base;
@tailwind components;
@tailwind utilities;

/* ─── Material Symbols ─────────────────────────────────────────────────── */
.material-symbols-outlined {
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
  user-select: none;
}

/* ─── Gradient border panel (from mockup) ────────────────────────────── */
/* Usage: <div class="gradient-border"> */
.gradient-border {
  position: relative;
  background: #12131a;
  background-clip: padding-box;
  border: 1px solid transparent;
}

.gradient-border::before {
  content: '';
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  z-index: -1;
  margin: -1px;
  border-radius: inherit;
  background: linear-gradient(135deg, #d0bcff 0%, #4cd7f6 100%);
}

/* Animated glow variant for panels */
.gradient-border-glow {
  position: relative;
  background: #1e2024;
}

.gradient-border-glow::before {
  content: "";
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(135deg, #d0bcff 0%, #4cd7f6 100%);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
  animation: border-breathe 8s ease-in-out infinite;
}

@keyframes border-breathe {
  0%, 100% { opacity: 0.7; }
  50%       { opacity: 1; }
}

/* ─── Sonar rings (from mockup) ──────────────────────────────────────── */
.sonar-ring {
  position: absolute;
  border: 1.5px solid var(--ring-color, #d0bcff);
  border-radius: 50%;
  animation: sonar-pulse 3s cubic-bezier(0, 0.2, 0.8, 1) infinite;
}

.sonar-ring:nth-child(2) { animation-delay: -1s; }
.sonar-ring:nth-child(3) { animation-delay: -2s; }

@keyframes sonar-pulse {
  0%   { transform: scale(0.8); opacity: 0.8; }
  100% { transform: scale(3.5); opacity: 0; }
}

/* ─── EKG line (from mockup) ─────────────────────────────────────────── */
.ekg-line {
  stroke-dasharray: 1000;
  stroke-dashoffset: 1000;
  animation: ekg-draw 5s linear infinite;
}

@keyframes ekg-draw {
  to { stroke-dashoffset: 0; }
}

/* ─── Scrollbar ──────────────────────────────────────────────────────── */
::-webkit-scrollbar       { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: linear-gradient(to bottom, #d0bcff, #4cd7f6);
  border-radius: 2px;
}

/* ─── Hover lift ─────────────────────────────────────────────────────── */
.hover-lift {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.hover-lift:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 20px rgba(208, 188, 255, 0.15);
}

/* ─── Selection ──────────────────────────────────────────────────────── */
::selection { background: rgba(208, 188, 255, 0.3); }
```

- [ ] **Step 2: Create lib/constants.ts**

```typescript
// apps/cortex/ui/src/lib/constants.ts

export const CORTEX_COLORS = {
  primary:   "#d0bcff",
  secondary: "#4cd7f6",
  tertiary:  "#f7be1d",
  error:     "#ffb4ab",
  surface:   "#111317",
  surfaceContainer: "#1e2024",
} as const;

export const CORTEX_SERVER_URL =
  typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.host}`
    : "http://localhost:4321";

export const WS_BASE =
  typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`
    : "ws://localhost:4321";

export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000];

export const AGENT_STATE_COLORS = {
  idle:      { ring: "#494454", glow: "rgba(73, 68, 84, 0.2)" },
  running:   { ring: "#d0bcff", glow: "rgba(208, 188, 255, 0.3)" },
  exploring: { ring: "#f7be1d", glow: "rgba(247, 190, 29, 0.3)" },
  stressed:  { ring: "#ffb4ab", glow: "rgba(255, 180, 171, 0.3)" },
  completed: { ring: "#4cd7f6", glow: "rgba(76, 215, 246, 0.3)" },
  error:     { ring: "#ffb4ab", glow: "rgba(255, 180, 171, 0.2)" },
} as const;
```

- [ ] **Step 3: Commit**

```bash
git add apps/cortex/ui/src/app.css apps/cortex/ui/src/lib/constants.ts
git commit -m "feat(cortex-ui): global CSS design system — gradient borders, sonar rings, EKG animation"
```

---

## Task 3: WebSocket Client Store

**Files:**
- Create: `apps/cortex/ui/src/lib/stores/ws-client.ts`

- [ ] **Step 1: Create ws-client.ts**

```typescript
// apps/cortex/ui/src/lib/stores/ws-client.ts
import { writable, get } from "svelte/store";
import { WS_BASE, RECONNECT_DELAYS_MS } from "$lib/constants.js";

export type WsStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface WsClient {
  readonly status: ReturnType<typeof writable<WsStatus>>;
  readonly send: (msg: unknown) => void;
  readonly close: () => void;
  readonly onMessage: (handler: (data: unknown) => void) => () => void;
}

// Module-level deduplication: one WS per URL
const clients = new Map<string, WsClientInternal>();

interface WsClientInternal {
  ws: WebSocket | null;
  status: ReturnType<typeof writable<WsStatus>>;
  handlers: Set<(data: unknown) => void>;
  retryIndex: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
}

function createInternal(url: string): WsClientInternal {
  const status = writable<WsStatus>("connecting");
  const handlers = new Set<(data: unknown) => void>();
  const internal: WsClientInternal = {
    ws: null,
    status,
    handlers,
    retryIndex: 0,
    retryTimer: null,
    closed: false,
  };

  const connect = () => {
    if (internal.closed) return;
    internal.status.set(internal.retryIndex > 0 ? "reconnecting" : "connecting");

    const ws = new WebSocket(url);
    internal.ws = ws;

    ws.onopen = () => {
      internal.retryIndex = 0;
      internal.status.set("connected");
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string);
        for (const h of internal.handlers) h(data);
      } catch { /* malformed — ignore */ }
    };

    ws.onclose = () => {
      if (internal.closed) { internal.status.set("disconnected"); return; }
      const delay = RECONNECT_DELAYS_MS[Math.min(internal.retryIndex, RECONNECT_DELAYS_MS.length - 1)] ?? 30000;
      internal.retryIndex++;
      internal.retryTimer = setTimeout(connect, delay);
    };

    ws.onerror = () => { /* onclose will fire next */ };
  };

  connect();
  return internal;
}

export function createWsClient(path: string): WsClient {
  const url = `${WS_BASE}${path}`;

  if (!clients.has(url)) {
    clients.set(url, createInternal(url));
  }

  const internal = clients.get(url)!;

  return {
    status: internal.status,

    send: (msg) => {
      if (internal.ws?.readyState === WebSocket.OPEN) {
        internal.ws.send(JSON.stringify(msg));
      }
    },

    close: () => {
      internal.closed = true;
      if (internal.retryTimer) clearTimeout(internal.retryTimer);
      internal.ws?.close();
      clients.delete(url);
    },

    onMessage: (handler) => {
      internal.handlers.add(handler);
      return () => internal.handlers.delete(handler);
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/cortex/ui/src/lib/stores/ws-client.ts
git commit -m "feat(cortex-ui): WebSocket client store with reconnection and deduplication"
```

---

## Task 4: Agent Store

**Files:**
- Create: `apps/cortex/ui/src/lib/stores/agent-store.ts`

- [ ] **Step 1: Create agent-store.ts**

```typescript
// apps/cortex/ui/src/lib/stores/agent-store.ts
import { writable, derived, get } from "svelte/store";
import { CORTEX_SERVER_URL } from "$lib/constants.js";

export type AgentCognitiveState =
  | "idle"
  | "running"
  | "exploring"   // entropy 0.5–0.75
  | "stressed"    // entropy > 0.75
  | "completed"
  | "error";

export interface AgentNode {
  readonly agentId: string;
  readonly runId: string;
  readonly name: string;
  readonly state: AgentCognitiveState;
  readonly entropy: number;
  readonly iteration: number;
  readonly maxIterations: number;
  readonly tokensUsed: number;
  readonly cost: number;
  readonly connectedAt: number;
  readonly completedAt?: number;
  readonly lastEventAt: number;
}

export interface AgentStoreState {
  readonly agents: Map<string, AgentNode>;
  readonly loading: boolean;
}

function entropyToState(entropy: number, isRunning: boolean): AgentCognitiveState {
  if (!isRunning) return "idle";
  if (entropy < 0.5) return "running";
  if (entropy < 0.75) return "exploring";
  return "stressed";
}

export function createAgentStore() {
  const state = writable<AgentStoreState>({ agents: new Map(), loading: false });
  let unsubLive: (() => void) | null = null;

  const agents = derived(state, ($s) => Array.from($s.agents.values()));

  // Load historical agents from REST
  async function loadAgents() {
    state.update((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/runs?limit=20`);
      const runs = await res.json() as Array<{ runId: string; agentId: string; status: string; iterationCount: number; tokensUsed: number; cost_usd: number }>;

      state.update((s) => {
        const newMap = new Map(s.agents);
        for (const run of runs) {
          if (!newMap.has(run.agentId)) {
            newMap.set(run.agentId, {
              agentId: run.agentId,
              runId: run.runId,
              name: run.agentId,
              state: run.status === "live" ? "running" : run.status === "failed" ? "error" : "completed",
              entropy: 0,
              iteration: run.iterationCount,
              maxIterations: 0,
              tokensUsed: run.tokensUsed,
              cost: run.cost_usd,
              connectedAt: 0,
              lastEventAt: Date.now(),
            });
          }
        }
        return { agents: newMap, loading: false };
      });
    } catch {
      state.update((s) => ({ ...s, loading: false }));
    }
  }

  // Handle a live CortexLiveMessage
  function handleLiveMessage(msg: { agentId: string; runId: string; type: string; payload: Record<string, unknown> }) {
    state.update((s) => {
      const map = new Map(s.agents);
      const existing = map.get(msg.agentId);

      const patch: Partial<AgentNode> = { lastEventAt: Date.now() };

      switch (msg.type) {
        case "AgentConnected":
          patch.state = "running";
          patch.connectedAt = Date.now();
          break;
        case "EntropyScored": {
          const entropy = (msg.payload as any).composite as number ?? 0;
          const isRunning = existing?.state !== "completed" && existing?.state !== "error";
          patch.entropy = entropy;
          patch.state = entropyToState(entropy, isRunning);
          break;
        }
        case "LLMRequestCompleted":
          patch.tokensUsed = (existing?.tokensUsed ?? 0) + ((msg.payload as any).tokensUsed?.total ?? 0);
          patch.cost = (existing?.cost ?? 0) + ((msg.payload as any).estimatedCost ?? 0);
          break;
        case "ReasoningStepCompleted":
          patch.iteration = (msg.payload as any).iteration ?? (existing?.iteration ?? 0);
          break;
        case "AgentCompleted":
          patch.state = (msg.payload as any).success ? "completed" : "error";
          patch.completedAt = Date.now();
          break;
        case "TaskFailed":
          patch.state = "error";
          patch.completedAt = Date.now();
          break;
      }

      const updated: AgentNode = {
        agentId: msg.agentId,
        runId: msg.runId,
        name: existing?.name ?? msg.agentId,
        state: existing?.state ?? "running",
        entropy: existing?.entropy ?? 0,
        iteration: existing?.iteration ?? 0,
        maxIterations: existing?.maxIterations ?? 0,
        tokensUsed: existing?.tokensUsed ?? 0,
        cost: existing?.cost ?? 0,
        connectedAt: existing?.connectedAt ?? Date.now(),
        lastEventAt: Date.now(),
        ...patch,
      };

      map.set(msg.agentId, updated);
      return { ...s, agents: map };
    });
  }

  loadAgents();

  return {
    subscribe: agents.subscribe,
    state,
    handleLiveMessage,
    refresh: loadAgents,
    destroy: () => {
      if (unsubLive) { unsubLive(); unsubLive = null; }
    },
  };
}
```

- [ ] **Step 2: Create stores/index.ts**

```typescript
// apps/cortex/ui/src/lib/stores/index.ts
export { createAgentStore } from "./agent-store.js";
export { createWsClient } from "./ws-client.js";
export type { AgentNode, AgentCognitiveState } from "./agent-store.js";
export type { WsClient, WsStatus } from "./ws-client.js";
```

- [ ] **Step 3: Commit**

```bash
git add apps/cortex/ui/src/lib/stores/
git commit -m "feat(cortex-ui): agent store — tracks cognitive state from live CortexLiveMessage events"
```

---

## Task 5: Layout and Navigation

**Files:**
- Create: `apps/cortex/ui/src/routes/+layout.svelte`
- Create: `apps/cortex/ui/src/lib/components/Toast.svelte`

- [ ] **Step 1: Create Toast.svelte**

The connection moment toast — shown when a new agent connects (from mockup bottom-right design):

```svelte
<!-- apps/cortex/ui/src/lib/components/Toast.svelte -->
<script lang="ts">
  export let agentId: string;
  export let onClose: () => void;

  // Auto-dismiss after 4 seconds
  import { onMount } from "svelte";
  onMount(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  });
</script>

<div
  class="fixed bottom-10 right-6 z-[60] animate-slide-right
         bg-surface-container-high border border-primary/30
         p-4 rounded-lg shadow-neural-strong flex flex-col gap-1
         min-w-[280px] max-w-[320px] relative overflow-hidden"
>
  <!-- Left accent bar -->
  <div class="absolute top-0 left-0 w-1 h-full bg-primary rounded-l-lg"></div>

  <div class="flex justify-between items-center pl-2">
    <div class="flex items-center gap-2">
      <span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
      <span class="font-mono font-bold text-xs text-primary uppercase tracking-widest">
        {agentId}
      </span>
    </div>
    <button
      class="material-symbols-outlined text-sm text-outline/60 hover:text-outline transition-colors"
      on:click={onClose}
    >
      close
    </button>
  </div>
  <p class="font-body text-sm text-on-surface-variant pl-2">connected to Cortex</p>
</div>
```

- [ ] **Step 2: Create +layout.svelte**

```svelte
<!-- apps/cortex/ui/src/routes/+layout.svelte -->
<script lang="ts">
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import "../app.css";
  import Toast from "$lib/components/Toast.svelte";
  import { createWsClient } from "$lib/stores/ws-client.js";
  import { createAgentStore } from "$lib/stores/agent-store.js";
  import { onMount, onDestroy, setContext } from "svelte";
  import { writable } from "svelte/store";

  // Global agent store — shared across all views via context
  const agentStore = createAgentStore();
  setContext("agentStore", agentStore);

  // Toast queue for connection moments
  const toasts = writable<Array<{ id: string; agentId: string }>>([]);

  // Global ingest WS (Stage subscribes to all agents via a broadcast channel)
  // Individual run WS connections are managed per-view in Run page
  let wsClient = createWsClient("/ws/live/cortex-broadcast");

  onMount(() => {
    // Handle live messages for agent store updates
    const unsub = wsClient.onMessage((raw) => {
      const msg = raw as { agentId: string; runId: string; type: string; payload: Record<string, unknown> };
      if (!msg?.agentId || !msg?.type) return;

      agentStore.handleLiveMessage(msg);

      // Show connection toast
      if (msg.type === "AgentConnected") {
        const id = crypto.randomUUID();
        toasts.update((t) => [...t, { id, agentId: msg.agentId }]);

        // Auto-navigate to Run view if this is the first agent (no others running)
        const currentAgents = agentStore.state;
        // Navigation logic in Stage view handles first-connect auto-navigate
      }
    });

    return unsub;
  });

  onDestroy(() => {
    wsClient.close();
    agentStore.destroy();
  });

  const navItems = [
    { label: "Stage",    href: "/",          icon: "hub" },
    { label: "Run",      href: "/run",        icon: "analytics" },
    { label: "Workshop", href: "/workshop",   icon: "build" },
  ];

  function isActive(href: string): boolean {
    if (href === "/") return $page.url.pathname === "/";
    return $page.url.pathname.startsWith(href);
  }
</script>

<div class="h-screen w-screen flex flex-col overflow-hidden bg-background text-on-surface">
  <!-- Top navigation bar (from Run view mockup — cleaner than the sidebar variant) -->
  <header
    class="bg-[#111317] flex justify-between items-center w-full px-6 h-12
           border-b border-white/5 shadow-neural z-50 flex-shrink-0"
  >
    <!-- Wordmark -->
    <a href="/" class="text-xl font-bold tracking-tight font-headline uppercase
                        bg-clip-text text-transparent bg-gradient-to-r
                        from-primary to-secondary">
      ◈ CORTEX
    </a>

    <!-- Nav tabs -->
    <nav class="hidden md:flex items-center gap-6">
      {#each navItems as item}
        <a
          href={item.href}
          class="flex items-center gap-1.5 text-sm font-medium transition-colors duration-200
                 {isActive(item.href)
                   ? 'text-primary border-b-2 border-primary pb-0.5'
                   : 'text-outline hover:text-primary'}"
        >
          {item.label}
        </a>
      {/each}
    </nav>

    <!-- Right controls -->
    <div class="flex items-center gap-3">
      <!-- Cmd+K command palette hint -->
      <button
        class="hidden md:flex items-center gap-2 px-3 py-1.5
               bg-surface-container-lowest rounded border border-outline-variant/10
               text-[10px] font-mono text-outline uppercase tracking-widest
               hover:border-outline-variant/30 transition-colors"
        on:click={() => {/* command palette — Phase 5 */}}
      >
        <span class="material-symbols-outlined text-sm text-secondary">terminal</span>
        ⌘K
      </button>
      <button class="material-symbols-outlined text-outline hover:text-primary transition-colors p-1">
        settings
      </button>
    </div>
  </header>

  <!-- Main content area -->
  <main class="flex-1 overflow-hidden">
    <slot />
  </main>
</div>

<!-- Toast container -->
{#each $toasts as toast (toast.id)}
  <Toast
    agentId={toast.agentId}
    onClose={() => toasts.update((t) => t.filter((x) => x.id !== toast.id))}
  />
{/each}
```

- [ ] **Step 3: Create placeholder route pages so SvelteKit doesn't error**

Create `apps/cortex/ui/src/routes/+page.svelte`:
```svelte
<script>
  // Stage view — implemented in Phase 3
</script>
<div class="p-8 text-on-surface font-mono text-sm">
  Stage view — coming in Phase 3
</div>
```

Create `apps/cortex/ui/src/routes/run/[runId]/+page.svelte`:
```svelte
<script>
  import { page } from "$app/stores";
</script>
<div class="p-8 text-on-surface font-mono text-sm">
  Run view for {$page.params.runId} — coming in Phase 4
</div>
```

Create `apps/cortex/ui/src/routes/workshop/+page.svelte`:
```svelte
<script></script>
<div class="p-8 text-on-surface font-mono text-sm">
  Workshop — coming in Phase 5
</div>
```

- [ ] **Step 4: Verify the UI builds without error**

```bash
cd apps/cortex/ui && bun run build 2>&1 | tail -10
```
Expected: build completes, outputs to `build/`.

- [ ] **Step 5: Verify dev server starts**

```bash
cd apps/cortex/ui && timeout 5 bun run dev 2>&1 | head -10
```
Expected: `Local: http://localhost:5173` (then times out — fine).

- [ ] **Step 6: Commit**

```bash
git add apps/cortex/ui/src/
git commit -m "feat(cortex-ui): layout + nav + Toast component + placeholder routes — UI builds cleanly"
```

---

## Phase 2 Complete

The SvelteKit app scaffolds and builds. The design system is in place with exact tokens from the mockup. The WebSocket client store handles reconnection. The agent store processes live events. The layout renders the top nav.

**Next:** `2026-03-31-cortex-app-phase3-stage-view.md` — Agent nodes with sonar rings, bento grid, connection moment UX, bottom input bar.
