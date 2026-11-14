import fs from "fs"
const R:any[]=JSON.parse(fs.readFileSync(process.env.S+"/abl_all.json","utf8")).filter((r:any)=>r.graded&&!r.task?.startsWith("ab-trap"))
const k=(r:any)=>{const s=r.status=="success";return s&&r.passed?"TP":s&&!r.passed?"FS":!s&&r.passed?"FF":"TN"}
const site=(r:any)=>{const o=(r.outstanding||[]).join(" ");if(/actually complete the requested action/.test(o))return"SideEffectLanded(action-required|task-text regex)";if(/output-not-/.test(o))return"output-not-* prose gate";if(r.auth?.startsWith("runtime-success-veto"))return"runtime-success-veto";return r.auth+"/"+r.tb}
const t:Record<string,Record<string,number>>={}
for(const r of R){const c=k(r);r.c=c;const s=c=="FF"||c=="TN"?site(r):"(accept)"+r.auth;t[s]??={};t[s][r.root+":"+c]=(t[s][r.root+":"+c]||0)+1}
for(const [a,b] of Object.entries(t))console.log(a.padEnd(60),JSON.stringify(b))
const tot:Record<string,number>={};R.forEach(r=>tot[r.c]=(tot[r.c]||0)+1);console.log("non-abtrap n",R.length,tot)
// FF involvement
const ff=R.filter(r=>r.c=="FF");const n=ff.filter(r=>/actually complete the requested action/.test((r.outstanding||[]).join(" "))).length;console.log("FF",ff.length,"action-required",n)
// among runs with action-required outstanding: how many TN vs FF
const ar=R.filter(r=>(r.outstanding||[]).join(" ").match(/actually complete the requested action/));const a:Record<string,number>={};ar.forEach(r=>a[r.c]=(a[r.c]||0)+1);console.log("action-required veto precision",a)
