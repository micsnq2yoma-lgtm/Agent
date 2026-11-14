import {api} from './api.mjs'; import fs from 'node:fs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const PID='8ad461bb-a75a-4c93-8c1e-bb4ae381eab0'; const cid=fs.readFileSync('cid','utf8').trim();
await api('POST',`/companies/${cid}/issues`,{title:'plugin event probe',status:'backlog'});
await sleep(70000);
console.log('data', JSON.stringify(await api('POST',`/plugins/${PID}/bridge/data`,{key:'stats',companyId:cid})));
const jobs=await api('GET',`/plugins/${PID}/jobs`); console.log('jobs',JSON.stringify(jobs).slice(0,300));
const tools=await api('GET','/plugins/tools'); console.log('tools',JSON.stringify(tools).slice(0,300));
const claude=fs.readFileSync('claude.id','utf8').trim(); const runs=JSON.parse(fs.readFileSync('runs-claude.json'));
try{console.log('exec',JSON.stringify(await api('POST','/plugins/tools/execute',{tool:'agentself.p0-spike:p0_echo',parameters:{text:'hi'},runContext:{agentId:claude,runId:runs[0].runId,companyId:cid,projectId:'00000000-0000-0000-0000-000000000000'}})).slice(0,300));}catch(e){console.log('exec err',e.message.slice(0,300));}
const ui=await api('GET','/plugins/ui-contributions'); console.log('ui',JSON.stringify(ui).slice(0,500));
