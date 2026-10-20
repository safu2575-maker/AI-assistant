/** Editable value picker styled with the shared settings dropdown. */
export function settingsCombobox(input: HTMLInputElement) {
    const host = document.createElement('div'); host.className = 'askbics-settings-select askbics-settings-combobox';
    input.before(host); host.append(input); input.autocomplete = 'off'; input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'askbics-settings-combobox__toggle'; toggle.setAttribute('aria-label', 'Show revenue values'); const chevron = document.createElement('span'); chevron.className = 'askbics-settings-select__chevron'; chevron.setAttribute('aria-hidden', 'true'); toggle.append(chevron);
    const popup = document.createElement('div'); popup.className = 'askbics-settings-select__popup'; popup.hidden = true;
    const list = document.createElement('div'); list.className = 'askbics-settings-select__options'; list.id = 'askbics-revenue-value-options'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Revenue values'); input.setAttribute('aria-controls', list.id);
    popup.append(list); host.append(toggle, popup);
    let items: string[] = [], active = -1;
    const close = () => { popup.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
    const draw = (all = false) => {
        if (input.disabled) return;
        list.replaceChildren(); active = -1; input.removeAttribute('aria-activedescendant');
        const matches = items.filter(text => all || text.toLocaleLowerCase().includes(input.value.toLocaleLowerCase())).slice(0, 200);
        matches.forEach((text, index) => {
            const option = document.createElement('button'); option.type = 'button'; option.tabIndex = -1; option.id = `${list.id}-${index}`; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(text === input.value)); option.textContent = text;
            option.onpointerdown = event => event.preventDefault();
            option.onclick = () => { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); close(); input.focus(); close(); };
            list.append(option);
        });
        if (!matches.length) { const hint = document.createElement('p'); hint.textContent = 'No matching values. You can enter a value manually.'; hint.setAttribute('role', 'status'); list.append(hint); }
        popup.hidden = false; input.setAttribute('aria-expanded', 'true');
    };
    input.addEventListener('input', () => draw());
    input.addEventListener('click', () => draw());
    toggle.onpointerdown = event => event.preventDefault();
    toggle.onclick = () => { if (popup.hidden) { input.focus(); draw(true); } else close(); };
    host.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !popup.hidden) { event.preventDefault(); event.stopPropagation(); close(); return; }
        if (event.key === 'Tab') { close(); return; }
        if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault(); if (popup.hidden) draw(true);
            const options = Array.from(list.querySelectorAll<HTMLButtonElement>('button')); if (!options.length) return;
            active = Math.max(0, Math.min(options.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)));
            options.forEach((option, index) => option.classList.toggle('is-active', index === active)); input.setAttribute('aria-activedescendant', options[active].id); options[active].scrollIntoView({ block: 'nearest' });
        } else if (event.key === 'Enter' && !popup.hidden && active >= 0) { event.preventDefault(); list.querySelectorAll<HTMLButtonElement>('button')[active]?.click(); }
    });
    host.addEventListener('focusout', () => queueMicrotask(() => { if (!host.contains(document.activeElement)) close(); }));
    close();
    return { update: (values: string[]) => { items = [...new Set(values)]; toggle.disabled = input.disabled; if (input.disabled) close(); else if (!popup.hidden) draw(); } };
}
