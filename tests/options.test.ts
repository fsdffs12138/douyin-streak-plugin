// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {it,expect,vi,beforeEach} from 'vitest';
import {defaults,conversationId} from '../src/model';
let state:any,requests:any[],catalog:any[];
const person={name:'测试好友',avatar:'https://p3.douyinpic.com/a',avatarKey:'/a',id:JSON.stringify(['测试好友','/a']),streak:'3'};
const emoji={name:'续火花',image:'https://p3.douyinpic.com/e',asset:'/e',kind:'sticker',tab:'t',id:JSON.stringify(['sticker','t','/e'])};
beforeEach(async()=>{
  vi.resetModules();state=defaults();requests=[];catalog=[person];
  document.documentElement.innerHTML=readFileSync('public/options.html','utf8');
  vi.stubGlobal('chrome',{
    runtime:{id:'ext',sendMessage:async(m:any)=>{
      requests.push(m);
      if(m.type==='STATE')return {ok:true,data:{state:structuredClone(state),binding:{tabId:7}}};
      if(m.type==='TABS')return {ok:true,data:[{id:7,title:'抖音聊天'}]};
      if(m.type==='PEOPLE')return {ok:true,data:{people:catalog,ambiguous:0}};
      if(m.type==='EMOJI')return {ok:true,data:[emoji]};
      if(m.type==='SAVE'){state.settings=m.settings;return {ok:true};}
      return {ok:false,error:'模拟错误'};
    }},
    storage:{onChanged:{addListener:()=>{}}}
  });
  await import('../src/options');
  await vi.waitFor(()=>expect(document.querySelector('#tabs option:last-child')?.textContent).toContain('抖音聊天'));
});
it('读取、选择好友和表情后保存真实配置，不触发发送',async()=>{
  (document.getElementById('readPeople') as HTMLButtonElement).click();
  await vi.waitFor(()=>expect(document.querySelector('.person')).not.toBeNull());
  (document.querySelector('.person input') as HTMLInputElement).click();
  (document.getElementById('readEmoji') as HTMLButtonElement).click();
  await vi.waitFor(()=>expect(document.querySelector('.emoji')).not.toBeNull());
  (document.querySelector('.emoji') as HTMLButtonElement).click();
  expect(document.getElementById('preview')?.textContent).toContain('续火花');
  (document.getElementById('save') as HTMLButtonElement).click();
  await vi.waitFor(()=>expect(state.settings.people).toHaveLength(1));
  expect(state.settings.emoji.name).toBe('续火花');
  expect(state.settings.enabled).toBe(false);
  expect(requests.some(r=>r.type==='RUN')).toBe(false);
});
it('未保存的选择不能直接启动任务',async()=>{
  (document.getElementById('readPeople') as HTMLButtonElement).click();
  await vi.waitFor(()=>expect(document.querySelector('.person')).not.toBeNull());
  (document.querySelector('.person input') as HTMLInputElement).click();
  (document.getElementById('run') as HTMLButtonElement).click();
  await vi.waitFor(()=>expect(document.getElementById('notice')?.textContent).toContain('先保存'));
  expect(requests.some(r=>r.type==='RUN')).toBe(false);
});
it('独立配置页可按类型筛选群聊，保存类型且不发送',async()=>{
  const group={...person,name:'测试群聊',kind:'group',id:conversationId('测试群聊',person.avatarKey,'group')};catalog.push(group);
  (document.getElementById('readPeople') as HTMLButtonElement).click();
  await vi.waitFor(()=>expect(document.querySelectorAll('.person')).toHaveLength(2));
  const kind=document.getElementById('conversationKind') as HTMLSelectElement;kind.value='group';kind.dispatchEvent(new Event('change'));
  expect(document.querySelectorAll('.person')).toHaveLength(1);expect(document.getElementById('people')?.textContent).toContain('[群聊] 测试群聊');
  (document.querySelector('.person input') as HTMLInputElement).click();
  (document.getElementById('save') as HTMLButtonElement).click();await vi.waitFor(()=>expect(state.settings.people).toEqual([group]));
  expect(state.settings.enabled).toBe(false);expect(requests.some(r=>r.type==='RUN')).toBe(false);
  kind.value='person';kind.dispatchEvent(new Event('change'));expect(document.querySelectorAll('.person')).toHaveLength(1);
  expect(document.getElementById('people')?.textContent).toContain('测试好友');
});
it('已安装扩展的初始化失败不会提示用户尚未安装',async()=>{
  vi.resetModules();
  document.documentElement.innerHTML=readFileSync('public/options.html','utf8');
  chrome.runtime.sendMessage=vi.fn().mockResolvedValue({ok:false,error:'不支持的消息来源'});
  await import('../src/options');
  await vi.waitFor(()=>expect(document.getElementById('notice')?.textContent).toBe('不支持的消息来源'));
  expect(document.querySelector('#tabs option')?.textContent).toBe('连接失败，请重新加载扩展后刷新此页');
});
