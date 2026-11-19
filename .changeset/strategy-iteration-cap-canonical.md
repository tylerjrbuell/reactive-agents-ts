---
"@reactive-agents/reasoning": patch
---

Tree-of-thought now honors the `maxIterations` you configure. Its execute phase used a hardcoded tier cap (6 local, 8 mid, 10 large, 12 frontier), so a run configured for 16 iterations stopped after about 7; the tier cap is now only the default when you set none. All strategies resolve the cap through one shared function (`resolveStrategyIterationCap`), a registry test fails for any strategy that ignores it, and plan-execute's per-step floor of 5 no longer lifts a step above a smaller user cap. The `direct` strategy resolves its cap the same way: with tools registered it defaults to 3 iterations (call, observe, answer) instead of 1, so a tool-calling first turn no longer ends as a failed `max_iterations` run; an explicit cap still wins, clamped to Direct's 1 to 3 ceiling.
