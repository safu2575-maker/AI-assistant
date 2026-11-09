/** Export the presented data, including rows outside the virtual scrolling window. */
export const tableExports = new WeakMap<HTMLElement, {
    rows: (includeCollapsed?:boolean) => string[][];
    copy: (rows: string[][]) => Promise<boolean>;
}>();

/** Optional multi-table action; ordinary answer tables retain their direct copy action. */
export function installTableCopyMenu(card: HTMLElement, copyAll: () => Promise<boolean>, multiple: () => boolean): void {
    const anchor = card.querySelector<HTMLButtonElement>('[aria-label="Copy table data for Excel"]');
    if (!anchor) return;
    anchor.title = 'Copy this table, or all tables in the current trace view.';
    anchor.addEventListener('click', event => {
        if (!multiple()) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const panel = card.closest<HTMLElement>('[role="dialog"]') || card;
        panel.querySelector<HTMLButtonElement>('.askbics-table-copy-menu button')?.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
        const menu = document.createElement('div');
        menu.className = 'askbics-qna__column-filter-menu askbics-qna__period-menu askbics-table-copy-menu';
        menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Copy for Excel');
        anchor.setAttribute('aria-expanded', 'true'); anchor.setAttribute('aria-haspopup', 'menu');
        const controller = new AbortController();
        const observer = new MutationObserver(() => { if (!anchor.isConnected) close(false); });
        const close = (focus: boolean) => {
            menu.remove(); controller.abort(); observer.disconnect(); anchor.setAttribute('aria-expanded', 'false');
            if (focus && anchor.isConnected) anchor.focus({preventScroll:true});
        };
        const add = (label: string, run: () => Promise<boolean>) => {
            const button = document.createElement('button'); button.type='button'; button.textContent=label; button.setAttribute('role','menuitem');
            button.onclick=async () => {
                close(true);
                const ok=await run().catch(()=>false);
                anchor.textContent=ok?'Copied':'Copy failed';
                setTimeout(()=>{anchor.textContent='Copy for Excel';},1800);
            };
            menu.append(button);
        };
        add('Copy this table', async () => { const service=tableExports.get(card); return service?service.copy(service.rows()):false; });
        add('Copy all tables', copyAll);
        panel.append(menu);
        const position = () => { const rect=anchor.getBoundingClientRect(), bounds=panel.getBoundingClientRect();
        Object.assign(menu.style,{position:'fixed',zIndex:'100',left:`${Math.max(bounds.left+8,Math.min(rect.left,bounds.right-menu.offsetWidth-8))}px`,top:`${Math.max(bounds.top+8,Math.min(rect.bottom+4,bounds.bottom-menu.offsetHeight-8))}px`}); }; position();
        const buttons=Array.from(menu.querySelectorAll('button')); buttons[0].focus({preventScroll:true});
        menu.onkeydown=e=>{
            if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}
            else if(e.key==='Tab')close(false);
            else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
                e.preventDefault(); const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
                buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length].focus({preventScroll:true});
            }
        };
        document.addEventListener('pointerdown', e=>{if(!menu.contains(e.target as Node))close(false);},{capture:true,signal:controller.signal});
        panel.addEventListener('scroll',position,{capture:true,signal:controller.signal});
        window.addEventListener('resize',()=>close(false),{signal:controller.signal});
        observer.observe(document.body,{childList:true,subtree:true});
    }, true);
}

