import sys,json,collections
sys.path.insert(0,'/tmp/claude-1000/-home-tylerbuell-Documents-AIProjects-reactive-agents-ts/51e326b4-70ef-4738-92d8-8745321a2b60/scratchpad')
recs=json.load(open('/tmp/claude-1000/-home-tylerbuell-Documents-AIProjects-reactive-agents-ts/51e326b4-70ef-4738-92d8-8745321a2b60/scratchpad/recs.json'))
def lever(r,i):
    n=i[2];c=i[1];t=r['task']
    if 'arithmetic' in n or 'dollar' in n or 'aggregation' in n or 'dept average' in n: return 'A compute-offload (arithmetic/aggregation)'
    if 'red herring' in n: return 'B alt-hypothesis elimination (rw-2 red herring)'
    if c=='NR': return 'C read-coverage (never read inputs)'
    if c=='RO' and t=='rw-3': return 'D1 omitted aggregate/section (rw-3 analysis)'
    if c=='RO': return 'D2 read-but-not-applied (fix/write omitted)'
    if c=='RW': return 'E wrong fix/selection/value despite evidence'
    if c=='HAL': return 'F false premise/fabrication'
    if c=='FMT' and 'not in prompt' in n: return 'G hidden format rubric (unstated in prompt)'
    if c=='FMT' and 'grader' in n: return 'H grader brittleness'
    if c=='FMT': return 'G2 instruction miss (heading)'
    if c=='TM': return 'I tool/guard mechanics (placeholder, wrong file, guard-block, compression)'
    return 'X'
L=collections.Counter();N=collections.Counter()
for r in recs:
    k=len(r['items'])
    for i in r['items']:
        l=lever(r,i);L[l]+=(1-r['acc'])/k;N[l]+=1
tot=sum(L.values())
for l,v in sorted(L.items()): print(f"{l} | items {N[l]} | credit {v:.2f} | {100*v/tot:.0f}%")
print('total',round(tot,2))
# model-specific: stack for claims verified
print([ (r['cell'],r['flags']) for r in recs if r['flags']])
