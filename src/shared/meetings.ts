/** Presentation only: membership never changes work, goals or coordination. */
import {scrubText} from '../ingest/redact.ts';
export interface MeetingCommand {action:'start'|'join'|'update'|'leave'|'end';id:string;title?:string;agenda?:string;decision?:string;}
export interface OfficeMeeting {id:string;sourceId:string;ownerId:string;title:string;agenda?:string;decision?:string;participants:string[];updatedAt:string;}
export function cleanMeeting(v:unknown):MeetingCommand|null {
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  const a=v as Record<string,unknown>;
  if(Object.keys(a).some(k=>!['action','id','title','agenda','decision'].includes(k)))return null;
  if(!['start','join','update','leave','end'].includes(String(a.action))||typeof a.id!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(a.id))return null;
  for(const k of ['title','agenda','decision'])if(a[k]!==undefined&&(typeof a[k]!=='string'||(a[k] as string).length>200))return null;
  const c:MeetingCommand={action:a.action as MeetingCommand['action'],id:a.id};
  for(const k of ['title','agenda','decision'] as const)if(a[k]!==undefined)c[k]=scrubText(a[k]);
  if(c.action==='start'&&!c.title)return null;
  return c;
}
export class Meetings {
  private items=new Map<string,OfficeMeeting>();
  snapshot():OfficeMeeting[]{return [...this.items.values()].map(m=>({...m,participants:[...m.participants]}));}
  clear(){this.items.clear();}
  remove(workerId:string){for(const [key,m] of this.items){if(m.ownerId===workerId)this.items.delete(key);else m.participants=m.participants.filter(id=>id!==workerId);}}
  apply(sourceId:string,workerId:string,c:MeetingCommand,ts:string):boolean {
    const key=sourceId+':'+c.id,m=this.items.get(key);
    if(c.action==='start'){
      if(m||[...this.items.values()].some(m=>m.ownerId===workerId)||[...this.items.values()].filter(m=>m.sourceId===sourceId).length>=4)return false;
      this.removeMembership(workerId);
      this.items.set(key,{id:c.id,sourceId,ownerId:workerId,title:c.title!,agenda:c.agenda,decision:c.decision,participants:[workerId],updatedAt:ts});return true;
    }
    if(!m)return false;
    if(c.action==='join'){
      if(!m.participants.includes(workerId)&&m.participants.length>=8)return false;
      this.removeMembership(workerId);m.participants.push(workerId);
    }else if(c.action==='leave')m.participants=m.participants.filter(id=>id!==workerId);
    else {
      if(m.ownerId!==workerId)return false;
      if(c.action==='end'){this.items.delete(key);return true;}
      if(c.title)m.title=c.title;
      if(c.agenda!==undefined)m.agenda=c.agenda;
      if(c.decision!==undefined)m.decision=c.decision;
    }
    m.updatedAt=ts;return true;
  }
  private removeMembership(id:string){for(const m of this.items.values())m.participants=m.participants.filter(w=>w!==id);}
}
