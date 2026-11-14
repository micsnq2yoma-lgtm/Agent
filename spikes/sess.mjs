import {api} from './api.mjs'; import fs from 'node:fs';
for (const k of ['claude','codex']){ const runs=JSON.parse(fs.readFileSync(`runs-${k}.json`));
 for(const r of runs){ const d=await api('GET',`/heartbeat-runs/${r.runId}`); const t=JSON.stringify(d);
  console.log(k,r.status,(t.match(/"[a-zA-Z_]*[sS]ession[a-zA-Z_]*":("[^"]{0,60}"|null)/g)||[]).join(' ')); } }
