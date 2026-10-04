import {runLocalAPI} from './local-api.browser.mjs';
import assert from 'node:assert/strict';
export async function runAPI({setup,check,root,user,secureId,fixture}){
 const s=await setup({secure:true}),p=s.page;
 await p.locator('#menuBtn').click();await p.locator('#themeMenuBtn').click();await p.locator('#apiSettingsBtn').click();await p.waitForFunction(()=>!document.querySelector('#apiFields').disabled);await p.locator('#apiMode').selectOption('cloud');await p.waitForFunction(()=>!document.querySelector('#apiFields').disabled);
 await check('API settings pull models before choosing one, preview exclusions and save an encrypted-key profile',async()=>{
  await p.locator('#apiName').fill('我的 OpenRouter');await p.locator('#apiKey').fill('browser-test-secret');
  await p.locator('#apiFetchModels').click();await p.waitForFunction(()=>document.querySelector('#apiModels').children.length===2);assert.equal(s.control.apiModelCalls,1);
  await p.locator('#apiModel').fill('vendor/model-a');await p.locator('#apiParam_temperature').fill('0');
  await p.locator('.api-details').nth(1).locator('summary').click();await p.locator('#apiExtra').fill('{"max_completion_tokens":3000,"reasoning":{"effort":"low","enabled":true}}');await p.locator('#apiExclude').fill('temperature\nmax_tokens\nreasoning.effort\nresponse_format');
  const preview=JSON.parse(await p.locator('#apiPreview').textContent());assert.equal(preview.body.max_completion_tokens,3000);assert.deepEqual(preview.body.reasoning,{enabled:true});assert.ok(!Object.hasOwn(preview.body,'temperature'));assert.ok(!JSON.stringify(preview).includes('browser-test-secret'));
  await p.locator('#apiSave').click();await p.waitForFunction(()=>document.querySelector('#apiStatus').textContent.includes('已保存并启用'));assert.equal(s.control.apiProfiles.length,1);assert.equal(s.control.apiCalls,0);assert.equal(await p.locator('#apiKey').inputValue(),'');
  const stored=await p.evaluate(()=>JSON.stringify({...localStorage}));assert.ok(!stored.includes('browser-test-secret'));assert.ok(!stored.includes('max_completion_tokens'));
 });
 await check('test connection, validation failures and gateway errors preserve the saved configuration',async()=>{
  await p.locator('#apiTest').click();await p.waitForFunction(()=>document.querySelector('#apiStatus').textContent.includes('连接成功'));assert.equal(s.control.apiCalls,1);
  await p.locator('#apiExtra').fill('{broken');await p.locator('#apiSave').click();assert.match(await p.locator('#apiStatus').textContent(),/JSON/);assert.equal(s.control.apiProfiles.length,1);
  await p.locator('#apiExtra').fill('{}');s.control.apiFailNext=true;await p.locator('#apiTest').click();await p.waitForFunction(()=>document.querySelector('#apiStatus').textContent.includes('测试渠道暂时不可用'));assert.equal(s.control.apiProfiles[0].model,'vendor/model-a');
 });
 await check('multiple presets and custom URLs retain one themed form across phone, tablet and desktop',async()=>{
  await p.locator('#apiNew').click();await p.locator('#apiProvider').selectOption('gemini');assert.equal(await p.locator('#apiAuth').inputValue(),'google');assert.equal(await p.locator('#apiProtocol').inputValue(),'gemini');
  await p.locator('#apiName').fill('我的 Gemini');await p.locator('#apiKey').fill('another-test-key');await p.locator('#apiModel').fill('gemini-test');await p.locator('#apiParam_top_k').fill('40');await p.locator('#apiSave').click();await p.waitForFunction(()=>document.querySelectorAll('.api-connection').length===2);assert.equal(s.control.apiProfiles.length,2);
  for(const [width,height] of [[390,844],[1180,820],[1440,900]]){await p.setViewportSize({width,height});for(const theme of ['ins-light','ins-dark','warm-light','warm-dark','rain-night','moon-glass']){await p.evaluate(async t=>(await import('./ui-v2.js?v=2.6.0')).setTheme(t),theme);assert.ok(await p.locator('.api-sheet').evaluate(e=>e.scrollWidth<=e.clientWidth+1));}}
  await p.locator('.api-sheet').evaluate(e=>e.scrollTop=0);await p.screenshot({path:root+'/test-results/api-desktop.png'});await p.setViewportSize({width:390,height:844});await p.locator('.api-sheet').evaluate(e=>e.scrollTop=0);await p.screenshot({path:root+'/test-results/api-phone.png'});
  await p.locator('.api-connection').first().click();await p.locator('#apiSave').click();await p.waitForFunction(()=>document.querySelector('#apiActive').textContent.includes('我的 OpenRouter'));assert.equal(s.control.apiActive,s.control.apiProfiles[0].id);
 });
 await check('stored connections survive reload while keys do not; closing erases unsaved keys and delete removes one profile',async()=>{
  await p.reload();await p.locator('#sceneNavChat').click();await p.waitForFunction(()=>document.querySelector('#roomStatus').textContent.includes('左滑'));await p.evaluate(()=>document.dispatchEvent(new Event('mailbox:api-open')));await p.waitForFunction(()=>document.querySelectorAll('.api-connection').length===2);assert.equal(await p.locator('#apiKey').inputValue(),'');assert.equal(await p.locator('#apiModel').inputValue(),'vendor/model-a');
  await p.locator('#apiKey').fill('unsaved-secret');await p.locator('#apiClose').click();assert.equal(await p.locator('#apiKey').inputValue(),'');
  await p.evaluate(()=>document.dispatchEvent(new Event('mailbox:api-open')));await p.waitForFunction(()=>!document.querySelector('#apiFields').disabled);await p.locator('#apiDelete').click();await p.locator('#noticeConfirm').click();await p.waitForFunction(()=>document.querySelectorAll('.api-connection').length===1);assert.equal(s.control.apiProfiles.length,1);assert.equal(s.control.apiActive,null);
 });
 await p.locator('#apiClose').click();assert.deepEqual(s.errors,[]);await s.context.close();await runLocalAPI({setup,check,root,user,secureId,fixture});
}
