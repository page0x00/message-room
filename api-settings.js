import {applyPoetry} from './poetry.js?v=2.7.2';
import {localConnections,directModel,directModels} from './local-api.js?v=2.7.2';
import {client} from './backend.js?v=2.7.2';
import {providers,protocols,parameters,normalizeProfile,buildRequest,probeTask} from './supabase/functions/_shared/ai-providers.js?v=2.7.2';

export function initAPISettings({$,state,node,showSheet,closeSheet,notice,ui}){
 const scrim=node('div','scrim');scrim.id='apiSettingsScrim';scrim.hidden=true;
 scrim.innerHTML=`<section class="sheet api-sheet" role="dialog" aria-modal="true" aria-labelledby="apiTitle">
  <header class="sheet-head"><div><span class="eyebrow">A CONNECTION OF YOUR OWN</span><h2 id="apiTitle">API 与模型</h2></div><button type="button" aria-label="关闭 API 设置" id="apiClose">×</button></header>
  <p class="sheet-note">选一个适合你的渠道，让小小陪伴读懂日常。填写接口、密钥和模型，即可连接。</p>
  <label class="field api-mode">连接方式<select id="apiMode"><option value="local">本机直连 · Key 不上传数据库</option><option value="cloud">账号同步 · 服务端加密保存</option></select></label><p class="sheet-note" id="apiModeHint"></p>
  <p id="apiStatus" class="api-status sheet-note" role="status" aria-live="polite"></p>
  <div class="api-layout"><aside class="api-connections"><p class="section-label">我的连接</p><div id="apiConnectionList"></div><button type="button" class="btn ghost wide" id="apiNew">＋ 新建配置</button><button type="button" class="text-btn" id="apiDefault">使用站点默认</button><p class="sheet-note" id="apiActive"></p><button type="button" class="text-btn" id="apiClearLocal">清空本机配置</button></aside>
  <form id="apiForm"><fieldset id="apiFields"><div class="api-form-head"><h3 id="apiFormTitle">新建连接</h3><button type="button" class="text-btn" id="apiDelete" hidden>删除配置</button></div>
   <div class="api-grid"><label class="field">配置名称<input id="apiName" maxlength="60" placeholder="可选，例如：我的 OpenRouter"/></label><label class="field">服务渠道<select id="apiProvider"></select></label>
   <label class="field">接口协议<select id="apiProtocol"></select></label><label class="field">鉴权方式<select id="apiAuth"><option value="bearer">Authorization · Bearer</option><option value="api-key">api-key · Azure</option><option value="anthropic">x-api-key · Anthropic</option><option value="google">x-goog-api-key · Gemini</option></select></label></div>
   <label class="field">接口地址 · Base URL<input id="apiBase" type="url" required autocomplete="off" spellcheck="false" placeholder="https://你的接口域名/v1"/></label><p class="sheet-note" id="apiAddressHint">第三方或公益站可直接修改地址；也接受完整接口路径。</p>
   <label class="field">API Key<input id="apiKey" type="password" autocomplete="new-password" spellcheck="false" maxlength="4096" placeholder="填写这个渠道的密钥"/></label><label class="check-field" id="apiRememberField"><input id="apiRemember" type="checkbox"/>记住本机（仅私人设备）</label><p class="sheet-note" id="apiKeyHint">密钥加密保存，不在页面回显或存入本机缓存。</p>
   <div class="api-model-row"><label class="field">模型 ID<input id="apiModel" list="apiModels" required maxlength="160" autocomplete="off" spellcheck="false" placeholder="填写模型 ID 或 Azure 部署名"/><datalist id="apiModels"></datalist></label><button type="button" class="btn ghost" id="apiFetchModels">拉取模型</button></div>
   <details class="api-details"><summary>生成参数 <span>留空使用默认</span></summary><div class="api-grid" id="apiParameters"></div>
    <div class="api-grid"><label class="field">思考强度<select id="apiReasoning"><option value="">使用默认</option><option>none</option><option>minimal</option><option>low</option><option>medium</option><option>high</option><option>xhigh</option></select></label><label class="field">请求超时 · 秒<input id="apiTimeout" type="number" min="5" max="55" step="1" value="55"/></label></div>
    <label class="field">停止词 · 每行一个，最多 4 个<textarea id="apiStop" rows="2" placeholder="留空，不设置停止词"></textarea></label>
    <label class="field">JSON 输出方式<select id="apiFormat"><option value="schema">严格 Schema · 模型须支持</option><option value="json">JSON 模式 · 模型须支持</option><option value="prompt">提示词约束 · 兼容性优先</option></select></label><p class="sheet-note">不同模型支持的参数不同。若提示参数不支持，可留空、排除对应字段，或改用提示词约束。</p>
   </details>
   <details class="api-details"><summary>高级参数与排除 <span>按服务商字段填写</span></summary>
    <label class="field">额外请求参数 · JSON 对象<textarea id="apiExtra" class="api-code" rows="5" spellcheck="false" placeholder='{"reasoning_effort":"low"}'>{}</textarea></label>
    <label class="field">排除参数 · 每行一个字段路径<textarea id="apiExclude" class="api-code" rows="4" spellcheck="false" placeholder="temperature&#10;response_format&#10;max_tokens"></textarea></label>
    <p class="sheet-note" id="apiExcludeHint">高级参数覆盖常用设置，排除规则最后执行。可用 reasoning.effort 这样的路径；必需字段和聊天内容不可改写。</p>
   </details>
   <details class="api-details"><summary>实际请求预览 <span>不含密钥和聊天</span></summary><pre id="apiPreview" class="api-code" tabindex="0"></pre></details>
   <div class="api-actions"><button type="button" class="btn ghost" id="apiTest">测试连接</button><button type="submit" class="btn primary" id="apiSave">保存并启用</button></div><p class="sheet-note">测试会发送一条简短测试文字，可能产生少量 API 费用。保存不会调用模型。启用后，在小小陪伴中确认对此渠道的聊天授权。</p>
  </fieldset></form></div></section>`;
 document.body.append(scrim);
 ui.registerPanel(scrim.id,'API 与模型');
 const surface=scrim.querySelector('.api-sheet'),header=surface.querySelector('.sheet-head');
 const exit=$('apiClose');header.remove();
 const intro=surface.querySelector(':scope > .sheet-note');intro.className='api-intro';intro.innerHTML='<span class="api-intro-mark" aria-hidden="true">✧</span><div><b>连接你喜欢的模型</b><p>填写接口、密钥和模型，让这里多一份陪伴。</p></div><span class="api-intro-art" aria-hidden="true"></span>';intro.append(exit);
 const formHead=surface.querySelector('.api-form-head');
 const identity=node('span','api-provider-mark','↗');identity.id='apiProviderMark';formHead.prepend(identity);
 const badge=node('span','api-active-badge');badge.id='apiProfileBadge';formHead.append(badge);
 const connectionMode=$('apiMode').parentElement,modeHint=$('apiModeHint');formHead.after(connectionMode,modeHint);
 surface.querySelector('.api-actions').before($('apiStatus'));
 const listHead=surface.querySelector('.api-connections .section-label');listHead.classList.add('api-list-head');const count=node('span','','0');count.id='apiConnectionCount';listHead.append(count);
 const tip=node('div','api-connection-tip');tip.innerHTML='<span aria-hidden="true">✧</span><p data-poem="23"></p>';surface.querySelector('.api-connections').append(tip);applyPoetry(tip);
 const modelInput=$('apiModel'),modelBox=node('div','api-model-input'),modelMenu=node('div','api-model-options'),modelToggle=node('button','api-model-toggle','⌄');let modelIndex=0;
 modelInput.removeAttribute('list');modelInput.setAttribute('role','combobox');modelInput.setAttribute('aria-autocomplete','list');modelInput.setAttribute('aria-controls','apiModelOptions');modelInput.setAttribute('aria-expanded','false');modelMenu.id='apiModelOptions';modelMenu.hidden=true;modelMenu.setAttribute('role','listbox');modelMenu.setAttribute('aria-label','可用模型');modelToggle.type='button';modelToggle.id='apiModelToggle';modelToggle.setAttribute('aria-label','选择可用模型');modelInput.after(modelBox);modelBox.append(modelInput,modelToggle,modelMenu);
 function closeModelList(){modelMenu.hidden=true;modelInput.setAttribute('aria-expanded','false');modelInput.removeAttribute('aria-activedescendant');}
 function highlightModel(index){const rows=[...modelMenu.children];if(!rows.length)return;modelIndex=(index+rows.length)%rows.length;rows.forEach((row,i)=>row.classList.toggle('highlighted',i===modelIndex));modelInput.setAttribute('aria-activedescendant',rows[modelIndex].id);rows[modelIndex].scrollIntoView({block:'nearest'});}
 function chooseModel(value){modelInput.value=value;closeModelList();modelInput.dispatchEvent(new Event('input',{bubbles:true}));closeModelList();modelInput.focus({preventScroll:true});closeModelList();}
 function showModelList(all=false){const query=all?'':modelInput.value.toLowerCase(),models=[...$('apiModels').options].map(o=>o.value).filter(id=>id.toLowerCase().includes(query)).slice(0,80);modelMenu.replaceChildren(...models.map((id,i)=>{const row=node('button','themed-option',id);row.type='button';row.id='apiModelOption'+i;row.setAttribute('role','option');row.setAttribute('aria-selected',String(id===modelInput.value));row.tabIndex=-1;row.onpointerdown=e=>e.preventDefault();row.onclick=()=>chooseModel(id);return row;}));modelMenu.hidden=!models.length;modelInput.setAttribute('aria-expanded',String(!!models.length));if(models.length)highlightModel(0);}
 modelInput.addEventListener('input',()=>showModelList());modelInput.addEventListener('focus',()=>showModelList());modelToggle.onclick=()=>{if(modelMenu.hidden){modelInput.focus({preventScroll:true});showModelList(true);}else closeModelList();};modelInput.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modelMenu.hidden){e.preventDefault();e.stopPropagation();closeModelList();}else if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();if(modelMenu.hidden)showModelList(true);else highlightModel(modelIndex+(e.key==='ArrowDown'?1:-1));}else if(e.key==='Enter'&&!modelMenu.hidden){e.preventDefault();modelMenu.children[modelIndex]?.click();}else if(e.key==='Tab')closeModelList();});document.addEventListener('pointerdown',e=>{if(!modelBox.contains(e.target))closeModelList();});document.addEventListener('mailbox:space-page',closeModelList);
 const keyInput=$('apiKey'),keyLabel=keyInput.parentElement,keyRow=node('div','api-key-row'),reveal=node('button','api-key-reveal','◉');reveal.type='button';reveal.id='apiRevealKey';reveal.setAttribute('aria-label','显示密钥');keyInput.after(keyRow);keyRow.append(keyInput,reveal);reveal.onclick=()=>{const show=keyInput.type==='password';keyInput.type=show?'text':'password';reveal.setAttribute('aria-label',show?'隐藏密钥':'显示密钥');};
 const validate=node('button','btn ghost','✓ 检查格式');validate.id='apiValidateKey';validate.type='button';keyRow.append(validate);validate.onclick=()=>{try{draft();if(!keyInput.value.trim()&&!data?.profiles.find(p=>p.id===selected)?.has_key)throw new Error('请填写这个渠道的 Key。');status('接口地址与配置格式有效。密钥是否可用，请点击测试连接。');}catch(e){status(e.message);}};
 const shortcut=node('button','relation-card');shortcut.id='apiSpaceBtn';shortcut.type='button';shortcut.innerHTML='<span class="feature-symbol">✧</span><span><b>API 与模型</b><small>管理你的模型连接</small></span><i>›</i>';document.querySelector('.relation-grid').append(shortcut);shortcut.onclick=()=>void open();
 const entry=node('button','btn ghost wide','API 与模型');entry.id='apiSettingsBtn';$('settingsScrim').querySelector('.version-label').before(entry);
 for(const p of providers){const opt=node('option','',p.name);opt.value=p.id;$('apiProvider').append(opt);}
 for(const [key,label] of Object.entries(protocols)){const opt=node('option','',label);opt.value=key;$('apiProtocol').append(opt);}
 for(const p of parameters){const label=node('label','field',p.label),input=node('input');input.id='apiParam_'+p.key;input.type='number';input.min=p.min;input.max=p.max;input.step=p.step;input.placeholder=p.key==='max_tokens'?'默认 1800':'使用默认';label.append(input);$('apiParameters').append(label);}
 let data=null,selected=null,busy=false,epoch=0,mode='local',pending=null;
 const fresh=s=>s.epoch===epoch&&s.user===state.userId&&!scrim.hidden;
 const snap=()=>({epoch,user:state.userId});
 const status=text=>{$('apiStatus').textContent=text;$('apiStatus').dataset.state=/连接成功|已保存并启用/.test(text)?'success':'';};
 async function invoke(body){
  if(mode==='local'){
   if(!body)return localConnections.view(state.userId);
   if(['test','models'].includes(body.action)){
    const key=localConnections.credential(state.userId,body.id,body.profile,body.key);pending=new AbortController();const options={signal:pending.signal};
    if(body.action==='models')return {models:await directModels(body.profile,key,options)};
    const started=Date.now(),result=await directModel(body.profile,key,probeTask,options);if(result?.ok!==true)throw new Error('接口已响应，但未返回符合要求的 JSON。');return {ok:true,elapsed_ms:Date.now()-started};
   }
   return localConnections.change(state.userId,body);
  }
  const {data,error}=await client(true).functions.invoke('mailbox-api',body?{body}:{method:'GET'});if(error){let message;try{message=(await error.context?.json())?.error;}catch{}throw new Error(message||'API 设置暂时无法连接，请先部署新版 mailbox-api 函数。');}return data;}
 function lock(value){busy=value;$('apiFields').disabled=value||!data;$('apiNew').disabled=value||!data;$('apiDefault').disabled=value||!data;for(const b of $('apiConnectionList').querySelectorAll('button'))b.disabled=value;}
 function drawList(){
  $('apiConnectionList').replaceChildren(...data.profiles.map(p=>{const b=node('button','api-connection');b.type='button';b.setAttribute('aria-pressed',String(p.id===selected));const mark=node('span','api-connection-mark',({openrouter:'↗',openai:'◎',anthropic:'AI',deepseek:'D',gemini:'✧',azure:'A'})[p.provider]||'↗'),copy=node('span','api-connection-copy');copy.append(node('b','',p.name),node('small',p.id===data.active_id?'api-enabled':'',p.id===data.active_id?'● 已启用':'○ 未启用'),node('small','',p.model));b.append(mark,copy,node('i','','›'));b.onclick=()=>{fill(p);drawList();status('');};return b;}));
  if(!data.profiles.length){for(const id of ['openrouter','openai','anthropic','deepseek']){const provider=providers.find(p=>p.id===id);if(!provider)continue;const button=node('button','api-preset'),mark=node('span','api-connection-mark',({openrouter:'↗',openai:'◎',anthropic:'AI',deepseek:'D'})[id]),copy=node('span','api-connection-copy');button.type='button';copy.append(node('b','',provider.name),node('small','','点击配置连接'));button.append(mark,copy);button.onclick=()=>{fill(null);$('apiProvider').value=id;$('apiProvider').dispatchEvent(new Event('change',{bubbles:true}));$('apiName').value=provider.name;$('apiFormTitle').textContent=provider.name;$('apiProviderMark').textContent=mark.textContent;};$('apiConnectionList').append(button);}}
  $('apiDefault').hidden=!data.active_id&&!data.default_profile;$('apiClearLocal').hidden=mode!=='local'||!data.profiles.length;$('apiConnectionCount').textContent=data.profiles.length;const active=data.profiles.find(p=>p.id===data.active_id)||data.default_profile;$('apiActive').textContent=active?'当前：'+active.name+' · '+active.model:'还没有启用的连接。';$('apiDefault').textContent=mode==='local'?'停用本机连接':data.default_profile?'使用站点默认':'停用个人连接';
 }
 function protocolFields(){const protocol=$('apiProtocol').value;
  for(const p of parameters){const enabled=!p.only||p.only.includes(protocol);$('apiParam_'+p.key).disabled=!enabled;$('apiParam_'+p.key).parentElement.hidden=!enabled;}
  $('apiParam_temperature').max=protocol==='anthropic'?1:2;
  $('apiReasoning').disabled=!['chat','responses'].includes(protocol);$('apiReasoning').parentElement.hidden=$('apiReasoning').disabled;
  $('apiStop').disabled=protocol==='responses';$('apiStop').parentElement.hidden=$('apiStop').disabled;
  for(const opt of $('apiFormat').options)opt.disabled=protocol==='anthropic'&&opt.value!=='prompt';if(protocol==='anthropic')$('apiFormat').value='prompt';
  $('apiExclude').placeholder=protocol==='gemini'?'generationConfig.temperature\ngenerationConfig.responseMimeType\ngenerationConfig.responseJsonSchema':protocol==='responses'?'temperature\ntext.format\nreasoning.effort':'temperature\nresponse_format\nmax_tokens';
 }
 function fill(profile){
  selected=profile?.id||null;const preset=providers.find(p=>p.id===(profile?.provider||'openrouter'));
  $('apiForm').reset();$('apiMode').value=mode;closeModelList();$('apiFormTitle').textContent=profile?.name||'新建连接';$('apiProviderMark').textContent=({openrouter:'↗',openai:'◎',anthropic:'AI',deepseek:'D',gemini:'✧',azure:'A'})[preset.id]||'↗';$('apiProfileBadge').textContent=selected&&selected===data?.active_id?'● 已启用':'待配置';$('apiKey').type='password';$('apiRevealKey').setAttribute('aria-label','显示密钥');$('apiDelete').hidden=!selected;
  for(const [id,key] of Object.entries({apiName:'name',apiProvider:'provider',apiProtocol:'protocol',apiAuth:'auth',apiBase:'base_url',apiModel:'model',apiFormat:'format'}))$(id).value=profile?.[key]??(key==='provider'?preset.id:preset[key])??'';
  $('apiName').value=profile?.name||'';$('apiTimeout').value=profile?.timeout||55;
  for(const p of parameters)$('apiParam_'+p.key).value=profile?.params?.[p.key]??'';
  $('apiReasoning').value=profile?.params?.reasoning_effort||'';$('apiStop').value=(profile?.params?.stop||[]).join('\n');
  $('apiExtra').value=JSON.stringify(profile?.extra||{},null,2);$('apiExclude').value=(profile?.exclude||[]).join('\n');$('apiModels').replaceChildren();
  $('apiKey').placeholder=profile?.has_key?'已保存 · 留空保留原密钥':'填写这个渠道的密钥';
  $('apiRemember').checked=!!data?.remember;
  $('apiKeyHint').textContent=mode==='local'?'Key 仅由浏览器发送到你填写的渠道。默认本次标签页有效，勾选后保存在此浏览器；换域名须重新填写。':profile?.has_key?'密钥已加密保存。换域名时须重新填写对应渠道的密钥。':'密钥加密保存，不在页面回显或存入本机缓存。';
  protocolFields();preview();
 }
 function draft(forModels=false){
  const params={};for(const p of parameters){const el=$('apiParam_'+p.key);if(!el.disabled&&el.value!=='')params[p.key]=Number(el.value);}
  if(!$('apiReasoning').disabled&&$('apiReasoning').value)params.reasoning_effort=$('apiReasoning').value;
  if(!$('apiStop').disabled&&$('apiStop').value.trim())params.stop=$('apiStop').value.split('\n').filter(Boolean);
  let extra;try{extra=JSON.parse($('apiExtra').value||'{}');}catch{throw new Error('高级参数不是有效 JSON，请检查引号和逗号。');}
  return normalizeProfile({name:$('apiName').value||providers.find(p=>p.id===$('apiProvider').value)?.name,provider:$('apiProvider').value,protocol:$('apiProtocol').value,auth:$('apiAuth').value,base_url:$('apiBase').value,model:$('apiModel').value||(forModels?'model-list':''),format:$('apiFormat').value,timeout:Number($('apiTimeout').value),params,extra,exclude:$('apiExclude').value.split(/[\s,，]+/).filter(Boolean)});
 }
 function preview(){try{$('apiPreview').textContent=JSON.stringify(buildRequest(draft(),probeTask),null,2);}catch(e){$('apiPreview').textContent=e.message;}}
 async function loadMode(){
  epoch++;pending?.abort();data=null;selected=null;mode=$('apiMode').value;$('apiKey').value='';$('apiConnectionList').replaceChildren();$('apiActive').textContent='';$('apiRememberField').hidden=mode!=='local';$('apiClearLocal').hidden=mode!=='local';
  $('apiModeHint').textContent=mode==='local'?'配置留在此浏览器。Key 只发给填写的渠道；渠道需允许浏览器直连。':'配置随账号同步。保存并启用后，Key 交给服务端加密保存并由服务端调用。';
  status('正在读取配置…');lock(true);const s=snap();
  if(mode==='cloud'&&!state.userId){status('请先登录账号，再管理同步连接。');lock(false);return;}
  try{const result=await invoke();if(!fresh(s))return;data=result;fill(data.profiles.find(p=>p.id===data.active_id)||null);drawList();status(mode==='local'?'填好 URL、Key 和模型，即可测试或保存启用。':data.encryption_ready?'密钥只保存在服务端。':'站点尚未配置密钥加密；请先完成 API 后端部署。');}catch(e){if(fresh(s))status(e.message);}finally{if(fresh(s))lock(false);}
 }
 async function open(){closeSheet('settingsScrim');showSheet(scrim.id);$('apiMode').value=localConnections.mode(state.userId)||'local';await loadMode();}
 async function action(kind){
  if(busy||!data)return;
  const s=snap();
  let body={action:kind,id:selected,revision:data.revision};
  try{if(['save','test','models'].includes(kind)){if(kind!=='models'&&!$('apiForm').reportValidity())return;body={...body,profile:draft(kind==='models'),key:$('apiKey').value,remember:$('apiRemember').checked,activate:kind==='save'};buildRequest(body.profile,probeTask);}
   if(kind==='delete'&&(!await notice('删除这套 API 配置？','将同时删除已存密钥。'+(data.default_profile?'当前正在使用时会恢复站点默认连接。':'当前正在使用时会停用此连接。'),'删除配置',true)||!fresh(s)))return;
   if(kind==='activate')body.id=null;
   lock(true);status(kind==='test'?'正在测试连接…':kind==='models'?'正在读取模型列表…':'正在保存…');
   try{const result=await invoke(body);if(!fresh(s))return;
    if(kind==='test')status('连接成功 · '+result.elapsed_ms+' ms · JSON 输出可用。');
    else if(kind==='models'){$('apiModels').replaceChildren(...result.models.map(id=>{const o=node('option');o.value=id;return o;}));status(result.models.length?'已读取 '+result.models.length+' 个模型，点模型输入框选择或继续手动填写。':'渠道未提供模型列表，请手动填写模型 ID。');}
    else{if(mode==='cloud'&&['save','activate'].includes(kind))localConnections.choose(state.userId,'cloud');data=result;fill(data.profiles.find(p=>p.id===(result.saved_id||data.active_id))||null);drawList();status(kind==='save'?(mode==='local'?'已保存并启用本机直连。Key 不上传数据库。':'已保存并启用。请到小小陪伴确认当前渠道的聊天授权。'):kind==='delete'?'配置及密钥已删除。':data.default_profile?'已切换到站点默认连接。':(mode==='local'?'已停用本机连接。':'已停用个人连接。'));document.dispatchEvent(new Event('mailbox:api-changed'));}
   }catch(e){if(fresh(s))status(e.message);}finally{if(fresh(s))lock(false);}
  }catch(e){if(fresh(s))status(e.message);}
 }
 $('apiForm').onsubmit=e=>{e.preventDefault();void action('save');};$('apiTest').onclick=()=>void action('test');$('apiFetchModels').onclick=()=>void action('models');$('apiDelete').onclick=()=>void action('delete');$('apiDefault').onclick=()=>void action('activate');
 $('apiNew').onclick=()=>{fill(null);drawList();status('');$('apiName').focus();};$('apiForm').addEventListener('input',preview);
 $('apiProvider').onchange=()=>{const p=providers.find(p=>p.id===$('apiProvider').value);$('apiProtocol').value=p.protocol;$('apiAuth').value=p.auth;$('apiBase').value=p.base_url;$('apiFormat').value=p.format;$('apiKey').value='';$('apiModels').replaceChildren();protocolFields();preview();};
 $('apiProtocol').onchange=()=>{protocolFields();preview();};entry.onclick=()=>void open();$('apiClose').onclick=()=>closeSheet(scrim.id);scrim.onclick=null;
 const reset=()=>{epoch++;pending?.abort();pending=null;data=null;selected=null;busy=false;$('apiKey').value='';$('apiForm').reset();$('apiConnectionList').replaceChildren();scrim.hidden=true;};
 document.addEventListener('mailbox:sheet-close',e=>{if(e.detail.id===scrim.id)reset();});document.addEventListener('mailbox:api-open',()=>void open());document.addEventListener('mailbox:space-page',e=>{if(e.detail.previous===scrim.id&&e.detail.panel!==scrim.id)reset();});document.addEventListener('mailbox:space-close',()=>{if(state.spacePanel===scrim.id)reset();});
 $('apiMode').onchange=()=>void loadMode();
 $('apiClearLocal').onclick=async()=>{const s=snap();if(mode!=='local'||!await notice('清空本机配置？','只清除这个账号在此浏览器保存的连接和 Key。','清空本机配置',true)||!fresh(s))return;try{localConnections.clear(s.user);await loadMode();document.dispatchEvent(new Event('mailbox:api-changed'));}catch(e){if(fresh(s))status(e.message);}};
 fill(null);return {open,reset,identityChanged(previous){if(previous)localConnections.clearSession(previous);reset();}};
}
