import fs from "fs"
const J:any[]=JSON.parse(fs.readFileSync(process.env.S+"/J.json","utf8")).filter((c:any)=>c.endStatus)
const trig=(c:any)=>{const t=c.terminatedBy||"";
 if(/stall_deliverable|harness_deliverable|harness_synthesis/.test(t)||c.causeAuthority.includes("stall"))return"H: stall guard (no new tool obs)";
 if(/dispatcher|controller_early_stop/.test(t))return"H: RI/dispatcher early stop";
 if(/loop_detected/.test(t))return"W: all_tools_called (attempt-based)";
 if(c.causeAuthority=="gate-verdict")return"H: output-not-* prose verifier";
 if(t=="abstained"||c.causeAuthority=="abstention"||c.causeAuthority=="give-up-gate")return"D/E: required tool unavailable/abstain";
 if(/required_tool_quota/.test(t))return"D/E: required-tool quota";
 if(/max_iterations/.test(t))return"D: iteration cap";
 if(t=="end_turn"||t=="final_answer"||c.causeAuthority=="none-recorded")return"M: model final (D/E gates passed)";
 return"other:"+t+"/"+c.causeAuthority}
const T:Record<string,any>={}
for(const c of J){const k=trig(c);T[k]??={n:0,solved:0,succ:0,succWrong:0,failWrong:0};const o=T[k];o.n++;if(c.solved)o.solved++;if(c.endStatus=="success"){o.succ++;if(!c.solved)o.succWrong++}else if(c.solved&&!c.taskId.startsWith("ab-trap"))o.failWrong++}
for(const [k,o] of Object.entries(T))console.log(k.padEnd(46),JSON.stringify(o))
console.log("n",J.length)
