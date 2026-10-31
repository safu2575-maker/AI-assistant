/** Bound host-reported dimensions to the actual iframe/container, without scaling content. */
export function fitVisualViewport(element:HTMLElement) {
 let viewport:{width:number;height:number}|undefined;
 const win=element.ownerDocument.defaultView!;
 const fit=()=>{
  const box=element.getBoundingClientRect(),parent=element.parentElement;
  const axis=(requested:number|undefined,windowSize:number,offset:number,parentSize:number|undefined)=>{
   const limits=[Math.max(0,windowSize-Math.max(0,offset))];
   if(requested!==undefined&&Number.isFinite(requested)&&requested>=0)limits.push(requested);
   if(parentSize!==undefined&&parentSize>0)limits.push(parentSize);
   return Math.max(0,Math.min(...limits));
  };
  element.style.width=axis(viewport?.width,win.innerWidth,box.left,parent?.clientWidth)+'px';
  element.style.height=axis(viewport?.height,win.innerHeight,box.top,parent?.clientHeight)+'px';
 };
 const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(fit);
 if(element.parentElement)observer?.observe(element.parentElement);
 win.addEventListener('resize',fit);
 return {update:(next:{width:number;height:number})=>{viewport=next;fit();},destroy:()=>{observer?.disconnect();win.removeEventListener('resize',fit);}};
}
