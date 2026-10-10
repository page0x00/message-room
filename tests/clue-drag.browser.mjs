import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {memoryControl} from './memory-controls.mjs';
export async function runClueDrag({setup,check,secureId,user,fixture,root}){
 const photo=await readFile(root+'/assets/skins/warm-day.webp'),path=secureId+'/'+user+'/00000000-0000-4000-a000-000000000091';
 const s=await setup({secure:true,startView:'home',touch:true,viewport:{width:1280,height:730},rows:[fixture(1,secureId,'长一点的回忆文字，用来检查便签的排版。'.repeat(12),user,{author_id:user,display_date:'2026-09-20'}),fixture(2,secureId,'',user,{author_id:user,message_type:'image',media_path:path,media_mime:'image/webp',media_name:'窗边.webp',media_size:photo.length})],uploads:[[path,{buffer:photo,mime:'image/webp'}]]}),p=s.page;
 await p.waitForFunction(()=>document.querySelector('#roomStatus').textContent.includes('左滑'));
 s.control.memoryProfiles.push({room_id:secureId,owner_user_id:user,data:{annotations:{'message:2':{back:'背面的补充记录，用来检查翻面后的排版。'.repeat(12),tags:['照片','补充记录']}}},revision:1});
 await p.locator('#sceneNavMemory').tap();await memoryControl(p,'[data-memory-mode=board]');
 const cdp=await s.context.newCDPSession(p);
 const drag=async(from,to)=>{
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...from,id:1}]});
  for(let i=1;i<=12;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/12,y:from.y+(to.y-from.y)*i/12,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(100);
 };
 const frame=()=>p.locator('.clue-stage').evaluate(e=>{const b=e.getBoundingClientRect();return {x:b.x+e.clientLeft,y:b.y+e.clientTop,width:e.clientWidth,height:e.clientHeight};});
 const note=p.locator('[data-memory-id="message:1"]'),picture=p.locator('[data-memory-id="message:2"]');
 const halfway=async()=>{await p.locator('#memoryZoomReset').tap();for(let i=0;i<4;i++)await p.locator('#memoryZoomOut').tap();};
 const grab=card=>card.evaluate(el=>{
  const b=el.getBoundingClientRect(),stage=el.closest('.memory-stage'),f=stage.getBoundingClientRect();
  const left=Math.max(b.left,f.left+stage.clientLeft),right=Math.min(b.right,f.left+stage.clientLeft+stage.clientWidth),top=Math.max(b.top,f.top+stage.clientTop),bottom=Math.min(b.bottom,f.top+stage.clientTop+stage.clientHeight);
  for(let y=top+10;y<bottom-3;y+=8)for(const ratio of [.5,.3,.7]){const x=left+(right-left)*ratio,target=document.elementFromPoint(x,y);if(target?.closest('[data-memory-id]')===el&&!target.closest('button,input,a'))return {x,y};}
  throw Error('No visible drag grip on '+el.dataset.memoryId);
 });
 const place=async(card,rx,ry)=>{const f=await frame();await drag(await grab(card),{x:f.x+f.width*rx,y:f.y+f.height*ry});};
 const saved=()=>JSON.stringify(s.control.memoryProfiles[0]?.data.positions||{});
 const corner=async(card,x,y)=>{
  const f=await frame();
  await drag(await grab(card),{x:x?f.x+f.width-2:f.x+2,y:y?f.y+f.height-2:f.y+2});
  const moved=await card.boundingBox(),gap={left:moved.x-f.x,top:moved.y-f.y,right:f.x+f.width-moved.x-moved.width,bottom:f.y+f.height-moved.y-moved.height};
  assert.ok((x?gap.right:gap.left)<18&& (y?gap.bottom:gap.top)<18,JSON.stringify({x,y,gap,frame:f,card:moved}));
  assert.ok(Object.values(gap).every(n=>n>=-1),'rotated card must stay inside the visible frame: '+JSON.stringify(gap));
 };
 await check('photo and note footers stay inside the paper on both faces, across themes, sizes and zoom',async()=>{
  const geometry=card=>card.evaluate(el=>{
   const padding=parseFloat(getComputedStyle(el).paddingBottom);
   return {height:el.offsetHeight,buttons:[...el.querySelectorAll('.memory-card-actions button')].map(b=>{
    let x=0,y=0;for(let e=b;e&&e!==el;e=e.offsetParent){x+=e.offsetLeft;y+=e.offsetTop;}
    return {label:b.textContent,inside:x>=0&&y>=0&&x+b.offsetWidth<=el.clientWidth+1&&y+b.offsetHeight<=el.clientHeight-padding+1};
   })};
  });
  for(const [width,height] of [[820,1180],[390,844],[1280,730]]){
   await p.setViewportSize({width,height});await p.waitForTimeout(180);
   for(const theme of ['ins-light','ins-dark','warm-light','warm-dark','rain-night','moon-glass']){
    await p.evaluate(async t=>(await import('./ui-v2.js?v=2.7.7')).setTheme(t),theme);
    for(const mode of ['board','notes']){
     await memoryControl(p,`[data-memory-mode=${mode}]`);await p.locator('#memoryZoomReset').tap();
     await picture.locator('img').evaluate(img=>img.complete&&img.naturalWidth?null:new Promise(resolve=>img.addEventListener('load',resolve,{once:true})));
     for(const zoom of [100,50]){
      if(zoom===50)await halfway();
      for(const card of [note,picture]){
       const front=await geometry(card),label=`${theme} ${width} ${mode} ${zoom}% ${await card.getAttribute('data-memory-id')}`;
       assert.ok(front.buttons.every(b=>b.inside),label+' front '+JSON.stringify(front));
       await card.getByRole('button',{name:'翻面',exact:true}).tap();
       const back=await geometry(card);
       assert.ok(back.buttons.every(b=>b.inside),label+' back '+JSON.stringify(back));
       assert.equal(back.height,front.height,label+' keeps its paper size when flipped');
       await card.getByRole('button',{name:'翻面',exact:true}).tap();
       assert.equal(await p.locator('#memoryDetail').isVisible(),false,label+' repeated flips stay on the board');
      }
      if(width===820&&theme==='ins-dark'&&mode==='board'&&zoom===100)await p.screenshot({path:root+'/test-results/card-actions-tablet.png'});
     }
    }
   }
  }
  await memoryControl(p,'[data-memory-mode=board]');await p.locator('#memoryZoomReset').tap();
  await picture.getByRole('button',{name:'翻面',exact:true}).focus();await p.keyboard.press('Enter');
  assert.equal(await picture.evaluate(el=>el.classList.contains('flipped')),true);assert.equal(await p.locator('#memoryDetail').isVisible(),false);
  await p.keyboard.press('Enter');assert.equal(await picture.evaluate(el=>el.classList.contains('flipped')),false);
 });
 await check('at 50% both note and photo can reach the visible panel edges, outside the old central canvas',async()=>{
  await halfway();
  assert.equal(await p.locator('#memoryZoomReset').textContent(),'50%');
  for(const id of ['message:1','message:2']){
   const card=p.locator(`[data-memory-id="${id}"]`);
   for(const [x,y] of [[0,0],[1,0],[1,1],[0,1]])await corner(card,x,y);
   if(id==='message:1')await place(card,.5,.5);
  }
  await corner(picture,1,1);await corner(note,0,0);
  await p.evaluate(()=>document.fonts.ready);await p.screenshot({path:root+'/test-results/clue-half-size.png'});
 });
 await check('pinching from 50% to 113% and back preserves card positions and the full drag area',async()=>{
  const before=saved(),f=await frame(),cx=f.x+f.width/2,cy=f.y+f.height/2;
  const pinch=async(from,to)=>{
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx-from,y:cy,id:1},{x:cx+from,y:cy,id:2}]});
   for(let i=1;i<=12;i++){const d=from+(to-from)*i/12;await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx-d,y:cy,id:1},{x:cx+d,y:cy,id:2}]});}
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(100);
  };
  await pinch(60,136);assert.ok(Number(await p.locator('.clue-stage').getAttribute('data-zoom'))>=112);
  await pinch(136,59);assert.equal(await p.locator('#memoryZoomReset').textContent(),'50%');
  assert.equal(saved(),before);assert.equal(await p.locator('#memoryDetail').isVisible(),false);
  await corner(note,1,0);await corner(picture,0,1);
 });
 await check('a card follows the finger one to one after zooming and panning, and strings follow its saved position',async()=>{
  await place(note,.5,.5);
  for(let i=0;i<6;i++)await p.locator('#memoryZoomIn').tap();
  const f=await frame();await drag({x:f.x+f.width*.55,y:f.y+f.height*.8},{x:f.x+f.width*.55-45,y:f.y+f.height*.8-25});
  const before=await note.boundingBox(),from={x:before.x+before.width/2,y:before.y+50};
  await drag(from,{x:from.x+40,y:from.y-30});const after=await note.boundingBox();
  assert.ok(Math.abs(after.x-before.x-40)<2&&Math.abs(after.y-before.y+30)<2,JSON.stringify({before,after}));
  assert.ok(await p.locator('.clue-lines line').count()>0);
  const pins=await p.locator('.clue-canvas').evaluate(c=>{
   const cards=[...c.querySelectorAll('[data-memory-id]')],line=c.querySelector('line');
   return [1,2].map(n=>cards.some(el=>Math.abs(Number(line.getAttribute('x'+n))-(parseFloat(el.style.left)+el.offsetWidth/2))<1&&Math.abs(Number(line.getAttribute('y'+n))-(parseFloat(el.style.top)+3))<1));
  });assert.deepEqual(pins,[true,true]);
  await halfway();await corner(note,1,0);await corner(picture,0,1);
 });
 await check('extended positions survive navigation and reload without being clamped back into the old canvas',async()=>{
  const before=saved();assert.ok(Object.values(JSON.parse(before)).some(pos=>pos.nx<0||pos.nx>1),'saved positions extend beyond the original canvas');
  await p.locator('#sceneNavChat').tap();await p.locator('#sceneNavMemory').tap();assert.equal(saved(),before);
  await p.reload();await p.waitForFunction(()=>document.querySelector('#roomStatus').textContent.includes('左滑'));await p.locator('#sceneNavMemory').tap();await p.locator('.clue-stage').waitFor();
  assert.equal(saved(),before);
  const f=await frame();
  for(const card of [note,picture]){const b=await card.boundingBox();assert.ok(b.x>=f.x-1&&b.y>=f.y-1&&b.x+b.width<=f.x+f.width+1&&b.y+b.height<=f.y+f.height+1,'saved card is visible on reopening');}
  await halfway();await corner(note,0,0);await corner(picture,1,1);
 });
 await check('phone, portrait tablet and landscape all retain the full visible drag area at 50%',async()=>{
  for(const [width,height] of [[390,844],[820,1180],[1280,730]]){
   await p.setViewportSize({width,height});await p.waitForTimeout(160);if(width===1280)await p.locator('#sceneSidebarToggle').tap();await p.waitForTimeout(120);await halfway();
   for(const card of [note,picture]){for(const [x,y] of [[0,0],[1,0],[1,1],[0,1]])await corner(card,x,y);if(card===note)await place(card,.5,.5);}
   await corner(note,1,0);
  }
 });
 assert.deepEqual(s.errors,[]);await s.context.close();
}
