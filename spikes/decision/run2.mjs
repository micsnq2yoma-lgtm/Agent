import {api} from '../api.mjs'; import fs from 'node:fs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const cid=fs.readFileSync('cid','utf8').trim(); const aid='829b18f6-0e86-4704-a906-be0b28eb30ad'; const iid='65082fc8-b9bb-4f7e-9f72-140d35af1db4';
await api('POST',`/agents/${aid}/wakeup`,{source:'on_demand',triggerDetail:'manual',reason:'p0 decision test',forceFreshSession:false,payload:{issueId:iid,taskId:iid}});
for(let i=0;i<30&&!fs.existsSync('decision/created.json');i++) await sleep(2000);
const d=JSON.parse(fs.readFileSync('decision/created.json','utf8'));
console.log('decision',d.id,d.status,d.continuationPolicy,JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k])=>/origin|agent|run|issue/i.test(k)))));
await sleep(8000);
const n0=fs.readFileSync('decision/wakes.log','utf8').trim().split('\n').length;
const res=await api('POST',`/decisions/${d.id}/decide`,{optionId:'a'});
console.log('decided',res.status??'',JSON.stringify(res).slice(0,300));
await sleep(30000);
const lines=fs.readFileSync('decision/wakes.log','utf8').trim().split('\n');
console.log('wakes before decide',n0,'after',lines.length);
const runs=await api('GET',`/companies/${cid}/heartbeat-runs?agentId=${aid}`);
for(const r of (Array.isArray(runs)?runs:runs.items).filter(r=>r.agentId===aid)){const x=await api('GET',`/heartbeat-runs/${r.runId??r.id}`);console.log(r.createdAt,r.status,JSON.stringify(x).match(/"wakeReason":"[^"]*"/)?.[0],JSON.stringify(x).match(/"decisionId":"[^"]*"/)?.[0]);}
