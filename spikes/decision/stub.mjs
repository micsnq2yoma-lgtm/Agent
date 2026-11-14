// process-adapter stub for Decision test. Never logs secret values.
import fs from 'node:fs'; import path from 'node:path';
const dir=path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const log=o=>fs.appendFileSync(path.join(dir,'wakes.log'),JSON.stringify({t:new Date().toISOString(),...o})+'\n');
const e=process.env; const secretName=Object.keys(e).find(k=>/^PAPERCLIP_.*(API_KEY|JWT|TOKEN)$/.test(k));
const ctx={run:e.PAPERCLIP_RUN_ID,wakeReason:e.PAPERCLIP_WAKE_REASON,taskId:e.PAPERCLIP_TASK_ID,secretVar:secretName,allNames:Object.keys(e).filter(k=>k.startsWith('PAPERCLIP')&&/WAKE|TASK|ISSUE|DECISION|KEY|JWT|TOKEN/.test(k))};
const marker=path.join(dir,'created.json');
if(!fs.existsSync(marker)){
  const r=await fetch(`${e.PAPERCLIP_API_URL}/api/companies/${e.PAPERCLIP_COMPANY_ID}/decisions`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${e[secretName]}`,'x-paperclip-run-id':e.PAPERCLIP_RUN_ID},
    body:JSON.stringify({title:'P0 decision test',body:'Pick one',options:[{id:'a',label:'A',effects:[]},{id:'b',label:'B',effects:[]}],continuationPolicy:'wake_origin_agent'})});
  const t=await r.text(); fs.writeFileSync(marker,t); log({...ctx,step:'created',status:r.status,resp:t.slice(0,300)});
} else log({...ctx,step:'rewoken'});
