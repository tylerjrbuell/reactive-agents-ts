---
"@reactive-agents/cortex": patch
---

Export as code now prints the framework's own `agentConfigToSource` output (new `POST /api/agent-config/source`) for the Lab Builder and saved agents, instead of a Cortex-written exporter that covered about 15 fields and mapped memory wrong. The export lists the settings Cortex applies that the code does not contain, and never prints a secret: a saved API key is left out and MCP `env` / `headers` values print as `process.env` references.
