import random, math
z=1.96
def wilson(x,n):
    if n==0: return (0,1,0)
    p=x/n; d=1+z*z/n
    c=(p+z*z/(2*n))/d; h=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
    return (c-h,c+h,p)
def ci(strata):
    # strata: list of (xb,nb,xc,nc); equal-n so equal weights
    T=len(strata); w=1/T
    rd=0; lo=0; hi=0
    for xb,nb,xc,nc in strata:
        lb,ub,pb=wilson(xb,nb); lc,uc,pc=wilson(xc,nc)
        rd+=w*(pc-pb)
        lo+=w*w*((pc-lc)**2+(ub-pb)**2)
        hi+=w*w*((uc-pc)**2+(pb-lb)**2)
    return rd-math.sqrt(lo), rd, rd+math.sqrt(hi)
# per-task rates, default arm, from v0.19 pooled 10 runs: qwen / cogito (12 tasks)
Q=[0.0,0.2,0.78,0.0,1,1,1,0.9,1,1,1,1]  # rw2 rw3 rw6 rw7 rw9 ab4 ab5 plan todo req cont exact
C=[0.0,0.4,0.6,0.0,1,1,1,0.0,0.1,0.0,1,0.9]
Q=[0.0,0.2,0.78,0.0,1,1,1,0.9,1,1,1,1]
def run(P,eff,k,reps=2000,seed=1):
    r=random.Random(seed); widths=[];cover=0;excl0=0
    for _ in range(reps):
        st=[]
        for p,e in zip(P,eff):
            pc=min(1,max(0,p+e))
            st.append((sum(r.random()<p for _ in range(k)),k,sum(r.random()<pc for _ in range(k)),k))
        lo,rd,hi=ci(st); widths.append((hi-lo)/2)
        true=sum(eff)/len(eff)
        if lo<=true<=hi: cover+=1
        if lo>0: excl0+=1
    return sum(widths)/reps, cover/reps, excl0/reps
import sys
for name,P in (("qwen",Q),("cogito",C)):
    for k in (5,8,10,15,20):
        hw,cv,ex=run(P,[0]*12,k,800)
        print(name,"k",k,"mean half-width pp",round(hw*100,1),"coverage",cv)
# power: harness effect +10pp on the non-saturated + +? plain collapse scenario
for name,P in (("qwen",Q),("cogito",C)):
    for k in (5,10,15):
        # plain loop worse by 15pp on every non-floor non-saturated tasks (p in .1..0.9) and 40pp on trap tasks
        eff=[ -0.0 if p in (0,1) else 0.15 for p in P]  # candidate=plain?? invert: here candidate=harness gains
        hw,cv,ex=run([max(0,p-e) for p,e in zip(P,eff)],eff,k,600)
        print(name,"k",k,"harness gain 15pp on mid tasks only: P(lower bound>0)",ex,"hw",round(hw*100,1))
print("--- power: harness gains on 4 tasks, rest equal; C-set 10 tasks")
import random
def power(Pharn,Pplain,k,reps=1500,seed=3):
    r=random.Random(seed);hit=0;hws=[]
    for _ in range(reps):
        st=[(sum(r.random()<pb for _ in range(k)),k,sum(r.random()<pa for _ in range(k)),k) for pa,pb in zip(Pharn,Pplain)]
        lo,rd,hi=ci(st);hws.append((hi-lo)/2);hit+= lo>0
    return hit/reps, sum(hws)/reps
# capability-set approx: cogito rates for harness; plain loses 40pp on 4 mid tasks, equal elsewhere
Ph=[0.0,0.4,0.6,0.0,1.0,0.5,0.5,0.9,1.0,0.7]   # illustrative C-set harness rates (10 tasks)
for gain,ntask in ((0.4,4),(0.3,4),(0.2,5),(0.2,3)):
    Pp=list(Ph)
    idx=[1,2,5,6,7,9][:ntask]
    for i in idx: Pp[i]=max(0,Ph[i]-gain)
    trueRD=sum(a-b for a,b in zip(Ph,Pp))/10
    for k in (5,10,15):
        pw,hw=power(Ph,Pp,k,800)
        print(f"gain {gain} on {ntask} tasks trueRD {trueRD*100:.0f}pp k={k} power {pw:.2f} hw {hw*100:.1f}")
