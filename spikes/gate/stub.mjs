// process-adapter stub: records each wake, does nothing else
import fs from 'node:fs'; import path from 'node:path';
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>k.startsWith('PAPERCLIP')&&!/KEY|TOKEN|JWT|SECRET/i.test(k)));
fs.appendFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/,'$1')),'wakes.log'), JSON.stringify({t:new Date().toISOString(),env})+'\n');
console.log('stub ok');
