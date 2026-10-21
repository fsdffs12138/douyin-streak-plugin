import {it,expect,vi,beforeEach} from 'vitest';
import {defaults,recordKey,dayAt,conversationId} from '../src/model';
let listener:any,alarmListener:any,local:any,session:any,executeCount:number,dispatch:any;
const p={name:'测试好友',avatar:'https://p3.douyinpic.com/a',avatarKey:'/a',id:JSON.stringify(['测试好友','/a']),streak:'3'};
const emoji={name:'续火花',image:'https://p3.douyinpic.com/e',asset:'/e',kind:'sticker',tab:'t',id:JSON.stringify(['sticker','t','/e'])};
const account='/me';
function request(type:string,data:any={},sender:any={id:'ext',url:'chrome-extension://ext/options.html',tab:{id:91},frameId:0}):Promise<any>{
  return new Promise(resolve=>listener({type,...data},sender,resolve));
}
async function settled(){for(let i=0;i<25;i++)await new Promise(r=>setTimeout(r,2));}
beforeEach(async()=>{
  vi.resetModules();
  local={state:defaults()};session={binding:{tabId:7,documentId:'doc',account,boundAt:Date.now()}};executeCount=0;
  local.state.settings.people=[p];local.state.settings.emoji=emoji;
  const storage=(obj:any)=>({get:async(k:string)=>structuredClone({[k]:obj[k]}),set:async(v:any)=>Object.assign(obj,structuredClone(v))});
  dispatch=async(_id:number,m:any)=>{
    if(m.type==='PING')return {ok:true,data:{documentId:'doc',account,chat:true}};
    if(m.type==='EXECUTE'){
      executeCount++;
      const permit=await request('PERMIT',{runId:m.payload.runId,documentId:'doc'},{id:'ext',tab:{id:7}});
      expect(permit.ok).toBe(true);
      return {ok:true,data:{status:'observed',detail:'网页已出现'}};
    }
    return {ok:true};
  };
  vi.stubGlobal('chrome',{
    storage:{local:storage(local),session:storage(session)},
    tabs:{sendMessage:async(...args:any[])=>dispatch(...args),query:async()=>[{id:7,title:'抖音聊天',url:'https://www.douyin.com/chat'}],get:async(id:number)=>({id,url:'https://www.douyin.com/chat'})},
    runtime:{id:'ext',getURL:(x:string)=>`chrome-extension://ext/${x}`,onMessage:{addListener:(l:any)=>listener=l},onInstalled:{addListener:()=>{}},onStartup:{addListener:()=>{}}},
    action:{onClicked:{addListener:()=>{}}},
    alarms:{get:async()=>({}),create:async()=>{},onAlarm:{addListener:(l:any)=>alarmListener=l}}
  });
  await import('../src/background');
});
it('在标签页中打开的配置页能读取状态、列出聊天页并绑定',async()=>{
  expect((await request('STATE')).ok).toBe(true);
  const tabs=await request('TABS');
  expect(tabs.ok).toBe(true);expect(tabs.data).toEqual([{id:7,title:'抖音聊天'}]);
  expect((await request('BIND',{tabId:7})).ok).toBe(true);
  expect(session.binding.tabId).toBe(7);
  expect(local.state.settings.enabled).toBe(false);
  expect(executeCount).toBe(0);
});
it.each([
  {id:'ext',url:'chrome-extension://ext/options.html'},
  {id:'ext',url:'chrome-extension://ext/options.html?view=setup#connect',tab:{id:91}}
])('允许自有配置页，兼容无标签页及查询参数：%j',async sender=>{
  expect((await request('STATE',{},sender)).ok).toBe(true);
});
it.each([
  {id:'other',url:'chrome-extension://ext/options.html',tab:{id:91}},
  {id:'ext',url:'chrome-extension://other/options.html',tab:{id:91}},
  {id:'ext',url:'https://www.douyin.com/chat',tab:{id:7}},
  {id:'ext',url:'chrome-extension://ext/options.html.evil',tab:{id:91}},
  {id:'ext',url:'chrome-extension://ext/another.html',tab:{id:91}},
  {id:'ext',tab:{id:91}}
])('拒绝配置页之外的来源：%j',async sender=>{
  expect((await request('STATE',{},sender)).ok).toBe(false);
  expect(executeCount).toBe(0);
});
it('重复点击和后续调度不会再次发送同一对象',async()=>{
  expect((await request('RUN')).ok).toBe(true);await settled();
  expect(executeCount).toBe(1);
  local.state.nextAllowed=0;
  alarmListener({name:'tick'});await settled();
  await request('RUN');await settled();
  expect(executeCount).toBe(1);
  expect(local.state.records[0].status).toBe('observed');
});
it('群聊配置可保存，模拟队列保留类型、标注记录并按天防重',async()=>{
  const group={...p,kind:'group',id:conversationId(p.name,p.avatarKey,'group')};
  expect((await request('SAVE',{settings:{...local.state.settings,people:[group]}})).ok).toBe(true);
  expect(local.state.settings.people[0].kind).toBe('group');
  await request('RUN');await settled();
  expect(executeCount).toBe(1);expect(local.state.records[0].person).toBe('[群聊] '+p.name);
  expect(local.state.records[0].key).toBe(recordKey(account,group.id));
  local.state.nextAllowed=0;await request('RUN');await settled();expect(executeCount).toBe(1);
});
it('刷新后的页面不能获得发送许可',async()=>{
  local.state.queue={day:dayAt(),ids:[p.id],account};
  local.state.active={runId:'r',key:'k',until:Date.now()+60000};
  const r=await request('PERMIT',{runId:'r',documentId:'old'},{id:'ext',tab:{id:7}});
  expect(r.ok).toBe(false);
});
it('页面通信丢失时停止自动发送并保留待核查记录',async()=>{
  dispatch=async(_id:number,m:any)=>{
    if(m.type==='PING')return {ok:true,data:{documentId:'doc',account,chat:true}};
    throw Error('port closed');
  };
  local.state.settings.enabled=true;
  await request('RUN');await settled();
  expect(local.state.records[0].status).toBe('uncertain');
  expect(local.state.settings.enabled).toBe(false);
  expect(local.state.queue).toBeNull();
});
it('后台重启后过期的在途任务被隔离，不重新发送',async()=>{
  const key=recordKey(account,p.id);
  local.state.records=[{key,day:dayAt(),person:p.name,account,emoji:'续火花',status:'sending',detail:'已签发一次发送许可',at:Date.now(),runId:'old'}];
  local.state.active={key,runId:'old',until:Date.now()-1};
  local.state.queue={day:dayAt(),ids:[p.id],account};
  alarmListener({name:'tick'});await settled();
  expect(local.state.records[0].status).toBe('uncertain');expect(executeCount).toBe(0);
});
it('网页脚本不能调用启动发送命令',async()=>{
  const r=await request('RUN',{}, {id:'ext',tab:{id:7},url:'https://www.douyin.com/chat'});
  expect(r.ok).toBe(false);expect(executeCount).toBe(0);
});
it('暂停后撤销未发出的许可',async()=>{
  local.state.queue={day:dayAt(),ids:[p.id],account};
  local.state.active={runId:'r',key:'k',until:Date.now()+60000};
  await request('PAUSE');
  const r=await request('PERMIT',{runId:'r',documentId:'doc'},{id:'ext',tab:{id:7}});
  expect(r.ok).toBe(false);
});
const panelSender={id:'ext',url:'https://www.douyin.com/chat',frameId:0,tab:{id:7}};
it('窗口面板使用单独消息通道，绑定目标不能伪造为其他标签页',async()=>{
  const r=await request('PANEL',{command:'BIND',data:{tabId:999}},panelSender);
  expect(r.ok).toBe(true);expect(session.binding.tabId).toBe(7);expect(executeCount).toBe(0);
});
it.each([
  {...panelSender,id:'other'},
  {...panelSender,frameId:1},
  {...panelSender,url:'https://www.douyin.com/user/1'},
  {...panelSender,url:'https://attacker.example/chat'}
])('拒绝其他扩展、子框架和其他页面的面板请求：%j',async sender=>{
  expect((await request('PANEL',{command:'STATE'},sender)).ok).toBe(false);
});
it('一键读取期间调度不切换聊天，只有持有者能释放读取锁',async()=>{
  const r=await request('PANEL',{command:'READ_START'},panelSender);expect(r.ok).toBe(true);
  local.state.queue={day:dayAt(),ids:[p.id],account};
  alarmListener({name:'tick'});await settled();expect(executeCount).toBe(0);
  await request('PANEL',{command:'READ_END',data:{token:r.data}},{...panelSender,tab:{id:8}});
  expect(local.state.reading).not.toBeNull();
  await request('PANEL',{command:'READ_END',data:{token:r.data}},panelSender);
  expect(local.state.reading).toBeNull();
});
it('未绑定的其他聊天窗口不能启动已绑定账号的任务',async()=>{
  const r=await request('PANEL',{command:'RUN'},{...panelSender,tab:{id:8}});
  expect(r.ok).toBe(false);expect(executeCount).toBe(0);
});
