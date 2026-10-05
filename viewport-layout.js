// Keep the focused field inside the usable viewport on both keyboard resize modes.
export function initViewportLayout(){
 const root=document.documentElement,viewport=window.visualViewport;
 let width=window.innerWidth,baseline=window.innerHeight,keyboard=false,frame=0;
 const editable=el=>el?.matches('textarea,[contenteditable="true"],input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=button]):not([type=submit]):not([type=hidden])')&&!el.disabled&&!el.readOnly;
 function reveal(){
  const field=document.activeElement;if(!editable(field)||!field.getClientRects().length)return;
  const margin=12;
  for(let parent=field.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
   if(!/(auto|scroll)/.test(getComputedStyle(parent).overflowY)||parent.scrollHeight<=parent.clientHeight)continue;
   const box=parent.getBoundingClientRect(),rect=field.getBoundingClientRect();
   const top=Math.max(box.top+parent.clientTop,viewport?.offsetTop||0)+margin;
   const bottom=Math.min(box.top+parent.clientTop+parent.clientHeight,(viewport?.offsetTop||0)+(viewport?.height||innerHeight))-margin;
   if(rect.bottom>bottom)parent.scrollTop+=Math.min(rect.bottom-bottom,rect.top-top);
   else if(rect.top<top)parent.scrollTop+=rect.top-top;
  }
 }
 function update(){
  frame=0;const height=viewport?.height||innerHeight,focused=editable(document.activeElement);
  if(Math.abs(width-innerWidth)>80){width=innerWidth;baseline=innerHeight;}
  if(!focused&&!keyboard||innerHeight>baseline)baseline=Math.max(height,innerHeight);
  const contracted=baseline-height>Math.max(100,baseline*.18);
  keyboard=(focused||keyboard)&&contracted&&Math.abs((viewport?.scale||1)-1)<.05;
  root.classList.toggle('keyboard-open',keyboard);
  root.style.setProperty('--usable-height',height+'px');
  root.style.setProperty('--viewport-top',(viewport?.offsetTop||0)+'px');
  if(keyboard)reveal();
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(update);}
 window.addEventListener('resize',schedule,{passive:true});
 viewport?.addEventListener('resize',schedule,{passive:true});
 viewport?.addEventListener('scroll',schedule,{passive:true});
 document.addEventListener('focusin',schedule);
 document.addEventListener('focusout',schedule);
 update();
}
