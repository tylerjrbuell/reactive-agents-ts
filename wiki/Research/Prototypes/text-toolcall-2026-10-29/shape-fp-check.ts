import { detectToolCallShape } from "../../../../packages/tools/src/tool-calling/tool-call-shape.ts";
const names=["web-search","todo"];
const cases:[string,string][]=[
["json answer",'{"result": 180}'],["json person",'{"name": "Alice", "age": 30}'],["json fenced",'```json\n{"name":"Alice","age":30}\n```'],
["prose",'The answer is 180.'],["code",'```python\ndef add(a,b):\n    return a+b\n```'],["call-like code","print(add(1,2))"],
["json arr",'[{"name":"a","age":1}]'],["literal call text",'{"name": "search", "parameters": {"query": "cats"}}'],
["prose braces","Use {x} as a placeholder."],["config json",'{"name":"my-app","version":"1.0.0","scripts":{"build":"tsc"}}'],
["hallucinated",'{"name":"math-product","parameters":{"x":12,"y":15}}'],["function(x) line","foo(bar)"]];
for(const [l,c] of cases) console.log(l.padEnd(20),JSON.stringify(detectToolCallShape(c,names)));
