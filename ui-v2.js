import {applyPoetry} from './poetry.js?v=2.7.6';
import {storeGet, storeSet, localDate, randomId} from './core.js?v=2.7.6';
export const THEMES=['ins-light','ins-dark','warm-light','warm-dark','rain-night','moon-glass'];
export function setTheme(value){
  value=({clean:'ins-light',warm:'warm-light'})[value]||value;
  const theme=THEMES.includes(value)?value:'ins-light';
  document.documentElement.dataset.theme=theme;storeSet('theme',theme);
  document.querySelector('meta[name=theme-color]').content={'ins-light':'#fdfdfb','ins-dark':'#20242b','warm-light':'#fff8f0','warm-dark':'#2d2522','rain-night':'#101e2b','moon-glass':'#111a2c'}[theme];
  document.querySelectorAll('[data-theme-pick]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.themePick===theme)));

}
export function contactTarget(value){
  value=String(value||'').trim();
  if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))return 'mailto:'+value;
  try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}
}
export function initInterface({$,state,node,toast,persist,showSheet,closeSheet,setView,renderRecent,home}){
  let previousFocus, start;
  const pageOffsets=new Map();
  const scrollPane=id=>$(id==='home'?'spaceHome':'spacePages');
  document.addEventListener('mailbox:room-open',()=>pageOffsets.clear());
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
  function syncFocus(){
    const focused=!$('relationSpace').inert;
    $('room').classList.toggle('feature-focus',focused);
    for(const selector of ['.scene-hero','.scene-dock','.scene-shortcuts','.scene-dream']){const el=document.querySelector(selector);if(el)el.inert=focused;}
    if($('chatColumn'))$('chatColumn').inert=focused||state.sceneView!=='chat';
  }
  function page(id='home'){
    const panel=id==='home'?null:$(id);if(id!=='home'&&!panel?.dataset.spacePanel)return false;
    if(state.spacePanel===id){if(panel&&!$('relationSpace').inert)panel.hidden=false;return false;}
    if(state.spacePanel&&!$('relationSpace').inert)pageOffsets.set(state.spacePanel,scrollPane(state.spacePanel).scrollTop);
    panels().forEach(el=>el.hidden=el!==panel);
    $('spaceHome').hidden=!!panel;$('spacePages').hidden=!panel;$('spaceBack').hidden=!panel;
    $('spaceTitle').textContent=panel?.dataset.spacePanel||'我们的空间';
    state.spaceView=id==='diarySpace'?'diary':id==='wallSpace'?'wall':null;
    const previous=state.spacePanel;state.spacePanel=id;syncFocus();
    document.dispatchEvent(new CustomEvent('mailbox:space-page',{detail:{panel:id,previous}}));
    scrollPane(id).scrollTop=pageOffsets.get(id)||0;
    return true;
  }
  function drawer(open){
    if(open&&!state.room&&state.spacePanel&& !['home','apiSettingsScrim'].includes(state.spacePanel))return;
    if(open===!$('relationSpace').inert)return;
    const restoreFocus=!open&&$('relationSpace').contains(document.activeElement);
    if(open&&!state.spacePanel)page();
    if(!open&&state.spacePanel)pageOffsets.set(state.spacePanel,scrollPane(state.spacePanel).scrollTop);
    panels().forEach(el=>el.hidden=!open||el.id!==state.spacePanel);
    $('room').classList.toggle('space-open',open);$('relationSpace').classList.toggle('open',open);$('relationSpace').inert=!open;
    state.spaceView=open?(state.spacePanel==='diarySpace'?'diary':state.spacePanel==='wallSpace'?'wall':null):null;
    syncFocus();$('relationSpace').setAttribute('aria-hidden',String(!open));$('relationHandle').setAttribute('aria-expanded',String(open));$('relationBackdrop').hidden=true;
    if(open){previousFocus=document.activeElement;document.dispatchEvent(new Event('mailbox:space-open'));scrollPane(state.spacePanel).scrollTop=pageOffsets.get(state.spacePanel)||0;}
    else{document.dispatchEvent(new Event('mailbox:space-close'));if(restoreFocus&&previousFocus?.isConnected&&!previousFocus.closest('[inert]'))previousFocus.focus({preventScroll:true});previousFocus=null;}
  }
  function openFeature(id){
    if(!state.room&&id!=='apiSettingsScrim'){document.dispatchEvent(new CustomEvent('mailbox:room-required',{detail:{panel:id}}));return;}
    document.dispatchEvent(new Event('mailbox:navigation'));
    const wasOpen=!$('relationSpace').inert,changed=page(id);
    drawer(true);
    if(wasOpen&&changed)document.dispatchEvent(new Event('mailbox:space-open'));
  }
  $('spaceBack').onclick=()=>page();
  function settings(){if(!$('menuScrim').hidden)closeSheet('menuScrim');showSheet('settingsScrim');document.dispatchEvent(new Event('mailbox:settings-open'));}
  for(const id of ['themeMenuBtn','homeSettings','spaceSettings','notifyMenuBtn'])$(id).onclick=settings;
  document.querySelectorAll('[data-theme-pick]').forEach(button=>button.onclick=()=>setTheme(button.dataset.themePick));
  $('relationHandle').onclick=()=>{page();drawer(true);};$('relationClose').onclick=()=>drawer(false);$('relationBackdrop').onclick=()=>drawer(false);
  document.querySelectorAll('[data-open-view]').forEach(button=>button.onclick=()=>setView(button.dataset.openView));
  $('returnChat').onclick=()=>setView('chat');$('writeFromView').onclick=()=>{drawer(false);document.dispatchEvent(new Event('mailbox:show-chat'));$('messageInput').focus();};
  $('backBtn').onclick=()=>state.view==='chat'?home():setView('chat');
  const pane=$('messages');
  pane.addEventListener('touchstart',event=>{start=null;if(event.touches.length!==1||state.selecting||state.view!=='chat'||state.sceneView!=='chat'||!$('relationSpace').inert||document.querySelector('.scrim:not([hidden])')||event.target.closest('button,input,textarea,audio,video,a'))return;start={x:event.touches[0].clientX,y:event.touches[0].clientY,t:Date.now()};},{passive:true});
  pane.addEventListener('touchcancel',()=>start=null,{passive:true});
  pane.addEventListener('touchend',event=>{const from=start;start=null;const end=event.changedTouches[0];if(!from||!end||state.selecting||window.getSelection()?.isCollapsed===false)return;if(end.clientX-from.x<-85&&Math.abs(end.clientY-from.y)<35&&Date.now()-from.t<600){page();drawer(true);}},{passive:true});
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented||$('relationSpace').inert)return;
    if(event.key==='Escape'){if(document.querySelector('.scrim:not([hidden])'))return;event.preventDefault();event.stopImmediatePropagation();if(state.spacePanel&&state.spacePanel!=='home')page();else drawer(false);return;}
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
  // The head script already resolved storage and legacy theme names before paint.
  // Reuse that choice rather than resolving it differently after modules load.
  setTheme(document.documentElement.dataset.theme);
  applyPoetry();contacts();
  return {drawer,settings,openFeature,page,registerPanel};
}
