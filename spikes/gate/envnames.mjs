import fs from 'node:fs';
fs.appendFileSync(process.argv[2], Object.keys(process.env).filter(k=>k.startsWith('PAPERCLIP')).join(',')+'\n');
