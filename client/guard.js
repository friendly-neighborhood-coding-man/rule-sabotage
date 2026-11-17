'use strict';
/* Synchronized with client/guard.js. This is the final, non-LLM game fairness gate. */
const E = window.RuleSabotageV1;
const WEIGHTS = Object.freeze({back:1.5,freeze:2,forward:1,shield:0.5});
const MAX_ZONE_IMPACT = 14;
function judge(state,player,rule,slot){
  if(!state||!['human','ai'].includes(player))return {ok:false,reason:'Invalid state or actor',source:'deterministic_guard',kaneReviewed:false};
  if(!rule||rule.ok!==true)return {ok:false,reason:'Uncompiled rule',source:'deterministic_guard',kaneReviewed:false};
  const interpreted=E.validateInterpretation(rule.text,rule.effect);
  if(!interpreted.ok)return {ok:false,reason:interpreted.reason,source:'deterministic_guard',kaneReviewed:false};
  const a={type:'deploy',rule,...(slot===undefined?{}:{slot})};
  const action=E.validAction(state,player,a);
  if(!action.ok)return {ok:false,reason:action.reason,source:'deterministic_guard',kaneReviewed:false};
  const footprint=E.shapeCells(state).length;
  const impact=footprint*WEIGHTS[rule.effect.kind];
  if(impact>MAX_ZONE_IMPACT) return {ok:false,reason:`도형 범위 ${footprint}칸에서 효과가 너무 강합니다 (impact ${impact}/${MAX_ZONE_IMPACT}). 다른 효과를 선택하세요.`,impact,source:'deterministic_guard',kaneReviewed:false};
  return {ok:true,reason:'유한한 효과 · 공통 도형 · 양측 동일 발동 · 칸별 1회 소멸',impact,source:'deterministic_guard',kaneReviewed:false};
}
window.RuleSabotageGuard={judge,WEIGHTS,MAX_ZONE_IMPACT};
