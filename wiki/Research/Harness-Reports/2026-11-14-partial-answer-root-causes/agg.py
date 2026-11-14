import sys,json,collections,statistics as st
sys.path.insert(0,'/tmp/claude-1000/-home-tylerbuell-Documents-AIProjects-reactive-agents-ts/51e326b4-70ef-4738-92d8-8745321a2b60/scratchpad')
from load import *
import classify
recs=classify.run()
C=classify.CAUSES
def tab(title,keyf,itemlevel=True):
    print('\n##',title)
    d=collections.defaultdict(collections.Counter);n=collections.Counter()
    for r in recs:
        k=keyf(r);n[k]+=1
        if itemlevel:
            for i in r['items']: d[k][i[1]]+=1
        else: d[k][r['prim']]+=1
    print('key | runs | items |',' | '.join(C))
    for k in sorted(d,key=lambda k:-sum(d[k].values())):
        print(k,'|',n[k],'|',sum(d[k].values()),'|',' | '.join(str(d[k][c]) for c in C))
tab('ITEM cause overall',lambda r:'all')
tab('RUN primary cause overall',lambda r:'all',False)
tab('ITEM by task',lambda r:r['task'])
tab('RUN primary by task',lambda r:r['task'],False)
tab('ITEM by model',lambda r:r['tier'])
tab('RUN primary by model',lambda r:r['tier'],False)
SIZE={'qwen3:4b':'small(<=4B-ish)','granite4:tiny-h':'small(<=4B-ish)','gemma4:e4b':'small(<=4B-ish)','llama3.1:latest':'mid(8B)','cogito:8b':'mid(8B)','qwen3.5:latest':'mid(8B)','gpt-oss:latest':'mid(20B MoE)','qwen2.5:14b':'large(14B)','qwen3:14b':'large(14B)'}
tab('ITEM by size',lambda r:SIZE[r['tier']])
tab('RUN primary by size',lambda r:SIZE[r['tier']],False)
# early stop
print('\n## stop behaviour')
MODEL_STOP=('end_turn','final_answer')
for lab,fil in [('all',lambda r:True)]+[(t,(lambda t:lambda r:r['task']==t)(t)) for t in sorted({r['task'] for r in recs})]:
    rs=[r for r in recs if fil(r)]
    ms=[r for r in rs if r['tb'] in MODEL_STOP]
    half=[r for r in rs if r['it']<=0.5*r['mx']]
    print(lab,'n',len(rs),'model-chosen stop',len(ms),'it<=50% budget',len(half),'used>=90%',sum(1 for r in rs if r['it']>=0.9*r['mx']),'median it',st.median(r['it'] for r in rs),'median tok',st.median(r['tokens'] for r in rs))
print(collections.Counter(r['tb'] for r in recs))
print('compute tool used among arithmetic failures (h3-required-tools):',collections.Counter(r['ce_used'] for r in recs if r['task']=='h3-required-tools'))
print('guard-blocked calls>0:',sum(1 for r in recs if r['guard']>0),collections.Counter(r['task'] for r in recs if r['guard']>0))
print('flags',collections.Counter(f for r in recs for f in r['flags']))
# credit lost
lost=collections.Counter()
for r in recs: lost[r['task']]+=1-r['acc']
print('credit lost by task',{k:round(v,2) for k,v in lost.items()}, 'total',round(sum(lost.values()),2))
# credit lost by cause (apportioned by item share)
cl=collections.Counter()
for r in recs:
    n=len(r['items'])
    for i in r['items']: cl[i[1]]+=(1-r['acc'])/n
print('credit lost by cause (apportioned)',{k:round(v,2) for k,v in cl.items()})
json.dump(recs,open('/tmp/claude-1000/-home-tylerbuell-Documents-AIProjects-reactive-agents-ts/51e326b4-70ef-4738-92d8-8745321a2b60/scratchpad/recs.json','w'))
# controls
print('\n## CONTROL: solved success runs on same tasks')
tasks={r['task'] for r in recs}
ctl=[c for c in cells if c['taskId'] in tasks and c.get('endStatus')=='success' and c['solved']]
print('n',len(ctl))
byt=collections.defaultdict(list)
for c in ctl: byt[c['taskId']].append(c)
allt=collections.defaultdict(list)
for c in cells:
    if c['taskId'] in tasks and c.get('endStatus') is not None: allt[c['taskId']].append(c)
for t in sorted(tasks):
    cs=byt[t]; pr=[r for r in recs if r['task']==t]
    print(t,'solved-success n',len(cs),'models',dict(collections.Counter(c['tier'] for c in cs)),'| med it solved',st.median([c['iterations'] for c in cs]) if cs else None,'vs partial',st.median([r['it'] for r in pr]),'| med tok solved',st.median([c['tokens'] for c in cs]) if cs else None,'vs partial',st.median([r['tokens'] for r in pr]))
