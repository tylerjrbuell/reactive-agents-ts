import fs from "fs"
const J:any[]=JSON.parse(fs.readFileSync(process.env.S+"/J.json","utf8"))
const norm=(p:string)=>String(p||"").replace(/^\.\//,"").replace(/^.*\//,"")
const out:any[]=[]
for(const c of J.filter(c=>c.endStatus=="success"&&c.traceFile&&c.tr)){
 const ev=fs.readFileSync(c.traceFile,"utf8").split("\n").filter(Boolean).map(l=>JSON.parse(l))
 const arts=(c.tr.reqs||[]).filter((r:string)=>r.startsWith("artifact:")).map((r:string)=>r.slice(9).split("<")[0])
 const req=(c.tr.reqs||[]).filter((r:string)=>r.startsWith("tool:")&&/required-tools/.test(r)).map((r:string)=>r.slice(5).split("<")[0])
 const ok=ev.filter((e:any)=>e.kind=="tool-call-end"&&e.ok)
 const written=new Set(ok.filter((e:any)=>/write/.test(e.toolName)).map((e:any)=>norm(e.args?.path||e.args?.file||e.args?.filePath)))
 const missingArt=arts.filter((a:string)=>!written.has(norm(a)))
 const missingTool=req.filter((t:string)=>!ok.some((e:any)=>e.toolName==t))
 // failed non-passing checks in last verdicts
 const vs=ev.filter((e:any)=>e.kind=="verifier-verdict");const failed=new Set<string>();let anyFalse=false;for(const v of vs){if(v.verified===false)anyFalse=true;for(const k of v.checks||[])if(!k.passed)failed.add(k.name)}
 out.push({id:c.cellId,cls:c.cls,acc:c.accuracy,arts:arts.length,missingArt:missingArt.length,missingTool:missingTool.length,anyFalse,failed:[...failed],auth:c.causeAuthority})
}
const f=(a:any[])=>({n:a.length,acc1:a.filter(x=>x.cls=="TP").length})
console.log("success-ended n",out.length)
console.log("missing declared artifact receipt:",f(out.filter(x=>x.arts>0&&x.missingArt>0)),"of runs with artifact reqs",f(out.filter(x=>x.arts>0)))
console.log("missing declared required-tool receipt:",f(out.filter(x=>x.missingTool>0)))
console.log("success though a verifier-verdict verified:false occurred:",f(out.filter(x=>x.anyFalse)))
const fc:Record<string,{n:number,tp:number}>={};for(const x of out)for(const n of x.failed){fc[n]??={n:0,tp:0};fc[n].n++;if(x.cls=="TP")fc[n].tp++}
console.log("failed check names among success-ended (n runs, of which TP):",fc)
console.log(out.filter(x=>x.arts>0&&x.missingArt>0).slice(0,12))
