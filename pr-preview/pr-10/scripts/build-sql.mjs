import {readFile,writeFile,readdir} from 'node:fs/promises';
const dir=new URL('../supabase/migrations/',import.meta.url);
const files=(await readdir(dir)).filter(name=>name.endsWith('.sql')).sort();
let combined='-- Generated from migrations by npm run build:sql. One atomic, additive installation.\n-- Run the whole file in Supabase SQL Editor. Existing messages are preserved.\nbegin;\n';
for(const file of files)combined+='\n-- '+file+'\n'+(await readFile(new URL(file,dir),'utf8')).replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'');
await writeFile(new URL('../supabase/INSTALL.sql',import.meta.url),combined+'\ncommit;\n');
