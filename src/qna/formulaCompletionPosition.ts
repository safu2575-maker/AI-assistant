/** Position the lightweight completion list at the textarea caret, including wrapped lines. */
export function positionFormulaCompletion(editor: HTMLTextAreaElement, popup: HTMLElement, anchor: HTMLElement): void {
 const style=getComputedStyle(editor), mirror=document.createElement('div');
 for(const key of ['font','lineHeight','letterSpacing','padding','border','boxSizing','tabSize','wordSpacing'] as const) mirror.style[key]=style[key];
 Object.assign(mirror.style,{position:'fixed',visibility:'hidden',whiteSpace:'pre-wrap',overflowWrap:'break-word',width:editor.clientWidth+'px',border:'0'});
 mirror.textContent=editor.value.slice(0,editor.selectionStart);
 const marker=document.createElement('span');marker.textContent='\u200b';mirror.append(marker);anchor.append(mirror);
 const point=marker.getBoundingClientRect(),box=mirror.getBoundingClientRect(),input=editor.getBoundingClientRect(),parent=anchor.getBoundingClientRect();
 const line=parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.4;
 const x=input.left-parent.left+point.left-box.left-editor.scrollLeft;
 const y=input.top-parent.top+Math.max(0,Math.min(editor.clientHeight-line,point.top-box.top-editor.scrollTop))+line+4;
 mirror.remove();
 popup.style.left=Math.max(0,Math.min(x,anchor.clientWidth-popup.offsetWidth))+'px';
 popup.style.top=y+'px';
}
