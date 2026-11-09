import type {Crew,Worker} from './workers.ts';
import {teamKey} from './presentation.ts';
import {hash} from './util.ts';
const INKS=['#7dd3fc','#c4b5fd','#86efac','#fbbf24','#f9a8d4','#5eead4'];
export function teamInk(w:Worker,crew:Crew){
 const seen=new Set<string>();let root=w;
 while(root.parentId&&!seen.has(root.id)){seen.add(root.id);const parent=crew.workers.get(root.parentId);if(!parent)break;root=parent;}
 return INKS[hash(teamKey(w)??root.id)%INKS.length];
}
export function drawRelationships(g:CanvasRenderingContext2D,crew:Crew){
 if(!crew.preferences.links)return;
 const live=[...crew.workers.values()].filter(w=>!w.leaving&&!w.gone&&w.alpha>0.8);
 const focus=crew.hovered??crew.selected;
 g.save();g.lineWidth=1;
 for(const w of live){
  if(!Number.isFinite(w.x)||!Number.isFinite(w.y))continue;
  const ink=teamInk(w,crew);g.fillStyle=ink;g.globalAlpha=.7;g.fillRect(Math.round(w.x)-5,Math.round(w.y)+5,10,1);
  // Keep a busy office legible: lines only for the inspected family/Run.
  if(!focus||!crew.sameTeam(focus,w.id))continue;
  const owner=w.parentId?crew.workers.get(w.parentId):live.find(p=>p.orchestration?.role==='coordinator'&&teamKey(p)&&teamKey(p)===teamKey(w));
  if(!owner||owner.id===w.id)continue;
  g.strokeStyle=ink;g.globalAlpha=.35;g.setLineDash([3,4]);g.beginPath();g.moveTo(owner.x,owner.y+5);g.lineTo(owner.x,w.y+5);g.lineTo(w.x,w.y+5);g.stroke();
 }
 g.restore();
}
