const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../server/engine.cjs');
const b=E.parseRule('이 칸을 밟으면 이전 칸으로 돌아간다');
const f=E.parseRule('밟으면 다음 턴에 한 번 쉰다');
const x=E.parseRule('밟으면 한 칸 더 전진한다');
const shield=E.parseRule('밟으면 보호막을 얻는다');
function s(){return E.init(12345);}
function p(s){s.shape=E.SHAPES[0];return s;}
function pick(s,p,a){const check=E.validAction(s,p,a);assert.equal(check.ok,true,check.reason);return a;}
test('parses four semantic variants from natural Korean',()=>{for(const r of [b,f,x,shield])assert.equal(r.ok,true,JSON.stringify(r));});
test('alternative Korean phrasing for freeze works',()=>assert.equal(E.parseRule('한턴 속박').effect.kind,'freeze'));
test('unlimited, biased or oversized effects rejected',()=>{for(const t of ['상대를 뒤로 한 칸 밀기','나만 보호막을 얻는다','10턴 동안 속박','밟으면 무조건 승리','밟으면 영구히 정지'])assert.equal(E.parseRule(t).ok,false,t);});
test('ambiguous double effect is rejected',()=>assert.equal(E.parseRule('밟으면 뒤로 가고 앞으로 전진').ok,false));
test('unsafe model outputs rejected even with benign source text',()=>{assert.equal(E.validateInterpretation('한 칸 뒤로', {kind:'back',power:3}).ok,false);assert.equal(E.validateInterpretation('한 칸 뒤로', {kind:'delete_files',power:1}).ok,false);assert.equal(E.validateInterpretation('한 칸 뒤로',{kind:'back',power:1,script:'bad'}).ok,false);});
test('shared shapes are rotationally symmetric & never place on start / goal',()=>{for(const shape of E.SHAPES){const a=s();a.shape=shape;const keys=new Set(E.shapeCells(a));for(const k of keys){const [xx,yy]=k.split(',').map(Number);assert.ok(keys.has(`${6-xx},${6-yy}`),shape.id);}for(const pos of [...Object.values(E.START),...Object.values(E.GOAL)])assert.ok(!keys.has(pos.x+','+pos.y));}});
test('same shape for both competitors across each simultaneous round',()=>{const st=p(s());const result=E.resolveRound(st,{type:'move',dir:'right'},{type:'move',dir:'left'});assert.equal(result.state.history[0].shape,st.shape.id);assert.equal(result.state.positions.human.x,1);assert.equal(result.state.positions.ai.x,5);assert.equal(result.state.round,2);});
test('new trap placed by one side can hit either side, then consumed per tile',()=>{let st=p(s());const t=E.resolveRound(st,{type:'deploy',rule:b},{type:'move',dir:'left'});assert.equal(t.state.positions.ai.x,6,'AI moved left onto human trap and bounced back');const k='5,3';assert.equal(E.zoneAt(t.state,5,3),null,'triggering tile removed');assert.ok(E.zoneAt(t.state,4,3),'other cells remain active');});
test('human can trigger own trap without second trigger cascade',()=>{let st=p(s());st.zones.human=[{id:1,owner:'human',text:b.text,effect:b.effect,cells:['1,3','2,3']}];const t=E.resolveRound(st,{type:'move',dir:'right'},{type:'move',dir:'left'});assert.equal(t.state.positions.human.x,0);assert.ok(!E.zoneAt(t.state,1,3));assert.ok(E.zoneAt(t.state,2,3));});
test('freeze consumes next player action only and then clears',()=>{let st=p(s());st.zones.ai=[{id:1,owner:'ai',text:f.text,effect:f.effect,cells:['1,3']}];let t=E.resolveRound(st,{type:'move',dir:'right'},{type:'move',dir:'left'}).state;assert.equal(t.status.human.freeze,1);assert.equal(E.validAction(t,'human',{type:'move',dir:'right'}).ok,false);const next=E.resolveRound(t,{type:'wait'},{type:'move',dir:'left'}).state;assert.equal(next.status.human.freeze,0);});
test('new shape placement overwrites intersections and deletes depleted zones',()=>{let st=p(s());st.zones.ai=[{id:1,owner:'ai',text:b.text,effect:b.effect,cells:['1,3','3,3']}];const next=E.resolveRound(st,{type:'deploy',rule:f},{type:'move',dir:'up'}).state;assert.equal(next.zones.ai.length,0);assert.equal(E.zoneAt(next,3,3).effect.kind,'freeze');});
test('max slots only permits replacement or removal, not new deployment',()=>{const st=s();st.zones.human=Array.from({length:st.slots},(_,i)=>({id:i,owner:'human',text:b.text,effect:b.effect,cells:[`${i+1},3`]}));assert.equal(E.validAction(st,'human',{type:'deploy',rule:b}).ok,false);assert.equal(E.validAction(st,'human',{type:'deploy',slot:0,rule:b}).ok,true);});
test('AI considers candidate human responses and chooses legal action',()=>{const st=s(),decision=E.chooseAI(st);assert.ok(decision.scenarios>=4);assert.ok(decision.ranked.length>0);assert.equal(E.validAction(st,'ai',decision.action).ok,true);});
test('deterministic AI and random shape generation with fixed seed',()=>{const a=s(),c=s();assert.deepEqual(a.shape,c.shape);assert.deepEqual(E.chooseAI(a).action,E.chooseAI(c).action);});
test('both players reach goal same round means draw',()=>{let st=p(s());st.positions.human={x:5,y:3};st.positions.ai={x:1,y:3};const result=E.resolveRound(st,{type:'move',dir:'right'},{type:'move',dir:'left'});assert.equal(result.state.winner,'draw');});
test('AI and human play 25 rounds without crashing',()=>{let state=s();const options=['move','deploy'];for(let r=0;r<25&&!state.winner;r++){const a=E.candidates(state,'human')[0],b=E.chooseAI(state).action;state=E.resolveRound(state,a,b).state;}assert.ok(state.history.length>=1);});
test('simultaneous stale slot operations remain safe after trap overwrite',()=>{
 let st=p(s());st.zones.ai=[{id:32,owner:'ai',text:b.text,effect:b.effect,cells:['1,3']}];
 const result=E.resolveRound(st,{type:'deploy',rule:f},{type:'remove',slot:0});
 assert.equal(result.state.round,2);assert.ok(result.events.some(x=>x.includes('소멸')));
});
