import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
function wav(){const n=8000*12,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(36+n*2,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(Math.sin(i*.2)*12000),44+i*2);return b;}
export async function runWorkspace({setup,check,root,secureId,user}){
 const s=await setup({secure:true,touch:true,viewport:{width:1536,height:1260}}),p=s.page;
 const theme=value=>p.evaluate(async t=>(await import('./ui-v2.js?v=2.7.5')).setTheme(t),value);
 const shot=async name=>{await p.evaluate(()=>document.fonts.ready);await p.screenshot({path:root+'/test-results/workspace-'+name+'.png',animations:'disabled'});};
 const stored=()=>p.evaluate(async({secureId,user})=>(await import('./local-music.js')).musicStore('library.'+secureId+'.'+user),{secureId,user});
 await theme('warm-dark');
 await check('chat shows five themed attachment choices and opens the dedicated music workspace without saving a draft',async()=>{
  await p.locator('#composeMore').tap();assert.equal(await p.locator('.compose-choice').count(),5);await shot('attachments-warm-dark');
  const picker=p.waitForEvent('filechooser');await p.locator('#composeImages').tap();const chooser=await picker;assert.equal(await chooser.element().getAttribute('accept'),'image/*');await p.locator('[data-close=attachmentScrim]').click();
  await p.locator('#composeMore').tap();await p.locator('#composeMusic').tap();await p.locator('#musicImportPage').waitFor();
  await p.locator('#listenFile').setInputFiles({name:'演奏者 - 窗边.wav',mimeType:'audio/wav',buffer:wav()});await p.waitForFunction(()=>document.querySelector('#musicImportCount').textContent==='1'&&!document.querySelector('#musicImportSave').disabled);
  assert.equal(s.control.music.music_tracks.length,0);assert.ok(!await stored());assert.equal(await p.locator('#musicImportTitle').inputValue(),'窗边');assert.equal(await p.locator('#musicImportArtist').inputValue(),'演奏者');
  await p.locator('#musicImportCancel').click();assert.equal(await p.locator('#musicImportPage').isVisible(),false);assert.ok(!await stored());assert.equal(await p.locator('#listenFile').isVisible(),false);
 });
 await check('import previews actual audio, edits metadata and cover, checks lyrics, saves once and restores local extras',async()=>{
  await p.locator('#musicImport').click();await p.locator('#listenFile').setInputFiles({name:'演奏者 - 窗边.wav',mimeType:'audio/wav',buffer:wav()});await p.waitForFunction(()=>document.querySelector('#musicImportCount').textContent==='1'&&!document.querySelector('#musicImportSave').disabled);
  await p.locator('#musicPreviewPlay').click();await p.waitForFunction(()=>document.querySelector('#musicPreviewAudio').currentTime>.2);await p.locator('#musicPreviewPlay').click();
  await p.locator('#musicImportWave').waitFor();await p.locator('#musicImportAlbum').fill('我们的音乐架');await p.locator('#musicImportGenre').selectOption('轻音乐');await p.locator('#listenNotes').fill('第一次整理的歌曲');
  await p.locator('#musicCoverFile').setInputFiles({name:'cover.webp',mimeType:'image/webp',buffer:await readFile(root+'/assets/skins/warm-night.webp')});await p.waitForFunction(()=>document.querySelector('#musicImportCover').style.backgroundImage.includes('data:image/jpeg'));
  await p.locator('#lyricsFile').setInputFiles({name:'歌词.txt',mimeType:'text/plain',buffer:Buffer.from('测试歌词第一行\n测试歌词第二行')});await p.waitForFunction(()=>document.querySelector('#musicLyricsStatus').textContent.includes('纯文字'));
  await p.locator('#musicImportFavorite').click();await shot('import-warm-dark');await p.locator('#musicImportSave').click();await p.waitForFunction(()=>!document.querySelector('#listenToggle').disabled&&document.querySelector('#musicImportPage').hidden);
  const library=await stored(),track=library.tracks[0];assert.equal(track.album,'我们的音乐架');assert.equal(track.note,'第一次整理的歌曲');assert.ok(track.coverData.startsWith('data:image/jpeg'));assert.equal(track.plainLyrics,'测试歌词第一行\n测试歌词第二行');assert.equal(s.control.music.music_tracks.length,1);assert.ok(s.control.music.music_playlists.some(list=>list.title==='我的收藏'));
  await p.reload();await p.locator('#sceneNavChat').click();await p.locator('#miniListenOpen').click();await p.locator('#musicEditCurrent').click();assert.equal(await p.locator('#musicImportAlbum').inputValue(),'我们的音乐架');assert.equal(await p.locator('#listenNotes').inputValue(),'第一次整理的歌曲');
  await p.locator('#musicLyricsPasteTab').click();await p.locator('#musicImportLyrics').fill('[00:08]第二行\n[00:02]第一行\n[00:30]超出时长');await p.locator('#musicCheckLyrics').click();assert.match(await p.locator('#musicLyricsStatus').textContent(),/顺序不一致/);assert.match(await p.locator('#musicLyricsStatus').textContent(),/超出了/);
  await p.locator('#musicImportCancel').click();assert.equal((await stored()).tracks[0].plainLyrics,'测试歌词第一行\n测试歌词第二行');
  await p.locator('#musicEditCurrent').click();assert.equal(await p.locator('#musicImportFavorite').getAttribute('aria-pressed'),'true');await p.locator('#musicImportFavorite').click();await p.locator('#musicImportSave').click();await p.waitForFunction(()=>document.querySelector('#musicImportPage').hidden);assert.deepEqual(s.control.music.music_playlists.find(list=>list.title==='我的收藏').track_keys,[]);assert.ok(s.control.music.music_tracks[0].duration>0);
 });
 await check('import, API panel and select popovers fit every theme on phone, tablet and desktop',async()=>{
  for(const [width,height] of [[390,844],[820,1180],[1536,1100]]){
   await p.setViewportSize({width,height});
   for(const name of ['ins-light','ins-dark','warm-light','warm-dark','rain-night','moon-glass']){
    await theme(name);await p.locator('#sceneNavChat').click();await p.locator('#composeMore').click();await p.locator('#composeMusic').click();
    assert.ok(await p.locator('#listenScrim').evaluate(e=>e.scrollWidth<=e.clientWidth+1),`${name} ${width} import`);
    if(width===1536||name==='warm-dark'){await p.locator('#spacePages').evaluate(e=>e.scrollTop=0);await shot('import-'+width+'-'+name);}
    await p.locator('#sceneNavMore').click();await p.locator('#apiSpaceBtn').click();await p.waitForFunction(()=>!document.querySelector('#apiFields').disabled);
    assert.ok(await p.locator('#apiSettingsScrim').evaluate(e=>e.scrollWidth<=e.clientWidth+1),`${name} ${width} API`);
    const select=p.locator('#apiProvider + .themed-select');await select.click();assert.equal(await p.locator('#themedOptions').isVisible(),true);const rect=await p.locator('#themedOptions').boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width&&rect.y>=0&&rect.y+rect.height<=height);
    assert.equal(await p.locator('#themedOptions').evaluate(e=>getComputedStyle(e).backgroundColor),await p.evaluate(()=>{const el=document.createElement('div');el.style.background='var(--surface)';document.body.append(el);const color=getComputedStyle(el).backgroundColor;el.remove();return color;}));
    if(width===820&&name==='warm-dark')await shot('theme-select-tablet');
    await p.getByRole('option',{name:'Anthropic Claude · 官方',exact:true}).click();assert.equal(await p.locator('#apiProvider').inputValue(),'anthropic');assert.equal(await p.locator('#apiAuth + .themed-select span').textContent(),'x-api-key · Anthropic');
    await select.focus();await p.keyboard.press('ArrowDown');await p.keyboard.press('Home');await p.keyboard.press('Enter');assert.equal(await p.locator('#apiProvider').inputValue(),'openai');
    if(width===1536||name==='warm-dark'){await p.locator('#spacePages').evaluate(e=>e.scrollTop=0);await shot('api-'+width+'-'+name);}
   }
  }
  await p.locator('#sceneNavMail').click();assert.equal(await p.locator('#home .home-art').count(),0);assert.equal(await p.locator('#dailyCopy').count(),0);
 });
 await check('saved theme renders before the app module; delayed auth and room lists cannot steal touch navigation',async()=>{
  await theme('rain-night');let releaseApp,releaseJoin,releaseRooms,seenJoin;const appGate=new Promise(r=>releaseApp=r),joinGate=new Promise(r=>releaseJoin=r),roomGate=new Promise(r=>releaseRooms=r),joined=new Promise(r=>seenJoin=r);
  await s.context.route('**/app.js?*',async route=>{await appGate;await route.continue();});
  await s.context.route('**/rpc/mailbox_join_room',async route=>{seenJoin();await joinGate;await route.fallback();});
  await s.context.route('**/room_members?*',async route=>{if(new URL(route.request().url()).searchParams.get('select')==='room_id,joined_at')await roomGate;await route.fallback();});
  try{
   await p.reload({waitUntil:'commit'});await p.waitForFunction(()=>document.documentElement.dataset.theme==='rain-night');assert.equal(await p.locator('meta[name=theme-color]').getAttribute('content'),'#101e2b');assert.equal(await p.locator('#sceneSidebar').count(),0);
   releaseApp();await p.locator('#sceneNavMemory').waitFor();await joined;
   for(const id of ['Memory','Plan','Mail','Chat','Memory'])await p.locator('#sceneNav'+id).tap();assert.equal(await p.locator('#sceneNavMemory').getAttribute('aria-current'),'page');assert.equal(await p.locator('#wallSpace').isVisible(),true);
   releaseJoin();releaseRooms();await p.waitForFunction(()=>document.querySelector('#roomStatus').textContent.includes('左滑'));assert.equal(await p.locator('#sceneNavMemory').getAttribute('aria-current'),'page');assert.equal(await p.locator('#wallSpace').isVisible(),true);assert.equal(await p.locator('html').getAttribute('data-theme'),'rain-night');
  }finally{releaseApp();releaseJoin();releaseRooms();}
 });
 assert.deepEqual(s.errors,[]);await s.context.close();
}
