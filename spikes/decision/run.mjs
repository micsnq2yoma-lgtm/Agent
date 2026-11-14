import {api} from '../api.mjs'; import fs from 'node:fs'; import path from 'node:path';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const cid=fs.readFileSync('cid','utf8').trim();
const a=await api('POST',`/companies/${cid}/agents`,{name:'decision-asker',role:'general',adapterType:'process',adapterConfig:{command:'node',args:[path.resolve('decision/stub.mjs')],cwd:path.resolve('decision')}});
const is=await api('POST',`/companies/${cid}/issues`,{title:'decision test',assigneeAgentId:a.id,status:'todo'});
for(let i=0;i<30&&!fs.existsSync('decision/created.json');i++) await sleep(2000);
const d=JSON.parse(fs.readFileSync('decision/created.json','utf8'));
console.log('decision',d.id,d.status,d.continuationPolicy,'origin',d.originAgentId??d.createdByAgentId);
await sleep(5000);
const n0=fs.readFileSync('decision/wakes.log','utf8').trim().split('\n').length;
const res=await api('POST',`/decisions/${d.id}/decide`,{optionId:'a'});
console.log('decided',res.status??JSON.stringify(res).slice(0,200));
await sleep(30000);
console.log(fs.readFileSync('decision/wakes.log','utf8'));
const runs=await api('GET',`/companies/${cid}/heartbeat-runs?agentId=${a.id}`);
for(const r of (Array.isArray(runs)?runs:runs.items).filter(r=>r.agentId===a.id)){const x=await api('GET',`/heartbeat-runs/${r.runId??r.id}`);console.log(r.createdAt,r.status,JSON.stringify(x.contextSnapshot||{}).match(/"wakeReason":"[^"]*"/)?.[0]);}
console.log('wakes before decide',n0);
