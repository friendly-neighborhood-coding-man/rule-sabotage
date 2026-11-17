/* V2 model-provider hooks; no API credentials in browser code. */
(()=>{
 'use strict';
 async function request(path,payload){
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),11000);
  try{
   const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
   const body=await response.json();
   if(!response.ok){const err=new Error(body.reason||body.error||`HTTP ${response.status}`);err.status=response.status;throw err;}
   return body;
  }finally{clearTimeout(timeout);}
 }
 window.RULE_SABOTAGE_MODEL_INTERPRETER=text=>request('/api/interpret-rule',{text});
 window.RULE_SABOTAGE_AI_OPPONENT=state=>request('/api/choose-action',{state});
 window.RULE_SABOTAGE_MODEL_JUDGE=(state,player,text,interpretation,slot)=>request('/api/judge-rule',{state,player,text,interpretation,slot});
})();
