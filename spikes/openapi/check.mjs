import fs from 'node:fs';
const spec = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const txt = JSON.stringify(spec);
const fields = ['reportsTo','canCreateAgents','adapterType','parentId','projectId','goalId','blockedByIssueIds','continuationPolicy','wake_origin_agent','decideBy','snoozedUntil','budgetMonthlyCents','ask_user_questions','claude_local','codex_local','in_review','pending_approval','sessionId','role'];
for (const f of fields) console.log((txt.includes(`"${f}"`)||txt.includes(f)?'OK  ':'MISS')+' '+f);
const paths = Object.keys(spec.paths||{});
console.log('paths:',paths.length);
for (const p of [/attention/,/decisions.*decide/,/routines/,/costs/,/documents/,/approvals/,/plugins/,/dismiss|snooze/,/blocked|relations/]) console.log(p, paths.filter(x=>p.test(x)).slice(0,6).join(' | '));
