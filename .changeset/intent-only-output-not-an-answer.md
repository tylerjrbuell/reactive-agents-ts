---
"@reactive-agents/reasoning": patch
---

An answer that only announces the next step ("Let me list the workspace.", "I'll check the files now.") is no longer accepted as a finished result. The output-not-continuation-intent check now flags a short output (one or two sentences, up to 200 characters, with no list, table or code block) when every sentence is a first-person future-intent clause, whatever the verb. A real answer that ends with "Let me know if you need more." still passes. Tree-of-thought also has a test now confirming that a model's thinking never becomes its answer.
