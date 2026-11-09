/** Keep native text copying separate from table cross-filter clicks. */
export function enableTableTextSelection(table: HTMLTableElement): void {
    let start: { x: number; y: number } | undefined;
    table.addEventListener("pointerdown", event => {
        start = event.button === 0 ? { x: event.clientX, y: event.clientY } : undefined;
        // Do not let an enclosing dashboard drag handler consume text selection.
        event.stopPropagation();
    });
    table.addEventListener("mousedown", event => event.stopPropagation());
    table.addEventListener("click", event => {
        const selection = table.ownerDocument.getSelection();
        const dragged = start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4;
        start = undefined;
        if ((!dragged && event.detail < 2) || !selection || selection.isCollapsed || !selection.rangeCount) return;
        if (!selection.getRangeAt(0).intersectsNode(table)) return;
        // Preserve the range for Ctrl+C; do not invoke row/cell filters or links.
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);
}
