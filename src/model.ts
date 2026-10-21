export interface Person {
  kind?: 'person' | 'group';
  id: string;
  name: string;
  avatar: string;
  avatarKey: string;
  streak: string;
}
export interface Emoji {
  id: string;
  name: string;
  image: string;
  asset: string;
  tab: string;
  kind: 'small' | 'sticker';
}
export interface Settings {
  enabled: boolean;
  time: string;
  graceMinutes: number;
  gapSeconds: number;
  people: Person[];
  emoji: Emoji | null;
}
export interface Binding { tabId: number; documentId: string; account: string; boundAt: number }
export type Status = 'sending' | 'observed' | 'failed' | 'uncertain' | 'confirmed' | 'skipped';
export interface RecordEntry {
  key: string; day: string; person: string; account: string;
  emoji: string; status: Status; detail: string; at: number; runId: string;
}
export interface State {
  settings: Settings;
  records: RecordEntry[];
  log: { at: number; text: string }[];
  active: { runId: string; key: string; until: number } | null;
  queue: { day:string; ids:string[]; account:string } | null;
  nextAllowed: number;
  reading?: {token:string;tabId:number;until:number} | null;
}
export const defaults = (): State => ({
  settings:{enabled:false,time:'09:00',graceMinutes:180,gapSeconds:15,people:[],emoji:null},
  records:[],log:[],active:null,queue:null,nextAllowed:0
});
export function dayAt(now = Date.now()): string {
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export function scheduleAt(time: string, now = Date.now()): number {
  return Date.parse(`${dayAt(now)}T${time}:00+08:00`);
}
export function isDue(settings: Settings, now = Date.now()): boolean {
  const elapsed = now - scheduleAt(settings.time,now);
  return settings.enabled && elapsed >= 0 && elapsed <= settings.graceMinutes * 60000;
}
export function recordKey(account: string, person: string, day = dayAt()): string {
  return JSON.stringify([account, person, day]);
}
export function blocked(entry?: RecordEntry): boolean {
  // Once a click might have occurred, retry is never automatic.
  return !!entry;
}
export function assetKey(url: string): string {
  // ByteDance uses "~tplv-..." for thumbnail transforms; chat messages can use
  // a different transform of the same original asset.
  try { return new URL(url).pathname.split('~')[0]; } catch { return ''; }
}
export function validImage(url: string): boolean {
  try {
    const u=new URL(url);
    return u.protocol==='https:' && ['douyinpic.com','byteimg.com','bytednsdoc.com'].some(d=>u.hostname===d||u.hostname.endsWith('.'+d));
  } catch { return false; }
}
// Old personal IDs remain unchanged so saved selections and daily records survive.
export function conversationId(name:string,avatarKey:string,kind:Person['kind']='person'):string {
  return JSON.stringify(kind==='group'?['group',name,avatarKey]:[name,avatarKey]);
}
export function conversationLabel(p:Person):string {return p.kind==='group'?`[群聊] ${p.name}`:p.name;}
export function conversationAvatar(url:string):string {
  try {
    const u=new URL(url);
    if(u.protocol==='http:')u.protocol='https:';
    return validImage(u.href)?u.href:'';
  } catch {return '';}
}
export function validateSettings(value: unknown): Settings {
  const s=value as Settings;
  if (!s || typeof s.enabled!=='boolean' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s.time)) throw Error('发送时间无效');
  if (!Number.isInteger(s.graceMinutes)||s.graceMinutes<0||s.graceMinutes>720) throw Error('补发窗口应为 0–720 分钟');
  if (!Number.isInteger(s.gapSeconds)||s.gapSeconds<10||s.gapSeconds>300) throw Error('发送间隔应为 10–300 秒');
  if (!Array.isArray(s.people)||s.people.length>100) throw Error('最多选择 100 个会话');
  const ids=new Set<string>();
  for (const p of s.people) {
    if (!p||typeof p.name!=='string'||!p.name.trim()||p.name.length>150||!validImage(p.avatar)||p.avatarKey!==assetKey(p.avatar)||(p.kind!==undefined&&!['person','group'].includes(p.kind))||p.id!==conversationId(p.name,p.avatarKey,p.kind)||ids.has(p.id)) throw Error('会话配置无效或重复，请重新读取');
    ids.add(p.id);
  }
  const e=s.emoji;
  if(e && (!validImage(e.image)||e.asset!==assetKey(e.image)||e.id!==JSON.stringify([e.kind,e.tab,e.asset])||!['small','sticker'].includes(e.kind)||typeof e.tab!=='string'||e.tab.length>8000||typeof e.name!=='string'||e.name.length>150)) throw Error('表情配置无效，请重新读取');
  if(s.enabled&&(!e||!s.people.length)) throw Error('先选择会话和表情');
  return {enabled:s.enabled,time:s.time,graceMinutes:s.graceMinutes,gapSeconds:s.gapSeconds,people:s.people,emoji:e||null};
}
