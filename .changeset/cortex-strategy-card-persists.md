---
"@reactive-agents/cortex": patch
"@reactive-agents/ui-core": patch
---

The strategy card now stays on a chat turn after it ends (finished, stopped or paused) and after a reload, collapsed to a one-line summary ("Reflexion · 2 rounds, accepted", "Tree of Thought · 9 nodes, best 0.80", "Code action · 1 attempt, verified"). Cortex stores the settled strategy run with the turn trace (additive; older turns show no card). ui-core adds `strategyRunForStorage` / `strategyRunFromStorage` to bound and read a stored run (long code, output and critique text is clipped). A Paused reply's Continue card now reads "Paused by you" instead of "Stopped by you". Strategy phases no longer fall back to a raw "Main" label: the reflexion first pass reads "Drafting", the other unmapped kernel phases (plan-execute `schedule`, blueprint `degrade`, tree-of-thought `bfs-skipped`, adaptive `heuristic` / `classifier-skip` / `cost-downgrade` / `fallback`) have labels, and a conformance test scans the reasoning source so a new emitted label fails until mapped.
