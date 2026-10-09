/* Some touch browsers omit the compatibility click after a tap. Keep sidebar
 * activation on pointerup, while leaving mouse and keyboard clicks native. */
export function initSidebarControls(rail){
 const selector='button[data-scene-nav],button[data-theme-pick],#sceneSidebarToggle';
 const pointers=new Set();let pressed=null,handled=null;
 const buttonFor=target=>target instanceof Element?target.closest(selector):null;
 const blocked=()=>!!document.querySelector('.scrim:not([hidden]),dialog[open][aria-modal="true"]');
 function usable(button){return button&&rail.contains(button)&&!button.disabled&&!button.closest('[inert]')&&button.getClientRects().length&&!blocked();}
 function cancel(){if(pressed)handled={button:pressed.button,at:performance.now()};pressed=null;}
 document.addEventListener('pointerdown',event=>{
  if(rail.contains(event.target))rail.dataset.inputMode='pointer';
  if(!['touch','pen'].includes(event.pointerType)){handled=null;return;}
  pointers.add(event.pointerId);
  if(pointers.size!==1||!event.isPrimary){cancel();return;}
  handled=null;const button=buttonFor(event.target);
  pressed=usable(button)?{button,id:event.pointerId,x:event.clientX,y:event.clientY}:null;
 },{capture:true,passive:true});
 document.addEventListener('pointermove',event=>{
  if(pressed?.id===event.pointerId&&Math.hypot(event.clientX-pressed.x,event.clientY-pressed.y)>14)cancel();
 },{capture:true,passive:true});
 document.addEventListener('pointerup',event=>{
  pointers.delete(event.pointerId);
  const start=pressed;if(!start||start.id!==event.pointerId)return;
  cancel();
  // Only the button actually under the finger can activate. Never route through
  // a dialog/overlay, from a drag, or from a second finger on the memory canvas.
  if(pointers.size||!usable(start.button)||Math.hypot(event.clientX-start.x,event.clientY-start.y)>14||buttonFor(document.elementFromPoint(event.clientX,event.clientY))!==start.button)return;
  start.button.focus({preventScroll:true});
  start.button.click();
 },{capture:true,passive:true});
 document.addEventListener('pointercancel',event=>{pointers.delete(event.pointerId);if(pressed?.id===event.pointerId)cancel();},{capture:true,passive:true});
 rail.addEventListener('lostpointercapture',event=>{if(pressed?.id===event.pointerId)cancel();});
 rail.addEventListener('contextmenu',cancel);
 rail.addEventListener('scroll',cancel,{capture:true,passive:true});
 rail.addEventListener('click',event=>{
  // detail=0 is a keyboard/accessibility/programmatic click, including the
  // activation above. Suppress only the browser's follow-up pointer click.
  if(event.detail>0&&handled?.button===buttonFor(event.target)&&performance.now()-handled.at<800){event.preventDefault();event.stopImmediatePropagation();handled=null;}
 },true);
 document.addEventListener('keydown',event=>{
  if(!event.metaKey&&!event.ctrlKey&&!event.altKey&&event.key!=='Shift')rail.dataset.inputMode='keyboard';
 },true);
 window.addEventListener('blur',()=>{cancel();pointers.clear();});
}
