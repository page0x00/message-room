import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {POEMS,nextPoemIndex} from '../poetry.js';
import {memoryLayout} from '../memory-viewport.js';

test('visits cycle through attributed public-domain verses without immediate repetitions',()=>{
 assert.equal(new Set(POEMS.map(p=>p.id)).size,25);
 for(let previous=0;previous<POEMS.length;previous++){const next=nextPoemIndex(previous);assert.notEqual(next,previous);assert.ok(next>=0&&next<POEMS.length);}
 for(const quote of POEMS){assert.ok(quote.zh&&quote.en&&quote.translator==='郑振铎');assert.match(quote.source,/^https:\/\/zh\.wikisource\.org\/wiki\/飛鳥集#/);assert.match(quote.original,/^https:\/\/www\.gutenberg\.org\//);}
 assert.equal(nextPoemIndex(null,25,()=>0),0);
});
test('responsive card density stays inside the canvas, while light depends on the shorter side',()=>{
 const layouts=[320,390,620,950,1280].map(w=>({w,...memoryLayout(w,500)}));
 assert.deepEqual(layouts.map(l=>l.columns),[2,2,3,4,5]);
 for(const l of layouts){assert.ok(l.card>=110&&l.card<=250);assert.ok(Math.abs(l.card*l.columns+l.gap*(l.columns-1)+l.padding*2-l.w)<.01);assert.equal(l.light,Math.min(l.w,500)*.17);}
});
test('published entry points resolve every local browser import including shared API modules',async()=>{
 const root=resolve(import.meta.dirname,'..'),seen=new Set();
 async function walk(path){if(seen.has(path))return;seen.add(path);const body=await readFile(path,'utf8');const imports=[...body.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.\.?\/[^'"?]+)(?:\?[^'"]*)?['"]/g)];for(const match of imports)await walk(resolve(dirname(path),match[1]));}
 await walk(resolve(root,'app.js'));await walk(resolve(root,'sw.js'));
 assert.ok(seen.has(resolve(root,'supabase/functions/_shared/ai-providers.js')));assert.ok(seen.has(resolve(root,'memory-viewport.js')));assert.ok(seen.has(resolve(root,'poetry.js')));
 const html=await readFile(resolve(root,'index.html'),'utf8');for(const match of html.matchAll(/(?:src|href)="([^"?#]+)(?:\?[^"#]*)?"/g)){if(!/^(?:https?:|#|data:)/.test(match[1]))await access(resolve(root,match[1]));}
 for(const file of ['publish-pages-branch.yml','pr-preview.yml']){const workflow=await readFile(resolve(root,'.github/workflows',file),'utf8');assert.ok(!workflow.includes("--exclude 'supabase/'"),'browser-shared modules must ship');}
});
