import json,csv,os
d=os.path.dirname(os.path.abspath(__file__))
recs=json.load(open(d+'/recs.json'))
w=csv.writer(open(d+'/per-run.csv','w'))
w.writerow(['cell','task','model','accuracy','iterations','maxIter','tokens','terminatedBy','primaryCause','guardBlockedCalls','flags','missedItem','itemCause','note'])
for r in recs:
    for i in r['items']:
        w.writerow([r['cell'],r['task'],r['tier'],round(r['acc'],2),r['it'],r['mx'],r['tokens'],r['tb'],r['prim'],r['guard'],'|'.join(r['flags']),i[0],i[1],i[2]])
