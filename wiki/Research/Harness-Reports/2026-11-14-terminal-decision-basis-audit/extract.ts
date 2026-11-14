import fs from "fs"
const roots=process.argv.slice(2)
const out:any[]=[]
function walk(d:string,cb:(p:string)=>void){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=d+"/"+e.name;if(e.isDirectory())walk(p,cb);else if(p.endsWith(".jsonl"))cb(p)}}
const META=new Set(["final-answer","recall","find","brief","pulse","context-status","task-complete","checkpoint","think","discover-tools","get-skill-section","run-handoff","spawn-agent"])
for(const r of roots)walk(r,p=>{
 const ev=fs.readFileSync(p,"utf8").split("\n").filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean)
 const rs=ev.find((e:any)=>e.kind=="run-started"),rc=ev.find((e:any)=>e.kind=="run-completed"),eg=ev.find((e:any)=>e.kind=="eval-graded"),cc=ev.filter((e:any)=>e.kind=="contract-compiled").pop()
 const tce=ev.filter((e:any)=>e.kind=="tool-call-end")
 const guards=ev.filter((e:any)=>e.kind=="guard-fired"&&["terminate","block"].includes(e.outcome)&&!/^(wire-request)$/.test(e.guard)).map((e:any)=>e.guard+":"+e.outcome)
 out.push({path:p,root:r,model:rs?.model,task:eg?.taskId,graded:!!eg,passed:eg?.passed,score:eg?.score,
  status:rc?.status,tb:rc?.terminatedBy,auth:rc?.outcome?.authority,ostatus:rc?.outcome?.status,prov:rc?.outcome?.provenance,
  outstanding:rc?.outcome?.outstanding,ansSat:rc?.outcome?.answerSatisfied,dl:rc?.outcome?.deliverable,error:rc?.error?.slice(0,160),
  reqs:cc?.requirements?.map((x:any)=>x.id+"<"+x.kind+"|"+x.provenance?.source+">"),
  guards,nTool:tce.length,nOk:tce.filter((e:any)=>e.ok===true&&!META.has(e.toolName||e.tool)).length,
  tceSample:tce[0]&&Object.keys(tce[0]),aborted:ev.some((e:any)=>e.kind=="run-aborted"),
  vv:ev.filter((e:any)=>e.kind=="verifier-verdict").map((e:any)=>e.source+":"+e.verified+":"+e.checks?.filter((c:any)=>!c.passed).map((c:any)=>c.name).join("+"))})
})
fs.writeFileSync(process.env.OUT!,JSON.stringify(out))
console.log(out.length,out.filter(o=>o.graded).length)
console.log(out[0]?.tceSample)
