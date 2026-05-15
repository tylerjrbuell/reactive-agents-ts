# @reactive-agents/cortex

## 0.10.7

### Patch Changes

-   Updated dependencies [d3ffc25]
-   Updated dependencies [d3ffc25]
-   Updated dependencies [d3ffc25]
-   Updated dependencies [1081024]
-   Updated dependencies [d3ffc25]
    -   @reactive-agents/core@0.11.0
    -   @reactive-agents/runtime@0.11.0
    -   @reactive-agents/llm-provider@0.11.0
    -   @reactive-agents/memory@0.11.0
    -   @reactive-agents/tools@0.11.0
    -   @reactive-agents/observability@0.11.0
    -   @reactive-agents/gateway@0.11.0
    -   @reactive-agents/reactive-intelligence@0.11.0

## 0.10.6

### Patch Changes

-   1a934f0: feat(cortex-ui): load tools dynamically from catalog API

    Replaces the hardcoded AVAILABLE_TOOLS list in AgentConfigPanel with a dynamic fetch from `/api/tools/catalog`. This ensures the UI automatically shows all builtin and meta-tools (web-search, crypto-price, file operations, git/gh CLIs, brief, find, discover-tools, etc.) without requiring UI code changes when new tools are added.

    The fix also adds comprehensive icon mappings for all tools so they display consistently in the UI.

    -   @reactive-agents/core@0.10.6
    -   @reactive-agents/llm-provider@0.10.6
    -   @reactive-agents/memory@0.10.6
    -   @reactive-agents/tools@0.10.6
    -   @reactive-agents/observability@0.10.6
    -   @reactive-agents/gateway@0.10.6
    -   @reactive-agents/reactive-intelligence@0.10.6
    -   @reactive-agents/runtime@0.10.6

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
    -   @reactive-agents/core@0.10.5
    -   @reactive-agents/gateway@0.10.5
    -   @reactive-agents/llm-provider@0.10.5
    -   @reactive-agents/memory@0.10.5
    -   @reactive-agents/observability@0.10.5
    -   @reactive-agents/reactive-intelligence@0.10.5
    -   @reactive-agents/runtime@0.10.5
    -   @reactive-agents/tools@0.10.5

## 0.10.4

### Patch Changes

-   8415dbc: Coordinated v0.10.4 release — uniform patch bump across all published packages

    -   Aligned all packages to 0.10.2 baseline matching current npm release
    -   Cortex published to npm with lazy-load CLI support (0.10.2→0.10.4)
    -   Fixed bun exports pointing to non-existent src/ directory
    -   All packages bump uniformly to 0.10.4 for coordinated release

-   Updated dependencies [8415dbc]
    -   @reactive-agents/core@0.10.4
    -   @reactive-agents/gateway@0.10.4
    -   @reactive-agents/llm-provider@0.10.4
    -   @reactive-agents/memory@0.10.4
    -   @reactive-agents/observability@0.10.4
    -   @reactive-agents/reactive-intelligence@0.10.4
    -   @reactive-agents/runtime@0.10.4
    -   @reactive-agents/tools@0.10.4

## 0.1.2

### Patch Changes

-   Updated dependencies [80284a4]
    -   @reactive-agents/core@0.10.1
    -   @reactive-agents/gateway@0.10.1
    -   @reactive-agents/llm-provider@0.10.1
    -   @reactive-agents/memory@0.10.1
    -   @reactive-agents/observability@0.10.1
    -   @reactive-agents/reactive-intelligence@0.10.1
    -   @reactive-agents/runtime@0.10.1
    -   @reactive-agents/tools@0.10.1

## 0.1.1

### Patch Changes

-   Updated dependencies [2cfded2]
    -   @reactive-agents/core@0.10.0
    -   @reactive-agents/gateway@0.10.0
    -   @reactive-agents/llm-provider@0.10.0
    -   @reactive-agents/memory@0.10.0
    -   @reactive-agents/observability@0.10.0
    -   @reactive-agents/reactive-intelligence@0.10.0
    -   @reactive-agents/runtime@0.10.0
    -   @reactive-agents/tools@0.10.0

## 0.1.1

### Patch Changes

-   Updated dependencies [3f8146a]
-   Updated dependencies [3f8146a]
    -   @reactive-agents/core@0.10.0
    -   @reactive-agents/gateway@0.10.0
    -   @reactive-agents/llm-provider@0.10.0
    -   @reactive-agents/memory@0.10.0
    -   @reactive-agents/observability@0.10.0
    -   @reactive-agents/reactive-intelligence@0.10.0
    -   @reactive-agents/runtime@0.10.0
    -   @reactive-agents/tools@0.10.0
