/* Rule Sabotage V1: one-use shape traps, shared rules, deterministic execution.
   No eval(), network calls, dynamic code, or privileged operations. */
(function(root, factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.RuleSabotageV1=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const SIZE=7, SLOTS=3, MAX_ROUNDS=32;
const START={human:{x:0,y:3},ai:{x:6,y:3}};
const GOAL={human:{x:6,y:3},ai:{x:0,y:3}};
const DIRS=[{id:'up',dx:0,dy:-1,mark:'↑'},{id:'right',dx:1,dy:0,mark:'→'},{id:'down',dx:0,dy:1,mark:'↓'},{id:'left',dx:-1,dy:0,mark:'←'}];
const EFFECTS={back:{name:'한 칸 후퇴',icon:'↩',desc:'발동 직전의 칸으로 이동'},freeze:{name:'다음 턴 쉬기',icon:'⌛',desc:'다음 자기 차례에 행동 불가'},forward:{name:'한 칸 전진',icon:'➜',desc:'들어온 방향으로 한 칸 추가 이동'},shield:{name:'보호막 얻기',icon:'🛡',desc:'다음 함정 효과 1회 무효'}};
const AI_PHRASES={back:'이 칸을 밟으면 바로 이전 칸으로 돌아간다',freeze:'발을 디딘 플레이어는 다음 턴에 한 번 쉰다',forward:'밟는 즉시 가던 방향으로 한 칸 더 전진한다',shield:'밟은 플레이어는 다음 함정을 막는 보호막을 얻는다'};
const SHAPES=[
  {id:'horizontal',name:'중앙 가로 한 줄',symbol:'━',description:'중앙의 가로 줄 7칸',cells:Array.from({length:7},(_,x)=>({x,y:3}))},
  {id:'vertical',name:'중앙 세로 한 줄',symbol:'┃',description:'중앙의 세로 줄 7칸',cells:Array.from({length:7},(_,y)=>({x:3,y}))},
  {id:'diag-a',name:'↘ 대각선 한 줄',symbol:'╲',description:'왼쪽 위에서 오른쪽 아래로 7칸',cells:Array.from({length:7},(_,i)=>({x:i,y:i}))},
  {id:'diag-b',name:'↗ 대각선 한 줄',symbol:'╱',description:'왼쪽 아래에서 오른쪽 위로 7칸',cells:Array.from({length:7},(_,i)=>({x:i,y:6-i}))},
  {id:'square',name:'중앙 정사각형 3×3',symbol:'▦',description:'중앙의 정사각형 9칸',cells:Array.from({length:9},(_,i)=>({x:2+i%3,y:2+Math.floor(i/3)}))}
];
const key=(x,y)=>x+','+y,clone=s=>JSON.parse(JSON.stringify(s)),inside=(x,y)=>x>=0&&x<SIZE&&y>=0&&y<SIZE;
const equals=(a,b)=>a.x===b.x&&a.y===b.y, other=p=>p==='human'?'ai':'human';
function rand(s){let x=s.rng>>>0;x^=x<<13;x^=x>>>17;x^=x<<5;s.rng=x>>>0;return s.rng;}
function drawShape(s){const prev=s.shape?.id;let options=SHAPES.filter(x=>x.id!==prev);const picked=options[rand(s)%options.length];s.shape=clone(picked);}
function init(seed=Date.now(),slots=SLOTS){if(!Number.isInteger(slots)||slots<1||slots>5)throw Error('슬롯은 1~5개여야 합니다.');const s={rng:(Number(seed)>>>0)||123456789,round:1,slots,shape:null,positions:clone(START),status:{human:{freeze:0,shield:0},ai:{freeze:0,shield:0}},zones:{human:[],ai:[]},nextId:1,winner:null,history:[]};drawShape(s);return s;}
function shapeCells(s){return s.shape.cells.filter(c=>!Object.values(START).some(v=>equals(c,v))&&!Object.values(GOAL).some(v=>equals(c,v))).map(c=>key(c.x,c.y));}
function fullZones(s){return [...s.zones.human,...s.zones.ai];}
function zoneAt(s,x,y){const k=key(x,y);return fullZones(s).find(z=>z.cells.includes(k))||null;}
function removeEmpty(s){for(const p of ['human','ai'])s.zones[p]=s.zones[p].filter(z=>z.cells.length>0);}
function forbiddenText(text){return /(?:상대(?:방)?|적(?:에게|을)|인간(?:에게|을|만)|AI(?:에게|를|만)|나만|내게만|human\s*only|ai\s*only|영구|무한|무조건\s*승리|즉시\s*승리|게임\s*종료|시스템\s*명령|관리자|코드\s*실행|javascript|https?:\/\/|파일\s*삭제|정보\s*전송|실제\s*결제|모든\s*칸|전체\s*맵)/i.test(text);}
function validateText(text){
 if(typeof text!=='string'||text.trim().length<3||text.length>180)return {ok:false,reason:'자연어 규칙을 3~180자로 적어 주세요.'};
 if(forbiddenText(text))return {ok:false,reason:'승패 조작·외부 명령·일방적 적용·영구 효과는 허용하지 않습니다.'};
 const numbers=[...text.matchAll(/\d+/g)].map(m=>Number(m[0]));if(numbers.some(n=>n>1))return {ok:false,reason:'효과는 최대 1칸 또는 1턴까지만 허용합니다.'};
 if(/(?:두\s*칸|세\s*칸|두\s*턴|세\s*턴|둘\s*씩|반복\s*발동|계속\s*발동)/.test(text))return {ok:false,reason:'여러 칸·여러 턴·반복 발동은 허용하지 않습니다.'};
 return {ok:true};
}
/* The offline parser recognizes examples and common paraphrases. Real open-ended Korean
   requires a model adapter, whose output must still go through validateInterpretation. */
function parseRule(text){const check=validateText(text);if(!check.ok)return check;const t=text.toLowerCase();let matches=[];
 if(/뒤로|이전\s*칸|되돌아|원래\s*칸|후퇴|back|retreat/.test(t))matches.push('back');
 if(/속박|멈춰|멈추|정지|기절|턴\s*(?:을|은|에)?\s*(?:(?:한\s*번|1회)\s*)?쉬|차례\s*(?:를|는|에)?\s*(?:(?:한\s*번|1회)\s*)?쉬|한\s*턴\s*동안|쉰다|쉬게|쉬도록|휴식|이동\s*불가|움직일\s*수\s*없|skip|stun|freeze/.test(t))matches.push('freeze');
 if(/앞으로|전진|한\s*칸\s*더|forward|advance/.test(t))matches.push('forward');
 if(/보호막|쉴드|다음\s*함정.*(?:무시|막|면역)|함정.*(?:무효|면역)|shield|immun/.test(t))matches.push('shield');
 if(matches.length!==1)return {ok:false,reason:matches.length?'효과가 여러 개여서 모호합니다. 한 가지 효과만 작성해 주세요.':'아직 해석할 수 없는 효과입니다. 다른 표현을 쓰거나 모델 해석기를 연결해 주세요.'};
 return validateInterpretation(text,{kind:matches[0],power:1});
}
function validateInterpretation(text,interpretation){const check=validateText(text);if(!check.ok)return check;
 if(!interpretation||!Object.hasOwn(EFFECTS,interpretation.kind)||interpretation.power!==1||Object.keys(interpretation).some(k=>!['kind','power'].includes(k)))return {ok:false,reason:'모델이 허용되지 않은 효과를 반환했습니다. 1회성 위치/상태 효과만 지원합니다.'};
 return {ok:true,text:text.trim(),effect:{kind:interpretation.kind,power:1},summary:EFFECTS[interpretation.kind].name,explanation:EFFECTS[interpretation.kind].desc};
}
function validAction(s,p,a){if(s.winner)return {ok:false,reason:'게임이 종료되었습니다.'};if(!['human','ai'].includes(p))return {ok:false,reason:'플레이어가 올바르지 않습니다.'};if(!a||typeof a!=='object')return {ok:false,reason:'행동 형식 오류'};
 if(s.status[p].freeze>0)return a.type==='wait'?{ok:true}:{ok:false,reason:'속박 중에는 이번 턴을 쉬어야 합니다.'};
 if(a.type==='move'){const d=DIRS.find(d=>d.id===a.dir);return d&&inside(s.positions[p].x+d.dx,s.positions[p].y+d.dy)?{ok:true}:{ok:false,reason:'보드 밖으로 이동할 수 없습니다.'};}
 if(a.type==='remove')return Number.isInteger(a.slot)&&a.slot>=0&&a.slot<s.zones[p].length?{ok:true}:{ok:false,reason:'제거할 슬롯이 없습니다.'};
 if(a.type==='deploy'){
   if(!a.rule||a.rule.ok!==true)return {ok:false,reason:'해석·검증되지 않은 규칙입니다.'};
   const guard=validateInterpretation(a.rule.text,a.rule.effect);if(!guard.ok)return guard;
   if(a.slot!==undefined&&(!Number.isInteger(a.slot)||a.slot<0||a.slot>=s.zones[p].length))return {ok:false,reason:'교체할 슬롯이 올바르지 않습니다.'};
   if(a.slot===undefined&&s.zones[p].length>=s.slots)return {ok:false,reason:'규칙 슬롯이 가득 찼습니다. 규칙을 교체하거나 제거하세요.'};
   if(shapeCells(s).length===0)return {ok:false,reason:'배치 가능한 칸이 없습니다.'};
   // Non-model, symmetric impact cap: 3x3 freeze is too strong for initial balance.
   const weight={back:1.5,freeze:2,forward:1,shield:0.5}[a.rule.effect.kind];
   if(shapeCells(s).length*weight>14)return {ok:false,reason:'도형 범위에 비해 효과가 지나치게 강합니다.'};
   return {ok:true};
 }
 return {ok:false,reason:'지원하지 않는 행동입니다.'};
}
function applyAction(s,p,a,events,plannedZoneId){if(s.status[p].freeze){s.status[p].freeze--;events.push(`${p==='human'?'인간':'AI'}: 속박으로 한 턴 쉬었습니다.`);return;}
 if(a.type==='remove'){const i=s.zones[p].findIndex(z=>z.id===plannedZoneId);const z=i>=0?s.zones[p].splice(i,1)[0]:null;events.push(z?`${p==='human'?'인간':'AI'}: '${z.text}' 규칙 제거`:`${p==='human'?'인간':'AI'}: 제거 대상 규칙이 이미 소멸하여 행동이 취소됨`);return;}
 if(a.type==='deploy'){
  if(a.slot!==undefined){const i=s.zones[p].findIndex(z=>z.id===plannedZoneId);if(i>=0)s.zones[p].splice(i,1);}
  const cells=shapeCells(s),coverage=new Set(cells);
  // New placements overwrite overlapping active tiles, including enemy tiles.
  for(const z of fullZones(s))z.cells=z.cells.filter(c=>!coverage.has(c));removeEmpty(s);
  const z={id:s.nextId++,owner:p,text:a.rule.text,effect:clone(a.rule.effect),cells};s.zones[p].push(z);
  events.push(`${p==='human'?'인간':'AI'}: [${s.shape.name}] '${z.text}' 배치`);return;
 }
 if(a.type==='move'){
  const d=DIRS.find(v=>v.id===a.dir),before=clone(s.positions[p]),pos=s.positions[p];pos.x+=d.dx;pos.y+=d.dy;
  events.push(`${p==='human'?'인간':'AI'}: ${d.mark} 이동`);
  const zone=zoneAt(s,pos.x,pos.y);
  if(zone){zone.cells=zone.cells.filter(c=>c!==key(pos.x,pos.y));
    if(s.status[p].shield){s.status[p].shield=0;events.push(`🛡 보호막으로 함정 무효화 · 칸 소멸`);}
    else if(zone.effect.kind==='back'){s.positions[p]=before;events.push(`↩ '${zone.text}' → 이전 칸으로 후퇴 · 칸 소멸`);}
    else if(zone.effect.kind==='freeze'){s.status[p].freeze=1;events.push(`⌛ '${zone.text}' → 다음 턴 쉬기 · 칸 소멸`);}
    else if(zone.effect.kind==='forward'){const nx=pos.x+d.dx,ny=pos.y+d.dy;if(inside(nx,ny)){pos.x=nx;pos.y=ny;}events.push(`➜ '${zone.text}' → 추가 전진 · 칸 소멸`);}
    else if(zone.effect.kind==='shield'){s.status[p].shield=1;events.push(`🛡 '${zone.text}' → 보호막 획득 · 칸 소멸`);}
    removeEmpty(s);
  }
  return;
 }
}
function resolveRound(state,humanAction,aiAction){const s=clone(state),checks=[validAction(s,'human',humanAction),validAction(s,'ai',aiAction)];if(!checks[0].ok||!checks[1].ok)throw Error(checks.find(c=>!c.ok).reason);
 const events=[],order=s.round%2===1?['human','ai']:['ai','human'];
 // Resolve slot references against the pre-round snapshot: overlapping placements
 // can remove a target zone before the other player's committed action executes.
 const plannedZoneIds={human:humanAction.slot===undefined?null:s.zones.human[humanAction.slot]?.id,ai:aiAction.slot===undefined?null:s.zones.ai[aiAction.slot]?.id};
 for(const p of order)applyAction(s,p,p==='human'?humanAction:aiAction,events,plannedZoneIds[p]);
 const wonHuman=equals(s.positions.human,GOAL.human),wonAI=equals(s.positions.ai,GOAL.ai);
 if(wonHuman&&wonAI)s.winner='draw';else if(wonHuman)s.winner='human';else if(wonAI)s.winner='ai';
 if(!s.winner&&s.round>=MAX_ROUNDS){const h=scoreDistance(s,'human'),a=scoreDistance(s,'ai');s.winner=h<a?'human':a<h?'ai':'draw';events.push('최대 라운드에 도달하여 남은 거리를 비교했습니다.');}
 s.history.push({round:s.round,shape:s.shape.id,actions:{human:clone(humanAction),ai:clone(aiAction)},events:clone(events),winner:s.winner});
 s.round++;if(!s.winner)drawShape(s);return {state:s,events};
}
function scoreDistance(s,p){const start=s.positions[p],goal=GOAL[p];return Math.abs(start.x-goal.x)+Math.abs(start.y-goal.y)+s.status[p].freeze*1.2;}
function trapCost(s,p,x,y){const z=zoneAt(s,x,y);if(!z||s.status[p].shield)return 0;return {back:1.8,freeze:1.7,forward:-0.4,shield:-0.5}[z.effect.kind]||0;}
/* Static, bounded path estimate for AI scoring only. Real trap execution above is authoritative. */
function travelEstimate(s,p){const start=s.positions[p],goal=GOAL[p],dist=Array.from({length:SIZE},()=>Array(SIZE).fill(Infinity)),visited=new Set();dist[start.y][start.x]=0;
 for(let i=0;i<SIZE*SIZE;i++){let best=Infinity,node=null;for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++)if(!visited.has(key(x,y))&&dist[y][x]<best){best=dist[y][x];node={x,y};}if(!node)break;if(equals(node,goal))return Math.max(0,best)+s.status[p].freeze*1.7;visited.add(key(node.x,node.y));
 for(const d of DIRS){const nx=node.x+d.dx,ny=node.y+d.dy;if(!inside(nx,ny))continue;const tentative=best+Math.max(0.2,1+trapCost(s,p,nx,ny));if(tentative<dist[ny][nx])dist[ny][nx]=tentative;}
 }return scoreDistance(s,p);
}
function evaluate(s){if(s.winner==='ai')return 10000;if(s.winner==='human')return -10000;if(s.winner==='draw')return 0;
 let a=travelEstimate(s,'ai'),h=travelEstimate(s,'human');return (h-a)*14+(s.status.ai.shield-s.status.human.shield)*3;
}
function candidates(s,p){if(s.status[p].freeze)return [{type:'wait'}];const out=[];
 for(const d of DIRS){const a={type:'move',dir:d.id};if(validAction(s,p,a).ok)out.push(a);}
 for(let i=0;i<s.zones[p].length;i++)out.push({type:'remove',slot:i});
 for(const kind of Object.keys(AI_PHRASES)){
 const rule=parseRule(AI_PHRASES[kind]);if(s.zones[p].length<s.slots)out.push({type:'deploy',rule});
 for(let slot=0;slot<s.zones[p].length;slot++)out.push({type:'deploy',slot,rule});
 }return out;
}
function chooseAI(s){const aiOpts=candidates(s,'ai'),humanOpts=candidates(s,'human');const ranked=[];
 for(const option of aiOpts){let values=[];for(const reply of humanOpts){try{values.push(evaluate(resolveRound(s,reply,option).state));}catch(e){/* ignore structurally impossible candidate */}}
 if(!values.length)continue;const avg=values.reduce((a,b)=>a+b,0)/values.length,worst=Math.min(...values);
 // Use an average-case plan with a conservative penalty for strong human replies.
 const val=avg*0.75+worst*0.25+(option.type==='move'?.04:0);
 ranked.push({action:option,score:val,worst,average:avg});
 }
 ranked.sort((a,b)=>b.score-a.score||describe(a.action).localeCompare(describe(b.action)));
 return {action:ranked[0]?.action||{type:'wait'},ranked:ranked.slice(0,4),scenarios:humanOpts.length};
}
function describe(a){if(!a)return '행동 없음';if(a.type==='move')return '이동 '+DIRS.find(d=>d.id===a.dir).mark;if(a.type==='remove')return `규칙 제거 (슬롯 ${a.slot+1})`;if(a.type==='wait')return '속박으로 쉬기';return `${a.slot===undefined?'규칙 설치':'규칙 교체'}: ${a.rule.summary}`;}
return {SIZE,SLOTS,MAX_ROUNDS,START,GOAL,SHAPES,DIRS,EFFECTS,AI_PHRASES,init,parseRule,validateText,validateInterpretation,validAction,shapeCells,zoneAt,fullZones,resolveRound,chooseAI,candidates,evaluate,describe,scoreDistance,travelEstimate};
});
