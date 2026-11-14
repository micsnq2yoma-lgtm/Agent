import {api} from './api.mjs'; import fs from 'node:fs'; import path from 'node:path';
const cid=fs.readFileSync('cid','utf8').trim();
const agents=await api('GET',`/companies/${cid}/agents`);
for(const a of agents){ const k=a.name.split('-')[0];
  const cwd=path.resolve('work',k);
  const u=await api('PATCH',`/agents/${a.id}`,{adapterConfig:{...a.adapterConfig,cwd}});
  console.log(a.name,a.id,u.status,u.lifecycleState,JSON.stringify(u.adapterConfig));
  fs.writeFileSync(`${k}.id`,a.id);
}
