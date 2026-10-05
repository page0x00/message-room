import assert from 'node:assert/strict';
export async function runLocalAPI({setup,check,root,user,secureId,fixture}){
 const s=await setup({secure:true,rows:[fixture(1,secureId,'明天一起看海。',user,{author_id:user})]}),p=s.page;
 s.control.apiUnavailable=true;
 await p.locator('#menuBtn').click();await p.locator('#themeMenuBtn').click();await p.locator('#apiSettingsBtn').click();await p.waitForFunction(()=>!document.querySelector('#apiFields').disabled);
 await check('default local mode works without API backend, pulls models and applies final exclusions to a browser request',async()=>{
  assert.equal(await p.locator('#apiMode').inputValue(),'local');assert.equal(s.control.apiRequests,0);
  await p.locator('#apiProvider').selectOption('custom');await p.locator('#apiBase').fill('https://direct.example.com/v1');await p.locator('#apiKey').fill('only-local-browser-secret');await p.locator('#apiFetchModels').click();await p.waitForFunction(()=>document.querySelector('#apiModels').children.length===2);
  await p.locator('#apiModelToggle').click();await p.getByRole('option',{name:'browser-model',exact:true}).click();assert.equal(await p.locator('#apiModel').inputValue(),'browser-model');await p.locator('.api-details').first().locator('summary').click();await p.locator('#apiParam_temperature').fill('0');await p.locator('.api-details').nth(1).locator('summary').click();await p.locator('#apiExtra').fill('{"max_completion_tokens":3000}');await p.locator('#apiExclude').fill('temperature\nmax_tokens');
  await p.locator('#apiTest').click();await p.waitForFunction(()=>document.querySelector('#apiStatus').textContent.includes('连接成功'));
  const sent=s.control.directRequests.at(-1);assert.equal(sent.headers.authorization,'Bearer only-local-browser-secret');const body=JSON.parse(sent.body);assert.equal(body.max_completion_tokens,3000);assert.ok(!('temperature' in body));assert.ok(!('max_tokens' in body));assert.ok(!JSON.stringify(s.control.backendRequests).includes('only-local-browser-secret'));
  await p.locator('#apiSave').click();await p.waitForFunction(()=>document.querySelector('#apiStatus').textContent.includes('本机直连'));assert.equal(s.control.apiProfiles.length,0);assert.equal(s.control.apiRequests,0);assert.equal(await p.locator('#apiKey').inputValue(),'');
  const storage=await p.evaluate(()=>({local:JSON.stringify({...localStorage}),session:JSON.stringify({...sessionStorage})}));assert.ok(!storage.local.includes('only-local-browser-secret'));assert.ok(storage.session.includes('only-local-browser-secret'));
 });
 await check('direct pet sends only authorized chat to the provider and sends no API key to the database',async()=>{
  await p.locator('#apiClose').click();await p.locator('#relationHandle').click();await p.locator('#petSpaceBtn').click();await p.locator('#petSettings summary').click();await p.locator('#petEnabled').check();await p.locator('#petStart').fill('2026-09-01');await p.locator('#petConsentForm [type=submit]').click();await p.waitForFunction(()=>!document.querySelector('#petRefresh').disabled);
  assert.equal(s.control.petConsents[0].api_scope,'https://direct.example.com');await p.locator('#petRefresh').click();await p.waitForFunction(()=>document.querySelector('#petName').textContent==='直连小光');assert.equal(s.control.directPrepares,1);assert.equal(s.control.directFinishes,1);assert.equal(s.control.petCalls,0);assert.ok(!JSON.stringify(s.control.backendRequests).includes('only-local-browser-secret'));
  const sent=JSON.parse(s.control.directRequests.at(-1).body);assert.deepEqual(JSON.parse(sent.messages.at(-1).content),[{id:'1',text:'明天一起看海。',author:user}]);
 });
 await check('refresh retains tab credentials, opt-in remembers on this device and CORS failure never falls back to a proxy',async()=>{
  await p.reload();await p.locator('#sceneNavChat').click();await p.waitForFunction(()=>document.querySelector('#roomStatus').textContent.includes('左滑'));await p.evaluate(()=>document.dispatchEvent(new Event('mailbox:api-open')));await p.waitForFunction(()=>document.querySelectorAll('.api-connection').length===1);assert.equal(await p.locator('#apiKey').inputValue(),'');
  s.control.directFail=true;const calls=s.control.directRequests.length;await p.locator('#apiTest').click();await p.waitForFunction(()=>document.querySelector('#apiStatus').textContent.includes('CORS'));assert.equal(s.control.directRequests.length,calls+1);assert.equal(s.control.apiRequests,0);s.control.directFail=false;
  await p.locator('#apiRemember').check();await p.locator('#apiSave').click();await p.waitForFunction(()=>document.querySelector('#apiStatus').textContent.includes('已保存'));const storage=await p.evaluate(()=>({local:JSON.stringify({...localStorage}),session:JSON.stringify({...sessionStorage})}));assert.ok(storage.local.includes('only-local-browser-secret'));assert.ok(!storage.session.includes('only-local-browser-secret'));
  await p.locator('#spacePages').evaluate(e=>e.scrollTop=0);await p.screenshot({path:root+'/test-results/api-local-phone.png'});
 });
 await check('missing direct consent RPC gives deployment guidance; clearing local configuration removes the saved key',async()=>{
  await p.locator('#apiClose').click();await p.locator('#relationHandle').click();await p.locator('#petSpaceBtn').click();s.control.directMissing=true;await p.waitForFunction(()=>!document.querySelector('#petRefresh').disabled);await p.locator('#petRefresh').click();await p.waitForFunction(()=>document.querySelector('#petStatus').textContent.includes('SQL'));assert.equal(s.control.directFinishes,1);s.control.directMissing=false;
  await p.locator('#petAPIOpen').click();await p.waitForFunction(()=>!document.querySelector('#apiFields').disabled);await p.locator('#apiClearLocal').click();
  // An identity/sheet reset while confirmation is open must invalidate that action.
  await p.evaluate(()=>document.dispatchEvent(new CustomEvent('mailbox:sheet-close',{detail:{id:'apiSettingsScrim'}})));await p.locator('#noticeConfirm').click();
  await p.evaluate(()=>document.dispatchEvent(new Event('mailbox:api-open')));await p.waitForFunction(()=>document.querySelectorAll('.api-connection').length===1);
  assert.ok(await p.evaluate(()=>JSON.stringify({...localStorage}).includes('only-local-browser-secret')));
  await p.locator('#apiClearLocal').click();await p.locator('#noticeConfirm').click();await p.waitForFunction(()=>document.querySelectorAll('.api-connection').length===0);
  assert.ok(!await p.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('only-local-browser-secret')));assert.equal(s.control.apiRequests,0);
 });
 assert.deepEqual(s.errors,[]);await s.context.close();
}
