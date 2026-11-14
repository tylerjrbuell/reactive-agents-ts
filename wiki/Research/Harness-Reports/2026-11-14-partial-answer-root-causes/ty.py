import sys,json,collections
recs=json.load(open('/tmp/claude-1000/-home-tylerbuell-Documents-AIProjects-reactive-agents-ts/51e326b4-70ef-4738-92d8-8745321a2b60/scratchpad/recs.json'))
def ty(r,i):
    x=i[0];n=i[2];t=r['task']
    if 'arithmetic' in n or 'dollar' in n or 'aggregation' in n or x.startswith(('totalUnits','mean within')): return 'computation (sum/mean/total)'
    if t in('lh-debug-green','rw-7','rw-6','rw-4'): return 'per-file code fix / edit (multi-target)'
    if t in('lh-enumerate-audit','lh-pipeline-stages') or x.startswith('low-stock') or t=='h3-todo-heavy': return 'enumeration / per-item batch'
    if t=='rw-2': return 'diagnosis / cross-column hypothesis'
    if t=='rw-3' and not x.startswith('contains'): return 'analysis synthesis (aggregate + claim)'
    if i[1]=='FMT': return 'format / structure'
    return 'other (tool mechanics, rw-9, totals.json)'
c=collections.defaultdict(collections.Counter)
for r in recs:
    for i in r['items']: c[ty(r,i)][i[1]]+=1
for k,v in sorted(c.items(),key=lambda kv:-sum(kv[1].values())): print(k,sum(v.values()),dict(v))
# per model families check: tokens
import statistics as st
print('median tokens partial',st.median(r['tokens'] for r in recs))
# final-answer stops w/ TP controls: how many partial runs ended through loop_detected:all_tools_called
print(sum(1 for r in recs if r['tb'].startswith('loop_detected')), [ (r['cell'],round(r['acc'],2)) for r in recs if r['tb'].startswith('loop_detected')])
