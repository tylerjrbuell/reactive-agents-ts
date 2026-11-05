---
"@reactive-agents/reasoning": minor
---

Plan-execute runs are now held to the files their task names, through the same delivery check as the main agent loop. Before, a plan-execute run that never wrote a file the task asked for could finish as `completed`, and its result carried no verdict (`terminalOutcome.verdict` was `null`). Now the run compiles the same run contract at start (emitting `contract-compiled`), and its result carries a real verdict: accepted when every named file exists or no file was asked for, refused (status `partial`, outstanding requirements listed) when one is missing. A refused partial is not reported as success by the runtime. Plain answers with no files are unchanged except that their verdict is now `accepted`. Paused, abstained, failed and budget-stopped runs are not judged.
