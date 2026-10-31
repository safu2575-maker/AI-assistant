/** Shared filter-with-remove icon for table and column controls. */
export function filterClearIcon(): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(ns, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('width', '16');
    icon.setAttribute('height', '16');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '1.8');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M13 13v6l-4 2v-8L3 5h18l-4 5 M17 14l5 5 M22 14l-5 5');
    icon.append(path);
    return icon;
}
