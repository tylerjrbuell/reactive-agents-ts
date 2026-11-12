---
"@reactive-agents/runtime": patch
---

Gateway channel messages now have one consumer and an honest history. A message handled by the channel router (`.withChannels({ routes })`) is no longer also run by the legacy gateway chat handler, so routed messages stop running twice outside the router's access decision and meters. A message from a native channel adapter no longer tells the model to call an MCP send tool that does not exist. The gateway chat history keeps only replies from runs that succeeded: a failed, abstained or dropped run stores nothing (its reasoning text used to become an assistant turn that later runs read back), and `executeEvent` now returns `undefined` for a run that did not succeed. Kernel tool schemas carry `mutatesExternalState` from the tool definition.
