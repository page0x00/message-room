import {storeGet,isMine,randomId,displayDay,compareCreated} from './core.js?v=2.3.0';
import {splitText} from './ocr-layout.js?v=2.3.0';
import * as api from './backend.js?v=2.3.0';
import {mediaBlob} from './feature-backend.js?v=2.3.0';

export function forwardUnits(rows,mode,name){
  const units=[];let merged=null;
  for(const row of [...rows].sort(compareCreated)){
    const label=`${name(row)} · ${displayDay(row,'diary')}`;
    if(mode==='merged'&&!row.media_path){for(const text of splitText(`${label}\n${row.content}`,4500)){
      if(!merged||merged.content.length+text.length+2>4900){merged={nonce:randomId(),content:'【合并转发】',sent:false};units.push(merged);}merged.content+='\n\n'+text;
    }}else{merged=null;const parts=splitText(`[转发 · ${label}]\n${row.content||row.media_name||'附件'}`,4900);for(let index=0;index<parts.length;index++)units.push({nonce:randomId(),content:parts[index],source:row.media_path&&index===0?row:null,sent:false});}
  }
  return units;
}
export function initMessageActions({$,state,node,toast,persist,showSheet,closeSheet,notice,author,render,setView,saveDraft,dateEditor,recentRooms,onMessages}){
  let selected=new Set(),active=false,hold=null,pressed=null,suppressId='',forwardBusy=false,job=null,removed={},favorites={};
  const key=kind=>`${kind}.${state.room}.${state.userId||state.deviceId}`;
  const list=()=>state.messages.filter(row=>selected.has(row.id));
  const storage=kind=>{const value=storeGet(key(kind),{});return value&&typeof value==='object'&&!Array.isArray(value)?value:{};};
  const clearHold=()=>{clearTimeout(hold);hold=null;pressed=null;};
  function reset(){clearHold();active=false;selected.clear();state.selecting=false;removed={};favorites={};job=null;$('selectionBar').hidden=true;$('selectionHeader').hidden=true;$('messages').classList.remove('selecting');}
  function load(){removed=storage('removed');favorites=storage('favorites');}
  function paint(){
    state.selecting=active;$('selectionBar').hidden=!active;$('selectionHeader').hidden=!active;$('composer').hidden=active||state.view!=='chat';$('quoteTray').hidden=active||!state.quotes.length||state.view!=='chat';$('messages').classList.toggle('selecting',active);
    $('selectionCount').textContent=`已选 ${selected.size} 条`;
    for(const row of $('messages').querySelectorAll('[data-message-id]')){row.classList.toggle('selected',selected.has(row.dataset.messageId));const check=row.querySelector('.message-select');if(check){check.hidden=!active;check.setAttribute('aria-pressed',String(selected.has(row.dataset.messageId)));}}
    for(const id of ['selectQuote','selectForward','selectMerge','selectFavorite','selectDelete','selectCopy'])$(id).disabled=!selected.size;
    $('selectDate').hidden=selected.size!==1||!state.secure||!isMine(list()[0]||{},state);
  }
  function enter(id){if(!state.ready)return;active=true;if(id)selected.add(id);window.getSelection()?.removeAllRanges();paint();}
  function toggle(id){selected.has(id)?selected.delete(id):selected.add(id);paint();}
  function exit(){active=false;selected.clear();paint();}
  const pane=$('messages');
  pane.addEventListener('pointerdown',event=>{
    if(event.button!==0||event.target.closest('button,a,input,textarea,select,audio,video,summary'))return;
    const row=event.target.closest('[data-message-id]');if(!row)return;clearHold();pressed={id:row.dataset.messageId,x:event.clientX,y:event.clientY};
    suppressId='';hold=setTimeout(()=>{if(!pressed)return;const id=pressed.id;clearHold();suppressId=id;enter(id);},450);
  },{passive:true});
  pane.addEventListener('pointermove',event=>{if(pressed&&Math.hypot(event.clientX-pressed.x,event.clientY-pressed.y)>10)clearHold();},{passive:true});
  for(const type of ['pointerup','pointercancel','scroll'])pane.addEventListener(type,clearHold,{passive:true});
  pane.addEventListener('contextmenu',event=>{const row=event.target.closest('[data-message-id]');if(!row||event.target.closest('input,textarea,audio,video'))return;event.preventDefault();clearHold();enter(row.dataset.messageId);});
  pane.addEventListener('click',event=>{const row=event.target.closest('[data-message-id]');if(!row||!active)return;event.preventDefault();event.stopImmediatePropagation();if(suppressId===row.dataset.messageId){suppressId='';return;}suppressId='';toggle(row.dataset.messageId);},true);
  pane.addEventListener('keydown',event=>{const row=event.target.closest('[data-message-id]');if(!row||event.target.closest('button,a,input,textarea,summary'))return;if(event.key==='F10'&&event.shiftKey||event.key==='Enter'||event.key===' '){event.preventDefault();active?toggle(row.dataset.messageId):enter(row.dataset.messageId);}});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&active&&[...document.querySelectorAll('.scrim')].every(el=>el.hidden)){event.preventDefault();exit();}});
  $('selectMessagesBtn').onclick=()=>{closeSheet('menuScrim');enter();};$('selectionCancel').onclick=exit;
  $('selectionAll').onclick=()=>{for(const el of pane.querySelectorAll('[data-message-id]'))selected.add(el.dataset.messageId);paint();};
  $('selectionInvert').onclick=()=>{for(const el of pane.querySelectorAll('[data-message-id]')){const id=el.dataset.messageId;selected.has(id)?selected.delete(id):selected.add(id);}paint();};
  $('selectQuote').onclick=()=>{if(!state.metadata){toast('引用需要先完成原有数据库迁移。');return;}if(selected.size>8){toast('一次最多引用 8 条，请减少选择；更多内容可以合并转发。');return;}state.quotes=list().sort(compareCreated).map(row=>row.id);state.draftNonce=randomId();saveDraft();exit();setView('chat');$('messageInput').focus();};
  $('selectDate').onclick=()=>{const row=list()[0];exit();if(row)dateEditor(row.id);};
  $('selectCopy').onclick=async()=>{try{await navigator.clipboard.writeText(list().map(row=>`${author(row).name}：${row.content}`).join('\n\n'));toast('已复制选中的留言。');}catch{toast('浏览器未开放剪贴板权限，请使用系统文字选择。');}};
  $('selectFavorite').onclick=()=>{const next={...favorites};for(const row of list())next[row.id]={...row,saved_name:author(row).name,saved_at:new Date().toISOString()};if(!persist(key('favorites'),next))return;favorites=next;toast(`已收藏 ${selected.size} 条，房间菜单可查看。`);exit();render();};
  $('selectDelete').onclick=async()=>{const room=state.room,epoch=state.epoch,rows=list();if(!rows.length||!await notice('从本机删除这些留言？',`将隐藏选中的 ${rows.length} 条。对方及云端原始记录保留，你可在“最近删除”恢复。`,'从本机删除',true)||state.room!==room||state.epoch!==epoch)return;const next={...removed};for(const row of rows)next[row.id]={...row,saved_name:author(row).name};if(!persist(key('removed'),next))return;removed=next;state.quotes=state.quotes.filter(id=>!removed[id]);saveDraft();exit();render();toast('已从本机删除，可在房间菜单恢复。');};
  function collection(kind){
    closeSheet('menuScrim');load();const values=kind==='favorites'?favorites:removed;const heading=kind==='favorites'?'我的收藏':'最近删除';$('collectionTitle').textContent=heading;$('collectionRows').replaceChildren();
    for(const item of Object.values(values).sort(compareCreated).reverse()){
      const card=node('article','collection-card');card.append(node('small','',`${item.saved_name||'留言'} · ${displayDay(item,'diary')}`),node('p','',item.content||item.media_name||'附件'));
      const action=node('button','text-btn',kind==='favorites'?'取消收藏':'恢复留言');action.onclick=()=>{const next={...values};delete next[item.id];if(persist(key(kind),next)){if(kind==='favorites')favorites=next;else removed=next;collection(kind);render();}};card.append(action);$('collectionRows').append(card);
    }
    if(!Object.keys(values).length)$('collectionRows').append(node('p','sheet-note','这里还没有内容。'));showSheet('collectionScrim');
  }
  $('favoritesBtn').onclick=()=>collection('favorites');$('deletedBtn').onclick=()=>collection('removed');
  function forward(mode){
    const saved=storeGet(key('forward'),null);job=saved?.units?.some(unit=>!unit.sent)?saved:null;
    if(!job){const rows=list();if(!rows.length)return;job={sourceRoom:state.room,mode,target:null,units:forwardUnits(rows,mode,row=>author(row).name)};}
    $('forwardTitle').textContent=job.mode==='merged'?'合并转发':'逐条转发';$('forwardTarget').replaceChildren();
    for(const room of recentRooms()){const option=node('option','',(room.room===state.room?'当前房间 · ':'')+(room.title||room.room));option.value=room.room;$('forwardTarget').append(option);}
    $('forwardTarget').value=job.target?.room||state.room;$('forwardTarget').disabled=Boolean(job.target);
    $('forwardNote').textContent=job.target?'上次未完成的转发已找回；已送达的不会重发。':`${job.units.length} 条待发送。合并记录可展开阅读，媒体会保留文件并单独转发。`;
    $('forwardPreview').textContent=job.units.map(unit=>unit.content).join('\n\n').slice(0,1500);$('forwardSend').disabled=forwardBusy;showSheet('forwardScrim');
  }
  $('selectForward').onclick=()=>forward('separate');$('selectMerge').onclick=()=>forward('merged');
  $('forwardSend').onclick=async()=>{
    if(forwardBusy||!job)return;const task=job,roomAtStart=state.room,epoch=state.epoch,storageKey=key('forward');
    const target=task.target||recentRooms().find(row=>row.room===$('forwardTarget').value);if(!target){toast('请选择一个已加入的房间。');return;}
    if(!target.secure&&task.units.some(unit=>unit.source)){toast('带附件的转发请选择邀请房间。');return;}
    if(task.units.some(unit=>unit.uncertain)&&!target.secure){$('forwardNote').textContent='旧版房间的发送未获确认，请先在目标房间核对，避免重复发送。';return;}
    forwardBusy=true;$('forwardSend').disabled=true;$('forwardTarget').disabled=true;
    try{
      const userId=target.secure?(await api.joinRoom(target.room,target.invite)).userId:null;
      task.target={...target};if(!persist(storageKey,task))return;
      for(const unit of task.units){
        if(unit.sent)continue;if(state.room!==roomAtStart||state.epoch!==epoch)break;
        unit.uncertain=true;if(!persist(storageKey,task))break;
        const row={room_id:target.room,content:unit.content,sender:target.secure?userId:state.deviceId,sender_name:state.profile.myName};
        if(target.secure)Object.assign(row,{author_id:userId,client_nonce:unit.nonce,message_type:'text',reply_to:[],display_date:null});
        if(unit.source){const blob=await mediaBlob(task.sourceRoom,unit.source.media_path),path=`${target.room}/${userId}/${unit.nonce}`;await api.uploadMedia(path,blob,unit.source.media_mime,n=>{$('forwardNote').textContent=`转发附件 ${Math.round(n*100)}%`;});Object.assign(row,{message_type:unit.source.message_type==='import'?'file':unit.source.message_type,media_path:path,media_name:unit.source.media_name,media_size:blob.size,media_mime:unit.source.media_mime});}
        const message=await api.sendMessage(row,target.secure);unit.sent=true;unit.uncertain=false;persist(storageKey,task);if(target.room===state.room)onMessages([message]);$('forwardNote').textContent=`已转发 ${task.units.filter(u=>u.sent).length} / ${task.units.length} 条`;
      }
      if(task.units.every(unit=>unit.sent)){persist(storageKey,null);job=null;closeSheet('forwardScrim');exit();toast('转发完成。');}
    }catch{$('forwardNote').textContent='转发暂未完成，已保留进度；再次确认只重试未完成的部分。';}
    finally{forwardBusy=false;$('forwardSend').disabled=false;}
  };
  return {reset,load,hidden:id=>Boolean(removed[id]),rendered:paint,decorate(row,message){
    row.querySelector('.bubble').tabIndex=0;row.querySelector('.bubble').setAttribute('aria-label','留言，长按或按 Enter 选择');const select=node('button','message-select','✓');select.type='button';select.hidden=!active;select.setAttribute('aria-label','选择这条留言');select.setAttribute('aria-pressed',String(selected.has(message.id)));row.prepend(select);if(favorites[message.id])row.querySelector('.meta')?.append(node('span','favorite-mark','已收藏'));
  }};
}
