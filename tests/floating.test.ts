// @vitest-environment jsdom
import {it,expect,vi,beforeEach} from 'vitest';
import {createFloatingPanel,type PanelBridge} from '../src/floating';
import {defaults,conversationId,type Person} from '../src/model';
let bridge:PanelBridge,state:ReturnType<typeof defaults>,commands:string[];
const friend:Person={name:'测试好友',avatar:'https://p3.douyinpic.com/a',avatarKey:'/a',id:JSON.stringify(['测试好友','/a']),streak:'3'};
it('群聊可筛选勾选保存，确认区标明群聊，取消不启动发送',async()=>{
  const group:Person={...friend,name:'测试群聊',kind:'group',id:conversationId('测试群聊',friend.avatarKey,'group')};
  state.settings.emoji={name:'表情',kind:'sticker',tab:'t',asset:'/e',image:'https://p3.douyinpic.com/e',id:'e'};
  bridge.scan=vi.fn(async()=>({people:[friend,group],ambiguous:0,complete:true,reason:'',rounds:1}));
  bridge.api=vi.fn(async(command,data)=>{commands.push(command);if(command==='SAVE'){state.settings=data!.settings as typeof state.settings;return true;}return {state:structuredClone(state),binding:{documentId:'doc'}};});
  const panel=createFloatingPanel(bridge);await Promise.resolve();
  (panel.root.getElementById('scan') as HTMLButtonElement).click();
  await vi.waitFor(()=>expect(panel.root.getElementById('count')?.textContent).toContain('已读取 2'));
  const filter=panel.root.getElementById('conversationKind') as HTMLSelectElement;
  expect([...filter.options].map(o=>o.value)).toEqual(['','person','group']);
  filter.value='group';filter.dispatchEvent(new Event('change'));
  expect(panel.root.querySelectorAll('.person')).toHaveLength(1);expect(panel.root.getElementById('people')?.textContent).toContain('[群聊] 测试群聊');
  (panel.root.getElementById('select') as HTMLButtonElement).click();await vi.waitFor(()=>expect(panel.root.getElementById('count')?.textContent).toContain('已选 1'));
  (panel.root.getElementById('save') as HTMLButtonElement).click();await vi.waitFor(()=>expect(state.settings.people).toEqual([group]));
  await vi.waitFor(()=>expect((panel.root.getElementById('run') as HTMLButtonElement).disabled).toBe(false));
  (panel.root.getElementById('run') as HTMLButtonElement).click();await vi.waitFor(()=>expect(panel.root.getElementById('confirm')?.hidden).toBe(false));
  expect(panel.root.getElementById('confirmText')?.textContent).toContain('[群聊] 测试群聊');
  (panel.root.getElementById('confirmCancel') as HTMLButtonElement).click();
  expect(panel.root.getElementById('confirm')?.hidden).toBe(true);expect(commands).not.toContain('RUN');expect(state.settings.enabled).toBe(false);panel.destroy();
});
beforeEach(()=>{
  document.body.replaceChildren();state=defaults();commands=[];
  bridge={documentId:'doc',api:vi.fn(async command=>{commands.push(command);return {state:structuredClone(state),binding:null};}),scan:vi.fn(async progress=>{progress({count:1,rounds:1,phase:'reading'});return {people:[friend],ambiguous:0,complete:true,reason:'',rounds:1};}),emoji:vi.fn(async()=>[])};
});
it('在聊天页面内显示封闭面板，一键读取无需先绑定，不自动勾选或发送',async()=>{
  const panel=createFloatingPanel(bridge);await vi.waitFor(()=>expect(commands).toContain('STATE'));
  expect(panel.host.shadowRoot).toBeNull();
  (panel.root.getElementById('scan') as HTMLButtonElement).click();
  await vi.waitFor(()=>expect(panel.root.getElementById('count')?.textContent).toBe('已读取 1 · 已选 0'));
  expect(panel.root.getElementById('people')?.textContent).toContain(friend.name);
  expect(commands).not.toContain('BIND');expect(commands).not.toContain('RUN');expect(commands).not.toContain('SAVE');
  panel.destroy();
});
it('支持收起再展开，已读取结果不丢失',async()=>{
  const panel=createFloatingPanel(bridge);await Promise.resolve();
  (panel.root.getElementById('scan') as HTMLButtonElement).click();
  await vi.waitFor(()=>expect(panel.root.getElementById('count')?.textContent).toContain('已读取 1'));
  (panel.root.getElementById('collapse') as HTMLButtonElement).click();
  expect(panel.root.getElementById('panel')?.hidden).toBe(true);
  (panel.root.getElementById('launcher') as HTMLButtonElement).click();
  expect(panel.root.getElementById('panel')?.hidden).toBe(false);expect(panel.root.getElementById('people')?.textContent).toContain(friend.name);panel.destroy();
});
it('部分结果明确标注，停止按钮取消当前扫描',async()=>{
  let signal:AbortSignal|undefined;
  bridge.scan=vi.fn(async(_progress,s)=>{signal=s;await new Promise<void>(resolve=>s.addEventListener('abort',()=>resolve(),{once:true}));return {people:[friend],ambiguous:0,complete:false,reason:'已停止读取',rounds:1};});
  const panel=createFloatingPanel(bridge);await Promise.resolve();
  (panel.root.getElementById('scan') as HTMLButtonElement).click();
  await vi.waitFor(()=>expect(signal).toBeDefined());
  (panel.root.getElementById('stop') as HTMLButtonElement).click();
  await vi.waitFor(()=>expect(panel.root.getElementById('notice')?.textContent).toContain('部分读取'));
  expect(signal?.aborted).toBe(true);expect(panel.root.getElementById('people')?.textContent).toContain(friend.name);panel.destroy();
});
it('会话名只作为文本展示，不执行网页传入的 HTML',async()=>{
  bridge.scan=vi.fn(async()=>({people:[{...friend,name:'<img src=x onerror=alert(1)>'}],ambiguous:0,complete:true,reason:'',rounds:1}));
  const panel=createFloatingPanel(bridge);await Promise.resolve();
  (panel.root.getElementById('scan') as HTMLButtonElement).click();
  await vi.waitFor(()=>expect(panel.root.getElementById('people')?.textContent).toContain('<img'));
  expect(panel.root.querySelector('[onerror]')).toBeNull();panel.destroy();
});
it('身份信息不完整的会话不能被勾选，不把完整遍历显示成漏读',async()=>{
  bridge.scan=vi.fn(async()=>({people:[friend],ambiguous:0,complete:true,reason:'',rounds:2,skipped:[{key:'g',name:'测试群聊',reason:'会话头像尚未加载'}]}));
  const panel=createFloatingPanel(bridge);await Promise.resolve();
  (panel.root.getElementById('scan') as HTMLButtonElement).click();
  await vi.waitFor(()=>expect(panel.root.getElementById('skippedRows')?.textContent).toContain('测试群聊'));
  expect(panel.root.getElementById('notice')?.textContent).toContain('已遍历当前列表到底部');
  expect(panel.root.getElementById('notice')?.classList.contains('error')).toBe(false);
  expect(panel.root.getElementById('skippedRows')?.querySelector('input')).toBeNull();
  (panel.root.getElementById('select') as HTMLButtonElement).click();
  await vi.waitFor(()=>expect(panel.root.getElementById('count')?.textContent).toContain('已选 1'));panel.destroy();
});
