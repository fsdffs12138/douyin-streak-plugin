import {createFloatingPanel} from '../../src/floating';
import {scanPeople} from '../../src/adapter';
import {defaults} from '../../src/model';

// Local-only fixture. It uses fictional contacts and cannot send any messages.
document.body.innerHTML=`<style>
body{margin:0;background:#424355;color:#fff;font:15px 'Segoe UI',sans-serif}header{padding:20px;background:#333542}
.conversationConversationListwrapper{position:absolute;left:0;top:88px;width:300px;height:calc(100vh - 100px);overflow:auto;background:#383a49}
#spacer{position:relative}.fixture-row{position:absolute;left:0;right:0;height:64px;padding:10px;box-sizing:border-box;border-bottom:1px solid #555;display:flex;gap:10px;align-items:center}
.commonIMAvataravatarContainer img{width:35px;height:35px;background:#79e3c3;border-radius:50%}.conversationConversationItemtitle{font-weight:600}
main{margin:100px 470px 0 330px;line-height:1.8}#audit{white-space:pre-wrap;font-size:13px;color:#adedd8}
</style><header>续火 1.2.0 · 本地混合列表验证 · 虚构会话，不具备发送能力</header>
<div class="conversationConversationListwrapper"><div id="spacer"></div></div>
<main><h2>测试会话保持打开</h2><p>180 个虚构会话：144 个好友、36 个群聊，分三页加载；初始滚动位置 640。面板使用正式代码。</p><output id="audit"></output></main>`;
const list=document.querySelector<HTMLElement>('.conversationConversationListwrapper')!;
const spacer=document.getElementById('spacer')!,audit=document.getElementById('audit')!;
let loaded=60,loading=false,clicks=0,finished='尚未读取';
const trace:string[]=[];
function report(){audit.textContent=`已加载 ${loaded}/180\n当前滚动位置 ${list.scrollTop}\n打开其他会话次数 ${clicks}\n${finished}\n${trace.slice(-6).join('\n')}`;}
function render(){
  spacer.style.height=`${loaded*64}px`;spacer.replaceChildren();
  const first=Math.max(0,Math.floor(list.scrollTop/64)-1),last=Math.min(loaded,Math.ceil((list.scrollTop+list.clientHeight)/64)+1);
  for(let i=first;i<last;i++){
    const wrapper=document.createElement('div');wrapper.dataset.index=String(i);wrapper.className='fixture-row';wrapper.style.top=`${i*64}px`;
    const row=document.createElement('div');row.dataset.e2e='conversation-item';row.style.display='contents';
    row.innerHTML=i%5===0
      ?`<img class="commonConversationIconnoDrag" alt="" src="http://p3.douyinpic.com/fixture-group-${i}.webp"><span class="conversationConversationItemtitle">测试群聊 ${String(i+1).padStart(3,'0')}</span>`
      :`<span class="commonIMAvataravatarContainer"><img alt="" src="https://p3.douyinpic.com/fixture-avatar-${i}~noop.webp"></span><span class="conversationConversationItemtitle">测试好友 ${String(i+1).padStart(3,'0')}</span>`;
    row.onclick=()=>{clicks++;report();};wrapper.append(row);spacer.append(wrapper);
  }
  report();
  if(list.scrollTop+list.clientHeight>=loaded*64-5&&loaded<180&&!loading){
    loading=true;list.setAttribute('aria-busy','true');
    setTimeout(()=>{loaded+=60;loading=false;list.removeAttribute('aria-busy');render();},600);
  }
}
list.addEventListener('scroll',render);render();list.scrollTop=640;render();
const state=defaults();
createFloatingPanel({documentId:'fixture',api:async command=>{
  if(command==='STATE')return {state,binding:null};
  if(command==='PAUSE')return true;
  throw Error('本地验证不支持连接、保存或发送');
},scan:async(progress,signal)=>{
  const result=await scanPeople(()=>{},p=>{progress(p);const rows=[...list.querySelectorAll<HTMLElement>('[data-index]')];trace.push(`数量 ${p.count} · 位置 ${list.scrollTop} · 行 ${rows[0]?.dataset.index}–${rows.at(-1)?.dataset.index}`);report();},signal);
  finished=`可选会话 ${result.people.length}/180 · 群聊 ${result.people.filter(p=>p.kind==='group').length}/36 · 不可选条目 ${result.skipped?.length||0} · ${result.complete?'完成':'部分'} · ${result.reason}`;report();return result;
},emoji:async()=>[]});
