# @reactive-agents/runtime-shim

## 0.12.0

### Minor Changes

-   1081024: Add `@reactive-agents/runtime-shim` cross-runtime adapter package. The framework now runs on both Bun (with native `Bun.*` fast paths) and Node.js 22.5+ (with `node:sqlite`, `node:child_process`, `node:fs.glob`).

    **What changed:**

    -   New package `@reactive-agents/runtime-shim` exports unified primitives: `Database`, `spawn`, `writeFile`, `readFile`, `hash`, `serve`, `glob`, `isMain`, `isBun`, `isNode`.
    -   Internal `bun:sqlite` imports and `Bun.*` calls across `memory`, `cost`, `reactive-intelligence`, `llm-provider`, `tools`, `eval`, `a2a`, `benchmarks`, `health`, `judge-server` now route through the shim.
    -   `@reactive-agents/memory`: FTS5 virtual tables are now optional. When running on `node:sqlite` (which lacks FTS5), the package logs a warning and falls back to `LIKE`-based search on the `content` column. Full-text scoring is preserved on Bun.
    -   Zero call-site API changes for end users.

    **Why:**

    -   Unblocks Stackblitz embeds (Node-only WebContainer)
    -   Unblocks Vercel, Netlify, Cloudflare Workers (Node compat layer)
    -   Removes hard `engines.bun` requirement from the dependency chain

    **Bump:** minor for all packages using the shim. Patch for `@reactive-agents/svelte`, `@reactive-agents/vue`, `@reactive-agents/react` — these don't import the shim but need a version bump to clear npm publish conflicts.
