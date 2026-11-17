# RUNLOG (append-only; one line per driver invocation)

Protocol file sha256 at first run: 8879f1ba341d9f89e93d2afd93d8c2a1a1dc67ff48156e551120cb4708ab1d82
Substrate snapshot diff sha256 (HEAD 73b05b173 + uncommitted): 141b5b8ae24ee62ef847a26c0ce72a543b2f746e1b32f6cf8e67ad79b236509f
Worktrees: /home/tylerbuell/pp-head (HEAD), /home/tylerbuell/pp-wt (HEAD + snapshot); reasoning dist rebuilt in each.

23:31 head-D-plan-qwen3_latest rc=0 cells 0->1 systemone=41 http503=0 foreignAtStart=[nimble:latest] VOIDED(new cells) | {"ran":1,"remaining":0}
23:38 head-D-plan-qwen3_latest rc=0 cells 1->7 foreignReqs=15 voidedCells=2 foreignAtStart=[] | {"ran":6,"remaining":0}
23:48 head-D-plan-qwen3_latest rc=0 cells 7->15 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:4b] | {"ran":8,"remaining":6}
23:56 head-D-plan-cogito_14b rc=0 cells 0->11 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":11,"remaining":7}
00:04 head-noCatalog-plan-qwen3_latest rc=0 cells 0->9 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":9,"remaining":9}
00:12 head-noCatalog-plan-cogito_14b rc=0 cells 0->12 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":12,"remaining":6}
00:20 head-noBudget-plan-qwen3_latest rc=0 cells 0->8 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":8,"remaining":10}
00:28 head-noBudget-plan-cogito_14b rc=0 cells 0->12 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":12,"remaining":6}
00:32 head-D@4-plan-qwen3_latest rc=0 cells 0->1 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":1,"remaining":0}
00:40 head-noBudget-plan-qwen3_latest rc=0 cells 8->16 foreignReqs=0 voidedCells=0 foreignAtStart=[] | {"ran":8,"remaining":2}
00:44 head-noBudget-plan-cogito_14b rc=0 cells 12->18 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":6,"remaining":0}
00:53 head-D@4-plan-qwen3_latest rc=0 cells 1->8 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":7,"remaining":4}
01:01 head-D@4-plan-cogito_14b rc=0 cells 0->12 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":12,"remaining":0}
01:11 head-noBudget@4-plan-qwen3_latest rc=0 cells 0->8 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":8,"remaining":4}
01:18 head-noBudget@4-plan-cogito_14b rc=0 cells 0->12 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":12,"remaining":0}
01:26 head-wrapUp@4-plan-qwen3_latest rc=0 cells 0->6 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":6,"remaining":6}
01:35 head-wrapUp@4-plan-cogito_14b rc=0 cells 0->12 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":12,"remaining":0}
01:43 head-recon-plan-qwen3_latest rc=0 cells 0->11 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":11,"remaining":7}
01:51 head-recon-plan-cogito_14b rc=0 cells 0->12 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":12,"remaining":6}
01:59 wt-D-plan-qwen3_latest rc=0 cells 0->10 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":10,"remaining":8}
02:07 wt-D-plan-cogito_14b rc=0 cells 0->12 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":12,"remaining":6}
02:15 head-wrapUp-plan-qwen3_latest rc=0 cells 0->8 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":8,"remaining":10}
02:23 head-wrapUp-plan-cogito_14b rc=0 cells 0->12 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":12,"remaining":6}
02:28 head-D-plan-qwen3_latest rc=0 cells 15->21 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":6,"remaining":0}
02:34 head-D-plan-cogito_14b rc=0 cells 11->18 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":7,"remaining":0}
02:42 head-noCatalog-plan-qwen3_latest rc=0 cells 9->17 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":8,"remaining":1}
02:45 head-noCatalog-plan-cogito_14b rc=0 cells 12->18 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":6,"remaining":0}
02:49 head-D-strategy_blueprint-qwen3_latest rc=0 cells 0->12 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":12,"remaining":0}
02:55 head-D-strategy_blueprint-cogito_14b rc=0 cells 0->12 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":12,"remaining":0}
02:59 wt-D-strategy_blueprint-qwen3_latest rc=0 cells 0->12 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":12,"remaining":0}
03:05 wt-D-strategy_blueprint-cogito_14b rc=0 cells 0->12 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":12,"remaining":0}
03:11 head-D-strategy_plan-execute-reflect-qwen3_latest rc=0 cells 0->12 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":12,"remaining":0}
03:19 head-D-strategy_plan-execute-reflect-cogito_14b rc=0 cells 0->10 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":10,"remaining":2}
03:24 wt-D-strategy_plan-execute-reflect-qwen3_latest rc=0 cells 0->12 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":12,"remaining":0}
03:31 wt-D-strategy_plan-execute-reflect-cogito_14b rc=0 cells 0->12 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":12,"remaining":0}
03:39 head-lean-plan-qwen3_latest rc=0 cells 0->11 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":11,"remaining":7}
03:47 head-lean-plan-cogito_14b rc=0 cells 0->12 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":12,"remaining":6}
03:55 head-answerTurn-plan-qwen3_latest rc=0 cells 0->8 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":8,"remaining":10}
04:03 head-answerTurn-plan-cogito_14b rc=0 cells 0->13 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":13,"remaining":5}
04:07 head-D-strategy_blueprint-qwen3_latest rc=0 cells 12->18 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":6,"remaining":-12}
04:12 head-D-strategy_blueprint-cogito_14b rc=0 cells 12->18 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":6,"remaining":-12}
04:15 wt-D-strategy_blueprint-qwen3_latest rc=0 cells 12->18 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":6,"remaining":-12}
04:22 wt-D-strategy_blueprint-cogito_14b rc=0 cells 12->18 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":6,"remaining":-12}
04:26 head-D-strategy_plan-execute-reflect-qwen3_latest rc=0 cells 12->18 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":6,"remaining":-12}
04:32 head-D-strategy_plan-execute-reflect-cogito_14b rc=0 cells 10->16 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":6,"remaining":-10}
04:35 wt-D-strategy_plan-execute-reflect-qwen3_latest rc=0 cells 12->18 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":6,"remaining":-12}
04:42 wt-D-strategy_plan-execute-reflect-cogito_14b rc=0 cells 12->18 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":6,"remaining":-12}
04:50 head-D-direct-qwen3_latest rc=0 cells 0->16 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":16,"remaining":2}
04:56 head-D-direct-cogito_14b rc=0 cells 0->18 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":18,"remaining":0}
04:59 head-D-plan-qwen3_latest rc=0 cells 21->27 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":6,"remaining":-15}
05:04 head-recon-plan-qwen3_latest rc=0 cells 11->18 foreignReqs=0 voidedCells=0 foreignAtStart=[] | {"ran":7,"remaining":-9}
05:06 head-D-plan-cogito_14b rc=0 cells 18->24 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":6,"remaining":-15}
05:10 head-recon-plan-cogito_14b rc=0 cells 12->19 foreignReqs=0 voidedCells=0 foreignAtStart=[] | {"ran":7,"remaining":-10}
05:18 head-D@4-plan-qwen3_latest rc=0 cells 8->16 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":8,"remaining":8}
05:26 head-D@4-plan-cogito_14b rc=0 cells 12->24 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":12,"remaining":0}
05:34 head-noBudget@4-plan-qwen3_latest rc=0 cells 8->17 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":9,"remaining":7}
05:41 head-noBudget@4-plan-cogito_14b rc=0 cells 12->24 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":12,"remaining":0}
05:49 head-wrapUp@4-plan-qwen3_latest rc=0 cells 6->13 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":7,"remaining":11}
05:57 head-wrapUp@4-plan-cogito_14b rc=0 cells 12->24 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":12,"remaining":0}
06:00 head-noBudget-plan-qwen3_latest rc=0 cells 16->18 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":2,"remaining":0}
06:08 wt-D-plan-qwen3_latest rc=0 cells 10->18 foreignReqs=0 voidedCells=0 foreignAtStart=[] | {"ran":8,"remaining":0}
06:12 wt-D-plan-cogito_14b rc=0 cells 12->18 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":6,"remaining":0}
06:20 head-wrapUp-plan-qwen3_latest rc=0 cells 8->17 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":9,"remaining":1}
06:25 head-wrapUp-plan-cogito_14b rc=0 cells 12->18 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":6,"remaining":0}
06:28 head-noCatalog-plan-qwen3_latest rc=0 cells 17->18 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":1,"remaining":0}
06:33 head-lean-plan-qwen3_latest rc=0 cells 11->18 foreignReqs=0 voidedCells=0 foreignAtStart=[] | {"ran":7,"remaining":0}
06:37 head-lean-plan-cogito_14b rc=0 cells 12->18 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":6,"remaining":0}
06:45 head-answerTurn-plan-qwen3_latest rc=0 cells 8->18 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":10,"remaining":0}
06:56 head-wrapUp@4-plan-qwen3_latest rc=0 cells 13->20 foreignReqs=0 voidedCells=0 foreignAtStart=[] | {"ran":7,"remaining":4}
07:04 head-nbWrapUp@4-plan-cogito_14b rc=0 cells 0->12 foreignReqs=0 voidedCells=0 foreignAtStart=[qwen3:latest] | {"ran":12,"remaining":0}
07:13 head-nbWrapUp@4-plan-qwen3_latest rc=0 cells 0->9 foreignReqs=0 voidedCells=0 foreignAtStart=[cogito:14b] | {"ran":9,"remaining":3}
07:16 head-nbWrapUp@4-plan-qwen3_latest rc=0 cells 9->12 foreignReqs=0 voidedCells=0 foreignAtStart=[] | {"ran":3,"remaining":0}
