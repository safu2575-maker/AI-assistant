import { settingsHelp, settingsOptionHelp } from "./settingsHelp";
/** Searchable picker backed by the settings form's existing select. */
export function settingsSelect(select: HTMLSelectElement, searchable = true): () => void {
    const host = document.createElement("div"); host.className = "askbics-settings-select";
    const trigger = document.createElement("button"); trigger.type = "button";
    trigger.className = "askbics-settings-select__trigger"; trigger.setAttribute("aria-haspopup", "listbox");
    const caption = document.createElement("span"), chevron = document.createElement("span");
    chevron.className = "askbics-settings-select__chevron"; chevron.setAttribute("aria-hidden", "true"); trigger.append(caption, chevron);
    const popup = document.createElement("div"); popup.className = "askbics-settings-select__popup"; popup.hidden = true;
    const search = document.createElement("input"); search.type = "search"; search.placeholder = "Search options…";
    search.setAttribute("aria-label", `Search ${select.getAttribute("aria-label") || "options"}`);
    const list = document.createElement("div"); list.className = "askbics-settings-select__options"; list.setAttribute("role", "listbox"); list.setAttribute("aria-label", select.getAttribute("aria-label") || "Options");
    if (searchable) popup.append(search); popup.append(list); host.append(trigger, popup); select.after(host); select.hidden = true;
    const close = () => { popup.hidden = true; trigger.setAttribute("aria-expanded", "false"); };
    const refresh = () => { trigger.disabled=select.disabled; const full=select.selectedOptions[0]?.textContent || "Select a field"; caption.textContent = full.split(" — ")[0]; const explanation=settingsHelp(select.getAttribute("aria-label") || ""); if(explanation) trigger.dataset.tooltip=explanation; else delete trigger.dataset.tooltip; trigger.removeAttribute("title"); trigger.setAttribute("aria-label", `${select.getAttribute("aria-label")}: ${full}`); close(); };
    const draw = () => {
        list.replaceChildren();
        Array.from(select.options).filter(option => (option.textContent || "").toLowerCase().includes(search.value.toLowerCase())).forEach(option => {
            const button = document.createElement("button"); button.type = "button"; button.setAttribute("role", "option");
            button.setAttribute("aria-selected", String(option.value === select.value)); button.textContent = (option.textContent || "").split(" — ")[0]; const explanation=settingsOptionHelp(option.textContent || ""); if(explanation)button.dataset.tooltip=explanation;
            // Do not let the search blur hide the option before its click arrives.
            button.addEventListener("pointerdown", event => { event.preventDefault(); event.stopPropagation(); });
            button.onclick = event => { event.preventDefault(); event.stopPropagation(); select.value = option.value; select.dispatchEvent(new Event("input", {bubbles:true})); select.dispatchEvent(new Event("change", {bubbles:true})); refresh(); trigger.focus(); };
            list.append(button);
        });
        if (!list.children.length) { const empty = document.createElement("p"); empty.textContent = "No matching fields"; empty.setAttribute("role", "status"); list.append(empty); }
    };
    // Keep search focus until click toggles the popup. Otherwise pointerdown can
    // blur it first, closing the popup before click and immediately reopening it.
    trigger.addEventListener("pointerdown", event => { event.preventDefault(); });
    trigger.onclick = event => { event.preventDefault(); event.stopPropagation(); if (select.disabled) return; if (!popup.hidden) { close(); trigger.focus(); return; } search.value = ""; draw(); popup.hidden = false; trigger.setAttribute("aria-expanded", "true"); if(searchable) search.focus(); else list.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus(); };
    search.oninput = draw;
    host.addEventListener("keydown", event => {
        if (popup.hidden && event.target === trigger && ["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault(); trigger.click(); return;
        }
        if (event.key === "Escape" && !popup.hidden) { event.stopPropagation(); event.preventDefault(); close(); trigger.focus(); }
        if (!popup.hidden && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            const items = Array.from(list.querySelectorAll<HTMLButtonElement>("button")); if (!items.length) return;
            event.preventDefault(); const current = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : current < 0 ? (event.key === "ArrowUp" ? items.length - 1 : 0) : Math.max(0, Math.min(items.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
            items[next].focus();
        }
    });
    host.addEventListener("focusout", event => {
        if (event.relatedTarget && host.contains(event.relatedTarget as Node)) return;
        queueMicrotask(() => { if (!host.contains(document.activeElement)) close(); });
    });
    refresh(); return refresh;
}
