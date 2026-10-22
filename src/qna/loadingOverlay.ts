/** Shared answer-loading presentation; callers own cancellation and request lifetime. */
export function loadingOverlay(element: HTMLElement, message: string) {
    element.className = "askbics-analysis-loading";
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");
    element.setAttribute("aria-atomic", "true");
    element.hidden = false;
    const card = document.createElement("div"); card.className = "askbics-analysis-loading__card";
    const spinner = document.createElement("span"); spinner.className = "askbics-analysis-loading__spinner"; spinner.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div"); copy.className = "askbics-analysis-loading__copy";
    const title = document.createElement("span"); title.textContent = message;
    const stage = document.createElement("small"); stage.className = "askbics-analysis-loading__stage";
    copy.append(title, stage); card.append(spinner, copy); element.replaceChildren(card);
    return {card, title, stage};
}
