import {storeGet,storeSet,isMine,compareCreated,normalizeMessage,roomLink,errorText} from './core.js?v=2.2.0';
import {client,loadMessages} from './backend.js?v=2.2.0';
export function newRows(rows,cursor,identity){return rows.map(normalizeMessage).filter(row=>!isMine(row,identity)&&cursor&&compareCreated(row,cursor)>0);}
export function initNotifications({$,state,toast,persist,recentRooms,renderRecent}){
  let channels=[],generation=0,identity='',audioContext,registration,pollBusy=false;
  const preferences={inApp:true,sound:false,system:false,...storeGet('notifications',{})};
  const record=room=>storeGet('notice.'+room,{cursor:null,unread:0});
  const unread=room=>Number(record(room).unread)||0;
  const active=room=>room===state.room&&state.ready&&state.view==='chat'&&!document.hidden&&$('messages').scrollHeight-$('messages').scrollTop-$('messages').clientHeight<100&&$('relationSpace').inert;
  const status=text=>$('notificationStatus').textContent=text;
  async function worker(){
    if(!('serviceWorker' in navigator))throw new Error('这个浏览器没有开放后台通知，可继续使用网页内提示。');
    registration ||= navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).catch(e=>{registration=null;throw e;});
    await registration;
    return Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('通知组件暂未就绪，请稍后重试。')),10000))]);
  }
  function badge(){
    const total=recentRooms().reduce((sum,row)=>sum+unread(row.room),0);document.title=total?`(${total>99?'99+':total}) 小小留言室`:'小小留言室';
    if(navigator.setAppBadge){const task=total?navigator.setAppBadge(total):navigator.clearAppBadge();task?.catch(()=>{});}
    renderRecent();
  }
  function read(room){if(!room)return;const saved=record(room);if(!saved.unread)return;saved.unread=0;storeSet('notice.'+room,saved);badge();}
  function prime(room,rows){
    const newest=[...rows].sort(compareCreated).at(-1);const saved=record(room);
    if(newest&&(!saved.cursor||compareCreated(newest,saved.cursor)>0))saved.cursor={id:String(newest.id),created_at:newest.created_at};
    saved.unread=0;storeSet('notice.'+room,saved);badge();
  }
  function beep(){
    if(!preferences.sound||!audioContext||audioContext.state!=='running')return;
    const oscillator=audioContext.createOscillator(),gain=audioContext.createGain();oscillator.connect(gain);gain.connect(audioContext.destination);const time=audioContext.currentTime;oscillator.type='sine';oscillator.frequency.setValueAtTime(660,time);oscillator.frequency.setValueAtTime(880,time+.1);gain.gain.setValueAtTime(.035,time);gain.gain.exponentialRampToValueAtTime(.001,time+.32);oscillator.start(time);oscillator.stop(time+.34);
  }
  async function systemNotice(room,id){
    if(!preferences.system||!('Notification' in window)||Notification.permission!=='granted'||(!document.hidden&&room===state.room))return;
    // Push supplies the system notification when subscribed; avoid a second local one.
    if(storeGet('push.'+room,null))return;
    const options={body:'你有一条新留言',tag:'mailbox-'+room+'-'+id,icon:'./assets/icon-192.png',data:{room},renotify:false};
    try{const sw=await worker();await sw.showNotification('小小留言室',options);}catch{try{const notice=new Notification('小小留言室',options);notice.onclick=()=>{window.focus();location.href=roomLink(location.href,room,recentRooms().find(r=>r.room===room)?.invite||'');};}catch{/* In-app notification remains available. */}}
  }
  function ingest(room,rows,{silent=false}={}){
    if(!rows.length)return;
    const saved=record(room),sorted=rows.map(normalizeMessage).sort(compareCreated),newest=sorted.at(-1);
    const incoming=newRows(sorted,saved.cursor,{userId:state.userId||identity,deviceId:state.deviceId});
    if(!saved.cursor||compareCreated(newest,saved.cursor)>0)saved.cursor={id:newest.id,created_at:newest.created_at};
    if(incoming.length&&!active(room))saved.unread=Math.min(9999,(saved.unread||0)+incoming.length);
    storeSet('notice.'+room,saved);
    const records=recentRooms(),recent=records.find(r=>r.room===room);
    if(recent&&(!recent.lastAt||Date.parse(newest.created_at)>=Date.parse(recent.lastAt))){recent.lastAt=newest.created_at;recent.preview=newest.content||newest.media_name||'新留言';persist('recent',records);}
    badge();
    if(incoming.length&&!silent){if(preferences.inApp)toast(`${recent?.title||'留言室'} · 收到${incoming.length>1?incoming.length+'条':'一条'}新留言`);beep();void systemNotice(room,incoming.at(-1).id);}
  }
  async function poll(){
    if(pollBusy||!navigator.onLine||document.hidden)return;pollBusy=true;
    try{for(const room of recentRooms()){
      if(room.room===state.room||room.secure&&!identity)continue;
      try{const page=await loadMessages(room.room,room.secure);ingest(room.room,page.rows);}catch{/* Room errors are surfaced when the room is opened. */}
    }}finally{pollBusy=false;}
  }
  async function watch(){
    const revision=++generation;for(const [sb,channel] of channels)void sb.removeChannel(channel);channels=[];
    try{identity=(await client(true).auth.getSession()).data.session?.user.id||'';}catch{identity='';}
    if(revision!==generation)return;
    for(const secure of [false,true]){
      if(secure&&!identity)continue;
      const rooms=recentRooms().filter(r=>Boolean(r.secure)===secure);if(!rooms.length)continue;
      const sb=client(secure);let channel=sb.channel('mailbox-inbox-'+secure+'-'+crypto.randomUUID());
      for(const room of rooms)channel=channel.on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:'room_id=eq.'+room.room},payload=>{if(revision===generation)ingest(room.room,[payload.new]);});
      channel.subscribe();channels.push([sb,channel]);
    }
    void poll();
  }
  $('inAppNotify').checked=preferences.inApp;$('soundNotify').checked=preferences.sound;
  $('inAppNotify').onchange=()=>{preferences.inApp=$('inAppNotify').checked;persist('notifications',preferences);};
  function unlockAudio(){if(!preferences.sound)return;try{audioContext||=new (window.AudioContext||window.webkitAudioContext)();void audioContext.resume();}catch{}}
  $('soundNotify').onchange=()=>{preferences.sound=$('soundNotify').checked;persist('notifications',preferences);unlockAudio();beep();};document.addEventListener('pointerdown',unlockAudio,{passive:true});
  async function permission(){
    if(!('Notification' in window))throw new Error('当前浏览器不支持系统通知，网页内提示仍可用。');
    const result=await Notification.requestPermission();
    if(result!=='granted')throw new Error(result==='denied'?'通知权限已被拒绝，请到浏览器网站设置里调整。':'没有开启系统通知，网页内提示仍可用。');
    preferences.system=true;persist('notifications',preferences);return worker();
  }
  $('notifyBtn').onclick=async()=>{try{await permission();status('系统通知已开启。网页保持打开时可提示新留言；离线推送需另行开启。');}catch(e){status(e.message);}};
  function pushStatus(){const enabled=state.room&&storeGet('push.'+state.room,null);$('pushOffBtn').hidden=!enabled;$('pushBtn').disabled=!state.secure||!state.ready;$('pushBtn').textContent=enabled?'检查 / 更新离线推送':'开启当前房间离线推送';}
  $('pushBtn').onclick=async()=>{
    if(!state.secure||!state.ready){status('请先打开邀请房间，再为它开启离线推送。');return;}
    const room=state.room,userId=state.userId;$('pushBtn').disabled=true;
    try{
      const sw=await permission();if(!sw.pushManager)throw new Error('当前环境未开放 Push API，可尝试系统浏览器或添加到主屏幕后打开。');
      const config=await client(true).functions.invoke('mailbox-push',{method:'GET'});
      if(config.error||!config.data?.publicKey)throw new Error('离线推送服务尚未配置。系统通知和网页内提示可以先使用。');
      const raw=atob(config.data.publicKey.replace(/-/g,'+').replace(/_/g,'/'));const key=Uint8Array.from(raw,c=>c.charCodeAt(0));
      let subscription=await sw.pushManager.getSubscription();
      if(subscription?.options.applicationServerKey){const existing=new Uint8Array(subscription.options.applicationServerKey);if(existing.length!==key.length||existing.some((v,i)=>v!==key[i]))throw new Error('推送公钥已更换。请先在浏览器设置中重置本网站通知订阅，再重新开启。');}
      subscription ||= await sw.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
      const value=subscription.toJSON();
      if(room!==state.room||userId!==state.userId)return;
      const result=await client(true).from('push_subscriptions').upsert({room_id:room,user_id:userId,endpoint:value.endpoint,p256dh:value.keys.p256dh,auth:value.keys.auth},{onConflict:'user_id,room_id,endpoint'});
      if(result.error)throw new Error(errorText(result.error));
      persist('push.'+room,{endpoint:value.endpoint,userId});status('当前房间已订阅离线推送。系统通知不会展示留言正文。');
    }catch(e){status(e.message||'订阅失败，请重试。');}finally{pushStatus();}
  };
  $('pushOffBtn').onclick=async()=>{const room=state.room,saved=storeGet('push.'+room,null);if(!saved)return;try{const result=await client(true).from('push_subscriptions').delete().eq('room_id',room).eq('user_id',saved.userId).eq('endpoint',saved.endpoint);if(result.error)throw result.error;persist('push.'+room,null);status('已关闭这个房间的离线推送。');pushStatus();}catch(e){status(errorText(e));}};
  document.addEventListener('mailbox:settings-open',pushStatus);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(active(state.room))read(state.room);void poll();}});
  window.addEventListener('storage',event=>{if(event.key?.startsWith('mailbox.notice.'))badge();});
  setInterval(()=>void poll(),60000);
  if('serviceWorker' in navigator){void worker().catch(()=>{});navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='mailbox-push')void poll();});}
  return {prime,ingest,read,unread,watch};
}
