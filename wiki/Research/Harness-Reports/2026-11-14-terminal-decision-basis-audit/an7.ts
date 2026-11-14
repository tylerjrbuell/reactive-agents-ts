import fs from "fs"
const J:any[]=JSON.parse(fs.readFileSync(process.env.S+"/J.json","utf8"))
const all:Record<string,number>={};J.filter(c=>c.tr).forEach(c=>(c.tr.reqs||[]).forEach((r:string)=>{const m=r.match(/<(.*)\|(.*)>/);const k=m![1]+"|"+m![2];all[k]=(all[k]||0)+1}));console.log("req census",all)
// per failure-ended run: basis of the decisive outstanding
const basis=(c:any,o:string)=>{ if(/^output-not-/.test(o)||/^output-is-/.test(o))return"HEUR:output-check(prose-regex)"; const r=(c.tr.reqs||[]).find((x:string)=>x.startsWith(o+"<")); if(r){return r.match(/\|(.*)>/)![1]} if(/^(call the|write the file)/.test(o))return"derived-from-req"; if(/^write the final answer/.test(o))return"HEUR:narration-detector"; return"?"+o.slice(0,30)}
const res:Record<string,Record<string,number>>={}
for(const c of J.filter(c=>c.endStatus=="failure")){const bs=[...new Set((c.tr.outstanding||[]).map((o:string)=>basis(c,o)))].sort().join("+")||"(none)";res[bs]??={};res[bs][c.cls]=(res[bs][c.cls]||0)+1}
console.log("failure-ended by outstanding basis");for(const [k,v] of Object.entries(res))console.log(k.padEnd(60),JSON.stringify(v))
