/**
 * Pre-scripted response for `rax demo`.
 * The test provider matches keys as substrings against the prompt.
 * We use a single direct response to keep the demo clean and fast.
 */
export const demoResponses: Record<string, string> = {
  "Find the top 3 TypeScript testing frameworks":
    `## Top 3 TypeScript Testing Frameworks (2026)

| Framework | Speed | DX | Ecosystem | TypeScript |
|-----------|-------|-----|-----------|------------|
| **Vitest** | ⚡ Fast | Excellent | Growing | Native |
| **Bun Test** | ⚡⚡ Fastest | Great | Emerging | Native |
| **Jest** | Moderate | Good | Mature | Via ts-jest |

### 1. Vitest
The leading choice for TypeScript projects. Native ESM support, Vite-powered HMR for tests, and Jest-compatible API. Watch mode is instant. First-class TypeScript without configuration.

### 2. Bun Test
The fastest test runner available — built into the Bun runtime. Zero-config TypeScript support. Lifecycle hooks, snapshot testing, and mock support. Ecosystem is newer but growing rapidly.

### 3. Jest
The established standard with the largest ecosystem. Requires ts-jest or SWC transformer for TypeScript. Slower than Vitest/Bun but has the most mature plugin ecosystem and community support.

**Recommendation:** Vitest for most TypeScript projects — it combines speed, excellent DX, and a growing ecosystem. Choose Bun Test if you're already using the Bun runtime. Jest remains solid for existing projects with heavy Jest plugin dependencies.`,

  // Fallback
  "": "Demo complete.",
};

/** The demo task prompt. */
export const DEMO_TASK =
  "Find the top 3 TypeScript testing frameworks and compare their features";
