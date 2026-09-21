import {musicStore} from './local-music.js?v=2.2.0';
import {localDate,validDate,storeGet,randomId,errorText} from './core.js?v=2.2.0';
import {fileInfo,bytesLabel,mediaPathValid,daysBetween,eventCountdown,parseLyrics,activeLyric,playbackPosition,memoirText,ocrDrafts} from './feature-core.js?v=2.2.0';
import * as api from './backend.js?v=2.2.0';
import * as data from './feature-backend.js?v=2.2.0';
import {recognizeScreenshot} from './ocr.js?v=2.2.0';

export function initFeatures(ctx){
  const {$,state,node,toast,persist,showSheet,closeSheet,notice,author,onMessages}=ctx;
  const audio=$('listenAudio');
  let stopSubscription=null,media=null,mediaController=null,mediaBusy=false,mediaUrls=new Map(),mediaCards=new Map();
  let calendar=[],calendarBusy=false,calendarEdit=null,eventNonce=randomId();
  let song=null,songRevision=0,listenSession=null,listenOffset=0,listenBusy=false,listenReading=false,lyrics=[],lyricIndex=-1;
  let ocrController=null,ocrRevision=0,ocrUrl='',imports=[],importBusy=false,importStop=false,importUpload=null;const importFiles=new Map();
  let memoir=null,memoirEdits=0,memoirBusy=false;
  let recorder=null,recordStream=null,recordTimer=null,recordRevision=0;

  const snap=()=>({room:state.room,secure:state.secure,userId:state.userId,deviceId:state.deviceId,epoch:state.epoch,name:state.profile.myName});
  const current=s=>state.room===s.room&&state.epoch===s.epoch;
  const key=(kind,s=snap())=>`${kind}.${s.room}.${s.userId||s.deviceId}`;
  // The immediately preceding release stored these utilities under raw room keys.
  // Recover to editable local fields; never publish old private values automatically.
  const oldLocal=kind=>{try{return localStorage.getItem(kind+'.'+state.room)||'';}catch{return '';}};
  function oldEvent(){try{const value=JSON.parse(oldLocal('anniversary'));return validDate(value?.date)?value:null;}catch{return null;}}
  const messageError=e=>e?.code==='40001'?'另一端刚修改了内容，请重新读取后再保存；本机草稿已保留。':/[\u4e00-\u9fff]/.test(e?.message||'')?e.message:errorText(e);
  const fail=e=>{if(e?.name!=='AbortError')toast(messageError(e));};
  const requireRoom=()=>{if(!state.ready){toast('请先进入已连接的房间。');return false;}return true;};
  function open(id){if(!requireRoom())return false;closeSheet('menuScrim');showSheet(id);return true;}
  function download(blob,name){const link=node('a');const url=URL.createObjectURL(blob);link.href=url;link.download=name.replace(/[\\/\x00-\x1f]/g,'_');document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}

  // Attachment transactions keep the same nonce, file and caption across retries.
  function mediaControls(){
    $('attachmentSend').disabled=!media||mediaBusy||!state.secure;
    $('attachmentSend').textContent=media?.attempted?'重试上传并发送':'上传并发送';
    $('attachmentFile').disabled=mediaBusy;
    $('attachmentCaption').disabled=mediaBusy||Boolean(media?.attempted);
    $('attachmentCancel').disabled=!mediaBusy;
  }
  function attachmentOpen(){
    if(!open('attachmentScrim'))return;
    $('attachmentStatus').textContent=state.secure?'文件先上传，确认成功后才会生成留言。':'附件需要邀请房间。旧版公开房间继续支持文字留言。';
    mediaControls();
  }
  $('attachBtn').onclick=attachmentOpen;
  async function chooseAttachment(selected){
    if(mediaBusy||!selected)return;const s=snap();
    try{
      const info=fileInfo(selected);
      if(media?.attempted && !(await notice('更换附件？','上次发送未获确认时，请先刷新留言核对。更换会建立一条新的发送记录。','更换',true)))return;
      if(!current(s))return;
      if(media?.url)URL.revokeObjectURL(media.url);
      const nonce=randomId();media={file:selected,info,nonce,path:`${state.room}/${state.userId}/${nonce}`,url:URL.createObjectURL(selected),attempted:false,caption:''};
      $('attachmentCaption').value='';$('attachmentPreview').replaceChildren(node('p','',info.name+' · '+bytesLabel(info.size)));
      if(['image','audio','video'].includes(info.type)){
        const element=node(info.type==='image'?'img':info.type);element.src=media.url;
        if(info.type==='image')element.alt='附件预览';else{element.controls=true;element.preload='metadata';}
        $('attachmentPreview').append(element);
      }
      $('attachmentProgress').hidden=true;$('attachmentStatus').textContent='准备好了，点击“上传并发送”。';mediaControls();
    }catch(e){fail(e);}
  }
  $('attachmentFile').onchange=()=>chooseAttachment($('attachmentFile').files[0]);
  function endRecording(discard=false){
    if(discard)recordRevision++;
    clearTimeout(recordTimer);recordTimer=null;
    if(recorder&&recorder.state!=='inactive')recorder.stop();
    recordStream?.getTracks().forEach(track=>track.stop());recordStream=null;
    $('recordStart').disabled=false;$('recordStop').hidden=true;
  }
  $('recordStart').onclick=async()=>{
    if(!state.secure){toast('语音留言需要邀请房间。');return;}
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast('当前浏览器无法直接录音，可以选择已有的音频文件。');return;}
    const s=snap(),revision=++recordRevision;$('recordStart').disabled=true;
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(!current(s)||revision!==recordRevision||$('attachmentScrim').hidden){stream.getTracks().forEach(track=>track.stop());return;}
      recordStream=stream;const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
      recorder=mime?new MediaRecorder(stream,{mimeType:mime}):new MediaRecorder(stream);const chunks=[];let size=0;
      recorder.ondataavailable=event=>{if(event.data.size){chunks.push(event.data);size+=event.data.size;if(size>19*1024*1024)endRecording();}};
      recorder.onstop=()=>{stream.getTracks().forEach(track=>track.stop());if(revision!==recordRevision||!current(s))return;const type=(recorder.mimeType||mime||'audio/webm').split(';')[0];const file=new File(chunks,`语音-${Date.now()}.${type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':'webm'}`,{type});void chooseAttachment(file);$('recordStatus').textContent='语音已录好，试听后再发送。';};
      recorder.onerror=()=>{endRecording(true);$('recordStatus').textContent='录音中断，请重新录制或选择已有音频。';};
      recorder.start(1000);$('recordStop').hidden=false;$('recordStatus').textContent='正在录音，最长 3 分钟。结束后可以试听。';recordTimer=setTimeout(()=>endRecording(),180000);
    }catch(e){endRecording(true);$('recordStatus').textContent=e.name==='NotAllowedError'?'没有获得麦克风权限，可以在网站设置中开启。':'录音未能开始，请检查麦克风。';}
  };
  $('recordStop').onclick=()=>endRecording();
  $('attachmentCancel').onclick=()=>mediaController?.abort();
  $('attachmentSend').onclick=async()=>{
    if(!media||mediaBusy||!state.secure||!requireRoom())return;
    const s=snap(),pending=media,controller=new AbortController();mediaController=controller;mediaBusy=true;
    if(!pending.attempted){pending.caption=$('attachmentCaption').value.trim();pending.date=state.date||null;pending.quotes=[...state.quotes];}pending.attempted=true;mediaControls();
    $('attachmentProgress').hidden=false;$('attachmentProgress').value=0;$('attachmentStatus').textContent='正在上传……';
    try{
      await api.uploadMedia(pending.path,pending.file,pending.info.mime,progress=>{if(current(s)){$('attachmentProgress').value=Math.round(progress*100);$('attachmentStatus').textContent=`上传 ${Math.round(progress*100)}%`; }},controller.signal);
      if(!current(s)||controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
      $('attachmentStatus').textContent='文件已上传，正在确认留言……';
      const message=await api.sendMessage({room_id:s.room,sender:s.userId,author_id:s.userId,sender_name:s.name,client_nonce:pending.nonce,content:pending.caption,message_type:pending.info.type,media_path:pending.path,media_name:pending.info.name,media_mime:pending.info.mime,media_size:pending.info.size,display_date:pending.date,reply_to:pending.quotes},true);
      if(current(s)){
        onMessages([message]);URL.revokeObjectURL(pending.url);media=null;$('attachmentFile').value='';$('attachmentCaption').value='';$('attachmentPreview').replaceChildren();$('attachmentStatus').textContent='已发送';closeSheet('attachmentScrim');toast('附件已发送。');
      }
    }catch(e){if(current(s))$('attachmentStatus').textContent=e.name==='AbortError'?'已停止。若文件已传完，可用原附件重试；不会重复生成留言。':messageError(e)+' 文件和附言已保留，点击重试。';}
    finally{if(current(s)){mediaBusy=false;mediaController=null;mediaControls();}}
  };
  function renderMedia(message,bubble){
    if(message.import_label)bubble.append(node('div','import-label',`截图摘录 · ${message.import_label}（由留言者导入）`));
    if(!message.media_path)return;
    if(mediaCards.has(message.id)){bubble.append(mediaCards.get(message.id));return;}
    const card=node('div','media-card');card.append(node('span','media-label',(message.media_name||'附件')+' · '+bytesLabel(message.media_size||0)));
    const button=node('button','',message.message_type==='file'?'下载附件':'打开附件');button.type='button';card.append(button);bubble.append(card);mediaCards.set(message.id,card);
    if(!state.secure||!mediaPathValid(message.media_path,state.room)){button.disabled=true;button.textContent='附件路径不可用';return;}
    button.onclick=async()=>{
      const s=snap();button.disabled=true;button.textContent='正在读取……';
      try{
        let cached=mediaUrls.get(message.media_path);
        if(!cached){const blob=await data.mediaBlob(s.room,message.media_path);if(!current(s))return;cached={blob,url:URL.createObjectURL(blob)};mediaUrls.set(message.media_path,cached);}
        if(!current(s))return;
        if(['image','audio','video'].includes(message.message_type)){
          const element=node(message.message_type==='image'?'img':message.message_type);element.src=cached.url;
          if(message.message_type==='image')element.alt=message.media_name||'留言图片';else{element.controls=true;element.preload='metadata';}
          const save=node('button','','下载原文件');save.type='button';save.onclick=()=>download(cached.blob,message.media_name||'附件');button.replaceWith(element,save);
        }else{download(cached.blob,message.media_name||'附件');button.textContent='再次下载';button.disabled=false;}
      }catch(e){if(current(s)){button.disabled=false;button.textContent='读取失败，点击重试';fail(e);}}
    };
    if(message.message_type==='image'){button.dataset.autoload='true';mediaObserver.observe(button);}
  }
  const mediaObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){mediaObserver.unobserve(entry.target);if(entry.target.isConnected)entry.target.click();}},{root:$('messages'),rootMargin:'250px'});

  // Shared dates, with an explicitly local mode for legacy rooms.
  function renderCalendar(){
    const box=$('eventList');box.replaceChildren();
    const legacy=oldEvent();$('legacyEventImport').hidden=!legacy||calendar.some(row=>row.event_date===legacy.date&&row.title===(legacy.name||'纪念日'));
    if(!calendar.length)box.append(node('p','sheet-note','还没有纪念日，先记下一件小事吧。'));
    const rows=calendar.map(event=>({...event,next:eventCountdown(event)})).sort((a,b)=>(a.next?.days??0)-(b.next?.days??0));
    for(const event of rows){
      const card=node('article','event-card'),detail=node('div');detail.append(node('strong','',event.title),node('small','',event.event_date+(event.repeat_yearly?' · 每年纪念':'')));card.append(detail);
      const days=event.next?.days;card.append(node('span','countdown',days===0?'就是今天':days>0?`还有 ${days} 天`:`已过 ${Math.abs(days||0)} 天`));
      if(!state.secure||event.owner_user_id===state.userId){
        const edit=node('button','','修改');edit.type='button';edit.onclick=()=>{calendarEdit=event.id;$('eventTitle').value=event.title;$('eventDate').value=event.event_date;$('eventYearly').checked=event.repeat_yearly;$('eventSave').textContent='保存修改';$('eventTitle').focus();};
        const remove=node('button','','删除');remove.type='button';remove.onclick=async()=>{
          const s=snap();if(!(await notice('删除这一天？',`“${event.title}”将从纪念日列表移除，留言不受影响。`,'删除',true))||!current(s))return;
          try{if(s.secure)await data.deleteEvent(s.room,event.id);if(!current(s))return;calendar=calendar.filter(row=>row.id!==event.id);if(!s.secure)persist(key('events',s),calendar);renderCalendar();}catch(e){fail(e);}
        };card.append(edit,remove);
      }
      box.append(card);
    }
  }
  function daysCard(value){const days=daysBetween(value);$('relationshipDays').textContent=days===null?'—':days<0?`还有 ${-days} 天`:`第 ${days+1} 天`;$('relationshipCaption').textContent=value?`从 ${value} 开始，记住每个普通日子`:'设置相识日期，开始记录';$('relationDays').textContent=days===null?'—':days<0?`还有 ${-days} 天`:`${days+1} 天`;$('relationCaption').textContent=value?`从 ${value} 开始`:'点开纪念日，写下相识的日期';}
  async function refreshCalendar(fillDate=false){
    if(!state.ready||calendarBusy)return;calendarBusy=true;const s=snap();
    try{
      let since;
      if(s.secure){const [info,rows]=await Promise.all([data.roomDetails(s.room),data.events(s.room)]);if(!current(s))return;calendar=rows;since=info.relationship_since||localDate(info.created_at);}
      else{calendar=storeGet(key('events',s),[]);if(!Array.isArray(calendar))calendar=[];since=storeGet(key('relationship',s),'')||localDate(state.messages[0]?.created_at);}
      if(!current(s))return;daysCard(since);if(fillDate)$('relationshipSince').value=since;
      $('relationshipNote').textContent=s.secure?'房间成员共享相识日期与纪念日；各自只能修改自己创建的纪念日。':'旧版房间：日期与纪念日仅保存在本机。';renderCalendar();if(state.view==='wall')onMessages([]);
    }catch(e){if(current(s))$('relationshipNote').textContent=messageError(e);}
    finally{if(current(s))calendarBusy=false;}
  }
  $('relationshipBtn').onclick=()=>{if(open('relationshipScrim'))void refreshCalendar(true);};
  $('legacyEventImport').onclick=()=>{const saved=oldEvent();if(!saved)return;calendarEdit=null;$('eventTitle').value=(saved.name||'纪念日').slice(0,120);$('eventDate').value=saved.date;$('eventYearly').checked=false;$('eventSave').textContent='记下这一天';$('eventTitle').focus();toast('已找回到编辑区，确认保存后才加入纪念日列表。');};
  $('relationshipForm').onsubmit=async event=>{
    event.preventDefault();const value=$('relationshipSince').value;if(!validDate(value)){toast('请选择有效日期。');return;}const s=snap(),button=event.submitter;button.disabled=true;
    try{if(s.secure)await data.setRelationship(s.room,value);else if(!persist(key('relationship',s),value))return;if(current(s)){daysCard(value);toast('相识日期已保存。');}}
    catch(e){if(current(s))fail(e);}finally{button.disabled=false;}
  };
  $('eventForm').onsubmit=async event=>{
    event.preventDefault();if($('eventSave').disabled)return;
    const s=snap(),title=$('eventTitle').value.trim(),date=$('eventDate').value;if(!title||!validDate(date))return;
    const row={id:calendarEdit||eventNonce,room_id:s.room,owner_user_id:s.userId||s.deviceId,title,event_date:date,repeat_yearly:$('eventYearly').checked};
    const edit=calendarEdit;$('eventSave').disabled=true;
    try{
      let saved=row;
      if(s.secure)saved=edit?await data.updateEvent(row):await data.saveEvent(row);
      if(!current(s))return;
      const next=[...calendar.filter(item=>item.id!==row.id),saved];
      if(!s.secure&&!persist(key('events',s),next))return;
      calendar=next;calendarEdit=null;eventNonce=randomId();$('eventForm').reset();$('eventSave').textContent='记下这一天';renderCalendar();toast('这一天已经记下了。');
    }catch(e){if(current(s))fail(e);}finally{$('eventSave').disabled=false;}
  };
  // Local audio persists in IndexedDB. Only its identity and transport state sync.
  function clock(seconds){const n=Math.max(0,Math.floor(seconds||0));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;}
  function playerControls(){
    const available=Boolean(song&&Number.isFinite(audio.duration));
    $('listenToggle').disabled=!available||listenBusy;$('miniListenToggle').disabled=!available||listenBusy;
    $('listenShare').disabled=!available||!state.secure||listenBusy;$('listenSeek').disabled=!available||listenBusy;
    const text=audio.paused?'播放':'暂停';$('listenToggle').textContent=text;$('miniListenToggle').textContent=text;
    $('listenMini').hidden=!song;$('miniTrack').textContent=song?.name||'一起听';
    $('listenSync').disabled=!state.secure;
  }
  function paintLyrics(){lyricIndex=-1;$('lyrics').replaceChildren(...(lyrics.length?lyrics.map(line=>node('p','',line.text||'♪')):[node('p','','可以导入带时间轴的 LRC 歌词。')]));}
  function playerTime(){
    $('listenSeek').value=audio.currentTime||0;$('listenTime').textContent=clock(audio.currentTime);$('listenDuration').textContent=clock(audio.duration);
    const index=activeLyric(lyrics,audio.currentTime||0);
    if(index!==lyricIndex){$('lyrics').children[lyricIndex]?.classList.remove('active');const line=$('lyrics').children[index];line?.classList.add('active');lyricIndex=index;if(line&&!$('listenScrim').hidden)$('lyrics').scrollTop=line.offsetTop-$('lyrics').offsetTop-$('lyrics').clientHeight/2;}
    playerControls();
  }
  async function applyListen(){
    if(!$('listenSync').checked||!song||!listenSession)return;
    if(song.hash!==listenSession.track_key){audio.pause();$('listenStatus').textContent=`房间正在听“${listenSession.track_name}”。文件不一致，已暂停；选择同一个文件后再同步。`;playerControls();return;}
    if(!Number.isFinite(audio.duration))return;
    const target=playbackPosition(listenSession,Date.now()+listenOffset,audio.duration);
    if(Math.abs(audio.currentTime-target)>1.2)audio.currentTime=target;
    if(listenSession.is_playing&&target<audio.duration){try{await audio.play();}catch{$('listenStatus').textContent='浏览器需要你点击一次“播放”才能加入同步。';return;}}else audio.pause();
    $('listenStatus').textContent='同一音频已核对 · 正在同步播放进度';playerTime();
  }
  async function refreshListen(){
    if(!state.ready||!state.secure||listenReading||listenBusy)return;
    const s=snap();listenReading=true;
    try{const result=await data.readListen(s.room);if(!current(s))return;listenOffset=result.offset;if(!listenSession||(result.session?.revision||0)>=listenSession.revision)listenSession=result.session;
      if(!$('listenSync').checked)$('listenStatus').textContent=listenSession?`房间歌曲：${listenSession.track_name}。选择同一文件后勾选跟随。`:'房间还没有共享歌曲。';
      await applyListen();
    }catch(e){if(current(s)&&!$('listenScrim').hidden)$('listenStatus').textContent=messageError(e);}finally{if(current(s))listenReading=false;}
  }
  async function publishListen(force=false){
    if(!song||!state.secure||listenBusy)return;
    if(!force&&(!$('listenSync').checked||song.hash!==listenSession?.track_key))return;
    const s=snap(),track=song;listenBusy=true;playerControls();
    try{
      const result=await data.setListen(s.room,{p_key:track.hash,p_name:track.name,p_playing:!audio.paused,p_position:audio.currentTime||0,p_revision:listenSession?.revision||0});
      if(!current(s)||song!==track)return;listenSession=result.session;listenOffset=result.offset;$('listenSync').checked=true;$('listenStatus').textContent='播放进度已同步，朋友需选择同一个文件。';
    }catch(e){if(current(s)){audio.pause();$('listenStatus').textContent=messageError(e);}}
    finally{if(current(s)){listenBusy=false;playerControls();}}
  }
  function listenOpen(){if(open('listenScrim')){$('listenNotes').value=storeGet(key('listenNotes'),oldLocal('lyrics'));playerControls();if(state.secure)void refreshListen();else $('listenStatus').textContent='旧版房间支持本机播放器。跨设备同步需要邀请房间。';}}
  $('listenNotes').oninput=()=>persist(key('listenNotes'),$('listenNotes').value);
  $('listenBtn').onclick=listenOpen;$('miniListenOpen').onclick=listenOpen;
  $('listenFile').onchange=async()=>{
    const file=$('listenFile').files[0];if(!file)return;const s=snap(),revision=++songRevision;
    if(file.size>80*1024*1024||!file.size||(!file.type.startsWith('audio/')&&!/\.(mp3|m4a|wav|ogg|flac)$/i.test(file.name))){toast('请选择不超过 80 MB 的音频文件。');return;}
    audio.pause();$('listenStatus').textContent='正在核对音频指纹……';
    try{
      const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());if(!current(s)||revision!==songRevision)return;
      if(song?.url)URL.revokeObjectURL(song.url);
      song={name:file.name.slice(0,180),hash:[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join(''),url:URL.createObjectURL(file)};
      lyrics=[];paintLyrics();audio.src=song.url;audio.load();$('trackName').textContent=song.name;$('listenStatus').textContent='歌曲留在本机，可以收起播放器继续聊天。';playerControls();void musicStore(s.room,{file,name:song.name,hash:song.hash,lyrics:[]}).catch(()=>{if(current(s))toast('本机空间不足，歌曲仅在本次打开期间保留。');});await refreshListen();
    }catch(e){if(current(s))fail(e);}
  };
  $('lyricsFile').onchange=async()=>{
    const file=$('lyricsFile').files[0];if(!file)return;const s=snap(),revision=songRevision;
    if(file.size>200000){toast('歌词文件请小于 200 KB。');return;}
    try{const text=await file.text();if(!current(s)||revision!==songRevision)return;lyrics=parseLyrics(text);if(song){void musicStore(s.room).then(saved=>{if(saved?.hash===song?.hash)return musicStore(s.room,{...saved,lyrics});}).catch(()=>{});}paintLyrics();if(!lyrics.length)toast('没有找到 LRC 时间轴，请检查文件格式。');playerTime();}catch(e){fail(e);}
  };
  async function toggleListen(){if(!song||listenBusy)return;try{if(audio.paused)await audio.play();else audio.pause();playerControls();await publishListen();}catch{$('listenStatus').textContent='这个音频暂时无法播放，请换成浏览器支持的 MP3 或 M4A。';}}
  $('listenToggle').onclick=toggleListen;$('miniListenToggle').onclick=toggleListen;
  $('listenShare').onclick=async()=>{if(!song||listenBusy)return;const s=snap();if(listenSession&&listenSession.track_key!==song.hash&&!(await notice('切换房间歌曲？',`将房间歌曲改为“${song.name}”。朋友需要在自己的设备选择同一个文件。`,'切换歌曲',true)))return;if(current(s))await publishListen(true);};
  $('listenSync').onchange=async()=>{if($('listenSync').checked)await refreshListen();else $('listenStatus').textContent='已停止跟随，只在本机播放。';};
  $('listenSeek').onchange=async()=>{if(!song||listenBusy)return;audio.currentTime=Number($('listenSeek').value);await publishListen();};
  audio.onloadedmetadata=()=>{$('listenSeek').max=Number.isFinite(audio.duration)?audio.duration:1;playerTime();void applyListen();};
  audio.ontimeupdate=playerTime;audio.onended=()=>{playerControls();void publishListen();};audio.onerror=()=>{if(song)$('listenStatus').textContent='无法解码这首歌，请换成 MP3、M4A 等受支持的格式。';};
  function clearSong(){++songRevision;audio.pause();audio.removeAttribute('src');audio.load();if(song?.url)URL.revokeObjectURL(song.url);song=null;lyrics=[];paintLyrics();$('listenSync').checked=false;$('listenFile').value='';$('lyricsFile').value='';$('trackName').textContent='还没有选择歌曲';playerControls();}
  $('listenStop').onclick=async()=>{const s=snap();audio.pause();await publishListen();if(current(s)){clearSong();void musicStore(s.room,null).catch(()=>{});closeSheet('listenScrim');}};

  // OCR always produces editable drafts. Sending is a separate, explicit action.
  function persistImports(s=snap()){return persist(key('imports',s),imports);}
  function importControls(){const locked=importBusy||Boolean(ocrController);for(const id of ['ocrRecognize','ocrFile','ocrParse','importClear','importSend'])$(id).disabled=locked;$('ocrCancel').disabled=!ocrController&&!importBusy;}
  function renderImports(){
    const box=$('importRows');box.replaceChildren();
    for(const row of imports){
      const item=node('div','import-row'+(row.sent?' sent':''));const choose=node('label','check-field'),check=node('input');check.type='checkbox';check.checked=row.selected!==false;check.disabled=Boolean(row.sent||row.attempted||importBusy);choose.append(check,node('span','',row.sent?'已发送的摘录':'选中这段摘录'));check.onchange=()=>{row.selected=check.checked;persistImports();};
      const fields=node('div','field-pair');
      for(const [field,label,type] of [['label','来源称呼','text'],['date','显示日期','date']]){const wrap=node('label','field'),input=node('input');input.type=type;input.value=row[field]||'';if(type==='text')input.maxLength=24;input.disabled=Boolean(row.sent||row.attempted||importBusy);input.oninput=()=>{row[field]=input.value;persistImports();};wrap.append(node('span','',label),input);fields.append(wrap);}
      const text=node('textarea');text.value=row.text;text.rows=3;text.maxLength=5000;text.disabled=Boolean(row.sent||row.attempted||importBusy);text.setAttribute('aria-label','摘录正文');text.oninput=()=>{row.text=text.value;persistImports();};const content=node('label','field');content.append(node('span','','正文'),text);
      const supplement=node('label','file-picker','补充图片 / 原媒体（可选）'),file=node('input');file.type='file';file.setAttribute('aria-label','为摘录补充媒体');file.disabled=Boolean(row.sent||importBusy||(row.attempted&&importFiles.has(row.nonce)));
      file.onchange=async()=>{const selected=file.files[0],s=snap();if(!selected)return;if(!s.secure){toast('补充媒体需要邀请房间。');return;}
        try{const info=fileInfo(selected),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await selected.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');if(!current(s))return;
          if(row.attempted&&row.fileMeta?.hash!==hash){toast('重试必须选择之前的同一份文件。');return;}row.fileMeta={...info,hash};importFiles.set(row.nonce,selected);persistImports();renderImports();
        }catch(e){fail(e);}
      };supplement.append(file);if(row.fileMeta)supplement.append(node('small','',row.fileMeta.name+(importFiles.has(row.nonce)?' · 已就绪':' · 请重新选择原文件')));
      if(!row.attempted&&row.fileMeta){const remove=node('button','text-btn','移除补充媒体');remove.type='button';remove.onclick=()=>{delete row.fileMeta;importFiles.delete(row.nonce);persistImports();renderImports();};supplement.append(remove);}
      item.append(choose,fields,content,supplement,node('p','import-result',row.sent?'已经送达':row.attempted?'上次发送未获确认，保留原文与发送编号以便安全重试。':''));box.append(item);
    }
  }
  function prepareImports(rows){importFiles.clear();imports=rows.map(row=>({...row,nonce:randomId(),date:'',selected:true,sent:false,attempted:false}));persistImports();renderImports();$('ocrStatus').textContent=`已整理 ${imports.length} 段。请核对文字、来源和日期，再确认发送。`;}
  async function mayReplaceImports(){return !imports.some(row=>!row.sent)||(await notice('替换当前预览？','当前未发送的摘录会被新识别结果替换。','替换预览',true));}
  $('importBtn').onclick=()=>{if(open('importScrim')){const saved=storeGet(key('imports'),[]);imports=Array.isArray(saved)?saved:[];renderImports();importControls();}};
  $('ocrFile').onchange=()=>{if(ocrUrl)URL.revokeObjectURL(ocrUrl);const file=$('ocrFile').files[0];ocrUrl=file?URL.createObjectURL(file):'';$('ocrPreview').hidden=!ocrUrl;if(ocrUrl)$('ocrPreview').src=ocrUrl;else $('ocrPreview').removeAttribute('src');};
  $('ocrCancel').onclick=()=>{ocrController?.abort();importUpload?.abort();importStop=true;};
  $('ocrRecognize').onclick=async()=>{
    if(ocrController||importBusy)return;const file=$('ocrFile').files[0];if(!file){toast('先选择一张截图。');return;}const s=snap();if(!(await mayReplaceImports())||!current(s))return;
    const revision=++ocrRevision,controller=new AbortController();ocrController=controller;importControls();
    const left=$('ocrLeftName').value.trim()||'对方',right=$('ocrRightName').value.trim()||'我';
    try{const result=await recognizeScreenshot(file,{signal:controller.signal,onProgress:text=>{if(current(s)&&revision===ocrRevision)$('ocrStatus').textContent=text;}});if(!current(s)||revision!==ocrRevision)return;const rows=ocrDrafts(result.data,result.width,left,right);if(!rows.length)throw new Error('没有识别到文字，请换一张更清晰的截图或粘贴文字。');prepareImports(rows);}
    catch(e){if(current(s)&&revision===ocrRevision)$('ocrStatus').textContent=e.name==='AbortError'?'识别已停止，原预览保留。':messageError(e);}
    finally{if(current(s)&&revision===ocrRevision){ocrController=null;importControls();}}
  };
  $('ocrParse').onclick=async()=>{const s=snap();if(!(await mayReplaceImports())||!current(s))return;try{const rows=ocrDrafts({text:$('ocrManual').value},1);if(!rows.length)throw new Error('请先粘贴文字。');prepareImports(rows);}catch(e){fail(e);}};
  $('importClear').onclick=async()=>{const s=snap();if(!(await notice('清空预览？','只清除本机导入预览，已经发出的留言不会删除。','清空',true))||!current(s))return;imports=[];persistImports();renderImports();$('ocrStatus').textContent='预览已清空。';};
  $('importSend').onclick=async()=>{
    if(importBusy||!requireRoom())return;const batch=imports,rows=batch.filter(row=>row.selected&&!row.sent),s=snap();if(!rows.length){toast('还没有选中未发送的摘录。');return;}
    if(rows.some(row=>!row.text.trim()||row.text.length>5000||!row.label.trim()||row.label.length>24||(row.date&&!validDate(row.date)))){toast('请核对每段的来源、正文和有效日期。');return;}
    if(rows.some(row=>row.fileMeta&&!importFiles.has(row.nonce))){toast('请为带媒体的摘录重新选择原文件，或移除尚未发送的媒体。');return;}
    if(!state.metadata&&rows.some(row=>row.date)){toast('显示日期需要升级数据库，也可以先清空日期再导入。');return;}
    if(!s.secure&&rows.some(row=>row.text.length+row.label.length+12>5000)){toast('旧版房间需要为摘录标签预留长度，请缩短正文。');return;}
    if(!(await notice('确认发送这些摘录？',`将把选中的 ${rows.length} 段作为你导入的截图摘录发到当前房间，其他成员会看到。识别用的原截图不会上传；你另外选择的补充媒体会随摘录发送。`,'确认发送',true))||!current(s))return;
    importBusy=true;importStop=false;importControls();renderImports();let sent=0;
    try{
      for(const row of rows){
        if(importStop||!current(s))break;
        row.attempted=true;persistImports(s);
        const payload={room_id:s.room,sender:s.secure?s.userId:s.deviceId,sender_name:s.name,content:s.secure?row.text.trim():`[截图摘录 · ${row.label.trim()}]\n${row.text.trim()}`};
        if(state.metadata)Object.assign(payload,{display_date:row.date||null,reply_to:[]});
        if(s.secure)Object.assign(payload,{author_id:s.userId,client_nonce:row.nonce,message_type:'import',import_label:row.label.trim()});
        if(row.fileMeta){const path=`${s.room}/${s.userId}/${row.nonce}`;importUpload=new AbortController();await api.uploadMedia(path,importFiles.get(row.nonce),row.fileMeta.mime,progress=>{if(current(s))$('ocrStatus').textContent=`补充媒体上传 ${Math.round(progress*100)}%`;},importUpload.signal);importUpload=null;if(importStop||!current(s))break;Object.assign(payload,{message_type:row.fileMeta.type,media_path:path,media_name:row.fileMeta.name,media_mime:row.fileMeta.mime,media_size:row.fileMeta.size});}
        const message=await api.sendMessage(payload,s.secure);row.sent=true;sent++;importFiles.delete(row.nonce);
        // Keep this batch snapshot when navigation happens during an in-flight send.
        persist(key('imports',s),batch);
        if(current(s)){onMessages([message]);$('ocrStatus').textContent=`已发送 ${sent} / ${rows.length} 段`;renderImports();}
      }
      if(current(s))$('ocrStatus').textContent=importStop?'已停止后续发送。已送达的段落会保留标记。':`已发送 ${sent} 段，原图未上传。`;
    }catch(e){if(current(s))$('ocrStatus').textContent=messageError(e)+(s.secure?' 已送达的不再重发，未确认的可用原预览重试。':' 发送未获确认，请先刷新核对，避免重复发送。');}
    finally{if(current(s)){importBusy=false;importControls();renderImports();}}
  };

  // Memoirs are private projections, never inserted back into the conversation.
  function freshMemoir(){const end=new Date(),start=new Date();start.setDate(start.getDate()-30);return {id:randomId(),revision:0,title:'',body:'',range_start:localDate(start),range_end:localDate(end)};}
  function readMemoirFields(){return {...memoir,title:$('memoirTitle').value,body:$('memoirBody').value,range_start:$('memoirStart').value,range_end:$('memoirEnd').value};}
  function keepMemoir(){if(!state.room||!memoir)return;memoir=readMemoirFields();memoirEdits++;persist(key('memoirDraft'),memoir);}
  function fillMemoir(value){memoir=value||freshMemoir();memoirEdits++;$('memoirTitle').value=memoir.title;$('memoirBody').value=memoir.body;$('memoirStart').value=memoir.range_start;$('memoirEnd').value=memoir.range_end;$('memoirDelete').hidden=!memoir.revision;persist(key('memoirDraft'),memoir);}
  function memoirControls(){for(const id of ['memoirSave','memoirGenerate','memoirNew','memoirDelete'])$(id).disabled=memoirBusy;}
  async function listMemoirs(){const s=snap();try{
    const list=s.secure?await data.listMemoirs(s.room):storeGet(key('memoirs',s),[]);if(!current(s))return;
    $('memoirList').replaceChildren();
    for(const item of (Array.isArray(list)?list:[])){
      const button=node('button','memoir-card');button.type='button';button.append(node('span','',item.title),node('small','',`${item.range_start} — ${item.range_end}`));button.onclick=async()=>{
        if(memoirBusy)return;const here=snap();if($('memoirBody').value&&!(await notice('打开已保存的回忆录？','当前草稿若还没保存，可以先导出。打开会替换编辑区。','打开',true)))return;if(!current(here))return;
        try{const value=here.secure?await data.loadMemoir(here.room,item.id):item;if(current(here))fillMemoir(value);}catch(e){if(current(here))fail(e);}
      };$('memoirList').append(button);
    }
  }catch(e){if(current(s))$('memoirNote').textContent=messageError(e)+' 编辑区的本机草稿仍可导出。';}}
  $('memoirBtn').onclick=()=>{if(!open('memoirScrim'))return;const draft=storeGet(key('memoirDraft'),null),legacy=oldLocal('memoir');fillMemoir(draft?.id?draft:legacy?{...freshMemoir(),title:'从本机找回的一页',body:legacy.slice(0,200000)}:freshMemoir());$('memoirNote').textContent=state.secure?'回忆录只对当前身份可见，房间内的其他成员无法读取；未保存的编辑也会暂存在本机。':'旧版房间：回忆录只保存在本机，可导出 Markdown 备份。';void listMemoirs();memoirControls();};
  for(const id of ['memoirTitle','memoirBody','memoirStart','memoirEnd'])$(id).oninput=keepMemoir;
  $('memoirNew').onclick=async()=>{const s=snap();if($('memoirBody').value&&!(await notice('开始新的一篇？','请先保存或导出当前编辑内容。','开始新篇',true)))return;if(current(s))fillMemoir(freshMemoir());};
  $('memoirGenerate').onclick=async()=>{
    if(memoirBusy)return;const s=snap(),start=$('memoirStart').value,end=$('memoirEnd').value;
    if(!validDate(start)||!validDate(end)||start>end){toast('请选择有效的起止日期。');return;}
    if($('memoirBody').value&&!(await notice('重新整理正文？','这会用日期范围内的留言原文替换编辑区正文，不改变原始留言。','整理原文',true)))return;
    if(!current(s))return;const edits=memoirEdits;memoirBusy=true;memoirControls();
    try{const rows=await data.allMessages(s.room,s.secure,count=>{if(current(s))$('memoirProgress').textContent=`正在读取历史留言：${count} 条`;},()=>!current(s)||$('memoirScrim').hidden);
      if(!current(s))return;const result=memoirText(rows,start,end,row=>author(row).name);
      if(edits!==memoirEdits){toast('读取期间你修改了草稿，已保留你的编辑，请重新整理。');return;}
      $('memoirBody').value=result.body;if(!$('memoirTitle').value)$('memoirTitle').value=`我们的日子 · ${start}`;keepMemoir();$('memoirProgress').textContent=`已整理 ${result.count} 条原文，可继续改写，然后保存。`;
    }catch(e){if(current(s))$('memoirProgress').textContent=e.name==='AbortError'?'整理已取消。':messageError(e);}finally{if(current(s)){memoirBusy=false;memoirControls();}}
  };
  $('memoirSave').onclick=async()=>{
    if(memoirBusy||!memoir)return;keepMemoir();const s=snap(),value={...memoir},edits=memoirEdits;
    if(!value.title.trim()||!validDate(value.range_start)||!validDate(value.range_end)||value.range_start>value.range_end){toast('请填写标题和有效的起止日期。');return;}
    memoirBusy=true;memoirControls();
    try{
      let saved;
      if(s.secure)saved=await data.saveMemoir({id:value.id,revision:value.revision,title:value.title.trim(),body:value.body,range_start:value.range_start,range_end:value.range_end,room_id:s.room,owner_user_id:s.userId});
      else{saved={...value,revision:(value.revision||0)+1,updated_at:new Date().toISOString()};const list=storeGet(key('memoirs',s),[]);if(!persist(key('memoirs',s),[saved,...list.filter(row=>row.id!==saved.id)]))return;}
      if(!current(s))return;
      const unchanged=edits===memoirEdits;
      if(unchanged)fillMemoir(saved);else{memoir={...readMemoirFields(),revision:saved.revision};persist(key('memoirDraft'),memoir);}
      $('memoirDelete').hidden=false;$('memoirNote').textContent=unchanged?'回忆录已保存。':'已保存提交时的内容，随后输入的文字仍在草稿里。';toast('回忆录已保存，原始留言没有改动。');await listMemoirs();
    }catch(e){if(current(s))$('memoirNote').textContent=messageError(e);}finally{if(current(s)){memoirBusy=false;memoirControls();}}
  };
  $('memoirExport').onclick=()=>{if(!$('memoirBody').value){toast('先写一点内容再导出吧。');return;}download(new Blob([`# ${$('memoirTitle').value||'回忆录'}\n\n${$('memoirBody').value}`],{type:'text/markdown;charset=utf-8'}),($('memoirTitle').value||'回忆录').slice(0,80)+'.md');};
  $('memoirDelete').onclick=async()=>{if(!memoir?.revision||memoirBusy)return;const s=snap(),value={...memoir};if(!(await notice('删除这篇回忆录？',`“${value.title}”会被删除，原始聊天不会受影响。需要留存时请先导出。`,'删除回忆录',true))||!current(s))return;
    try{if(s.secure)await data.deleteMemoir(s.room,value.id,value.revision);else if(!persist(key('memoirs',s),storeGet(key('memoirs',s),[]).filter(row=>row.id!==value.id)))return;if(current(s)){fillMemoir(freshMemoir());await listMemoirs();toast('回忆录已删除。');}}catch(e){if(current(s))fail(e);}
  };

  function roomChanged(){
    endRecording(true);mediaObserver.disconnect();daysCard('');
    stopSubscription?.();stopSubscription=null;mediaController?.abort();mediaController=null;mediaBusy=false;
    if(media?.url)URL.revokeObjectURL(media.url);media=null;
    for(const value of mediaUrls.values())URL.revokeObjectURL(value.url);mediaUrls.clear();mediaCards.clear();
    calendar=[];calendarBusy=false;calendarEdit=null;eventNonce=randomId();$('eventForm').reset();$('eventSave').disabled=false;$('eventSave').textContent='记下这一天';
    clearSong();listenSession=null;listenOffset=0;listenBusy=false;listenReading=false;
    importUpload?.abort();importUpload=null;importFiles.clear();ocrController?.abort();ocrController=null;++ocrRevision;importStop=true;importBusy=false;imports=[];
    if(ocrUrl)URL.revokeObjectURL(ocrUrl);ocrUrl='';$('ocrPreview').hidden=true;$('ocrPreview').removeAttribute('src');$('ocrFile').value='';$('ocrManual').value='';$('ocrStatus').textContent='';
    memoir=null;memoirEdits++;memoirBusy=false;$('memoirProgress').textContent='';$('attachmentFile').value='';$('attachmentCaption').value='';$('attachmentPreview').replaceChildren();
  }
  function ready(){void refreshCalendar();void restoreSong();if(state.secure){const s=snap();stopSubscription=data.subscribeFeatures(s.room,()=>{if(current(s))void refreshCalendar();},()=>{if(current(s))void refreshListen();});}}
  document.addEventListener('mailbox:space-open',()=>void refreshCalendar());
  document.addEventListener('mailbox:sheet-close',event=>{if(event.detail.id==='attachmentScrim')endRecording(true);if(event.detail.id==='attachmentScrim'&&mediaBusy)mediaController?.abort();if(event.detail.id==='importScrim'){ocrController?.abort();importUpload?.abort();importStop=true;}});
  setInterval(()=>{if(document.hidden||!state.ready)return;if($('listenSync').checked||!$('listenScrim').hidden)void refreshListen();if(!$('relationshipScrim').hidden)void refreshCalendar();},10000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.ready&&$('listenSync').checked)void refreshListen();});
  async function restoreSong(){
    const s=snap(),revision=songRevision;
    try{const saved=await musicStore(s.room);if(!saved?.file||!current(s)||revision!==songRevision||song)return;song={name:saved.name,hash:saved.hash,url:URL.createObjectURL(saved.file)};lyrics=saved.lyrics||[];paintLyrics();audio.src=song.url;audio.load();$('trackName').textContent=song.name;$('listenStatus').textContent='已找回这台设备上次导入的歌曲，点击播放。';playerControls();}catch{/* Local audio import remains available without IndexedDB. */}
  }
  function renderWall(container){
    for(const event of calendar){const card=node('article','msg wall-event'),bubble=node('div','bubble');bubble.append(node('small','','纪念的一天'),node('strong','',event.title),node('time','wall-date',event.event_date));card.append(bubble);container.append(card);}
    if(song||listenSession){const card=node('article','msg wall-event'),bubble=node('div','bubble');bubble.append(node('small','','一起听过的歌'),node('strong','',song?.name||listenSession.track_name));card.append(bubble);container.append(card);}
  }
  return {roomChanged,ready,renderMedia,renderWall};
}
