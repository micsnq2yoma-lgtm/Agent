import {api} from '../api.mjs'; import fs from 'node:fs';
const ids=JSON.parse(fs.readFileSync('gate/ids.json'));
const runs=await api('GET',`/issues/${ids.p}/runs`);
for(const r of runs){const d=await api('GET',`/heartbeat-runs/${r.runId}`);console.log(r.createdAt,r.status,'cont',r.continuationAttempt,'live',r.livenessState,r.livenessReason,'retryOf',r.retryOfRunId,'reason',r.scheduledRetryReason,'ctx',JSON.stringify(d.contextSnapshot||d.context||{}).slice(0,300));}
