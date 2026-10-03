import {storeGet, storeSet, localDate, randomId} from './core.js?v=2.5.1';
export const THEMES=['ins-light','ins-dark','warm-light','warm-dark','rain-night','moon-glass'];
export function setTheme(value){
  value=({clean:'ins-light',warm:'warm-light'})[value]||value;
  const theme=THEMES.includes(value)?value:'ins-light';
  document.documentElement.dataset.theme=theme;storeSet('theme',theme);
  document.querySelector('meta[name=theme-color]').content={'ins-light':'#fdfdfb','ins-dark':'#20242b','warm-light':'#fff8f0','warm-dark':'#2d2522','rain-night':'#101e2b','moon-glass':'#111a2c'}[theme];
  document.querySelectorAll('[data-theme-pick]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.themePick===theme)));
  const quote=document.querySelector('.home-art .handwriting');if(quote)quote.textContent=['rain-night','moon-glass'].includes(theme)?'群星不怕显得\n像萤火那样。':'生如夏花，\n死如秋叶。';
  if(quote)quote.title=['rain-night','moon-glass'].includes(theme)?'泰戈尔《飞鸟集》第 48 则 · 据英文自译':'泰戈尔《飞鸟集》第 82 则 · 据英文自译';
}
export function contactTarget(value){
  value=String(value||'').trim();
  if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))return 'mailto:'+value;
  try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}
}
export function initInterface({$,state,node,toast,persist,showSheet,closeSheet,setView,renderRecent,home}){
  let previousFocus, start;
  const compact=()=>matchMedia('(max-width:699px), (max-height:500px)').matches;
  const panels=()=>[...$('spacePages').querySelectorAll(':scope > [data-space-panel]')];
  function registerPanel(id,title){
    const panel=$(id);panel.classList.remove('scrim');panel.classList.add('space-page');panel.dataset.spacePanel=title;panel.hidden=true;
    panel.onclick=null;
    const sheet=panel.querySelector('.sheet');if(sheet){sheet.removeAttribute('aria-modal');sheet.setAttribute('role','region');}
    $('spacePages').append(panel);
  }
  for(const [id,title] of [['relationshipScrim','纪念日'],['listenScrim','一起听'],['memoirScrim','私人回忆录']])registerPanel(id,title);
  $('diaryTools').append($('viewHeading'),$('diaryFilters'));
  $('viewHeading').hidden=false;$('diaryFilters').hidden=false;$('returnChat').hidden=true;
  function page(id='home'){
    const panel=id==='home'?null:$(id);if(id!=='home'&&!panel?.dataset.spacePanel)return;
    panels().forEach(el=>el.hidden=el!==panel);
    if(id!=='diarySpace')$('diaryEntries').replaceChildren();if(id!=='wallSpace')$('wallEntries').replaceChildren();
    $('spaceHome').hidden=!!panel;$('spacePages').hidden=!panel;$('spaceBack').hidden=!panel;
    $('spaceTitle').textContent=panel?.dataset.spacePanel||'我们的空间';
    state.spaceView=id==='diarySpace'?'diary':id==='wallSpace'?'wall':null;
    state.spacePanel=id;
    $('spacePages').scrollTop=0;
    document.dispatchEvent(new CustomEvent('mailbox:space-page',{detail:{panel:id}}));
  }
  function drawer(open){
    if(open&&!state.room)return;
    $('room').classList.toggle('space-open',open);$('relationSpace').classList.toggle('open',open);$('relationSpace').inert=!open;
    $('relationSpace').setAttribute('aria-hidden',String(!open));$('relationHandle').setAttribute('aria-expanded',String(open));$('relationBackdrop').hidden=!open||!compact();
    if(open){if(!previousFocus)previousFocus=document.activeElement;$('relationClose').focus();document.dispatchEvent(new Event('mailbox:space-open'));}
    else{page();document.dispatchEvent(new Event('mailbox:space-close'));if(previousFocus?.isConnected)previousFocus.focus();previousFocus=null;}
  }
  function openFeature(id){page(id);drawer(true);}
  $('spaceBack').onclick=()=>page();
  matchMedia('(min-width:700px) and (min-height:501px)').addEventListener('change',()=>{$('relationBackdrop').hidden=$('relationSpace').inert||!compact();});
  function settings(){drawer(false);closeSheet('menuScrim');showSheet('settingsScrim');document.dispatchEvent(new Event('mailbox:settings-open'));}
  for(const id of ['themeBtn','themeMenuBtn','homeSettings','spaceSettings','notifyMenuBtn'])$(id).onclick=settings;
  document.querySelectorAll('[data-theme-pick]').forEach(button=>button.onclick=()=>setTheme(button.dataset.themePick));
  $('relationHandle').onclick=()=>drawer(true);$('relationClose').onclick=()=>drawer(false);$('relationBackdrop').onclick=()=>drawer(false);
  document.querySelectorAll('[data-open-view]').forEach(button=>button.onclick=()=>setView(button.dataset.openView));
  $('returnChat').onclick=()=>setView('chat');$('writeFromView').onclick=()=>{drawer(false);document.dispatchEvent(new Event('mailbox:show-chat'));$('messageInput').focus();};
  $('backBtn').onclick=()=>state.view==='chat'?home():setView('chat');
  const pane=$('messages');
  pane.addEventListener('touchstart',event=>{start=null;if(event.touches.length!==1||state.selecting||state.view!=='chat'||event.target.closest('button,input,textarea,audio,video,a'))return;start={x:event.touches[0].clientX,y:event.touches[0].clientY,t:Date.now()};},{passive:true});
  pane.addEventListener('touchcancel',()=>start=null,{passive:true});
  pane.addEventListener('touchend',event=>{const from=start;start=null;const end=event.changedTouches[0];if(!from||!end||state.selecting||window.getSelection()?.isCollapsed===false)return;if(end.clientX-from.x<-85&&Math.abs(end.clientY-from.y)<35&&Date.now()-from.t<600)drawer(true);},{passive:true});
  document.addEventListener('keydown',event=>{
    if($('relationSpace').inert)return;
    if(event.key==='Escape'){if(document.querySelector('.scrim:not([hidden])'))return;if(state.spacePanel&&state.spacePanel!=='home')page();else drawer(false);return;}
    if(event.key==='Tab'&&compact()){const controls=[...$('relationSpace').querySelectorAll('button,input,textarea,select,a[href]')].filter(b=>!b.disabled&&b.getClientRects().length);if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls.at(-1).focus();}else if(!event.shiftKey&&document.activeElement===controls.at(-1)){event.preventDefault();controls[0].focus();}}
  });
  $('addRoomBtn').onclick=()=>showSheet('addRoomScrim');$('composeMore').onclick=()=>showSheet('composeScrim');
  $('recordMenuBtn').onclick=()=>{closeSheet('composeScrim');$('attachBtn').click();};
  for(const id of ['dateBtn','importBtn'])$(id).addEventListener('click',()=>closeSheet('composeScrim'));
  $('roomSearch').oninput=renderRecent;
  document.querySelectorAll('[data-room-filter]').forEach(button=>button.onclick=()=>{state.roomFilter=button.dataset.roomFilter;document.querySelectorAll('[data-room-filter]').forEach(b=>b.classList.toggle('active',b===button));renderRecent();});
  document.querySelectorAll('[data-diary-filter]').forEach(button=>button.onclick=()=>{state.diaryFilter=button.dataset.diaryFilter;document.querySelectorAll('[data-diary-filter]').forEach(b=>b.classList.toggle('active',b===button));setView(state.spaceView||'diary');});
  $('diaryDate').onchange=()=>setView(state.spaceView||'diary');
  function contacts(){
    const rows=storeGet('contacts',[]);$('contactList').replaceChildren();
    if(!Array.isArray(rows))return;
    const query=$('roomSearch').value.toLowerCase();
    for(const row of rows){const href=contactTarget(row.address);if(!href||![row.name,row.address].join(' ').toLowerCase().includes(query))continue;
      const card=node('div','contact-card'),link=node('a','',row.name);link.href=href;if(!href.startsWith('mailto:')){link.target='_blank';link.rel='noopener noreferrer';}link.append(node('small','',row.address));
      const remove=node('button','','×');remove.setAttribute('aria-label','移除 '+row.name);remove.onclick=()=>{persist('contacts',rows.filter(x=>x.id!==row.id));contacts();};card.append(link,remove);$('contactList').append(card);
    }
  }
  $('contactForm').onsubmit=event=>{event.preventDefault();const address=$('contactAddress').value.trim(),name=$('contactName').value.trim();if(!contactTarget(address)){toast('请输入 http(s) 网址或有效邮箱。');return;}const old=storeGet('contacts',[]);if(!persist('contacts',[{id:randomId(),address,name},...(Array.isArray(old)?old:[]).filter(c=>c.address!==address)].slice(0,100)))return;$('contactForm').reset();closeSheet('addRoomScrim');contacts();toast('联系方式已留下。');};
  $('roomSearch').addEventListener('input',contacts);
  let previous;try{previous=localStorage.getItem('theme.v2');}catch{}
  const savedTheme=storeGet('theme',null);
  setTheme(THEMES.includes(savedTheme)?savedTheme:previous||savedTheme||'ins-light');
  const copies=['今天也辛苦了。\n把想说的话，慢慢留在这里。','把普通的一天，\n留成可以重读的一页。','有些瞬间很轻，\n但我们会记得。','等你有空，\n再拆开这封信。','天色慢下来，\n我们也可以。','今天的风，\n也想分给你一点。','见字如面。\n有空再接着聊。','一首歌的时间，\n刚好留给想念。','不用写成故事，\n小事也值得记录。','晚一点抵达，\n也没有关系。'];
  const day=localDate();$('dailyCopy').textContent=copies[Math.floor(Date.parse(day+'T00:00:00Z')/86400000)%copies.length];contacts();
  return {drawer,settings,openFeature,page,registerPanel};
}
