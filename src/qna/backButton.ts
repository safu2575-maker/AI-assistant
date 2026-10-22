/** Shared back navigation: decorative outline icon and readable label. */
export function setBackButton(button: HTMLButtonElement, label: string): void {
    button.classList.add("askbics-back-button");
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M14 6l-6 6 6 6");
    icon.append(path);
    const text = document.createElement("span");
    text.textContent = label;
    button.replaceChildren(icon, text);
}
