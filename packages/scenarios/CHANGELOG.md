# @reactive-agents/scenarios

## 0.10.6

### Patch Changes

-   @reactive-agents/testing@0.10.6
-   @reactive-agents/trace@0.10.6

## 0.10.5

### Patch Changes

-   d350fc2: fix(cli): resolve runtime dependency cycle and missing imports breaking npm-installed CLI

    The CLI imported `reactive-agents` (umbrella) and `@reactive-agents/tools` in `serve`, `playground`, `run`, and `demo` commands. The umbrella import wasn't declared in `dependencies` and would have created a circular dep with the umbrella package (which already includes CLI). Result: every CLI invocation in a clean npm install crashed with `Cannot find package 'reactive-agents'`.

    **Fixes:**

    -   CLI commands now import `ReactiveAgents` directly from `@reactive-agents/runtime` (where it actually lives)
    -   Added `@reactive-agents/tools` to CLI dependencies
    -   Added `@reactive-agents/cortex` as optional peerDependency (was already lazy-loaded)

    **New CI gates to prevent recurrence:**

    -   `scripts/validate-cli-externals.ts` upgraded — now also validates that every external workspace import is declared as a dependency in `package.json` (was only checking tsup config), and matches the umbrella `reactive-agents` package (was only matching `@reactive-agents/*`)
    -   `scripts/test-clean-install.ts` (new) — packs every package as an npm tarball, installs into a fresh project, runs CLI + SDK smoke tests. Wired into `publish.yml` as a pre-publish gate so broken releases fail before hitting npm
    -   `scripts/check-npm-versions.ts` (new) — flags drift between local versions and npm-published versions

    **Lockstep release:** all packages bumped together to keep versions aligned and prevent the manual-publish drift that created earlier release issues.

-   Updated dependencies [d350fc2]
    -   @reactive-agents/testing@0.10.5
    -   @reactive-agents/trace@0.10.5

## 0.10.4

### Patch Changes

-   8415dbc: Coordinated v0.10.4 release — uniform patch bump across all published packages

    -   Aligned all packages to 0.10.2 baseline matching current npm release
    -   Cortex published to npm with lazy-load CLI support (0.10.2→0.10.4)
    -   Fixed bun exports pointing to non-existent src/ directory
    -   All packages bump uniformly to 0.10.4 for coordinated release

-   Updated dependencies [8415dbc]
    -   @reactive-agents/testing@0.10.4
    -   @reactive-agents/trace@0.10.4

## 0.10.1

### Patch Changes

-   Updated dependencies [80284a4]
    -   @reactive-agents/testing@0.10.1
    -   @reactive-agents/trace@0.10.1

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
    -   @reactive-agents/testing@0.10.0
    -   @reactive-agents/trace@0.10.0

## 0.10.0

### Minor Changes

-   3f8146a: v0.10.0: Adaptive Tool Calling System, Reactive Intelligence Dispatcher, Calibration System, Benchmark Suite v2, and major Cortex Studio updates.

### Patch Changes

-   Updated dependencies [3f8146a]
-   Updated dependencies [3f8146a]
    -   @reactive-agents/testing@0.10.0
    -   @reactive-agents/trace@0.10.0
