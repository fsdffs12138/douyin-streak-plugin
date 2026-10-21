import {describe,it,expect} from 'vitest';
import {defaults,dayAt,isDue,recordKey,blocked,assetKey,validateSettings,conversationId,conversationAvatar} from '../src/model';
it('旧好友配置与记录标识保持兼容，群聊和同名同头像好友分开',()=>{
  const name='会话',avatar='https://p3.byteimg.com/avatar',avatarKey='/avatar';
  const old={name,avatar,avatarKey,id:JSON.stringify([name,avatarKey]),streak:''};
  const group={...old,kind:'group',id:conversationId(name,avatarKey,'group')};
  expect(validateSettings({...defaults().settings,people:[old,group]}).people).toHaveLength(2);
  expect(conversationId(name,avatarKey,'person')).toBe(old.id);
  expect(recordKey('me',group.id)).not.toBe(recordKey('me',old.id));
  expect(()=>validateSettings({...defaults().settings,people:[{...group,id:old.id}]})).toThrow();
  expect(()=>validateSettings({...defaults().settings,people:[{...old,kind:'unknown'}]})).toThrow();
});
it('群头像仅升级可信 CDN 的 HTTP 地址，拒绝其他来源和协议',()=>{
  expect(conversationAvatar('http://p3-aweme-im-img.byteimg.com/a~tplv.webp')).toBe('https://p3-aweme-im-img.byteimg.com/a~tplv.webp');
  for(const url of ['http://evil.test/a','https://byteimg.com.evil.test/a','javascript:alert(1)','data:image/png;base64,x','ftp://p3.byteimg.com/a'])expect(conversationAvatar(url)).toBe('');
});
describe('北京时间与幂等记录',()=>{
  it('UTC 下午四点跨入北京时间次日',()=>expect(dayAt(Date.parse('2026-10-20T16:00:00Z'))).toBe('2026-10-21'));
  it('仅在当天计划时间和补发窗口内执行',()=>{
    const s={...defaults().settings,enabled:true,time:'09:00',graceMinutes:60};
    expect(isDue(s,Date.parse('2026-10-20T00:59:59Z'))).toBe(false);
    expect(isDue(s,Date.parse('2026-10-20T01:00:00Z'))).toBe(true);
    expect(isDue(s,Date.parse('2026-10-20T02:00:01Z'))).toBe(false);
    expect(isDue({...s,enabled:false},Date.parse('2026-10-20T01:30:00Z'))).toBe(false);
  });
  it('账号、好友、日期分别隔离，改表情不会再次发送',()=>{
    expect(recordKey('a','p','2026-10-20')).not.toBe(recordKey('b','p','2026-10-20'));
    expect(recordKey('a','p','2026-10-20')).not.toBe(recordKey('a','p','2026-10-21'));
    for(const status of ['sending','observed','uncertain','failed','skipped','confirmed'])expect(blocked({status} as any)).toBe(true);
    expect(blocked()).toBe(false);
  });
  it('图片签名和 CDN 域名变化不影响资源标识',()=>{
    expect(assetKey('https://p3.douyinpic.com/obj/test?signature=a')).toBe(assetKey('https://p9.douyinpic.com/obj/test?signature=b'));
    expect(assetKey('https://p3.byteimg.com/tos/asset~tplv-thumb.webp?a=1')).toBe(assetKey('https://p9.byteimg.com/tos/asset~tplv-full.webp?a=2'));
  });
  it('拒绝无效时间、过短间隔以及无对象自动发送',()=>{
    expect(()=>validateSettings({...defaults().settings,time:'25:00'})).toThrow();
    expect(()=>validateSettings({...defaults().settings,gapSeconds:0})).toThrow();
    expect(()=>validateSettings({...defaults().settings,enabled:true})).toThrow();
    expect(validateSettings(defaults().settings)).toEqual(defaults().settings);
  });
});
