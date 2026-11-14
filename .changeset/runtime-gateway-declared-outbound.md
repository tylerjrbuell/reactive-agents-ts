---
"@reactive-agents/runtime": patch
---

Gateway channel turns that deliver their reply through an MCP send tool now declare that tool as a required tool, so a run that finishes without a successful send is no longer reported as success. Router and native-adapter turns (the adapter delivers the reply) are unchanged.
