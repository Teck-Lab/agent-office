import {h} from './dom.ts';
import {cleanView,DEFAULT_VIEW,type ViewPreferences} from '../scene/presentation.ts';

const KEY='agentoffice:appearance:v1';
export function createAppearance(change:(prefs:ViewPreferences)=>void){
 let prefs=cleanView(null);
 try{const saved=localStorage.getItem(KEY);prefs=cleanView(saved?JSON.parse(saved):{motion:!matchMedia('(prefers-reduced-motion: reduce)').matches});}catch{}
 const tab=h('button',{class:'appearance-tab',text:'Appearance',attrs:{type:'button','aria-haspopup':'dialog'}});
 const dialog=h('dialog',{class:'appearance-dialog',attrs:{'aria-label':'Office appearance'}});
 const form=h('div',{class:'appearance-options'});
 const close=h('button',{text:'Done',attrs:{type:'button'},on:{click:()=>dialog.close()}});
 dialog.append(h('h2',{text:'Office appearance'}),h('p',{text:'Visual settings for this browser only. Agent activity comes from Orca and OMP.'}),form,h('p',{class:'appearance-note',text:'Local time uses this device’s clock. Weather is decorative, not a live forecast. Speaking indicators reflect received reports, not audio.'}));
 const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(prefs));}catch{}change({...prefs});};
 function render(){
  form.replaceChildren();
  const selects:[keyof ViewPreferences,string,[string,string][]][]=[
   ['time','Outside',[['local','Local clock'],['day','Daylight'],['dusk','Dusk'],['night','Night']]],
   ['season','Season',[['north','Northern calendar'],['south','Southern calendar'],['spring','Spring'],['summer','Summer'],['autumn','Autumn'],['winter','Winter']]],
   ['weather','Decorative weather',[['date','Vary by day'],['clear','Clear'],['rain','Rain']]],
   ['theme','Room colours',[['original','Original'],['forest','Forest'],['sunset','Sunset']]],
   ['furniture','Meeting furniture',[['oak','Oak'],['walnut','Walnut']]],
   ['layout','Meeting layout',[['horizontal','Horizontal table'],['vertical','Vertical table']]],
   ['characters','Character accessories',[['original','Original'],['headphones','Headphones'],['caps','Caps']]],
   ['decor','Decorations',[['standard','Standard'],['plants','More plants'],['minimal','Minimal']]],
   ['labels','Task labels',[['tasks','Activity and task'],['status','Activity only'],['quiet','On hover only']]]
  ];
  for(const [key,title,options]of selects){const input=h('select');
   input.setAttribute('aria-label',title);
   for(const [value,label]of options)input.append(h('option',{text:label,attrs:{value}}));input.value=String(prefs[key]);
   input.addEventListener('change',()=>{prefs=cleanView({...prefs,[key]:input.value});save();});form.append(h('label',null,h('span',{text:title}),input));
  }
  for(const [key,title]of [['handoffs','Observed assignment and helper handoffs'],['personalDesks','Personal desk details'],['motion','Animated movement'],['ambience','Ambient life and coffee breaks'],['links','Team colours and relationship lines'],['celebrations','Completion celebrations']]as const){
   const input=h('input',{attrs:{type:'checkbox'}});input.checked=prefs[key];input.addEventListener('change',()=>{prefs={...prefs,[key]:input.checked};save();});form.append(h('label',null,h('span',{text:title}),input));
  }
 }
 const reset=h('button',{text:'Reset appearance',attrs:{type:'button'},on:{click:()=>{prefs={...DEFAULT_VIEW};render();save();}}});
 dialog.append(h('div',{class:'appearance-actions'},reset,close));
 tab.addEventListener('click',()=>{render();dialog.showModal();});
 dialog.addEventListener('close',()=>tab.focus());
 change({...prefs});
 return {tab,el:dialog};
}
