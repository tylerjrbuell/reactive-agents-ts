# @reactive-agents/replay

## 0.12.0

### Minor Changes

-   d3ffc25: Initial release of `@reactive-agents/replay`. Records agent runs as structured traces and replays them deterministically against modified configs or prompts.

    **What shipped:**

    -   `loadRecordedRun(runId)` — loads a recorded trace from `@reactive-agents/trace`
    -   `replay(run, overrides)` — replays a run with tool results frozen from the original trace
    -   `makeReplayController(toolTable)` + `makeReplayToolLayer(ctrl, mode)` — Effect Layer that intercepts tool calls and returns recorded results; `"strict"` mode throws on unknown tools
    -   `diffTraces(a, b)` — structural diff of two trace outputs; returns `{ equal, diffs[] }`
    -   `computeArgsHash(args)` — deterministic hash for matching tool invocations across runs
    -   `ToolCallCompleted` event payload extended with `args`, `result`, `error`, `resultTruncated` (backward compatible; existing consumers ignore new fields)
    -   `rax diagnose replay-run <runId>` — CLI subcommand; summary diff output

    **Integration pattern:**

    ```typescript
    const ctrl = makeReplayController(run.toolTable)
    const layer = makeReplayToolLayer(ctrl, 'strict')
    new ReactiveAgentBuilder().withLayers(layer).build()
    ```

    Uses existing `.withLayers()` — no new builder method required.

### Patch Changes

-   Updated dependencies [d3ffc25]
-   Updated dependencies [d3ffc25]
-   Updated dependencies [d3ffc25]
-   Updated dependencies [1081024]
    -   @reactive-agents/core@0.11.0
    -   @reactive-agents/trace@0.11.0
    -   @reactive-agents/tools@0.11.0
