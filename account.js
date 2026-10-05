import {client,joinedRooms} from './backend.js?v=2.7.0';
import {errorText,storeGet,storeSet} from './core.js?v=2.7.0';

// Auth is the only source of identity; browser storage is only a cache of profiles.
export function initAccount({$,state,node,toast,showSheet,closeSheet,onIdentity,onRooms}) {
  let user=null,otpType='email',email='',busy=false,observed;
  const sheet=node('div','scrim');sheet.id='accountScrim';sheet.hidden=true;
  sheet.innerHTML=`<section class="sheet feature-sheet account-sheet" role="dialog" aria-modal="true" aria-labelledby="accountTitle">
    <header class="sheet-head"><h2 id="accountTitle">同一个你，每一台设备</h2><button type="button" data-close="accountScrim" aria-label="关闭">×</button></header>
    <p class="sheet-note" id="accountIdentity"></p><p class="sheet-note" id="accountHint"></p>
    <form id="accountEmailForm"><label class="field"><span>邮箱</span><input id="accountEmail" type="email" autocomplete="email" required maxlength="254" placeholder="name@example.com"/></label>
    <button class="btn primary wide" id="accountEmailSend">发送登录邮件</button></form>
    <button class="btn ghost wide" id="accountBind" type="button" hidden>绑定邮箱，保留此身份和留言</button>
    <form id="accountCodeForm" hidden><label class="field"><span>邮件中的验证码（也可直接打开邮件链接）</span><input id="accountCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" required/></label><button class="btn primary wide">确认验证码</button></form>
    <details><summary>使用密码登录</summary><form id="accountPasswordForm"><label class="field"><span>密码</span><input id="accountPassword" type="password" autocomplete="current-password" minlength="6" required/></label><button class="btn ghost wide">登录这个邮箱账号</button></form></details>
    <form id="accountSetPassword" hidden><label class="field"><span>设置密码，方便下次登录</span><input id="accountNewPassword" type="password" autocomplete="new-password" minlength="10" required/></label><button class="btn ghost wide">保存密码</button></form>
    <p id="accountStatus" class="sheet-note" role="status" aria-live="polite"></p>
    <button class="text-btn" id="accountGuest" type="button">先以新访客身份进入</button><button class="text-btn" id="accountSignout" type="button" hidden>退出当前账号</button>
  </section>`;document.body.append(sheet);
  sheet.querySelector('[data-close]').onclick=()=>closeSheet('accountScrim');
  const button=node('button','btn ghost wide','账号与跨设备登录');button.id='accountBtn';button.type='button';button.onclick=()=>{render();showSheet('accountScrim');};$('settingsScrim').querySelector('section').prepend(button);
  function render(){
    $('accountIdentity').textContent=user?(user.email||'未绑定邮箱的访客')+' · '+user.id:'还未登录';
    $('accountHint').textContent=user?.is_anonymous?'先在这台旧设备绑定邮箱，再到其他设备登录同一邮箱，历史留言仍属于同一个 UUID。登录另一账号不会自动合并此访客的历史。':'手机、平板、电脑使用同一个邮箱登录，已加入的邀请房间会自动找回。旧消息没有作者 UUID 时保留原文，不猜测归属。';
    $('accountBind').hidden=!user?.is_anonymous;$('accountGuest').hidden=!!user;$('accountSignout').hidden=!user;
    $('accountSetPassword').hidden=!user?.email||!!user?.is_anonymous;
  }
  async function run(task){if(busy)return;busy=true;$('accountStatus').textContent='正在处理…';sheet.querySelectorAll('button').forEach(b=>b.disabled=true);try{await task();}catch(e){$('accountStatus').textContent=e?.message||errorText(e);}finally{busy=false;sheet.querySelectorAll('button').forEach(b=>b.disabled=false);render();}}
  function destination(){const url=new URL(location.href);url.search='';url.hash='';return url.href;}
  function getEmail(){const field=$('accountEmail');if(!field.reportValidity()||!field.value.trim())throw new Error('请填写可接收邮件的邮箱。');return field.value.trim();}
  async function sendEmail(bind){email=getEmail();otpType=bind?'email_change':'email';const result=bind?await client(true).auth.updateUser({email},{emailRedirectTo:destination()}):await client(true).auth.signInWithOtp({email,options:{shouldCreateUser:true,emailRedirectTo:destination()}});if(result.error)throw result.error;$('accountCodeForm').hidden=false;$('accountStatus').textContent=bind?'绑定邮件已发送。确认邮件后，账号 UUID 与原留言保持不变。':'登录邮件已发送，请打开邮件链接，或填写验证码。';}
  $('accountEmailForm').onsubmit=e=>{e.preventDefault();void run(()=>sendEmail(false));};
  $('accountBind').onclick=()=>void run(()=>sendEmail(true));
  $('accountCodeForm').onsubmit=e=>{e.preventDefault();void run(async()=>{const r=await client(true).auth.verifyOtp({email,token:$('accountCode').value.trim(),type:otpType});if(r.error)throw r.error;$('accountCode').value='';$('accountCodeForm').hidden=true;$('accountStatus').textContent='已确认。';await accept(r.data.user);});};
  $('accountPasswordForm').onsubmit=e=>{e.preventDefault();void run(async()=>{const r=await client(true).auth.signInWithPassword({email:getEmail(),password:$('accountPassword').value});if(r.error)throw r.error;$('accountPassword').value='';await accept(r.data.user);$('accountStatus').textContent='已登录。';});};
  $('accountSetPassword').onsubmit=e=>{e.preventDefault();void run(async()=>{const r=await client(true).auth.updateUser({password:$('accountNewPassword').value});if(r.error)throw r.error;$('accountNewPassword').value='';$('accountStatus').textContent='密码已保存。';});};
  $('accountGuest').onclick=()=>void run(async()=>{const r=await client(true).auth.signInAnonymously();if(r.error)throw r.error;await accept(r.data.user);$('accountStatus').textContent='已建立访客 UUID。需要换设备时，请先绑定邮箱。';});
  $('accountSignout').onclick=()=>void run(async()=>{if(user?.is_anonymous&&!confirm('此访客尚未绑定邮箱，退出后无法恢复身份。仍要退出吗？'))return;const r=await client(true).auth.signOut({scope:'local'});if(r.error)throw r.error;await accept(null);$('accountStatus').textContent='已退出此设备。';});
  async function accept(next){user=next||null;render();if(observed===user?.id)return;const previous=observed;observed=user?.id;await onIdentity(user,previous);if(!user)return;try{const rooms=await joinedRooms();if(observed===user.id)onRooms(rooms);}catch(e){if(observed===user.id)$('accountStatus').textContent='已登录；房间列表暂未同步，请稍后重新打开账号页。';}}
  const subscription=client(true).auth.onAuthStateChange((event,session)=>{setTimeout(()=>void accept(session?.user),0);if(event==='PASSWORD_RECOVERY')setTimeout(()=>{showSheet('accountScrim');$('accountSetPassword').hidden=false;},0);});
  const ready=client(true).auth.getSession().then(r=>{if(r.error)throw r.error;return accept(r.data.session?.user);}).catch(e=>{$('accountStatus').textContent=errorText(e);});
  return {ready,open(){render();showSheet('accountScrim');},get user(){return user;}};
}
