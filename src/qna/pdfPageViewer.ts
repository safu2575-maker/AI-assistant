/** Enlarged page viewer, confined to the custom visual's available area. */
export function openPdfPage(root: HTMLElement, source: HTMLImageElement): () => void {
    const overlay = document.createElement("div");
    overlay.className = "askbics-qna__pdf-enlarged";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", source.alt);
    const toolbar = document.createElement("div");
    const label = document.createElement("strong"); label.textContent = source.alt;
    const zoomLabel = document.createElement("span"); zoomLabel.setAttribute("aria-live", "polite");
    const viewport = document.createElement("div"); viewport.className = "askbics-qna__pdf-viewport";
    viewport.tabIndex = 0; viewport.setAttribute("aria-label", "PDF page. Scroll to zoom, drag to move, double-click to reset.");
    const page = document.createElement("img"); page.src = source.src; page.alt = source.alt; page.draggable = false;
    viewport.append(page);
    let scale = 1, x = 0, y = 0, baseWidth = 0, baseHeight = 0;
    const paint = () => {
        const limitX = Math.max(0, (baseWidth * scale - viewport.clientWidth) / 2);
        const limitY = Math.max(0, (baseHeight * scale - viewport.clientHeight) / 2);
        x = Math.max(-limitX, Math.min(limitX, x)); y = Math.max(-limitY, Math.min(limitY, y));
        page.style.width = `${baseWidth}px`; page.style.height = `${baseHeight}px`;
        page.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`;
        zoomLabel.textContent = `${Math.round(scale * 100)}%`;
    };
    const reset = () => {
        const ratio = (page.naturalWidth || 1120) / (page.naturalHeight || 792);
        baseWidth = Math.max(1, Math.min(viewport.clientWidth - 24, (viewport.clientHeight - 24) * ratio));
        baseHeight = baseWidth / ratio; scale = 1; x = 0; y = 0; paint();
    };
    const zoom = (factor: number, px = viewport.clientWidth / 2, py = viewport.clientHeight / 2) => {
        const next = Math.max(1, Math.min(6, scale * factor)), change = next / scale;
        x = (px - viewport.clientWidth / 2) * (1 - change) + x * change;
        y = (py - viewport.clientHeight / 2) * (1 - change) + y * change;
        scale = next; paint();
    };
    const observer = new ResizeObserver(reset);
    const dismiss = () => { observer.disconnect(); overlay.remove(); if (source.isConnected) source.focus(); };
    const button = (path: string, name: string, action: () => void) => {
        const el = document.createElement("button"); el.type = "button"; el.setAttribute("aria-label", name); el.title = name; el.onclick = action;
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("aria-hidden", "true");
        const shape = document.createElementNS("http://www.w3.org/2000/svg", "path"); shape.setAttribute("d", path); icon.append(shape); el.append(icon); return el;
    };
    toolbar.append(label, button("M5 12h14", "Zoom out", () => zoom(1 / 1.25)), zoomLabel, button("M5 12h14M12 5v14", "Zoom in", () => zoom(1.25)), button("M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5", "Show whole page", reset), button("M6 6l12 12M18 6 6 18", "Return to PDF preview", dismiss));
    const hint = document.createElement("p"); hint.textContent = "Scroll to zoom · Drag to move · Double-click to reset · Esc to return";
    overlay.append(toolbar, hint, viewport); root.append(overlay);
    viewport.addEventListener("wheel", event => {
        event.preventDefault(); event.stopPropagation(); const rect = viewport.getBoundingClientRect();
        zoom(Math.exp(-Math.sign(event.deltaY) * .15), event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    let drag: { id: number; x: number; y: number } | undefined;
    viewport.onpointerdown = event => { if (event.button !== 0) return; event.preventDefault(); drag = { id: event.pointerId, x: event.clientX, y: event.clientY }; viewport.setPointerCapture(event.pointerId); viewport.classList.add("is-dragging"); };
    viewport.onpointermove = event => { if (!drag || drag.id !== event.pointerId) return; x += event.clientX - drag.x; y += event.clientY - drag.y; drag.x = event.clientX; drag.y = event.clientY; paint(); };
    const stop = () => { drag = undefined; viewport.classList.remove("is-dragging"); };
    viewport.onpointerup = stop; viewport.onpointercancel = stop; viewport.onlostpointercapture = stop;
    viewport.ondblclick = reset;
    overlay.onkeydown = event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(); }
        else if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(1.25); }
        else if (event.key === "-") { event.preventDefault(); zoom(1 / 1.25); }
        else if (event.key === "0") { event.preventDefault(); reset(); }
        else if (event.key === "Tab") {
            const controls = [...Array.from(toolbar.querySelectorAll<HTMLButtonElement>("button")), viewport];
            const current = controls.indexOf(document.activeElement as HTMLButtonElement);
            event.preventDefault(); controls[(current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
        }
    };
    page.onload = reset; observer.observe(viewport); reset(); viewport.focus();
    return dismiss;
}
