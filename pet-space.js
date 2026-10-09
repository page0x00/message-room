import {localConnections} from './local-api.js?v=2.7.5';
import {generateDirectPet} from './direct-pet.js?v=2.7.5';
import {client} from './backend.js?v=2.7.5';
import {localDate} from './core.js?v=2.7.5';

export function initPetSpace({$,state,node,toast,notice,ui}){
 const pane=node('section','space-page');pane.id='petSpace';pane.hidden=true;
 pane.innerHTML='<div class="sheet pet-space"><div class="pet-stage"><div class="pet-glow"></div><div class="pet-flame" id="petFigure" data-mood="calm"><i class="pet-eyes"></i><i class="pet-mouth"></i></div><h3 id="petName">一团小小的光</h3><p id="petLine">从你们愿意分享的日常里，慢慢长出自己的样子。</p></div><div id="petTraits" class="pet-traits"></div><p id="petProvenance" class="sheet-note"></p><div id="petMemories"></div><button id="petRefresh" class="btn">听听我们最近的故事</button><p id="petStatus" role="status" class="sheet-note"></p><button id="petAPIOpen" class="text-btn">API 与模型</button><p id="petProvider" class="sheet-note"></p><details id="petSettings"><summary>它可以记住什么</summary><p class="sheet-note">开启后，你在下方日期范围内发送的普通文字留言只会交给当前显示的渠道整理；更换域名后需重新保存授权。朋友的留言需由朋友在自己的账号开启；图片、截图摘录、转发和私人日记不包含在内。每次最多读取最近 120 条。生成内容仅自己可见，可以随时撤回授权并清除相关记忆。</p><form id="petConsentForm" class="daily-form"><label class="check-field"><input id="petEnabled" type="checkbox"/>允许记住我在这个房间的留言</label><label class="field">从这天开始<input id="petStart" type="date" required/></label><label class="field">到这天为止（留空表示今后也可）<input id="petEnd" type="date"/></label><label class="check-field"><input id="petAuto" type="checkbox"/>网页打开时自动整理新留言</label><button class="btn primary" type="submit">保存授权范围</button></form><p id="petPeers" class="sheet-note"></p><button id="petRevoke" class="text-btn">撤回授权并清除相关记忆</button></details></div>';
 $('spacePages').append(pane);ui.registerPanel('petSpace','小小陪伴');
 const entry=node('button','relation-card');entry.id='petSpaceBtn';entry.innerHTML='<span class="feature-symbol">✧</span><span><b>小小陪伴</b><small>从共同的日常里长大</small></span><i>›</i>';document.querySelector('.relation-grid').append(entry);
 const buddy=node('button','pet-buddy');buddy.id='petBuddy';buddy.hidden=true;buddy.setAttribute('aria-label','看看小宠物');buddy.innerHTML='<span class="pet-flame" data-mood="calm"><i class="pet-eyes"></i><i class="pet-mouth"></i></span>';$('room').append(buddy);
 let consent=null,pet=null,consents=[],busy=false,loading=false,epoch=0,lastAuto=0,configured=false,scope=null,directAbort=null;
 const allowed=()=>consent?.enabled&&(consent.api_scope||'https://api.openai.com')===scope;
 const snap=()=>({room:state.room,user:state.userId,epoch}),current=s=>s.room===state.room&&s.user===state.userId&&s.epoch===epoch;
 const take=r=>{if(r.error)throw r.error;return r.data;};
 async function errorText(e){try{const data=await e.context?.json();if(data?.error)return data.error;}catch{}return e.message||'暂时无法读取，请稍后重试。';}
 function render(){
  const data=pet?.data;buddy.hidden=!state.ready||!allowed()||!data;
  $('petName').textContent=data?.name||'一团小小的光';$('petLine').textContent=data?.line||'从你们愿意分享的日常里，慢慢长出自己的样子。';
  for(const el of [buddy.firstElementChild,$('petFigure')])el.dataset.mood=data?.mood||'calm';
  $('petTraits').replaceChildren(...(data?.traits||[]).map(t=>node('span','',t)));
  $('petProvenance').textContent=pet?`AI 根据 ${pet.source_count} 条授权留言整理 · ${new Date(pet.updated_at).toLocaleDateString('zh-CN')} · 第 ${pet.generations} 次相伴`:'还没有读取聊天。';
  $('petMemories').replaceChildren(...(data?.memories||[]).map(m=>{const row=node('details','pet-memory');row.append(node('summary','',m.text));const source=node('p','sheet-note');source.textContent=m.sources.map(id=>{const msg=state.messages.find(r=>String(r.id)===id);return msg?(msg.author_id===state.userId?'我':state.members.find(u=>u.user_id===msg.author_id)?.display_name||'朋友')+'：'+msg.content.slice(0,160):'较早的授权留言 #'+id;}).join('\n');row.append(source);return row;}));
  $('petRefresh').disabled=busy||!configured||!allowed();$('petRevoke').hidden=!consent?.enabled;
  $('petPeers').textContent=state.members.filter(m=>m.user_id!==state.userId).map(m=>(m.display_name||'朋友')+'：'+(consents.some(c=>c.user_id===m.user_id&&c.enabled&&(c.api_scope||'https://api.openai.com')===scope)?'已允许当前渠道整理自己的留言':'尚未允许整理自己的留言')).join(' · ');
 }
 function fields(){ $('petEnabled').checked=!!allowed();$('petAuto').checked=!!consent?.automatic;$('petStart').value=consent?.date_start||localDate(new Date(Date.now()-6*86400000));$('petEnd').value=consent?.date_end||''; }
 async function load(fill=false){if(!state.ready||!state.secure||loading)return;loading=true;const s=snap();try{
  const sb=client(true),values=await Promise.all([sb.from('pet_consents').select('*').eq('room_id',s.room),sb.from('pet_states').select('*').eq('room_id',s.room).eq('owner_user_id',s.user).maybeSingle()]);
  if(!current(s))return;consents=take(values[0])||[];consent=consents.find(c=>c.user_id===s.user)||null;pet=take(values[1]);if(fill)fields();render();
 }catch(e){if(current(s)&&!pane.hidden)$('petStatus').textContent='小宠物资料暂时无法同步，请稍后再试。';}finally{if(current(s))loading=false;}}
 async function connectionStatus(){const s=snap();try{if(localConnections.mode(state.userId)==='local'){const active=localConnections.active(state.userId);configured=!!active;scope=active?new URL(active.profile.base_url).origin:null;$('petProvider').textContent=active?'本机直连：'+active.profile.name+' · '+scope:'';return true;}const result=take(await client(true).functions.invoke('mailbox-pet',{method:'GET'}));if(!current(s))return;configured=!!result.configured;scope=result.scope||(configured?'https://api.openai.com':null);$('petProvider').textContent=configured?'当前渠道：'+(result.provider||'站点默认')+' · '+scope:'';return true;}catch{if(current(s)){configured=false;scope=null;}return false;}}
 async function open(){ui.openFeature('petSpace');if(!state.secure){$('petStatus').textContent='请在邀请房间里开启小小陪伴。';return;}const s=snap();await connectionStatus();await load(true);if(!current(s))return;$('petStatus').textContent=!configured?'AI 暂时未连接，请打开 API 与模型设置。':consent?.enabled&&!allowed()?'渠道已改变，请重新保存对当前渠道的聊天授权。':'';render();}
 $('petAPIOpen').onclick=()=>document.dispatchEvent(new Event('mailbox:api-open'));
 document.addEventListener('mailbox:api-changed',()=>{epoch++;directAbort?.abort();busy=false;loading=false;configured=false;scope=null;render();if(!pane.hidden)void open();});
 entry.onclick=()=>void open();buddy.onclick=()=>void open();
 async function generate(automatic=false){if(busy||!allowed()||!state.secure)return;const s=snap();busy=true;render();if(!automatic)$('petStatus').textContent='正在读你们允许分享的日常…';try{
  let result;if(localConnections.mode(s.user)==='local'){directAbort=new AbortController();result=await generateDirectPet({sb:client(true),user:s.user,room:s.room,signal:directAbort.signal,current:()=>current(s)});}else result=take(await client(true).functions.invoke('mailbox-pet',{body:{room:s.room}}));if(!current(s))return;configured=true;if(result.state)pet=result.state;
  $('petStatus').textContent=result.empty?'这个范围里还没有可整理的普通文字留言。':result.cached?'最近的故事已经记住了。':'又留下了一点共同的日常。';render();
 }catch(e){const text=await errorText(e);if(current(s)&&!automatic)$('petStatus').textContent=text;}finally{if(current(s)){busy=false;render();}}}
 $('petRefresh').onclick=()=>void generate();
 $('petConsentForm').onsubmit=async e=>{e.preventDefault();if(!state.secure)return;if($('petEnabled').checked&&!scope){$('petStatus').textContent='请先连接 API，再授权聊天。';return;}const s=snap(),submit=e.target.querySelector('[type=submit]');submit.disabled=true;try{const saved=take(await client(true).rpc('mailbox_pet_consent',{p_room:s.room,p_enabled:$('petEnabled').checked,p_auto:$('petAuto').checked,p_start:$('petStart').value,p_end:$('petEnd').value||null,p_scope:scope||consent?.api_scope||'https://api.openai.com'}));if(!current(s))return;consent=saved;pet=null;await load(true);$('petStatus').textContent='授权范围已保存，旧范围产生的记忆已清除。';}catch(e){if(current(s))$('petStatus').textContent=await errorText(e);}finally{submit.disabled=false;}};
 $('petRevoke').onclick=async()=>{const s=snap();if(!await notice('撤回聊天授权？','这会清除这个房间内由旧授权产生的宠物记忆；原始聊天保留。','撤回并清除',true)||!current(s))return;try{take(await client(true).rpc('mailbox_pet_consent',{p_room:s.room,p_enabled:false,p_auto:false,p_start:consent.date_start,p_end:consent.date_end,p_scope:consent.api_scope||'https://api.openai.com'}));if(current(s)){pet=null;consent=null;await load(true);$('petStatus').textContent='已停止读取并清除相关记忆。';}}catch(e){if(current(s))toast(await errorText(e));}};
 async function tick(){if(document.hidden||!state.ready||!state.secure)return;await connectionStatus();await load();if(allowed()&&consent.automatic&&Date.now()-lastAuto>300000){lastAuto=Date.now();await generate(true);}}
 setInterval(()=>void tick(),60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)void tick();});
 function reset(){epoch++;directAbort?.abort();directAbort=null;pet=null;consent=null;consents=[];busy=false;loading=false;configured=false;scope=null;lastAuto=0;buddy.hidden=true;fields();render();$('petStatus').textContent='';}
 return {reset,ready:()=>void tick()};
}
