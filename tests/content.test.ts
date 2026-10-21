// @vitest-environment jsdom
import {it,expect,vi,beforeEach} from 'vitest';
import type {Person,Emoji} from '../src/model';
const {mocks}=vi.hoisted(()=>({mocks:{
  selfFingerprint:vi.fn(),checkEnvironment:vi.fn(),openPerson:vi.fn(),editorEmpty:vi.fn(),findEmoji:vi.fn(),assertPerson:vi.fn(),matchingMessages:vi.fn(),hidePanel:vi.fn(),click:vi.fn(),one:vi.fn(),until:vi.fn(),delay:vi.fn()
}}));
vi.mock('../src/adapter',()=>({...mocks,S:{editor:'editor',send:'send'}}));
vi.mock('../src/floating',()=>({createFloatingPanel:vi.fn(),PANEL_HOST:'douyin-streak-panel'}));
let handler:any,permit:any,documentId:string;
const person={id:'p',name:'测试好友'} as Person;
const emoji={id:'e',name:'续火花',kind:'sticker'} as Emoji;
function send(type:string,payload:any={}):Promise<any>{return new Promise(resolve=>handler({type,payload},{id:'ext'},resolve));}
beforeEach(async()=>{
  vi.resetModules();Object.values(mocks).forEach(f=>f.mockReset());
  mocks.selfFingerprint.mockReturnValue('account');mocks.editorEmpty.mockReturnValue(true);
  mocks.findEmoji.mockResolvedValue(document.createElement('div'));mocks.matchingMessages.mockReturnValue([]);
  mocks.until.mockResolvedValue(document.createElement('div'));
  permit=vi.fn().mockResolvedValue({ok:true});
  vi.stubGlobal('chrome',{runtime:{id:'ext',sendMessage:permit,onMessage:{addListener:(h:any)=>handler=h}}});
  await import('../src/content');
  documentId=(await send('PING')).data.documentId;
});
it('只检查模式不请求发送许可、不点击表情',async()=>{
  const r=await send('EXECUTE',{person,emoji,account:'account',documentId,dry:true});
  expect(r.data.status).toBe('ready');expect(permit).not.toHaveBeenCalled();expect(mocks.click).not.toHaveBeenCalled();
});
it('群聊只检查沿用账号核对与表情定位，不申请许可或触发发送',async()=>{
  const group={...person,kind:'group',name:'测试群聊'};
  const r=await send('EXECUTE',{person:group,emoji,account:'account',documentId,dry:true});
  expect(r.data.status).toBe('ready');expect(r.data.detail).toContain('测试群聊');
  expect(mocks.openPerson).toHaveBeenCalledWith(group,expect.any(Function));
  expect(mocks.assertPerson).toHaveBeenCalledWith(group);expect(mocks.selfFingerprint).toHaveBeenCalled();
  expect(permit).not.toHaveBeenCalled();expect(mocks.click).not.toHaveBeenCalled();
});
it('群聊缺少本人历史身份时停止，不绕过账号校验',async()=>{
  mocks.selfFingerprint.mockReturnValueOnce('account').mockImplementationOnce(()=>{throw Error('无法确认账号');});
  const r=await send('EXECUTE',{person:{...person,kind:'group'},emoji,account:'account',documentId,dry:true});
  expect(r.data.status).toBe('failed');expect(mocks.findEmoji).not.toHaveBeenCalled();
  expect(permit).not.toHaveBeenCalled();expect(mocks.click).not.toHaveBeenCalled();
});
it('许可被撤销后不发送',async()=>{
  permit.mockResolvedValue({ok:false,error:'任务已暂停'});
  const r=await send('EXECUTE',{person,emoji,account:'account',documentId});
  expect(r.data.status).toBe('failed');expect(mocks.click).not.toHaveBeenCalled();
});
it('点击后没有确认消息时，不把超时当作发送前失败',async()=>{
  mocks.until.mockRejectedValue(Error('等待超时'));
  const r=await send('EXECUTE',{person,emoji,account:'account',documentId});
  expect(mocks.click).toHaveBeenCalledTimes(1);expect(r.data.status).toBe('uncertain');
});
it('旧页面执行请求不能点击表情',async()=>{
  const r=await send('EXECUTE',{person,emoji,account:'account',documentId:'old'});
  expect(r.data.status).toBe('failed');expect(mocks.click).not.toHaveBeenCalled();
});
it('小表情点击和原生发送按钮是两个阶段',async()=>{
  mocks.one.mockReturnValue(document.createElement('div'));
  const r=await send('EXECUTE',{person,emoji:{...emoji,kind:'small'},account:'account',documentId});
  expect(mocks.click).toHaveBeenCalledTimes(2);expect(r.data.status).toBe('observed');
});
it('只检查失败时标出好友和会话步骤，且不申请发送许可',async()=>{
  mocks.openPerson.mockRejectedValue(Error('聊天标题仍为旧会话'));
  const r=await send('EXECUTE',{person,emoji,account:'account',documentId,dry:true});
  expect(r.data.status).toBe('failed');expect(r.data.detail).toContain('「测试好友」· 打开并核对会话：聊天标题仍为旧会话');
  expect(permit).not.toHaveBeenCalled();expect(mocks.click).not.toHaveBeenCalled();
});
it('只检查找不到表情时准确标出表情步骤且不发送',async()=>{
  mocks.findEmoji.mockRejectedValue(Error('当前分类未找到表情'));
  const r=await send('EXECUTE',{person,emoji,account:'account',documentId,dry:true});
  expect(r.data.detail).toContain('「测试好友」· 查找原生表情：');
  expect(permit).not.toHaveBeenCalled();expect(mocks.click).not.toHaveBeenCalled();
});
