import {localDate,validDate,randomId,storeGet,errorText} from './core.js?v=2.3.0';
import {fileInfo,bytesLabel} from './feature-core.js?v=2.3.0';
import {screenshotTime,sortScreenshots,splitText} from './ocr-layout.js?v=2.3.0';
import {imageFile,directoryFiles,selectedDrafts,importUnits} from './import-core.js?v=2.3.0';
import {screenshotRecord,imageHash} from './screenshot-store.js?v=2.3.0';
import {recognizeScreenshot} from './ocr.js?v=2.3.0';
import * as api from './backend.js?v=2.3.0';

export function initScreenshotImport({$,state,node,toast,showSheet,closeSheet,notice,onMessages}){
  let queue=[],drafts=[],plan=null,files=new Map(),supplements=new Map(),controller=null,upload=null,busy=false,collecting=false,revision=0,loadedScope='',page=0,queuePage=0,saveTimer,previewUrl='';
  const scope=()=>`${state.room}.${state.userId||state.deviceId}`;
  const snap=()=>({room:state.room,epoch:state.epoch,scope:scope(),secure:state.secure,metadata:state.metadata,user:state.userId,device:state.deviceId,name:state.profile.myName});
  const current=s=>s.room===state.room&&s.epoch===state.epoch;
  const status=text=>$('ocrStatus').textContent=text;
  const locked=()=>busy||collecting||Boolean(controller);
  const pending=()=>plan?.some(unit=>unit.attempted)&&plan.some(unit=>!unit.sent);
  const snapshot=()=>({queue,drafts,plan,mode:$('ocrMode').value,side:$('ocrSide').value});
  const picked=()=>selectedDrafts(drafts,$('ocrSide').value);
  const error=e=>/[\u4e00-\u9fff]/.test(e?.message||'')?e.message:errorText(e);
  const journalKey=s=>'mailbox.ocr-edits.'+s;
  function edits(s){try{return JSON.parse(localStorage.getItem(journalKey(s))||'{}');}catch{return {};}}
  async function save(s=snap(),batch=snapshot()){
    if(s.scope===scope())clearTimeout(saveTimer);
    let checkpoint;try{checkpoint=localStorage.getItem(journalKey(s.scope));}catch{}
    try{await screenshotRecord(s.scope,'batch',structuredClone(batch));try{if(localStorage.getItem(journalKey(s.scope))===checkpoint)localStorage.removeItem(journalKey(s.scope));}catch{}return true;}
    catch{status('本机识别记录保存失败，请释放网站存储空间后重试；当前预览仍保留。');return false;}
  }
  const scheduleSave=row=>{if(row){const journal=edits(scope());journal[row.nonce]={text:row.text,label:row.label,date:row.date,side:row.side,selected:row.selected};try{localStorage.setItem(journalKey(scope()),JSON.stringify(journal));}catch{}}clearTimeout(saveTimer);saveTimer=setTimeout(()=>void save(),300);};
  async function ledger(item,s=snap(),rows=drafts){
    await screenshotRecord(s.scope,'hash:'+item.hash,{name:item.name,time:item.time,processed:true,rows:rows.filter(row=>row.sourceHash===item.hash),sent:item.sent||false});
  }
  function controls(){
    const block=locked();for(const id of ['ocrChoose','ocrChooseMany','ocrFile','ocrDirectory','ocrRecognize','ocrParse','importClear','importSend','ocrAll','ocrInvert','ocrNewOnly','ocrSkipProcessed','draftAll','draftInvert','ocrLeftName','ocrRightName'])$(id).disabled=block;
    for(const id of ['ocrMode','ocrSide','ocrRecognize','ocrParse','draftAll','draftInvert','importClear','ocrNewOnly'])$(id).disabled=block||pending();$('ocrCancel').disabled=!block;
    $('importSend').textContent=pending()?'重试未确认的发送':`确认并发送 ${picked().length} 段`;
    $('importSend').disabled=block||!picked().length;
    $('ocrQueueCount').textContent=`${queue.length} 张截图 · 选中 ${queue.filter(x=>x.selected).length} 张`;
    $('ocrDraftCount').textContent=`${drafts.length} 段预览 · 选中 ${picked().length} 段`;
  }
  function renderQueue(){
    const box=$('ocrQueue');box.replaceChildren();queuePage=Math.min(queuePage,Math.max(0,Math.ceil(queue.length/20)-1));
    for(const item of queue.slice(queuePage*20,queuePage*20+20)){
      const row=node('div','screenshot-row'),label=node('label','check-field'),check=node('input');check.type='checkbox';check.checked=item.selected;check.disabled=locked();check.onchange=()=>{item.selected=check.checked;void save();controls();};
      const words=node('span','');words.append(node('strong','',item.name),node('small','',`${localDate(item.time)} · ${item.path||'截图'} · ${item.sent?'已发送':item.processed?'已处理':item.error?'识别失败':'待识别'}`));label.append(check,words);row.append(label);
      const preview=node('button','text-btn','查看');preview.type='button';preview.onclick=()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);const file=files.get(item.hash);if(file){previewUrl=URL.createObjectURL(file);$('ocrPreview').src=previewUrl;$('ocrPreview').hidden=false;}else toast('原图未上传，重新选择同一文件即可预览。');const first=drafts.findIndex(d=>d.sourceHash===item.hash);if(first>=0){page=Math.floor(first/20);renderDrafts();}};row.append(preview);
      if(item.error)row.append(node('small','row-warning',item.error));box.append(row);
    }
    $('queuePrev').disabled=queuePage===0;$('queueNext').disabled=(queuePage+1)*20>=queue.length;$('queuePage').textContent=queue.length?`${queuePage+1} / ${Math.ceil(queue.length/20)}`:'暂无截图';controls();
  }
  function field(row,key,title,type='text'){
    const label=node('label','field'),input=node('input');input.type=type;input.value=row[key]||'';if(type==='text')input.maxLength=24;input.disabled=row.sent||row.attempted||locked()||pending();input.oninput=()=>{row[key]=input.value;plan=null;scheduleSave(row);};label.append(node('span','',title),input);return label;
  }
  function renderDrafts(){
    const box=$('importRows');box.replaceChildren();page=Math.min(page,Math.max(0,Math.ceil(drafts.length/20)-1));
    for(const row of drafts.slice(page*20,page*20+20)){
      const item=node('article','import-row'+(row.sent?' sent':'')),choose=node('label','check-field'),check=node('input');check.type='checkbox';check.checked=row.selected!==false;check.disabled=row.sent||row.attempted||locked()||pending();check.onchange=()=>{row.selected=check.checked;plan=null;scheduleSave(row);controls();};choose.append(check,node('span','',row.sent?'已发送':`${row.side==='left'?'左侧':row.side==='right'?'右侧':'待核对方向'}${row.time?' · '+row.time:''}${row.confidence<85?' · 低置信度，请核对':''}`));
      const side=node('select');side.setAttribute('aria-label','摘录方向');for(const [value,text] of [['left','左侧'],['right','右侧'],['unknown','未确定']]){const option=node('option','',text);option.value=value;side.append(option);}side.value=row.side||'unknown';side.disabled=check.disabled;side.onchange=()=>{row.side=side.value;row.label=side.value==='left'?$('ocrLeftName').value:$('ocrRightName').value;plan=null;scheduleSave(row);renderDrafts();};
      const fields=node('div','field-pair');fields.append(field(row,'label','来源称呼'),field(row,'date','显示日期','date'));
      const text=node('textarea');text.value=row.text;text.rows=3;text.maxLength=4700;text.disabled=check.disabled;text.setAttribute('aria-label','摘录正文');text.oninput=()=>{row.text=text.value;plan=null;scheduleSave(row);};
      const source=node('p','sheet-note',`${row.sourceName||'手动文字'} · ${row.dateSource||'可编辑日期'}`);
      const supplement=node('details','import-supplement'),summary=node('summary','',row.fileMeta?row.fileMeta.name:'补充原媒体（可选）');supplement.append(summary);
      const file=node('input');file.type='file';file.setAttribute('aria-label','为摘录补充媒体');file.disabled=row.sent||locked()||((row.attempted||pending())&&(!row.fileMeta||supplements.has(row.nonce)));
      file.onchange=async()=>{const chosen=file.files[0],s=snap();if(!chosen)return;if(!s.secure){toast('补充媒体需要邀请房间。');return;}try{const info=fileInfo(chosen),hash=await imageHash(chosen);if(!current(s))return;if((row.attempted||pending())&&row.fileMeta?.hash!==hash){toast('重试请选择原来的同一份文件。');return;}row.fileMeta={...info,hash};supplements.set(row.nonce,chosen);if(!row.attempted&&!pending())plan=null;await save();renderDrafts();}catch(e){toast(error(e));}};
      supplement.append(file);if(row.fileMeta)supplement.append(node('small','',supplements.has(row.nonce)?'已就绪':'重试前请选择原文件'));
      item.append(choose,side,fields,source,text,supplement,node('p','import-result',row.attempted&&!row.sent?'发送未获确认，原文和发送编号已锁定，可安全重试。':''));box.append(item);
    }
    $('draftPrev').disabled=page===0;$('draftNext').disabled=(page+1)*20>=drafts.length;$('draftPage').textContent=drafts.length?`${page+1} / ${Math.ceil(drafts.length/20)}`:'识别结果会出现在这里';controls();
  }
  function render(){renderQueue();renderDrafts();}
  async function open(){
    if(!state.ready){toast('请先进入已连接的房间。');return;}closeSheet('composeScrim');closeSheet('menuScrim');showSheet('importScrim');const s=snap();
    if(loadedScope!==s.scope){try{const saved=await screenshotRecord(s.scope,'batch');if(!current(s))return;queue=saved?.queue||[];drafts=saved?.drafts||storeGet('imports.'+s.scope,[]);plan=saved?.plan||null;$('ocrSide').value=saved?.side||'all';$('ocrMode').value=saved?.mode||'separate';loadedScope=s.scope;const journal=edits(s.scope);for(const row of drafts)if(!row.sent&&!row.attempted&&journal[row.nonce])Object.assign(row,journal[row.nonce]);if(Object.keys(journal).length)await save(s);}catch{status('本机存储暂时不可用，发送前需要保存识别记录。');}}
    render();
  }
  async function addFiles(source){
    if(locked())return;const s=snap(),rev=revision;collecting=true;controls();let added=0,duplicates=0,skipped=0;
    try{for await(const incoming of source){if(!current(s)||rev!==revision)break;const file=incoming.file||incoming;if(!imageFile(file)){skipped++;continue;}if(file.size>80*1024*1024||!file.size){skipped++;continue;}status(`正在整理截图 ${added+duplicates+1} · 检查重复文件`);const hash=await imageHash(file);if(!current(s)||rev!==revision)break;files.set(hash,file);
      if(queue.some(x=>x.hash===hash)){duplicates++;continue;}
      const previous=await screenshotRecord(s.scope,'hash:'+hash);if(!current(s)||rev!==revision)break;
      const item={hash,name:file.name,path:incoming.path||file.webkitRelativePath||'',time:screenshotTime(file),processed:Boolean(previous?.processed),sent:Boolean(previous?.sent),selected:!previous?.processed||!$('ocrSkipProcessed').checked};queue.push(item);added++;
      if(previous?.rows?.length&&!drafts.some(d=>d.sourceHash===hash))drafts.push(...previous.rows.map(row=>({...row,selected:false})));
      if(added%10===0){renderQueue();await new Promise(r=>setTimeout(r,0));}
    }
    if(current(s)){queue=sortScreenshots(queue);await save(s);status(`已加入 ${added} 张，跳过 ${duplicates} 张重复文件${skipped?`和 ${skipped} 个非截图/无效文件`:''}。按截图文件名中的时间优先排序。`);}
    }catch(e){if(current(s))status(error(e));}finally{if(current(s)){collecting=false;render();}}
  }
  const multiple=()=>{$('ocrFile').value='';$('ocrFile').click();};
  $('ocrChooseMany').onclick=multiple;
  $('ocrChoose').onclick=async()=>{
    if(typeof window.showDirectoryPicker==='function'){
      try{const handle=await window.showDirectoryPicker({id:'mailbox-screenshots',mode:'read',startIn:'pictures'});await addFiles(directoryFiles(handle));}catch(e){if(e.name==='AbortError')return;status('当前环境无法选择目录，已切换为多文件选择。');multiple();}
    }else if('webkitdirectory' in $('ocrDirectory')&&!/Android/i.test(navigator.userAgent)){$('ocrDirectory').value='';$('ocrDirectory').click();}
    else{status('当前浏览器不支持目录选择，可在文件管理器一次多选截图。');multiple();}
  };
  $('ocrFile').onchange=()=>void addFiles([...$('ocrFile').files]);$('ocrDirectory').onchange=()=>void addFiles([...$('ocrDirectory').files]);
  for(const [id,apply] of [['ocrAll',()=>true],['ocrInvert',item=>!item.selected],['ocrNewOnly',item=>!item.processed&&!item.sent]])$(id).onclick=()=>{for(const item of queue)item.selected=apply(item);if(id==='ocrNewOnly'){for(const row of drafts)if(queue.some(q=>q.hash===row.sourceHash&&!q.selected))row.selected=false;plan=null;renderDrafts();}void save();renderQueue();};
  $('ocrSkipProcessed').onchange=()=>{if($('ocrSkipProcessed').checked)for(const item of queue)if(item.processed)item.selected=false;renderQueue();};
  $('queuePrev').onclick=()=>{queuePage--;renderQueue();};$('queueNext').onclick=()=>{queuePage++;renderQueue();};$('draftPrev').onclick=()=>{page--;renderDrafts();};$('draftNext').onclick=()=>{page++;renderDrafts();};
  for(const [id,apply] of [['draftAll',()=>true],['draftInvert',row=>!row.selected]])$(id).onclick=()=>{for(const row of drafts)if(!row.sent&&!row.attempted)row.selected=apply(row);plan=null;void save();renderDrafts();};
  $('ocrSide').onchange=()=>{for(const row of drafts)if(!row.sent&&!row.attempted)row.selected=$('ocrSide').value==='all'||row.side===$('ocrSide').value;plan=null;void save();renderDrafts();};$('ocrMode').onchange=()=>{plan=null;void save();};
  $('ocrCancel').onclick=()=>{controller?.abort();upload?.abort();revision++;if(collecting){collecting=false;render();}status('正在停止，已完成的截图和发送记录会保留。');};
  $('ocrRecognize').onclick=async()=>{
    if(locked())return;const work=queue.filter(item=>item.selected&&(!item.processed||!$('ocrSkipProcessed').checked));if(!work.length){status('没有待识别的截图。可选择新截图，或关闭“跳过已处理”后重新识别。');return;}
    const s=snap(),rev=revision;controller=new AbortController();const signal=controller.signal,session={};controls();let done=0;
    try{for(const item of work){if(signal.aborted||!current(s)||rev!==revision)break;if(drafts.some(row=>row.sourceHash===item.hash&&row.attempted)){item.error='已有发送记录，保留原预览，避免重复发送。';continue;}
      const file=files.get(item.hash);if(!file){item.error='请重新选择原文件，识别记录仍保留。';continue;}
      try{const result=await recognizeScreenshot(file,{signal,session,anchorDate:localDate(item.time),onProgress:text=>{if(current(s))status(`${done+1} / ${work.length} 张 · ${item.name}\n${text}`);}});if(!current(s)||signal.aborted)break;if(!result.messages.length)throw new Error('暂未找到聊天正文，可以直接重试完整截图。');
        drafts=drafts.filter(row=>row.sourceHash!==item.hash);drafts.push(...result.messages.map(row=>({...row,nonce:randomId(),label:row.side==='right'?$('ocrRightName').value.trim()||'我':row.side==='left'?$('ocrLeftName').value.trim()||'对方':'待核对',sourceHash:item.hash,sourceName:item.name,sourceTime:item.time,selected:row.confidence>=80&&($('ocrSide').value==='all'||row.side===$('ocrSide').value),sent:false,attempted:false})));
        drafts.sort((a,b)=>(a.sourceTime||0)-(b.sourceTime||0)||(a.y||0)-(b.y||0));item.processed=true;item.error='';plan=null;await ledger(item,s);if(!await save(s))break;done++;render();
      }catch(e){if(e.name==='AbortError'||signal.aborted)break;item.error=error(e);renderQueue();}
    }
    if(current(s))status(`${signal.aborted||rev!==revision?'已停止':'识别完成'}：本次处理 ${done} 张。已自动过滤界面元素并提取日期；低置信度文字保留在预览中待核对。`);
    }finally{await session.worker?.terminate();if(current(s)){controller=null;await save(s);render();}}
  };
  $('ocrParse').onclick=async()=>{const text=$('ocrManual').value.trim();if(!text)return;drafts.push(...text.split(/\n\s*\n/).flatMap(text=>splitText(text)).map(text=>({nonce:randomId(),text,label:'截图',side:'unknown',date:'',selected:true,sent:false,attempted:false,confidence:100})));plan=null;await save();renderDrafts();};
  $('importClear').onclick=async()=>{const s=snap();if(!await notice('清空这次导入？','清除队列和本机预览，已发送的留言与已处理截图记录保留。','清空',true)||!current(s))return;queue=[];drafts=[];plan=null;files.clear();supplements.clear();await save(s);render();};
  $('importSend').onclick=async()=>{
    if(locked()||!state.ready)return;const s=snap(),chosen=picked();if(!chosen.length)return;
    if(chosen.some(row=>!row.text.trim()||!row.label.trim()||row.label.length>24||(row.date&&!validDate(row.date)))){toast('请核对来源、正文和日期。');return;}
    if(chosen.some(row=>row.fileMeta&&!supplements.has(row.nonce))){toast('带媒体的摘录请重新选择原文件后重试。');return;}
    if(plan?.every(unit=>unit.sent))plan=null;plan ||= importUnits(chosen,$('ocrMode').value);
    if(!await notice('确认发送整理结果？',`将发送 ${plan.filter(unit=>!unit.sent).length} 条${$('ocrMode').value==='merged'?'合并整理记录（附件单独发送）':'截图摘录'}到当前房间。原截图不会上传，来源称呼保留。`,'确认发送',true)||!current(s))return;
    busy=true;const task=snapshot(),rev=revision;controls();renderDrafts();
    try{for(const unit of task.plan){if(unit.sent)continue;if(!current(s)||rev!==revision)break;if(!s.secure&&unit.attempted)throw new Error('旧版房间无法确认上次是否送达，请先在聊天中核对，避免重复导入。');unit.attempted=true;for(const id of unit.rows){const row=task.drafts.find(d=>d.nonce===id);if(row)row.attempted=true;}if(!await save(s,task))break;
      const text=(!s.metadata&&unit.date?`[${unit.date}]\n`:'')+unit.text,payload={room_id:s.room,sender:s.secure?s.user:s.device,sender_name:s.name,content:s.secure?text:`[截图摘录 · ${unit.label}]\n${text}`};
      if(s.metadata)Object.assign(payload,{display_date:unit.date||null,reply_to:[]});if(s.secure)Object.assign(payload,{author_id:s.user,client_nonce:unit.nonce,message_type:'import',import_label:unit.label});
      if(unit.fileMeta){upload=new AbortController();const path=`${s.room}/${s.user}/${unit.nonce}`;await api.uploadMedia(path,supplements.get(unit.fileRow),unit.fileMeta.mime,n=>{if(current(s))status(`补充媒体上传 ${Math.round(n*100)}%`);},upload.signal);upload=null;if(!current(s)||rev!==revision)break;Object.assign(payload,{message_type:unit.fileMeta.type,media_path:path,media_name:unit.fileMeta.name,media_mime:unit.fileMeta.mime,media_size:unit.fileMeta.size});}
      const message=await api.sendMessage(payload,s.secure);unit.sent=true;
      for(const id of unit.rows){const row=task.drafts.find(d=>d.nonce===id);if(row)row.sent=task.plan.filter(u=>u.rows.includes(id)).every(u=>u.sent);}
      const changed=new Set(task.drafts.filter(d=>unit.rows.includes(d.nonce)).map(d=>d.sourceHash));for(const item of task.queue.filter(q=>changed.has(q.hash))){const rows=task.drafts.filter(d=>d.sourceHash===item.hash);item.sent=rows.every(d=>d.sent);await ledger(item,s,task.drafts);}
      await save(s,task);if(current(s)){onMessages([message]);renderDrafts();status(`已发送 ${task.plan.filter(u=>u.sent).length} / ${task.plan.length} 条`);}
    }if(task.plan.every(unit=>unit.sent)){task.plan=null;if(current(s))plan=null;await save(s,task);}}catch(e){if(current(s))status(error(e)+(s.secure?' 已送达的不重发，未确认的保留编号重试。':' 当前草稿与发送进度已保留。'));}
    finally{if(current(s)){busy=false;render();}}
  };
  $('importBtn').onclick=()=>void open();
  document.addEventListener('mailbox:sheet-close',event=>{if(event.detail.id==='importScrim'){controller?.abort();upload?.abort();revision++;void save();}});
  return {reset(){if(loadedScope)void save({scope:loadedScope},snapshot());clearTimeout(saveTimer);controller?.abort();upload?.abort();revision++;controller=null;upload=null;busy=collecting=false;queue=[];drafts=[];plan=null;files.clear();supplements.clear();loadedScope='';if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';$('ocrPreview').hidden=true;}};
}
