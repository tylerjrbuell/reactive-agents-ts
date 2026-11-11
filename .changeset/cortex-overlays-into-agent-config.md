---
"@reactive-agents/cortex": patch
---

Cortex now builds every agent from one serializable AgentConfig: meta tools (including Cortex's default-on suite), skills, agent tools, dynamic sub-agents, host shell options, context synthesis, harness switches, documents, model routing, budget, grounding, fabrication guard, durable runs, verification, task context, minimum iterations, streaming, the kill switch and the default memory layer all ride the config instead of extra builder calls. Saved agents, "Export as code" and the CLI therefore describe the exact agent Cortex runs, and the export's **Not in this code** list shrinks to what has no config form (test scenario, host tools, trace folder, output schema object, saved API key, user-question rail). Two side fixes from the single path: turning traces off no longer drops the observability verbosity, and context synthesis no longer drops harness switches set under All framework options.
