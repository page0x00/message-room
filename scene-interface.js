/* The landscape skins use the same mounted conversation and feature controllers. */
export function initSceneInterface({$,node}){
 const masthead=node('header','scene-masthead');
 masthead.innerHTML='<div><span class="scene-kicker">STRAY BIRDS · 飞鸟集</span><p class="scene-rain-title">等雨停下</p><p class="scene-verse">群星不怕显得像萤火那样。</p></div><div class="scene-clock"><time></time><small></small></div>';
 $('chatColumn').prepend(masthead);
 const rail=node('nav','scene-rail');rail.setAttribute('aria-label','空间快捷入口');
 const destinations=[['▤','日记','[data-open-view="diary"]'],['▧','回忆墙','[data-open-view="wall"]'],['♫','一起听','#listenBtn'],['✓','待办','#todoSpaceBtn'],['◡','荷包','#pocketSpaceBtn'],['▥','回忆胶片','#filmSpaceBtn']];
 function open(selector){document.querySelector(selector)?.click();}
 for(const [icon,label,selector] of destinations){const b=node('button');b.type='button';b.append(node('span','',icon),node('span','',label));b.onclick=()=>open(selector);rail.append(b);}
 document.querySelector('.home-head').after(rail);
 const shortcuts=node('nav','scene-shortcuts');shortcuts.setAttribute('aria-label','留住日常');
 for(const [icon,label,caption,selector,target] of [['▧','回忆墙','所有重要的瞬间','[data-open-view="wall"]','wall'],['▥','回忆胶片','把时光重新放映','#filmSpaceBtn','film'],['✓','一起打卡','一点一点往前走','#checkinSpaceBtn','checkin'],['◇','共同活动','书、课程与故事','#activitySpaceBtn','activity']]){
  const b=node('button');b.type='button';b.dataset.sceneTarget=target;b.append(node('span','scene-shortcut-icon',icon),node('b','',label),node('small','',caption));b.onclick=()=>open(selector);shortcuts.append(b);
 }
 $('chatColumn').append(shortcuts);
 const dock=node('aside','scene-dock');dock.setAttribute('aria-label','今日与旋律');
 dock.innerHTML='<section class="scene-music"><div class="scene-widget-head"><span>一起听</span><button id="sceneMusicOpen" aria-label="打开一起听">↗</button></div><div class="scene-small-record" aria-hidden="true"><i></i></div><h3 id="sceneTrack">留一首歌的时间</h3><p id="sceneArtist">选择一首本机音乐</p><div class="scene-music-controls"><button id="scenePrevious" aria-label="上一首">│◀</button><button id="scenePlay">播放</button><button id="sceneNext" aria-label="下一首">▶│</button></div></section><section class="scene-todos"><div class="scene-widget-head"><span>今天的小事</span><button id="sceneTodoOpen" aria-label="打开全部待办">↗</button></div><div id="sceneTodoList"></div></section><p class="scene-footer-verse">The stars are not afraid<br>to appear like fireflies.<small>Tagore · Stray Birds, 48</small></p>';
 $('chatColumn').after(dock);
 $('sceneMusicOpen').onclick=()=>open('#listenBtn');$('sceneTodoOpen').onclick=()=>open('#todoSpaceBtn');
 $('scenePlay').onclick=()=>{if($('listenToggle').disabled)open('#listenBtn');else $('listenToggle').click();};
 $('scenePrevious').onclick=()=>open('#musicPrev');$('sceneNext').onclick=()=>open('#musicNext');
 function music(){
  const loaded=!$('listenToggle').disabled;
  $('sceneTrack').textContent=loaded?$('trackName').textContent:'留一首歌的时间';
  $('sceneArtist').textContent=loaded?$('trackArtist').textContent||'同一首歌，慢慢听。':'选择一首本机音乐';
  $('scenePlay').textContent=loaded?$('listenToggle').textContent:'选一首歌';
  $('scenePrevious').disabled=$('sceneNext').disabled=!loaded;
  dock.classList.toggle('is-playing',loaded&&!$('listenAudio').paused);
 }
 document.addEventListener('mailbox:music-render',music);
 function todos(){
  const list=$('sceneTodoList');list.replaceChildren();
  const rows=[...document.querySelectorAll('#todoSpace .daily-row')];
  for(const row of rows.filter(r=>!r.classList.contains('is-done')).slice(0,4)){
   const checkbox=row.querySelector('input[type=checkbox]'),b=node('button','scene-todo');
   b.append(node('span','scene-check',''),node('span','',row.querySelector('h4')?.textContent||''));
   b.disabled=!!checkbox?.disabled;b.setAttribute('aria-label','完成待办：'+b.textContent);b.onclick=()=>{if(checkbox?.isConnected)checkbox.click();};list.append(b);
  }
  if(!list.children.length){const b=node('button','scene-todo-empty',rows.length?'今天的事都完成了。':'写下一件想一起做的小事');b.onclick=()=>open('#todoSpaceBtn');list.append(b);}
 }
 document.addEventListener('mailbox:daily-render',todos);
 function clock(){const now=new Date();masthead.querySelector('time').textContent=now.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});masthead.querySelector('time').dateTime=now.toISOString();masthead.querySelector('.scene-clock small').textContent=now.toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'short'});}
 clock();music();todos();setInterval(clock,60000);
}
