import sys,re,os,json,collections
sys.path.insert(0,'/tmp/claude-1000/-home-tylerbuell-Documents-AIProjects-reactive-agents-ts/51e326b4-70ef-4738-92d8-8745321a2b60/scratchpad')
from load import *

EXCL={'gemma4:e4b|h3-required-tools|1','gemma4:e4b|rw-2|2'}  # not in audit's 98
MAXIT={'rw-2':15,'rw-3':15,'h3-plan-only':12,'h3-todo-heavy':14,'h3-required-tools':10,'rw-4':15,'rw-6':15,'rw-7':25,'rw-9':15,'lh-debug-green':24,'lh-pipeline-stages':22,'lh-enumerate-audit':24}
CAUSES=['NR','RO','RW','HAL','FMT','TM']
PRIO=['NR','HAL','TM','RW','RO','FMT']

def okreads(f):
    s=set()
    for e in f['tce']:
        if e['toolName']=='file-read' and e.get('ok') and not (e.get('result') or '').startswith('⚠'):
            s.add(os.path.basename(str((e.get('args') or {}).get('path',''))))
    return s
def okwrites(f):
    d={}
    for e in f['tce']:
        if e['toolName']=='file-write' and e.get('ok') and (e.get('result') or '').startswith('✓'):
            a=e.get('args') or {}
            d[os.path.basename(str(a.get('path','')))]=a.get('content','')
    return d
def guard_blocked(f):
    return sum(1 for e in f['tce'] if (e.get('result') or '').startswith('⚠'))

