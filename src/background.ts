import {defaults,validateSettings,dayAt,isDue,recordKey,blocked,conversationLabel,type State,type Binding,type RecordEntry} from './model';
let serial:Promise<unknown>=Promise.resolve();
let working=false;
function locked<T>(fn:()=>Promise<T>):Promise<T> {
  const p=serial.then(fn,fn); serial=p.catch(()=>{}); return p;
}
async function state():Promise<State> {
  return (await chrome.storage.local.get('state')).state as State || defaults();
}
async function binding():Promise<Binding|null> {
  return (await chrome.storage.session.get('binding')).binding as Binding || null;
}
async function save(s:State) { await chrome.storage.local.set({state:s}); }
function log(s:State,text:string) {
  s.log.unshift({at:Date.now(),text});s.log=s.log.slice(0,300);
}
async function tabCall(tabId:number,type:string,payload?:unknown):Promise<any> {
  const response=await chrome.tabs.sendMessage(tabId,{type,payload});
  if(!response?.ok) throw Error(response?.error||'页面没有响应，请刷新并重新绑定');
  return response.data;
}
async function getBound():Promise<Binding> {
  const b=await binding();
  if(!b) throw Error('请先绑定一个已登录的抖音聊天标签页');
  const ping=await tabCall(b.tabId,'PING');
  if(!ping.chat||ping.documentId!==b.documentId) throw Error('聊天页已刷新或切换，请重新绑定');
  if(!ping.account||ping.account!==b.account) throw Error(ping.reason||'账号特征变化，请重新绑定');
  return b;
}
async function setup() {
  if(!await chrome.alarms.get('tick')) await chrome.alarms.create('tick',{periodInMinutes:0.5});
}
async function tick() {
  if(working) return;
  working=true;
  try {
    const prepared=await locked(async()=>{
      const s=await state();
      if(s.reading&&s.reading.until>Date.now()) return null;
      if(s.active) {
        if(s.active.until>Date.now()) return null;
        const r=s.records.find(r=>r.key===s.active!.key);
        if(r?.status==='sending') {r.status='uncertain';r.detail='执行中断，无法确认是否发送；不会自动重试';}
        s.active=null;log(s,'执行中断：当前对象已转为待核查');
        s.queue=null;s.settings.enabled=false;
        await save(s);
      }
      if(s.nextAllowed>Date.now()) return null;
      if(s.queue?.day!==dayAt()) s.queue=null;
      if(!s.queue && isDue(s.settings)) {
        const b=await binding();
        if(!b) return null;
        s.queue={day:dayAt(),ids:s.settings.people.map(p=>p.id),account:b.account};
      }
      if(!s.queue) return null;
      const ids=s.queue.ids.filter(id=>!blocked(s.records.find(r=>r.key===recordKey(s.queue!.account,id))));
      if(!ids.length) {s.queue=null;await save(s);return null;}
      let b:Binding;
      try{ b=await getBound(); }catch(e){
        const text=(e as Error).message;
        if(s.log[0]?.text!==text) log(s,text);
        s.queue=null;await save(s);return null;
      }
      if(s.queue.account!==b.account) {s.queue=null;log(s,'绑定账号已变化，原队列停止');await save(s);return null;}
      const person=s.settings.people.find(p=>p.id===ids[0]);
      if(!person||!s.settings.emoji){s.queue=null;await save(s);return null;}
      const runId=crypto.randomUUID();
      const key=recordKey(b.account,person.id);
      s.active={runId,key,until:Date.now()+90000};
      s.records.unshift({key,day:dayAt(),person:conversationLabel(person),account:b.account,emoji:s.settings.emoji.name,status:'sending',detail:'正在核对会话与表情',at:Date.now(),runId});
      s.records=s.records.filter(r=>r.day>=dayAt(Date.now()-45*86400000));
      log(s,`开始核对：${person.name}`);
      await save(s);
      return {b,person,emoji:s.settings.emoji,runId,key};
    });
    if(!prepared) return;
    let result:{status:RecordEntry['status'];detail:string};
    try {
      result=await tabCall(prepared.b.tabId,'EXECUTE',{person:prepared.person,emoji:prepared.emoji,account:prepared.b.account,documentId:prepared.b.documentId,runId:prepared.runId,deadline:Date.now()+75000});
      if(!['observed','failed','uncertain'].includes(result?.status)) throw Error('页面返回未知执行结果');
    } catch {
      result={status:'uncertain',detail:'页面通信中断，可能已发送，请人工核查；不会自动重试'};
    }
    await locked(async()=>{
      const s=await state();
      const r=s.records.find(r=>r.runId===prepared.runId);
      if(r&&r.status==='sending') {r.status=result.status;r.detail=result.detail;r.at=Date.now();}
      if(s.active?.runId===prepared.runId) s.active=null;
      s.nextAllowed=Date.now()+s.settings.gapSeconds*1000;
      log(s,`${prepared.person.name}：${result.detail}`);
      // Uncertainty stops the whole batch, rather than continuing under unknown state.
      if(result.status==='uncertain') {s.queue=null;s.settings.enabled=false;}
      await save(s);
    });
  } finally {working=false;}
}
async function handle(message:any,sender:chrome.runtime.MessageSender):Promise<any> {
  // Options pages opened in a tab also carry sender.tab. Authenticate the
  // extension ID and exact options document, not the absence of a tab.
  const senderPage=sender.url?.split(/[?#]/,1)[0];
  const extensionPage=sender.id===chrome.runtime.id && senderPage===chrome.runtime.getURL('options.html');
  const panelMessage=message?.type==='PANEL';
  const panelSource=sender.id===chrome.runtime.id && sender.tab?.id!=null && sender.frameId===0 && /^https:\/\/(www\.)?douyin\.com\/chat(?:[?#]|$)/.test(sender.url||'');
  if(panelMessage) {
    if(!panelSource||!['STATE','BIND','SAVE','DRY','RUN','PAUSE','READ_START','READ_END'].includes(message.command)) throw Error('不支持的窗口面板请求');
    const command=message.command;
    const data=message.data||{};
    // Only this extension's isolated content script can use PANEL; there is no
    // postMessage/custom-event bridge from the website into privileged actions.
    message={type:command,settings:data.settings,token:data.token};
    if(command==='BIND') message.tabId=sender.tab!.id;
    if(['SAVE','DRY','RUN'].includes(command)) {
      const b=await binding();
      if(!b||b.tabId!==sender.tab!.id) throw Error('请先连接当前聊天窗口');
      const ping=await tabCall(b.tabId,'PING');
      if(ping.documentId!==b.documentId) throw Error('页面已刷新，请重新连接当前会话');
    }
  }
  if(message.type==='PERMIT') {
    return locked(async()=>{
      const s=await state(),b=await binding();
      if(sender.id!==chrome.runtime.id||!s.active||s.active.runId!==message.runId||!b||b.tabId!==sender.tab?.id||b.documentId!==message.documentId||s.active.until<Date.now()||!s.queue) throw Error('任务已暂停或许可失效');
      const r=s.records.find(r=>r.runId===message.runId);
      if(!r||r.detail==='已签发一次发送许可') throw Error('发送许可已使用');
      r.detail='已签发一次发送许可';await save(s);
      return true;
    });
  }
  if(!extensionPage&&!panelMessage) throw Error('不支持的消息来源');
  if(['READ_START','READ_END'].includes(message.type)&&!panelMessage) throw Error('读取锁仅供窗口面板使用');
  if(message.type==='READ_START') return locked(async()=>{
    const s=await state();
    if(s.active||s.queue||(s.reading&&s.reading.until>Date.now())) throw Error('页面或队列正在工作，请先暂停或等待完成');
    const token=crypto.randomUUID();s.reading={token,tabId:sender.tab!.id!,until:Date.now()+240000};await save(s);return token;
  });
  if(message.type==='READ_END') return locked(async()=>{
    const s=await state();if(s.reading&&s.reading.token===message.token&&s.reading.tabId===sender.tab?.id){s.reading=null;await save(s);}return true;
  });
  if(message.type==='STATE') return {state:await state(),binding:await binding()};
  if(message.type==='TABS') {
    const tabs=await chrome.tabs.query({url:['https://www.douyin.com/chat*','https://douyin.com/chat*']});
    return tabs.map(t=>({id:t.id,title:t.title||'抖音聊天'}));
  }
  if(message.type==='BIND') return locked(async()=>{
    const before=await state();
    if(before.active||(before.reading&&before.reading.until>Date.now())) throw Error('请等待当前任务结束后绑定');
    const tab=await chrome.tabs.get(Number(message.tabId));
    const url=new URL(tab.url||'');
    if(!['www.douyin.com','douyin.com'].includes(url.hostname)||url.protocol!=='https:'||url.pathname!=='/chat') throw Error('请选择抖音聊天页');
    const ping=await tabCall(tab.id!,'PING');
    if(!ping.account) throw Error(ping.reason);
    await chrome.storage.session.set({binding:{tabId:tab.id,documentId:ping.documentId,account:ping.account,boundAt:Date.now()}});
    const s=await state();s.queue=null;s.settings.enabled=false;log(s,'页面已绑定；定时发送保持关闭，请确认会话后启用');await save(s);
    return {legacy:ping.legacy};
  });
  if(message.type==='PEOPLE'||message.type==='EMOJI') {
    if((await state()).active) throw Error('任务执行中，请先暂停');
    const b=await getBound();
    return tabCall(b.tabId,message.type);
  }
  if(message.type==='SAVE') return locked(async()=>{
    const s=await state();
    if(s.active||s.queue||(s.reading&&s.reading.until>Date.now())) throw Error('请先暂停队列或等待读取完成再修改配置');
    s.settings=validateSettings(message.settings);
    if(s.settings.enabled) await getBound();
    log(s,s.settings.enabled?'已启用每日定时发送':'配置已保存；定时发送关闭');
    await save(s);return true;
  });
  if(message.type==='PAUSE') {
    await locked(async()=>{const s=await state();s.settings.enabled=false;s.queue=null;log(s,'已暂停；已触发的消息无法撤回');await save(s);});
    const b=await binding();
    if(b) await chrome.tabs.sendMessage(b.tabId,{type:'CANCEL'}).catch(()=>{});
    return true;
  }
  if(message.type==='RUN') {
    const b=await getBound();
    await locked(async()=>{
      const s=await state();
      if(s.active||s.queue||(s.reading&&s.reading.until>Date.now())) throw Error('已有任务正在执行或正在读取会话');
      if(!s.settings.emoji||!s.settings.people.length) throw Error('请先保存会话与表情');
      s.queue={day:dayAt(),ids:s.settings.people.map(p=>p.id),account:b.account};
      log(s,'已启动所选会话的今日发送队列');await save(s);
    });
    void tick().catch(reportError);return true;
  }
  if(message.type==='DRY') {
    const b=await getBound(),s=await state();
    if(s.active||s.queue||(s.reading&&s.reading.until>Date.now())) throw Error('请先暂停队列或等待读取完成');
    if(!s.settings.emoji||!s.settings.people.length) throw Error('请先保存会话与表情');
    return tabCall(b.tabId,'EXECUTE',{person:s.settings.people[0],emoji:s.settings.emoji,account:b.account,documentId:b.documentId,dry:true});
  }
  if(message.type==='RESOLVE') return locked(async()=>{
    const s=await state();
    if(s.active) throw Error('执行中不可修改记录');
    const r=s.records.find(r=>r.key===message.key);
    if(!r) throw Error('记录不存在');
    if(!['confirmed','skipped'].includes(message.status)) throw Error('无效处理方式');
    r.status=message.status;r.detail=message.status==='confirmed'?'用户人工核实已发送':'用户决定今日跳过，不再发送';
    log(s,`${r.person}：${r.detail}`);await save(s);return true;
  });
  throw Error('未知操作');
}
function reportError(e:unknown) {
  void locked(async()=>{const s=await state();log(s,`执行错误：${(e as Error).message}`);await save(s);});
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  handle(message,sender).then(data=>respond({ok:true,data}),e=>respond({ok:false,error:(e as Error).message}));
  return true;
});
chrome.action.onClicked.addListener(()=>void chrome.runtime.openOptionsPage());
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='tick') void tick().catch(reportError);});
chrome.runtime.onInstalled.addListener(()=>void setup());
chrome.runtime.onStartup.addListener(()=>void setup());
void setup();
