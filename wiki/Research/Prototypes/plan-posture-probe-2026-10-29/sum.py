import json,sys
for l in open('results.jsonl'):
    c=json.loads(l[5:])
    if c.get('timeout'): print(c); continue
    tr=c['toolsRun']; non=[t['n'] for t in tr if t['n'] not in('todo','recall','find','context-status','brief','pulse','final-answer','task-complete')]
    todo=sum(1 for t in tr if t['n']=='todo' and t['ok'])
    wire=sorted({n for w in c['wire'] if w for n in w})
    g=sorted({x for gg in c['guidance'] for x in gg})
    print(c['model'],c['posture'],c['rep'],'go' if c['go'] else '','ms',c['ms'],'| tools',[t['n']+('' if t['ok'] else '(FAIL)') for t in tr],'| nonplan',non,'| todoOK',todo,'| guards',c['guards'],'| wire',wire,'| rc',c['rc'])
    for t in c['turns']: print('   TURN',t['posture'],'err=',t['err'],'OUT=',t['out'][:300].replace('\n',' '))
    if '-v' in sys.argv: print('   GUID',g)
