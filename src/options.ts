import {defaults,dayAt,validImage,conversationLabel,type State,type Person,type Emoji,type Settings,type Binding} from './model';
import {icon,type IconName} from './icons';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
for(const [id,name] of Object.entries({pause:'pause',refreshTabs:'refresh',bind:'link',readPeople:'scan',readEmoji:'download',save:'save',dry:'inspect',run:'send',export:'download'})){
  const template=document.createElement('template');template.innerHTML=icon(name as IconName);$(id)?.prepend(template.content);
}
let current=defaults(),bound:Binding|null=null,people:Person[]=[],emojis:Emoji[]=[],selected=new Map<string,Person>(),chosen:Emoji|null=null;
let dirty=false,initialized=false;
const labels:Record<string,string>={sending:'执行中',observed:'网页已出现',failed:'发送前停止',uncertain:'待核查',confirmed:'人工确认',skipped:'今日跳过'};
async function api(type:string,data:object={}):Promise<any>{
  if(!globalThis.chrome?.runtime?.id) throw Error('此页面是界面预览。请将 dist 文件夹加载为 Chrome 扩展后使用。');
  const r=await chrome.runtime.sendMessage({type,...data});
  if(!r?.ok)throw Error(r?.error||'扩展没有响应');return r.data;
}
function notice(text:string,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string,className?:string):HTMLElementTagNameMap[K]{
  const e=document.createElement(tag);if(text)e.textContent=text;if(className)e.className=className;return e;
}
function image(src:string,alt:string,cls=''){
  const img=node('img',undefined,cls);img.alt=alt;img.referrerPolicy='no-referrer';img.loading='lazy';
  if(validImage(src)) img.src=src;
  img.addEventListener('error',()=>{img.removeAttribute('src');img.alt='预览过期，请重新读取';},{once:true});
  return img;
}
function action(id:string,fn:()=>Promise<void>){
  $(id).addEventListener('click',async()=>{
    const button=$<HTMLButtonElement>(id);button.disabled=true;
    try{await fn();}catch(e){notice((e as Error).message,true);}finally{button.disabled=false;}
  });
}
function setDirty(){dirty=true;}
function renderPeople(){
  const filter=$<HTMLInputElement>('peopleFilter').value.trim().toLowerCase();
  const kind=$<HTMLSelectElement>('conversationKind').value;
  const all=new Map([...people,...selected.values()].map(p=>[p.id,p]));
  const root=$('people');root.replaceChildren();
  for(const p of all.values()){
    if((filter&&!p.name.toLowerCase().includes(filter))||(kind&&(p.kind||'person')!==kind))continue;
    const row=node('label',undefined,'person'),box=node('input');box.type='checkbox';box.checked=selected.has(p.id);box.setAttribute('aria-label',`选择 ${conversationLabel(p)}`);
    box.addEventListener('change',()=>{box.checked?selected.set(p.id,p):selected.delete(p.id);setDirty();renderPeople();});
    const info=node('div');info.append(node('span',conversationLabel(p),'person-name'),node('small',p.streak?`火花 ${p.streak}${/^\d+$/.test(p.streak)?' 天':''}`:'已有会话'));
    row.append(box,image(p.avatar,'','avatar'),info);root.append(row);
  }
  if(!root.childElementCount)root.append(node('p',all.size?'没有匹配的会话':'绑定后点击「读取会话」，好友和群聊会显示在这里。','empty'));
  $('peopleCount').textContent=`已选 ${selected.size} 个会话`;
}
function renderEmoji(){
  const filter=$<HTMLInputElement>('emojiFilter').value.trim().toLowerCase(),kind=$<HTMLSelectElement>('emojiKind').value;
  const all=new Map([...emojis,...(chosen?[chosen]:[])].map(e=>[e.id,e]));
  const root=$('emojis');root.replaceChildren();
  for(const e of all.values()){
    if((kind&&kind!==e.kind)||(filter&&!e.name.toLowerCase().includes(filter)))continue;
    const button=node('button',undefined,'emoji');button.setAttribute('aria-pressed',String(chosen?.id===e.id));button.setAttribute('aria-label',e.name);
    button.append(image(e.image,e.name),node('span',e.name));
    button.addEventListener('click',()=>{chosen=e;setDirty();renderEmoji();renderPreview();});
    root.append(button);
  }
  if(!root.childElementCount)root.append(node('p',all.size?'没有匹配的表情':'请先在抖音打开任意会话，再读取表情。','empty'));
}
function renderPreview(){
  const root=$('preview');root.replaceChildren();
  if(chosen)root.append(image(chosen.image,chosen.name),node('span',`${chosen.name} · ${chosen.kind==='small'?'普通表情':'原生贴纸'}`));
  else root.append(node('span','尚未选择表情','preview-placeholder'));
}
function formSettings():Settings{
  return {enabled:$<HTMLInputElement>('enabled').checked,time:$<HTMLInputElement>('time').value,graceMinutes:Number($<HTMLInputElement>('grace').value),gapSeconds:Number($<HTMLInputElement>('gap').value),people:[...selected.values()],emoji:chosen};
}
async function refreshTabs(){
  const tabs=await api('TABS'),el=$<HTMLSelectElement>('tabs');el.replaceChildren();
  el.append(new Option(tabs.length?'选择一个抖音聊天标签页':'未找到抖音聊天页',''));
  for(const t of tabs)el.append(new Option(`${t.title}（${t.id}）`,String(t.id)));
  if(bound&&tabs.some((t:any)=>t.id===bound!.tabId))el.value=String(bound.tabId);
  else if(tabs.length===1)el.value=String(tabs[0].id);
}
function renderState(){
  const conn=$('connection');conn.textContent=bound?'已绑定聊天页':'尚未绑定';conn.classList.toggle('connected',!!bound);
  $('queueStatus').textContent=current.active?'正在执行一个会话，请勿操作抖音页面':current.queue?'队列等待下一次检查':current.settings.enabled?`每日 ${current.settings.time} 自动发送 · 北京时间`:'尚无执行中的任务';
  const today=current.records.filter(r=>r.day===dayAt()&&(!bound||r.account===bound.account));
  $('observedCount').textContent=String(today.filter(r=>['observed','confirmed'].includes(r.status)).length);
  $('uncertainCount').textContent=String(today.filter(r=>r.status==='uncertain').length);
  $('failedCount').textContent=String(today.filter(r=>r.status==='failed').length);
  const rows=$('records');rows.replaceChildren();
  for(const r of current.records.slice(0,200)){
    const tr=node('tr');
    tr.append(node('td',new Date(r.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})),node('td',r.person),node('td',r.emoji),node('td',labels[r.status]||r.status,`status-${r.status}`));
    const detail=node('td');detail.append(node('div',r.detail));
    if(['uncertain','failed'].includes(r.status)){
      for(const [status,text] of [['confirmed','我已核实发送'],['skipped','今日跳过']]){
        const b=node('button',text);b.disabled=!!current.active;b.onclick=async()=>{b.disabled=true;try{await api('RESOLVE',{key:r.key,status});await load();}catch(e){notice((e as Error).message,true);}finally{b.disabled=false;}};detail.append(b);
      }
    }
    tr.append(detail);rows.append(tr);
  }
  if(!rows.childElementCount){const tr=node('tr'),td=node('td','还没有发送记录','empty');td.colSpan=5;tr.append(td);rows.append(tr);}
  const logs=$('logs');logs.replaceChildren(...current.log.map(l=>node('p',`${new Date(l.at).toLocaleTimeString('zh-CN')}  ${l.text}`)));
  if(!current.log.length)logs.textContent='暂无日志';
}
async function load(){
  const data=await api('STATE');current=data.state;bound=data.binding;
  if(!initialized){
    const s=current.settings;selected=new Map(s.people.map(p=>[p.id,p]));chosen=s.emoji;
    $<HTMLInputElement>('time').value=s.time;$<HTMLInputElement>('grace').value=String(s.graceMinutes);$<HTMLInputElement>('gap').value=String(s.gapSeconds);$<HTMLInputElement>('enabled').checked=s.enabled;
    initialized=true;renderPeople();renderEmoji();renderPreview();
  } else if(!dirty) $<HTMLInputElement>('enabled').checked=current.settings.enabled;
  renderState();
}
action('refreshTabs',refreshTabs);
action('bind',async()=>{
  const tabId=Number($<HTMLSelectElement>('tabs').value);if(!tabId)throw Error('请先选择聊天标签页');
  const data=await api('BIND',{tabId});await load();
  $<HTMLInputElement>('enabled').checked=false;
  notice(data.legacy?'已绑定，但检测到旧续火助手。请停用旧插件、刷新抖音后重新绑定；新插件会拒绝同时发送。':'已绑定。可以读取会话和表情。',data.legacy);
});
action('readPeople',async()=>{
  notice('正在读取已有会话，请暂时不要操作抖音页面…');
  const data=await api('PEOPLE');people=data.people;renderPeople();
  const skipped=data.skipped||[];$('skippedDetails').hidden=!skipped.length;$('skippedSummary').textContent=`另有 ${skipped.length} 个不可选条目（查看原因）`;
  $('skippedRows').replaceChildren(...skipped.map((s:{name:string;reason:string})=>node('p',`${s.name} · ${s.reason}`)));
  notice(`${data.complete===false?'部分读取':'已遍历当前列表到底部，可选'} ${people.length} 个会话${skipped.length?`；另有 ${skipped.length} 个不可选条目`:''}${data.ambiguous?`；已排除 ${data.ambiguous} 个无法区分的同名同头像会话`:''}。${data.reason||'请勾选需要发送的会话。'}`,data.complete===false);
});
action('readEmoji',async()=>{
  notice('正在读取原生表情分类，不会点击或发送表情…');
  emojis=await api('EMOJI');renderEmoji();notice(`已读取 ${emojis.length} 个原生表情。部分小表情没有名称，可按预览选择。`);
});
action('clearPeople',async()=>{selected.clear();setDirty();renderPeople();});
action('save',async()=>{await api('SAVE',{settings:formSettings()});dirty=false;await load();notice('配置已保存。'+(current.settings.enabled?'每日定时发送已启用。':'定时发送保持关闭。'));});
action('pause',async()=>{await api('PAUSE');$<HTMLInputElement>('enabled').checked=false;await load();notice('已暂停队列和定时任务；已触发的消息无法撤回。');});
action('dry',async()=>{
  if(dirty)throw Error('请先保存配置，再检查');
  notice(`正在检查第一个所选会话「${current.settings.people[0]?.name||'未选择'}」的会话和表情，不会发送…`);
  const r=await api('DRY');notice(r.detail,r.status!=='ready');
});
action('run',async()=>{
  if(dirty)throw Error('请先保存配置，再发送');
  if(!current.settings.people.length||!current.settings.emoji)throw Error('先选择会话和表情并保存');
  $('confirmText').textContent=`向 ${current.settings.people.length} 个所选会话发送「${current.settings.emoji.name}」：${current.settings.people.map(conversationLabel).join('、')}`;
  const dialog=$<HTMLDialogElement>('confirm');dialog.returnValue='cancel';dialog.showModal();
  const choice=await new Promise<string>(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue),{once:true}));
  if(choice!=='send')return;
  await api('RUN');await load();notice('发送队列已启动。请保持抖音聊天页打开，不要手动切换会话。');
});
action('export',async()=>{
  await load();
  const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),records:current.records,log:current.log},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=`续火记录-${dayAt()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
for(const id of ['time','grace','gap','enabled'])$(id).addEventListener('change',setDirty);
$('peopleFilter').addEventListener('input',renderPeople);$('emojiFilter').addEventListener('input',renderEmoji);$('emojiKind').addEventListener('change',renderEmoji);
$('conversationKind').addEventListener('change',renderPeople);
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
void load().then(refreshTabs).catch(e=>{
  const installed=!!globalThis.chrome?.runtime?.id;
  $<HTMLSelectElement>('tabs').replaceChildren(new Option(installed?'连接失败，请重新加载扩展后刷新此页':'请加载扩展后刷新列表',''));
  notice((e as Error).message,true);
});
if(globalThis.chrome?.storage)chrome.storage.onChanged.addListener((changes,area)=>{if((area==='local'&&changes.state)||(area==='session'&&changes.binding))void load().catch(()=>{});});
