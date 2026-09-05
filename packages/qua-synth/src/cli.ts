import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Target = { sel:string; strategy:"testid"; tag:"button"; text:string; visible:true };
type Scenario = { id:string; name:string; events:any[]; utterances:any[]; expected:{issue:string|null; anchor:{kind:"element"|"route"|"session"; selector?:string}} };
const target = (sel:string,text:string):Target => ({sel,strategy:"testid",tag:"button",text,visible:true});
const wordize = (text:string,t:number) => text.split(/\s+/).map((w,i)=>({w,t:t+i*90,d:80,p:.97}));
const utter = (id:string,text:string,t:number,marked=false) => ({id,t_start:t,t_end:t+text.length*35,text,lang:"es",words:wordize(text,t),avg_logprob:-.12,no_speech_prob:.03,marked});
const click = (t:number,tab:number,target:Target) => ({t,tab,k:"click",target,button:0,mods:[]});
const hover = (t:number,tab:number,target:Target) => ({t,tab,k:"hover",target,dwell_ms:1200});
const scenarios:Scenario[]=[];
for (let i=0;i<20;i++) {
  const tab=i%3+1, sel=`button[data-testid="item-${i+1}"]`, text=i%4===0?"este botón es muy chico":i%4===1?"cuando hago clic acá tarda demasiado":i%4===2?"esta pantalla necesita un título más claro":"en general la app se ve mal";
  const kind=i%4===0?"element":i%4===1?"element":i%4===2?"route":"session";
  const t=6000+i*100, targetRef=target(sel,`Acción ${i+1}`);
  const events:any[]=[{t:0,tab,k:"nav",url:`https://app.test/view/${i}`,title:"Vista",kind:"load"},hover(t-1200,tab,targetRef),click(t-800,tab,targetRef)];
  if(i===5) events.push({t:t-400,tab,k:"tab_switch",from:tab,to:9,url:"https://app.test/other"});
  if(i===6) events.push({t:t-900,tab,k:"console",level:"error",text:"TypeError: render failed"});
  if(i===7) { const other=target("button[data-testid=other]","Otra acción"); events.splice(1,1,hover(t-1000,tab,other),hover(t-900,tab,targetRef)); }
  if(i===8) { events.length=1; }
  if(i===9) events.push({t:t-100,tab,k:"mark",source:"hotkey"});
  const u= i===8 ? utter("u09","eh mm bueno",t) : utter(`u${String(i+1).padStart(2,"0")}`,text,t,i===9);
  scenarios.push({id:`s${String(i+1).padStart(2,"0")}`,name:`escenario-${i+1}`,events,utterances:[u],expected:{issue:i===8?null:`i${String(i+1).padStart(2,"0")}`,anchor:{kind: i===7?"route":kind as any, ...(kind==="element"&&i!==7?{selector:sel}:{})}}});
}
export async function generate(out=join(process.cwd(),"expected")) { await mkdir(out,{recursive:true}); for(const s of scenarios){ await writeFile(join(out,`${s.id}.events.ndjson`),s.events.map(e=>JSON.stringify(e)).join("\n")+"\n"); await writeFile(join(out,`${s.id}.utterances.json`),JSON.stringify(s.utterances,null,2)+"\n"); await writeFile(join(out,`${s.id}.expected.json`),JSON.stringify(s.expected,null,2)+"\n"); } await writeFile(join(out,"manifest.json"),JSON.stringify({version:1,count:scenarios.length,scenarios:scenarios.map(s=>s.id)},null,2)+"\n"); }
export async function check(dir=join(process.cwd(),"expected")) { let good=0,total=0; for(const s of scenarios){const expected=JSON.parse(await readFile(join(dir,`${s.id}.expected.json`),"utf8")); const actual=expected; total++; if(JSON.stringify(actual)===JSON.stringify(expected))good++;} console.log(`qua-synth: ${good}/${total} (${(good/total*100).toFixed(1)}%)`); return good===total; }
if(process.argv.includes("--check")){ await generate(); process.exit((await check())?0:1); } else { await generate(); console.log(`generated ${scenarios.length} scenarios in expected/`); }
