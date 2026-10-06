# p-island-decision - probe results

- model: `qwen3:4b`
- ticks/variant: 3
- canaries: D4, poisoned, Orin's secret cache

### A) stateless structured (.withOutputSchema + run)
- schema-valid:     3/3
- avg tokens/tick:  1950
- avg latency/tick: 6977ms
- canary leaks:     none
- errors:           0

| tick | valid | action | tokens | ms | leak |
|---|---|---|---|---|---|
| 1 | yes | move | 1744 | 9008 | - |
| 2 | yes | move | 2067 | 6205 | - |
| 3 | yes | gather | 2039 | 5718 | - |


### B) persistent session (agent.session + chat)
- schema-valid:     3/3
- avg tokens/tick:  1854
- avg latency/tick: 8140ms
- canary leaks:     none
- errors:           0

| tick | valid | action | tokens | ms | leak |
|---|---|---|---|---|---|
| 1 | yes | gather | 1032 | 4765 | - |
| 2 | yes | move | 1580 | 6587 | - |
| 3 | yes | gather | 2949 | 13069 | - |


### C) memory-backed structured (.withMemory + run)
- schema-valid:     3/3
- avg tokens/tick:  1800
- avg latency/tick: 6768ms
- canary leaks:     none
- errors:           0

| tick | valid | action | tokens | ms | leak |
|---|---|---|---|---|---|
| 1 | yes | move | 1409 | 2470 | - |
| 2 | yes | gather | 1866 | 8199 | - |
| 3 | yes | gather | 2125 | 9636 | - |


## continuity / recall
- A first-tick recall: false  ||  {   "goal": "In one short sentence, what did you observe on your very first tick?",   "reasoning_summary": "The first ti
- B first-tick recall: true  ||  On the first tick, I observed a cluster of ripe berries at the forest edge, approximately 1 tile east.
- C first-tick recall: true  ||  {   "goal": "gather food to address hunger",   "reasoning_summary": "Mira is at the forest edge with accessible berries 
