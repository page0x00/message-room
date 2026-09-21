import test from 'node:test';
import assert from 'node:assert/strict';
import {newRows} from '../notifications.js';
import {contactTarget} from '../ui-v2.js';
import {allowedEndpoint,messageId,notificationPayload,sameSecret} from '../supabase/functions/mailbox-push/policy.mjs';
const row=(id,author_id='other')=>({id,author_id,created_at:'2026-09-20T10:00:00.000001Z'});
test('notification eligibility excludes initial history, duplicates, own sends and older messages',()=>{const identity={userId:'me'};assert.deepEqual(newRows([row(1)],null,identity),[]);assert.deepEqual(newRows([row(1),row(2),row(3,'me')],row(1),identity).map(r=>r.id),['2']);assert.deepEqual(newRows([row(1),row(2)],row(2),identity),[]);});
test('saved contacts reject script/data and malformed URLs while retaining HTTPS/email',()=>{assert.equal(contactTarget('javascript:alert(1)'),null);assert.equal(contactTarget('data:text/html,hi'),null);assert.equal(contactTarget('https://example.com/path'),'https://example.com/path');assert.equal(contactTarget('friend@example.com'),'mailto:friend@example.com');});
test('Push endpoint validation denies SSRF, credentials, arbitrary ports, lookalikes and non-HTTPS',()=>{for(const value of ['http://fcm.googleapis.com/','https://fcm.googleapis.com.evil.test/','https://127.0.0.1/','https://localhost/','https://fcm.googleapis.com:444/x','https://user@fcm.googleapis.com/x','https://169.254.169.254/'])assert.equal(allowedEndpoint(value),false,value);for(const value of ['https://fcm.googleapis.com/fcm/send/x','https://updates.push.services.mozilla.com/wpush/v2/x','https://web.push.apple.com/x','https://wns2-sg2p.notify.windows.com/x'])assert.equal(allowedEndpoint(value),true,value);});
test('Push payload never includes content, sender name or invitation secrets',()=>{assert.deepEqual(JSON.parse(notificationPayload({id:18,room_id:'v2_abc',content:'secret message',invite:'secret',sender_name:'private name'})),{room:'v2_abc',id:'18'});assert.equal(messageId('18'), '18');assert.equal(messageId('1,room_id.eq.other'),null);});
test('webhook authentication requires nonempty matching secrets',async()=>{assert.equal(await sameSecret('',''),false);assert.equal(await sameSecret('first','second'),false);assert.equal(await sameSecret('correct-secret','correct-secret'),true);});

import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
test('worker uses generic text and restricts notification click to its own Pages scope',async()=>{
 const handlers={},shown=[],opened=[],jobs=[];const scope='https://page0x00.github.io/message-room/';
 const self={registration:{scope,showNotification:async(title,options)=>shown.push({title,...options})},clients:{claim:async()=>{},matchAll:async()=>[],openWindow:async url=>opened.push(url)},skipWaiting:async()=>{},addEventListener:(type,callback)=>handlers[type]=callback};
 vm.runInNewContext(await readFile(new URL('../sw.js',import.meta.url),'utf8'),{self,URL});
 handlers.push({data:{json:()=>({room:'OldRoom1',id:8,title:'ATTACK',body:'secret',url:'https://evil.test'})},waitUntil:task=>jobs.push(task)});await Promise.all(jobs);assert.equal(shown[0].body,'你有一条新留言');assert.equal(shown[0].title,'小小留言室');
 handlers.notificationclick({notification:{data:{room:'OldRoom1',url:'https://evil.test'},close(){}},waitUntil:task=>jobs.push(task)});await Promise.all(jobs);assert.equal(opened[0],scope+'?room=OldRoom1');
});
