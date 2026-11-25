// Read-only GW1-style coverage reconstruction. No dependencies or model calls.
// Usage: node gamewatch/skillbook/steps/visit-coverage.mjs <index.html> <stdout.ndjson> <notes.ndjson> [report.md]
// Input files must belong to the same run; this does not infer coverage from arbitrary remark wording.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
function inventory(html) {
  const ids = [...html.matchAll(/href=["'](?:case-(C-[a-f0-9]+)|match-(M-[a-f0-9]+))\.html["']/g)].map(m=>m[1]||m[2]);
  if (!ids.length || new Set(ids).size!==ids.length) throw Error("Missing or duplicate evidence IDs");
  return ids;
}
function parseNdjson(text) {
  return text.split(/\r?\n/).filter(l=>l.trim()).map(l=>JSON.parse(l));
}
function analyze(ids, events, notes) {
  const start=events.filter(e=>e.type==="stream_start"), end=events.filter(e=>e.type==="run_end");
  if(start.length!==1 || end.length!==1) throw Error("Expected one completed browser run");
  const time=x=>{const t=Date.parse(x);if(!Number.isFinite(t))throw Error("Invalid timestamp");return t;};
  const lo=time(start[0].ts), hi=time(end[0].ts);
  if(hi<lo)throw Error("Invalid run window");
  const valid=notes.filter(n=>n.source==="kane"&&n.nonceValid===true&&time(n.at)>=lo&&time(n.at)<=hi).sort((a,b)=>time(a.at)-time(b.at));
  if(new Set(valid.map(n=>n.nonce)).size>1)throw Error("Mixed review sessions");
  const known=new Set(ids), visits=[];
  for(const e of events) {
    if(e.status!=="done"||typeof e.remark!=="string"||!Number.isInteger(e.step))continue;
    // Accept only explicit completed link clicks or evidence-page URL navigation, not scrolls, typing, or citations.
    const m=e.remark.match(/^click: Clicking (?:on )?(?:the )?(?:(?:scripted playtest case|AI-vs-AI match|match) )?([CM]-[a-f0-9]+)(?: link| in the Scripted playtest cases table| in the AI-vs-AI matches table)?$/i)
      ||e.remark.match(/^navigate: Navigate to https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/(?:case-|match-)([CM]-[a-f0-9]+)\.html$/);
    if(!m||!known.has(m[1]))continue;
    const t=time(e.ts);if(t<lo||t>hi)continue;
    visits.push({id:m[1],at:e.ts,step:e.step,childId:e.child_id??null});
  }
  const snapshot=(at, evidence="")=>{
    const seen=new Set(visits.filter(v=>time(v.at)<time(at)).map(v=>v.id));
    const cited=ids.filter(id=>new RegExp("\\b"+id+"\\b").test(evidence));
    return {at,visited:ids.filter(id=>seen.has(id)),noRecordedVisit:ids.filter(id=>!seen.has(id)),citedWithoutRecordedVisit:cited.filter(id=>!seen.has(id))};
  };
  return {visits,verdicts:valid.map(n=>({category:n.category,...snapshot(n.at,String(n.evidence??""))})),final:{status:end[0].status,summary:end[0].summary,...snapshot(end[0].ts)},counts:{cases:ids.filter(id=>id.startsWith("C-")).length,matches:ids.filter(id=>id.startsWith("M-")).length}};
}
function render(ids,a) {
  const esc=s=>String(s??"").replace(/[\r\n]+/g," ").replace(/[|<>`]/g,c=>({"|":"&#124;","<":"&lt;",">":"&gt;","`":"&#96;"}[c]));
  const tally=s=>`${s.visited.filter(id=>id.startsWith("C-")).length}/${a.counts.cases} cases; ${s.visited.filter(id=>id.startsWith("M-")).length}/${a.counts.matches} matches`;
  const out=["# GameWatch — verdict visitation checklist","","Derived from a recorded browser run; not a new Kane call. **Recorded visit** means a recognized completed navigation/click action, not proof that a page loaded or was understood. No recorded visit is not proof of absence. Unrecognized actions, index summaries and other observations are not counted.","","## Verdicts","","| Verdict (original) | Timestamp (UTC) | Recorded visits before verdict | Cited without recorded visit |","|---|---|---|---|"];
  a.verdicts.forEach(v=>out.push(`| ${esc(v.category)} | ${v.at} | ${tally(v)} | ${v.citedWithoutRecordedVisit.join(", ")||"None"} |`));
  out.push(`| Run end: ${esc(a.final.status)} | ${a.final.at} | ${tally(a.final)} | — |`,"",`Original run-end summary: ${esc(a.final.summary)}`,"");
  const clean=a.verdicts.some(v=>v.category==="clean / no problem found");
  const anomalies=a.verdicts.filter(v=>v.category==="confirmed observable anomaly").length;
  if(clean&&anomalies)out.push(`**Conflicting reports:** a clean finding and ${anomalies} anomaly finding(s) coexist; retain both.`, "");
  if(a.final.noRecordedVisit.length)out.push("**Incomplete recorded visitation:** do not interpret a clean result as comprehensive inspection.","");
  out.push("## Evidence checklist","","Recorded visits strictly before each finding timestamp; final column is before run end.","",`| Evidence | ${a.verdicts.map((_,i)=>"Finding "+(i+1)).concat("Run end").join(" | ")} |`,`|---|${a.verdicts.concat(a.final).map(()=> "---|").join("")}`);
  for(const id of ids)out.push(`| ${id} | ${a.verdicts.concat(a.final).map(v=>v.visited.includes(id)?"✓ Recorded":"— No record").join(" | ")} |`);
  out.push("","## Recorded actions","","| Evidence | UTC time | Step | Child |","|---|---|---|---|");
  for(const v of a.visits)out.push(`| ${v.id} | ${v.at} | ${v.step} | ${esc(v.childId)||"main"} |`);
  return out.join("\n")+"\n";
}
const args=process.argv.slice(2);
if(args.length<3||args.length>4)throw Error("Usage: visit-coverage.mjs <index> <stdout> <notes> [report]");
const [index,log,notes,out]=args;
if(out && [index,log,notes].some(p=>resolve(p)===resolve(out)))throw Error("Refusing to overwrite an input");
const ids=inventory(readFileSync(index,"utf8"));
const report=render(ids,analyze(ids,parseNdjson(readFileSync(log,"utf8")),parseNdjson(readFileSync(notes,"utf8"))));
if(out)writeFileSync(out,report,{flag:"wx"});else process.stdout.write(report);
