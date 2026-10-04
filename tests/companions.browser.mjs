import assert from 'node:assert/strict';
export async function runCompanions({setup,check,secureId,user,friend,fixture,root}){
 const s=await setup({secure:true,rows:[fixture(1,secureId,'明天一起看海。',user,{author_id:user})],notificationFixture:true}),p=s.page;
 await p.waitForFunction(()=>document.querySelector('#roomStatus').textContent.includes('左滑'));await p.locator('#relationHandle').click();await p.locator('#petSpaceBtn').click();
 await check('pet starts without reading chat or pretending to generate, and a real consent scope is required',async()=>{
  await p.waitForFunction(()=>document.querySelector('#petStatus').textContent.length>0);assert.equal(s.control.petCalls,0);assert.equal(await p.locator('#petRefresh').isDisabled(),true);assert.match(await p.locator('#petStatus').textContent(),/未连接|无法连接/);
  s.control.petConfigured=true;await p.locator('#spaceBack').click();await p.locator('#petSpaceBtn').click();await p.locator('#petSettings summary').click();await p.locator('#petEnabled').check();await p.locator('#petStart').fill('2026-09-01');await p.locator('#petConsentForm [type=submit]').click();await p.waitForFunction(()=>!document.querySelector('#petRefresh').disabled);assert.equal(s.control.petConsents[0].user_id,user);assert.equal(s.control.petConsents[0].automatic,false);assert.equal(s.control.petCalls,0);
 });
 await check('server generated state renders as a pet with source memories and restores across reload without another model call',async()=>{
  await p.locator('#petRefresh').click();await p.waitForFunction(()=>document.querySelector('#petName').textContent==='小烬');assert.equal(s.control.petCalls,1);await p.locator('.pet-memory summary').click();assert.match(await p.locator('.pet-memory p').textContent(),/明天一起看海/);
  await p.locator('#petSettings summary').click();await p.locator('#spacePages').evaluate(e=>e.scrollTop=0);await p.screenshot({path:root+'/test-results/pet-phone.png'});await p.reload();await p.locator('#sceneNavChat').click();await p.waitForFunction(()=>document.querySelector('#roomStatus').textContent.includes('左滑'));await p.locator('#petBuddy').waitFor({state:'visible'});await p.locator('#petBuddy').click();assert.equal(await p.locator('#petName').textContent(),'小烬');assert.equal(s.control.petCalls,1);
  for(const [w,h] of [[390,844],[844,390],[820,1180],[1180,820],[1440,900]]){await p.setViewportSize({width:w,height:h});for(const theme of ['ins-light','ins-dark','warm-light','warm-dark','rain-night','moon-glass']){await p.evaluate(async t=>(await import('./ui-v2.js?v=2.6.0')).setTheme(t),theme);assert.ok(await p.locator('#petSpace').evaluate(e=>e.scrollWidth<=e.clientWidth+1));}}
 });
 await check('revoke clears the generated state and prevents further automatic reads',async()=>{
  await p.locator('#petSettings summary').click();await p.locator('#petRevoke').click();await p.getByRole('button',{name:'撤回并清除',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#petName').textContent==='一团小小的光');assert.equal(s.control.petState,null);assert.equal(s.control.petConsents[0].enabled,false);assert.equal(await p.locator('#petBuddy').isVisible(),false);
 });
 await check('real reminder kinds deduplicate and route to the matching relationship panel with server read receipts',async()=>{
  const labels=['goal','todo','anniversary','pocket','withdraw','listen'];s.control.notices=labels.map((kind,i)=>({id:'notice-'+i,room_id:secureId,user_id:user,kind,seen_at:null}));await p.locator('#spaceBack').click();await p.evaluate(()=>document.dispatchEvent(new Event('mailbox:space-open')));await p.waitForFunction(()=>document.querySelectorAll('.relation-notice').length===6);assert.equal(await p.locator('#relationHandle').getAttribute('data-reminders'),'6');
  await p.locator('.relation-notice').last().locator('button').first().click();assert.equal(await p.locator('#listenScrim').isVisible(),true);await p.waitForTimeout(80);assert.ok(s.control.notices.at(-1).seen_at);await p.locator('#spaceBack').click();await p.locator('.relation-notice').first().locator('button').last().click();await p.waitForTimeout(80);assert.equal(await p.locator('#relationHandle').getAttribute('data-reminders'),'4');
  await p.evaluate(()=>document.dispatchEvent(new CustomEvent('mailbox:listen-invite',{detail:{room:'v2_browserdemo0001',track:'x'}})));await p.waitForTimeout(80);assert.equal(s.control.listenInvites,1);
 });
 assert.deepEqual(s.errors,[]);await s.context.close();
}
