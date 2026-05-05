# @reactive-agents/trace

## 0.10.2

### Patch Changes

-   8fb1311: feat(cortex): publish @reactive-agents/cortex to npm with lazy-load CLI support

    -   Made cortex publishable to npm as a standalone package with tsup bundling
    -   Restored `rax cortex` command with lazy-load pattern for optional peer dependency
    -   Updated CLI with cortex command restoration and full documentation
    -   Synced all package versions to match coordinated releases
    -   Cortex fully validated: health API returns 200, UI serves correctly from npm install

-   fe4b058: Critical: Fix all package.json bun exports pointing to non-existent src/ directory. All packages were exporting `"bun": "./src/index.ts"` in their exports, but npm packages only include dist/. This caused Bun module resolution to fail when importing these packages from npm-installed CLI.

    This fix is critical for v0.10.1 release viability.

-   Updated dependencies [fe4b058]
    -   @reactive-agents/core@0.10.4

## 0.10.1

### Patch Changes

-   80284a4: Fix CLI module resolution: mark @reactive-agents/eval, @reactive-agents/llm-provider, @reactive-agents/a2a, @reactive-agents/trace, and @reactive-agents/tools as external dependencies in tsup config. This prevents bundling issues when the CLI is installed from npm and needs to dynamically require these modules at runtime.
-   Updated dependencies [80284a4]
    -   @reactive-agents/core@0.10.1

## 0.10.0

### Minor Changes

-   2cfded2: v0.10.0: Complete Phase 1 Mechanism Validation Release

    ## What's Shipping

    -   **13 Mechanisms:** 8 KEEP (production-ready), 5 IMPROVE (functional with Phase 1.5 enhancements)
    -   **Phase 1.5 Roadmap:** Clear improvement path for M3, M6, M7, M8, M10
    -   **Comprehensive Wiki:** 50+ Obsidian vault notes with architecture MOCs, failure modes, decisions
    -   **Zero TypeScript Errors:** Strict type safety across all 28 packages
    -   **4,975 Tests:** 99.39% pass rate, comprehensive validation
    -   **CI/CD Ready:** 4 GitHub Actions workflows, baseline performance metrics established

    ## Key Features

    -   Reactive Intelligence Dispatcher (entropy-driven intervention)
    -   Strategy Switching (5 adaptive strategies)
    -   Verifier & Retry (semantic quality gates)
    -   Healing Pipeline (86.7% FC recovery, +80% accuracy)
    -   Context Curation (60.7% compression, 38.6% token savings)
    -   Skill System (learnable within-session capabilities)
    -   Calibration (14-field model profiling)
    -   Sub-agent Delegation (multi-step task routing)
    -   Termination Oracle (single arbitrator, 9 paths)
    -   Memory System (4-layer persistent memory, 66.7% recall)
    -   Diagnostic System (100% TP, 0% FP, real-time health)
    -   Provider Adapters (7 lifecycle hooks, 6 LLM providers)
    -   Guards & Meta-tools (6 guards, 100% accuracy)
    -   Channels Package (webhook adapters, trigger registry, session bridging for external messaging)

    ## No Breaking Changes

    All existing `ReactiveAgents.create().with*()` patterns continue to work. Backward compatible with v0.9.0.

    ## Known Limitations (Phase 1.5)

    -   M3: Retry context tuning pending for cogito:14b (0% → ≥50% recovery)
    -   M6: Skills persist within session only (cross-session v0.11)
    -   M7: 3 consumers active (5+ more planned)
    -   M8: Validated on mock LLMs (real LLM metrics pending)
    -   M10: Single-session tested (multi-session validation pending)

    ## Installation

    ```bash
    npm install @reactive-agents
    ```

    See [QUICK_START.md](./QUICK_START.md) for 5-minute orientation.

### Patch Changes

-   Updated dependencies [2cfded2]
    -   @reactive-agents/core@0.10.0

## 0.10.0

### Minor Changes

-   3f8146a: v0.10.0: Adaptive Tool Calling System, Reactive Intelligence Dispatcher, Calibration System, Benchmark Suite v2, and major Cortex Studio updates.

### Patch Changes

-   Updated dependencies [3f8146a]
-   Updated dependencies [3f8146a]
    -   @reactive-agents/core@0.10.0
