---
"@reactive-agents/reasoning": patch
---

A model that calls a tool which is not on its surface (a builtin left out by the `withTools()` opt-in default, a name outside an allowlist, a contract-forbidden tool, or a made-up name) is now told so on its next turn, with or without `requiredTools`. The `Guidance:` block names the tool, says whether it is not enabled for this run or does not exist, lists the tools the model can call, and states that the action was not performed. Before this, the resolver's hint was kept only in the run's internal steps and never reached the model. After two such calls the tools are withheld as before. The prose instruction now also says none of the attempted calls ran and that the answer must not claim them. The hint is a new guidance kind (`toolUnavailable`), and the required-tools (ICS) steer keeps it when it replaces the guidance record.
