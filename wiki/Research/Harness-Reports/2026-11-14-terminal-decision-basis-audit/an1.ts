import fs from "fs"
const S=process.env.S!
const rows:any[]=JSON.parse(fs.readFileSync(S+"/camp.json","utf8"))
const cells:any[]=[];for(const ph of ["p2","p3a"])for(const f of fs.readdirSync("/home/tylerbuell/campaign-traces/"+ph)){const j=JSON.parse(fs.readFileSync(`/home/tylerbuell/campaign-traces/${ph}/${f}`,"utf8"));for(const c of j.cells)cells.push(c)}
const byTrace=new Map(rows.map(r=>["/home/tylerbuell/campaign-traces/"+r.path,r]));
let miss=0
const J=cells.map(c=>{const r=byTrace.get(c.traceFile);if(!r)miss++;return {...c,tr:r}})
console.log("cells",cells.length,"unjoined",miss)
const cls=(c:any)=>{const es=c.endStatus;if(!es)return"aborted";const s=es=="success";if(s&&c.solved)return"TP";if(s&&!c.solved)return"FALSE-SUCCESS";if(!s&&c.solved)return c.taskId.startsWith("ab-trap")?"TN-correct-abstain":"FALSE-FAILURE";return"TN-correct-fail"}
const t:Record<string,number>={};J.forEach(c=>{c.cls=cls(c);t[c.cls]=(t[c.cls]||0)+1});console.log(t)
const x:Record<string,number>={};J.filter(c=>c.endStatus=="failure"&&c.solved).forEach(c=>{const k=c.taskId+" "+c.causeAuthority;x[k]=(x[k]||0)+1});console.log(x)
fs.writeFileSync(S+"/J.json",JSON.stringify(J))
