import { assetKey, validImage, conversationAvatar, conversationId, type Person, type Emoji } from './model';
import {collectConversations,type ScanProgress,type ScanRow} from './scanner';

// Verified against the user's live Douyin chat DOM on 2026-10-20.
// Keep site-specific selectors here; no private API or framework state access.
export const S = {
  row:'[data-e2e="conversation-item"]',
  title:'.conversationConversationItemtitle',
  list:'.conversationConversationListwrapper',
  current:'.conversationConversationItemcurConversation',
  header:'.RightPanelHeaderuser',
  headerName:'.RightPanelHeadertitle',
  avatar:'.commonIMAvataravatarContainer img',
  groupAvatar:'img.commonConversationIconnoDrag',
  self:'.messageMessageBoxcontentBox.messageMessageBoxisFromMe',
  editor:'[contenteditable="true"][data-slate-editor="true"]',
  openEmoji:'svg.messageMsgInputiconAction',
  panel:'.componentsemojiemojiPanel',
  tab:'.emojiEmojisModalTabsubTab',
  small:'.emojiSmallEmojismallEmojiItem',
  sticker:'.emojiEmojiItememojiItem',
  send:'.e2e-send-msg-btn',
  cancelSearch:'.searchSearchInputsearch_cancel'
};
export const delay = (ms:number) => new Promise<void>(r=>setTimeout(r,ms));
export function one(selector:string, root:ParentNode=document): HTMLElement {
  const els=[...root.querySelectorAll<HTMLElement>(selector)];
  if(els.length!==1) throw Error(`页面结构变化或未就绪：${selector}（${els.length}）`);
  return els[0];
}
export function click(el:Element) {
  el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
}
// For navigation controls only, reproduce the normal pointer/mouse sequence.
// Message/emoji-item sending keeps its separate, one-shot click path.
export function activateControl(el:Element) {
  const box=el.getBoundingClientRect();
  const base={bubbles:true,cancelable:true,composed:true,detail:1,button:0,clientX:box.left+box.width/2,clientY:box.top+box.height/2};
  if(typeof PointerEvent!=='undefined')el.dispatchEvent(new PointerEvent('pointerdown',{...base,buttons:1,pointerId:1,pointerType:'mouse',isPrimary:true}));
  el.dispatchEvent(new MouseEvent('mousedown',{...base,buttons:1}));
  if(typeof PointerEvent!=='undefined')el.dispatchEvent(new PointerEvent('pointerup',{...base,buttons:0,pointerId:1,pointerType:'mouse',isPrimary:true}));
  el.dispatchEvent(new MouseEvent('mouseup',{...base,buttons:0}));
  el.dispatchEvent(new MouseEvent('click',{...base,buttons:0}));
}
export async function until<T>(fn:()=>T|undefined|false|null, timeout=6000,timeoutMessage:string|(()=>string)='等待页面响应超时'):Promise<T> {
  const start=Date.now();
  while(Date.now()-start<timeout) {
    const value=fn();
    if(value) return value;
    await delay(100);
  }
  throw Error(typeof timeoutMessage==='function'?timeoutMessage():timeoutMessage);
}
export function personFrom(row:Element):Person {
  const name=row.querySelector(S.title)?.textContent?.trim()||'';
  const group=row.querySelector<HTMLImageElement>(S.groupAvatar);
  const kind=group?'group':'person';
  const avatar=conversationAvatar((group||row.querySelector<HTMLImageElement>(S.avatar))?.src||'');
  const avatarKey=assetKey(avatar);
  return {id:conversationId(name,avatarKey,kind),kind,name,avatar,avatarKey,streak:row.querySelector('.commonStreaknormalText')?.textContent?.trim()||''};
}
export function scanRowFrom(row:Element):ScanRow {
  const raw=row.closest('[data-index]')?.getAttribute('data-index');
  const index=raw!=null&&/^\d+$/.test(raw)?Number(raw):null;
  const person=personFrom(row);
  if(person.name&&validImage(person.avatar))return {person,index};
  const name=person.name||'未加载名称的列表项';
  const reason=!person.name?'名称尚未加载':'会话头像尚未加载或格式不支持';
  const key=JSON.stringify([person.kind,name,person.avatarKey||`row:${index}`]);
  return {person:null,index,skipped:{key,name,reason}};
}
export function selfFingerprint():string {
  const keys=new Set([...document.querySelectorAll<HTMLImageElement>(`${S.self} ${S.avatar}`)].map(e=>assetKey(e.src)).filter(Boolean));
  if(keys.size!==1) throw Error('无法确认账号：请打开有本人头像和历史消息的会话，再绑定页面');
  return [...keys][0];
}
export function editorEmpty():boolean {
  const e=one(S.editor);
  return !(e.textContent||'').replace(/[\s\u200b-\u200d\ufeff]/g,'') && !e.querySelector('img,[data-void="true"]');
}
export function assertPerson(p:Person) {
  const row=one(S.current);
  const actual=personFrom(row);
  const header=one(S.header);
  const name=header.querySelector(S.headerName)?.textContent?.trim();
  const group=header.querySelector<HTMLImageElement>(S.groupAvatar);
  const headerKind=group?'group':'person';
  const avatar=assetKey(conversationAvatar((group||header.querySelector<HTMLImageElement>(S.avatar))?.src||''));
  if(actual.id!==p.id) throw Error(`会话身份不一致：当前列表选中「${actual.name||'未知'}」，目标为「${p.name}」`);
  if(headerKind!==(p.kind||'person')) throw Error('会话身份不一致：个人会话与群聊类型不匹配');
  // The observed group header appends member count, e.g. 群名(6).
  // Compare the exact saved name first; never strip parentheses from the name itself.
  const nameMatches=name===p.name||(p.kind==='group'&&name?.startsWith(p.name)&&/^\s*(?:\(\d+\)|（\d+）)$/.test(name.slice(p.name.length)));
  if(!nameMatches) throw Error(`会话身份不一致：聊天标题为「${name||'未加载'}」，目标为「${p.name}」`);
  if(!avatar) throw Error('会话身份不一致：聊天顶部的会话头像尚未加载');
  if(avatar!==p.avatarKey) throw Error(`会话身份不一致：「${p.name}」的聊天头像与保存的头像不同，请重新读取并选择`);
}
export async function scanPeople(check:()=>void = ()=>{},progress?:(p:ScanProgress)=>void,signal?:AbortSignal) {
  check();
  const cancel=document.querySelector(S.cancelSearch);
  if(cancel) click(cancel);
  const list=await until(()=>document.querySelector<HTMLElement>(S.list),6000,'会话列表未加载，请保持抖音聊天页可见后重试');
  // Browser scroll anchoring can jump over recycled rows during rendering.
  // Disable it only while traversing, then restore the site's original value.
  const anchor=list.style.getPropertyValue('overflow-anchor'),priority=list.style.getPropertyPriority('overflow-anchor');
  list.style.setProperty('overflow-anchor','none','important');
  try {return await collectConversations({
    position:()=>list.scrollTop,height:()=>list.scrollHeight,viewport:()=>list.clientHeight,
    move:y=>{list.scrollTop=y;},
    rows:()=>[...list.querySelectorAll(S.row)].map(scanRowFrom),
    loading:()=>list.getAttribute('aria-busy')==='true'||!!list.querySelector('[role="progressbar"],.semi-spin-spinning')
  },{check,progress,signal});
  } finally {if(anchor)list.style.setProperty('overflow-anchor',anchor,priority);else list.style.removeProperty('overflow-anchor');}
}
export async function openPerson(p:Person,check:()=>void) {
  check();
  if(!editorEmpty()) throw Error('输入框有未发送内容，请先处理草稿');
  const cancel=document.querySelector(S.cancelSearch);
  if(cancel) click(cancel);
  const list=one(S.list);
  list.scrollTop=0;
  for(let i=0;i<100;i++) {
    check();
    await delay(90);
    const matches=[...document.querySelectorAll(S.row)].filter(r=>personFrom(r).id===p.id);
    if(matches.length>1) throw Error('会话重名且头像相同，无法安全区分');
    if(matches.length===1) {
      // Close a pre-existing emoji popover before switching conversations.
      hidePanel();
      activateControl(matches[0].querySelector(S.title)||matches[0]);
      let identityError='聊天标题尚未更新';
      await until(()=> {
        check();
        try { assertPerson(p); return true; } catch(e) {identityError=(e as Error).message;return false;}
      },10000,()=>`打开「${p.name}」后核对未通过：${identityError}`);
      // Allow message list to change after the header commits.
      await delay(350);
      return;
    }
    if(list.scrollTop+list.clientHeight>=list.scrollHeight-3) break;
    list.scrollTop+=Math.max(200,list.clientHeight*.75);
  }
  throw Error(`未找到已保存会话：${p.name}；昵称或头像变更后需重新选择`);
}
export function tabKey(el:Element):string {
  const img=el.querySelector<HTMLImageElement>('img');
  if(img) return 'img:'+assetKey(img.src);
  const svg=el.querySelector('svg');
  if(!svg) return '';
  return 'svg:'+JSON.stringify([...svg.querySelectorAll('path,circle,rect')].map(e=>[e.tagName,...['d','cx','cy','r','width','height'].map(a=>e.getAttribute(a))]));
}
export function emojiFrom(el:Element,tab:string):Emoji {
  const image=el.querySelector<HTMLImageElement>('img')?.src||'';
  const asset=assetKey(image);
  const kind=el.matches(S.small)?'small':'sticker';
  const name=el.querySelector('.emojiEmojiItememojiItemDesc')?.textContent?.trim()||el.querySelector('img')?.getAttribute('title')||`表情 ${asset.split('/').pop()?.slice(0,8)}`;
  return {id:JSON.stringify([kind,tab,asset]),name,image,asset,tab,kind};
}
export async function showPanel() {
  if(!document.querySelector(S.panel)) activateControl(one(S.openEmoji));
  return until(()=>document.querySelector<HTMLElement>(S.panel),8000,'原生表情面板未打开，请保持聊天页可见，确认输入框右侧的表情按钮可用');
}
export function hidePanel() {
  if(document.querySelector(S.panel)) activateControl(one(S.openEmoji));
}
export async function selectEmojiTab(key:string,check:()=>void=()=>{}) {
  check();
  const matches=[...document.querySelectorAll(S.tab)].filter(t=>tabKey(t)===key);
  if(matches.length!==1)throw Error('表情分类变化，请重新读取表情');
  if(!/active/i.test(matches[0].className))activateControl(matches[0]);
  await until(()=>{check();return [...document.querySelectorAll(S.tab)].some(t=>tabKey(t)===key&&/active/i.test(t.className));},6000,'表情分类未切换完成，请保持聊天页可见后重新读取表情');
}
export async function scanEmoji() {
  const wasOpen=!!document.querySelector(S.panel);
  await showPanel();
  const original=[...document.querySelectorAll(S.tab)].find(e=>/active/i.test(e.className));
  const originalKey=original?tabKey(original):'';
  const result=new Map<string,Emoji>();
  try {
    const tabs=[...document.querySelectorAll(S.tab)].filter(e=>!e.className.includes('disabled')).map(tabKey).filter(Boolean);
    for(const key of tabs) {
      const tab=[...document.querySelectorAll(S.tab)].find(e=>tabKey(e)===key);
      if(!tab) continue;
      await selectEmojiTab(key);
      await until(()=>document.querySelector(`${S.panel} ${S.small},${S.panel} ${S.sticker}`),1800).catch(()=>undefined);
      await delay(200);
      for(const e of document.querySelectorAll(`${S.panel} ${S.small},${S.panel} ${S.sticker}`)) {
        const item=emojiFrom(e,key);
        if(validImage(item.image)) result.set(item.id,item);
      }
    }
  } finally {
    const tab=[...document.querySelectorAll(S.tab)].find(e=>tabKey(e)===originalKey);
    if(tab&&!/active/i.test(tab.className)) activateControl(tab);
    if(!wasOpen) hidePanel();
  }
  return [...result.values()];
}
export async function findEmoji(emoji:Emoji,check:()=>void=()=>{}):Promise<Element> {
  check();
  await showPanel();
  await selectEmojiTab(emoji.tab,check);
  return until(()=> {
    check();
    const els=[...document.querySelectorAll(`${S.panel} ${emoji.kind==='small'?S.small:S.sticker}`)].filter(e=>emojiFrom(e,emoji.tab).asset===emoji.asset);
    if(els.length>1) throw Error('同一表情存在多个匹配项');
    return els[0];
  },8000,`当前分类未找到「${emoji.name}」，请重新读取并选择表情`);
}
export function matchingMessages(emoji:Emoji):Element[] {
  return [...document.querySelectorAll(S.self)].filter(e=>
    [...e.querySelectorAll<HTMLImageElement>('[data-e2e="msg-item-content"] img')].some(img=>assetKey(img.src)===emoji.asset));
}
export function checkEnvironment() {
  if(location.pathname!=='/chat') throw Error('请打开抖音聊天页面');
  if(!navigator.onLine) throw Error('当前处于离线状态');
  if(document.querySelector('#dy-fire-send')) throw Error('检测到旧续火助手，请先停用旧插件并刷新聊天页，避免两套任务重复发送');
  one(S.editor);
}
