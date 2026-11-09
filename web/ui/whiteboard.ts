import type {OfficeMeeting} from '../../src/shared/meetings.ts';
import type { WorkerState } from '../../src/shared/events.ts';
import { boardViews, type BoardView } from './whiteboard-model.ts';
import { h } from './dom.ts';
export function createWhiteboard(opts: {onMeeting?:(key:string)=>void;onChoose:(id:string)=>void}) {
  let views:BoardView[]=[], selected='', fingerprint='', pickerKey='', restoreFocus:HTMLElement|null=null;
  const picker=h('select',{attrs:{'aria-label':'Orchestrator whiteboard'},on:{change:()=>{selected=picker.value;opts.onChoose(selected);render();}}});
  const heading=h('h2',{text:'Meeting room & TV plan',attrs:{id:'whiteboard-title'}});
  let meetings:OfficeMeeting[]=[],meetingSelected='';
  let known=new Map<string,WorkerState>();
  const meetingBody=h('section',{class:'wb-meeting',attrs:{'aria-label':'Meeting agenda'}});
  const meetingPicker=h('select',{attrs:{'aria-label':'Meeting'},on:{change:()=>{meetingSelected=meetingPicker.value;renderMeetings();opts.onMeeting?.(meetingSelected);}}});
  function renderMeetings(){
    meetingPicker.replaceChildren(...meetings.map(m=>h('option',{text:m.title,attrs:{value:m.sourceId+':'+m.id}})));
    if(!meetings.some(m=>m.sourceId+':'+m.id===meetingSelected))meetingSelected=meetings[0]?meetings[0].sourceId+':'+meetings[0].id:'';
    meetingPicker.value=meetingSelected;meetingPicker.hidden=meetings.length<2;meetingBody.replaceChildren();
    const m=meetings.find(m=>m.sourceId+':'+m.id===meetingSelected);
    meetingBody.append(h('h3',{text:m?.title??'No meeting in progress'}));
    if(!m){meetingBody.append(h('p',{class:'wb-note',text:'Main sessions can start or join through office_meeting. Native helpers stay at their desks.'}));return;}
    if(m.agenda)meetingBody.append(h('p',{text:m.agenda}));
    if(m.decision)meetingBody.append(h('p',{class:'wb-decision',text:'Decision: '+m.decision}));
    meetingBody.append(h('p',{class:'wb-note',text:m.participants.length+' / 8 main sessions · Meeting '+m.id}));
    for(const id of m.participants){const w=known.get(id),issue=w?.orchestration?.issue?.split('/').at(-1);
      meetingBody.append(h('div',{class:'wb-attendee',text:(w?.orchestration?.role??w?.role??'OMP')+(issue?' · #'+issue:'')+' · '+id.slice(-8)+(id===m.ownerId?' · host':''),attrs:{title:id}}));}
  }
  const body=h('div',{class:'wb-body'});
  const close=h('button',{class:'wb-close',text:'Close',attrs:{type:'button'},on:{click:()=>hide()}});
  const el=h('dialog',{class:'whiteboard-dialog',attrs:{'aria-labelledby':'whiteboard-title'}},
    h('header',{class:'wb-header'},h('div',null,h('span',{class:'wb-kicker',text:'OMP · LIVE PLAN'}),heading),close),meetingPicker,meetingBody,picker,body);
  const tab=h('button',{class:'whiteboard-tab',attrs:{type:'button','aria-haspopup':'dialog'},on:{click:()=>show()}},
    h('span',{class:'wb-tab-icon',text:'▤',attrs:{'aria-hidden':'true'}}),h('span',{text:'Meeting room'}));
  el.addEventListener('close',()=>{tab.setAttribute('aria-expanded','false');restoreFocus?.focus();});
  el.addEventListener('click',e=>{if(e.target===el){const r=el.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)hide();}});
  function show(){restoreFocus=document.activeElement instanceof HTMLElement?document.activeElement:tab;renderMeetings();render();if(!el.open)el.showModal();tab.setAttribute('aria-expanded','true');}
  function hide(){if(el.open)el.close();}
  function issue(url?:string){return url&&/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9]\d*$/.test(url)?h('a',{text:'#'+url.split('/').at(-1),attrs:{href:url,target:'_blank',rel:'noopener noreferrer'}}):null;}
  function render(){
    const view=views.find(v=>v.owner.workerId===selected)??views[0];
    if(view)selected=view.owner.workerId;
    const key=JSON.stringify([selected,views]);if(key===fingerprint)return;fingerprint=key;
    const nextPicker=JSON.stringify(views.map(v=>[v.owner.workerId,v.owner.project,v.owner.orchestration?.runId]));
    if(nextPicker!==pickerKey){pickerKey=nextPicker;picker.replaceChildren(...views.map((v,i)=>h('option',{text:v.owner.project+' · '+(v.owner.orchestration?.runId??'Session '+(i+1)),attrs:{value:v.owner.workerId}})));}
    picker.value=selected;picker.hidden=views.length<2;
    body.replaceChildren();
    if(!view){body.append(h('p',{class:'wb-empty',text:'No connected orchestrator yet. Its native goal and tasks will appear here when available.'}));return;}
    const {plan,owner}=view;
    body.append(h('div',{class:'wb-owner'},h('span',{text:owner.project}),h('code',{text:owner.orchestration?.runId??'No Orca Run yet'}),issue(owner.orchestration?.issue)));
    body.append(h('section',{class:'wb-goal'},h('span',{class:'wb-kicker',text:'NATIVE GOAL'}),
      h('h3',{text:plan?.goal?.objective??'No native goal set'}),h('span',{class:'wb-state',text:plan?.goal?.status??'Awaiting goal'})));
    body.append(h('div',{class:'wb-progress'},h('strong',{text:view.completed+' / '+view.total}),h('span',{text:'OMP tasks complete'+(view.blocked?' · '+view.blocked+' blocked':'')}),
      h('progress',{attrs:{max:Math.max(1,view.total),value:view.completed,'aria-label':'OMP task completion'}})));
    for(const phase of plan?.phases??[]){
      const list=h('ul',{class:'wb-tasks'});
      for(const task of phase.tasks)list.append(h('li',{class:'wb-task is-'+task.status},h('span',{class:'wb-check',text:({completed:'✓',in_progress:'▶',blocked:'!',abandoned:'–',pending:'○'})[task.status],'attrs':{'aria-hidden':'true'}}),
        h('div',null,h('span',{text:task.content}),h('small',{text:task.status.replaceAll('_',' ')}),task.blocker?h('p',{class:'wb-blocker',text:task.blocker}):null)));
      body.append(h('section',{class:'wb-phase'},h('h3',{text:phase.name}),list));
    }
    if(!plan?.phases.length)body.append(h('p',{class:'wb-empty',text:'No native todo list reported yet.'}));
    if(plan?.truncated)body.append(h('p',{class:'wb-note',text:'Showing a bounded preview of this plan. OMP retains the full list.'}));
    const assignments=h('section',{class:'wb-assignments'},h('h3',{text:'Orca assignments'}));
    assignments.append(h('p',{class:'wb-note',text:'Connected sessions in this exact Run. Activity and native goal completion are separate.'}));
    for(const w of view.workers)assignments.append(h('article',{class:'wb-assignment'},
      h('div',null,h('strong',{text:w.plan?.goal?.objective??w.role??'Worker'}),issue(w.orchestration?.issue)),
      h('p',{text:(w.role??'Worker')+' · '+(w.status==='waiting'?'Waiting':w.status==='idle'?'Idle':w.status.replaceAll('_',' '))+' · Goal: '+(w.plan?.goal?.status??'not reported')}),
      h('code',{text:w.orchestration?.taskId??''})));
    if(!view.workers.length)assignments.append(h('p',{class:'wb-empty',text:'No connected worker assignments for this Run.'}));
    body.append(assignments,h('p',{class:'wb-note',text:'Read-only view · OMP owns goals/todos · Orca owns assignments · GitHub issue links open separately.'}));
  }
  return {el,tab,show,hide,setMeetings(next:OfficeMeeting[]){meetings=next;renderMeetings();return meetingSelected;},update(workers:Iterable<WorkerState>){const all=[...workers];known=new Map(all.map(w=>[w.workerId,w]));views=boardViews(all);if(el.open)renderMeetings();if(!views.some(v=>v.owner.workerId===selected))selected=views[0]?.owner.workerId??'';
    tab.dataset.empty=String(!views.length);tab.title=views.length+' connected orchestrator'+(views.length===1?'':'s');if(el.open)render();return views.find(v=>v.owner.workerId===selected)??null;},isOpen:()=>el.open};
}
