import {api} from './api.mjs'; import fs from 'node:fs';
const cid=fs.readFileSync('cid','utf8').trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitRun(iid, n, label){
  for(let i=0;i<180;i++){ const runs=await api('GET',`/issues/${iid}/runs`); const list=Array.isArray(runs)?runs:(runs.items||runs.runs||[]);
    const done=list.filter(r=>['succeeded','failed','cancelled','timed_out','error','completed'].includes(r.status));
    if(done.length>=n) return list; await sleep(5000);} throw new Error(label+' timeout');}
const k=process.argv[2]; const aid=fs.readFileSync(`${k}.id`,'utf8').trim();
const is=await api('POST',`/companies/${cid}/issues`,{title:`P0 ${k}: write hello.txt`,description:'Create a file hello.txt in your working directory containing the single word HELLO, then mark this issue done. Keep it minimal.',assigneeAgentId:aid,status:'todo'});
console.log('issue',is.id,is.identifier);
let runs=await waitRun(is.id,1,'run1');
const r1=runs.map(r=>({id:r.id,status:r.status,sessionIdAfter:r.sessionIdAfter??r.sessionId,usage:r.usageJson??r.usage}));
console.log('run1',JSON.stringify(r1));
await api('POST',`/issues/${is.id}/comments`,{body:'Follow-up: append a second line WORLD to hello.txt, and tell me what you wrote in the previous run.'});
runs=await waitRun(is.id,2,'run2');
console.log('runs',JSON.stringify(runs.map(r=>({id:r.id,status:r.status,invocationSource:r.invocationSource,sessionIdBefore:r.sessionIdBefore,sessionIdAfter:r.sessionIdAfter,usage:r.usageJson,result:r.resultJson&&Object.keys(r.resultJson)})),null,1));
fs.writeFileSync(`runs-${k}.json`,JSON.stringify(runs,null,1));
console.log('file:',fs.existsSync(`work/${k}/hello.txt`)&&fs.readFileSync(`work/${k}/hello.txt`,'utf8'));
