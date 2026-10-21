import type {Person} from './model';

export interface ScanProgress {count:number;rounds:number;phase:'reading'|'waiting'}
export interface SkippedConversation {key:string;name:string;reason:string}
export interface ScanRow {person:Person|null;index:number|null;skipped?:SkippedConversation}
export interface ScanResult {people:Person[];ambiguous:number;complete:boolean;reason:string;rounds:number;skipped?:SkippedConversation[]}
export interface ScanViewport {
  position():number;
  height():number;
  viewport():number;
  move(y:number):void;
  // Include every rendered row, even if it cannot become a sending target.
  rows():ScanRow[];
  loading():boolean;
}
interface ScanOptions {
  signal?:AbortSignal;
  check?:()=>void;
  progress?:(p:ScanProgress)=>void;
  wait?:(ms:number)=>Promise<void>;
  now?:()=>number;
  maxMs?:number;
  settleMs?:number;
  endQuietMs?:number;
}

// The list is virtualized: only rendered rows may be read. Move by overlapping
// viewports and wait at the bottom for lazy-loaded pages before declaring an end.
export async function collectConversations(view:ScanViewport,options:ScanOptions={}):Promise<ScanResult> {
  const wait=options.wait||((ms:number)=>new Promise<void>(r=>setTimeout(r,ms)));
  const now=options.now||Date.now, started=now(), original=view.position();
  const maxMs=options.maxMs??180000,settleMs=options.settleMs??180,endQuietMs=options.endQuietMs??3000;
  const people=new Map<string,Person>(),positions=new Map<string,Set<number>>(),ambiguous=new Set<string>();
  const indices=new Set<number>();
  const skipped=new Map<string,SkippedConversation>();
  const rowSignature=(rows:ScanRow[])=>JSON.stringify(rows.map(r=>[r.person?.id??r.skipped?.key??`row:${r.index}`,r.index]));
  let rounds=0,complete=false,reason='',bottomSince:number|null=null,lastSignature='',stalledSince:number|null=null;
  let pendingRows:string|null=null,pendingSince=0;
  const check=()=>{
    if(options.signal?.aborted) throw Error('已停止读取，已保留当前结果');
    options.check?.();
  };
  try {
    check();
    if(original>=view.viewport()*.25&&original>0){pendingRows=rowSignature(view.rows());pendingSince=now();}
    view.move(0);
    while(now()-started<maxMs && rounds<2500) {
      check();await wait(settleMs);check();rounds++;
      const rows=view.rows(),frameIds=new Set<string>();
      const frameSignature=rowSignature(rows);
      // Updating scrollTop does not guarantee that a virtual list has rendered.
      // Background tabs and busy pages can defer scroll handlers for seconds.
      if(pendingRows!==null&&frameSignature===pendingRows) {
        options.progress?.({count:people.size-ambiguous.size,rounds,phase:'waiting'});
        if(now()-pendingSince>6000) throw Error('会话列表重绘尚未完成，请保持聊天页可见后重试');
        continue;
      }
      pendingRows=null;
      for(const {person,index,skipped:excluded} of rows) {
        // Coverage is independent of eligibility. Filtering groups first creates
        // artificial index gaps and falsely reports an incomplete traversal.
        if(index!==null) indices.add(index);
        const exclusionKey=index===null?excluded?.key:`index:${index}`;
        if(!person){if(excluded&&exclusionKey)skipped.set(exclusionKey,excluded);continue;}
        if(exclusionKey)skipped.delete(exclusionKey);
        if(frameIds.has(person.id)) ambiguous.add(person.id);
        frameIds.add(person.id);
        if(index!==null) {
          const locations=positions.get(person.id)||new Set<number>();locations.add(index);positions.set(person.id,locations);
          if(locations.size>1) ambiguous.add(person.id);
        }
        people.set(person.id,person);
      }
      const height=view.height(),top=view.position(),viewport=view.viewport();
      if(viewport<=0) throw Error('会话列表不可见，请展开左侧会话列表后重试');
      const atEnd=top+viewport>=height-3;
      const signature=JSON.stringify([height,top,people.size,frameSignature]);
      options.progress?.({count:people.size-ambiguous.size,rounds,phase:atEnd?'waiting':'reading'});
      if(atEnd) {
        if(signature!==lastSignature||view.loading()||!rows.length) bottomSince=null;
        else if(bottomSince===null) bottomSince=now();
        if(bottomSince!==null&&now()-bottomSince>=endQuietMs) {
          const ordered=[...indices].sort((a,b)=>a-b);
          const gap=(ordered.length>0&&ordered[0]>1)||ordered.some((n,i)=>i>0&&n!==ordered[i-1]+1);
          if(gap) reason='列表发生跳动，部分会话未连续加载；请再次读取';
          else complete=true;
          break;
        }
        // Scroll again to trigger load-more handlers when a new page arrives.
        view.move(height);
      } else {
        bottomSince=null;
        const next=Math.min(height-viewport,top+Math.max(1,Math.floor(viewport*.7)));
        view.move(next);
        if(view.position()===top) {
          stalledSince??=now();
          if(now()-stalledSince>4000) throw Error('列表未继续滚动，已保留部分结果，请重试');
        } else {
          stalledSince=null;
          if(next-top>=viewport*.25) {pendingRows=frameSignature;pendingSince=now();}
        }
      }
      lastSignature=signature;
    }
    if(!complete&&!reason) reason=people.size?'读取达到时间上限，已保留部分结果，可再次一键读取':'未读到会话，请确认列表已经加载';
  } catch(e) {reason=(e as Error).message;}
  finally {view.move(original);}
  return {people:[...people.values()].filter(p=>!ambiguous.has(p.id)),ambiguous:ambiguous.size,complete,reason,rounds,skipped:[...skipped.values()]};
}
