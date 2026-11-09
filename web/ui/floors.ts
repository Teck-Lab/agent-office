import type {OfficeScene} from '../contract.ts';
import type {Chrome} from './app.ts';
import {FloorModel,type Floor} from './floors-model.ts';
import {h} from './dom.ts';
import type {ConnState} from './connection.ts';

const KEY='agentoffice:floor:v1';
export function createFloorPicker(onChoose:(key:string)=>void){
  const select=h('select',{attrs:{'aria-label':'Office floor'}});
  const previous=h('button',{text:'↑',attrs:{type:'button','aria-label':'Previous floor'}});
  const next=h('button',{text:'↓',attrs:{type:'button','aria-label':'Next floor'}});
  const summary=h('span',{class:'floor-summary',attrs:{'aria-live':'polite'}});
  const el=h('section',{class:'floor-picker',attrs:{'aria-label':'Office floors'}},
    h('div',{class:'floor-heading'},h('span',{text:'FLOORS'}),summary),h('div',{class:'floor-controls'},previous,select,next));
  let floors:Floor[]=[],selected='all',signature='';
  const choose=(key:string)=>{if(floors.some(f=>f.key===key))onChoose(key);};
  select.addEventListener('change',()=>choose(select.value));
  previous.addEventListener('click',()=>{const i=floors.findIndex(f=>f.key===selected);if(i>0)choose(floors[i-1]!.key);});
  next.addEventListener('click',()=>{const i=floors.findIndex(f=>f.key===selected);if(i<floors.length-1)choose(floors[i+1]!.key);});
  return {el,update(list:Floor[],key:string){
    floors=list;selected=key;
    const sig=JSON.stringify(list.map(f=>[f.key,f.label,f.sessions,f.helpers]));
    if(sig!==signature){signature=sig;select.replaceChildren();
      for(const [i,f]of list.entries())select.append(h('option',{text:(i?'F'+i+' · ':'')+(f.kind==='project'?f.label+' · All Runs':f.label)+' ('+(f.sessions+f.helpers)+')',attrs:{value:f.key}}));
    }
    if(select.value!==key)select.value=key;const i=list.findIndex(f=>f.key===key),f=list[i];previous.disabled=i<=0;next.disabled=i>=list.length-1;
    if(f){const text=f.sessions+' sessions · '+f.helpers+' helpers';if(summary.textContent!==text)summary.textContent=text;el.title=f.group+(f.runId?' / '+f.runId:'')+' — view only';}
    return i>0?'F'+i:'ALL';
  }};
}

/** One global stream, a filtered read-only presentation. No new server/control API. */
export function mountFloors(root:HTMLElement,scene:OfficeScene,chrome:Chrome):Chrome{
  let saved:unknown='all';try{saved=localStorage.getItem(KEY)??'all';}catch{}
  const model=new FloorModel(saved);let state:ConnState='connecting',fresh=false;
  const picker=createFloorPicker(key=>{
    model.choose(key);try{localStorage.setItem(KEY,model.selected.key);}catch{}
    chrome.clearSelection?.();refresh(true);if(model.model.loaded)render();
  });
  root.append(picker.el);
  function refresh(reset=false){chrome.setFloorContext?.(model.selected.kind!=='all');scene.setFloor?.(picker.update(model.floors(),model.selected.key),reset);}
  function render(){chrome.load(model.snapshot());if(!fresh)chrome.connection(state==='live'?'connecting':state);}
  refresh();
  return {
    load(s){model.load(s);fresh=true;refresh();render();},
    apply(e){const result=model.apply(e);refresh();if(result.reload)render();else if(result.event)chrome.apply(result.event);},
    connection(s,retry){state=s;if(s!=='live')fresh=false;chrome.connection(s,retry);},
    control:(name,data)=>chrome.control(name,data),prime:()=>chrome.prime(),clearSelection:()=>chrome.clearSelection?.(),
  };
}
