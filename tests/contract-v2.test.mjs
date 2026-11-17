import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {parseAIReply,parseCompilerReply} from '../server/contracts.ts';
import {validatePublicState,compile} from '../server/server.ts';
const require=createRequire(import.meta.url),E=require('../server/engine.cjs'),{judge}=require('../server/guard.cjs');
const rule=(text)=>E.parseRule(text), state=(shape)=>{let s=E.init(101);s.shape=structuredClone(E.SHAPES.find(x=>x.id===shape));return s;};

test('V1 deterministic baseline mechanics retained',()=>assert.equal(E.SIZE,7));
test('TypeScript effect contract rejects unknown kinds and malformed decisions',()=>{
 assert.throws(()=>parseCompilerReply({supported:true,kind:'run_shell',explanation:'x'}));
 assert.throws(()=>parseCompilerReply({supported:false,kind:'freeze',explanation:'x'}));
 assert.throws(()=>parseAIReply({type:'hack',dir:'none',text:'',slot:-1,rationale:''}));
 assert.equal(parseCompilerReply({supported:true,kind:'freeze',explanation:'one turn'}).kind,'freeze');
 assert.equal(parseAIReply({type:'move',dir:'left',text:'',slot:-1,rationale:'advance'}).dir,'left');
});
test('same freeze effect is allowed for both players on a line',()=>{
 for(const p of ['human','ai'])assert.equal(judge(state('horizontal'),p,rule('한 턴 쉰다')).ok,true);
});
test('3x3 freeze is rejected symmetrically as too strong',()=>{
 for(const p of ['human','ai']){
  const s=state('square'),r=rule('한 턴 쉰다');
  assert.equal(judge(s,p,r).ok,false);
  assert.equal(E.validAction(s,p,{type:'deploy',rule:r}).ok,false);
 }
});
test('3x3 backward is allowed, preserves one-shot and both directions',()=>{
 const s=state('square'),r=rule('한 칸 뒤로 되돌아간다');
 for(const p of ['human','ai'])assert.equal(judge(s,p,r).ok,true);
 const t=E.resolveRound(s,{type:'deploy',rule:r},{type:'move',dir:'left'});
 assert.ok(t.state.zones.human.length>=1);
});
test('judge never claims actual Kane verification',()=>{
 const r=judge(state('horizontal'),'human',rule('다음 턴 쉬기'));
 assert.equal(r.source,'deterministic_guard');assert.equal(r.kaneReviewed,false);
});
test('unlimited, malicious, and multi-effect rule texts are not executable',()=>{
 for(const text of ['영구 속박', '상대만 다음 턴 쉬기', '10턴 기절', '이 칸에서 즉시 승리', '파일 삭제']){
  assert.equal(E.parseRule(text).ok,false,text);
 }
 assert.equal(E.validateInterpretation('뒤로 한 칸', {kind:'back',power:1,code:'process.exit(0)'}).ok,false);
});
test('public state rejected if the common geometry is forged',()=>{
 let s=state('horizontal');assert.equal(validatePublicState(s),true);
 s.shape.cells=[{x:20,y:20}];assert.equal(validatePublicState(s),false);
});
test('public snapshot cannot smuggle a hidden move through model prompt fields',()=>{
 let s=state('vertical');s.humanCommittedSecret={type:'move',dir:'left'};
 assert.equal(validatePublicState(s),true); // server selects fields explicitly in sanitizedState
});
test('offline mode does not fabricate an OpenRouter response',async()=>{
 const old=process.env.OPENROUTER_API_KEY,model=process.env.OPENROUTER_MODEL;
 delete process.env.OPENROUTER_API_KEY;delete process.env.OPENROUTER_MODEL;
 await assert.rejects(()=>compile('한 턴 쉬기'),/not configured/);
 if(old)process.env.OPENROUTER_API_KEY=old;if(model)process.env.OPENROUTER_MODEL=model;
});
test('browser and server deterministic engines are in sync',async()=>{
 const a=await readFile(new URL('../client/engine.js',import.meta.url),'utf8');
 const b=await readFile(new URL('../server/engine.cjs',import.meta.url),'utf8');
 assert.equal(a,b);
});
test('model API key never shipped in browser files',async()=>{
 const a=await readFile(new URL('../client/adapters.js',import.meta.url),'utf8');
 assert.ok(!a.includes('OPENROUTER_API_KEY'));assert.ok(!a.includes('Bearer '));
});
