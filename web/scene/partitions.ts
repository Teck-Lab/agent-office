import {C,mix,rgba} from './palette.ts';
import {WALL_H} from './layout.ts';
/** Native cloud steel/glass partition, clipped to its segment endpoints. */
export function glassPartition(g:CanvasRenderingContext2D,x:number,y:number,h:number){
 const r=(dx:number,dy:number,w:number,height:number,c:string)=>{g.fillStyle=c;g.fillRect(dx,dy,w,height);};
 const end=y+h,top=Math.max(y,WALL_H);
 r(x,y,12,h,C.steel2);r(x+1,y,1,h,C.steel4);r(x+10,y,1,h,C.steel1);
 if(top>=end)return;
 r(x+3,top,6,end-top,mix(C.blue2,C.steel2,0.35));
 g.fillStyle=rgba(C.cyan4,0.18);
 for(let p=top+6;p<end;p+=22)g.fillRect(x+4,p,1,Math.min(9,end-p));
 g.fillStyle=rgba(C.white,0.12);g.fillRect(x+6,top,1,end-top);
 for(let p=top;p<end;p+=64){r(x+2,p,8,Math.min(3,end-p),C.steel3);if(p+2<end)r(x+2,p+2,8,1,C.steel1);}
}
/** Native cloud lower-deck rail, with a shallow foreground profile. */
export function glassRail(g:CanvasRenderingContext2D,x:number,y:number,w:number,h=14){
 g.fillStyle=C.steel1;g.fillRect(x,y,w,h);
 g.fillStyle=C.steel3;g.fillRect(x,y,w,2);
 g.fillStyle=rgba(C.cyan3,0.5);g.fillRect(x,y+h-2,w,1);
}
