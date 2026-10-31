/** One document listener; no retained references to detached settings editors. */
const installed=new WeakSet<Document>();
export function settingsPopup(host:HTMLElement,close:()=>void):void {
 host.addEventListener('askbics-close-popup',close);
 const doc=host.ownerDocument;
 const popup=host.querySelector<HTMLElement>('.askbics-settings-select__popup');
 const trigger=host.querySelector<HTMLElement>('.askbics-settings-select__trigger')||host.querySelector<HTMLElement>('input');
 if(popup&&trigger){
  const position=()=>{
   if(popup.hidden)return;
   const rect=trigger.getBoundingClientRect(),height=doc.documentElement.clientHeight,width=doc.documentElement.clientWidth;
   const below=height-rect.bottom-12,above=rect.top-12,up=below<260&&above>below;
   const minimumWidth=host.dataset.popupMinWidth?Number(host.dataset.popupMinWidth):240;
   const popupWidth=Math.min(Math.max(rect.width,minimumWidth),width-24);
   popup.style.position='fixed';popup.style.zIndex='10000';popup.style.margin='0';
   popup.style.width=popupWidth+'px';
   popup.style.left=Math.max(12,Math.min(rect.left,width-popupWidth-12))+'px';
   popup.style.maxHeight=Math.max(100,Math.min(340,up?above:below))+'px';
   popup.style.top=up?'auto':rect.bottom+4+'px';
   popup.style.bottom=up?height-rect.top+4+'px':'auto';
  };
  new MutationObserver(position).observe(popup,{attributes:true,attributeFilter:['hidden']});
  host.addEventListener('click',position);
  host.addEventListener('askbics-position-popup',position);
 }
 if(installed.has(doc))return;
 installed.add(doc);
 doc.addEventListener('scroll',()=>{doc.querySelectorAll<HTMLElement>('.askbics-settings-select').forEach(other=>other.dispatchEvent(new Event('askbics-position-popup')));},true);
 doc.defaultView?.addEventListener('resize',()=>doc.querySelectorAll<HTMLElement>('.askbics-settings-select').forEach(other=>other.dispatchEvent(new Event('askbics-close-popup'))));
 doc.addEventListener('pointerdown',event=>{
  doc.querySelectorAll<HTMLElement>('.askbics-settings-select').forEach(other=>{
   if(event.target instanceof Node&&!other.contains(event.target))other.dispatchEvent(new Event('askbics-close-popup'));
  });
 },true);
}
