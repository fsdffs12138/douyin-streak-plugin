import styles from './floating.css';
import {defaults,validImage,conversationLabel,type State,type Binding,type Person,type Emoji,type Settings} from './model';
import type {ScanProgress,ScanResult} from './scanner';

export const PANEL_HOST='douyin-streak-panel';
export interface PanelBridge {
  documentId:string;
  api:(command:string,data?:Record<string,unknown>)=>Promise<any>;
  scan:(progress:(p:ScanProgress)=>void,signal:AbortSignal)=>Promise<ScanResult>;
  emoji:()=>Promise<Emoji[]>;
}
export function createFloatingPanel(bridge:PanelBridge) {
  const host=document.createElement('div');host.id=PANEL_HOST;
  const root=host.attachShadow({mode:'closed'});
  root.innerHTML=`<style>${styles}</style>
    <button class="launcher" id="launcher" hidden aria-label="展开续火助手">续火</button>
    <div class="panel" id="panel" role="region" aria-label="续火助手">
      <header class="header" id="drag"><div class="brand"><span class="mark">续</span><div><strong>续火助手</strong><small id="bound">当前聊天窗口 · 未连接</small></div></div><button class="ghost" id="collapse" aria-label="收起面板">收起</button></header>
      <div class="body">
        <div id="notice" class="notice" role="status" aria-live="polite">在这里一键读取全部会话，无需自己翻页。</div>
        <section><div class="row spread"><h3>会话名单</h3><span id="count" class="count">已读取 0 · 已选 0</span></div>
          <div class="row"><button id="scan" class="primary" data-lock>一键读取全部会话</button><button id="stop" hidden>停止读取</button></div>
          <progress id="progress" class="progress" hidden aria-label="读取会话进度"></progress>
          <p>自动遍历左侧列表，不打开聊天记录。好友和群聊均可勾选；身份信息不完整的条目另行列出。</p>
          <input id="filter" class="filter" type="search" placeholder="筛选会话" aria-label="筛选会话">
          <select id="conversationKind" class="filter" aria-label="会话类型"><option value="">全部会话</option><option value="person">仅好友</option><option value="group">仅群聊</option></select>
          <div class="row spread"><button id="select" class="tiny ghost" data-lock>勾选筛选结果</button><button id="clear" class="tiny ghost" data-lock>清空勾选</button></div>
          <div id="people" class="people"><div class="empty">点击上方按钮，自动读取左侧全部会话。</div></div>
          <details id="skippedDetails" hidden><summary id="skippedSummary"></summary><div id="skippedRows" class="records"></div></details>
        </section>
        <section><div class="row spread"><h3>原生表情</h3><button id="emojiLoad" class="tiny" data-lock>读取表情</button></div>
          <div id="preview" class="preview">尚未选择表情</div>
          <details id="emojiDetails"><summary>选择表情</summary><input id="emojiFilter" type="search" placeholder="搜索表情名称" aria-label="搜索表情名称"><div id="emojis" class="grid"></div></details>
        </section>
        <section><div class="row spread"><h3>发送计划</h3><button id="bind" class="tiny" data-lock>连接当前会话</button></div>
          <div class="two"><label>每日时间（北京时间）<input id="time" type="time" value="09:00"></label><label>补发窗口 / 分钟<input id="grace" type="number" min="0" max="720" value="180"></label></div>
          <label class="check"><input id="enabled" type="checkbox">启用每日定时发送</label>
          <p>读取不会自动发送。最多选择 100 个对象；发送前需连接有本人历史消息的会话。</p>
          <div class="actions"><button id="save" class="primary" data-lock>保存配置</button><button id="dry" data-lock>只检查，不发送</button><button id="run" data-lock>立即发送</button><button id="pause" class="danger">暂停全部</button></div>
          <div id="confirm" class="confirm" hidden><strong>确认发送对象与表情</strong><p id="confirmText"></p><div class="row"><button id="confirmSend" class="primary" data-lock>确认发送</button><button id="confirmCancel">取消</button></div></div>
          <div id="task" class="status">自动发送默认关闭</div>
        </section>
        <section><details><summary>最近执行记录</summary><div id="records" class="records">暂无记录</div></details></section>
        <div class="footer">续火 1.2.0 · 本机保存 · 可拖动顶部 / 缩放右下角</div>
      </div>
    </div>`;
  document.body.append(host);
  const $=<T extends HTMLElement=HTMLElement>(id:string)=>root.getElementById(id) as T;
  let current:State=defaults(),binding:Binding|null=null,initialized=false,dirty=false,busy=false;
  let catalog:Person[]=[],selected=new Map<string,Person>(),emojis:Emoji[]=[],chosen:Emoji|null=null,controller:AbortController|null=null;
  const notice=(text:string,error=false)=>{$('notice').textContent=text;$('notice').classList.toggle('error',error);};
  function element<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string,cls?:string) {
    const el=document.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;return el;
  }
  function img(src:string,cls='') {const el=element('img',undefined,cls);el.alt='';el.loading='lazy';el.referrerPolicy='no-referrer';if(validImage(src))el.src=src;return el;}
  function lock(value:boolean) {busy=value;root.querySelectorAll<HTMLButtonElement>('[data-lock]').forEach(b=>b.disabled=value);}
  function bindAction(id:string,action:()=>Promise<void>) {
    $(id).addEventListener('click',async()=>{
      if(busy)return;lock(true);
      try {await action();} catch(e) {notice((e as Error).message,true);} finally{lock(false);}
    });
  }
  function available() {return [...new Map([...catalog,...selected.values()].map(p=>[p.id,p])).values()];}
  function filtered() {const q=$<HTMLInputElement>('filter').value.trim().toLowerCase(),kind=$<HTMLSelectElement>('conversationKind').value;return available().filter(p=>p.name.toLowerCase().includes(q)&&(!kind||(p.kind||'person')===kind));}
  function renderPeople() {
    const list=$('people');list.replaceChildren();
    for(const p of filtered()) {
      const row=element('label',undefined,'person'),check=element('input');check.type='checkbox';check.checked=selected.has(p.id);check.setAttribute('aria-label',`选择 ${conversationLabel(p)}`);
      check.addEventListener('change',()=>{
        if(check.checked&&selected.size>=100){check.checked=false;notice('最多选择 100 个发送对象；读取名单不受此限制。',true);return;}
        check.checked?selected.set(p.id,p):selected.delete(p.id);dirty=true;renderPeople();
      });
      row.append(check,img(p.avatar,'avatar'),element('span',conversationLabel(p),'person-name'),element('span',p.streak?(/^\d+$/.test(p.streak)?`${p.streak} 天`:p.streak):'','streak'));list.append(row);
    }
    if(!list.childElementCount)list.append(element('div',catalog.length?'没有匹配的会话':'点击上方按钮，自动读取左侧全部会话。','empty'));
    $('count').textContent=`已读取 ${catalog.length} · 已选 ${selected.size}`;
  }
  function renderEmoji() {
    const q=$<HTMLInputElement>('emojiFilter').value.trim().toLowerCase(),grid=$('emojis');grid.replaceChildren();
    const all=[...new Map([...emojis,...(chosen?[chosen]:[])].map(e=>[e.id,e])).values()];
    for(const e of all.filter(e=>e.name.toLowerCase().includes(q))) {
      const button=element('button',undefined,'emoji');button.setAttribute('aria-label',e.name);button.setAttribute('aria-pressed',String(e.id===chosen?.id));
      button.append(img(e.image),element('span',e.name));button.onclick=()=>{chosen=e;dirty=true;renderEmoji();};grid.append(button);
    }
    if(!grid.childElementCount)grid.append(element('div','先点击「读取表情」','empty'));
    const preview=$('preview');preview.replaceChildren();if(chosen)preview.append(img(chosen.image),element('span',chosen.name));else preview.textContent='尚未选择表情';
  }
  function settings():Settings {return {...current.settings,people:[...selected.values()],emoji:chosen,time:$<HTMLInputElement>('time').value,graceMinutes:Number($<HTMLInputElement>('grace').value),enabled:$<HTMLInputElement>('enabled').checked};}
  const isBound=()=>binding?.documentId===bridge.documentId;
  async function refresh() {
    const data=await bridge.api('STATE');current=data.state;binding=data.binding;
    if(!initialized||!dirty) {
      selected=new Map(current.settings.people.map(p=>[p.id,p]));chosen=current.settings.emoji;
      $<HTMLInputElement>('time').value=current.settings.time;$<HTMLInputElement>('grace').value=String(current.settings.graceMinutes);$<HTMLInputElement>('enabled').checked=current.settings.enabled;
      initialized=true;renderPeople();renderEmoji();
    }
    $('bound').textContent=isBound()?'当前聊天窗口 · 已连接':'当前聊天窗口 · 未连接';
    $('task').textContent=current.active?'正在执行，请勿切换聊天会话':current.queue?'发送队列等待下一次检查':current.settings.enabled?`每日 ${current.settings.time} 自动发送`:'自动发送已关闭';
    const labels:Record<string,string>={sending:'执行中',observed:'网页已出现',uncertain:'待核查',failed:'发送前停止',confirmed:'人工确认',skipped:'今日跳过'};
    const records=$('records');records.replaceChildren();
    for(const r of current.records.slice(0,30)) {
      const row=element('div',undefined,'record');row.append(element('strong',`${r.person} · ${labels[r.status]}`),element('small',`${r.day} · ${r.emoji} · ${r.detail}`));records.append(row);
    }
    if(!records.childElementCount)records.textContent='暂无记录';
  }
  async function ensureBound() {if(!isBound()){await bridge.api('BIND');const data=await bridge.api('STATE');binding=data.binding;current=data.state;if(!isBound())throw Error('当前页面连接未完成');$('bound').textContent='当前聊天窗口 · 已连接';}}
  bindAction('scan',async()=>{
    const data=await bridge.api('STATE');if(data.state.active||data.state.queue)throw Error('请先暂停发送队列，再读取会话');
    controller=new AbortController();$('stop').hidden=false;$('progress').hidden=false;
    notice('正在自动遍历左侧会话，请暂时不要滚动或切换聊天…');
    try {
      const result=await bridge.scan(p=>notice(`已读取 ${p.count} 个会话 · ${p.phase==='waiting'?'等待列表加载…':'正在自动向下读取…'}`),controller.signal);
      catalog=result.people;renderPeople();
      const skipped=result.skipped||[],excluded=$('skippedRows');excluded.replaceChildren();
      $('skippedDetails').hidden=!skipped.length;$('skippedSummary').textContent=`另有 ${skipped.length} 个不可选条目（查看原因）`;
      for(const item of skipped)excluded.append(element('div',`${item.name} · ${item.reason}`,'record'));
      notice(`${result.complete?'已遍历当前列表到底部':'部分读取'}：${result.people.length} 个可选会话（含 ${result.people.filter(p=>p.kind==='group').length} 个群聊）。${skipped.length?`另有 ${skipped.length} 个不可选条目，已列出原因。`:''}${result.ambiguous?`排除 ${result.ambiguous} 个身份不明确的会话。`:''}${result.reason||'已恢复原滚动位置，请勾选需要发送的对象。'}`,!result.complete);
    } finally{controller=null;$('stop').hidden=true;$('progress').hidden=true;}
  });
  $('stop').onclick=()=>controller?.abort();
  $('filter').oninput=renderPeople;$('emojiFilter').oninput=renderEmoji;
  $('conversationKind').onchange=renderPeople;
  bindAction('select',async()=>{for(const p of filtered()){if(selected.size>=100)break;selected.set(p.id,p);}dirty=true;renderPeople();if(filtered().length>100)notice('已勾选前 100 个筛选结果；每次最多选择 100 个发送对象。');});
  bindAction('clear',async()=>{selected.clear();dirty=true;renderPeople();});
  bindAction('emojiLoad',async()=>{
    const data=await bridge.api('STATE');if(data.state.active||data.state.queue)throw Error('请先暂停发送队列');
    emojis=await bridge.emoji();renderEmoji();$<HTMLDetailsElement>('emojiDetails').open=true;notice(`已读取 ${emojis.length} 个表情，点击预览仅选择，不会发送。`);
  });
  bindAction('bind',async()=>{const result=await bridge.api('BIND');$<HTMLInputElement>('enabled').checked=false;await refresh();notice(result.legacy?'仍检测到旧插件，请停用并刷新':'已连接当前聊天页，定时发送保持关闭。',result.legacy);});
  bindAction('save',async()=>{const value=settings();await ensureBound();await bridge.api('SAVE',{settings:value});dirty=false;await refresh();notice(value.enabled?'配置已保存，定时发送已开启。':'配置已保存，自动发送关闭。');});
  bindAction('dry',async()=>{if(dirty)throw Error('请先保存配置');await ensureBound();notice(`正在检查第一个所选会话「${current.settings.people[0]?.name||'未选择'}」及原生表情，不会发送…`);const result=await bridge.api('DRY');notice(result.detail,result.status!=='ready');});
  bindAction('run',async()=>{
    if(dirty)throw Error('请先保存配置');await ensureBound();
    if(!current.settings.people.length||!current.settings.emoji)throw Error('请先选择会话和表情并保存');
    $('confirmText').textContent=`向 ${current.settings.people.length} 个对象发送「${current.settings.emoji.name}」：${current.settings.people.map(conversationLabel).join('、')}`;$('confirm').hidden=false;
  });
  $('confirmCancel').onclick=()=>{$('confirm').hidden=true;};
  bindAction('confirmSend',async()=>{if(dirty)throw Error('配置已变化，请重新保存并确认');await bridge.api('RUN');$('confirm').hidden=true;await refresh();notice('发送队列已启动，请勿手动切换会话。');});
  $('pause').onclick=async()=>{controller?.abort();try{await bridge.api('PAUSE');$<HTMLInputElement>('enabled').checked=false;await refresh();notice('已暂停定时任务和队列。');}catch(e){notice((e as Error).message,true);}};
  for(const id of ['time','grace','enabled'])$(id).onchange=()=>{dirty=true;$('confirm').hidden=true;};
  $('collapse').onclick=()=>{$('panel').hidden=true;$('launcher').hidden=false;};
  $('launcher').onclick=()=>{$('panel').hidden=false;$('launcher').hidden=true;void refresh().catch(e=>notice((e as Error).message,true));};
  const panel=$('panel'),drag=$('drag');
  let dragging:{x:number;y:number;left:number;top:number}|null=null;
  drag.onpointerdown=e=>{if((e.target as Element).closest('button'))return;const r=panel.getBoundingClientRect();dragging={x:e.clientX,y:e.clientY,left:r.left,top:r.top};drag.setPointerCapture(e.pointerId);};
  drag.onpointermove=e=>{if(!dragging)return;panel.style.right='auto';panel.style.left=`${Math.max(0,Math.min(innerWidth-panel.offsetWidth,dragging.left+e.clientX-dragging.x))}px`;panel.style.top=`${Math.max(0,Math.min(innerHeight-50,dragging.top+e.clientY-dragging.y))}px`;};
  drag.onpointerup=()=>{dragging=null;};drag.onpointercancel=()=>{dragging=null;};
  void refresh().catch(e=>notice((e as Error).message,true));
  return {host,root,refresh,destroy:()=>{controller?.abort();host.remove();}};
}
