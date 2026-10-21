import {it,expect} from 'vitest';
import {collectConversations,type ScanViewport} from '../src/scanner';
import type {Person} from '../src/model';
const person=(i:number):Person=>({id:`p${i}`,name:`好友 ${i}`,avatar:`https://p3.douyinpic.com/${i}`,avatarKey:`/${i}`,streak:''});
function virtualList(count:number) {
  let top=120,clock=0,total=count;
  const view:ScanViewport={position:()=>top,height:()=>total*20,viewport:()=>60,move:y=>{top=Math.max(0,Math.min(y,total*20-60));},rows:()=>Array.from({length:Math.min(4,total-Math.floor(top/20))},(_,j)=>{const i=Math.floor(top/20)+j;return {person:person(i),index:i};}),loading:()=>false};
  return {view,now:()=>clock,wait:async(ms:number)=>{clock+=ms;},setTotal:(n:number)=>{total=n;}};
}
it('自动读取超过 100 屏的虚拟列表，去重后恢复原位置',async()=>{
  const v=virtualList(800);const updates:number[]=[];
  const r=await collectConversations(v.view,{...v,settleMs:10,endQuietMs:20,progress:p=>updates.push(p.count)});
  expect(r.complete).toBe(true);expect(r.people).toHaveLength(800);expect(r.rounds).toBeGreaterThan(100);expect(new Set(r.people.map(p=>p.id)).size).toBe(800);expect(v.view.position()).toBe(120);expect(updates.at(-1)).toBe(800);
});
it('到达底部后等待延迟分页，继续读取新增会话',async()=>{
  const v=virtualList(6);let bottomWaits=0,loaded=false;
  const r=await collectConversations(v.view,{...v,settleMs:10,endQuietMs:60,wait:async ms=>{await v.wait(ms);if(!loaded&&v.view.position()+60>=v.view.height()&&++bottomWaits===4){v.setTotal(18);loaded=true;}}});
  expect(loaded).toBe(true);expect(r.complete).toBe(true);expect(r.people).toHaveLength(18);
});
it('取消时保留部分结果且恢复滚动位置',async()=>{
  const v=virtualList(100);const controller=new AbortController();
  const r=await collectConversations(v.view,{...v,settleMs:10,signal:controller.signal,progress:p=>{if(p.count>=10)controller.abort();}});
  expect(r.complete).toBe(false);expect(r.reason).toContain('停止');expect(r.people.length).toBeGreaterThan(0);expect(r.people.length).toBeLessThan(100);expect(v.view.position()).toBe(120);
});
it('超时不会把部分读取误报为完整读取',async()=>{
  const v=virtualList(100);
  const r=await collectConversations(v.view,{...v,settleMs:10,maxMs:30});
  expect(r.complete).toBe(false);expect(r.reason).toContain('时间上限');expect(r.people.length).toBeLessThan(100);
});
it('跨屏出现同名同头像的多个对象时排除歧义',async()=>{
  const v=virtualList(20),rows=v.view.rows;
  v.view.rows=()=>rows().map(r=>r.index===10?{...r,person:person(0)}:r);
  const r=await collectConversations(v.view,{...v,settleMs:10,endQuietMs:20});
  expect(r.ambiguous).toBe(1);expect(r.people.some(p=>p.id==='p0')).toBe(false);expect(r.people).toHaveLength(18);
});
it('空白或持续加载中的列表不能判定为读取完成',async()=>{
  const v=virtualList(6);v.view.loading=()=>true;
  const r=await collectConversations(v.view,{...v,settleMs:10,maxMs:120,endQuietMs:20});
  expect(r.complete).toBe(false);
});
it('检测到中间索引缺口时不把跳过的会话误报为完整读取',async()=>{
  const v=virtualList(30),rows=v.view.rows;
  v.view.rows=()=>rows().filter(r=>r.index!==12);
  const r=await collectConversations(v.view,{...v,settleMs:10,endQuietMs:20});
  expect(r.people).toHaveLength(29);expect(r.complete).toBe(false);expect(r.reason).toContain('未连续加载');
});
it('滚动位置先更新但虚拟行延迟重绘时等待，不能连续滚动跳过会话',async()=>{
  const v=virtualList(60),readRows=v.view.rows,move=v.view.move;
  let rendered=readRows(),pending=0;
  v.view.rows=()=>rendered;
  v.view.move=y=>{move(y);pending=3;};
  const r=await collectConversations(v.view,{...v,settleMs:10,endQuietMs:40,wait:async ms=>{await v.wait(ms);if(pending>0&&--pending===0)rendered=readRows();}});
  expect(r.complete).toBe(true);expect(r.people).toHaveLength(60);
});
it('群聊占据列表索引但不可选时，不制造虚假的漏读缺口',async()=>{
  const v=virtualList(30),rows=v.view.rows;
  v.view.rows=()=>rows().map(r=>r.index===0||r.index===12||r.index===29?{person:null,index:r.index,skipped:{key:`group${r.index}`,name:`群聊 ${r.index}`,reason:'群聊暂不支持'}}:r);
  const r=await collectConversations(v.view,{...v,settleMs:10,endQuietMs:20});
  expect(r.complete).toBe(true);expect(r.reason).toBe('');expect(r.people).toHaveLength(27);expect(r.skipped).toHaveLength(3);expect(v.view.position()).toBe(120);
});
it('列表全为不可选条目也能结束，且不会生成发送对象',async()=>{
  const v=virtualList(15),rows=v.view.rows;
  v.view.rows=()=>rows().map(r=>({person:null,index:r.index,skipped:{key:`g${r.index}`,name:'群聊',reason:'不支持'}}));
  const r=await collectConversations(v.view,{...v,settleMs:10,endQuietMs:20});
  expect(r.complete).toBe(true);expect(r.people).toHaveLength(0);expect(r.skipped).toHaveLength(15);
});
it('即使有不可选条目，真正没有读到的索引仍报告部分结果',async()=>{
  const v=virtualList(30),rows=v.view.rows;
  v.view.rows=()=>rows().filter(r=>r.index!==13).map(r=>r.index===12?{person:null,index:r.index,skipped:{key:'g12',name:'群聊',reason:'不支持'}}:r);
  const r=await collectConversations(v.view,{...v,settleMs:10,endQuietMs:20});
  expect(r.complete).toBe(false);expect(r.reason).toContain('未连续加载');expect(r.skipped).toHaveLength(1);
});
it('头像稍后加载完成时，清除同一位置的过期不可选提示',async()=>{
  const v=virtualList(6),rows=v.view.rows;let reads=0;
  v.view.rows=()=>{reads++;return rows().map(r=>r.index===5&&reads<4?{person:null,index:5,skipped:{key:'missing',name:'好友 5',reason:'头像未加载'}}:r);};
  const r=await collectConversations(v.view,{...v,settleMs:10,endQuietMs:50});
  expect(r.complete).toBe(true);expect(r.people).toHaveLength(6);expect(r.skipped).toHaveLength(0);
});
