import json,glob,collections,os
cells=[]
for ph in ['p2','p3a']:
    for f in sorted(glob.glob(f'/home/tylerbuell/campaign-traces/{ph}/*.json')):
        cells+=json.load(open(f))['cells']
def ev(c):
    out=[]
    try:
        for l in open(c['traceFile'],errors='replace'):
            try: out.append(json.loads(l))
            except: pass
    except Exception as e: pass
    return out
def feats(c):
    E=ev(c)
    g=[e for e in E if e['kind']=='eval-graded']
    g=g[0] if g else {}
    tce=[e for e in E if e['kind']=='tool-call-end']
    rc=[e for e in E if e['kind']=='run-completed']
    rc=rc[0] if rc else {}
    rs=[e for e in E if e['kind']=='run-started']
    rs=rs[0] if rs else {}
    return dict(E=E,g=g,tce=tce,rc=rc,rs=rs,
        failed=[ch['name'] for ch in g.get('checks',[]) if not ch['passed']],
        passed=[ch['name'] for ch in g.get('checks',[]) if ch['passed']])
def partials():
    return [c for c in cells if c.get('endStatus')=='success' and not c['solved'] and 0<c['accuracy']<1]
def seen(f):
    out={};tr=False
    for e in f['E']:
        if e['kind']!='llm-exchange': continue
        for m in e.get('messages') or []:
            if m.get('role')=='tool':
                k=m.get('content','')
                out[k[:80]+str(len(k))]=k
                if m.get('truncated'): tr=True
    return list(out.values()),tr
def writes(f):
    d={}
    for e in f['tce']:
        if e['toolName']=='file-write' and e.get('ok'):
            a=e.get('args') or {}
            d[os.path.basename(a.get('path',''))]=a.get('content','')
    return d
