import {randomId,localDate,validDate,isMine} from './core.js?v=2.7.6';
import {client} from './backend.js?v=2.7.6';
import {mediaBlob} from './feature-backend.js?v=2.7.6';

export const CARD_TYPES=new Set(['screenshot','forward']);
export function cardData(message){
  if(CARD_TYPES.has(message.message_type)&&message.message_payload?.version===1&&Array.isArray(message.message_payload.entries))return message.message_payload;
  // Read old releases without rewriting or losing their original text.
  if(message.message_type==='import'||/^【(?:合并转发|截图合并整理)】|^\[截图摘录/.test(message.content||'')){
    const parts=String(message.content).replace(/^【[^】]+】\s*|^\[截图摘录[^\]]*\]\s*/,'').split(/\n\s*\n/).filter(Boolean);
    return {version:1,kind:message.content?.startsWith('【合并转发】')?'forward':'screenshot',legacy:true,entries:parts.map(text=>({id:randomId(),text,label:message.import_label||'摘录',date:message.display_date||localDate(message.created_at),time:'',side:'unknown'})),originals:[]};
  }
  return null;
}
export function cardPreview(payload){return payload.entries.slice(0,3).map(e=>e.text||e.media_name||'附件').join('\n').slice(0,500);}
export function screenshotCards(rows){
  const out=[];
  for(let i=0;i<rows.length;i+=80){const items=rows.slice(i,i+80);const payload={version:1,kind:'screenshot',entries:items.map(row=>({id:row.nonce,text:row.text,label:row.label,side:row.side||'unknown',date:row.date||'',time:row.time||'',source_hash:row.sourceHash||'',source_name:row.sourceName||''})),originals:[]};out.push({nonce:randomId(),rows:items.map(r=>r.nonce),payload,text:cardPreview(payload),date:items[0]?.date||'',sent:false,attempted:false});}
  return out;
}
export function initMessageCards(ctx){
  const {$,state,node,toast,showSheet,closeSheet,onMessages}=ctx;let message,payload,urls=[],epoch=0;
  const root=node('div','scrim');root.id='messageDetailScrim';root.hidden=true;
  root.innerHTML='<section class="sheet feature-sheet message-detail" role="dialog" aria-modal="true" aria-labelledby="messageDetailTitle"><header class="sheet-head"><h2 id="messageDetailTitle">聊天记录</h2><button type="button" aria-label="关闭详情">×</button></header><p id="messageDetailOrigin" class="sheet-note"></p><div class="batch-toolbar" id="messageDetailActions"><button class="text-btn" id="messageDetailEdit">修改摘录</button><button class="text-btn" id="messageDetailMerge">合并选中项</button><button class="btn primary" id="messageDetailSave">保存修改</button></div><div id="messageDetailRows"></div><details id="messageOriginals"><summary>查看原截图</summary><div id="messageOriginalRows"></div></details></section>';
  document.body.append(root);root.querySelector('header button').onclick=()=>closeSheet(root.id);
  const editable=()=>isMine(message||{},state)&&message?.message_type==='screenshot'&&!payload?.legacy;
  let editing=false;
  function clear(){epoch++;for(const url of urls)URL.revokeObjectURL(url);urls=[];}
  function render(){
    $('messageDetailTitle').textContent=(payload.kind==='forward'?'聊天记录':'截图摘录')+' · '+payload.entries.length+' 条';
    $('messageDetailOrigin').textContent='整理发送于 '+new Date(message.created_at).toLocaleString('zh-CN')+(payload.legacy?' · 旧版摘录，原文保留':'');
    $('messageDetailEdit').hidden=!editable()||editing;$('messageDetailMerge').hidden=!editing;$('messageDetailSave').hidden=!editing;
    $('messageDetailRows').replaceChildren();
    for(const entry of payload.entries){const row=node('article','detail-entry '+(entry.side==='right'?'detail-right':'detail-left'));row.dataset.entryId=entry.id;
      if(editing){const pick=node('input');pick.type='checkbox';pick.className='entry-check';pick.setAttribute('aria-label','选择合并此项');row.append(pick);
        const fields=node('div','field-pair');for(const [key,type,label] of [['label','text','来源称呼'],['date','date','日期'],['time','time','时间']]){const wrap=node('label','field'),input=node('input');input.type=type;input.value=entry[key]||'';input.setAttribute('aria-label',label);input.oninput=()=>entry[key]=input.value;wrap.append(node('span','',label),input);fields.append(wrap);}const side=node('select');side.setAttribute('aria-label','左右双方');for(const [v,t] of [['left','左侧'],['right','右侧'],['unknown','待确认']]){const o=node('option','',t);o.value=v;side.append(o);}side.value=entry.side||'unknown';side.onchange=()=>{entry.side=side.value;row.className='detail-entry detail-'+side.value;};fields.append(side);row.append(fields);
        const text=node('textarea');text.value=entry.text||'';text.maxLength=5000;text.rows=3;text.setAttribute('aria-label','识别正文');text.oninput=()=>entry.text=text.value;row.append(text);const del=node('button','text-btn danger','删除错误项');del.onclick=()=>{payload.entries=payload.entries.filter(e=>e!==entry);render();};row.append(del);
      }else{row.append(node('small','',`${entry.label||'来源'} · ${entry.date||'未标日期'} ${entry.time||''}`),node('p','',entry.text||''));}
      if(entry.media_path){const open=node('button','text-btn',entry.media_name||'打开附件');open.onclick=()=>loadAsset(entry,row,open);row.append(open);}
      $('messageDetailRows').append(row);
    }
    $('messageOriginals').hidden=!payload.originals?.length;$('messageOriginalRows').replaceChildren();
    for(const source of payload.originals||[]){const box=node('div','original-image'),button=node('button','text-btn',source.name||'原截图');button.onclick=()=>loadAsset({...source,media_path:source.path,media_name:source.name,message_type:'image'},box,button);box.append(button);$('messageOriginalRows').append(box);}
  }
  async function loadAsset(entry,box,button){const rev=epoch;button.disabled=true;try{const blob=await mediaBlob(state.room,entry.media_path);if(rev!==epoch)return;const url=URL.createObjectURL(blob);urls.push(url);const type=entry.message_type||'file';if(['image','audio','video'].includes(type)){const el=node(type==='image'?'img':type);el.src=url;el.alt=entry.media_name||'';if(type!=='image'){el.controls=true;el.preload='metadata';}box.append(el);}else{const link=node('a','text-btn','下载 '+entry.media_name);link.href=url;link.download=entry.media_name||'附件';box.append(link);}button.remove();}catch{button.disabled=false;button.textContent='重新读取附件';}}
  $('messageDetailEdit').onclick=()=>{editing=true;render();};
  $('messageDetailMerge').onclick=()=>{const ids=[...$('messageDetailRows').querySelectorAll('.entry-check:checked')].map(e=>e.closest('[data-entry-id]').dataset.entryId);if(ids.length<2){toast('先选中至少两项。');return;}const selected=payload.entries.filter(e=>ids.includes(e.id));if(selected.some(e=>e.media_path)){toast('带附件的项请保留为独立消息。');return;}const combined=selected.map(e=>e.text).join('\n');if(combined.length>5000){toast('合并后超过 5000 字，请减少选中项。');return;}selected[0].text=combined;payload.entries=payload.entries.filter(e=>!ids.includes(e.id)||e===selected[0]);render();};
  $('messageDetailSave').onclick=async()=>{if(!editable()||!payload.entries.length){toast('至少保留一条摘录。');return;}const rev=epoch;$('messageDetailSave').disabled=true;try{const r=await client(true).rpc('mailbox_edit_card',{p_room:state.room,p_id:String(message.id),p_revision:message.card_revision||1,p_payload:payload});if(r.error)throw r.error;if(rev!==epoch)return;message=r.data;onMessages([message]);editing=false;render();toast('摘录已更新，真实发送时间保留。');}catch(e){toast(e.code==='40001'?'另一端已经修改，请关闭后重新打开。':'保存失败，修改仍保留在这里。');}finally{$('messageDetailSave').disabled=false;}};
  document.addEventListener('mailbox:sheet-close',e=>{if(e.detail.id===root.id)clear();});
  return {render(messageRow,bubble){const data=cardData(messageRow);if(!data)return false;const button=node('button','message-record-card');button.type='button';button.append(node('strong','',data.kind==='forward'?'聊天记录':`截图摘录 · ${data.entries.length} 条`));for(const e of data.entries.slice(0,3))button.append(node('span','',`${data.kind==='forward'?(e.label||'来源')+'：':''}${e.text||e.media_name||'附件'}`));button.append(node('small','',`共 ${data.entries.length} 条 · 查看全部 ›`));button.onclick=()=>{clear();message=messageRow;payload=structuredClone(data);editing=false;render();showSheet(root.id);};bubble.append(button);return true;}};
}
