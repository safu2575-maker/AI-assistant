/** Shared outline action icons. Labels remain available to keyboards and screen readers. */
export function settingsActionIcon(button:HTMLButtonElement,kind:'delete'|'edit'|'grip'|'back'|'settings'|'sliders'|'more'|'close'|'duplicate'|'rename',label:string):void {
 const paths={sliders:'M3 5h10M17 5h4M3 12h4M11 12h10M3 19h10M17 19h4M17 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0M11 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0M17 19a2 2 0 1 1-4 0 2 2 0 0 1 4 0',duplicate:'M9 9h11v12H9zM5 15H3V3h12v2',rename:'M3 7h7M3 12h5M3 17h7M16 4v16M13 4h6M13 20h6',close:'M6 6l12 12M18 6 6 18',back:'m14 6-6 6 6 6M8 12h12',more:'M12 5h.01M12 12h.01M12 19h.01',settings:'M9 3h6l.5 3 2 1 2.5-.5 2 5-2 1.5v2l2 1.5-2 4-2.5-.5-2 1-.5 2H9l-.5-2-2-1L4 20l-2-4L4 14v-2L2 10.5l2-4L6.5 7l2-1Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',delete:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',edit:'m15 4 5 5M4 20l4-1L20 7a2 2 0 0 0-4-4L4 15Z',grip:'M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01'};
 button.textContent='';button.classList.add('askbics-settings-action','askbics-settings-icon');
 button.setAttribute('aria-label',label);button.title=label;button.dataset.tooltip=label;
 const icon=document.createElement('span');icon.setAttribute('aria-hidden','true');
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width',kind==='grip'||kind==='more'?'3':'1.7');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
 const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',paths[kind]);svg.append(path);icon.append(svg);
 button.append(icon);if(kind==='delete')button.classList.add('is-delete');if(kind==='grip')button.classList.add('is-drag-handle');
}
export function decorateSettingsAction(button:HTMLButtonElement,text:string):void {
 if(text==='Edit')settingsActionIcon(button,'edit',text);
 else if(text==='Delete'||text==='Remove'||text==='Remove filter')settingsActionIcon(button,'delete',text);
}

/** Shared labelled action for dropdown menus; keep the accessible name explicit. */
export function settingsMenuAction(button:HTMLButtonElement,kind:Parameters<typeof settingsActionIcon>[1],label:string,accessibleLabel=label):void {
 settingsActionIcon(button,kind,accessibleLabel);
 button.classList.remove('askbics-settings-icon');button.classList.add('askbics-settings-menu-item');
 button.append(document.createTextNode(label));
}
