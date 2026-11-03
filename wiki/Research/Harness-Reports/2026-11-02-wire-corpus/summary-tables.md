| model | class | cells (pass/run) | requests | tools/req | prov mix (mean per req) | schema bytes | prompt tok (mean) | schema tok exact (mean) | schema share mean / median / min-max | est-vs-http prompt (kernel/HTTP) | numCtx(http) | numCtxSource | out-clamped | head-trunc fired | surface diff turns |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gemma4:12b | simple | 5/5 | 13 | 1.7 | builtin:1.7 | 349 | 285 | 84 | 29.9% / 28.8% / 15.6-42.0% | 0.99 | 32768 | profile | 0/13 | 0/13 | 0/13 |
| gemma4:12b | umami-MCP | 14/15 | 61 | 24.0 | mcp:24.0 | 7586 | 2304 | 2101 | 83.4% / 86.4% / 62.0-94.4% | 1.03 | 32768 | profile | 0/61 | 0/61 | 0/61 |
| gemma4:e4b | simple | 6/6 | 20 | 2.5 | builtin:1.4 meta:1.0 | 524 | 345 | 126 | 35.9% / 38.3% / 22.2-52.5% | 1.01 | 32768 | profile | 0/20 | 0/20 | 0/20 |
| gemma4:e4b | umami-MCP | 9/15 | 39 | 25.0 | mcp:24.0 meta:1.0 | 7816 | 2398 | 2155 | 88.0% / 87.3% / 70.1-94.5% | 1.06 | 32768 | profile | 0/39 | 0/39 | 0/39 |

| model | task | cells pass/run | requests | mean tools | mean prompt tok | mean schema share |
|---|---|---|---|---|---|---|
| gemma4:12b | S1 | 3/3 | 9 | 2.0 | 310 | 33.8% |
| gemma4:12b | S2 | 2/2 | 4 | 1.0 | 230 | 21.0% |
| gemma4:12b | U1 | 2/3 | 9 | 24.0 | 2395 | 87.9% |
| gemma4:12b | U2 | 3/3 | 9 | 24.0 | 1840 | 89.0% |
| gemma4:12b | U3 | 3/3 | 11 | 24.0 | 2415 | 87.3% |
| gemma4:12b | U4 | 3/3 | 9 | 24.0 | 1859 | 88.0% |
| gemma4:12b | U5 | 3/3 | 23 | 24.0 | 2570 | 76.0% |
| gemma4:e4b | S1 | 3/3 | 9 | 3.0 | 364 | 43.7% |
| gemma4:e4b | S2 | 3/3 | 11 | 2.0 | 330 | 28.9% |
| gemma4:e4b | U1 | 2/3 | 9 | 25.0 | 2510 | 86.3% |
| gemma4:e4b | U2 | 0/3 | 6 | 25.0 | 2406 | 89.8% |
| gemma4:e4b | U3 | 3/3 | 8 | 25.0 | 2095 | 90.2% |
| gemma4:e4b | U4 | 3/3 | 8 | 25.0 | 2403 | 89.8% |
| gemma4:e4b | U5 | 1/3 | 8 | 25.0 | 2566 | 85.0% |

mismatches (trace vs http request count): gemma4_e4b__U4__r0: trace wire-request=3 http=2; gemma4_e4b__U5__r1: trace wire-request=3 http=2
