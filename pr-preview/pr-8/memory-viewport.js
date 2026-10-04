const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
export function memoryLayout(width,height=600){
 const columns=width<580?2:width<860?3:width<1160?4:5;
 const gap=clamp(width*.046,16,30),padding=clamp(width*.055,18,38);
 const card=(width-padding*2-gap*(columns-1))/columns;
 return {columns,gap,padding,card,row:card*1.35+gap,light:Math.min(width,height)*.17};
}

// The canvas owns gestures so a second finger cancels dragging/rotation before zooming.
export function createMemoryViewport({stage,surface,initial,onChange=()=>{},onSingle,onTap=()=>{},onHover=()=>{}}){
 let scale=initial?.scale||1,x=initial?.x||0,y=initial?.y||0;
 let gesture=null,pinch=null,blocked=false,suppressUntil=0,frame=0,destroyed=false;
 const pointers=new Map(),controller=new AbortController(),options={signal:controller.signal};
 const point=e=>{const r=stage.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
 const world=p=>({x:(p.x-x)/scale,y:(p.y-y)/scale});
 function paint(){
  const w=surface.offsetWidth*scale,h=surface.offsetHeight*scale;
  x=w<stage.clientWidth?(stage.clientWidth-w)/2:clamp(x,stage.clientWidth-w,0);
  y=h<stage.clientHeight?(stage.clientHeight-h)/2:clamp(y,stage.clientHeight-h,0);
  surface.style.transform=`translate3d(${x}px,${y}px,0) scale(${scale})`;
  stage.dataset.zoom=String(Math.round(scale*100));onChange({scale,x,y});
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;if(!destroyed)paint();});}
 function zoom(next,anchor={x:stage.clientWidth/2,y:stage.clientHeight/2}){
  const before=world(anchor);scale=clamp(next,.5,2.5);x=anchor.x-before.x*scale;y=anchor.y-before.y*scale;paint();
 }
 function stopSingle(cancel=true){if(gesture?.handler){if(cancel)gesture.handler.cancel?.();else gesture.handler.end?.(gesture.moved);}gesture=null;}
 stage.style.touchAction='none';stage.tabIndex=0;stage.setAttribute('aria-label','回忆画布，可双指缩放，拖动查看');
 stage.addEventListener('pointerdown',e=>{
  if(e.button!==0||e.target.closest('button,input,select,textarea,a,audio,video'))return;
  const p=point(e);pointers.set(e.pointerId,p);stage.setPointerCapture(e.pointerId);
  if(pointers.size===1&&!blocked)gesture={start:p,origin:{x,y},target:e.target,moved:false,handler:onSingle?.(e,world(p))};
  if(pointers.size>=2){
   stopSingle();blocked=true;const [a,b]=[...pointers.values()],center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
   pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),scale,anchor:world(center)};
   suppressUntil=performance.now()+450;e.preventDefault();
  }
 },options);
 stage.addEventListener('pointermove',e=>{
  onHover(point(e));if(!pointers.has(e.pointerId))return;
  const p=point(e);pointers.set(e.pointerId,p);
  if(pointers.size>=2&&pinch){
   const [a,b]=[...pointers.values()],center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
   scale=clamp(pinch.scale*Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance,.5,2.5);
   x=center.x-pinch.anchor.x*scale;y=center.y-pinch.anchor.y*scale;schedule();e.preventDefault();return;
  }
  if(blocked||!gesture)return;
  const dx=p.x-gesture.start.x,dy=p.y-gesture.start.y;
  if(Math.hypot(dx,dy)>5)gesture.moved=true;
  if(!gesture.moved)return;
  if(gesture.handler)gesture.handler.move?.(world(p),{x:dx/scale,y:dy/scale});
  else{x=gesture.origin.x+dx;y=gesture.origin.y+dy;schedule();}
  suppressUntil=performance.now()+450;e.preventDefault();
 },options);
 function end(e,cancelled=false){
  if(!pointers.has(e.pointerId))return;
  if(pointers.size===1&&!blocked&&gesture){
   const tap=!cancelled&&!gesture.moved,target=gesture.target;stopSingle(cancelled);
   if(tap){suppressUntil=performance.now()+450;onTap(target,e);}
  }else stopSingle();
  pointers.delete(e.pointerId);pinch=null;
  if(!pointers.size){blocked=false;paint();}
 }
 stage.addEventListener('pointerup',e=>end(e),options);
 stage.addEventListener('pointercancel',e=>end(e,true),options);
 stage.addEventListener('lostpointercapture',e=>end(e,true),options);
 stage.addEventListener('click',e=>{if(performance.now()<suppressUntil&&!e.target.closest('button,input')){e.preventDefault();e.stopImmediatePropagation();}}, {...options,capture:true});
 stage.addEventListener('wheel',e=>{
  if(e.target.closest('input,textarea,select,audio,video'))return;
  e.preventDefault();stopSingle();
  if(e.ctrlKey||e.metaKey)zoom(scale*Math.exp(-e.deltaY*.005),point(e));
  else{x-=e.deltaX;y-=e.deltaY;schedule();}
 },{...options,passive:false});
 stage.addEventListener('keydown',e=>{
  if(e.target!==stage)return;
  if(e.key==='+'||e.key==='='){e.preventDefault();zoom(scale*1.2);}
  if(e.key==='-'){e.preventDefault();zoom(scale/1.2);}
  if(e.key==='0'){e.preventDefault();scale=1;x=y=0;paint();}
 },options);
 const observer=new ResizeObserver(schedule);observer.observe(stage);observer.observe(surface);paint();
 return {get scale(){return scale;},world,zoom,reset(){scale=1;x=y=0;paint();},
  destroy(){destroyed=true;stopSingle();controller.abort();observer.disconnect();cancelAnimationFrame(frame);pointers.clear();}
 };
}
