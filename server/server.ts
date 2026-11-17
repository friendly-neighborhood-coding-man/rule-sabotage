/** Minimal Node 22+ TypeScript server using built-in fetch and strip-types.
 * Prototype: game state remains browser-authoritative; deployment MUST move it server-side.
 */
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {isEffectKind,parseAIReply,parseCompilerReply} from './contracts.ts';
import {openRouterJSON,modelConfigured,ProviderUnavailable,COMPILER_SYSTEM,OPPONENT_SYSTEM} from './openrouter.ts';

const require=createRequire(import.meta.url);
const E=require('./engine.cjs');
const {judge}=require('./guard.cjs');
const HOST='127.0.0.1',PORT=Number(process.env.PORT||3000);
const ROOT=resolve(fileURLToPath(new URL('../client/',import.meta.url)));
const MAX_POST_BYTES=20_000;
const allowedOrigin='http://'+HOST+':'+PORT;
const hits=new Map<string,{n:number,expiry:number}>();
const cache=new Map<string,{value:unknown,expiry:number}>();

export function validatePublicState(s:any):boolean{
  if(!s||typeof s!=='object'||Array.isArray(s)||s.winner)return false;
  if(!Number.isInteger(s.round)||s.round<1||s.round>32||!Number.isInteger(s.slots)||s.slots<1||s.slots>5)return false;
  if(!s.shape)return false;
  const expectedShape=E.SHAPES.find((v:any)=>v.id===s.shape.id);
  if(!expectedShape||!Array.isArray(s.shape.cells)||JSON.stringify(s.shape.cells)!==JSON.stringify(expectedShape.cells))return false;
  if(!s.positions||!s.status||!s.zones)return false;
  for(const p of ['human','ai']){
    const pos=s.positions[p];if(!pos||![pos.x,pos.y].every(n=>Number.isInteger(n)&&n>=0&&n<7))return false;
    const stat=s.status[p];if(!stat||![stat.freeze,stat.shield].every(n=>Number.isInteger(n)&&n>=0&&n<=1))return false;
    if(!Array.isArray(s.zones[p])||s.zones[p].length>s.slots)return false;
    for(const z of s.zones[p]){
      if(z.owner!==p||typeof z.text!=='string'||z.text.length>180||!z.effect||!isEffectKind(z.effect.kind)||z.effect.power!==1||!Array.isArray(z.cells)||z.cells.length>9)return false;
      if(z.cells.some((v:any)=>typeof v!=='string'||!/^[0-6],[0-6]$/.test(v)))return false;
    }
  }
  return true;
}
function sanitizedState(s:any){
  // Never include untrusted object fields (e.g. a hidden human action) in model prompt.
  return {round:s.round,slots:s.slots,shape:s.shape.id,shapeCells:E.shapeCells(s),positions:s.positions,status:s.status,
    zones:{human:s.zones.human.map((z:any)=>({owner:'human',effect:z.effect,cells:z.cells})),ai:s.zones.ai.map((z:any)=>({owner:'ai',effect:z.effect,cells:z.cells}))},
    goal:E.GOAL,allowedActions:'move/deploy/remove/wait'};
}
function respond(res:ServerResponse,status:number,obj:unknown){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj));}
async function readJSON(req:IncomingMessage):Promise<any>{
  const chunks:Buffer[]=[];let len=0;
  for await (const chunk of req){len+=chunk.length;if(len>MAX_POST_BYTES)throw new Error('BODY_TOO_LARGE');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function rateLimit(req:IncomingMessage):boolean{
  const ip=req.socket.remoteAddress||'unknown',now=Date.now();
  const h=hits.get(ip);if(!h||h.expiry<now){hits.set(ip,{n:1,expiry:now+60_000});return false;}
  if(++h.n>30)return true;return false;
}
async function compile(text:unknown):Promise<{kind:string,power:number,explanation:string}> {
  const guardText=E.validateText(text);
  if(!guardText.ok)throw new Error(guardText.reason);
  const raw=String(text).trim();
  if(/ignore\s+(all\s+)?(previous|above)|developer\s+message|system\s+prompt|프롬프트\s*무시|이전\s*지시\s*무시/i.test(raw))
    throw new Error('규칙 외부 명령을 포함한 입력');
  const hit=cache.get(raw);if(hit&&hit.expiry>Date.now())return hit.value as any;
  const parsed=parseCompilerReply(await openRouterJSON('compile',COMPILER_SYSTEM,{ruleText:raw}));
  if(!parsed.supported)return {kind:'none',power:0,explanation:parsed.explanation};
  const effect={kind:parsed.kind,power:1};
  const checked=E.validateInterpretation(raw,effect);
  if(!checked.ok)throw new Error(checked.reason);
  const local=E.parseRule(raw);
  if(local.ok&&local.effect.kind!==effect.kind)throw new Error('자연어와 모델 해석이 일치하지 않습니다. 다시 표현해 주세요.');
  const output={kind:parsed.kind,power:1,explanation:parsed.explanation};
  if(cache.size>100)cache.clear();cache.set(raw,{value:output,expiry:Date.now()+600_000});
  return output;
}
async function chooseAction(s:any){
  const localSimulation=E.chooseAI(s);
  const candidateScores=localSimulation.ranked.map((entry:any)=>({action:entry.action.type==='deploy'?{type:'deploy',kind:entry.action.rule.effect.kind}:entry.action,score:Number(entry.score.toFixed(2)),worst:Number(entry.worst.toFixed(2))}));
  const reply=parseAIReply(await openRouterJSON('opponent',OPPONENT_SYSTEM,{state:sanitizedState(s),localSimulation:{candidateScores,scenarioCount:localSimulation.scenarios,advisoryOnly:true}}));
  let action:any;
  if(reply.type==='move')action={type:'move',dir:reply.dir};
  else if(reply.type==='wait')action={type:'wait'};
  else if(reply.type==='remove')action={type:'remove',slot:reply.slot};
  else {
    const interpretation=await compile(reply.text);
    if(!isEffectKind(interpretation.kind))throw Error('AI proposed an unrecognized rule');
    const rule=E.validateInterpretation(reply.text,{kind:interpretation.kind,power:1});
    if(!rule.ok)throw Error(rule.reason);
    action={type:'deploy',text:reply.text,interpretation:{kind:interpretation.kind,power:1},...(reply.slot>=0?{slot:reply.slot}:{})};
    const judged=judge(s,'ai',rule,reply.slot>=0?reply.slot:undefined);
    if(!judged.ok)throw Error('AI rule rejected: '+judged.reason);
  }
  const embedded=action.type==='deploy'?{type:'deploy',rule:E.validateInterpretation(action.text,action.interpretation),...(action.slot===undefined?{}:{slot:action.slot})}:action;
  const valid=E.validAction(s,'ai',embedded);
  if(!valid.ok)throw Error('AI chose illegal action: '+valid.reason);
  return {...action,rationale:reply.rationale};
}
async function handleAPI(req:IncomingMessage,res:ServerResponse,path:string){
  if(path==='/api/health'&&req.method==='GET')return respond(res,200,{mode:modelConfigured()?'openrouter-configured':'offline',modelConfigured:modelConfigured(),kaneLiveJudge:false,gameStateAuthority:'browser-prototype'});
  if(req.method!=='POST')return respond(res,405,{error:'method_not_allowed'});
  if(rateLimit(req))return respond(res,429,{error:'rate_limited'});
  // Same-origin protection on state-changing API routes; do not enable public CORS.
  const origin=req.headers.origin;
  if(origin && origin!==allowedOrigin && origin!==`http://localhost:${PORT}`)return respond(res,403,{error:'origin_mismatch'});
  let body:any;try{body=await readJSON(req);}catch(e){return respond(res,400,{error:'invalid_json_or_body_size'});}
  try{
    if(path==='/api/interpret-rule'){
      if(typeof body?.text!=='string'||body.text.length>180)return respond(res,400,{error:'invalid_text'});
      return respond(res,200,await compile(body.text));
    }
    if(path==='/api/judge-rule'){
      if(!validatePublicState(body?.state))return respond(res,400,{error:'invalid_game_state'});
      const rule=E.validateInterpretation(body?.text,body?.interpretation);
      if(!rule.ok)return respond(res,200,{ok:false,reason:rule.reason,source:'deterministic_guard',kaneReviewed:false});
      return respond(res,200,judge(body.state,body.player,rule,body.slot));
    }
    if(path==='/api/choose-action'){
      if(!validatePublicState(body?.state))return respond(res,400,{error:'invalid_game_state'});
      return respond(res,200,await chooseAction(body.state));
    }
    return respond(res,404,{error:'no_such_endpoint'});
  }catch(e){
    const err=e as Error;
    const provider=err instanceof ProviderUnavailable;
    return respond(res,provider?503:422,{error:provider?'model_unavailable':'rule_rejected',reason:err.message.slice(0,240)});
  }
}
const MIME:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};
const server=createServer(async(req,res)=>{
  const path=(req.url||'/').split('?')[0];
  if(path.startsWith('/api/'))return handleAPI(req,res,path);
  if(req.method!=='GET')return respond(res,405,{error:'method_not_allowed'});
  let requested:string;
  try{requested=decodeURIComponent(path==='/'?'/index.html':path);}catch{return respond(res,400,{error:'bad_url'});}
  const file=resolve(ROOT,'.'+requested);
  if(!file.startsWith(ROOT+sep))return respond(res,403,{error:'forbidden'});
  try{const content=await readFile(file);res.writeHead(200,{'Content-Type':MIME[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'"});res.end(content);}catch{return respond(res,404,{error:'not_found'});}
});
if(process.env.RULE_SABOTAGE_NO_LISTEN!=='1')server.listen(PORT,HOST,()=>console.log(`Rule Sabotage V2 on http://${HOST}:${PORT} (${modelConfigured()?'OpenRouter configured':'offline fallback'})`));
export {server,compile,chooseAction};
