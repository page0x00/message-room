// Notification-only worker. Never cache HTML, source, private messages or media.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
function destination(room){const url=new URL(self.registration.scope);if(/^[A-Za-z0-9_-]{4,100}$/.test(room||''))url.searchParams.set('room',room);return url.href;}
self.addEventListener('push',event=>{
  let payload={};try{payload=event.data?.json()||{};}catch{}
  const room=String(payload.room||''),id=String(payload.id||'new').slice(0,100);
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows)if(client.url.startsWith(self.registration.scope))client.postMessage({type:'mailbox-push',room});
    await self.registration.showNotification('小小留言室',{body:'你有一条新留言',tag:'mailbox-'+room+'-'+id,icon:new URL('assets/icon.svg',self.registration.scope).href,data:{room},renotify:false});
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();const url=destination(event.notification.data?.room);
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=windows.find(client=>client.url.startsWith(self.registration.scope));
    if(existing){await existing.navigate(url);return existing.focus();}return self.clients.openWindow(url);
  })());
});
