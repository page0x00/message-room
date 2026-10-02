// Notification-only worker. Never cache HTML, source, private messages or media.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
function destination(room){const url=new URL(self.registration.scope);if(/^[A-Za-z0-9_-]{4,100}$/.test(room||''))url.searchParams.set('room',room);return url.href;}
const labels={goal:'今天还有一个打卡目标',todo:'有一项待办到期了',anniversary:'今天是一个值得记住的日子',pocket:'今天的存款记录还未完成',withdraw:'取出冷静期已结束，请再次确认',listen:'朋友邀请你一起听歌'};
self.addEventListener('push',event=>{
  let payload={};try{payload=event.data?.json()||{};}catch{}
  const room=String(payload.room||''),id=String(payload.id||'new').slice(0,100),kind=Object.hasOwn(labels,payload.kind)?payload.kind:'message';
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows)if(client.url.startsWith(self.registration.scope))client.postMessage({type:'mailbox-push',room});
    await self.registration.showNotification('小小留言室',{body:labels[kind]||'你有一条新留言',tag:'mailbox-'+room+'-'+id,icon:new URL('assets/icon.svg',self.registration.scope).href,data:{room,kind},renotify:false});
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();let url=destination(event.notification.data?.room);const kind=event.notification.data?.kind;if(Object.hasOwn(labels,kind)){const next=new URL(url);next.searchParams.set('notice',kind);url=next.href;}
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=windows.find(client=>client.url.startsWith(self.registration.scope));
    if(existing){await existing.navigate(url);return existing.focus();}return self.clients.openWindow(url);
  })());
});
