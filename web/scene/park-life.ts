import {mix} from './palette.ts';

type Bounds={x:number;w:number};
export type Passer={kind:'walker'|'cyclist';x:number;frame:number;direction:1|-1};

/** Two decorative passers at most across the entire panorama, with gaps between visits. */
export function parkTraffic(room:Bounds,time:number,enabled=true):Passer[]{
  if(!enabled||time<=0||room.w<=0)return [];
  const out:Passer[]=[];
  for(const kind of ['walker','cyclist'] as const){
    const start=kind==='walker'?8000:20000,speed=kind==='walker'?.010:.021;
    if(time<start)continue;
    const distance=room.w+24,duration=distance/speed,gap=kind==='walker'?18000:32000;
    const elapsed=(time-start)%(duration+gap);
    if(elapsed>=duration)continue;
    const direction=kind==='walker'?1:-1;
    const x=room.x-12+(direction===1?elapsed*speed:distance-elapsed*speed);
    out.push({kind,x:Math.round(x),frame:Math.floor(time/(kind==='walker'?240:140))%2,direction});
  }
  return out;
}

export function drawPassers(g:CanvasRenderingContext2D,room:Bounds,base:number,time:number,enabled:boolean){
  g.save();
  for(const p of parkTraffic(room,time,enabled)){
    const x=p.x,y=base-5;
    const rect=(px:number,py:number,w:number,h:number)=>g.fillRect(p.direction===1?px:2*x-px-w,py,w,h);
    g.fillStyle='#394958';
    if(p.kind==='walker'){
      rect(x-2-p.frame,y-2,2,2);rect(x+p.frame,y-2,2,2);
      g.fillStyle='#a87573';rect(x-2,y-7,4,5);
      g.fillStyle='#d5b699';rect(x-1,y-10,3,3);
      g.fillStyle='#566178';rect(x-1,y-11,3,1);rect(x+2,y-6+p.frame,1,2);
    }else{
      for(const wheel of [x-6,x+3]){
        g.fillStyle='#394958';rect(wheel,y-3,4,1);rect(wheel,y,4,1);rect(wheel-1,y-2,1,2);rect(wheel+4,y-2,1,2);
        g.fillStyle='#b8c7d1';rect(wheel+1+p.frame,y-2,1,2);
      }
      g.fillStyle='#7fada8';rect(x-3,y-3,7,1);rect(x,y-5,1,3);rect(x+4,y-6,1,4);
      g.fillStyle='#657da3';rect(x-1,y-9,4,3);rect(x+p.frame,y-6,1,3);
      g.fillStyle='#d5b699';rect(x-1,y-12,3,3);
      g.fillStyle='#e8cc89';rect(x-2,y-13,4,2);
    }
  }
  g.restore();
}

/** Reflections remain still with reduced motion; the weather is explicitly decorative. */
export function drawWetPath(g:CanvasRenderingContext2D,room:Bounds,base:number,time:number,night:number,wet:boolean,fountainX:number|null=null){
  if(!wet)return;
  g.save();g.globalAlpha=.42;g.fillStyle=mix('#a9c7d8','#8ca6c5',night);
  g.fillRect(room.x,base-8,room.w,4);
  for(let i=0;i<Math.ceil(room.w/78);i++){
    const x=Math.floor(room.x+i*78+23),w=11+(i%3)*3;
    g.globalAlpha=.55;g.fillStyle='#b2c9dc';g.fillRect(x,base-6,w,1);g.fillRect(x+2,base-7,w-4,1);
    if(time>0){const ripple=Math.floor(time/350+i)%3;g.globalAlpha=.65;g.fillRect(x+3+ripple,base-5,3+ripple,1);}
  }
  if(night>.15)for(let i=0;i<Math.ceil(room.w/116);i++){
    const x=Math.floor(room.x+i*116+44);if(fountainX!==null&&Math.abs(x+10-fountainX)<25)continue;g.globalAlpha=.35+night*.3;g.fillStyle='#f7d896';
    g.fillRect(x-1,base-8,3,1);g.fillRect(x-2,base-6,5,1);g.fillRect(x-3,base-4,7,1);
  }
  g.restore();
}

/** A small stone fountain, frozen in winter. All motion uses the scene clock. */
export function drawFountain(g:CanvasRenderingContext2D,x:number,base:number,time:number,night:number,winter:boolean){
  x=Math.round(x);const y=base-10;
  g.save();g.globalAlpha=1;
  g.fillStyle=mix('#687b89','#485f78',night);g.fillRect(x-9,y-3,18,5);g.fillRect(x-7,y+2,14,1);
  g.fillStyle=mix('#bac8c9','#8196b0',night);g.fillRect(x-8,y-4,16,1);g.fillRect(x-10,y-2,2,3);g.fillRect(x+8,y-2,2,3);
  g.fillStyle=winter?'#cadfe9':mix('#7ebccc','#638cba',night);g.fillRect(x-7,y-3,14,4);
  g.fillStyle=winter?'#e5eff1':'#c4e5e9';
  const phase=!winter&&time>0?Math.floor(time/240)%3:0;
  g.fillRect(x-5+phase,y-1,3,1);g.fillRect(x+2-phase,y-2,3,1);
  if(!winter){
    g.fillStyle='#9db4be';g.fillRect(x-1,y-8,2,6);
    g.fillStyle='#c4e5e9';g.fillRect(x,y-13,1,5);g.fillRect(x-2,y-11,2,1);g.fillRect(x+1,y-11,2,1);
    g.fillRect(x-3,y-10,1,2);g.fillRect(x+3,y-10,1,2);
    g.fillStyle='#9fd1df';g.fillRect(x-4,y-7+phase,1,2);g.fillRect(x+4,y-7+(2-phase),1,2);
  }
  g.restore();
}
