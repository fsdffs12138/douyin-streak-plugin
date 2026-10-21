// @vitest-environment jsdom
import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import {personFrom,assertPerson,emojiFrom,matchingMessages,selfFingerprint,editorEmpty,tabKey,scanEmoji,openPerson,showPanel,findEmoji,scanPeople,scanRowFrom} from '../src/adapter';
const src='https://p3.douyinpic.com/obj/im-resource/sticker.png?sign=1';
const avatar='https://p3.douyinpic.com/img/aweme-avatar/friend.webp';
const self='https://p3.douyinpic.com/img/aweme-avatar/me.webp';
function fixture(){
  document.body.innerHTML=`
  <div data-e2e="conversation-item" class="conversationConversationItemcurConversation">
    <div class="commonIMAvataravatarContainer"><img src="${avatar}"></div>
    <div class="conversationConversationItemtitle">测试好友</div>
  </div>
  <div class="RightPanelHeaderuser"><div class="commonIMAvataravatarContainer"><img src="${avatar}"></div><div class="RightPanelHeadertitle">测试好友</div></div>
  <div class="messageMessageBoxcontentBox messageMessageBoxisFromMe"><div class="commonIMAvataravatarContainer"><img src="${self}"></div><div data-e2e="msg-item-content"><img src="${src}"></div></div>
  <div class="messageMessageBoxcontentBox"><div data-e2e="msg-item-content"><img src="${src}"></div></div>
  <div contenteditable="true" data-slate-editor="true"><span>​</span></div>
  <svg class="messageMsgInputiconAction"></svg>
  <div class="componentsemojiemojiPanel">
  <div class="emojiEmojisModalTabsubTab emojiEmojisModalTabactiveDark"><svg><circle cx="13" cy="13" r="10"></circle></svg></div>
  <div class="emojiEmojiItememojiItem"><div data-apm-action="EmojiItem"><img src="${src}"></div><div class="emojiEmojiItememojiItemDesc">续火花</div></div></div>`;
}
beforeEach(fixture);
afterEach(()=>vi.useRealTimers());
function groupFixture(name='测试群聊') {
  const row=document.querySelector('[data-e2e="conversation-item"]')!;
  row.querySelector('.commonIMAvataravatarContainer')!.outerHTML='<img class="commonConversationIconnoDrag" src="http://p3-aweme-im-img.byteimg.com/group~list.webp">';
  row.querySelector('.conversationConversationItemtitle')!.textContent=name;
  document.querySelector('.RightPanelHeaderuser')!.innerHTML=`<img class="commonConversationIconnoDrag" src="http://p3-aweme-im-img.byteimg.com/group~header.webp"><div class="RightPanelHeadertitle"></div>`;
  document.querySelector('.RightPanelHeadertitle')!.textContent=`${name}(6)`;
  return {row,person:personFrom(row)};
}
it('群聊标题附带人数时通过，人数变化不改变身份',()=>{
  const {person}=groupFixture('测试群聊(2026)');
  expect(person.kind).toBe('group');expect(person.id).toBe(JSON.stringify(['group','测试群聊(2026)','/group']));
  expect(()=>assertPerson(person)).not.toThrow();
  document.querySelector('.RightPanelHeadertitle')!.textContent='测试群聊(2026)（12）';
  expect(()=>assertPerson(person)).not.toThrow();
  document.querySelector('.RightPanelHeadertitle')!.textContent='测试群聊(2026)分群(12)';
  expect(()=>assertPerson(person)).toThrow('聊天标题');
});
it('同名群聊头像不符、个人冒充群聊、缺失群头像时停止',()=>{
  const {person}=groupFixture();
  const img=document.querySelector('.RightPanelHeaderuser img')!;
  img.setAttribute('src','http://p3-aweme-im-img.byteimg.com/other');
  expect(()=>assertPerson(person)).toThrow('头像不同');
  img.outerHTML='<div class="commonIMAvataravatarContainer"><img src="https://p3.douyinpic.com/group"></div>';
  expect(()=>assertPerson(person)).toThrow('类型不匹配');
  document.querySelector('.RightPanelHeaderuser img')!.remove();
  expect(()=>assertPerson(person)).toThrow();
});
it('群聊从旧标题切换后可核对账号和定位表情，全程不点击表情',async()=>{
  vi.useFakeTimers();const {row,person}=groupFixture();
  const list=document.createElement('div');list.className='conversationConversationListwrapper';row.before(list);list.append(row);
  document.querySelector('.RightPanelHeadertitle')!.textContent='旧群聊(5)';
  row.addEventListener('mousedown',()=>setTimeout(()=>{document.querySelector('.RightPanelHeadertitle')!.textContent='测试群聊(7)';},300));
  const item=document.querySelector('.emojiEmojiItememojiItem')!,emoji=emojiFrom(item,tabKey(document.querySelector('.emojiEmojisModalTabsubTab')!));
  let clicks=0;item.addEventListener('click',()=>clicks++);
  const opening=openPerson(person,()=>{});await vi.runAllTimersAsync();await opening;
  expect(selfFingerprint()).toBe('/img/aweme-avatar/me.webp');
  const finding=findEmoji(emoji);await vi.runAllTimersAsync();expect(await finding).toBe(item);expect(clicks).toBe(0);
});
describe('真实页面结构适配（脱敏 DOM）',()=>{
  it('同时核对会话列表、标题、头像，拒绝同名不同头像',()=>{
    const person=personFrom(document.querySelector('[data-e2e]')!);
    expect(()=>assertPerson(person)).not.toThrow();
    document.querySelector('.RightPanelHeaderuser img')!.setAttribute('src','https://p3.douyinpic.com/another');
    expect(()=>assertPerson(person)).toThrow('身份不一致');
  });
  it('只认本人消息，不把对方发来的相同表情作为发送结果',()=>{
    const e=emojiFrom(document.querySelector('.emojiEmojiItememojiItem')!,'tab');
    expect(matchingMessages(e)).toHaveLength(1);
    expect(selfFingerprint()).toBe('/img/aweme-avatar/me.webp');
  });
  it('不覆盖草稿，也识别只有图片的草稿',()=>{
    expect(editorEmpty()).toBe(true);
    document.querySelector('[contenteditable]')!.innerHTML='<img src="x">';
    expect(editorEmpty()).toBe(false);
  });
  it('缺少或冲突的本人身份时停止',()=>{
    document.querySelector('.messageMessageBoxisFromMe .commonIMAvataravatarContainer')!.remove();
    expect(()=>selfFingerprint()).toThrow('无法确认账号');
  });
  it('读取表情不会点击表情项',async()=>{
    let clicks=0;
    document.querySelector('.emojiEmojiItememojiItem')!.addEventListener('click',()=>clicks++);
    const result=await scanEmoji();
    expect(result).toHaveLength(1);expect(result[0].name).toBe('续火花');expect(clicks).toBe(0);
  });
  it('分类标识不依赖分类位置、主题色或动态 tooltip ID',()=>{
    const tab=document.querySelector('.emojiEmojisModalTabsubTab')!;
    const key=tabKey(tab);tab.className='other';tab.setAttribute('aria-describedby','random');
    tab.querySelector('circle')!.setAttribute('fill','red');
    expect(tabKey(tab)).toBe(key);
  });
  it('会话切换兼容按下事件，并等待标题更新，不点击消息或表情',async()=>{
    vi.useFakeTimers();
    const row=document.querySelector('[data-e2e="conversation-item"]')!;
    const p=personFrom(row),list=document.createElement('div');list.className='conversationConversationListwrapper';row.before(list);list.append(row);
    document.querySelector('.RightPanelHeadertitle')!.textContent='旧会话';
    let navigations=0,emojiClicks=0;
    row.addEventListener('mousedown',e=>{expect((e.target as Element).matches('.conversationConversationItemtitle')).toBe(true);navigations++;setTimeout(()=>document.querySelector('.RightPanelHeadertitle')!.textContent=p.name,250);});
    document.querySelector('.emojiEmojiItememojiItem')!.addEventListener('click',()=>emojiClicks++);
    const promise=openPerson(p,()=>{});await vi.runAllTimersAsync();await promise;
    expect(navigations).toBe(1);expect(emojiClicks).toBe(0);
  });
  it('会话核对超时保留具体标题不匹配原因',async()=>{
    vi.useFakeTimers();
    const row=document.querySelector('[data-e2e="conversation-item"]')!,p=personFrom(row),list=document.createElement('div');
    list.className='conversationConversationListwrapper';row.before(list);list.append(row);
    document.querySelector('.RightPanelHeadertitle')!.textContent='别的会话';
    const result=expect(openPerson(p,()=>{})).rejects.toThrow('聊天标题为「别的会话」，目标为「测试好友」');
    await vi.runAllTimersAsync();await result;
  });
  it('原生表情入口支持按下事件且只打开一次',async()=>{
    vi.useFakeTimers();document.querySelector('.componentsemojiemojiPanel')!.remove();let opened=0;
    document.querySelector('svg.messageMsgInputiconAction')!.addEventListener('mousedown',()=>{opened++;setTimeout(()=>{const e=document.createElement('div');e.className='componentsemojiemojiPanel';document.body.append(e);},250);});
    const promise=showPanel();await vi.runAllTimersAsync();expect(await promise).toBeTruthy();expect(opened).toBe(1);
  });
  it('表情查找等到分类真正激活，不点击表情项',async()=>{
    vi.useFakeTimers();
    const tab=document.querySelector('.emojiEmojisModalTabsubTab')!;
    tab.className='emojiEmojisModalTabsubTab';
    const item=document.querySelector('.emojiEmojiItememojiItem')!,emoji=emojiFrom(item,tabKey(tab));let activated=false,clicked=0;
    item.addEventListener('click',()=>clicked++);
    tab.addEventListener('mousedown',()=>setTimeout(()=>{tab.classList.add('emojiEmojisModalTabactiveDark');activated=true;},400));
    const promise=findEmoji(emoji);await vi.advanceTimersByTimeAsync(200);expect(activated).toBe(false);
    await vi.runAllTimersAsync();expect(await promise).toBe(item);expect(activated).toBe(true);expect(clicked).toBe(0);
  });
  it('群聊使用 HTTPS 预览且与好友一起成为可选会话',async()=>{
    vi.useFakeTimers();
    document.body.innerHTML=`<div class="conversationConversationListwrapper" style="overflow-anchor:auto!important">
      <div data-index="0"><div data-e2e="conversation-item"><div class="commonIMAvataravatarContainer"><img src="${avatar}"></div><div class="conversationConversationItemtitle">好友一</div></div></div>
      <div data-index="1"><div data-e2e="conversation-item"><img class="commonConversationIconnoDrag" src="http://p3-aweme-im-img.byteimg.com/group~image.webp"><div class="conversationConversationItemtitle">测试群聊</div></div></div>
      <div data-index="2"><div data-e2e="conversation-item"><div class="commonIMAvataravatarContainer"><img src="${self}"></div><div class="conversationConversationItemtitle">好友二</div></div></div></div>`;
    const list=document.querySelector<HTMLElement>('.conversationConversationListwrapper')!;
    Object.defineProperties(list,{clientHeight:{value:300},scrollHeight:{value:300}});
    let clicks=0;list.addEventListener('click',()=>clicks++);
    const promise=scanPeople();await vi.runAllTimersAsync();const r=await promise;
    expect(r.complete).toBe(true);expect(r.people.map(p=>p.name)).toEqual(['好友一','测试群聊','好友二']);
    expect(r.skipped).toHaveLength(0);expect(r.people[1].kind).toBe('group');expect(r.people[1].avatar).toBe('https://p3-aweme-im-img.byteimg.com/group~image.webp');expect(clicks).toBe(0);
    expect(list.style.getPropertyValue('overflow-anchor')).toBe('auto');expect(list.style.getPropertyPriority('overflow-anchor')).toBe('important');
  });
  it('缺少个人头像仍保留所在行的索引与原因',()=>{
    const row=document.querySelector('[data-e2e="conversation-item"]')!;row.setAttribute('data-index','3');row.querySelector('img')!.remove();
    const result=scanRowFrom(row);expect(result.person).toBeNull();expect(result.index).toBe(3);expect(result.skipped?.reason).toContain('头像');
  });
});