def classify(c,f):
    t=c['taskId'];items=[]  # (item, cause, note)
    R=okreads(f);W=okwrites(f);out=f['rc'].get('output','') or ''
    ce_ok=[e for e in f['tce'] if e['toolName']=='code-execute' and e.get('ok') and not (e.get('result') or '').startswith('⚠')]
    flags=set()
    if t=='rw-2':
        for x in f['failed']:
            items.append((x,'RW','anchored on discount red herring' if not x.startswith('dollar') else 'dollar figure outside band (per-unit / wrong total)'))
    elif t=='rw-3':
        rep=W.get('report.md','')
        for x in f['failed']:
            if x.startswith('contains a data table'): items.append((x,'FMT','pipe-table requirement not in prompt'))
            elif x.startswith('salary claim'):
                if re.search(r'(average|avg|mean)[^\n]{0,60}(salary|\$)|salary[^\n]{0,40}(average|avg|mean)',rep,re.I): items.append((x,'RW','dept average stated but wrong/ungrounded'))
                else: items.append((x,'RO','no department aggregate computed; anecdotal extremes'))
            else: items.append((x,'RO','section/claim absent'))
    elif t=='h3-plan-only':
        for x in f['failed']:
            if x.startswith('totalUnits'):
                tj=W.get('totals.json')
                items.append((x,'TM' if tj is None else 'RW','totals.json never written' if tj is None else 'mental-arithmetic sum wrong (no compute tool offered)'))
            elif x.startswith('low-stock'):
                ls=W.get('low-stock.txt')
                if ls is None or not ls.strip() or 'sku,qty' in ls or ls.strip().startswith('{'): items.append((x,'TM','wrong content / wrong file / empty'))
                else: items.append((x,'RW','filter/selection wrong (extra or missing SKU)'))
            elif x.startswith('totals.json parses') or x.startswith('skuCount'): items.append((x,'TM','totals.json never written'))
            elif x.startswith('summary.md'): items.append((x,'FMT','required "## Reorder" heading missing/unwritten'))
            else: items.append((x,'TM','other'))
    elif t=='h3-required-tools':
        v=W.get('mean.txt','')
        for x in f['failed']:
            if v.strip().upper()=='TODO': items.append((x,'TM','placeholder literal written'))
            else: items.append((x,'RW','mental-arithmetic mean; code-execute available'+(' and unused' if not ce_ok else ' but result unused')))
        flags.add('compute_tool_available_unused' if not ce_ok else 'compute_tool_used_still_wrong')
    elif t=='h3-todo-heavy':
        for x in f['failed']:
            if c['tier']=='cogito:8b': items.append((x,'TM','template placeholder written; corrective rewrite blocked by repetition guard'))
            else: items.append((x,'RW','wrote 58 for 63*2 (stale value; no re-read)'))
    elif t=='rw-6':
        for x in f['failed']:
            if x.startswith('report reasons'):
                rep=W.get('optimization-report.md','')
                if re.search(r'\\log',rep): items.append((x,'FMT','grader regex misses LaTeX "O(N \\log N)" (grader brittleness)'))
                else: items.append((x,'HAL','accepted false premise; invented optimizations, no n log n verdict'))
            elif x.startswith('sort.ts was not'): items.append((x,'HAL','rewrote already-optimal code on false premise'))
            else: items.append((x,'RW','introduced bug (undefined const) with no test run'))
    elif t=='rw-7':
        for x in f['failed']:
            fn='processor.ts' if x.startswith('processor') else 'pipeline.ts'
            if fn not in R: items.append((x,'NR',fn+' never read'))
            elif fn not in W: items.append((x,'RO',fn+' read, never fixed'))
            else: items.append((x,'RW',fn+' rewritten but bug persists'))
        if re.search(r'bun test.*(exit|pass)',out,re.I) and not ce_ok: flags.add('claims_verified_without_running')
    elif t=='lh-debug-green':
        for x in f['failed']:
            m=x.split(':')[0]+'.ts'
            if m not in R: items.append((x,'NR',m+' never read'))
            elif m not in W: items.append((x,'RO',m+' read, never fixed'))
            else: items.append((x,'RW',m+' edited, fix wrong (tests not passed/run)'))
        if not ce_ok: flags.add('claims_verified_without_running')
    elif t=='lh-enumerate-audit':
        for x in f['failed']: items.append((x,'NR','11 of 12 invoice files never read; audit.json fabricated'))
        flags.add('fabricated_unread_inputs')
    elif t=='lh-pipeline-stages':
        for x in f['failed']:
            if 'orders-a.csv' not in R: items.append((x,'NR','batch CSVs never read; output fabricated (US/EU rows)'))
            else: items.append((x,'RW','all batches read; aggregation/total wrong (mental arithmetic)'))
        if 'orders-a.csv' not in R: flags.add('fabricated_unread_inputs')
    elif t=='rw-4':
        for x in f['failed']:
            if c['tier']=='qwen3.5:latest': items.append((x,'TM','comments fetch summarised/previewed (2400B); counts not recoverable'))
            else: items.append((x,'NR','comments never fetched'))
    elif t=='rw-9':
        for x in f['failed']:
            if c['run']==1: items.append((x,'RO','read fallback snapshot; omitted market cap'))
            else: items.append((x,'TM','tried HTTP URL via file-read; error; no data written'))
    else:
        for x in f['failed']: items.append((x,'TM','unclassified'))
    return items,flags

def run():
    recs=[]
    for c in sorted(partials(),key=lambda c:(c['taskId'],c['tier'],c['run'])):
        if c['cellId'] in EXCL: continue
        f=feats(c); items,flags=classify(c,f)
        cnt=collections.Counter(i[1] for i in items)
        prim=sorted(cnt,key=lambda k:(-cnt[k],PRIO.index(k)))[0]
        mx=MAXIT.get(c['taskId'],15)
        recs.append(dict(cell=c['cellId'],task=c['taskId'],tier=c['tier'],acc=c['accuracy'],it=c['iterations'],mx=mx,tokens=c['tokens'],tb=c['terminatedBy'],
            items=items,prim=prim,flags=sorted(flags),guard=guard_blocked(f),ce_used=any(e['toolName']=='code-execute' for e in f['tce']),
            ncalls=len(f['tce'])))
    return recs
if __name__=='__main__':
    recs=run()
    json.dump(recs,open(os.path.dirname(os.path.abspath(__file__))+'/recs.json','w'))
    print(len(recs))
    ic=collections.Counter(i[1] for r in recs for i in r['items']); print('ITEM',sum(ic.values()),dict(ic))
    pc=collections.Counter(r['prim'] for r in recs); print('RUN',dict(pc))
