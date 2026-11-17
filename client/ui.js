(() => {
'use strict';
const E=window.RuleSabotageV1,$=id=>document.getElementById(id);
let state=E.init(),selectedSlot=null,busy=false,preview=null,previewSource='오프라인 해석',modelAdapter=typeof window.RULE_SABOTAGE_MODEL_INTERPRETER==='function'?window.RULE_SABOTAGE_MODEL_INTERPRETER:null,aiAdapter=typeof window.RULE_SABOTAGE_AI_OPPONENT==='function'?window.RULE_SABOTAGE_AI_OPPONENT:null,previewEpoch=0,gameEpoch=0,typingTimer=null;
const html=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const humanReady=()=>!busy&&!state.winner&&state.status.human.freeze===0;
function render(){
 $('shape-icon').textContent=state.shape.symbol;$('shape-name').textContent=state.shape.name;$('shape-desc').textContent=`이번 도형: ${state.shape.description} · 양쪽 공통`; $('round-count').textContent=`${String(state.round).padStart(2,'0')} / ${E.MAX_ROUNDS}`;
 const selectedCells=new Set(E.shapeCells(state)),board=$('board');board.replaceChildren();
 for(let y=0;y<E.SIZE;y++)for(let x=0;x<E.SIZE;x++){
  const tile=document.createElement('button');tile.type='button';tile.className='cell';const k=x+','+y,z=E.zoneAt(state,x,y),human=state.positions.human.x===x&&state.positions.human.y===y,ai=state.positions.ai.x===x&&state.positions.ai.y===y;
  if(selectedCells.has(k))tile.classList.add('shape');if(z)tile.classList.add('hazard-'+z.owner);
  const d=E.DIRS.find(d=>state.positions.human.x+d.dx===x&&state.positions.human.y+d.dy===y),legal=humanReady()&&d;
  if(legal)tile.classList.add('legal');tile.disabled=!legal;
  tile.setAttribute('aria-label',`${x+1}열 ${y+1}행 ${z?'함정 '+z.effect.kind:'일반 칸'} ${legal?'이동 가능':''}`);tile.setAttribute('data-cell',k);
  const target=E.GOAL.human.x===x&&E.GOAL.human.y===y||E.GOAL.ai.x===x&&E.GOAL.ai.y===y;
  tile.innerHTML=`${target?'<span class="goal">★</span>':''}${z?`<span class="tile-mark">${E.EFFECTS[z.effect.kind].icon}</span>`:''}${human&&ai?'<span class="token both">VS</span>':human?'<span class="token human">ME</span>':ai?'<span class="token ai">AI</span>':''}`;
  if(legal)tile.addEventListener('click',()=>humanAct({type:'move',dir:d.id}));board.appendChild(tile);
 }
 for(const p of ['human','ai']){const zones=state.zones[p],root=$(p+'-slots');root.replaceChildren();$(p+'-count').textContent=`${zones.length}/${state.slots}`;
  for(let i=0;i<state.slots;i++){const zone=zones[i],el=document.createElement(p==='human'?'button':'div');if(p==='human')el.type='button';el.className='slot '+(zone?'filled ':'')+(p==='ai'?'ai ':'')+(p==='human'&&selectedSlot===i?'selected':'');
    el.innerHTML=zone?`<span>${E.EFFECTS[zone.effect.kind].icon}</span><small>${html(zone.text.slice(0,25))}</small><small>${zone.cells.length}칸 남음</small>`:`<span>+</span><small>빈 슬롯</small>`;
    el.title=zone?.text||'비어 있는 슬롯';if(p==='human'){el.disabled=!humanReady();el.addEventListener('click',()=>{selectedSlot=selectedSlot===i?null:i;render();updatePreview(false);});}root.appendChild(el);
  }
 }
 $('slots').disabled=state.round!==1||state.history.length!==0||busy;
 $('remove').disabled=!humanReady()||selectedSlot===null||selectedSlot>=state.zones.human.length;$('cancel-slot').disabled=selectedSlot===null;
 $('deploy').disabled=!humanReady()||!preview?.ok||(selectedSlot===null&&state.zones.human.length>=state.slots);
 $('rule-input').disabled=!humanReady();
 $('status-summary').innerHTML=`<div><span>● 인간</span> · 남은 거리 ${E.scoreDistance(state,'human')}칸 · ${state.status.human.freeze?'⌛ 다음 턴 속박':state.status.human.shield?'🛡 보호막':'정상'}</div><div><span class="ai">● AI</span> · 남은 거리 ${E.scoreDistance(state,'ai')}칸 · ${state.status.ai.freeze?'⌛ 다음 턴 속박':state.status.ai.shield?'🛡 보호막':'정상'}</div><div>활성 함정 ${E.fullZones(state).reduce((a,z)=>a+z.cells.length,0)}칸 · 각 턴당 행동 1회</div>`;
 $('turn-help').textContent=state.status.human.freeze?'속박! 이번 라운드는 자동으로 쉬게 됩니다.':busy?'AI가 독립적으로 선택한 수를 판정하고 있습니다.':'칸을 클릭해 이동하거나, 자연어 효과를 설치하세요. AI는 당신의 이번 선택을 보지 못한 채 행동을 결정합니다.';
 window.__RULE_SABOTAGE_V1_SNAPSHOT__=()=>JSON.parse(JSON.stringify(state));
}
async function updatePreview(allowModel=true){
 const epoch=++previewEpoch,raw=$('rule-input').value.trim();preview=null;
 if(!raw){$('preview-message').textContent='자연어를 입력하면 게임 효과를 검증합니다.';$('preview-status').textContent='—';$('preview-status').className='preview-status';renderButtonOnly();return;}
 const basic=E.validateText(raw);
 if(!basic.ok){preview={ok:false,reason:basic.reason};previewSource='입력 검사';}
 else if(modelAdapter&&!allowModel){
  $('preview-message').textContent='입력 확인 중… OpenRouter 해석을 기다립니다.';
  $('preview-status').textContent='모델 심사 대기';$('preview-status').className='preview-status';renderButtonOnly();return;
 } else if(modelAdapter){
  $('preview-message').textContent='OpenRouter가 자연어를 게임 효과로 번역하고 있습니다…';
  $('preview-status').textContent='모델 해석 중';$('preview-status').className='preview-status';renderButtonOnly();
  try{
   const output=await modelAdapter(raw);if(epoch!==previewEpoch)return;
   preview=output.kind==='none'?{ok:false,reason:output.explanation||'지원하지 않는 규칙입니다.'}:E.validateInterpretation(raw,output);previewSource='OpenRouter 해석';
  }catch(e){
   if(epoch!==previewEpoch)return;
   // Offline playable fallback; never claim that the model successfully interpreted.
   if(e.status===503||e.name==='AbortError'||e instanceof TypeError){
    preview=E.parseRule(raw);previewSource='로컬 해석 (모델 미연결)';
    if(!preview.ok)preview={ok:false,reason:'모델 연결 오류 / 로컬 해석 불가: '+String(e.message||e)};
   }else{preview={ok:false,reason:'해석 거절: '+String(e.message||e)};previewSource='모델 심사 거절';}
  }
 }else{preview=E.parseRule(raw);previewSource='로컬 해석';}
 if(epoch!==previewEpoch)return;
 if(preview.ok){
   const verdict=window.RuleSabotageGuard.judge(state,'human',preview,selectedSlot!==null&&selectedSlot<state.zones.human.length?selectedSlot:undefined);
   if(!verdict.ok)preview={ok:false,reason:verdict.reason};
 }
 $('preview-message').textContent=preview.ok?`[${previewSource}] “${preview.summary}” · ${preview.explanation}`:preview.reason;
 $('preview-status').textContent=preview.ok?'✓ 확정적 공정성 검사 통과 · Kane 독립 심사 별도':'✕ 규칙 거절 또는 해석 불가';
 $('preview-status').className='preview-status '+(preview.ok?'good':'bad');renderButtonOnly();
}
function renderButtonOnly(){$('deploy').disabled=!humanReady()||!preview?.ok||(selectedSlot===null&&state.zones.human.length>=state.slots);}
function parseExternalAIAction(output){
 if(!output||typeof output!=='object')throw Error('AI action is missing');
 if(output.type==='deploy'){
  const rule=output.interpretation?E.validateInterpretation(output.text,output.interpretation):E.parseRule(output.text);
  if(!rule.ok)throw Error(rule.reason);
  const local=E.parseRule(output.text);
  if(local.ok&&local.effect.kind!==rule.effect.kind)throw Error('AI rule description and effect disagree');
  const verdict=window.RuleSabotageGuard.judge(state,'ai',rule,output.slot);if(!verdict.ok)throw Error(verdict.reason);
  return {type:'deploy',rule,...(output.slot!==undefined?{slot:output.slot}:{})};
 }
 if(output.type==='move')return {type:'move',dir:output.dir};
 if(output.type==='remove')return {type:'remove',slot:output.slot};
 if(output.type==='wait')return {type:'wait'};
 throw Error('Unsupported AI action');
}
function humanAct(action){if(busy||state.winner)return;
 if(action?.type==='deploy'){const g=window.RuleSabotageGuard.judge(state,'human',action.rule,action.slot);if(!g.ok){$('feed').textContent='심판: '+g.reason;return;}}
 const ok=E.validAction(state,'human',action);if(!ok.ok){$('feed').textContent=ok.reason;return;}
 busy=true;render();const epoch=gameEpoch;
 setTimeout(async()=>{
  if(epoch!==gameEpoch)return;
  try{const decision=E.chooseAI(state);let ai=decision.action,source='로컬 시뮬레이터',modelRationale='';
   if(aiAdapter){try{
     // The adapter receives ONLY the pre-round public state, never the human's action.
     const output=await aiAdapter(JSON.parse(JSON.stringify(state)));
     if(epoch!==gameEpoch)return;
     const proposal=parseExternalAIAction(output);
     if(!E.validAction(state,'ai',proposal).ok)throw Error('Model chose illegal action');
     ai=proposal;source='OpenRouter 상대 AI';modelRationale=typeof output.rationale==='string'?output.rationale.slice(0,180):'';
   }catch(err){console.warn('AI adapter rejected, using local simulator:',err);source='로컬 시뮬레이터 (연결 대체)';}}
   const result=E.resolveRound(state,action,ai);state=result.state;
   $('feed').textContent=`ROUND ${state.round-1} · ${result.events.join(' / ')}`;
   $('ai-report').textContent=`${source} · AI 선택: ${E.describe(ai)}. ${modelRationale?'모델이 제시한 선택 근거: '+modelRationale+'. ':''}로컬 평가 기준 인간 가능 행동 ${decision.scenarios}개. 로컬 기준 후보(모델 판단 기록과는 별개): ${decision.ranked.slice(0,3).map((r,i)=>`${i+1}) ${E.describe(r.action)} [${r.score.toFixed(1)}]`).join(' / ')}. 인간의 이번 비공개 선택은 AI 요청에 전달되지 않았습니다.`;
   selectedSlot=null;if(state.winner)showResult();
  }catch(e){$('feed').textContent='게임 판정 오류: '+String(e.message||e);console.error(e);}finally{busy=false;render();updatePreview(false);if(state.status.human.freeze&&!state.winner){setTimeout(()=>{if(epoch===gameEpoch&&!busy&&state.status.human.freeze)humanAct({type:'wait'});},700);}}
 },320);
}
function showResult(){$('overlay').hidden=false;const w=state.winner,draw=w==='draw';$('result-icon').textContent=draw?'🤝':w==='human'?'🏆':'🤖';$('result-title').textContent=draw?'DRAW — 기묘한 휴전':w==='human'?'YOU WIN — 규칙 파괴자':'AI WINS — 역관광';$('result-detail').textContent=`총 ${state.round-1}라운드. 설치한 규칙이 자신에게도 적용되는 공정한 게임이었습니다. 함정은 발동한 칸에서 일회성으로 소비됐어요.`;}
function newGame(){gameEpoch++;previewEpoch++;state=E.init(Date.now(),Number($('slots').value));selectedSlot=null;busy=false;$('overlay').hidden=true;$('rule-input').value='';$('feed').textContent='이동할 칸을 누르거나 자연어로 함정을 설치하세요.';$('ai-report').textContent='AI는 인간의 선택을 모르는 상태에서 가능성을 시뮬레이션합니다.';preview=null;render();updatePreview(false);}
$('rule-input').addEventListener('input',()=>{clearTimeout(typingTimer);updatePreview(false);if(modelAdapter)typingTimer=setTimeout(()=>updatePreview(true),450);});$('deploy').addEventListener('click',()=>{if(preview?.ok){humanAct({type:'deploy',rule:preview,...(selectedSlot!==null&&selectedSlot<state.zones.human.length?{slot:selectedSlot}:{})});}});
$('remove').addEventListener('click',()=>{if(selectedSlot!==null)humanAct({type:'remove',slot:selectedSlot});});$('cancel-slot').addEventListener('click',()=>{selectedSlot=null;render();updatePreview(false);});
for(const b of document.querySelectorAll('[data-example]'))b.addEventListener('click',()=>{$('rule-input').value=b.dataset.example;updatePreview();});
$('new-game').addEventListener('click',newGame);$('again').addEventListener('click',newGame);$('slots').addEventListener('change',newGame);
render();updatePreview(false);
fetch('/api/health').then(r=>r.json()).then(info=>{const v=document.querySelector('.version');if(v)v.textContent=info.modelConfigured?'V2 · OPENROUTER READY · KANE AUDIT PENDING':'V2 · OFFLINE FALLBACK · KANE AUDIT PENDING';}).catch(()=>{});
})();
