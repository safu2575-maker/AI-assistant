import { VisualAssistantEngine } from "./assistantEngine";
import { AssistantAction, AssistantAutocompleteItem, AssistantBenchmarkContext, AssistantClarification, AssistantDiagnosticsLogEntry, AssistantResponse, SelectedAssistantToken } from "./assistantTypes";
import { addMatrixField, addMatrixFilter, clearMatrixFilters, cloneMatrixQuery, matrixFilterToText, MatrixQuery, matrixQueryToQuestion, normalizeMatrixQuery, removeMatrixField as removeMatrixQueryField, swapMatrixAxes, withMatrixSort } from "./matrixQueryBuilder";

const AC_STOP_WORDS = new Set([
    "an", "and", "are", "as", "at", "be", "between", "by", "can",
    "compare", "comparison", "do", "does", "filter", "find", "for", "from", "get",
    "give", "has", "have", "how", "i", "if", "in", "is", "it", "its", "list",
    "many", "me", "no", "not", "number", "of", "on", "or", "please", "rank",
    "search", "see", "select", "show", "sort", "tell", "that", "the", "these",
    "those", "this", "to", "using", "versus", "vs", "what", "which",
    "with", "yes", "zoom", "focus"
]);

interface AssistantConversationTurn {
    userQuestion: string;
    engineQuestion: string;
    handled: boolean;
    subjectLabels: string[];
    metricLabels: string[];
    actionIndices: number[];
    hadTable: boolean;
    hadChart: boolean;
}

interface PendingCompareClarification extends AssistantClarification {
    originalQuestion: string;
    originalEngineQuestion: string;
}

type AssistantChartViewType = NonNullable<AssistantResponse["chart"]>["type"] | "table";
type AssistantEditableTableQuery = NonNullable<NonNullable<AssistantResponse["table"]>["editableQuery"]>;
type AssistantSavedReportTileSize = "small" | "medium" | "large";
type AssistantSavedReportTileHeight = "short" | "normal" | "tall";

interface AssistantInteractiveChartMetric {
    name: string;
    labels: string[];
    values: number[];
    valueLabels: string[];
}

interface AssistantInteractiveChartBundle {
    title: string;
    labels: string[];
    series: AssistantInteractiveChartMetric[];
}

interface AssistantPinnedMatrixReport {
    id: string;
    name: string;
    type?: "matrix" | "table" | "chart" | "compare" | "list" | "kpi";
    query: MatrixQuery;
    tableQuery?: AssistantEditableTableQuery;
    tableSnapshot?: {
        title?: string;
        columns: string[];
        rows: string[][];
    };
    chartSnapshot?: NonNullable<AssistantResponse["chart"]>;
    kpiSnapshot?: NonNullable<AssistantResponse["kpi"]>;
    layout?: {
        size?: AssistantSavedReportTileSize;
        height?: AssistantSavedReportTileHeight;
        w?: number;
        h?: number;
        x?: number;
        y?: number;
        pxW?: number;
        pxH?: number;
        headerColor?: string;
        columnWidths?: Record<string, number>;
    };
    createdAt: number;
    updatedAt?: number;
}

interface AssistantColumnFilterState {
    search: string;
    allowedValues?: string[];
}

interface AssistantSavedReportsPersistence {
    savedReportsJson?: string;
    onSavedReportsChanged?: (savedReportsJson: string) => void;
}

interface AssistantDataSelectionOptions {
    additive?: boolean;
}

export class VisualAssistantUi {
    private host: HTMLElement;
    private engine: VisualAssistantEngine;
    private root: HTMLDivElement;
    private panel: HTMLDivElement;
    private messages: HTMLDivElement;
    private input: HTMLInputElement;
    private onSelectIndices?: (indices: number[], options?: AssistantDataSelectionOptions) => void;
    private onBeforeOpen?: () => void;
    private lastSubjectLabel = "";
    private lastAnalyticQuestion = "";
    private conversationTurns: AssistantConversationTurn[] = [];
    private learnedAliases: Record<string, string> = {};
    private pendingCompareClarification: PendingCompareClarification | null = null;
    private activeOutputHost: HTMLElement | null = null;
    private editingTurnRoot: HTMLDivElement | null = null;
    private editingOutputHost: HTMLDivElement | null = null;
    private editingUserText: HTMLSpanElement | null = null;
    private chartMetricOptionsByKey: Record<string, string[]> = {};
    private paginationState: { question: string; limit: number; offset: number } | null = null;
    private lastResponseTable: { columns: string[]; rows: string[][] } | null = null;
    private lastRankTableForBenchmark: { columns: string[]; rows: string[][]; question: string } | null = null;
    private lastRankBenchmarkContext: AssistantBenchmarkContext | null = null;
    private streamSeq = 0;
    private open = false;
    private additiveSelectionPointerUntil = 0;
    private additiveSelectionModifierDown = false;
    private selectedTokens: SelectedAssistantToken[] = [];
    private turnSelectedTokens = new WeakMap<HTMLElement, SelectedAssistantToken[]>();
    private acItems: AssistantAutocompleteItem[] = [];
    private acIndex = -1;
    private acVisible = false;
    private acTokenRange: { start: number; end: number } | null = null;
    private placeholderPicker: {
        name: string;
        hint: "metric" | "entity" | "any" | "tenant" | "category" | "group" | "zone" | "floor" | "layer";
        allItems: AssistantAutocompleteItem[];
        page: number;
        pageSize: number;
        query: string;
        range: { start: number; end: number };
    } | null = null;
    private inputHighlight: HTMLDivElement | null = null;
    private acDropdown: HTMLDivElement | null = null;
    private acUpdateTimer: number | null = null;
    private acUpdateSeq = 0;
    private lastAcUpdateKey = "";
    private acGhostSuffix = "";
    private acScopedValuePickerActive = false;
    private acScopedValueNeedsCloseParen = false;
    private highlightFrame: number | null = null;
    private suppressFabClick = false;
    private readonly fabPositionStorageKey = "askbics.assistant.fabPosition.v1";
    private readonly pinnedMatrixStorageKey = "askbics.assistant.pinnedMatrixReports.v1";
    private pinnedMatrixReports: AssistantPinnedMatrixReport[] = [];
    private pinnedMatrixReportsJson = "";
    private onPinnedMatrixReportsChanged?: (savedReportsJson: string) => void;
    private savedReportsViewOpen = false;
    private savedReportsPreviousMessages: ChildNode[] | null = null;
    private savedReportToastTimer: number | null = null;
    private savedReportRenamingId: string | null = null;
    private savedReportDeleteConfirmId: string | null = null;
    private savedReportsLayoutEditing = false;
    private savedReportsLayoutDraft: AssistantPinnedMatrixReport[] | null = null;
    private savedReportsDraggingId: string | null = null;
    private savedReportColorPopover: HTMLDivElement | null = null;
    private savedReportsDetailId: string | null = null;
    private activeSavedReportRenderContext: { reportId: string; columnWidths: Record<string, number> } | null = null;
    private lastMatrixQuery: MatrixQuery | null = null;
    private lastMatrixTitle = "";
    private lastMatrixResponse: NonNullable<AssistantResponse["matrix"]> | null = null;
    private onDiagnosticsLog?: (entry: AssistantDiagnosticsLogEntry) => void;
    private lastLoggedAutocompletePerformanceKey = "";
    private rootFrameRaf: number | null = null;
    private rootResizeObserver: ResizeObserver | null = null;
    private tooltipEl: HTMLDivElement | null = null;
    private tooltipTarget: HTMLElement | null = null;
    private readonly onViewportFrameChange = (): void => this.scheduleRootFrameUpdate();

    constructor(host: HTMLElement, engine: VisualAssistantEngine, onSelectIndices?: (indices: number[], options?: AssistantDataSelectionOptions) => void, onBeforeOpen?: () => void, onDiagnosticsLog?: (entry: AssistantDiagnosticsLogEntry) => void, persistence?: AssistantSavedReportsPersistence) {
        this.host = host;
        this.engine = engine;
        this.onSelectIndices = onSelectIndices;
        this.onBeforeOpen = onBeforeOpen;
        this.onDiagnosticsLog = onDiagnosticsLog;
        this.onPinnedMatrixReportsChanged = persistence?.onSavedReportsChanged;
        this.pinnedMatrixReportsJson = persistence?.savedReportsJson || "";
        this.injectStyles(host.ownerDocument || document);
        this.root = this.createRoot();
        this.panel = this.root.querySelector(".ibx-assistant-panel") as HTMLDivElement;
        this.messages = this.root.querySelector(".ibx-assistant-messages") as HTMLDivElement;
        this.input = this.root.querySelector(".ibx-assistant-input") as HTMLInputElement;
        this.inputHighlight = this.root.querySelector(".ibx-assistant-input-highlight") as HTMLDivElement;
        this.acDropdown = this.root.querySelector(".ibx-assistant-ac") as HTMLDivElement;
        this.learnedAliases = this.loadLearnedAliases();
        this.pinnedMatrixReports = this.loadPinnedMatrixReports(this.pinnedMatrixReportsJson);
        if (!this.pinnedMatrixReportsJson && this.pinnedMatrixReports.length) {
            this.savePinnedMatrixReports();
        }
        (host.ownerDocument?.body || this.host).appendChild(this.root);
        this.installRootFrameTracking();
        this.installTooltips();
        this.bindAdditiveSelectionModifierTracking();
        this.bind();
    }

    updateEngine(engine: VisualAssistantEngine, onSelectIndices?: (indices: number[], options?: AssistantDataSelectionOptions) => void, onBeforeOpen?: () => void, onDiagnosticsLog?: (entry: AssistantDiagnosticsLogEntry) => void, persistence?: AssistantSavedReportsPersistence): void {
        this.engine = engine;
        if (onSelectIndices) this.onSelectIndices = onSelectIndices;
        if (onBeforeOpen) this.onBeforeOpen = onBeforeOpen;
        if (onDiagnosticsLog) this.onDiagnosticsLog = onDiagnosticsLog;
        if (persistence) {
            this.onPinnedMatrixReportsChanged = persistence.onSavedReportsChanged;
            const nextJson = persistence.savedReportsJson || "";
            if (nextJson !== this.pinnedMatrixReportsJson) {
                this.pinnedMatrixReportsJson = nextJson;
                this.pinnedMatrixReports = this.loadPinnedMatrixReports(nextJson);
                if (this.savedReportsDetailId) {
                    const detailReport = this.pinnedMatrixReports.find((item) => item.id === this.savedReportsDetailId);
                    if (detailReport && this.activeSavedReportRenderContext?.reportId === detailReport.id) {
                        this.activeSavedReportRenderContext.columnWidths = this.normalizeSavedReportColumnWidths(detailReport.layout?.columnWidths) || {};
                    }
                } else if (this.savedReportsViewOpen) {
                    this.showSavedReportsView();
                }
            }
        }
    }

    mountStandalone(): void {
        this.root.classList.add("askbics-standalone");
        this.setLauncherVisible(false);
        this.setOpen(true);
    }

    getSavedReportsJson(): string {
        return this.pinnedMatrixReportsJson || JSON.stringify(this.pinnedMatrixReports.slice(0, 12));
    }

    isOpen(): boolean {
        return this.open;
    }

    openSavedReports(): void {
        this.setOpen(true);
        this.showSavedReportsView();
    }

    setVisible(visible: boolean): void {
        this.root.style.display = visible ? "" : "none";
        if (!visible) this.setOpen(false);
    }

    setLauncherVisible(visible: boolean): void {
        const fab = this.root.querySelector(".ibx-assistant-fab") as HTMLButtonElement | null;
        if (!fab) return;
        fab.style.display = visible ? "" : "none";
        fab.setAttribute("aria-hidden", visible ? "false" : "true");
        fab.tabIndex = visible ? 0 : -1;
    }

    private createRoot(): HTMLDivElement {
        const doc = this.host.ownerDocument || document;
        const root = doc.createElement("div");
        root.className = "ibx-assistant allowInteractions";

        const fab = doc.createElement("button");
        fab.className = "ibx-assistant-fab";
        fab.type = "button";
        fab.setAttribute("data-ibx-tip", "askBICS Assistant. Drag to move.");
        fab.setAttribute("aria-label", "askBICS Assistant AI");
        fab.appendChild(this.createAiIcon(doc));

        const panel = doc.createElement("div");
        panel.className = "ibx-assistant-panel";
        panel.setAttribute("aria-hidden", "true");

        const head = doc.createElement("div");
        head.className = "ibx-assistant-head";
        const title = doc.createElement("div");
        title.className = "ibx-assistant-title";
        title.textContent = "askBICS Assistant";
        const headActions = doc.createElement("div");
        headActions.className = "ibx-assistant-head-actions";
        const reportsBtn = doc.createElement("button");
        reportsBtn.className = "ibx-assistant-reports";
        reportsBtn.type = "button";
        reportsBtn.setAttribute("aria-label", "Open Saved Reports");
        reportsBtn.setAttribute("data-ibx-tip", "Open Saved Reports");
        reportsBtn.appendChild(this.createPinIcon(doc));
        const reportsLabel = doc.createElement("span");
        reportsLabel.className = "ibx-assistant-reports-label";
        reportsLabel.textContent = "Saved reports";
        reportsBtn.appendChild(reportsLabel);
        const clearBtn = doc.createElement("button");
        clearBtn.className = "ibx-assistant-clear";
        clearBtn.type = "button";
        clearBtn.setAttribute("aria-label", "Clear chat");
        clearBtn.setAttribute("data-ibx-tip", "Clear chat");
        clearBtn.appendChild(this.createClearIcon(doc));
        const expandBtn = doc.createElement("button");
        expandBtn.className = "ibx-assistant-expand";
        expandBtn.type = "button";
        expandBtn.setAttribute("aria-label", "Open full screen");
        expandBtn.setAttribute("data-ibx-tip", "Open full screen");
        expandBtn.textContent = "⛶";
        const close = doc.createElement("button");
        close.className = "ibx-assistant-close";
        close.type = "button";
        close.setAttribute("aria-label", "Close askBICS Assistant");
        close.setAttribute("data-ibx-tip", "Close askBICS Assistant");
        close.appendChild(this.createCloseIcon(doc));
        headActions.appendChild(reportsBtn);
        headActions.appendChild(clearBtn);
        headActions.appendChild(expandBtn);
        headActions.appendChild(close);
        head.appendChild(title);
        head.appendChild(headActions);

        const messages = doc.createElement("div");
        messages.className = "ibx-assistant-messages";

        const form = doc.createElement("form");
        form.className = "ibx-assistant-form";
        const input = doc.createElement("input");
        input.className = "ibx-assistant-input";
        input.type = "text";
        input.autocomplete = "off";
        const inputSyntaxHint = "Ask a question about your data...";
        input.placeholder = inputSyntaxHint;
        input.title = "Use @ to find field values. Use Field(value) to search inside a specific field.";
        input.setAttribute("data-ibx-tip", input.title);
        const send = doc.createElement("button");
        send.className = "ibx-assistant-send";
        send.type = "submit";
        send.textContent = "Ask";
        const inputWrap = doc.createElement("div");
        inputWrap.className = "ibx-assistant-input-wrap";
        const inputHighlight = doc.createElement("div");
        inputHighlight.className = "ibx-assistant-input-highlight";
        inputWrap.appendChild(inputHighlight);
        inputWrap.appendChild(input);
        form.appendChild(inputWrap);
        form.appendChild(send);

        const formWrap = doc.createElement("div");
        formWrap.className = "ibx-assistant-form-wrap";
        const acDropdown = doc.createElement("div");
        acDropdown.className = "ibx-assistant-ac";
        acDropdown.hidden = true;
        acDropdown.setAttribute("role", "listbox");
        formWrap.appendChild(form);

        panel.appendChild(head);
        panel.appendChild(messages);
        panel.appendChild(formWrap);
        root.appendChild(fab);
        root.appendChild(panel);
        root.appendChild(acDropdown);
        return root;
    }

    private installRootFrameTracking(): void {
        this.updateRootFrame();
        const doc = this.host.ownerDocument || document;
        const win = doc.defaultView || window;
        win.addEventListener("resize", this.onViewportFrameChange, { passive: true });
        win.addEventListener("scroll", this.onViewportFrameChange, { passive: true, capture: true });
        if (typeof ResizeObserver !== "undefined") {
            this.rootResizeObserver = new ResizeObserver(() => this.scheduleRootFrameUpdate());
            this.rootResizeObserver.observe(this.host);
        }
        this.scheduleRootFrameUpdate();
    }

    private scheduleRootFrameUpdate(): void {
        if (this.rootFrameRaf !== null) return;
        const win = (this.host.ownerDocument || document).defaultView || window;
        this.rootFrameRaf = win.requestAnimationFrame(() => {
            this.rootFrameRaf = null;
            this.updateRootFrame();
            if (this.open) this.positionCompactPanel();
            if (this.acVisible) this.positionAutocompleteDropdown();
        });
    }

    private snapCssPixel(value: number): number {
        // Keep the body-level overlay aligned to physical pixels. Power BI's
        // normal canvas often lands the visual frame on fractional CSS pixels,
        // which makes compact chat text look soft while fullscreen stays crisp.
        const win = (this.host.ownerDocument || document).defaultView || window;
        const dpr = Math.max(1, Number(win.devicePixelRatio) || 1);
        return Math.round(value * dpr) / dpr;
    }

    private updateRootFrame(): void {
        const rect = this.host.getBoundingClientRect();
        const left = this.snapCssPixel(rect.left);
        const top = this.snapCssPixel(rect.top);
        const width = Math.max(0, this.snapCssPixel(rect.width));
        const height = Math.max(0, this.snapCssPixel(rect.height));
        this.root.style.left = `${left}px`;
        this.root.style.top = `${top}px`;
        this.root.style.width = `${width}px`;
        this.root.style.height = `${height}px`;
    }

    private positionCompactPanel(): void {
        if (!this.panel || this.root.classList.contains("ibx-assistant--fullscreen")) return;
        const rootRect = this.root.getBoundingClientRect();
        const rootW = Math.max(0, this.snapCssPixel(rootRect.width));
        const rootH = Math.max(0, this.snapCssPixel(rootRect.height));
        const marginX = 18;
        const top = 58;
        const bottom = 14;
        const panelW = Math.max(280, Math.min(448, rootW - marginX * 2));
        const panelH = Math.max(260, rootH - top - bottom);
        const left = Math.max(marginX, rootW - panelW - marginX);
        this.panel.style.left = `${this.snapCssPixel(left)}px`;
        this.panel.style.right = "auto";
        this.panel.style.top = `${this.snapCssPixel(top)}px`;
        this.panel.style.bottom = "auto";
        this.panel.style.width = `${this.snapCssPixel(panelW)}px`;
        this.panel.style.height = `${this.snapCssPixel(panelH)}px`;
    }

    private clearCompactPanelPosition(): void {
        this.panel.style.left = "";
        this.panel.style.right = "";
        this.panel.style.top = "";
        this.panel.style.bottom = "";
        this.panel.style.width = "";
        this.panel.style.height = "";
    }

    private bindFabDrag(fab: HTMLButtonElement): void {
        let startClientX = 0;
        let startClientY = 0;
        let offsetX = 0;
        let offsetY = 0;
        let dragging = false;
        let activePointerId: number | null = null;

        const onPointerMove = (ev: PointerEvent): void => {
            if (activePointerId !== ev.pointerId) return;
            const moved = Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY);
            if (!dragging && moved < 4) return;
            dragging = true;
            this.positionFabAt(fab, ev.clientX - offsetX, ev.clientY - offsetY);
            ev.preventDefault();
        };

        const onPointerUp = (ev: PointerEvent): void => {
            if (activePointerId !== ev.pointerId) return;
            fab.releasePointerCapture?.(ev.pointerId);
            fab.removeEventListener("pointermove", onPointerMove);
            fab.removeEventListener("pointerup", onPointerUp);
            fab.removeEventListener("pointercancel", onPointerUp);
            activePointerId = null;
            if (dragging) {
                this.suppressFabClick = true;
                this.saveFabPosition(fab);
                setTimeout(() => {
                    this.suppressFabClick = false;
                }, 0);
            }
            dragging = false;
        };

        fab.addEventListener("pointerdown", (ev) => {
            if (ev.button !== 0 || this.open) return;
            const rect = fab.getBoundingClientRect();
            startClientX = ev.clientX;
            startClientY = ev.clientY;
            offsetX = ev.clientX - rect.left;
            offsetY = ev.clientY - rect.top;
            activePointerId = ev.pointerId;
            fab.setPointerCapture?.(ev.pointerId);
            fab.addEventListener("pointermove", onPointerMove);
            fab.addEventListener("pointerup", onPointerUp);
            fab.addEventListener("pointercancel", onPointerUp);
        });
    }

    private positionFabAt(fab: HTMLButtonElement, viewportLeft: number, viewportTop: number): void {
        this.updateRootFrame();
        const rootRect = this.root.getBoundingClientRect();
        const hostRect = this.host.getBoundingClientRect();
        const fabRect = fab.getBoundingClientRect();
        const margin = 8;
        const left = Math.max(hostRect.left + margin, Math.min(viewportLeft, hostRect.right - fabRect.width - margin));
        const top = Math.max(hostRect.top + margin, Math.min(viewportTop, hostRect.bottom - fabRect.height - margin));
        fab.style.left = `${this.snapCssPixel(left - rootRect.left)}px`;
        fab.style.top = `${this.snapCssPixel(top - rootRect.top)}px`;
        fab.style.right = "auto";
        fab.style.bottom = "auto";
        fab.style.transform = "none";
    }

    private restoreFabPosition(fab: HTMLButtonElement): void {
        let raw = "";
        try {
            raw = window.localStorage.getItem(this.fabPositionStorageKey) || "";
        } catch {
            return;
        }
        if (!raw) return;
        try {
            const saved = JSON.parse(raw) as { left?: number; top?: number };
            if (typeof saved.left !== "number" || typeof saved.top !== "number") return;
            requestAnimationFrame(() => this.positionFabAt(fab, saved.left, saved.top));
        } catch {
            // Ignore stale saved positions.
        }
    }

    private saveFabPosition(fab: HTMLButtonElement): void {
        const rect = fab.getBoundingClientRect();
        try {
            window.localStorage.setItem(this.fabPositionStorageKey, JSON.stringify({ left: rect.left, top: rect.top }));
        } catch {
            // Storage may be unavailable in some embedded hosts.
        }
    }

    private createClearIcon(doc: Document): SVGSVGElement {
        const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        svg.classList.add("ibx-assistant-header-icon");
        const makePath = (d: string, strokeWidth: string = "2.1"): SVGPathElement => {
            const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", d);
            path.setAttribute("fill", "none");
            path.setAttribute("stroke", "currentColor");
            path.setAttribute("stroke-width", strokeWidth);
            path.setAttribute("stroke-linecap", "round");
            path.setAttribute("stroke-linejoin", "round");
            return path;
        };
        svg.appendChild(makePath("M4.5 7h15"));
        svg.appendChild(makePath("M9.5 7V5.3c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3V7"));
        svg.appendChild(makePath("M7 7.8 8 19.1c.1.9.8 1.6 1.7 1.6h4.6c.9 0 1.6-.7 1.7-1.6l1-11.3"));
        svg.appendChild(makePath("M10.2 11v5.8", "1.7"));
        svg.appendChild(makePath("M13.8 11v5.8", "1.7"));
        return svg;
    }

    private createCloseIcon(doc: Document): SVGSVGElement {
        const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 20 20");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        svg.classList.add("ibx-assistant-close-icon");
        ["M5 5l10 10", "M15 5 5 15"].forEach((d) => { const path = doc.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", d); path.setAttribute("fill", "none"); path.setAttribute("stroke", "currentColor"); path.setAttribute("stroke-width", "1.7"); path.setAttribute("stroke-linecap", "round"); svg.appendChild(path); });
        return svg;
    }

    private createSavedReportsIcon(doc: Document): SVGSVGElement {
        const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        svg.classList.add("ibx-assistant-header-icon");
        const makePath = (d: string, strokeWidth: string = "2"): SVGPathElement => {
            const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", d);
            path.setAttribute("fill", "none");
            path.setAttribute("stroke", "currentColor");
            path.setAttribute("stroke-width", strokeWidth);
            path.setAttribute("stroke-linecap", "round");
            path.setAttribute("stroke-linejoin", "round");
            return path;
        };
        svg.appendChild(makePath("M5 5.8c0-.9.7-1.6 1.6-1.6h10.8c.9 0 1.6.7 1.6 1.6v12.4c0 .9-.7 1.6-1.6 1.6H6.6c-.9 0-1.6-.7-1.6-1.6V5.8Z"));
        svg.appendChild(makePath("M8.2 8.3h7.6", "1.8"));
        svg.appendChild(makePath("M8.2 12h7.6", "1.8"));
        svg.appendChild(makePath("M8.2 15.7h4.8", "1.8"));
        return svg;
    }

    private createPinIcon(doc: Document): SVGSVGElement {
        const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        svg.classList.add("ibx-assistant-header-icon");
        const makePath = (d: string, strokeWidth: string = "2"): SVGPathElement => {
            const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", d);
            path.setAttribute("fill", "none");
            path.setAttribute("stroke", "currentColor");
            path.setAttribute("stroke-width", strokeWidth);
            path.setAttribute("stroke-linecap", "round");
            path.setAttribute("stroke-linejoin", "round");
            return path;
        };
        svg.appendChild(makePath("M7.25 4.75c0-.97.78-1.75 1.75-1.75h6c.97 0 1.75.78 1.75 1.75v15.5L12 17.15l-4.75 3.1V4.75Z", "1.9"));
        return svg;
    }

    private createPinReportButton(doc: Document, tip: string, handler: () => void): HTMLButtonElement {
        const btn = doc.createElement("button");
        btn.type = "button";
        btn.className = "ibx-assistant-matrix-control ibx-assistant-pin-report-btn";
        btn.setAttribute("aria-label", tip);
        btn.setAttribute("data-ibx-tip", tip);
        const icon = this.createPinIcon(doc);
        icon.classList.add("ibx-assistant-pin-report-icon");
        btn.appendChild(icon);
        btn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            this.closeOpenResultEditors();
            handler();
        });
        return btn;
    }

    private createFilterIcon(doc: Document): SVGSVGElement {
        const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 16 16");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        svg.classList.add("ibx-assistant-filter-icon");
        const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "M2.5 3.5h11L9.25 8.2v3.55l-2.5 1.2V8.2L2.5 3.5Z");
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "currentColor");
        path.setAttribute("stroke-width", "1.45");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        svg.appendChild(path);
        return svg;
    }

    private createMeasureBarsIcon(doc: Document): SVGSVGElement {
        const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 16 16");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        svg.classList.add("ibx-assistant-measure-bars-icon");
        [
            { x: "3", y: "10.5", w: "2", h: "2.5" },
            { x: "7", y: "6.5", w: "2", h: "6.5" },
            { x: "11", y: "3", w: "2", h: "10" }
        ].forEach((bar) => {
            const rect = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
            rect.setAttribute("x", bar.x);
            rect.setAttribute("y", bar.y);
            rect.setAttribute("width", bar.w);
            rect.setAttribute("height", bar.h);
            rect.setAttribute("rx", "0.8");
            rect.setAttribute("fill", "currentColor");
            svg.appendChild(rect);
        });
        return svg;
    }

    private createInsightIcon(doc: Document): SVGSVGElement {
        const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 16 16");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        svg.classList.add("ibx-assistant-insight-icon");
        const bubble = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        bubble.setAttribute("d", "M3 3.8C3 2.8 3.8 2 4.8 2h6.4c1 0 1.8.8 1.8 1.8v4.8c0 1-.8 1.8-1.8 1.8H7.1l-3 2.5v-2.7C3.4 9.9 3 9.3 3 8.6V3.8Z");
        bubble.setAttribute("fill", "none");
        bubble.setAttribute("stroke", "currentColor");
        bubble.setAttribute("stroke-width", "1.5");
        bubble.setAttribute("stroke-linejoin", "round");
        svg.appendChild(bubble);
        const spark = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        spark.setAttribute("d", "M5.4 6.2h5.2M5.4 8.1h3.8");
        spark.setAttribute("fill", "none");
        spark.setAttribute("stroke", "currentColor");
        spark.setAttribute("stroke-width", "1.5");
        spark.setAttribute("stroke-linecap", "round");
        svg.appendChild(spark);
        return svg;
    }

    private closeOpenResultEditors(): void {
        this.root.querySelectorAll<HTMLElement>(".ibx-assistant-matrix-options").forEach((panel) => {
            panel.style.display = "none";
        });
        this.root.querySelectorAll<HTMLElement>(".ibx-assistant-matrix-control--active, .ibx-assistant-matrix-control.is-active").forEach((button) => {
            button.classList.remove("ibx-assistant-matrix-control--active", "is-active");
        });
    }

    private isResultEditorClickTarget(target: EventTarget | null): boolean {
        if (!(target instanceof Node)) return false;
        const element = target instanceof Element ? target : target.parentElement;
        if (!element) return false;
        if (element.closest(".ibx-assistant-matrix-options, .ibx-assistant-matrix-control")) return true;
        const wrap = element.closest(".ibx-assistant-table-wrap");
        if (!wrap) return false;
        return Array.from(wrap.querySelectorAll<HTMLElement>(".ibx-assistant-matrix-options"))
            .some((panel) => panel.style.display !== "none");
    }

    private bind(): void {
        const fab = this.root.querySelector(".ibx-assistant-fab") as HTMLButtonElement;
        const close = this.root.querySelector(".ibx-assistant-close") as HTMLButtonElement;
        const reportsBtn = this.root.querySelector(".ibx-assistant-reports") as HTMLButtonElement;
        const clearBtn = this.root.querySelector(".ibx-assistant-clear") as HTMLButtonElement;
        const expandBtn = this.root.querySelector(".ibx-assistant-expand") as HTMLButtonElement;
        const form = this.root.querySelector(".ibx-assistant-form") as HTMLFormElement;
        const send = this.root.querySelector(".ibx-assistant-send") as HTMLButtonElement;
        this.root.addEventListener("mousedown", (ev) => ev.stopPropagation());
        this.root.addEventListener("click", (ev) => ev.stopPropagation());
        this.root.addEventListener("pointerdown", (ev) => {
            if (!this.isResultEditorClickTarget(ev.target)) this.closeOpenResultEditors();
        }, true);
        this.restoreFabPosition(fab);
        this.bindFabDrag(fab);
        fab.addEventListener("click", (ev) => {
            ev.preventDefault();
            if (this.suppressFabClick) {
                this.suppressFabClick = false;
                return;
            }
            this.setOpen(!this.open);
        });
        close.addEventListener("click", (ev) => {
            ev.preventDefault();
            this.toggleFullscreenChat(false);
            this.setOpen(false);
        });
        clearBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            this.clearConversation();
        });
        reportsBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            this.showSavedReportsView();
        });
        expandBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            this.toggleFullscreenChat();
        });
        form.addEventListener("submit", (ev) => {
            ev.preventDefault();
            this.submitQuestion();
        });
        send.addEventListener("click", (ev) => {
            ev.preventDefault();
            this.submitQuestion();
        });
        this.input.addEventListener("keydown", (ev) => {
            if (this.acVisible) {
                if (this.placeholderPicker && this.handlePlaceholderPickerKey(ev)) return;
                if (ev.key === "Tab" && this.acItems.length) {
                    ev.preventDefault();
                    const item = this.acItems[Math.max(0, this.acIndex)];
                    if (item) this.selectAutocompleteItem(item);
                    return;
                }
                if (ev.key === "ArrowDown") {
                    ev.preventDefault();
                    this.acIndex = this.acItems.length ? Math.min(Math.max(this.acIndex, 0) + 1, this.acItems.length - 1) : -1;
                    this.renderAutocomplete();
                    return;
                }
                if (ev.key === "ArrowUp") {
                    ev.preventDefault();
                    this.acIndex = this.acItems.length ? Math.max((this.acIndex < 0 ? this.acItems.length : this.acIndex) - 1, 0) : -1;
                    this.renderAutocomplete();
                    return;
                }
                if (ev.key === "Enter" && this.acItems.length) {
                    ev.preventDefault();
                    const item = this.acItems[Math.max(0, this.acIndex)];
                    if (item) this.selectAutocompleteItem(item);
                    return;
                }
                if (ev.key === "Escape") {
                    ev.preventDefault();
                    this.hideAutocomplete();
                    return;
                }
            }
            if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
                ev.preventDefault();
                this.openAutocompleteFromKeyboard(ev.key === "ArrowUp" ? "up" : "down");
                return;
            }
            if (ev.key === "Enter") {
                ev.preventDefault();
                this.submitQuestion();
            }
        });
        this.input.addEventListener("input", () => {
            this.syncSelectedTokensToInput();
            this.syncInputViewportToCaret();
            this.scheduleInputHighlights();
            this.scheduleAutocompleteUpdate();
        });
        this.input.addEventListener("click", () => {
            this.syncInputViewportToCaret();
            this.scheduleInputHighlights();
            this.scheduleAutocompleteUpdate(0);
        });
        this.input.addEventListener("keyup", () => {
            this.syncInputViewportToCaret();
            this.syncInputHighlightScroll();
        });
        this.input.addEventListener("focus", () => this.scheduleInputHighlights());
        this.input.addEventListener("blur", () => window.setTimeout(() => {
            this.renderInputHighlights();
            const active = this.host.ownerDocument.activeElement as Node | null;
            if (active !== this.input && !this.acDropdown?.contains(active)) this.hideAutocomplete();
        }, 0));
        this.input.addEventListener("scroll", () => this.syncInputHighlightScroll());
        const doc = this.host.ownerDocument || document;
        doc.addEventListener("pointerdown", (ev) => {
            const target = ev.target;
            if (target instanceof Node && !this.root.contains(target)) this.closeOpenResultEditors();
        }, true);
        this.messages.addEventListener("mousedown", () => this.hideAutocomplete());
        this.panel.addEventListener("mousedown", (ev) => {
            const target = ev.target as Node;
            if (target === this.input || this.acDropdown?.contains(target)) return;
            this.hideAutocomplete();
        });
        doc.addEventListener("click", (ev) => {
            if (!this.root.contains(ev.target as Node)) this.hideAutocomplete();
        });
    }

    private installTooltips(): void {
        this.root.addEventListener("pointerover", (ev) => this.handleTooltipPointerOver(ev));
        this.root.addEventListener("pointerout", (ev) => this.handleTooltipPointerOut(ev));
        this.root.addEventListener("focusin", (ev) => this.handleTooltipFocusIn(ev));
        this.root.addEventListener("focusout", () => this.hideAssistantTooltip());
        this.root.addEventListener("click", () => this.hideAssistantTooltip());
        this.root.addEventListener("scroll", () => this.hideAssistantTooltip(), true);
        this.root.ownerDocument.defaultView?.addEventListener("resize", () => this.hideAssistantTooltip());
    }

    private tooltipElement(doc: Document): HTMLDivElement {
        if (this.tooltipEl && this.tooltipEl.ownerDocument === doc) return this.tooltipEl;
        const el = doc.createElement("div");
        el.className = "ibx-assistant-tooltip";
        el.setAttribute("role", "tooltip");
        (doc.body || this.root).appendChild(el);
        this.tooltipEl = el;
        return el;
    }

    private findTooltipTarget(target: EventTarget | null): HTMLElement | null {
        if (!target || !(target as Node).nodeType) return null;
        const element = target instanceof Element ? target : (target as Node).parentElement;
        if (!element) return null;
        const tipTarget = element.closest("[data-ibx-tip], button, [role='button']") as HTMLElement | null;
        if (!tipTarget || !this.root.contains(tipTarget)) return null;
        const tip = this.tooltipTextFor(tipTarget);
        return tip ? tipTarget : null;
    }

    private tooltipTextFor(target: HTMLElement): string {
        const explicit = String(target.getAttribute("data-ibx-tip") || target.getAttribute("aria-label") || "").trim();
        if (explicit) return explicit;
        const label = String(target.textContent || "").replace(/\s+/g, " ").trim();
        if (!label) return "";
        if (/^Ask$/i.test(label)) return "Ask question";
        if (/^Apply$/i.test(label)) return "Apply changes";
        if (/^Cancel$/i.test(label)) return "Cancel changes";
        if (/^Pin report$/i.test(label)) return "Save to Saved Reports";
        if (/^Saved reports$/i.test(label)) return "Open Saved Reports";
        if (/^Clear filters$/i.test(label)) return "Remove all filters";
        if (/^Show more$/i.test(label)) return "Show more results";
        return "";
    }

    private showAssistantTooltip(target: HTMLElement): void {
        const text = this.tooltipTextFor(target);
        if (!text) return;
        if (target.hasAttribute("title")) target.removeAttribute("title");
        const doc = this.root.ownerDocument || document;
        const win = doc.defaultView || window;
        const tooltip = this.tooltipElement(doc);
        tooltip.textContent = text;
        tooltip.classList.add("ibx-assistant-tooltip--visible");
        tooltip.style.left = "0px";
        tooltip.style.top = "0px";

        const targetRect = target.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const margin = 8;
        let left = targetRect.left + targetRect.width / 2;
        left = Math.max(margin + tooltipRect.width / 2, Math.min(win.innerWidth - margin - tooltipRect.width / 2, left));
        let top = targetRect.top - tooltipRect.height - 8;
        if (top < margin) top = targetRect.bottom + 8;
        tooltip.style.left = `${Math.round(left)}px`;
        tooltip.style.top = `${Math.round(top)}px`;
        this.tooltipTarget = target;
    }

    private hideAssistantTooltip(): void {
        this.tooltipTarget = null;
        this.tooltipEl?.classList.remove("ibx-assistant-tooltip--visible");
    }

    private handleTooltipPointerOver(ev: PointerEvent): void {
        const target = this.findTooltipTarget(ev.target);
        if (target && target !== this.tooltipTarget) this.showAssistantTooltip(target);
    }

    private handleTooltipPointerOut(ev: PointerEvent): void {
        if (!this.tooltipTarget) return;
        const related = ev.relatedTarget as Node | null;
        if (related && this.tooltipTarget.contains(related)) return;
        const from = ev.target as Node | null;
        if (from && this.tooltipTarget.contains(from)) this.hideAssistantTooltip();
    }

    private handleTooltipFocusIn(ev: FocusEvent): void {
        const target = this.findTooltipTarget(ev.target);
        if (target) this.showAssistantTooltip(target);
    }

    private submitQuestion(): void {
        this.closeOpenResultEditors();
        if (this.focusNextPlaceholderAndOpen()) return;
        const text = this.stripTemplatePlaceholders(String(this.input.value || "")).trim();
        const clickedTokens = this.getActiveSelectedTokens(text);
        const tokensBase = clickedTokens.length
            ? this.mergeSelectedTokens(clickedTokens)
            : this.findMentionTokensForText(text);
        const tokens = this.expandBookmarkMeasureTokens(tokensBase);
        if (!text) return;
        const localMatrixResponse = this.buildLocalMatrixCommandResponse(text);
        if (localMatrixResponse !== undefined) {
            this.hideAutocomplete();
            this.pendingCompareClarification = null;
            this.input.value = "";
            this.selectedTokens = [];
            this.renderInputHighlights();
            if (localMatrixResponse) {
                const turn = this.prepareTurnForQuestion(text, tokens);
                this.activeOutputHost = turn.output;
                const thinkingMessage = this.appendMessage("", "assistant");
                this.showTypingIndicator(thinkingMessage);
                window.setTimeout(() => {
                    this.renderEngineResponse(text, text, localMatrixResponse, thinkingMessage, turn.output);
                    this.activeOutputHost = null;
                }, 0);
            }
            return;
        }
        const matrixFollowup = this.resolveMatrixFollowupQuestion(text);
        if (matrixFollowup !== null) {
            if (matrixFollowup) {
                this.input.value = matrixFollowup;
                this.selectedTokens = [];
                this.renderInputHighlights();
                this.submitQuestion();
            }
            return;
        }
        this.hideAutocomplete();
        this.pendingCompareClarification = null;
        this.input.value = "";
        this.selectedTokens = [];
        this.renderInputHighlights();
        const displayQuestion = text;
        const turn = this.prepareTurnForQuestion(displayQuestion, tokens);
        this.activeOutputHost = turn.output;
        const thinkingMessage = this.appendMessage("", "assistant");
        this.showTypingIndicator(thinkingMessage);
        window.setTimeout(async () => {
            try {
                const rawQ = text;
                const engineQuestion = tokens.length ? rawQ : this.buildEngineQuestion(rawQ);
                const directBenchmarkResponse = this.buildDirectBenchmarkFollowupResponse(rawQ);
                const response = directBenchmarkResponse || (tokens.length
                    ? this.engine.answerWithTokens(engineQuestion, tokens)
                    : await this.engine.answerAsync(engineQuestion));
                this.recordDiagnostics(displayQuestion, engineQuestion, tokens, response);
                this.renderEngineResponse(displayQuestion, engineQuestion, response, thinkingMessage, turn.output);
            } catch (err: any) {
                const msg = String(err?.message || err || "I could not answer that question.");
                this.recordDiagnostics(displayQuestion, tokens.length ? text : this.buildEngineQuestion(text), tokens, null, msg);
                thinkingMessage.classList.remove("ibx-assistant-msg--typing");
                thinkingMessage.textContent = `I could not answer that question. ${msg}`;
            }
            this.activeOutputHost = null;
        }, 0);
    }

    private submitGeneratedQuestion(question: string): void {
        const text = String(question || "").trim();
        if (!text) return;
        this.input.value = text;
        this.selectedTokens = [];
        this.renderInputHighlights();
        this.submitQuestion();
    }

    private submitForcedLayoutQuestion(displayQuestion: string, engineQuestion: string, tokens: SelectedAssistantToken[]): void {
        const cleanDisplay = String(displayQuestion || "").trim();
        const cleanEngine = String(engineQuestion || cleanDisplay).trim();
        if (!cleanDisplay || !cleanEngine || !tokens.length) return;
        this.hideAutocomplete();
        this.pendingCompareClarification = null;
        const turn = this.prepareTurnForQuestion(cleanDisplay, tokens);
        this.activeOutputHost = turn.output;
        const thinkingMessage = this.appendMessage("", "assistant");
        this.showTypingIndicator(thinkingMessage);
        window.setTimeout(() => {
            try {
                const response = this.engine.answerWithTokens(cleanEngine, tokens);
                this.recordDiagnostics(cleanDisplay, cleanEngine, tokens, response);
                this.renderEngineResponse(cleanDisplay, cleanEngine, response, thinkingMessage, turn.output);
            } catch (err: any) {
                const msg = String(err?.message || err || "I could not answer that question.");
                this.recordDiagnostics(cleanDisplay, cleanEngine, tokens, null, msg);
                thinkingMessage.classList.remove("ibx-assistant-msg--typing");
                thinkingMessage.textContent = `I could not answer that question. ${msg}`;
            }
            this.activeOutputHost = null;
        }, 0);
    }

    private replaceEditedArtifactWithResponse(existingWrap: HTMLElement, response: AssistantResponse, engineQuestion: string): void {
        const doc = this.host.ownerDocument || document;
        const tempHost = doc.createElement("div");
        const prevHost = this.activeOutputHost;
        this.activeOutputHost = tempHost;
        try {
            if (response.table) {
                this.lastResponseTable = response.table;
                this.appendTable(response.table.columns, response.table.rows, undefined, response.table.editableQuery);
                (response.tables || []).forEach((table) => this.appendTable(table.columns, table.rows, table.title, table.editableQuery));
                if (response.matrix) this.appendMatrix(response.matrix);
            } else if (response.tables?.length) {
                this.lastResponseTable = response.tables[0];
                response.tables.forEach((table) => this.appendTable(table.columns, table.rows, table.title, table.editableQuery));
                if (response.matrix) this.appendMatrix(response.matrix);
            } else if (response.matrix) {
                this.lastResponseTable = {
                    columns: [response.matrix.rowHeader].concat(response.matrix.columnHeaders),
                    rows: response.matrix.rows.map((row) => [row.label].concat(row.values))
                };
                this.appendMatrix(response.matrix);
            } else if (response.kpi) {
                this.appendKpiCard(response.kpi);
            } else {
                const fallback = doc.createElement("div");
                fallback.className = "ibx-assistant-msg ibx-assistant-msg--assistant";
                fallback.textContent = this.stripMarkdown(response.text || "No result returned.");
                tempHost.appendChild(fallback);
            }
            this.captureLastSubject(response);
            this.captureLastAnalyticQuestion(engineQuestion, response);
            this.captureLastMatrixContext(response);
        } finally {
            this.activeOutputHost = prevHost;
        }
        const nodes = Array.from(tempHost.childNodes);
        if (nodes.length) existingWrap.replaceWith(...nodes);
    }

    private replaceEditedTableArtifact(existingWrap: HTMLElement, query: AssistantEditableTableQuery): void {
        const engineQuestion = this.tableQueryToQuestion(query, "table");
        const tokens = this.tableLayoutTokens(query, "table");
        try {
            const response = this.engine.answerWithTokens(engineQuestion, tokens);
            this.recordDiagnostics(engineQuestion, engineQuestion, tokens, response);
            this.replaceEditedArtifactWithResponse(existingWrap, response, engineQuestion);
        } catch (err: any) {
            const message = String(err?.message || err || "I could not update this table.");
            this.recordDiagnostics(engineQuestion, engineQuestion, tokens, null, message);
            this.showAssistantToast(message);
        }
    }

    private replaceEditedMatrixArtifact(existingWrap: HTMLElement, query: MatrixQuery): void {
        const cleanQuery = normalizeMatrixQuery(query);
        const engineQuestion = this.matrixQueryToQuestion(cleanQuery);
        const tokens = this.matrixLayoutTokens(cleanQuery, "matrix");
        try {
            const response = this.engine.answerSavedMatrixQuery(cleanQuery);
            this.recordDiagnostics(engineQuestion, engineQuestion, tokens, response);
            this.replaceEditedArtifactWithResponse(existingWrap, response, engineQuestion);
        } catch (err: any) {
            const message = String(err?.message || err || "I could not update this matrix.");
            this.recordDiagnostics(engineQuestion, engineQuestion, tokens, null, message);
            this.showAssistantToast(message);
        }
    }

    private selectedTokenForFieldLabel(field: string): SelectedAssistantToken {
        const label = String(field || "").trim();
        const normalized = this.normalizeSelectedTokenText(label);
        return { type: "filter", id: `filter-field:${normalized || label}`, label };
    }

    private selectedTokenForMeasureLabel(measure: string): SelectedAssistantToken {
        const label = String(measure || "").trim();
        const normalized = this.normalizeSelectedTokenText(label);
        return { type: "metric", id: `metric:${normalized || label}`, label, metricKey: normalized || label };
    }

    private tableLayoutTokens(query: AssistantEditableTableQuery, output: "table" | "matrix"): SelectedAssistantToken[] {
        const fields = (query.fields || []).map((field) => String(field || "").trim()).filter(Boolean);
        const measures = (query.measures || []).map((measure) => String(measure || "").trim()).filter(Boolean);
        const filters = (query.filters || []).filter((token) => token && token.type && token.id && token.label);
        return ([] as SelectedAssistantToken[])
            .concat(filters)
            .concat(fields.map((field) => this.selectedTokenForFieldLabel(field)))
            .concat(measures.map((measure) => this.selectedTokenForMeasureLabel(measure)))
            .concat([{ type: "function", id: `output:${output}`, label: output === "table" ? "Table" : "Matrix" } as SelectedAssistantToken]);
    }

    private matrixLayoutTokens(query: MatrixQuery, output: "table" | "matrix"): SelectedAssistantToken[] {
        const fields = ([] as string[])
            .concat(query.rows || [])
            .concat(query.columns || [])
            .map((field) => String(field || "").trim())
            .filter(Boolean);
        const measures = (query.values || []).map((measure) => String(measure || "").trim()).filter(Boolean);
        return ([] as SelectedAssistantToken[])
            .concat(fields.map((field) => this.selectedTokenForFieldLabel(field)))
            .concat(measures.map((measure) => this.selectedTokenForMeasureLabel(measure)))
            .concat([{ type: "function", id: `output:${output}`, label: output === "table" ? "Table" : "Matrix" } as SelectedAssistantToken]);
    }

    private switchTableToMatrix(query: AssistantEditableTableQuery): void {
        const fields = (query.fields || []).map((field) => String(field || "").trim()).filter(Boolean);
        const measures = (query.measures || []).map((measure) => String(measure || "").trim()).filter(Boolean);
        if (!fields.length || !measures.length) return;
        const display = "Show as matrix";
        const filters = (query.filters || []).map((token) => String(token.label || "").trim()).filter(Boolean);
        const filterText = filters.length ? ` for ${filters.join(" and ")}` : "";
        const engineQuestion = `show ${measures.join(" and ")} by ${fields.join(" and ")}${filterText} in matrix`;
        this.submitForcedLayoutQuestion(display, engineQuestion, this.tableLayoutTokens(query, "matrix"));
    }

    private switchMatrixToTable(query: MatrixQuery): void {
        const display = "Show as table";
        const engineQuestion = this.matrixQueryToQuestion(query);
        this.submitForcedLayoutQuestion(display, engineQuestion, this.matrixLayoutTokens(query, "table"));
    }

    private recordDiagnostics(
        question: string,
        engineQuestion: string,
        tokens: SelectedAssistantToken[],
        response: AssistantResponse | null,
        error?: string
    ): void {
        if (!this.onDiagnosticsLog) return;
        const answerType = response?.matrix
            ? "matrix"
            : response?.chart
            ? response.chart.type
            : response?.table || response?.tables?.length
            ? "table"
            : response?.autoSelectIndices?.length || response?.actions?.some((action) => action.kind === "select")
            ? "data selection"
            : response?.clarification
            ? "clarification"
            : "text";
        const query = response?.matrix?.query;
        const tableQuery = response?.table?.editableQuery || (response?.tables || []).find((table) => table.editableQuery)?.editableQuery;
        const rows = query?.rows || tableQuery?.fields || [];
        const columns = query?.columns || [];
        const measures = query?.values || response?.matrix?.metricNames || tableQuery?.measures || [];
        const filters = query?.filters?.map((filter) => filter.phrase) || [];
        const plannerReasons = response?.confidence?.reasons || [];
        const notes: string[] = [];
        const rawFilterText = filters.join(" ").toLowerCase();
        const questionText = `${question || ""} ${engineQuestion || ""}`.toLowerCase();
        const tokenTypes = new Set(tokens.map((token) => token.type));
        const forcedOutput = tokens.find((token) => token.type === "function" && /^output:/i.test(String(token.id || "")));
        if (tokens.length) {
            notes.push("User clicked suggestion chips, so askBICS Assistant treated those choices as explicit input.");
        }
        if (plannerReasons.some((reason) => /selected_token_lock|preserve_table_edit/i.test(reason)) || tokens.length) {
            notes.push("Fuzzy expansion was skipped for clicked selections; exact selected fields, measures, and values were used.");
        } else if ((response?.performanceTimings?.metricMatching || 0) > 0 || (response?.performanceTimings?.entityMatching || 0) > 0) {
            notes.push("Fuzzy matching ran because the question used typed text without locked clicked selections.");
        } else {
            notes.push("No fuzzy matching timing was recorded for this answer.");
        }
        if (forcedOutput) {
            notes.push(`User requested ${String(forcedOutput.label || forcedOutput.id).replace(/^output:/i, "")} output, so that layout was preferred.`);
        }
        if (measures.length) {
            notes.push(`Calculation used the visual's loaded measure values for: ${measures.join(", ")}.`);
        }
        if (rows.length || columns.length) {
            notes.push(`Answer grouped data by ${rows.concat(columns).join(" > ")}.`);
        }
        if (tokenTypes.has("filter") || filters.length) {
            notes.push("Filter tokens were applied before creating the answer.");
        }
        if (filters.length && filters.some((filter) => questionText.indexOf(String(filter || "").toLowerCase()) < 0)) {
            notes.push("Filter present but not visible in the typed question.");
        }
        if (plannerReasons.some((reason) => /entity_confidence_low|metric_confidence_low|field_resolution/i.test(reason))) {
            notes.push("Confidence was low for at least one typed field, value, or metric; check the suggestions and selected tokens.");
        }
        if (plannerReasons.some((reason) => /dictionary|blocked|disabled/i.test(reason))) {
            notes.push("AI data dictionary affected field or metric selection.");
        }
        const measureAccess = typeof (this.engine as any)?.getMeasureAccessDiagnostics === "function"
            ? (this.engine as any).getMeasureAccessDiagnostics()
            : null;
        if (measureAccess?.mode === "bookmarkGroups") {
            const groupsText = (measureAccess.groups || []).length ? measureAccess.groups.join(", ") : "No bookmark groups resolved";
            notes.push(`Measure access mode: Bookmark groups. Groups: ${groupsText}. Allowed measure count: ${measureAccess.measureCount || 0}.`);
        }
        if (response?.matrix && columns.some((column) => /tenant|unit|brand|shop|store/i.test(column))) {
            notes.push("High-cardinality field was used as a matrix column.");
        }
        if (rawFilterText && !filters.length) {
            notes.push("No matrix filters applied.");
        }
        const resultCount = response?.matrix?.rows?.length
            || response?.table?.rows?.length
            || response?.tables?.reduce((sum, table) => sum + (table.rows?.length || 0), 0)
            || response?.chart?.labels?.length
            || response?.autoSelectIndices?.length
            || 0;
        const finalQuery = query || tableQuery || {
            question,
            engineQuestion,
            output: answerType,
            intent: response?.matrix ? "matrix" : response?.confidence?.intent || (response?.clarification ? "clarification" : undefined),
            rows,
            columns,
            values: measures,
            filters,
            selectedTokens: tokens.map((token) => ({ type: token.type, label: token.label, id: token.id })),
            measureAccessMode: measureAccess?.mode,
            measureAccessGroups: measureAccess?.groups,
            measureAccessMeasureCount: measureAccess?.measureCount,
            resultCount
        };
        this.onDiagnosticsLog({
            timestamp: new Date().toISOString(),
            question,
            engineQuestion,
            selectedTokens: tokens.map((token) => ({ type: token.type, label: token.label, id: token.id })),
            intent: response?.matrix ? "matrix" : response?.confidence?.intent || (response?.clarification ? "clarification" : undefined),
            measures,
            fields: rows.concat(columns),
            rows,
            columns,
            filters,
            planner: response?.matrix ? "matrix/cardinality" : response?.confidence?.reasons?.[0],
            plannerReasons,
            notes,
            finalQuery,
            answerType,
            confidence: response?.confidence?.overallConfidence,
            performanceTimings: response?.performanceTimings,
            measureAccessMode: measureAccess?.mode,
            measureAccessGroups: measureAccess?.groups,
            measureAccessMeasureCount: measureAccess?.measureCount,
            clarificationAsked: !!response?.clarification,
            resultCount,
            result: error ? "failed" : response?.clarification ? "clarification" : response?.handled ? "answered" : "failed",
            error
        });
    }

    private recordAutocompletePerformance(source: string): void {
        void source;
    }

    private matrixQueryToQuestion(query: MatrixQuery): string {
        return matrixQueryToQuestion(query);
    }

    private formatMatrixCardTitle(matrix: NonNullable<AssistantResponse["matrix"]>): string {
        const title = String(matrix.title || "").trim();
        const metricName = String(matrix.metricName || "").trim();
        if (!title) return metricName || "Matrix";
        const withoutMatrix = title.replace(/\s+matrix$/i, "").trim();
        return withoutMatrix || metricName || title;
    }

    private cloneTableQuery(query: AssistantEditableTableQuery): AssistantEditableTableQuery {
        return {
            fields: (query.fields || []).map((value) => String(value || "").trim()).filter(Boolean),
            measures: (query.measures || []).map((value) => String(value || "").trim()).filter(Boolean),
            fieldOptions: (query.fieldOptions || []).map((value) => String(value || "").trim()).filter(Boolean),
            measureOptions: (query.measureOptions || []).map((value) => String(value || "").trim()).filter(Boolean)
        };
    }

    private normalizeSavedReportTileSize(value: unknown): AssistantSavedReportTileSize {
        const size = String(value || "").toLowerCase();
        return size === "medium" || size === "large" ? size : "small";
    }

    private normalizeSavedReportTileHeight(value: unknown): AssistantSavedReportTileHeight {
        const height = String(value || "").toLowerCase();
        return height === "short" || height === "tall" ? height : "normal";
    }

    private normalizeSavedReportGridWidth(value: unknown, fallbackSize?: unknown): number {
        const parsed = Math.round(Number(value));
        if (Number.isFinite(parsed) && parsed >= 2) return Math.max(2, Math.min(8, parsed));
        const size = this.normalizeSavedReportTileSize(fallbackSize);
        return size === "large" ? 6 : size === "medium" ? 4 : 2;
    }

    private normalizeSavedReportGridHeight(value: unknown, fallbackHeight?: unknown): number {
        const parsed = Math.round(Number(value));
        if (Number.isFinite(parsed) && parsed >= 3) return Math.max(3, Math.min(8, parsed));
        const height = this.normalizeSavedReportTileHeight(fallbackHeight);
        return height === "tall" ? 6 : height === "short" ? 3 : 4;
    }

    private normalizeSavedReportCanvasValue(value: unknown, fallback: number, min: number, max: number): number {
        const parsed = Math.round(Number(value));
        if (Number.isFinite(parsed)) return Math.max(min, Math.min(max, parsed));
        return fallback;
    }

    private savedReportDefaultCanvasRect(report: AssistantPinnedMatrixReport, index: number): { x: number; y: number; w: number; h: number } {
        const size = this.normalizeSavedReportTileSize(report.layout?.size);
        const height = this.normalizeSavedReportTileHeight(report.layout?.height);
        const gridW = this.normalizeSavedReportGridWidth(report.layout?.w, size);
        const gridH = this.normalizeSavedReportGridHeight(report.layout?.h, height);
        const w = Math.max(180, Math.min(760, 78 * gridW + 10 * Math.max(0, gridW - 1)));
        const h = Math.max(160, Math.min(520, 52 * gridH + 10 * Math.max(0, gridH - 1)));
        const x = 14 + (index % 3) * 276;
        const y = 14 + Math.floor(index / 3) * 238;
        return { x, y, w, h };
    }

    private savedReportCanvasRect(report: AssistantPinnedMatrixReport, index: number): { x: number; y: number; w: number; h: number } {
        const fallback = this.savedReportDefaultCanvasRect(report, index);
        const w = this.normalizeSavedReportCanvasValue(report.layout?.pxW, fallback.w, 150, 980);
        const h = this.normalizeSavedReportCanvasValue(report.layout?.pxH, fallback.h, 140, 720);
        const x = this.normalizeSavedReportCanvasValue(report.layout?.x, fallback.x, 0, 4000);
        const y = this.normalizeSavedReportCanvasValue(report.layout?.y, fallback.y, 0, 4000);
        return { x, y, w, h };
    }

    private savedReportsCanvasHeight(reports: AssistantPinnedMatrixReport[]): number {
        const bottom = (reports || []).reduce((max, report, index) => {
            const rect = this.savedReportCanvasRect(report, index);
            return Math.max(max, rect.y + rect.h);
        }, 0);
        return Math.max(520, bottom + 24);
    }

    private hasSavedReportCanvasLayout(reports: AssistantPinnedMatrixReport[]): boolean {
        return (reports || []).some((report) =>
            Number.isFinite(Number(report.layout?.x))
            || Number.isFinite(Number(report.layout?.y))
            || Number.isFinite(Number(report.layout?.pxW))
            || Number.isFinite(Number(report.layout?.pxH))
        );
    }

    private savedReportRectsOverlap(
        first: { x: number; y: number; w: number; h: number },
        second: { x: number; y: number; w: number; h: number },
        gap = 14
    ): boolean {
        return !(
            first.x + first.w + gap <= second.x
            || second.x + second.w + gap <= first.x
            || first.y + first.h + gap <= second.y
            || second.y + second.h + gap <= first.y
        );
    }

    private assignNewSavedReportCanvasLayout(report: AssistantPinnedMatrixReport): void {
        if (!this.hasSavedReportCanvasLayout(this.pinnedMatrixReports)) return;

        const visibleExistingReports = this.pinnedMatrixReports
            .filter((item) => item.id !== report.id)
            .slice(0, 11);
        const occupiedRects = visibleExistingReports.map((item, index) => this.savedReportCanvasRect(item, index + 1));
        const defaultRect = this.savedReportCanvasRect(report, 0);
        const gap = 14;
        const step = 24;
        const canvasWidth = Math.max(980, ...occupiedRects.map((rect) => rect.x + rect.w + gap));
        const maxX = Math.max(14, canvasWidth - defaultRect.w);
        const maxBottom = occupiedRects.reduce((max, rect) => Math.max(max, rect.y + rect.h), 14);

        for (let y = 14; y <= maxBottom + defaultRect.h + gap; y += step) {
            for (let x = 14; x <= maxX; x += step) {
                const candidate = { x, y, w: defaultRect.w, h: defaultRect.h };
                if (!occupiedRects.some((rect) => this.savedReportRectsOverlap(candidate, rect, gap))) {
                    report.layout = {
                        ...(report.layout || {}),
                        x: candidate.x,
                        y: candidate.y,
                        pxW: candidate.w,
                        pxH: candidate.h
                    };
                    return;
                }
            }
        }

        report.layout = {
            ...(report.layout || {}),
            x: 14,
            y: maxBottom + gap,
            pxW: defaultRect.w,
            pxH: defaultRect.h
        };
    }

    private cloneSavedReport(report: AssistantPinnedMatrixReport): AssistantPinnedMatrixReport {
        return {
            id: report.id,
            name: report.name,
            type: report.type || "matrix",
            query: cloneMatrixQuery(report.query),
            tableQuery: report.tableQuery ? this.cloneTableQuery(report.tableQuery) : undefined,
            tableSnapshot: report.tableSnapshot
                ? {
                    title: report.tableSnapshot.title,
                    columns: report.tableSnapshot.columns.slice(),
                    rows: report.tableSnapshot.rows.map((row) => row.slice())
                }
                : undefined,
            chartSnapshot: report.chartSnapshot
                ? {
                    type: report.chartSnapshot.type,
                    title: report.chartSnapshot.title,
                    labels: (report.chartSnapshot.labels || []).slice(),
                    values: (report.chartSnapshot.values || []).slice(),
                    valueLabels: (report.chartSnapshot.valueLabels || []).slice(),
                    series: report.chartSnapshot.series?.map((series) => ({
                        name: series.name,
                        labels: (series.labels || []).slice(),
                        values: (series.values || []).slice(),
                        valueLabels: (series.valueLabels || []).slice()
                    }))
                }
                : undefined,
            kpiSnapshot: report.kpiSnapshot ? { ...report.kpiSnapshot } : undefined,
            layout: {
                size: this.normalizeSavedReportTileSize(report.layout?.size),
                height: this.normalizeSavedReportTileHeight(report.layout?.height),
                w: this.normalizeSavedReportGridWidth(report.layout?.w, report.layout?.size),
                h: this.normalizeSavedReportGridHeight(report.layout?.h, report.layout?.height),
                x: Number.isFinite(Number(report.layout?.x)) ? Number(report.layout?.x) : undefined,
                y: Number.isFinite(Number(report.layout?.y)) ? Number(report.layout?.y) : undefined,
                pxW: Number.isFinite(Number(report.layout?.pxW)) ? Number(report.layout?.pxW) : undefined,
                pxH: Number.isFinite(Number(report.layout?.pxH)) ? Number(report.layout?.pxH) : undefined,
                headerColor: this.normalizeSavedReportHeaderColor(report.layout?.headerColor),
                columnWidths: this.normalizeSavedReportColumnWidths(report.layout?.columnWidths)
            },
            createdAt: report.createdAt,
            updatedAt: report.updatedAt
        };
    }

    private tableQueryToQuestion(query: AssistantEditableTableQuery, output: "table" | "matrix" = "table"): string {
        const fields = (query.fields || []).map((value) => String(value || "").trim()).filter(Boolean);
        const measures = (query.measures || []).map((value) => String(value || "").trim()).filter(Boolean);
        const filters = (query.filters || []).map((token) => String(token.label || "").trim()).filter(Boolean);
        const measureText = measures.length ? measures.join(" and ") : "details";
        if (!fields.length && filters.length >= 2 && measures.length) {
            return `compare ${filters.join(" and ")} by ${measureText} in ${output}`;
        }
        const fieldText = fields.length ? ` by ${fields.join(" and ")}` : "";
        const filterText = filters.length ? ` for ${filters.join(" and ")}` : "";
        return `show ${measureText}${fieldText}${filterText} in ${output}`;
    }

    private withTransposedComparisonFilters(query: AssistantEditableTableQuery, columns: string[]): AssistantEditableTableQuery {
        const cleanColumns = (columns || []).map((column) => String(column || "").trim()).filter(Boolean);
        const isTransposedComparison = cleanColumns.length >= 3
            && cleanColumns.length <= 5
            && /^metric$/i.test(cleanColumns[0]);
        if (!isTransposedComparison || (query.filters || []).length) return query;
        const filters = cleanColumns.slice(1).map((label) => {
            const normalized = this.normalizeSelectedTokenText(label);
            return {
                type: "filter",
                id: `filter:${normalized || label}`,
                label
            } as SelectedAssistantToken;
        });
        return { ...query, filters };
    }

    private tableQueryToMatrixQuery(query: AssistantEditableTableQuery): MatrixQuery {
        return normalizeMatrixQuery({
            rows: (query.fields || []).map((value) => String(value || "").trim()).filter(Boolean),
            columns: [],
            values: (query.measures || []).map((value) => String(value || "").trim()).filter(Boolean),
            filters: (query.filters || []).map((token) => String(token.label || "").trim()).filter(Boolean)
        });
    }

    private captureLastMatrixContext(response: AssistantResponse): void {
        const matrix = response.matrix;
        if (!matrix?.query) return;
        this.lastMatrixResponse = matrix;
        this.lastMatrixQuery = cloneMatrixQuery(matrix.query);
        this.lastMatrixTitle = matrix.title || "Pinned matrix";
    }

    private normalizeMatrixCommand(value: string): string {
        return String(value || "").toLowerCase().replace(/[?!.]+$/g, "").replace(/\s+/g, " ").trim();
    }

    private resolveMatrixFieldPhrase(raw: string, axis: "rows" | "columns" | "values" | "any"): string {
        const clean = this.normalizeMatrixCommand(raw)
            .replace(/\b(?:add|put|move|set|make|use|show|display|remove|delete|field|measure|metric|value|values|row|rows|column|columns|cols?|as|to|in|on|the|a|an)\b/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        if (!clean) return "";
        const options = this.lastMatrixFieldOptions(axis);
        const compact = (value: string) => this.normalizeMatrixCommand(value).replace(/\s+/g, "");
        const direct = options.find((option) => {
            const optionClean = this.normalizeMatrixCommand(option);
            return optionClean === clean || compact(optionClean) === compact(clean) || clean.indexOf(optionClean) >= 0 || optionClean.indexOf(clean) >= 0;
        });
        if (direct) return direct;
        if (/\btenant\b/.test(clean)) return "Assigned Tenant Name";
        if (/\bcategory\b|\bsales category\b/.test(clean)) return "Assigned Sales Category";
        if (/\bgroup\b/.test(clean)) return "Assigned Group";
        if (/\bunit\b/.test(clean)) return axis === "values" ? "Units" : "Unit";
        if (/\bzone|region\b/.test(clean)) return "Zone";
        if (/\bfloor|level\b/.test(clean)) return "Floor";
        if (/\barea|sqm|size\b/.test(clean)) return "Area";
        if (/\bocr\b/.test(clean)) return "OCR";
        if (/\brent\b/.test(clean) && /\bsqm|area|m2\b/.test(clean)) return "Rent/Sqm";
        if (/\bsales\b/.test(clean) && /\bsqm|area|m2\b/.test(clean)) return "Sales/Sqm";
        return clean;
    }

    private lastMatrixFieldOptions(axis: "rows" | "columns" | "values" | "any"): string[] {
        const fallbackRows = ["Assigned Sales Category", "Assigned Group", "Assigned Tenant Name", "Unit", "Zone", "Floor"];
        const fallbackValues = ["Area", "Units", "Sales/Sqm", "Rent/Sqm", "OCR"];
        if (axis === "values") return fallbackValues;
        if (axis === "rows" || axis === "columns") return fallbackRows;
        return fallbackRows.concat(fallbackValues);
    }

    private resolveMatrixFollowupQuestion(text: string): string | null {
        const q = this.normalizeMatrixCommand(text);
        if (!q) return null;
        if (/\b(?:show|open|list)\s+pinned\s+(?:reports?|matrix|matrices)\b/.test(q)) {
            if (this.pinnedMatrixReports[0]) return this.matrixQueryToQuestion(this.pinnedMatrixReports[0].query);
            this.appendMessage("No pinned matrix reports yet.", "assistant");
            return "";
        }
        if (/\bclear\s+pinned\s+(?:reports?|matrix|matrices)\b/.test(q)) {
            this.pinnedMatrixReports = [];
            this.savePinnedMatrixReports();
            this.appendMessage("Pinned matrix reports cleared.", "assistant");
            return "";
        }
        if (this.isFreshMatrixRequest(q)) return null;
        if (/\b(?:matrix|pivot|report)\b/.test(q) && /\b(?:rows?|columns?|cols?|by|as)\b/.test(q)) return null;
        if (!this.lastMatrixQuery) return null;
        const query = cloneMatrixQuery(this.lastMatrixQuery);
        if (/^(?:swap|switch|flip)(?:\s+rows?\s+(?:and|with)\s+columns?)?$/.test(q) || /\bswap\s+rows?\s+(?:and|with)\s+columns?\b/.test(q)) {
            return this.matrixQueryToQuestion(swapMatrixAxes(query));
        }
        if (/\bpin\s+(?:this\s+)?(?:report|matrix)\b/.test(q)) {
            this.pinnedMatrixReports.unshift({
                id: `matrix-${Date.now()}`,
                name: this.lastMatrixTitle || "Pinned matrix",
                query: cloneMatrixQuery(query),
                createdAt: Date.now()
            });
            this.pinnedMatrixReports = this.pinnedMatrixReports.slice(0, 12);
            this.savePinnedMatrixReports();
            this.appendMessage("Saved to Saved Reports. Open the Saved Reports button in the askBICS Assistant header to view it.", "assistant");
            return "";
        }
        if (/\bremove\s+columns?\b|\bdelete\s+columns?\b|\bno\s+columns?\b/.test(q)) {
            return this.matrixQueryToQuestion({ ...query, columns: [] });
        }
        if (/\bremove\s+rows?\b|\bdelete\s+rows?\b/.test(q)) {
            return this.matrixQueryToQuestion({ ...query, rows: [] });
        }
        const addColumn = q.match(/\b(?:add|put|move|set|make|use)\s+(.+?)\s+(?:as|to|in)\s+(?:columns?|cols?)\b/i)
            || q.match(/\b(?:columns?|cols?)\s+(.+)$/i);
        if (addColumn?.[1]) {
            const field = this.resolveMatrixFieldPhrase(addColumn[1], "columns");
            return this.matrixQueryToQuestion(addMatrixField(query, "columns", field));
        }
        const addRow = q.match(/\b(?:add|put|move|set|make|use)\s+(.+?)\s+(?:as|to|in)\s+rows?\b/i)
            || q.match(/\brows?\s+(.+)$/i);
        if (addRow?.[1]) {
            const field = this.resolveMatrixFieldPhrase(addRow[1], "rows");
            return this.matrixQueryToQuestion(addMatrixField(query, "rows", field));
        }
        const addValue = q.match(/\b(?:add|include|use)\s+(.+?)\s+(?:as\s+)?(?:values?|measures?|metrics?)\b/i)
            || q.match(/\b(?:add|include|use)\s+(.+)$/i);
        if (addValue?.[1]) {
            const field = this.resolveMatrixFieldPhrase(addValue[1], "values");
            return this.matrixQueryToQuestion(addMatrixField(query, "values", field));
        }
        return null;
    }

    private buildLocalMatrixCommandResponse(text: string): AssistantResponse | null | undefined {
        const q = this.normalizeMatrixCommand(text);
        if (!q) return undefined;
        if (/\b(?:export|copy)\s+(?:matrix|report|table)(?:\s+as\s+csv)?\b/.test(q)) {
            this.exportLastResponseTable();
            return { handled: true, text: "Matrix exported as CSV." };
        }
        if (/\b(?:show|open|list)\s+pinned\s+(?:reports?|matrix|matrices)\b/.test(q)) {
            return this.pinnedReportsResponse();
        }
        const deletePinned = q.match(/\b(?:delete|remove)\s+pinned\s+(?:report|matrix)\s+(.+)$/i);
        if (deletePinned?.[1]) {
            const removed = this.deletePinnedMatrixReport(deletePinned[1]);
            return { handled: true, text: removed ? `Deleted pinned report "${removed}".` : "I could not find that pinned report." };
        }
        const renamePinned = q.match(/\brename\s+pinned\s+(?:report|matrix)\s+(.+?)\s+(?:to|as)\s+(.+)$/i);
        if (renamePinned?.[1] && renamePinned?.[2]) {
            const renamed = this.renamePinnedMatrixReport(renamePinned[1], renamePinned[2]);
            return { handled: true, text: renamed ? `Renamed pinned report to "${renamed}".` : "I could not find that pinned report." };
        }
        if (this.isFreshMatrixRequest(q)) return undefined;
        if (!this.lastMatrixQuery) return undefined;
        const query = cloneMatrixQuery(this.lastMatrixQuery);
        if (/\bclear\s+filters?\b/.test(q)) {
            return this.responseForGeneratedMatrixQuery(clearMatrixFilters(query), "Cleared matrix filters.");
        }
        const filterMatch = q.match(/\b(?:filter|only|include|including)\s+(.+)$/i);
        if (filterMatch?.[1]) {
            const phrase = String(filterMatch[1] || "").trim();
            return this.responseForGeneratedMatrixQuery(addMatrixFilter(query, "include", phrase), `Added filter: include ${phrase}.`);
        }
        const excludeMatch = q.match(/\b(?:exclude|excluding|without|except)\s+(.+)$/i);
        if (excludeMatch?.[1]) {
            const phrase = String(excludeMatch[1] || "").trim();
            return this.responseForGeneratedMatrixQuery(addMatrixFilter(query, "exclude", phrase), `Added filter: exclude ${phrase}.`);
        }
        const removeMatch = q.match(/\b(?:remove|delete)\s+(.+?)(?:\s+from\s+(rows?|columns?|cols?|values?|metrics?|measures?))?$/i);
        if (removeMatch?.[1]) {
            const target = String(removeMatch[2] || "").toLowerCase();
            const axis = /col/.test(target) ? "columns" : /row/.test(target) ? "rows" : /value|metric|measure/.test(target) ? "values" : "any";
            const field = this.resolveMatrixFieldPhrase(removeMatch[1], axis as any);
            const next = this.removeMatrixField(query, field, axis as any);
            if (next) return this.responseForGeneratedMatrixQuery(next, `Removed ${field}.`);
        }
        const topBottom = q.match(/\b(?:show\s+)?(top|bottom)\s+(\d{1,3})(?:\s+rows?)?(?:\s+by\s+(.+))?$/i);
        if (topBottom?.[1] && topBottom?.[2]) {
            const direction = topBottom[1].toLowerCase() === "bottom" ? "asc" : "desc";
            const metric = this.resolveMatrixFieldPhrase(topBottom[3] || "", "values");
            return this.responseForGeneratedMatrixQuery(withMatrixSort(query, direction, metric || "grandTotal", Number(topBottom[2])), `Showing ${direction === "asc" ? "bottom" : "top"} ${topBottom[2]} matrix rows.`);
        }
        const sort = q.match(/\bsort\s+(?:rows?\s+)?(?:by\s+)?(.+?)(?:\s+(ascending|asc|descending|desc))?$/i);
        if (sort?.[1]) {
            const metric = this.resolveMatrixFieldPhrase(sort[1], "values");
            const direction = /asc/i.test(sort[2] || "") ? "asc" : "desc";
            return this.responseForGeneratedMatrixQuery(withMatrixSort(query, direction, metric || "grandTotal"), `Sorted matrix rows ${direction === "asc" ? "ascending" : "descending"}.`);
        }
        return undefined;
    }

    private isFreshMatrixRequest(text: string): boolean {
        const q = this.normalizeMatrixCommand(text);
        if (!q) return false;
        const hasFreshVerb = /\b(?:show|display|get|give|create|build|summarize|summary)\b/.test(q);
        const hasMetric = /\b(?:sales?|revenue|turnover|rent|rental|lease|ocr|occupancy|vacancy|vacant|occupied|area|sqm|sq\s*m|m2|gla|units?)\b/.test(q);
        const hasConnector = /\b(?:and|by|with|across|grouped\s+by|split\s+by|rows?|columns?|cols?|matrix|pivot|report)\b/.test(q);
        const dimensionMatches = q.match(/\b(?:assigned\s+)?(?:tenant\s+names?|tenants?|unit\s+ids?|units?|sales\s+categor(?:y|ies)|categor(?:y|ies)|groups?|zones?|regions?|floors?|levels?|layers?)\b/g) || [];
        return hasFreshVerb && hasMetric && hasConnector && dimensionMatches.length > 0;
    }

    private responseForGeneratedMatrixQuery(query: MatrixQuery, text: string): AssistantResponse {
        const question = this.matrixQueryToQuestion(query);
        const response = this.engine.answer(question);
        return { ...response, text: `${text} ${response.text}`.trim() };
    }

    private removeMatrixField(
        query: MatrixQuery,
        field: string,
        axis: "rows" | "columns" | "values" | "any"
    ): MatrixQuery | null {
        return removeMatrixQueryField(query, field, axis);
    }

    private matrixTopRowsResponse(limit: number, direction: "asc" | "desc", metricPhrase: string, sortedOnly: boolean = false): AssistantResponse {
        const matrix = this.lastMatrixResponse;
        if (!matrix) return { handled: true, text: "Please run a matrix report first." };
        const colIndex = this.findMatrixColumnIndex(matrix, metricPhrase);
        const rows = (matrix.rows || []).filter((row) => !row.isTotal && !row.parentKey);
        const sorted = rows.slice().sort((a, b) => {
            const av = this.parseTableNumber(a.values[colIndex] || "");
            const bv = this.parseTableNumber(b.values[colIndex] || "");
            const aa = Number.isFinite(av) ? av : (direction === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
            const bb = Number.isFinite(bv) ? bv : (direction === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
            return direction === "asc" ? aa - bb : bb - aa;
        });
        const shown = sorted.slice(0, Math.max(1, Math.min(100, limit || 10)));
        const total = (matrix.rows || []).find((row) => row.isTotal);
        const nextMatrix = {
            ...matrix,
            title: sortedOnly ? `${matrix.title} sorted` : `${matrix.title} ${direction === "asc" ? "bottom" : "top"} ${shown.length}`,
            rows: total ? shown.concat([total]) : shown
        };
        return {
            handled: true,
            text: sortedOnly
                ? `Sorted matrix rows by ${matrix.columnHeaders[colIndex] || metricPhrase || "value"} ${direction === "asc" ? "ascending" : "descending"}.`
                : `Showing ${direction === "asc" ? "bottom" : "top"} ${shown.length} matrix rows by ${matrix.columnHeaders[colIndex] || metricPhrase || "value"}.`,
            matrix: nextMatrix
        };
    }

    private findMatrixColumnIndex(matrix: NonNullable<AssistantResponse["matrix"]>, metricPhrase: string): number {
        const wanted = this.normalizeMatrixCommand(metricPhrase || "");
        const headers = matrix.columnHeaders || [];
        if (wanted) {
            const found = headers.findIndex((header) => this.normalizeMatrixCommand(header).indexOf(wanted) >= 0 || wanted.indexOf(this.normalizeMatrixCommand(header)) >= 0);
            if (found >= 0) return found;
        }
        const numericCounts = headers.map((_header, index) => ({
            index,
            count: (matrix.rows || []).filter((row) => Number.isFinite(this.parseTableNumber(row.values[index] || ""))).length
        })).sort((a, b) => b.count - a.count);
        return numericCounts[0]?.index || 0;
    }

    private buildDirectBenchmarkFollowupResponse(question: string): AssistantResponse | null {
        const q = String(question || "").trim();
        if (!q) return null;
        const isBenchmark = /^(?:yes,\s*)?(?:show\s+)?benchmark\s+statistics\b/i.test(q);
        const percentileMatch = q.match(/^(?:show\s+)?(?:percentile\s+)?(90|75|50|25)(?:th)?(?:\s+percentile)?(?:\s+tenants?)?\b/i)
            || q.match(/\bpercentile\s+(90|75|50|25)\b/i)
            || q.match(/\b(90|75|50|25)(?:th)?\s+percentile\b/i);
        if (!isBenchmark && !percentileMatch) return null;
        const percentile = percentileMatch ? Number(percentileMatch[1]) as 90 | 75 | 50 | 25 : undefined;
        return this.buildBenchmarkResponseFromContext(this.lastRankBenchmarkContext || null, percentile);
    }

    private updateAutocompleteGhost(): void {
        const previous = this.acGhostSuffix;
        this.acGhostSuffix = "";
        const item = this.acItems[Math.max(0, this.acIndex)];
        if (!item || !this.acTokenRange) {
            if (previous) this.scheduleInputHighlights();
            return;
        }
        const text = String(this.input.value || "");
        const cursor = this.input.selectionStart ?? text.length;
        const typed = text.slice(this.acTokenRange.start, this.acTokenRange.end);
        const isValuePickerToken = typed.trim().startsWith("@");
        const isBookmarkMeasureToken = typed.trim().startsWith("#") || String(item.id || "").startsWith("bookmark-measures:");
        const isScopedFieldValueToken = this.acScopedValuePickerActive;
        if (!isValuePickerToken && !isBookmarkMeasureToken && !isScopedFieldValueToken && item.type !== "metric" && item.type !== "filter") {
            if (previous) this.scheduleInputHighlights();
            return;
        }
        if (cursor !== this.acTokenRange.end || this.input.selectionEnd !== cursor) {
            if (previous) this.scheduleInputHighlights();
            return;
        }
        const typedForMatch = isValuePickerToken
            ? typed.replace(/^@+/, "")
            : isBookmarkMeasureToken
            ? typed.replace(/^#+/, "")
            : typed;
        const label = String(item.label || "");
        const matchLabel = isBookmarkMeasureToken ? label.replace(/^#+/, "") : label;
        if (typedForMatch.trim().length < 3) {
            if (previous) this.scheduleInputHighlights();
            return;
        }
        if (matchLabel.toLowerCase().startsWith(typedForMatch.toLowerCase()) && matchLabel.length > typedForMatch.length) {
            this.acGhostSuffix = matchLabel.slice(typedForMatch.length) + (this.acScopedValueNeedsCloseParen ? ")" : "");
        } else if ((isValuePickerToken || isBookmarkMeasureToken || isScopedFieldValueToken) && this.acItems.length === 1 && label) {
            this.acGhostSuffix = ` \u2192 ${label}`;
        } else {
            if (previous) this.scheduleInputHighlights();
            return;
        }
        if (this.acGhostSuffix !== previous) this.scheduleInputHighlights();
    }

    private renderInputHighlights(): void {
        if (this.highlightFrame !== null) {
            window.cancelAnimationFrame(this.highlightFrame);
            this.highlightFrame = null;
        }
        if (!this.inputHighlight) return;
        this.inputHighlight.replaceChildren();
        const text = String(this.input.value || "");
        const ranges = this.getTokenRanges(text, this.selectedTokens || []);
        const ghost = this.acGhostSuffix || "";
        if (!text || (!ranges.length && !ghost)) {
            this.input.style.color = "";
            this.inputHighlight.hidden = true;
            return;
        }
        this.inputHighlight.hidden = false;
        this.input.style.color = "transparent";
        let cursor = 0;
        ranges.forEach((range) => {
            if (range.start > cursor) {
                const plain = this.host.ownerDocument.createElement("span");
                plain.textContent = text.slice(cursor, range.start);
                this.inputHighlight!.appendChild(plain);
            }
            const tokenSpan = this.host.ownerDocument.createElement("span");
            tokenSpan.className = `ibx-assistant-input-token ibx-assistant-input-token--${range.token.type}`;
            if (String(range.token.id || "").startsWith("bookmark-measures:")) tokenSpan.setAttribute("data-bookmark-measures", "true");
            tokenSpan.textContent = text.slice(range.start, range.end);
            this.inputHighlight!.appendChild(tokenSpan);
            cursor = range.end;
        });
        if (cursor < text.length) {
            const tail = this.host.ownerDocument.createElement("span");
            tail.textContent = text.slice(cursor);
            this.inputHighlight.appendChild(tail);
        }
        if (ghost) {
            const ghostSpan = this.host.ownerDocument.createElement("span");
            ghostSpan.className = "ibx-assistant-input-ghost";
            ghostSpan.textContent = ghost;
            this.inputHighlight.appendChild(ghostSpan);
        }
        this.syncInputHighlightScroll();
    }

    private scheduleInputHighlights(): void {
        if (this.highlightFrame !== null) return;
        this.highlightFrame = window.requestAnimationFrame(() => {
            this.highlightFrame = null;
            this.renderInputHighlights();
        });
    }

    private syncInputHighlightScroll(): void {
        if (!this.inputHighlight || !this.input) return;
        const wrap = this.inputHighlight.parentElement as HTMLElement | null;
        const input = this.input;
        const scrollLeft = Number(input.scrollLeft || 0);
        let baseLeft = 11;
        if (wrap) {
            const wrapRect = wrap.getBoundingClientRect();
            const inputRect = input.getBoundingClientRect();
            const inputStyle = this.host.ownerDocument.defaultView?.getComputedStyle(input);
            const paddingLeft = Number.parseFloat(inputStyle?.paddingLeft || "0") || 0;
            baseLeft = Math.max(0, inputRect.left - wrapRect.left + paddingLeft);
        }
        this.inputHighlight.style.transform = "none";
        this.inputHighlight.style.right = "auto";
        this.inputHighlight.style.left = `${Math.round(baseLeft - scrollLeft)}px`;
        this.inputHighlight.style.width = `${Math.max(input.scrollWidth + 8, input.clientWidth + 8)}px`;
    }

    private syncInputViewportToCaret(): void {
        const input = this.input;
        if (!input) return;
        const caret = Number(input.selectionEnd ?? input.value.length);
        const atEnd = caret >= String(input.value || "").length - 1;
        window.requestAnimationFrame(() => {
            if (!atEnd) {
                this.syncInputHighlightScroll();
                return;
            }
            input.scrollLeft = input.scrollWidth;
            this.syncInputHighlightScroll();
        });
    }

    private syncSelectedTokensToInput(): void {
        const text = String(this.input.value || "");
        this.selectedTokens = this.getActiveSelectedTokens(text);
    }

    private expandBookmarkMeasureTokens(tokens: SelectedAssistantToken[]): SelectedAssistantToken[] {
        const expanded: SelectedAssistantToken[] = [];
        (tokens || []).forEach((token) => {
            if (String(token.id || "").indexOf("bookmark-measures:") !== 0) {
                expanded.push(token);
                return;
            }
            const entries = this.engine.resolveBookmarkMeasureTokenEntries(token);
            if (!entries.length) {
                expanded.push(token);
                return;
            }
            entries.forEach(({ metric, groupName }) => {
                expanded.push({
                    type: "metric",
                    id: metric.key,
                    label: metric.name,
                    metricKey: metric.key,
                    bookmarkGroup: groupName
                });
            });
        });
        return this.mergeSelectedTokens(expanded);
    }

    private getActiveSelectedTokens(text: string): SelectedAssistantToken[] {
        const lowerText = String(text || "").toLowerCase();
        const normalizedText = this.normalizeSelectedTokenText(text);
        const seen = new Set<string>();
        return this.selectedTokens.filter((token) => {
            const label = String(token.label || "").trim();
            const key = `${token.type}:${token.id}`;
            if (!label || seen.has(key)) return false;
            seen.add(key);
            return lowerText.includes(label.toLowerCase()) || normalizedText.includes(this.normalizeSelectedTokenText(label));
        });
    }

    private normalizeSelectedTokenText(value: string): string {
        return String(value || "")
            .toLowerCase()
            .replace(/&/g, " and ")
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    private mergeSelectedTokens(...groups: SelectedAssistantToken[][]): SelectedAssistantToken[] {
        const seen = new Set<string>();
        const out: SelectedAssistantToken[] = [];
        groups.forEach((tokens) => {
            (tokens || []).forEach((token) => {
                const key = `${token.type}:${token.id}`;
                if (!token.label || seen.has(key)) return;
                seen.add(key);
                out.push(token);
            });
        });
        return out;
    }

    private getTokenRanges(text: string, tokens: SelectedAssistantToken[]): Array<{ start: number; end: number; token: SelectedAssistantToken }> {
        const lowerText = text.toLowerCase();
        const ranges: Array<{ start: number; end: number; token: SelectedAssistantToken }> = [];
        tokens
            .slice()
            .sort((a, b) => String(b.label || "").length - String(a.label || "").length)
            .forEach((token) => {
                const lowerLabel = String(token.label || "").toLowerCase();
                if (!lowerLabel) return;
                let idx = 0;
                while ((idx = lowerText.indexOf(lowerLabel, idx)) !== -1) {
                    ranges.push({ start: idx, end: idx + lowerLabel.length, token });
                    idx += lowerLabel.length;
                }
            });
        ranges.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
        const kept: typeof ranges = [];
        let lastEnd = 0;
        for (const range of ranges) {
            if (range.start < lastEnd) continue;
            kept.push(range);
            lastEnd = range.end;
        }
        return kept;
    }

    private renderAutocomplete(): void {
        if (!this.acDropdown) return;
        if (!this.acItems.length && !this.placeholderPicker) { this.hideAutocomplete(); return; }
        this.updateAutocompleteGhost();
        const doc = this.host.ownerDocument || document;
        this.acDropdown.replaceChildren();
        this.acDropdown.hidden = false;
        this.acVisible = true;
        if (!this.acItems.length && this.placeholderPicker) {
            const empty = doc.createElement("div");
            empty.className = "ibx-assistant-ac-empty";
            empty.textContent = "No matching suggestions";
            this.acDropdown.appendChild(empty);
        }
        this.acItems.forEach((item, index) => {
            const row = doc.createElement("button");
            row.className = "ibx-assistant-ac-item" + (index === this.acIndex ? " ibx-assistant-ac-item--active" : "");
            row.type = "button";
            row.title = item.label;
            row.setAttribute("aria-label", item.label);
            row.setAttribute("role", "option");
            const badge = doc.createElement("span");
            badge.className = `ibx-assistant-ac-badge ibx-assistant-ac-badge--${item.type}${String(item.id || "").startsWith("bookmark-measures:") ? " ibx-assistant-ac-badge--bookmark-measures" : ""}`;
            badge.textContent = this.getAcTypeBadge(item.type, item.id);
            const textWrap = doc.createElement("span");
            textWrap.className = "ibx-assistant-ac-text";
            const label = doc.createElement("span");
            label.className = "ibx-assistant-ac-label";
            label.textContent = item.label;
            textWrap.appendChild(label);
            if (item.detail) {
                const detail = doc.createElement("span");
                detail.className = "ibx-assistant-ac-detail";
                detail.textContent = item.detail;
                textWrap.appendChild(detail);
            }
            row.appendChild(badge);
            row.appendChild(textWrap);
            if (item.subtitle && (item.type !== "function" || String(item.id || "").startsWith("bookmark-measures:"))) {
                const subtitle = doc.createElement("span");
                subtitle.className = "ibx-assistant-ac-subtitle";
                subtitle.textContent = item.subtitle;
                row.appendChild(subtitle);
            }
            row.addEventListener("mousedown", (ev) => {
                ev.preventDefault();
                this.selectAutocompleteItem(item);
            });
            this.acDropdown!.appendChild(row);
            if (index === this.acIndex) {
                window.setTimeout(() => row.scrollIntoView({ block: "nearest" }), 0);
            }
        });
        if (this.placeholderPicker) {
            const picker = this.placeholderPicker;
            const total = picker.allItems.length;
            const pageCount = Math.max(1, Math.ceil(total / picker.pageSize));
            const first = total ? picker.page * picker.pageSize + 1 : 0;
            const last = Math.min(total, (picker.page + 1) * picker.pageSize);
            const pager = doc.createElement("div");
            pager.className = "ibx-assistant-ac-pager";

            const prev = doc.createElement("button");
            prev.className = "ibx-assistant-ac-page-btn";
            prev.type = "button";
            prev.textContent = "Previous";
            prev.disabled = picker.page <= 0;
            prev.addEventListener("mousedown", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this.movePlaceholderPickerPage(-1);
            });

            const info = doc.createElement("span");
            info.className = "ibx-assistant-ac-page-info";
            const filterText = picker.query ? ` · Filter: ${picker.query}` : "";
            info.textContent = `Showing ${first}-${last} of ${total} · Page ${picker.page + 1}/${pageCount}${filterText}`;

            const next = doc.createElement("button");
            next.className = "ibx-assistant-ac-page-btn";
            next.type = "button";
            next.textContent = "Next";
            next.disabled = picker.page >= pageCount - 1;
            next.addEventListener("mousedown", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this.movePlaceholderPickerPage(1);
            });

            pager.appendChild(prev);
            pager.appendChild(info);
            pager.appendChild(next);
            this.acDropdown.appendChild(pager);
        }
        this.positionAutocompleteDropdown();
    }

    private hideAutocomplete(): void {
        if (this.acUpdateTimer !== null) {
            window.clearTimeout(this.acUpdateTimer);
            this.acUpdateTimer = null;
        }
        if (this.acDropdown) {
            this.acDropdown.hidden = true;
            this.acDropdown.replaceChildren();
            this.acDropdown.removeAttribute("style");
        }
        this.acVisible = false;
        this.acIndex = -1;
        this.acTokenRange = null;
        this.acGhostSuffix = "";
        this.acScopedValuePickerActive = false;
        this.acScopedValueNeedsCloseParen = false;
        this.placeholderPicker = null;
        this.lastAcUpdateKey = "";
        this.scheduleInputHighlights();
    }

    private positionAutocompleteDropdown(): void {
        if (!this.acDropdown || this.acDropdown.hidden) return;
        const formWrap = this.root.querySelector(".ibx-assistant-form-wrap") as HTMLDivElement | null;
        const inputWrap = this.root.querySelector(".ibx-assistant-input-wrap") as HTMLDivElement | null;
        if (!formWrap) return;
        const rect = (inputWrap || formWrap).getBoundingClientRect();
        const panelRect = this.panel.getBoundingClientRect();
        const win = (this.host.ownerDocument || document).defaultView || window;
        const viewportHeight = win.innerHeight || document.documentElement.clientHeight || 0;
        const viewportWidth = win.innerWidth || document.documentElement.clientWidth || 0;
        const availableAbove = Math.max(84, this.snapCssPixel(rect.top - Math.max(0, panelRect.top) - 2));
        const maxHeight = Math.max(84, Math.min(210, availableAbove));
        const width = Math.max(0, this.snapCssPixel(Math.min(rect.width, Math.max(0, viewportWidth - 12))));
        const left = this.snapCssPixel(Math.max(6, Math.min(rect.left, Math.max(6, viewportWidth - width - 6))));
        this.acDropdown.style.visibility = "hidden";
        this.acDropdown.style.left = `${left}px`;
        this.acDropdown.style.width = `${width}px`;
        this.acDropdown.style.maxHeight = `${maxHeight}px`;
        this.acDropdown.style.top = "0px";
        const measuredHeight = Math.min(maxHeight, Math.ceil(this.acDropdown.scrollHeight || this.acDropdown.getBoundingClientRect().height || maxHeight));
        const top = Math.max(0, Math.min(this.snapCssPixel(rect.top) - measuredHeight, viewportHeight - measuredHeight));
        this.acDropdown.style.top = `${top}px`;
        this.acDropdown.style.visibility = "";
    }

    private openPlaceholderPicker(name: string, start: number, end: number, query: string = ""): void {
        const hint = this.getPlaceholderHint(name);
        const allItems = this.getPlaceholderAutocompleteItems(name, query);
        this.recordAutocompletePerformance(`placeholder:${name}`);
        this.placeholderPicker = {
            name,
            hint,
            allItems,
            page: 0,
            pageSize: 15,
            query,
            range: { start, end }
        };
        this.acTokenRange = { start, end };
        this.applyPlaceholderPickerPage();
    }

    private getPlaceholderAutocompleteItems(name: string, query: string): AssistantAutocompleteItem[] {
        const hint = this.getPlaceholderHint(name);
        const limit = this.getPlaceholderAutocompleteLimit(name);
        if (hint === "tenant" || hint === "category" || hint === "group" || hint === "zone" || hint === "floor" || hint === "layer") {
            const prefix = hint === "category" ? "category" : hint;
            const valueQuery = `${prefix} ${String(query || "").trim()}`.trim();
            const valueItems = this.engine.searchForValueAutocomplete(valueQuery, limit);
            if (valueItems.length) return valueItems;
        }
        return this.engine.searchForAutocomplete(query, limit, hint);
    }

    private applyPlaceholderPickerPage(): void {
        if (!this.placeholderPicker) return;
        const picker = this.placeholderPicker;
        const pageCount = Math.max(1, Math.ceil(picker.allItems.length / picker.pageSize));
        picker.page = Math.max(0, Math.min(picker.page, pageCount - 1));
        const start = picker.page * picker.pageSize;
        this.acItems = picker.allItems.slice(start, start + picker.pageSize);
        this.acIndex = this.acItems.length ? 0 : -1;
        this.acTokenRange = { ...picker.range };
        this.renderAutocomplete();
    }

    private movePlaceholderPickerPage(delta: number): void {
        if (!this.placeholderPicker) return;
        this.placeholderPicker.page += delta;
        this.applyPlaceholderPickerPage();
    }

    private filterPlaceholderPicker(query: string): void {
        if (!this.placeholderPicker) return;
        const picker = this.placeholderPicker;
        picker.query = query;
        picker.page = 0;
        picker.allItems = this.getPlaceholderAutocompleteItems(picker.name, query);
        this.recordAutocompletePerformance(`placeholder-filter:${picker.name}`);
        this.applyPlaceholderPickerPage();
    }

    private handlePlaceholderPickerKey(ev: KeyboardEvent): boolean {
        if (!this.placeholderPicker) return false;
        if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
            ev.preventDefault();
            this.filterPlaceholderPicker(`${this.placeholderPicker.query}${ev.key}`);
            return true;
        }
        if (ev.key === "Backspace") {
            ev.preventDefault();
            this.filterPlaceholderPicker(this.placeholderPicker.query.slice(0, -1));
            return true;
        }
        return false;
    }

    private scheduleAutocompleteUpdate(delayMs: number = 240): void {
        const seq = ++this.acUpdateSeq;
        if (this.acUpdateTimer !== null) window.clearTimeout(this.acUpdateTimer);
        this.acUpdateTimer = window.setTimeout(() => {
            this.acUpdateTimer = null;
            if (seq !== this.acUpdateSeq) return;
            if (this.host.ownerDocument.activeElement !== this.input) return;
            this.updateAutocomplete();
        }, delayMs);
    }

    private openAutocompleteFromKeyboard(direction: "up" | "down"): void {
        if (this.acUpdateTimer !== null) {
            window.clearTimeout(this.acUpdateTimer);
            this.acUpdateTimer = null;
        }
        this.lastAcUpdateKey = "";
        this.updateAutocomplete();
        if (!this.acItems.length) return;
        this.acIndex = direction === "up" ? this.acItems.length - 1 : 0;
        this.renderAutocomplete();
    }

    private updateAutocomplete(): void {
        const text = String(this.input.value || "");
        const cursorPos = this.input.selectionStart ?? text.length;
        const cacheKey = `${text}::${cursorPos}::${this.input.selectionEnd ?? cursorPos}`;
        if (cacheKey === this.lastAcUpdateKey) return;
        this.lastAcUpdateKey = cacheKey;
        const placeholder = this.getActivePlaceholder(text, cursorPos);
        if (placeholder) {
            const samePicker = this.placeholderPicker
                && this.placeholderPicker.name === placeholder.name
                && this.placeholderPicker.range.start === placeholder.start
                && this.placeholderPicker.range.end === placeholder.end;
            if (samePicker) {
                this.applyPlaceholderPickerPage();
            } else {
                this.openPlaceholderPicker(placeholder.name, placeholder.start, placeholder.end);
            }
            return;
        }
        this.placeholderPicker = null;
        this.acScopedValuePickerActive = false;
        this.acScopedValueNeedsCloseParen = false;
        const activeBookmarkMeasure = this.getActiveBookmarkMeasureAutocompleteRange(text, cursorPos);
        if (activeBookmarkMeasure) {
            this.acTokenRange = { start: activeBookmarkMeasure.start, end: activeBookmarkMeasure.end };
            this.acItems = this.engine.searchForBookmarkMeasureAutocomplete(activeBookmarkMeasure.query, 12);
            this.recordAutocompletePerformance("bookmark-measure-picker");
            if (!this.acItems.length) { this.hideAutocomplete(); return; }
            this.acIndex = 0;
            this.renderAutocomplete();
            return;
        }
        const activeScopedValue = this.getActiveScopedFieldValueAutocompleteRange(text, cursorPos);
        if (activeScopedValue) {
            this.acTokenRange = { start: activeScopedValue.start, end: activeScopedValue.end };
            this.acScopedValuePickerActive = true;
            this.acScopedValueNeedsCloseParen = activeScopedValue.needsCloseParen;
            this.acItems = this.engine.searchForFieldValueAutocomplete(activeScopedValue.field, activeScopedValue.query, 12);
            this.recordAutocompletePerformance("field-value-picker");
            if (!this.acItems.length) { this.hideAutocomplete(); return; }
            this.acIndex = 0;
            this.renderAutocomplete();
            return;
        }
        const activeValue = this.getActiveValueAutocompleteRange(text, cursorPos);
        if (activeValue) {
            this.acTokenRange = { start: activeValue.start, end: activeValue.end };
            this.acItems = this.engine.searchForValueAutocomplete(activeValue.query, 12);
            this.recordAutocompletePerformance("value-picker");
            if (!this.acItems.length) { this.hideAutocomplete(); return; }
            this.acIndex = 0;
            this.renderAutocomplete();
            return;
        }
        const active = this.getActiveAcToken(text, cursorPos);
        if (!active) {
            const before = text.slice(0, cursorPos);
            const after = text.slice(cursorPos);
            const hint = this.getAcContextHint(text, cursorPos);
            const phraseTail = before
                .trim()
                .split(/\s+/g)
                .slice(-4)
                .join(" ");
            const defaultRange = this.getDefaultAutocompleteReplacementRange(text, cursorPos, hint);
            this.acTokenRange = defaultRange || { start: cursorPos, end: cursorPos };
            this.acItems = this.filterPlainAutocompleteItems(this.engine.searchForAutocomplete(text.trim() ? phraseTail : "", 30, hint))
                .filter((item) => !text.trim() || item.type !== "example");
            this.recordAutocompletePerformance("typing-default");
            const canSuggestDefaults = !text.trim() || (/\s$/.test(before) && !after.trim()) || !!defaultRange || this.acItems.length > 0;
            if (!canSuggestDefaults || (text.trim() && !this.acItems.length)) { this.hideAutocomplete(); return; }
            this.acIndex = this.acItems.length ? 0 : -1;
            this.renderAutocomplete();
            return;
        }
        const hint = this.getAcContextHint(text, active.start);
        const phrasePrefix = text.slice(0, active.start);
        const phraseMatch = phrasePrefix.match(/(?:^|[\s,])([^\s,]+(?:\s+[^\s,]+){0,3})$/);
        let phraseStart = phraseMatch?.[1] ? active.start - phraseMatch[1].length : active.start;
        const assignedPrefix = text.slice(0, active.start).match(/(?:^|[\s,])(assigned|assigne|assign)\s*$/i);
        if (assignedPrefix?.[1]) {
            phraseStart = Math.max(0, active.start - assignedPrefix[1].length - (/\s$/.test(text.slice(0, active.start)) ? 1 : 0));
        }
        const metricPrefix = text.slice(0, active.start).match(/(?:^|[\s,])((?:sum|total|average|avg|min|max|earliest|latest)(?:\s+of)?\s*)$/i);
        if (metricPrefix?.[1] && (hint === "metric" || hint === "any")) {
            phraseStart = Math.max(0, active.start - metricPrefix[1].length);
        }
        const phrase = text.slice(phraseStart, active.end).replace(/^[\s,]+/g, "");
        const phraseItems = phrase.trim() && phrase.trim() !== active.token
            ? this.engine.searchForAutocomplete(phrase, 30, hint)
            : [];
        if (phraseItems.length) this.recordAutocompletePerformance("typing-phrase");
        const canSearchPrimary = this.shouldSearchAutocompleteToken(active.token, text, active.start);
        if (!canSearchPrimary && !phraseItems.length) {
            this.hideAutocomplete();
            return;
        }
        const primary = canSearchPrimary ? this.engine.searchForAutocomplete(active.token, 30, hint) : [];
        if (canSearchPrimary) this.recordAutocompletePerformance("typing-primary");
        this.acTokenRange = { start: phraseItems.length ? phraseStart : active.start, end: active.end };
        const seen = new Set<string>();
        this.acItems = this.filterPlainAutocompleteItems(phraseItems.concat(primary)).filter((item) => {
            if (text.trim() && item.type === "example") return false;
            const key = `${item.type}:${item.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).slice(0, 10);
        this.acIndex = this.acItems.length ? 0 : -1;
        this.renderAutocomplete();
    }

    private filterPlainAutocompleteItems(items: AssistantAutocompleteItem[]): AssistantAutocompleteItem[] {
        const valueTypes = new Set(["tenant", "unit", "category", "group", "zone", "floor", "layer"]);
        return (items || []).filter((item) => {
            if (String(item.id || "").startsWith("value:")) return false;
            if (valueTypes.has(String(item.type || ""))) return false;
            return true;
        });
    }

    private getDefaultAutocompleteReplacementRange(
        text: string,
        cursorPos: number,
        hint: "metric" | "entity" | "any" | "tenant" | "category" | "group" | "zone" | "floor" | "layer"
    ): { start: number; end: number } | null {
        const before = String(text || "").slice(0, cursorPos);
        const trimmedEnd = before.replace(/\s+$/g, "");
        if (!trimmedEnd) return null;
        const metricPhrase = trimmedEnd.match(/(?:^|[\s,])((?:sum|total|average|avg|min|max|earliest|latest)(?:\s+of)?)$/i);
        if (metricPhrase?.[1] && (hint === "metric" || hint === "any")) {
            return {
                start: trimmedEnd.length - metricPhrase[1].length,
                end: cursorPos
            };
        }
        const assignedPhrase = trimmedEnd.match(/(?:^|[\s,])((?:assigned|assigne|assign)(?:\s+(?:sales|tenant|group|category|cat|unit))?)$/i);
        if (assignedPhrase?.[1] && (hint === "entity" || hint === "any" || hint === "group" || hint === "category" || hint === "tenant")) {
            return {
                start: trimmedEnd.length - assignedPhrase[1].length,
                end: cursorPos
            };
        }
        return null;
    }

    private shouldSearchAutocompleteToken(token: string, text: string, tokenStart: number): boolean {
        const clean = String(token || "").trim();
        if (!clean) return false;
        if (clean.startsWith("#") || text.slice(Math.max(0, tokenStart - 1), tokenStart) === "#") return clean.length >= 1;
        if (clean.startsWith("@") || text.slice(Math.max(0, tokenStart - 1), tokenStart) === "@") return clean.length >= 1;
        if (/^\d+$/.test(clean)) return clean.length >= 1;
        if (/^assi/i.test(clean)) return clean.length >= 3;
        return clean.length >= 2;
    }

    private getActiveAcToken(text: string, cursorPos: number): { token: string; start: number; end: number } | null {
        if (!text) return null;
        const before = text.slice(0, cursorPos);
        const after = text.slice(cursorPos);
        const beforeMatch = before.match(/([^\s,]+)$/);
        const afterMatch = after.match(/^([^\s,]*)/);
        const tokenBefore = beforeMatch ? beforeMatch[1] : "";
        const tokenAfter = afterMatch ? afterMatch[1] : "";
        const token = tokenBefore + tokenAfter;
        if (!token || token.length < 1) return null;
        if (AC_STOP_WORDS.has(token.toLowerCase())) return null;
        return { token, start: cursorPos - tokenBefore.length, end: cursorPos + tokenAfter.length };
    }

    private getActiveValueAutocompleteRange(text: string, cursorPos: number): { start: number; end: number; query: string } | null {
        const before = String(text || "").slice(0, cursorPos);
        const after = String(text || "").slice(cursorPos);
        if (/^[^\s,)]/.test(after)) return null;
        const match = before.match(/(^|[\s,])@([^,]*)$/);
        if (!match) return null;
        if (/[#(]/.test(String(match[2] || ""))) return null;
        const atIndex = before.length - String(match[2] || "").length - 1;
        if (atIndex < 0) return null;
        return {
            start: atIndex,
            end: cursorPos,
            query: String(match[2] || "").trim()
        };
    }

    private getActiveScopedFieldValueAutocompleteRange(text: string, cursorPos: number): { start: number; end: number; field: string; query: string; needsCloseParen: boolean } | null {
        const fullText = String(text || "");
        const before = fullText.slice(0, cursorPos);
        const after = fullText.slice(cursorPos);
        if (/^[^\s,)]/.test(after)) return null;
        const openIndex = before.lastIndexOf("(");
        if (openIndex < 0) return null;
        const afterOpen = before.slice(openIndex + 1);
        if (/[()]/.test(afterOpen)) return null;
        const fieldText = before.slice(0, openIndex).match(/(?:^|[\s,])([^,()]{2,80})\s*$/)?.[1]?.trim() || "";
        if (!fieldText) return null;
        return {
            start: openIndex + 1,
            end: cursorPos,
            field: fieldText,
            query: afterOpen.trim(),
            needsCloseParen: after.trim().charAt(0) !== ")"
        };
    }

    private getActiveBookmarkMeasureAutocompleteRange(text: string, cursorPos: number): { start: number; end: number; query: string } | null {
        const before = String(text || "").slice(0, cursorPos);
        const after = String(text || "").slice(cursorPos);
        if (/^[^\s,)]/.test(after)) return null;
        const match = before.match(/(^|[\s,])#([^,]*)$/);
        if (!match) return null;
        if (/[@(]/.test(String(match[2] || ""))) return null;
        const hashIndex = before.length - String(match[2] || "").length - 1;
        if (hashIndex < 0) return null;
        return {
            start: hashIndex,
            end: cursorPos,
            query: String(match[2] || "").trim()
        };
    }

    private getTemplatePlaceholders(text: string): Array<{ name: string; start: number; end: number }> {
        const out: Array<{ name: string; start: number; end: number }> = [];
        const re = /\[([a-z][a-z\s-]*)\]/gi;
        let match: RegExpExecArray | null;
        while ((match = re.exec(text))) {
            out.push({
                name: String(match[1] || "").trim().toLowerCase(),
                start: match.index,
                end: match.index + String(match[0] || "").length
            });
        }
        return out;
    }

    private getActivePlaceholder(text: string, cursorPos: number): { name: string; start: number; end: number } | null {
        const selectionStart = this.input.selectionStart ?? cursorPos;
        const selectionEnd = this.input.selectionEnd ?? cursorPos;
        return this.getTemplatePlaceholders(text).find((item) =>
            (selectionStart <= item.start && selectionEnd >= item.end) ||
            (cursorPos >= item.start && cursorPos <= item.end)
        ) || null;
    }

    private getPlaceholderHint(name: string): "metric" | "entity" | "any" | "tenant" | "category" | "group" | "zone" | "floor" | "layer" {
        const clean = String(name || "").toLowerCase().trim();
        if (clean === "measure" || clean === "metric" || clean === "field" || clean === "kpi") return "metric";
        if (clean === "tenant" || clean === "brand" || clean === "shop" || clean === "store") return "tenant";
        if (clean === "category") return "category";
        if (clean === "group") return "group";
        if (clean === "zone") return "zone";
        if (clean === "floor" || clean === "level") return "floor";
        if (clean === "layer") return "layer";
        return "entity";
    }

    private getPlaceholderAutocompleteLimit(name: string): number {
        const clean = String(name || "").toLowerCase().trim();
        if (clean === "measure" || clean === "metric" || clean === "field" || clean === "kpi") return 200;
        if (clean === "tenant" || clean === "brand" || clean === "shop" || clean === "store") return 1000;
        if (clean === "group" || clean === "category" || clean === "zone" || clean === "floor" || clean === "level" || clean === "layer") return 500;
        return 300;
    }

    private focusNextPlaceholderAndOpen(): boolean {
        const text = String(this.input.value || "");
        const placeholders = this.getTemplatePlaceholders(text);
        if (!placeholders.length) return false;
        const cursor = this.input.selectionEnd ?? 0;
        const next = placeholders.find((item) => item.start >= cursor) || placeholders[0];
        this.input.focus();
        this.input.setSelectionRange(next.start, next.end);
        this.openPlaceholderPicker(next.name, next.start, next.end);
        this.renderInputHighlights();
        return true;
    }

    private stripTemplatePlaceholders(value: string): string {
        return String(value || "")
            .replace(/\[[a-z][a-z\s-]*\]/gi, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    private getAcContextHint(text: string, tokenStart: number): "metric" | "entity" | "any" | "tenant" | "category" | "group" | "zone" | "floor" | "layer" {
        const before = text.slice(0, tokenStart).trim();
        const lastWord = (before.match(/(\w+)\s*$/) || [])[1]?.toLowerCase() || "";
        const activeToken = String(text.slice(tokenStart).match(/^[^\s,]*/)?.[0] || "").toLowerCase();
        if (/^assi/.test(activeToken)) return "any";
        if (activeToken === "top" || activeToken === "bottom") return "any";
        if (lastWord === "by") return /\b(top|bottom|highest|lowest|rank|compare|vs|versus|against|between)\b/i.test(before) ? "metric" : "entity";
        if (lastWord === "of") return /\b(sum|total|average|avg|min|max|earliest|latest|show|display|get|give|create|build)\b/i.test(before) ? "metric" : "entity";
        if (["sum", "total", "average", "avg", "min", "max", "earliest", "latest"].includes(lastWord)) return "metric";
        if (lastWord === "for") {
            return /\b(show|display|get|give|create|build)\b.+\b(area|sqm|m2|size|rent|rental|lease|sales|revenue|turnover|ocr|occupancy|units?|amount|value)\b/i.test(before)
                ? "entity"
                : "metric";
        }
        if (["with", "using", "show", "measure", "metric"].includes(lastWord)) return "metric";
        if (["in", "inside", "within", "under", "from", "on", "at", "excluding", "exclude", "except", "without", "including", "include", "only", "just", "for"].includes(lastWord)) return "entity";
        if (["compare", "vs", "versus", "and", "between", "or"].includes(lastWord)) return "entity";
        return "any";
    }

    private selectAutocompleteItem(item: AssistantAutocompleteItem): void {
        if (item.type === "example") {
            this.input.value = item.label;
            this.selectedTokens = this.findMentionTokensForText(this.input.value);
            this.hideAutocomplete();
            this.input.focus();
            this.focusNextPlaceholderAndOpen();
            this.syncInputViewportToCaret();
            this.renderInputHighlights();
            return;
        }
        const insertLabel = item.type === "function" && item.subtitle && !String(item.id || "").startsWith("bookmark-measures:")
            ? item.subtitle
            : item.label;
        const key = `${item.type}:${item.id}`;
        if (!this.selectedTokens.some((t) => `${t.type}:${t.id}` === key)) {
            this.selectedTokens.push({
                type: item.type,
                id: item.id,
                label: insertLabel,
                indices: item.indices,
                metricKey: item.metricKey,
                fieldName: item.fieldName
            });
        }
        if (this.acTokenRange) {
            const text = String(this.input.value || "");
            let { start, end } = this.acTokenRange;
            if (/^assigned\b/i.test(insertLabel)) {
                const before = text.slice(0, start);
                const assignedMatch = before.match(/(?:^|\s)(assigned)\s*$/i);
                if (assignedMatch?.[1]) start = Math.max(0, start - assignedMatch[1].length - (/\s$/.test(before) ? 1 : 0));
            }
            const closeParen = this.acScopedValueNeedsCloseParen ? ")" : "";
            const afterInsertChar = text[end] || "";
            const trailingSpace = afterInsertChar && afterInsertChar !== " " && afterInsertChar !== ")" ? " " : "";
            this.input.value = text.slice(0, start) + insertLabel + closeParen + trailingSpace + text.slice(end);
            const newCursor = start + insertLabel.length + closeParen.length + trailingSpace.length;
            this.input.setSelectionRange(newCursor, newCursor);
        } else {
            this.input.value = `${String(this.input.value || "").trim()} ${insertLabel}`.trim();
        }
        this.acScopedValuePickerActive = false;
        this.acScopedValueNeedsCloseParen = false;
        this.hideAutocomplete();
        this.syncSelectedTokensToInput();
        this.input.focus();
        this.syncInputViewportToCaret();
        if (!this.focusNextPlaceholderAndOpen()) this.renderInputHighlights();
    }

    private getAcTypeBadge(type: string, id?: string): string {
        if (String(id || "").startsWith("bookmark-measures:")) return "#";
        if (type === "tenant") return "T";
        if (type === "unit") return "U";
        if (type === "metric") return "M";
        if (type === "function") return "fx";
        if (type === "floor") return "F";
        if (type === "category") return "C";
        if (type === "group") return "G";
        if (type === "filter") return "Fl";
        if (type === "zone") return "Z";
        if (type === "layer") return "L";
        if (type === "example") return "?";
        return "•";
    }

    private renderEngineResponse(userQuestion: string, engineQuestion: string, response: AssistantResponse, assistantMessage?: HTMLDivElement, outputHost?: HTMLElement): void {
        const targetMessage = assistantMessage || this.appendMessage("", "assistant");
        const renderArtifacts = () => {
            const prevHost = this.activeOutputHost;
            if (outputHost) this.activeOutputHost = outputHost;
            this.captureLastSubject(response);
            this.captureLastAnalyticQuestion(engineQuestion, response);
            this.captureConversationTurn(userQuestion, engineQuestion, response);
            this.learnAliasesFromResponse(userQuestion, response);
            this.captureLastMatrixContext(response);
            const cleanBaseQ = engineQuestion.replace(/\boffset\s+\d+\b/ig, "").replace(/\s+/g, " ").trim();
            const isBenchmarkResponse = /\b(?:benchmark\s+statistics|percentile\s+(?:90|75|50|25))\s*:?\b/i.test(engineQuestion)
                || this.isBenchmarkResponse(response);
            const currentOffset = Number((/\boffset\s+(\d+)\b/i.exec(engineQuestion) || [])[1] || 0);
            const hasShowMoreSuggestion = (response.suggestions || []).some((item) => /^show\s+more$/i.test(String(item || "").trim()));
            if (response.handled && response.table?.columns?.[0] === "Rank" && !isBenchmarkResponse) {
                this.lastRankTableForBenchmark = {
                    columns: (response.table.columns || []).slice(),
                    rows: (response.table.rows || []).map((row) => row.slice()),
                    question: cleanBaseQ
                };
                this.lastRankBenchmarkContext = response.benchmarkContext || null;
                if (!this.paginationState || this.paginationState.question !== cleanBaseQ) {
                    const rankRows = (response.table?.rows || []).filter((r) => /^\d+$/.test(String(r[0] || "")));
                    this.paginationState = { question: cleanBaseQ, limit: Math.max(1, rankRows.length), offset: currentOffset };
                }
            } else if (response.handled && response.table && hasShowMoreSuggestion && !isBenchmarkResponse) {
                const pageRows = (response.table.rows || []).filter((row) => {
                    const first = String(row[0] || "").trim();
                    return !/^(?:total|shown\s+total|grand\s+total)$/i.test(first);
                });
                this.paginationState = { question: cleanBaseQ, limit: Math.max(1, pageRows.length), offset: currentOffset };
            } else if (response.handled && !this.isBenchmarkResponse(response) && (response.table || response.tables?.length || response.chart)) {
                this.paginationState = null;
            }
            if (response.clarification?.kind === "compare") {
                this.pendingCompareClarification = {
                    ...response.clarification,
                    originalQuestion: userQuestion,
                    originalEngineQuestion: engineQuestion
                };
            } else {
                this.pendingCompareClarification = null;
            }
            const responseHasDataGrid = !!response.table || !!response.tables?.length || !!response.matrix;
            if (!responseHasDataGrid && response.autoSelectIndices && response.autoSelectIndices.length && this.onSelectIndices) {
                this.onSelectIndices(response.autoSelectIndices);
            }
            const visibleActions = this.visibleResponseActions(response);
            if (response.table) {
                this.lastResponseTable = response.table;
                this.appendActionChips(visibleActions, false);
                this.appendTable(response.table.columns, response.table.rows, undefined, response.table.editableQuery);
                (response.tables || []).forEach((table) => this.appendTable(table.columns, table.rows, table.title, table.editableQuery));
                if (response.matrix) this.appendMatrix(response.matrix);
            } else if (response.tables?.length) {
                this.lastResponseTable = response.tables[0];
                if (!this.isBenchmarkResponse(response)) this.lastRankTableForBenchmark = null;
                this.appendActionChips(visibleActions, false);
                response.tables.forEach((table) => this.appendTable(table.columns, table.rows, table.title, table.editableQuery));
                if (response.matrix) this.appendMatrix(response.matrix);
            } else if (response.matrix) {
                this.lastResponseTable = {
                    columns: [response.matrix.rowHeader].concat(response.matrix.columnHeaders),
                    rows: response.matrix.rows.map((row) => [row.label].concat(row.values))
                };
                this.appendActionChips(visibleActions, false);
                this.appendMatrix(response.matrix);
            } else {
                this.appendActionChips(visibleActions, true);
            }
            if (response.chart) {
                this.appendChart(response.chart, response, engineQuestion);
            }
            if (response.kpi) {
                this.appendKpiCard(response.kpi);
            }
            if (!response.matrix || response.clarification) {
                this.appendSuggestionChips(response.suggestions || [], engineQuestion, response.didYouMean, response.clarification, response);
            }
            this.activeOutputHost = prevHost;
        };
        const hasAnswerArtifact = !!response.table || !!response.tables?.length || !!response.matrix || !!response.chart || !!response.kpi;
        if (hasAnswerArtifact) {
            targetMessage.classList.remove("ibx-assistant-msg--typing");
            targetMessage.remove();
            renderArtifacts();
            return;
        }
        this.streamAssistantResponse(targetMessage, response.text, renderArtifacts);
    }

    private clearConversation(): void {
        this.messages.replaceChildren();
        this.conversationTurns = [];
        this.paginationState = null;
        this.lastSubjectLabel = "";
        this.lastAnalyticQuestion = "";
        this.lastResponseTable = null;
        this.lastRankTableForBenchmark = null;
        this.lastRankBenchmarkContext = null;
        this.lastMatrixQuery = null;
        this.lastMatrixTitle = "";
        this.lastMatrixResponse = null;
        this.pendingCompareClarification = null;
        this.activeOutputHost = null;
        this.editingTurnRoot = null;
        this.editingOutputHost = null;
        this.editingUserText = null;
        this.chartMetricOptionsByKey = {};
        this.selectedTokens = [];
        this.renderInputHighlights();
        this.hideAutocomplete();
        this.appendMessage("Ask a question about the fields and measures loaded into this visual. You can request charts, tables, comparisons, rankings, totals, trends, or highest and lowest values.", "assistant");
    }

    private isBenchmarkResponse(response: AssistantResponse): boolean {
        const text = String(response.text || "").toLowerCase();
        return /\bbenchmark statistics\b|\bpercentile\b/.test(text);
    }

    private setOpen(open: boolean): void {
        if (open && !this.open && this.onBeforeOpen) this.onBeforeOpen();
        if (!open && this.savedReportsViewOpen) {
            this.closeSavedReportsView();
        }
        this.open = open;
        this.updateRootFrame();
        if (open) this.positionCompactPanel();
        else this.clearCompactPanelPosition();
        this.panel.style.display = open ? "flex" : "none";
        this.panel.setAttribute("aria-hidden", open ? "false" : "true");
        if (open) {
            if (!this.messages.childElementCount) {
                this.appendMessage("Ask a question about the fields and measures loaded into this visual. You can request charts, tables, comparisons, rankings, totals, trends, or highest and lowest values.", "assistant");
            }
            window.setTimeout(() => this.input.focus(), 0);
        }
    }

    private prepareTurnForQuestion(question: string, tokens: SelectedAssistantToken[] = []): { root: HTMLDivElement; output: HTMLDivElement } {
        if (this.editingTurnRoot && this.editingOutputHost && this.editingUserText) {
            this.editingUserText.textContent = question;
            this.editingOutputHost.replaceChildren();
            this.editingTurnRoot.classList.remove("ibx-assistant-turn--editing");
            const turn = { root: this.editingTurnRoot, output: this.editingOutputHost };
            this.turnSelectedTokens.set(this.editingTurnRoot, this.mergeSelectedTokens(tokens));
            this.editingTurnRoot = null;
            this.editingOutputHost = null;
            this.editingUserText = null;
            this.messages.scrollTop = this.messages.scrollHeight;
            return turn;
        }
        const doc = this.host.ownerDocument || document;
        const root = doc.createElement("div");
        root.className = "ibx-assistant-turn";
        const userRow = doc.createElement("div");
        userRow.className = "ibx-assistant-user-row";
        const bubble = doc.createElement("div");
        bubble.className = "ibx-assistant-msg ibx-assistant-msg--user ibx-assistant-user-bubble";
        const text = doc.createElement("span");
        text.className = "ibx-assistant-user-text";
        text.textContent = question;
        const edit = doc.createElement("button");
        edit.className = "ibx-assistant-edit";
        edit.type = "button";
        edit.textContent = "✎";
        edit.setAttribute("aria-label", "Edit question");
        edit.setAttribute("data-ibx-tip", "Edit question");
        edit.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            this.startEditingTurn(root, output, text);
        });
        const output = doc.createElement("div");
        output.className = "ibx-assistant-turn-output";
        bubble.appendChild(text);
        userRow.appendChild(bubble);
        userRow.appendChild(edit);
        root.appendChild(userRow);
        root.appendChild(output);
        this.turnSelectedTokens.set(root, this.mergeSelectedTokens(tokens));
        this.messages.appendChild(root);
        this.messages.scrollTop = this.messages.scrollHeight;
        return { root, output };
    }

    private startEditingTurn(root: HTMLDivElement, output: HTMLDivElement, text: HTMLSpanElement): void {
        if (this.editingTurnRoot) this.editingTurnRoot.classList.remove("ibx-assistant-turn--editing");
        this.editingTurnRoot = root;
        this.editingOutputHost = output;
        this.editingUserText = text;
        root.classList.add("ibx-assistant-turn--editing");
        this.input.value = String(text.textContent || "");
        this.selectedTokens = this.mergeSelectedTokens(this.turnSelectedTokens.get(root) || []);
        this.input.focus();
        this.input.setSelectionRange(this.input.value.length, this.input.value.length);
        this.hideAutocomplete();
        this.scheduleInputHighlights();
    }

    private findMentionTokensForText(text: string): SelectedAssistantToken[] {
        const clean = String(text || "").trim();
        if (!clean) return [];
        const items: AssistantAutocompleteItem[] = [];
        const seenItems = new Set<string>();
        const addMentionItem = (item: AssistantAutocompleteItem) => {
            const key = `${item.type}:${item.id}`;
            if (seenItems.has(key)) return;
            seenItems.add(key);
            items.push(item);
        };
        this.engine.searchForBookmarkMeasureAutocomplete("", 50)
            .filter((item) => {
                const label = String(item.label || "").trim();
                if (!label) return false;
                return this.sameText(label, clean)
                    || new RegExp(`(^|[\\s,])${this.escapeRegExp(label)}(?=$|[\\s,])`, "i").test(clean);
            })
            .forEach(addMentionItem);
        const hashMatches: string[] = (clean.match(/#[^,\s]+/g) || []) as string[];
        hashMatches.forEach((hashRaw: string) => {
            const hash = String(hashRaw || "").trim();
            if (!hash) return;
            this.engine.searchForBookmarkMeasureAutocomplete(hash.replace(/^#/, ""), 5)
                .filter((item) => this.sameText(item.label, hash))
                .forEach(addMentionItem);
        });
        const scopedValueMatches: string[] = (clean.match(/(?:^|[\s,])([^,()]{2,80})\s*\(([^()]{1,80})\)/g) || []) as string[];
        scopedValueMatches.forEach((matchRaw: string) => {
            const scoped = String(matchRaw || "").trim();
            const match = scoped.match(/^([^,()]{2,80})\s*\(([^()]{1,80})\)$/);
            const field = String(match?.[1] || "").trim();
            const value = String(match?.[2] || "").trim();
            if (!field || !value) return;
            this.engine.searchForFieldValueAutocomplete(field, value, 8)
                .filter((item) => this.sameText(item.label, value))
                .forEach(addMentionItem);
        });
        const words = clean.split(/\s+/).map((word) => word.replace(/^[^\w]+|[^\w]+$/g, "")).filter(Boolean);
        for (let start = 0; start < words.length; start++) {
            for (let size = Math.min(5, words.length - start); size >= 1; size--) {
                const phrase = words.slice(start, start + size).join(" ");
                this.engine.searchForAutocomplete(phrase, 8, "any").forEach((item) => {
                    addMentionItem(item);
                });
            }
        }
        const lowerText = clean.toLowerCase();
        const out: SelectedAssistantToken[] = [];
        const seen = new Set<string>();
        items.forEach((item) => {
            const label = String(item.label || "").trim();
            const key = `${item.type}:${item.id}`;
            if (!label || seen.has(key) || !lowerText.includes(label.toLowerCase())) return;
            seen.add(key);
            out.push({
                type: item.type,
                id: item.id,
                label: item.label,
                indices: item.indices,
                metricKey: item.metricKey
            });
        });
        return out;
    }

    private resolveExactSuggestionTokens(label: string): SelectedAssistantToken[] {
        const clean = String(label || "").trim();
        if (!clean) return [];
        if (/^(compare with|show only|rank by|show in report|export table|yes,\s*show benchmark statistics|show \d+(?:th)? percentile)/i.test(clean)) return [];
        const exact = this.engine.searchForAutocomplete(clean, 20, "any")
            .filter((item) =>
                this.sameText(item.label, clean)
                || this.normalizeSelectedTokenText(item.label || "") === this.normalizeSelectedTokenText(clean)
            );
        const seen = new Set<string>();
        return exact
            .filter((item) => item.type !== "function" && item.type !== "example")
            .map((item): SelectedAssistantToken => ({
                type: item.type,
                id: item.id,
                label: item.label,
                indices: item.indices,
                metricKey: item.metricKey,
                fieldName: item.fieldName
            }))
            .filter((token) => {
                const key = `${token.type}:${token.id}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    }

    private appendHost(): HTMLElement {
        return this.activeOutputHost || this.messages;
    }

    private appendMessage(text: string, role: "user" | "assistant"): HTMLDivElement {
        const doc = this.host.ownerDocument || document;
        const item = doc.createElement("div");
        item.className = `ibx-assistant-msg ibx-assistant-msg--${role}`;
        item.textContent = text;
        this.appendHost().appendChild(item);
        this.messages.scrollTop = this.messages.scrollHeight;
        return item;
    }

    private showTypingIndicator(item: HTMLDivElement): void {
        const doc = this.host.ownerDocument || document;
        item.classList.add("ibx-assistant-msg--typing");
        item.textContent = "";
        const dots = doc.createElement("span");
        dots.className = "ibx-assistant-typing";
        for (let i = 0; i < 3; i++) {
            const dot = doc.createElement("span");
            dots.appendChild(dot);
        }
        item.appendChild(dots);
        this.messages.scrollTop = this.messages.scrollHeight;
    }

    private stripMarkdown(text: string): string {
        return String(text || "")
            .replace(/\*\*(.+?)\*\*/g, "$1")
            .replace(/__(.+?)__/g, "$1")
            .replace(/\*(.+?)\*/g, "$1")
            .replace(/_(.+?)_/g, "$1")
            .replace(/^#{1,6}\s+/gm, "")
            .replace(/^[-*+]\s+/gm, "");
    }

    private streamAssistantResponse(item: HTMLDivElement, text: string, done: () => void): void {
        const seq = ++this.streamSeq;
        const full = this.stripMarkdown(text);
        const maxFrames = Math.min(80, Math.max(16, Math.ceil(full.length / 5)));
        let frame = 0;
        const render = () => {
            if (seq !== this.streamSeq) return;
            frame++;
            const end = frame >= maxFrames ? full.length : Math.min(full.length, Math.ceil((frame / maxFrames) * full.length));
            item.classList.remove("ibx-assistant-msg--typing");
            item.textContent = full.slice(0, end);
            this.messages.scrollTop = this.messages.scrollHeight;
            if (end >= full.length) {
                done();
                return;
            }
            window.setTimeout(render, 12);
        };
        window.setTimeout(render, 180);
    }

    private eventHasAdditiveModifier(ev?: MouseEvent | PointerEvent | KeyboardEvent): boolean {
        if (!ev) return false;
        const anyEv = ev as any;
        return !!(this.additiveSelectionModifierDown || ev.ctrlKey || ev.metaKey || (typeof anyEv.getModifierState === "function" && (anyEv.getModifierState("Control") || anyEv.getModifierState("Meta"))));
    }

    private bindAdditiveSelectionModifierTracking(): void {
        const doc = this.host.ownerDocument || document;
        doc.addEventListener("keydown", (ev: KeyboardEvent) => {
            if (ev.key === "Control" || ev.key === "Meta") this.additiveSelectionModifierDown = true;
        }, true);
        doc.addEventListener("keyup", (ev: KeyboardEvent) => {
            if (ev.key === "Control" || ev.key === "Meta") this.additiveSelectionModifierDown = false;
        }, true);
        window.addEventListener("blur", () => {
            this.additiveSelectionModifierDown = false;
            this.additiveSelectionPointerUntil = 0;
        });
    }

    private rememberAdditiveSelectionPointer(ev?: MouseEvent | PointerEvent | KeyboardEvent): void {
        if (!this.eventHasAdditiveModifier(ev)) return;
        this.additiveSelectionPointerUntil = Date.now() + 900;
    }

    private selectionOptionsFromEvent(ev?: MouseEvent | KeyboardEvent): AssistantDataSelectionOptions | undefined {
        if (this.eventHasAdditiveModifier(ev) || Date.now() <= this.additiveSelectionPointerUntil) {
            this.additiveSelectionPointerUntil = 0;
            return { additive: true };
        }
        return undefined;
    }

    private appendTable(columns: string[], rows: string[][], titleText?: string, editableQuery?: AssistantEditableTableQuery, openEditor: boolean = false, onApplyEdit?: (query: AssistantEditableTableQuery) => void): void {
        const doc = this.host.ownerDocument || document;
        const wrap = doc.createElement("div");
        wrap.className = "ibx-assistant-msg ibx-assistant-msg--assistant ibx-assistant-table-wrap";
        let selectedRowSignature = "";
        let selectedHeaderSignature = "";
        const rowSelectionSignature = (indices: number[] | undefined): string => (indices || [])
            .map((idx) => Number(idx))
            .filter((idx) => Number.isFinite(idx) && idx >= 0)
            .sort((a, b) => a - b)
            .join(",");
        const toggleRowSelection = (indices: number[] | undefined, ev?: MouseEvent | KeyboardEvent) => {
            ev?.preventDefault?.();
            ev?.stopPropagation?.();
            (ev as any)?.stopImmediatePropagation?.();
            const signature = rowSelectionSignature(indices);
            if (!signature || !this.onSelectIndices) return;
            const options = this.selectionOptionsFromEvent(ev);
            if (options?.additive) {
                const hasLocalSelection = !!selectedRowSignature || !!selectedHeaderSignature;
                const nextSelected = selectedRowSignature !== signature;
                selectedRowSignature = nextSelected ? signature : "";
                selectedHeaderSignature = "";
                this.onSelectIndices(indices || [], hasLocalSelection ? options : undefined);
                renderTable();
                return;
            }
            const nextSelected = selectedRowSignature !== signature;
            selectedRowSignature = nextSelected ? signature : "";
            selectedHeaderSignature = "";
            this.onSelectIndices(nextSelected ? (indices || []) : []);
            renderTable();
        };
        const toggleHeaderSelection = (indices: number[] | undefined, ev?: MouseEvent | KeyboardEvent) => {
            ev?.preventDefault?.();
            ev?.stopPropagation?.();
            (ev as any)?.stopImmediatePropagation?.();
            const signature = rowSelectionSignature(indices);
            if (!signature || !this.onSelectIndices) return;
            const options = this.selectionOptionsFromEvent(ev);
            if (options?.additive) {
                const hasLocalSelection = !!selectedRowSignature || !!selectedHeaderSignature;
                const nextSelected = selectedHeaderSignature !== signature;
                selectedHeaderSignature = nextSelected ? signature : "";
                selectedRowSignature = "";
                this.onSelectIndices(indices || [], hasLocalSelection ? options : undefined);
                renderTable();
                return;
            }
            const nextSelected = selectedHeaderSignature !== signature;
            selectedHeaderSignature = nextSelected ? signature : "";
            selectedRowSignature = "";
            this.onSelectIndices(nextSelected ? (indices || []) : []);
            renderTable();
        };
        const isMetricValueTable = (columns || []).length === 2
            && /^metric$/i.test(String(columns[0] || "").trim())
            && /^value$/i.test(String(columns[1] || "").trim());
        const isCompactTwoColumnTable = (columns || []).length === 2;
        if (isMetricValueTable) wrap.classList.add("ibx-assistant-table-wrap--metric-value");
        const dataColumns = Math.max(0, (columns || []).length - 2);
        if (dataColumns <= 1) wrap.classList.add("ibx-assistant-table-wrap--single-metric");
        else if (dataColumns >= 4) wrap.classList.add("ibx-assistant-table-wrap--wide");
        const toolbar = doc.createElement("div");
        toolbar.className = "ibx-assistant-table-toolbar";
        const title = doc.createElement("div");
        title.className = "ibx-assistant-table-title";
        title.textContent = titleText || "Table";
        toolbar.appendChild(title);
        const controls = doc.createElement("div");
        controls.className = "ibx-assistant-matrix-controls";
        const isSavedReportFocusRender = !!this.activeSavedReportRenderContext;
        let renderTable = () => {};
        const hiddenMeasureBarColumns = new Set<string>();
        let comparisonInsightsVisible = false;
        let comparisonInsightBtn: HTMLButtonElement | null = null;
        const effectiveEditableQuery = editableQuery ? this.withTransposedComparisonFilters(editableQuery, columns) : undefined;
        if (!isSavedReportFocusRender) {
            controls.appendChild(this.createPinReportButton(doc, "Save this answer to Saved Reports", () => {
                this.pinTableArtifact(columns, rows, titleText, effectiveEditableQuery);
            }));
        }
        let editPanel: HTMLDivElement | null = null;
        if (effectiveEditableQuery) {
            const effectiveApplyEdit = onApplyEdit || ((next: AssistantEditableTableQuery) => this.replaceEditedTableArtifact(wrap, next));
            if (!isSavedReportFocusRender) {
                const matrixBtn = doc.createElement("button");
                matrixBtn.type = "button";
                matrixBtn.className = "ibx-assistant-matrix-control";
                matrixBtn.textContent = "▦";
                matrixBtn.setAttribute("aria-label", "Show as matrix");
                matrixBtn.setAttribute("data-ibx-tip", "Show as matrix");
                matrixBtn.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    this.switchTableToMatrix(effectiveEditableQuery);
                });
                controls.appendChild(matrixBtn);
            }

            const editBtn = doc.createElement("button");
            editBtn.type = "button";
            editBtn.className = "ibx-assistant-matrix-control";
            editBtn.textContent = "✎";
            editBtn.setAttribute("aria-label", "Edit table fields and measures");
            editBtn.setAttribute("data-ibx-tip", "Edit table fields and measures");
            controls.appendChild(editBtn);
            editPanel = doc.createElement("div");
            editPanel.className = "ibx-assistant-matrix-options";
            editPanel.style.display = openEditor ? "" : "none";
            editPanel.addEventListener("pointerdown", (ev) => ev.stopPropagation());
            editPanel.addEventListener("mousedown", (ev) => ev.stopPropagation());
            editPanel.addEventListener("click", (ev) => ev.stopPropagation());
            editPanel.appendChild(this.createTableEditor(doc, effectiveEditableQuery, effectiveApplyEdit));
            editBtn.classList.toggle("is-active", openEditor);
            editBtn.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (!editPanel) return;
                const open = editPanel.style.display !== "none";
                editPanel.style.display = open ? "none" : "";
                editBtn.classList.toggle("is-active", !open);
            });
        }
        toolbar.appendChild(controls);
        const tableFilters = new Map<number, AssistantColumnFilterState>();
        const filterControls = doc.createElement("div");
        filterControls.className = "ibx-assistant-matrix-controls ibx-assistant-table-filter-controls";
        toolbar.appendChild(filterControls);
        wrap.appendChild(toolbar);
        if (editPanel) wrap.appendChild(editPanel);
        if (columns.length > 4) {
            const hint = doc.createElement("div");
            hint.className = "ibx-assistant-table-scroll-hint";
            hint.textContent = "Scroll sideways for more metrics";
            wrap.appendChild(hint);
        }
        const table = doc.createElement("div");
        table.className = "ibx-assistant-table";
        table.addEventListener("pointerdown", (ev) => this.rememberAdditiveSelectionPointer(ev), true);
        table.addEventListener("mousedown", (ev) => this.rememberAdditiveSelectionPointer(ev), true);
        if (this.activeSavedReportRenderContext) table.classList.add("ibx-assistant-table--column-resizable");
        const columnCount = Math.max(1, columns.length);
        const firstColumnNarrow = /^(rank|sn|#|no\.?|serial)$/i.test(String(columns[0] || "").trim());
        const textLen = (value: string): number => String(value || "").replace(/[^\x00-\xff]/g, "xx").length;
        const maxLenForColumn = (index: number): number => Math.max(
            textLen(columns[index] || ""),
            ...rows.slice(0, 60).map((row) => textLen(row[index] || ""))
        );
        const measuredColumnWidth = (index: number, options: { numeric?: boolean; compact?: boolean; fullscreen?: boolean } = {}): number => {
            const len = maxLenForColumn(index);
            const headerTools = index > 0 ? 38 : 30;
            if (options.compact) return Math.max(92, Math.min(150, 34 + len * 7 + headerTools));
            if (options.numeric) {
                const min = options.fullscreen ? 140 : 126;
                const max = options.fullscreen ? 210 : 190;
                return Math.max(min, Math.min(max, 46 + len * 7 + headerTools));
            }
            const min = index === 0 ? (firstColumnNarrow ? 82 : options.fullscreen ? 180 : 158) : options.fullscreen ? 170 : 130;
            const max = index === 0 ? (options.fullscreen ? 340 : 300) : options.fullscreen ? 360 : 320;
            return Math.max(min, Math.min(max, 42 + len * 7 + headerTools));
        };
        const firstColumnWidth = isCompactTwoColumnTable
            ? measuredColumnWidth(0, { compact: true })
            : firstColumnNarrow ? 82 : measuredColumnWidth(0);
        const isNumericColumnByValues = (index: number): boolean => {
            if (index <= 0) return false;
            const values = rows.filter((row) => !/^total$/i.test(String(row[0] || "").trim())).map((row) => this.parseTableNumber(row[index] || ""));
            const numeric = values.filter((value) => Number.isFinite(value));
            return numeric.length > 0 && numeric.length >= Math.max(1, Math.ceil(values.length * 0.6));
        };
        const columnWidth = (column: string, index: number): string => {
            if (index === 0) return `minmax(${firstColumnWidth}px, ${firstColumnWidth}px)`;
            if (isCompactTwoColumnTable) {
                const px = measuredColumnWidth(index, { compact: true });
                return `minmax(${px}px, ${px}px)`;
            }
            if (this.isBenchmarkColumnName(column)) return "minmax(210px, 260px)";
            if (isNumericColumnByValues(index)) {
                const px = measuredColumnWidth(index, { numeric: true });
                return `minmax(${px}px, ${px}px)`;
            }
            const px = measuredColumnWidth(index);
            return `minmax(${px}px, ${px}px)`;
        };
        const fullscreenColumnWidth = (column: string, index: number): string => {
            if (index === 0) {
                const px = firstColumnNarrow ? 90 : measuredColumnWidth(0, { fullscreen: true });
                return `minmax(${px}px, ${firstColumnNarrow ? "0.45fr" : "1.1fr"})`;
            }
            if (this.isBenchmarkColumnName(column)) return "minmax(220px, 1.2fr)";
            if (isNumericColumnByValues(index)) {
                const px = measuredColumnWidth(index, { numeric: true, fullscreen: true });
                return `minmax(${px}px, 0.7fr)`;
            }
            const px = measuredColumnWidth(index, { fullscreen: true });
            return `minmax(${px}px, 1fr)`;
        };
        const fullscreenColumnPixelWidth = (column: string, index: number): number => {
            if (index === 0) return firstColumnNarrow ? 90 : measuredColumnWidth(0, { fullscreen: true });
            if (this.isBenchmarkColumnName(column)) return 240;
            if (isNumericColumnByValues(index)) return measuredColumnWidth(index, { numeric: true, fullscreen: true });
            return measuredColumnWidth(index, { fullscreen: true });
        };
        const estimatedWidth = columns.reduce((sum, column, index) => {
            if (index === 0) return sum + firstColumnWidth;
            if (isCompactTwoColumnTable) {
                return sum + measuredColumnWidth(index, { compact: true });
            }
            if (this.isBenchmarkColumnName(column)) return sum + 230;
            return sum + (isNumericColumnByValues(index) ? measuredColumnWidth(index, { numeric: true }) : measuredColumnWidth(index));
        }, 0);
        const baseColumnPixelWidths = columns.map((column, index) => {
            if (index === 0) return firstColumnWidth;
            if (isCompactTwoColumnTable) return measuredColumnWidth(index, { compact: true });
            if (this.isBenchmarkColumnName(column)) return 230;
            return isNumericColumnByValues(index) ? measuredColumnWidth(index, { numeric: true }) : measuredColumnWidth(index);
        });
        const savedReportColumnWidths = this.activeSavedReportRenderContext
            ? columns.map((column, index) => this.savedReportColumnWidth(column, index, baseColumnPixelWidths[index]))
            : [];
        const applySavedReportTableWidths = () => {
            if (!this.activeSavedReportRenderContext) return;
            const totalWidth = savedReportColumnWidths.reduce((sum, width) => sum + width, 0);
            const template = savedReportColumnWidths.map((width) => `minmax(${width}px, ${width}px)`).join(" ");
            table.style.setProperty("grid-template-columns", template, "important");
            table.style.setProperty("--ibx-fullscreen-table-columns", template);
            table.style.setProperty("width", `${totalWidth}px`, "important");
            table.style.setProperty("min-width", `${totalWidth}px`, "important");
            wrap.style.setProperty("--ibx-fullscreen-table-width", `${Math.min(1280, Math.max(320, totalWidth + 28))}px`);
        };
        const minimumTableWidth = estimatedWidth;
        const fullscreenNaturalWidth = columns.reduce((sum, column, index) => sum + fullscreenColumnPixelWidth(column, index), 0);
        const fullscreenWrapWidth = Math.max(isCompactTwoColumnTable ? 300 : 460, Math.min(1280, fullscreenNaturalWidth + 28));
        const applyBaseTableSizing = () => {
            table.style.removeProperty("grid-template-columns");
            table.style.removeProperty("width");
            table.style.removeProperty("min-width");
            table.style.setProperty("grid-template-columns", columns.map(columnWidth).join(" "));
            table.style.setProperty("width", `${Math.max(minimumTableWidth, estimatedWidth)}px`);
            table.style.setProperty("min-width", `${Math.max(minimumTableWidth, estimatedWidth)}px`);
            table.style.setProperty("--ibx-fullscreen-table-columns", columns.map(fullscreenColumnWidth).join(" "));
            wrap.style.setProperty("--ibx-fullscreen-table-width", `${fullscreenWrapWidth}px`);
            applySavedReportTableWidths();
        };
        const applyInsightTableSizing = () => {
            const insightWidth = this.root.classList.contains("ibx-assistant--fullscreen") ? 390 : 340;
            const baseWidths = this.activeSavedReportRenderContext ? savedReportColumnWidths : baseColumnPixelWidths;
            const totalWidth = baseWidths.reduce((sum, width) => sum + width, 0) + insightWidth;
            const template = baseWidths.map((width) => `minmax(${width}px, ${width}px)`).concat(`minmax(${insightWidth}px, ${insightWidth}px)`).join(" ");
            table.style.setProperty("grid-template-columns", template, "important");
            table.style.setProperty("--ibx-fullscreen-table-columns", template);
            table.style.setProperty("width", `${totalWidth}px`, "important");
            table.style.setProperty("min-width", `${totalWidth}px`, "important");
            wrap.style.setProperty("--ibx-fullscreen-table-width", `${Math.min(1280, Math.max(460, totalWidth + 28))}px`);
        };
        applyBaseTableSizing();
        let sortState: { column: number; dir: "asc" | "desc" } | null = null;
        const isTotalRow = (row: string[]) => {
            const first = String(row[0] || "").trim();
            const second = String(row[1] || "").trim();
            return /^total$/i.test(first) || (!first && /^total$/i.test(second));
        };
        const isOtherSummaryRow = (row: string[]) => {
            const first = String(row[0] || "").trim();
            const second = String(row[1] || "").trim();
            return /^others\s*\(/i.test(first) || (!first && /^others\s*\(/i.test(second));
        };
        const isGroupHeaderRow = (row: string[]) => {
            const first = String(row[0] || "").trim();
            if (!first || /^(?:total|grand\s+total|others\s*\()/i.test(first)) return false;
            return (row || []).slice(1).every((value) => !String(value || "").trim());
        };
        const isSummaryRow = (row: string[]) => isTotalRow(row) || isOtherSummaryRow(row);
        const isNumericColumn = (index: number, sourceRows: string[][]): boolean => {
            if (index <= 0) return false;
            const values = sourceRows.filter((row) => !isSummaryRow(row)).map((row) => this.parseTableNumber(row[index] || ""));
            const numeric = values.filter((value) => Number.isFinite(value));
            return numeric.length > 0 && numeric.length >= Math.max(1, Math.ceil(values.length * 0.6));
        };
        const numericColumns = new Set(columns.map((_, index) => index).filter((index) => isNumericColumn(index, rows)));
        const measureBarColumnKey = (column: string, index: number): string => `${index}:${String(column || "").trim().toLowerCase()}`;
        numericColumns.forEach((index) => hiddenMeasureBarColumns.add(measureBarColumnKey(columns[index], index)));
        const isLowerBetterColumn = (index: number): boolean => {
            const label = String(columns[index] || "").toLowerCase();
            const configured = this.engine.metricLowerIsBetter(label);
            if (configured !== null) return configured;
            return /\b(ocr|occupancy cost|cost ratio|rent to sales|rent sales ratio|vacancy|vacant|expense|cost)\b/.test(label);
        };
        const canShowComparisonInsights = columns.length === 3
            && /^metric$/i.test(String(columns[0] || "").trim())
            && numericColumns.has(1)
            && numericColumns.has(2);
        if (canShowComparisonInsights) {
            comparisonInsightBtn = doc.createElement("button");
            comparisonInsightBtn.type = "button";
            comparisonInsightBtn.className = "ibx-assistant-matrix-control ibx-assistant-comparison-insight-toggle";
            comparisonInsightBtn.appendChild(this.createInsightIcon(doc));
            comparisonInsightBtn.setAttribute("aria-label", "Show comparison insights");
            comparisonInsightBtn.setAttribute("data-ibx-tip", "Show comparison insights");
            comparisonInsightBtn.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                comparisonInsightsVisible = !comparisonInsightsVisible;
                comparisonInsightBtn?.classList.toggle("ibx-assistant-matrix-control--active", comparisonInsightsVisible);
                comparisonInsightBtn?.setAttribute("aria-label", `${comparisonInsightsVisible ? "Hide" : "Show"} comparison insights`);
                comparisonInsightBtn?.setAttribute("data-ibx-tip", `${comparisonInsightsVisible ? "Hide" : "Show"} comparison insights`);
                renderTable();
            });
            controls.appendChild(comparisonInsightBtn);
        }
        const syncFilterControls = (filterValues: string[][]) => {
            filterControls.replaceChildren();
            const hasActiveFilters = columns.some((_, index) => this.isFilterActive(tableFilters.get(index), filterValues[index] || []));
            if (!hasActiveFilters) return;
            const clearFilters = doc.createElement("button");
            clearFilters.type = "button";
            clearFilters.className = "ibx-assistant-matrix-toolbar-btn";
            clearFilters.textContent = "Clear filters";
            clearFilters.setAttribute("data-ibx-tip", "Remove all table filters");
            clearFilters.addEventListener("click", (ev) => {
                ev.preventDefault();
                tableFilters.clear();
                renderTable();
            });
            filterControls.appendChild(clearFilters);
        };
        renderTable = () => {
            table.replaceChildren();
            const filterSourceRows = rows.filter((row) => !isSummaryRow(row) && !isGroupHeaderRow(row));
            const filterValues = columns.map((_, index) => this.uniqueFilterValues(filterSourceRows, index));
            const hasActiveFilters = columns.some((_, index) => this.isFilterActive(tableFilters.get(index), filterValues[index] || []));
            syncFilterControls(filterValues);
            const passesFilters = (row: string[]) => columns.every((_, index) => this.cellPassesFilter(row[index] || "", tableFilters.get(index)));
            const normalRows = filterSourceRows.filter(passesFilters);
            const otherRows = rows.filter(isOtherSummaryRow).filter(passesFilters);
            const originalTotalRows = rows.filter(isTotalRow);
            const buildFilteredTotalRow = (): string[] => {
                const original = originalTotalRows[0] || [];
                return columns.map((_, index) => {
                    if (index === 0) return String(original[0] || "Total");
                    if (!numericColumns.has(index)) return "-";
                    const total = normalRows.reduce((sum, row) => {
                        const value = this.parseTableNumber(row[index] || "");
                        return Number.isFinite(value) ? sum + value : sum;
                    }, 0);
                    return this.formatTableNumber(total);
                });
            };
            const totalRows = originalTotalRows.length
                ? (hasActiveFilters ? [buildFilteredTotalRow()] : originalTotalRows)
                : [];
            const filteredRows = normalRows.concat(otherRows, totalRows);
            const displayRows = sortState
                ? normalRows.slice().sort((a, b) => {
                    if (numericColumns.has(sortState!.column)) {
                        const av = this.parseTableNumber(a[sortState!.column] || "");
                        const bv = this.parseTableNumber(b[sortState!.column] || "");
                        const ar = Number.isFinite(av) ? av : (sortState!.dir === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
                        const br = Number.isFinite(bv) ? bv : (sortState!.dir === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
                        return sortState!.dir === "asc" ? ar - br : br - ar;
                    }
                    const av = String(a[sortState!.column] || "");
                    const bv = String(b[sortState!.column] || "");
                    const text = av.localeCompare(bv, undefined, { sensitivity: "base", numeric: true });
                    return sortState!.dir === "asc" ? text : -text;
                }).concat(otherRows, totalRows)
                : rows.filter((row) => isGroupHeaderRow(row) || passesFilters(row));
            const stats = this.getTableColumnStats(displayRows.filter((row) => !isSummaryRow(row)), columnCount);
            const isTwoItemTransposedComparison = columns.length === 3
                && /^metric$/i.test(String(columns[0] || "").trim())
                && numericColumns.has(1)
                && numericColumns.has(2);
            const showInsightColumn = comparisonInsightsVisible && isTwoItemTransposedComparison;
            if (showInsightColumn) applyInsightTableSizing();
            else applyBaseTableSizing();
            const metricRowComparison = (row: string[]): {
                stat: { min: number; max: number; count: number };
                bestColumn: number;
                worstColumn: number;
                deltaByColumn: Map<number, string>;
                insight: string;
            } | null => {
                if (!isTwoItemTransposedComparison || isSummaryRow(row) || isGroupHeaderRow(row)) return null;
                const left = this.parseTableNumber(row[1] || "");
                const right = this.parseTableNumber(row[2] || "");
                if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
                const metricName = String(row[0] || "").trim();
                const configuredLowerBetter = this.engine.metricLowerIsBetter(metricName);
                const lowerBetter = configuredLowerBetter !== null
                    ? configuredLowerBetter
                    : /\b(ocr|occupancy cost|cost ratio|rent to sales|rent sales ratio|vacancy|vacant|expense|cost)\b/i.test(metricName);
                const bestColumn = left === right
                    ? 0
                    : lowerBetter
                        ? (left < right ? 1 : 2)
                        : (left > right ? 1 : 2);
                const worstColumn = bestColumn === 1 ? 2 : 1;
                const bestValue = bestColumn === 1 ? left : right;
                const otherValue = bestColumn === 1 ? right : left;
                const rawDiff = bestValue - otherValue;
                const deltaLabel = this.formatComparisonDelta(rawDiff, otherValue, metricName);
                const deltaByColumn = new Map<number, string>();
                if (deltaLabel) deltaByColumn.set(bestColumn, deltaLabel);
                const insight = this.buildComparisonInsight(
                    metricName,
                    String(columns[1] || "").trim(),
                    String(columns[2] || "").trim(),
                    row[1] || "",
                    row[2] || ""
                );
                return {
                    stat: { min: Math.min(left, right), max: Math.max(left, right), count: 2 },
                    bestColumn,
                    worstColumn,
                    deltaByColumn,
                    insight
                };
            };
            columns.forEach((column, index) => {
                const cell = doc.createElement("div");
                const sortable = true;
                const isBenchmarkColumn = this.isBenchmarkColumnName(column);
                const isMeasureColumn = numericColumns.has(index) && !isBenchmarkColumn;
                cell.className = `ibx-assistant-table-cell ibx-assistant-table-head${index === 0 ? " ibx-assistant-table-name ibx-assistant-table-sticky" : ""}${isMeasureColumn && !isBenchmarkColumn ? " ibx-assistant-table__num" : ""}${isBenchmarkColumn ? " ibx-assistant-table-benchmark-col" : ""}${sortable ? " ibx-assistant-table-sortable" : ""}${!isMeasureColumn ? " ibx-assistant-table-sortable--text" : ""}`;
                if (sortable) {
                    const label = doc.createElement("span");
                    label.className = `ibx-assistant-table-sort-label${index === 0 ? " ibx-assistant-table-sort-label--row-header" : ""}`;
                    label.textContent = column;
                    const icon = doc.createElement("span");
                    icon.className = `ibx-assistant-table-sort-icon${sortState?.column === index ? " ibx-assistant-table-sort-icon--active" : ""}`;
                    icon.textContent = sortState?.column === index ? (sortState.dir === "asc" ? "▲" : "▼") : "↕";
                    const tools = doc.createElement("span");
                    tools.className = "ibx-assistant-table-head-tools";
                    const toggle = () => {
                        sortState = sortState?.column === index
                            ? { column: index, dir: sortState.dir === "asc" ? "desc" : "asc" }
                            : { column: index, dir: "desc" };
                        renderTable();
                    };
                    icon.setAttribute("role", "button");
                    icon.setAttribute("tabindex", "0");
                    icon.setAttribute("aria-label", `Sort by ${column}`);
                    icon.setAttribute("data-ibx-tip", `Sort by ${column}`);
                    icon.addEventListener("click", (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        toggle();
                    });
                    icon.addEventListener("keydown", (ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                            ev.preventDefault();
                            ev.stopPropagation();
                            toggle();
                        }
                    });
                    tools.appendChild(icon);
                    if (isMeasureColumn) {
                        const barKey = measureBarColumnKey(column, index);
                        const barsOn = !hiddenMeasureBarColumns.has(barKey);
                        const barBtn = doc.createElement("button");
                        barBtn.type = "button";
                        barBtn.className = `ibx-assistant-table-bar-toggle${barsOn ? " ibx-assistant-table-bar-toggle--active" : ""}`;
                        barBtn.appendChild(this.createMeasureBarsIcon(doc));
                        barBtn.setAttribute("aria-label", `${barsOn ? "Hide" : "Show"} bars for ${column}`);
                        barBtn.setAttribute("data-ibx-tip", `${barsOn ? "Hide" : "Show"} bars for ${column}`);
                        barBtn.addEventListener("click", (ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            if (hiddenMeasureBarColumns.has(barKey)) hiddenMeasureBarColumns.delete(barKey);
                            else hiddenMeasureBarColumns.add(barKey);
                            renderTable();
                        });
                        tools.appendChild(barBtn);
                    }
                    const activeFilter = this.isFilterActive(tableFilters.get(index), filterValues[index] || []);
                    const filterBtn = doc.createElement("button");
                    filterBtn.type = "button";
                    filterBtn.className = `ibx-assistant-table-filter-btn${activeFilter ? " ibx-assistant-table-filter-btn--active" : ""}`;
                    filterBtn.appendChild(this.createFilterIcon(doc));
                    filterBtn.setAttribute("aria-label", `Filter ${column}`);
                    filterBtn.setAttribute("data-ibx-tip", `Filter ${column}`);
                    filterBtn.addEventListener("click", (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        this.openColumnFilterPopover(doc, cell, column, filterValues[index] || [], tableFilters.get(index), (next) => {
                            if (next) tableFilters.set(index, next);
                            else tableFilters.delete(index);
                            renderTable();
                        });
                    });
                    tools.appendChild(filterBtn);
                    cell.appendChild(label);
                    cell.appendChild(tools);
                } else {
                    cell.textContent = column;
                }
                if (sortable) {
                    cell.setAttribute("aria-label", column);
                }
                table.appendChild(cell);
            });
            if (showInsightColumn) {
                const insightHead = doc.createElement("div");
                insightHead.className = "ibx-assistant-table-cell ibx-assistant-table-head ibx-assistant-table-insight-head";
                insightHead.textContent = "Insight";
                table.appendChild(insightHead);
            }
            displayRows.forEach((row) => {
                const total = isTotalRow(row);
                const summary = isSummaryRow(row);
                const groupHeader = isGroupHeaderRow(row);
                if (groupHeader) {
                    const section = doc.createElement("div");
                    const label = String(row[0] || "").trim();
                    section.className = "ibx-assistant-table-cell ibx-assistant-table-group-section";
                    section.style.gridColumn = "1 / -1";
                    section.textContent = label;
                    section.setAttribute("data-ibx-tip", label);
                    table.appendChild(section);
                    return;
                }
                const rowComparison = metricRowComparison(row);
                const rowAction = !summary && this.onSelectIndices
                    ? columns.map((_, index) => this.engine.resolveTableCellAction(columns, row, index)).find((action) => !!action?.indices?.length) || null
                    : null;
                const selectableRow = !!rowAction?.indices?.length;
                const selectedRow = selectableRow && rowSelectionSignature(rowAction?.indices) === selectedRowSignature;
                columns.forEach((_, index) => {
                    const cell = doc.createElement("div");
                    const text = row[index] || "";
                    const isBenchmarkColumn = this.isBenchmarkColumnName(columns[index]);
                    const isPercentageColumn = /%|percent|percentage/i.test(String(columns[index] || ""));
                    const value = this.parseTableNumber(row[index] || "");
                    const stat = rowComparison && index > 0 ? rowComparison.stat : stats[index];
                    const allowHighlight = !isPercentageColumn;
                    const isHigh = allowHighlight && !total && index > 0 && stat && stat.count > 1 && Number.isFinite(value) && value === stat.max && stat.max !== stat.min;
                    const isLow = allowHighlight && !total && index > 0 && stat && stat.count > 1 && Number.isFinite(value) && value === stat.min && stat.max !== stat.min;
                    const invertColor = isLowerBetterColumn(index);
                    const good = isTwoItemTransposedComparison ? false : invertColor ? isLow : isHigh;
                    const bad = isTwoItemTransposedComparison ? false : invertColor ? isHigh : isLow;
                    const isMeasureColumn = numericColumns.has(index) && !isBenchmarkColumn;
                    const barPercent = !hiddenMeasureBarColumns.has(measureBarColumnKey(columns[index], index)) && !summary && !groupHeader && isMeasureColumn ? this.measureBarPercent(value, stat) : 0;
                    const barTone = isTwoItemTransposedComparison ? "neutral" : good ? "good" : bad ? "bad" : "neutral";
                    const comparisonDelta = rowComparison?.deltaByColumn.get(index) || "";
                    cell.className = `ibx-assistant-table-cell${index === 0 ? " ibx-assistant-table-name ibx-assistant-table-sticky" : ""}${isMeasureColumn ? " ibx-assistant-table__num" : ""}${isBenchmarkColumn ? " ibx-assistant-table-benchmark-col" : ""}${good && !groupHeader ? " ibx-assistant-table-high" : ""}${bad && !groupHeader ? " ibx-assistant-table-low" : ""}${total ? " ibx-assistant-table-total" : ""}${groupHeader ? " ibx-assistant-table-group-row" : ""}${selectableRow ? " ibx-assistant-table-row-selectable" : ""}${selectedRow ? " ibx-assistant-table-row-selected" : ""}`;
                    if (barPercent > 0) this.appendMeasureBar(doc, cell, text, barPercent, barTone, comparisonDelta);
                    if (selectableRow) {
                        cell.setAttribute("role", "button");
                        cell.setAttribute("tabindex", "0");
                        cell.setAttribute("aria-pressed", selectedRow ? "true" : "false");
                        cell.addEventListener("click", (ev) => toggleRowSelection(rowAction?.indices, ev));
                        cell.addEventListener("keydown", (ev) => {
                            if (ev.key === "Enter" || ev.key === " ") {
                                ev.preventDefault();
                                toggleRowSelection(rowAction?.indices, ev);
                            }
                        });
                    }
                    const action = !summary && this.onSelectIndices ? this.engine.resolveTableCellAction(columns, row, index) : null;
                    if (action?.indices?.length) {
                        const btn = doc.createElement("button");
                        btn.className = "ibx-assistant-table-link";
                        btn.type = "button";
                        btn.textContent = text;
                        btn.setAttribute("aria-label", action.label);
                        btn.setAttribute("data-ibx-tip", action.label);
                        btn.addEventListener("click", (ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            toggleRowSelection(action.indices, ev);
                        });
                        cell.appendChild(btn);
                    } else if (isBenchmarkColumn && this.appendBenchmarkCellContent(doc, cell, text)) {
                        // content appended
                    } else if (barPercent <= 0) {
                        if (comparisonDelta) this.appendMeasureValue(doc, cell, text, comparisonDelta);
                        else cell.textContent = text;
                    }
                    cell.setAttribute("data-ibx-tip", text);
                    table.appendChild(cell);
                });
                if (showInsightColumn) {
                    const insight = rowComparison?.insight || "";
                    const insightCell = doc.createElement("div");
                    insightCell.className = `ibx-assistant-table-cell ibx-assistant-table-insight-cell${total ? " ibx-assistant-table-total" : ""}${selectableRow ? " ibx-assistant-table-row-selectable" : ""}${selectedRow ? " ibx-assistant-table-row-selected" : ""}`;
                    insightCell.textContent = total || summary ? "" : insight;
                    if (insight) insightCell.setAttribute("data-ibx-tip", insight);
                    if (selectableRow) {
                        insightCell.setAttribute("role", "button");
                        insightCell.setAttribute("tabindex", "0");
                        insightCell.setAttribute("aria-pressed", selectedRow ? "true" : "false");
                        insightCell.addEventListener("click", (ev) => toggleRowSelection(rowAction?.indices, ev));
                        insightCell.addEventListener("keydown", (ev) => {
                            if (ev.key === "Enter" || ev.key === " ") {
                                ev.preventDefault();
                                toggleRowSelection(rowAction?.indices, ev);
                            }
                        });
                    }
                    table.appendChild(insightCell);
                }
            });
            if (!showInsightColumn) {
                this.attachSavedReportColumnResizeOverlay(doc, wrap, table, columns, savedReportColumnWidths, baseColumnPixelWidths, applySavedReportTableWidths);
            }
        };
        renderTable();
        wrap.appendChild(table);
        this.appendHost().appendChild(wrap);
        this.messages.scrollTop = this.messages.scrollHeight;
    }

    private createTableEditor(doc: Document, query: AssistantEditableTableQuery, onApply?: (query: AssistantEditableTableQuery) => void): HTMLElement {
        let draftFields = (query.fields || []).map((value) => String(value || "").trim()).filter(Boolean);
        let draftMeasures = (query.measures || []).map((value) => String(value || "").trim()).filter(Boolean);
        const preservedFilters = (query.filters || []).filter((token) => token && token.type && token.id && token.label);
        const fieldOptions = Array.from(new Set((query.fieldOptions || []).map((value) => String(value || "").trim()).filter(Boolean)));
        const measureOptions = Array.from(new Set((query.measureOptions || []).map((value) => String(value || "").trim()).filter(Boolean)));
        const wrap = doc.createElement("div");
        wrap.className = "ibx-assistant-matrix-editor ibx-assistant-table-editor";
        const sectionsHost = doc.createElement("div");
        sectionsHost.className = "ibx-assistant-matrix-editor-sections";
        const sameOrderedValues = (left: string[], right: string[]): boolean => {
            const cleanLeft = (left || []).map((value) => String(value || "").trim()).filter(Boolean);
            const cleanRight = (right || []).map((value) => String(value || "").trim()).filter(Boolean);
            return cleanLeft.length === cleanRight.length && cleanLeft.every((value, index) => this.sameText(value, cleanRight[index]));
        };
        const hasDraftChanges = (): boolean => {
            return !sameOrderedValues(draftFields, query.fields || []) || !sameOrderedValues(draftMeasures, query.measures || []);
        };
        const closeEditorPanel = () => {
            const panel = wrap.parentElement as HTMLElement | null;
            if (!panel?.classList.contains("ibx-assistant-matrix-options")) return;
            panel.style.display = "none";
            panel.parentElement?.querySelectorAll(".ibx-assistant-matrix-control--active, .is-active")
                .forEach((node) => node.classList.remove("ibx-assistant-matrix-control--active", "is-active"));
        };
        const selectedTokenForField = (field: string): SelectedAssistantToken => {
            const label = String(field || "").trim();
            const normalized = this.normalizeSelectedTokenText(label);
            return { type: "filter", id: `filter-field:${normalized || label}`, label };
        };
        const selectedTokenForMeasure = (measure: string): SelectedAssistantToken => {
            const label = String(measure || "").trim();
            const normalized = this.normalizeSelectedTokenText(label);
            return { type: "metric", id: `metric:${normalized || label}`, label, metricKey: normalized || label };
        };
        const moveValue = (values: string[], value: string, direction: -1 | 1): string[] => {
            const current = values.slice();
            const index = current.findIndex((item) => this.sameText(item, value));
            const target = index + direction;
            if (index < 0 || target < 0 || target >= current.length) return current;
            const [item] = current.splice(index, 1);
            current.splice(target, 0, item);
            return current;
        };
        type TableEditorAxis = "fields" | "measures";
        let draggedTableChip: { axis: TableEditorAxis; value: string } | null = null;
        const moveDraggedTableChip = (targetAxis: TableEditorAxis, currentValues: string[], beforeValue: string | null, onChange: (next: string[]) => void) => {
            const dragged = draggedTableChip;
            if (!dragged || dragged.axis !== targetAxis || !dragged.value) return;
            const next = currentValues.filter((item) => !this.sameText(item, dragged.value));
            const insertAt = beforeValue ? next.findIndex((item) => this.sameText(item, beforeValue)) : -1;
            if (insertAt >= 0) next.splice(insertAt, 0, dragged.value);
            else next.push(dragged.value);
            onChange(next);
        };
        const makeSection = (
            titleText: string,
            axis: TableEditorAxis,
            values: string[],
            emptyText: string,
            options: string[],
            onChange: (next: string[]) => void
        ) => {
            const section = doc.createElement("div");
            section.className = "ibx-assistant-matrix-editor-section";
            const title = doc.createElement("div");
            title.className = "ibx-assistant-matrix-editor-title";
            title.textContent = titleText;
            section.appendChild(title);
            const body = doc.createElement("div");
            body.className = "ibx-assistant-matrix-editor-body";
            const row = doc.createElement("div");
            row.className = "ibx-assistant-matrix-editor-row";
            const current = values.filter(Boolean);
            row.addEventListener("dragover", (ev) => {
                if (draggedTableChip?.axis !== axis) return;
                ev.preventDefault();
                row.classList.add("ibx-assistant-matrix-editor-row--drop");
            });
            row.addEventListener("dragleave", () => row.classList.remove("ibx-assistant-matrix-editor-row--drop"));
            row.addEventListener("drop", (ev) => {
                if (draggedTableChip?.axis !== axis) return;
                ev.preventDefault();
                row.classList.remove("ibx-assistant-matrix-editor-row--drop");
                moveDraggedTableChip(axis, current, null, onChange);
            });
            if (!current.length) {
                const empty = doc.createElement("span");
                empty.className = "ibx-assistant-matrix-pill ibx-assistant-matrix-pill--empty";
                empty.textContent = emptyText;
                row.appendChild(empty);
            } else {
                current.forEach((value, index) => {
                    const chip = doc.createElement("span");
                    chip.className = "ibx-assistant-matrix-pill ibx-assistant-matrix-pill--selected";
                    chip.draggable = true;
                    chip.setAttribute("data-ibx-tip", `Drag ${value}`);
                    const handle = doc.createElement("span");
                    handle.className = "ibx-assistant-matrix-drag-handle";
                    handle.textContent = "⋮⋮";
                    handle.setAttribute("aria-hidden", "true");
                    chip.appendChild(handle);
                    const label = doc.createElement("span");
                    label.className = "ibx-assistant-matrix-pill-label";
                    label.textContent = value;
                    chip.appendChild(label);
                    chip.addEventListener("dragstart", (ev) => {
                        draggedTableChip = { axis, value };
                        chip.classList.add("ibx-assistant-matrix-pill--dragging");
                        ev.dataTransfer?.setData("text/plain", value);
                        if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
                    });
                    chip.addEventListener("dragend", () => {
                        draggedTableChip = null;
                        chip.classList.remove("ibx-assistant-matrix-pill--dragging");
                    });
                    chip.addEventListener("dragover", (ev) => {
                        if (draggedTableChip?.axis !== axis || this.sameText(draggedTableChip.value, value)) return;
                        ev.preventDefault();
                        ev.stopPropagation();
                        chip.classList.add("ibx-assistant-matrix-pill--drop-before");
                    });
                    chip.addEventListener("dragleave", () => chip.classList.remove("ibx-assistant-matrix-pill--drop-before"));
                    chip.addEventListener("drop", (ev) => {
                        if (draggedTableChip?.axis !== axis) return;
                        ev.preventDefault();
                        ev.stopPropagation();
                        chip.classList.remove("ibx-assistant-matrix-pill--drop-before");
                        moveDraggedTableChip(axis, current, value, onChange);
                    });
                    const addSmallButton = (text: string, tip: string, disabled: boolean, handler: () => void) => {
                        const btn = doc.createElement("button");
                        btn.type = "button";
                        btn.className = "ibx-assistant-matrix-pill-btn";
                        btn.textContent = text;
                        btn.disabled = disabled;
                        btn.setAttribute("aria-label", tip);
                        btn.setAttribute("data-ibx-tip", tip);
                        btn.addEventListener("click", (ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            if (!disabled) handler();
                        });
                        chip.appendChild(btn);
                    };
                    addSmallButton("↑", `Move ${value} left`, index <= 0, () => onChange(moveValue(current, value, -1)));
                    addSmallButton("↓", `Move ${value} right`, index >= current.length - 1, () => onChange(moveValue(current, value, 1)));
                    addSmallButton("×", `Remove ${value}`, false, () => onChange(current.filter((item) => !this.sameText(item, value))));
                    row.appendChild(chip);
                });
            }
            body.appendChild(row);
            const addRow = doc.createElement("div");
            addRow.className = "ibx-assistant-matrix-add-row";
            const searchableOptions = options.length > 6;
            if (searchableOptions) {
                const picker = doc.createElement("div");
                picker.className = "ibx-assistant-matrix-add-picker";
                const button = doc.createElement("button");
                button.type = "button";
                button.className = "ibx-assistant-matrix-add-trigger";
                const addLabel = `+ Add ${titleText.toLowerCase().replace(/s$/, "")}`;
                button.textContent = addLabel;
                button.setAttribute("aria-label", addLabel);
                const menu = doc.createElement("div");
                menu.className = "ibx-assistant-matrix-add-menu";
                menu.style.display = "none";
                const searchInput = doc.createElement("input");
                searchInput.type = "search";
                searchInput.className = "ibx-assistant-matrix-add-search";
                searchInput.placeholder = `Search ${titleText.toLowerCase()}...`;
                searchInput.setAttribute("aria-label", `Search ${titleText.toLowerCase()}`);
                const list = doc.createElement("div");
                list.className = "ibx-assistant-matrix-add-list";
                const availableOptions = () => options
                    .filter((option) => !current.some((value) => this.sameText(value, option)));
                const renderList = () => {
                    const cleanQuery = this.normalizeSelectedTokenText(searchInput.value || "");
                    list.replaceChildren();
                    const matches = availableOptions()
                    .filter((option) => {
                        if (!cleanQuery) return true;
                        const cleanOption = this.normalizeSelectedTokenText(option);
                        return cleanOption.indexOf(cleanQuery) >= 0;
                    })
                        .slice(0, cleanQuery ? 60 : 250);
                    if (!matches.length) {
                        const empty = doc.createElement("div");
                        empty.className = "ibx-assistant-matrix-add-empty";
                        empty.textContent = `No ${titleText.toLowerCase()} found`;
                        list.appendChild(empty);
                        return;
                    }
                    matches.forEach((option) => {
                        const item = doc.createElement("button");
                        item.type = "button";
                        item.className = "ibx-assistant-matrix-add-option";
                    item.textContent = option;
                        item.addEventListener("click", (ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            onChange(current.concat(option));
                        });
                        list.appendChild(item);
                    });
                };
                searchInput.addEventListener("input", renderList);
                button.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const open = menu.style.display !== "none";
                    menu.style.display = open ? "none" : "";
                    button.classList.toggle("is-open", !open);
                    if (!open) {
                        searchInput.value = "";
                        renderList();
                        window.setTimeout(() => searchInput.focus(), 0);
                    }
                });
                menu.addEventListener("pointerdown", (ev) => ev.stopPropagation());
                menu.addEventListener("mousedown", (ev) => ev.stopPropagation());
                menu.addEventListener("click", (ev) => ev.stopPropagation());
                menu.appendChild(searchInput);
                menu.appendChild(list);
                picker.appendChild(button);
                picker.appendChild(menu);
                addRow.appendChild(picker);
            } else {
                const select = doc.createElement("select");
                select.className = "ibx-assistant-matrix-add-select";
                const placeholder = doc.createElement("option");
                placeholder.value = "";
                placeholder.textContent = `+ Add ${titleText.toLowerCase().replace(/s$/, "")}`;
                select.appendChild(placeholder);
                options
                    .filter((option) => !current.some((value) => this.sameText(value, option)))
                    .forEach((option) => {
                        const item = doc.createElement("option");
                        item.value = option;
                        item.textContent = option;
                        select.appendChild(item);
                    });
                select.addEventListener("change", () => {
                    const value = select.value;
                    if (!value) return;
                    onChange(current.concat(value));
                    select.value = "";
                });
                addRow.appendChild(select);
            }
            body.appendChild(addRow);
            section.appendChild(body);
            return section;
        };
        const renderSections = () => {
            sectionsHost.replaceChildren();
            sectionsHost.appendChild(makeSection("Columns", "fields", draftFields, "No table column", fieldOptions, (next) => {
                draftFields = Array.from(new Set(next.map((value) => String(value || "").trim()).filter(Boolean)));
                renderSections();
            }));
            sectionsHost.appendChild(makeSection("Measures", "measures", draftMeasures, "No measure", measureOptions, (next) => {
                draftMeasures = Array.from(new Set(next.map((value) => String(value || "").trim()).filter(Boolean)));
                renderSections();
            }));
        };
        renderSections();
        wrap.appendChild(sectionsHost);
        const actions = doc.createElement("div");
        actions.className = "ibx-assistant-matrix-editor-actions";
        const addAction = (label: string, handler: () => void, primary = false) => {
            const btn = doc.createElement("button");
            btn.type = "button";
            btn.className = primary ? "ibx-assistant-action ibx-assistant-action--primary" : "ibx-assistant-action";
            btn.textContent = label;
            btn.addEventListener("click", (ev) => {
                ev.preventDefault();
                handler();
            });
            actions.appendChild(btn);
        };
        addAction("Apply", () => {
            const fields = draftFields.filter(Boolean);
            const measures = draftMeasures.filter(Boolean);
            if (!fields.length && !measures.length) return;
            if (!hasDraftChanges()) {
                closeEditorPanel();
                return;
            }
            if (onApply) {
                onApply({
                    fields,
                    measures,
                    filters: preservedFilters,
                    fieldOptions: query.fieldOptions || [],
                    measureOptions: query.measureOptions || []
                });
                closeEditorPanel();
                return;
            }
            const tokens = ([] as SelectedAssistantToken[])
                .concat(preservedFilters)
                .concat(fields.map(selectedTokenForField))
                .concat(measures.map(selectedTokenForMeasure))
                .concat([{ type: "function", id: "output:table", label: "Table" } as SelectedAssistantToken]);
            const measureText = measures.length ? measures.join(" and ") : "details";
            const fieldText = fields.length ? ` by ${fields.join(" and ")}` : "";
            const filterText = preservedFilters.length ? ` for ${preservedFilters.map((token) => token.label).join(" and ")}` : "";
            this.input.value = `show ${measureText}${fieldText}${filterText} in table`;
            this.selectedTokens = this.mergeSelectedTokens(tokens);
            this.renderInputHighlights();
            closeEditorPanel();
            this.submitQuestion();
        }, true);
        addAction("Cancel", () => {
            draftFields = (query.fields || []).slice();
            draftMeasures = (query.measures || []).slice();
            renderSections();
            closeEditorPanel();
        });
        wrap.appendChild(actions);
        return wrap;
    }

    private appendMatrix(matrix: NonNullable<AssistantResponse["matrix"]>, openEditor: boolean = false, onApplyEdit?: (query: MatrixQuery) => void): void {
        const doc = this.host.ownerDocument || document;
        const wrap = doc.createElement("div");
        wrap.className = "ibx-assistant-msg ibx-assistant-msg--assistant ibx-assistant-table-wrap ibx-assistant-matrix-wrap";
        let selectedRowSignature = "";
        const rowSelectionSignature = (indices: number[] | undefined): string => (indices || [])
            .map((idx) => Number(idx))
            .filter((idx) => Number.isFinite(idx) && idx >= 0)
            .sort((a, b) => a - b)
            .join(",");
        const toggleMatrixRowSelection = (indices: number[] | undefined, ev?: MouseEvent | KeyboardEvent) => {
            ev?.preventDefault?.();
            ev?.stopPropagation?.();
            (ev as any)?.stopImmediatePropagation?.();
            const signature = rowSelectionSignature(indices);
            if (!signature || !this.onSelectIndices) return;
            const options = this.selectionOptionsFromEvent(ev);
            if (options?.additive) {
                const hasLocalSelection = !!selectedRowSignature;
                const nextSelected = selectedRowSignature !== signature;
                selectedRowSignature = nextSelected ? signature : "";
                this.onSelectIndices(indices || [], hasLocalSelection ? options : undefined);
                renderMatrix();
                return;
            }
            const nextSelected = selectedRowSignature !== signature;
            selectedRowSignature = nextSelected ? signature : "";
            this.onSelectIndices(nextSelected ? (indices || []) : []);
            renderMatrix();
        };

        const expandableRowKeys = (matrix.rows || [])
            .filter((row) => row.hasChildren)
            .map((row) => row.key);
        const expandedRows = { ...(matrix.query?.expandedRows || {}) };
        const collapsed = new Set<string>(
            expandableRowKeys.filter((key) => !expandedRows[key])
        );
        const syncExpandedRows = () => {
            const next: { [key: string]: boolean } = {};
            expandableRowKeys.forEach((key) => {
                next[key] = !collapsed.has(key);
            });
            if (matrix.query) {
                matrix.query.expandedRows = next;
                this.lastMatrixQuery = cloneMatrixQuery(matrix.query);
            }
        };
        type MatrixColumnMeta = NonNullable<NonNullable<AssistantResponse["matrix"]>["columns"]>[number];
        const matrixColumns: MatrixColumnMeta[] = (matrix.columns?.length
            ? matrix.columns
            : (matrix.columnHeaders || []).map((label, index) => ({
                key: `col:${index}`,
                label,
                level: 0,
                hasChildren: false,
                isTotal: /grand\s+total/i.test(label)
            } as MatrixColumnMeta)));
        const collapsedColumns = new Set<string>(
            matrixColumns
                .filter((column) => column.hasChildren && (column.level || 0) === 0)
                .map((column) => column.key)
        );
        let renderMatrix = () => {};
        const isNonZeroText = (value: string): boolean => {
            const parsed = this.parseTableNumber(value || "");
            return Number.isFinite(parsed) && Math.abs(parsed) > 0;
        };
        const grandTotalColumnIndex = (): number => {
            const found = matrixColumns.findIndex((column) => column.isTotal || /grand\s+total/i.test(column.label || ""));
            return found >= 0 ? found : Math.max(0, matrixColumns.length - 1);
        };
        let sortState: { column: number; dir: "asc" | "desc" } | null = matrix.query?.sort ? { column: grandTotalColumnIndex() + 1, dir: matrix.query.sort.direction } : null;
        let rowLimit: number | null = matrix.query?.topN || null;
        let hideZeros = !!matrix.query?.hideZeros;
        let editPanel: HTMLElement | null = null;
        let appendVisibleMatrixAsTable = () => {
            if (matrix.query) this.switchMatrixToTable(matrix.query);
        };
        const matrixFilters = new Map<number, AssistantColumnFilterState>();
        const toolbar = doc.createElement("div");
        toolbar.className = "ibx-assistant-table-toolbar";
        const title = doc.createElement("div");
        title.className = "ibx-assistant-table-title";
        title.textContent = this.formatMatrixCardTitle(matrix);
        toolbar.appendChild(title);
        const controls = doc.createElement("div");
        controls.className = "ibx-assistant-matrix-controls";
        const addControl = (label: string, tip: string, handler: (button: HTMLButtonElement) => void, compact = false) => {
            const btn = doc.createElement("button");
            btn.type = "button";
            btn.className = compact ? "ibx-assistant-matrix-control" : "ibx-assistant-matrix-toolbar-btn";
            btn.textContent = label;
            btn.setAttribute("aria-label", tip);
            btn.setAttribute("data-ibx-tip", tip);
            btn.addEventListener("click", (ev) => {
                ev.preventDefault();
                handler(btn);
            });
            controls.appendChild(btn);
            return btn;
        };
        let clearMatrixFiltersButton: HTMLButtonElement | null = null;
        let editButton: HTMLButtonElement | null = null;
        const isSavedReportFocusRender = !!this.activeSavedReportRenderContext;
        const hiddenMatrixMeasureBarColumns = new Set<string>();
        if (matrix.query) {
            if (!isSavedReportFocusRender) {
                controls.appendChild(this.createPinReportButton(doc, "Save this matrix to Saved Reports", () => this.pinMatrixReport(matrix)));
                addControl("▤", "Show as table", () => {
                    appendVisibleMatrixAsTable();
                }, true);
            }
            clearMatrixFiltersButton = addControl("Clear filters", "Remove all matrix filters", () => {
                matrixFilters.clear();
                renderMatrix();
            });
            clearMatrixFiltersButton.style.display = "none";
            editButton = addControl("✎", "Edit matrix layout", (button) => {
                if (!editPanel) return;
                const isOpen = editPanel.style.display !== "none";
                editPanel.style.display = isOpen ? "none" : "";
                button.classList.toggle("ibx-assistant-matrix-control--active", !isOpen);
            }, true);
        }
        toolbar.appendChild(controls);
        wrap.appendChild(toolbar);

        if (matrix.query) {
            const effectiveApplyEdit = onApplyEdit || ((next: MatrixQuery) => this.replaceEditedMatrixArtifact(wrap, next));
            editPanel = doc.createElement("div");
            editPanel.className = "ibx-assistant-matrix-options";
            editPanel.addEventListener("pointerdown", (ev) => ev.stopPropagation());
            editPanel.addEventListener("mousedown", (ev) => ev.stopPropagation());
            editPanel.addEventListener("click", (ev) => ev.stopPropagation());
            if ((matrix.rows || []).some((row) => row.hasChildren)) {
                const hierarchyActions = doc.createElement("div");
                hierarchyActions.className = "ibx-assistant-matrix-editor-actions";
                const addHierarchyAction = (label: string, handler: () => void) => {
                    const btn = doc.createElement("button");
                    btn.type = "button";
                    btn.className = "ibx-assistant-action";
                    btn.textContent = label;
                    btn.addEventListener("click", (ev) => {
                        ev.preventDefault();
                        handler();
                    });
                    hierarchyActions.appendChild(btn);
                };
                addHierarchyAction("Expand all", () => {
                    collapsed.clear();
                    syncExpandedRows();
                    renderMatrix();
                });
                addHierarchyAction("Collapse all", () => {
                    (matrix.rows || [])
                        .filter((row) => row.hasChildren)
                        .forEach((row) => collapsed.add(row.key));
                    syncExpandedRows();
                    renderMatrix();
                });
                editPanel.appendChild(hierarchyActions);
            }
            editPanel.appendChild(this.createMatrixEditor(doc, matrix, effectiveApplyEdit));
            editPanel.style.display = openEditor ? "" : "none";
            editButton?.classList.toggle("ibx-assistant-matrix-control--active", openEditor);
            wrap.appendChild(editPanel);
        }

        const table = doc.createElement("div");
        table.className = "ibx-assistant-table ibx-assistant-matrix";
        table.addEventListener("pointerdown", (ev) => this.rememberAdditiveSelectionPointer(ev), true);
        table.addEventListener("mousedown", (ev) => this.rememberAdditiveSelectionPointer(ev), true);
        if (this.activeSavedReportRenderContext) table.classList.add("ibx-assistant-table--column-resizable");
        const matrixRows = matrix.rows || [];
        const childRows = new Map<string, NonNullable<AssistantResponse["matrix"]>["rows"]>();
        matrixRows.forEach((row) => {
            if (!row.parentKey) return;
            const list = childRows.get(row.parentKey) || [];
            list.push(row);
            childRows.set(row.parentKey, list);
        });
        const childColumns = new Map<string, MatrixColumnMeta[]>();
        matrixColumns.forEach((column) => {
            if (!column.parentKey) return;
            const list = childColumns.get(column.parentKey) || [];
            list.push(column);
            childColumns.set(column.parentKey, list);
        });
        const sortRows = (rows: NonNullable<AssistantResponse["matrix"]>["rows"]): NonNullable<AssistantResponse["matrix"]>["rows"] => {
            if (!sortState) return rows.slice();
            return rows.slice().sort((a, b) => {
                if (a.isTotal || b.isTotal) return a.isTotal === b.isTotal ? 0 : a.isTotal ? 1 : -1;
                if (sortState!.column === 0) {
                    const labelSort = String(a.label || "").localeCompare(String(b.label || ""), undefined, { sensitivity: "base", numeric: true });
                    return sortState!.dir === "asc" ? labelSort : -labelSort;
                }
                const av = this.parseTableNumber(a.values[sortState!.column - 1] || "");
                const bv = this.parseTableNumber(b.values[sortState!.column - 1] || "");
                const ar = Number.isFinite(av) ? av : (sortState!.dir === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
                const br = Number.isFinite(bv) ? bv : (sortState!.dir === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
                const numeric = sortState!.dir === "asc" ? ar - br : br - ar;
                return numeric || String(a.label || "").localeCompare(String(b.label || ""), undefined, { sensitivity: "base", numeric: true });
            });
        };
        const visibleRows = (): NonNullable<AssistantResponse["matrix"]>["rows"] => {
            const out: NonNullable<AssistantResponse["matrix"]>["rows"] = [];
            const walk = (rows: NonNullable<AssistantResponse["matrix"]>["rows"]) => {
                sortRows(rows).forEach((row) => {
                    if (hideZeros && !row.isTotal && !row.hasChildren && !(row.values || []).some(isNonZeroText)) return;
                    out.push(row);
                    if (row.hasChildren && !collapsed.has(row.key)) {
                        walk(childRows.get(row.key) || []);
                    }
                });
            };
            walk(matrixRows.filter((row) => !row.parentKey && !row.isTotal));
            const limited = rowLimit ? out.slice(0, rowLimit) : out;
            matrixRows.filter((row) => row.isTotal).forEach((row) => limited.push(row));
            return limited;
        };
        const visibleColumns = (): MatrixColumnMeta[] => {
            const out: MatrixColumnMeta[] = [];
            const walk = (cols: MatrixColumnMeta[]) => {
                cols.forEach((column) => {
                    const originalIndex = matrixColumns.findIndex((candidate) => candidate.key === column.key);
                    if (hideZeros && !column.isTotal && !column.hasChildren && originalIndex >= 0 && !(matrix.rows || []).some((row) => !row.isTotal && isNonZeroText(row.values[originalIndex] || ""))) return;
                    out.push(column);
                    if (column.hasChildren && !collapsedColumns.has(column.key)) {
                        walk(childColumns.get(column.key) || []);
                    }
                });
            };
            walk(matrixColumns.filter((column) => !column.parentKey && !column.isTotal));
            matrixColumns.filter((column) => column.isTotal).forEach((column) => out.push(column));
            return out;
        };
        const createMatrixToggleIcon = (): SVGSVGElement => {
            const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("viewBox", "0 0 16 16");
            svg.setAttribute("aria-hidden", "true");
            const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", "M6 4l4 4-4 4");
            svg.appendChild(path);
            return svg;
        };
        const matrixTableEditableQuery = (): AssistantEditableTableQuery | undefined => {
            if (!matrix.query) return undefined;
            const fields = (matrix.query.rows || []).concat(matrix.query.columns || [])
                .map((field) => String(field || "").trim())
                .filter(Boolean);
            const measures = (matrix.query.values || [])
                .map((measure) => String(measure || "").trim())
                .filter(Boolean);
            if (!fields.length && !measures.length) return undefined;
            return {
                fields,
                measures: measures.length ? measures : [matrix.metricName].filter(Boolean),
                fieldOptions: matrix.fieldOptions?.rows || [],
                measureOptions: matrix.fieldOptions?.values || []
            };
        };
        const currentMatrixTableSnapshot = (): { columns: string[]; rows: string[][] } => {
            const visibleCols = visibleColumns();
            const sourceRows = visibleRows();
            const rowValues = (row: typeof matrixRows[number]): string[] => [row.label].concat(visibleCols.map((colMeta) => {
                const colIndex = matrixColumns.findIndex((column) => column.key === colMeta.key);
                return colIndex >= 0 ? row.values[colIndex] || "" : "";
            }));
            const filteredRows = sourceRows.filter((row) => row.isTotal || rowValues(row).every((value, index) => this.cellPassesFilter(value, matrixFilters.get(index))));
            const rebuildTotal = (totalRow: typeof matrixRows[number]): string[] => {
                const filteredNormalRows = filteredRows.filter((row) => !row.isTotal);
                const topLevelRows = filteredNormalRows.filter((row) => !row.parentKey);
                const rowsForTotal = topLevelRows.length ? topLevelRows : filteredNormalRows;
                const values = visibleCols.map((colMeta) => {
                    const colIndex = matrixColumns.findIndex((column) => column.key === colMeta.key);
                    if (colIndex < 0) return "";
                    const total = rowsForTotal.reduce((sum, row) => {
                        const value = this.parseTableNumber(row.values[colIndex] || "");
                        return Number.isFinite(value) ? sum + value : sum;
                    }, 0);
                    return this.formatTableNumber(total);
                });
                return [totalRow.label || "Grand Total"].concat(values);
            };
            return {
                columns: [matrix.rowHeader].concat(visibleCols.map((column) => column.label)),
                rows: filteredRows.map((row) => row.isTotal ? rebuildTotal(row) : rowValues(row))
            };
        };
        appendVisibleMatrixAsTable = () => {
            const snapshot = currentMatrixTableSnapshot();
            if (!snapshot.columns.length || !snapshot.rows.length) {
                if (matrix.query) this.switchMatrixToTable(matrix.query);
                return;
            }
            this.appendTable(snapshot.columns, snapshot.rows, "Table", matrixTableEditableQuery());
        };

        const render = () => {
            table.replaceChildren();
            const visibleCols = visibleColumns();
            const sourceRows = visibleRows();
            const filterRows = sourceRows
                .filter((row) => !row.isTotal)
                .map((row) => [row.label].concat(visibleCols.map((colMeta) => {
                    const colIndex = matrixColumns.findIndex((column) => column.key === colMeta.key);
                    return row.values[colIndex] || "";
                })));
            const filterValues = [matrix.rowHeader].concat(visibleCols.map((column) => column.label))
                .map((_, index) => this.uniqueFilterValues(filterRows, index));
            const hasActiveFilters = filterValues.some((values, index) => this.isFilterActive(matrixFilters.get(index), values));
            if (clearMatrixFiltersButton) {
                clearMatrixFiltersButton.style.display = hasActiveFilters ? "" : "none";
            }
            const filteredRows = sourceRows.filter((row) => {
                if (row.isTotal) return true;
                const values = [row.label].concat(visibleCols.map((colMeta) => {
                    const colIndex = matrixColumns.findIndex((column) => column.key === colMeta.key);
                    return row.values[colIndex] || "";
                }));
                return values.every((value, index) => this.cellPassesFilter(value, matrixFilters.get(index)));
            });
            const rebuildFilteredMatrixTotal = (totalRow: typeof matrixRows[number]): typeof totalRow => {
                const filteredNormalRows = filteredRows.filter((row) => !row.isTotal);
                const topLevelRows = filteredNormalRows.filter((row) => !row.parentKey);
                const rowsForTotal = topLevelRows.length ? topLevelRows : filteredNormalRows;
                const values = (totalRow.values || []).slice();
                visibleCols.forEach((colMeta) => {
                    const colIndex = matrixColumns.findIndex((column) => column.key === colMeta.key);
                    if (colIndex < 0) return;
                    const total = rowsForTotal.reduce((sum, row) => {
                        const value = this.parseTableNumber(row.values[colIndex] || "");
                        return Number.isFinite(value) ? sum + value : sum;
                    }, 0);
                    values[colIndex] = this.formatTableNumber(total);
                });
                return { ...totalRow, values };
            };
            const visibleColumnStats = visibleCols.map((colMeta) => {
                const colIndex = matrixColumns.findIndex((column) => column.key === colMeta.key);
                if (colIndex < 0) return null;
                const values = filteredRows
                    .filter((row) => !row.isTotal)
                    .map((row) => this.parseTableNumber(row.values[colIndex] || ""))
                    .filter((value) => Number.isFinite(value));
                if (!values.length) return null;
                return { min: Math.min(...values), max: Math.max(...values), count: values.length };
            });
            const columns = [matrix.rowHeader].concat(visibleCols.map((column) => column.label));
            const firstColWidth = visibleCols.length <= 2 ? 270 : 240;
            const valueColWidth = visibleCols.length <= 2 ? 150 : 118;
            const baseMatrixColumnWidths = columns.map((_, index) => index === 0 ? firstColWidth : valueColWidth);
            const matrixMeasureBarColumnKey = (column: string, index: number): string => `${index}:${String(column || "").trim().toLowerCase()}`;
            const matrixColumnWidths = this.activeSavedReportRenderContext
                ? columns.map((column, index) => this.savedReportColumnWidth(column, index, baseMatrixColumnWidths[index]))
                : [];
            const applySavedReportMatrixWidths = () => {
                if (!this.activeSavedReportRenderContext) return;
                const totalWidth = matrixColumnWidths.reduce((sum, width) => sum + width, 0);
                table.style.setProperty("grid-template-columns", matrixColumnWidths.map((width) => `minmax(${width}px, ${width}px)`).join(" "), "important");
                table.style.setProperty("min-width", `${totalWidth}px`, "important");
                table.style.setProperty("width", `${totalWidth}px`, "important");
                wrap.style.setProperty("--ibx-fullscreen-table-width", `${Math.min(1280, Math.max(360, totalWidth + 28))}px`);
            };
            table.style.gridTemplateColumns = `minmax(220px, ${firstColWidth}px) repeat(${Math.max(1, visibleCols.length)}, minmax(96px, ${valueColWidth}px))`;
            const naturalMatrixWidth = firstColWidth + Math.max(1, visibleCols.length) * valueColWidth;
            table.style.minWidth = `${naturalMatrixWidth}px`;
            wrap.style.setProperty("--ibx-fullscreen-table-width", `${Math.min(1280, Math.max(360, naturalMatrixWidth + 28))}px`);
            applySavedReportMatrixWidths();
            columns.forEach((column, index) => {
                const cell = doc.createElement("div");
                const sortable = true;
                cell.className = `ibx-assistant-table-cell ibx-assistant-table-head${index === 0 ? " ibx-assistant-table-name ibx-assistant-table-sticky" : " ibx-assistant-table__num"}${sortable ? " ibx-assistant-table-sortable" : ""}${index === 0 ? " ibx-assistant-table-sortable--text" : ""}`;
                if (sortable) {
                    const colMeta = visibleCols[index - 1];
                    if (index > 0 && colMeta) cell.style.setProperty("--ibx-matrix-level", String(colMeta.level || 0));
                    if (index > 0 && colMeta?.hasChildren) {
                        const toggle = doc.createElement("button");
                        toggle.type = "button";
                        toggle.className = "ibx-assistant-matrix-toggle ibx-assistant-matrix-toggle--column";
                        if (!collapsedColumns.has(colMeta.key)) toggle.classList.add("ibx-assistant-matrix-toggle--open");
                        toggle.appendChild(createMatrixToggleIcon());
                        toggle.setAttribute("aria-label", `${collapsedColumns.has(colMeta.key) ? "Expand" : "Collapse"} ${colMeta.label}`);
                        toggle.addEventListener("click", (ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            if (collapsedColumns.has(colMeta.key)) collapsedColumns.delete(colMeta.key);
                            else collapsedColumns.add(colMeta.key);
                            render();
                        });
                        cell.appendChild(toggle);
                    }
                    const label = doc.createElement("span");
                    label.className = "ibx-assistant-table-sort-label";
                    label.textContent = column;
                    const icon = doc.createElement("span");
                    icon.className = `ibx-assistant-table-sort-icon${sortState?.column === index ? " ibx-assistant-table-sort-icon--active" : ""}`;
                    icon.textContent = sortState?.column === index ? (sortState.dir === "asc" ? "▲" : "▼") : "↕";
                    const tools = doc.createElement("span");
                    tools.className = "ibx-assistant-table-head-tools";
                    tools.appendChild(icon);
                    if (index > 0) {
                        const barKey = matrixMeasureBarColumnKey(column, index);
                        const barsOn = !hiddenMatrixMeasureBarColumns.has(barKey);
                        const barBtn = doc.createElement("button");
                        barBtn.type = "button";
                        barBtn.className = `ibx-assistant-table-bar-toggle${barsOn ? " ibx-assistant-table-bar-toggle--active" : ""}`;
                        barBtn.appendChild(this.createMeasureBarsIcon(doc));
                        barBtn.setAttribute("aria-label", `${barsOn ? "Hide" : "Show"} bars for ${column}`);
                        barBtn.setAttribute("data-ibx-tip", `${barsOn ? "Hide" : "Show"} bars for ${column}`);
                        barBtn.addEventListener("click", (ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            if (hiddenMatrixMeasureBarColumns.has(barKey)) hiddenMatrixMeasureBarColumns.delete(barKey);
                            else hiddenMatrixMeasureBarColumns.add(barKey);
                            render();
                        });
                        tools.appendChild(barBtn);
                    }
                    const activeFilter = this.isFilterActive(matrixFilters.get(index), filterValues[index] || []);
                    const filterBtn = doc.createElement("button");
                    filterBtn.type = "button";
                    filterBtn.className = `ibx-assistant-table-filter-btn${activeFilter ? " ibx-assistant-table-filter-btn--active" : ""}`;
                    filterBtn.appendChild(this.createFilterIcon(doc));
                    filterBtn.setAttribute("aria-label", `Filter ${column}`);
                    filterBtn.setAttribute("data-ibx-tip", `Filter ${column}`);
                    filterBtn.addEventListener("click", (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        this.openColumnFilterPopover(doc, cell, column, filterValues[index] || [], matrixFilters.get(index), (next) => {
                            if (next) matrixFilters.set(index, next);
                            else matrixFilters.delete(index);
                            render();
                        });
                    });
                    tools.appendChild(filterBtn);
                    cell.appendChild(label);
                    cell.appendChild(tools);
                    cell.setAttribute("role", "button");
                    cell.setAttribute("tabindex", "0");
                    cell.setAttribute("aria-label", `Sort by ${column}`);
                    const toggleSort = () => {
                        sortState = sortState?.column === index
                            ? { column: index, dir: sortState.dir === "asc" ? "desc" : "asc" }
                            : { column: index, dir: index === 0 ? "asc" : "desc" };
                        render();
                    };
                    cell.addEventListener("click", toggleSort);
                    cell.addEventListener("keydown", (ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                            ev.preventDefault();
                            toggleSort();
                        }
                    });
                }
                cell.setAttribute("data-ibx-tip", column);
                table.appendChild(cell);
            });
            filteredRows.forEach((row) => {
                if (hasActiveFilters && row.isTotal) row = rebuildFilteredMatrixTotal(row);
                const rowIsSubtotal = !!row.hasChildren && !collapsed.has(row.key);
                const rowIsTotal = !!row.isTotal;
                const selectableRow = !rowIsTotal && !!this.onSelectIndices && !!row.indices?.length;
                const selectedRow = selectableRow && rowSelectionSignature(row.indices) === selectedRowSignature;
                const labelCell = doc.createElement("div");
                labelCell.className = `ibx-assistant-table-cell ibx-assistant-table-name ibx-assistant-table-sticky ibx-assistant-matrix-row-label${selectableRow ? " ibx-assistant-table-row-selectable" : ""}${selectedRow ? " ibx-assistant-table-row-selected" : ""}`;
                if (row.hasChildren) labelCell.classList.add("ibx-assistant-matrix-row-label--parent");
                if (row.hasChildren && collapsed.has(row.key)) labelCell.classList.add("ibx-assistant-matrix-row-label--collapsed");
                if (rowIsSubtotal) labelCell.classList.add("ibx-assistant-matrix-subtotal");
                if (rowIsTotal) labelCell.classList.add("ibx-assistant-matrix-grand-total");
                labelCell.style.setProperty("--ibx-matrix-level", String(row.level || 0));
                if (selectableRow) {
                    labelCell.setAttribute("role", "button");
                    labelCell.setAttribute("tabindex", "0");
                    labelCell.setAttribute("aria-pressed", selectedRow ? "true" : "false");
                    labelCell.addEventListener("click", (ev) => toggleMatrixRowSelection(row.indices, ev));
                    labelCell.addEventListener("keydown", (ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                            ev.preventDefault();
                            toggleMatrixRowSelection(row.indices, ev);
                        }
                    });
                }
                if (row.hasChildren) {
                    const toggle = doc.createElement("button");
                    toggle.type = "button";
                    toggle.className = "ibx-assistant-matrix-toggle";
                    if (!collapsed.has(row.key)) toggle.classList.add("ibx-assistant-matrix-toggle--open");
                    toggle.appendChild(createMatrixToggleIcon());
                    toggle.setAttribute("aria-label", `${collapsed.has(row.key) ? "Expand" : "Collapse"} ${row.label}`);
                    toggle.addEventListener("click", (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        if (collapsed.has(row.key)) collapsed.delete(row.key);
                        else collapsed.add(row.key);
                        syncExpandedRows();
                        render();
                    });
                    labelCell.appendChild(toggle);
                } else if (!rowIsTotal) {
                    const spacer = doc.createElement("span");
                    spacer.className = "ibx-assistant-matrix-spacer";
                    labelCell.appendChild(spacer);
                }
                const label = doc.createElement("span");
                label.className = "ibx-assistant-matrix-label-text";
                label.textContent = row.label;
                labelCell.appendChild(label);
                labelCell.setAttribute("data-ibx-tip", row.label);
                table.appendChild(labelCell);
                visibleCols.forEach((colMeta) => {
                    const colIndex = matrixColumns.findIndex((column) => column.key === colMeta.key);
                    const value = row.values[colIndex] || "";
                    const numericValue = this.parseTableNumber(value);
                    const colVisibleIndex = visibleCols.findIndex((column) => column.key === colMeta.key);
                    const stat = visibleColumnStats[colVisibleIndex] || null;
                    const isHigh = !rowIsTotal && stat && stat.count > 1 && Number.isFinite(numericValue) && numericValue === stat.max && stat.max !== stat.min;
                    const isLow = !rowIsTotal && stat && stat.count > 1 && Number.isFinite(numericValue) && numericValue === stat.min && stat.max !== stat.min;
                    const configuredLowerBetter = this.engine.metricLowerIsBetter(colMeta.label);
                    const lowerBetter = configuredLowerBetter !== null
                        ? configuredLowerBetter
                        : /\b(ocr|occupancy cost|cost ratio|rent to sales|rent sales ratio|vacancy|vacant|expense|cost)\b/i.test(colMeta.label || "");
                    const good = lowerBetter ? isLow : isHigh;
                    const bad = lowerBetter ? isHigh : isLow;
                    const barPercent = !hiddenMatrixMeasureBarColumns.has(matrixMeasureBarColumnKey(colMeta.label, colVisibleIndex + 1)) && !rowIsTotal ? this.measureBarPercent(numericValue, stat) : 0;
                    const barTone = good ? "good" : bad ? "bad" : "neutral";
                    const cell = doc.createElement("div");
                    cell.className = `ibx-assistant-table-cell ibx-assistant-table__num${good ? " ibx-assistant-table-high" : ""}${bad ? " ibx-assistant-table-low" : ""}${selectableRow ? " ibx-assistant-table-row-selectable" : ""}${selectedRow ? " ibx-assistant-table-row-selected" : ""}`;
                    if (rowIsSubtotal) cell.classList.add("ibx-assistant-matrix-subtotal");
                    if (rowIsTotal) cell.classList.add("ibx-assistant-matrix-grand-total");
                    if (selectableRow) {
                        cell.setAttribute("role", "button");
                        cell.setAttribute("tabindex", "0");
                        cell.setAttribute("aria-pressed", selectedRow ? "true" : "false");
                        cell.addEventListener("click", (ev) => toggleMatrixRowSelection(row.indices, ev));
                        cell.addEventListener("keydown", (ev) => {
                            if (ev.key === "Enter" || ev.key === " ") {
                                ev.preventDefault();
                                toggleMatrixRowSelection(row.indices, ev);
                            }
                        });
                    }
                    if (barPercent > 0) this.appendMeasureBar(doc, cell, value, barPercent, barTone);
                    else cell.textContent = value;
                    cell.setAttribute("data-ibx-tip", value);
                    table.appendChild(cell);
                });
            });
            this.attachSavedReportColumnResizeOverlay(doc, wrap, table, columns, matrixColumnWidths, baseMatrixColumnWidths, applySavedReportMatrixWidths);
        };
        renderMatrix = render;
        render();
        wrap.appendChild(table);
        this.appendHost().appendChild(wrap);
        this.messages.scrollTop = this.messages.scrollHeight;
    }

    private createMatrixEditor(doc: Document, matrix: NonNullable<AssistantResponse["matrix"]>, onApply?: (query: MatrixQuery) => void): HTMLElement {
        const originalQuery = cloneMatrixQuery(matrix.query!);
        let draftQuery = cloneMatrixQuery(originalQuery);
        const wrap = doc.createElement("div");
        wrap.className = "ibx-assistant-matrix-editor";
        const sectionsHost = doc.createElement("div");
        sectionsHost.className = "ibx-assistant-matrix-editor-sections";
        const sameOrderedValues = (left: string[] | undefined, right: string[] | undefined): boolean => {
            const cleanLeft = (left || []).map((value) => String(value || "").trim()).filter(Boolean);
            const cleanRight = (right || []).map((value) => String(value || "").trim()).filter(Boolean);
            return cleanLeft.length === cleanRight.length && cleanLeft.every((value, index) => this.sameText(value, cleanRight[index]));
        };
        const hasDraftChanges = (): boolean => {
            return !sameOrderedValues(draftQuery.rows, originalQuery.rows)
                || !sameOrderedValues(draftQuery.columns, originalQuery.columns)
                || !sameOrderedValues(draftQuery.values, originalQuery.values);
        };
        const closeEditorPanel = () => {
            const panel = wrap.parentElement as HTMLElement | null;
            if (!panel?.classList.contains("ibx-assistant-matrix-options")) return;
            panel.style.display = "none";
            panel.parentElement?.querySelectorAll(".ibx-assistant-matrix-control--active, .is-active")
                .forEach((node) => node.classList.remove("ibx-assistant-matrix-control--active", "is-active"));
        };

        const updateDraft = (next: MatrixQuery) => {
            draftQuery = cloneMatrixQuery(next);
            renderSections();
        };
        const moveValue = (axis: "rows" | "columns" | "values", value: string, direction: -1 | 1) => {
            const current = (draftQuery[axis] || []).slice();
            const index = current.findIndex((item) => this.sameText(item, value));
            const target = index + direction;
            if (index < 0 || target < 0 || target >= current.length) return;
            const [item] = current.splice(index, 1);
            current.splice(target, 0, item);
            updateDraft({ ...draftQuery, [axis]: current });
        };
        const removeDraftField = (axis: "rows" | "columns" | "values", field: string) => {
            const current = (draftQuery[axis] || []).filter((value) => !this.sameText(value, field));
            updateDraft({ ...draftQuery, [axis]: current });
        };
        type MatrixEditorAxis = "rows" | "columns" | "values";
        let draggedMatrixChip: { axis: MatrixEditorAxis; value: string } | null = null;
        const matrixAxisValues = (query: MatrixQuery, axis: MatrixEditorAxis): string[] => {
            return ((axis === "rows" ? query.rows : axis === "columns" ? query.columns : query.values) || []).slice();
        };
        const setMatrixAxisValues = (query: MatrixQuery, axis: MatrixEditorAxis, values: string[]): MatrixQuery => {
            return axis === "rows"
                ? { ...query, rows: values }
                : axis === "columns"
                ? { ...query, columns: values }
                : { ...query, values };
        };
        const canDropMatrixChip = (targetAxis: MatrixEditorAxis, value: string): boolean => {
            const dragged = draggedMatrixChip;
            if (!dragged || !value) return false;
            if (dragged.axis === "values" || targetAxis === "values") {
                return dragged.axis === "values" && targetAxis === "values";
            }
            if (targetAxis === "columns" && matrix.fieldOptions?.columns?.length) {
                return matrix.fieldOptions.columns.some((option) => this.sameText(option, value));
            }
            return targetAxis === "rows" || targetAxis === "columns";
        };
        const moveDraggedMatrixChip = (targetAxis: MatrixEditorAxis, beforeValue: string | null = null) => {
            const dragged = draggedMatrixChip;
            if (!dragged || !canDropMatrixChip(targetAxis, dragged.value)) return;
            let next = cloneMatrixQuery(draftQuery);
            (["rows", "columns", "values"] as MatrixEditorAxis[]).forEach((axis) => {
                next = setMatrixAxisValues(next, axis, matrixAxisValues(next, axis).filter((item) => !this.sameText(item, dragged.value)));
            });
            const target = matrixAxisValues(next, targetAxis);
            const insertAt = beforeValue ? target.findIndex((item) => this.sameText(item, beforeValue)) : -1;
            if (insertAt >= 0) target.splice(insertAt, 0, dragged.value);
            else target.push(dragged.value);
            updateDraft(setMatrixAxisValues(next, targetAxis, target));
        };
        const makeSection = (
            titleText: string,
            axis: "rows" | "columns" | "values",
            values: string[],
            emptyText: string,
            options: string[],
            apply: (value: string) => void,
            remove: (value: string) => void
        ) => {
            const section = doc.createElement("div");
            section.className = "ibx-assistant-matrix-editor-section";
            const title = doc.createElement("div");
            title.className = "ibx-assistant-matrix-editor-title";
            title.textContent = titleText;
            section.appendChild(title);
            const body = doc.createElement("div");
            body.className = "ibx-assistant-matrix-editor-body";
            const row = doc.createElement("div");
            row.className = "ibx-assistant-matrix-editor-row";
            const current = (values || []).filter(Boolean);
            row.addEventListener("dragover", (ev) => {
                if (!draggedMatrixChip || !canDropMatrixChip(axis, draggedMatrixChip.value)) return;
                ev.preventDefault();
                row.classList.add("ibx-assistant-matrix-editor-row--drop");
            });
            row.addEventListener("dragleave", () => row.classList.remove("ibx-assistant-matrix-editor-row--drop"));
            row.addEventListener("drop", (ev) => {
                if (!draggedMatrixChip || !canDropMatrixChip(axis, draggedMatrixChip.value)) return;
                ev.preventDefault();
                row.classList.remove("ibx-assistant-matrix-editor-row--drop");
                moveDraggedMatrixChip(axis);
            });
            (current.length ? current : [emptyText]).forEach((value) => {
                if (!current.length) {
                    const empty = doc.createElement("span");
                    empty.className = "ibx-assistant-matrix-pill ibx-assistant-matrix-pill--empty";
                    empty.textContent = value;
                    row.appendChild(empty);
                    return;
                }
                const chip = doc.createElement("span");
                chip.className = "ibx-assistant-matrix-pill ibx-assistant-matrix-pill--selected";
                chip.draggable = true;
                chip.setAttribute("data-ibx-tip", `Drag ${value}`);
                const handle = doc.createElement("span");
                handle.className = "ibx-assistant-matrix-drag-handle";
                handle.textContent = "⋮⋮";
                handle.setAttribute("aria-hidden", "true");
                chip.appendChild(handle);
                const label = doc.createElement("span");
                label.className = "ibx-assistant-matrix-pill-label";
                label.textContent = value;
                chip.appendChild(label);
                chip.addEventListener("dragstart", (ev) => {
                    draggedMatrixChip = { axis, value };
                    chip.classList.add("ibx-assistant-matrix-pill--dragging");
                    ev.dataTransfer?.setData("text/plain", value);
                    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
                });
                chip.addEventListener("dragend", () => {
                    draggedMatrixChip = null;
                    chip.classList.remove("ibx-assistant-matrix-pill--dragging");
                });
                chip.addEventListener("dragover", (ev) => {
                    if (!draggedMatrixChip || this.sameText(draggedMatrixChip.value, value) || !canDropMatrixChip(axis, draggedMatrixChip.value)) return;
                    ev.preventDefault();
                    ev.stopPropagation();
                    chip.classList.add("ibx-assistant-matrix-pill--drop-before");
                });
                chip.addEventListener("dragleave", () => chip.classList.remove("ibx-assistant-matrix-pill--drop-before"));
                chip.addEventListener("drop", (ev) => {
                    if (!draggedMatrixChip || !canDropMatrixChip(axis, draggedMatrixChip.value)) return;
                    ev.preventDefault();
                    ev.stopPropagation();
                    chip.classList.remove("ibx-assistant-matrix-pill--drop-before");
                    moveDraggedMatrixChip(axis, value);
                });
                const index = current.findIndex((item) => this.sameText(item, value));
                const addSmallButton = (text: string, tip: string, disabled: boolean, handler: () => void) => {
                    const btn = doc.createElement("button");
                    btn.type = "button";
                    btn.className = "ibx-assistant-matrix-pill-btn";
                    btn.textContent = text;
                    btn.disabled = disabled;
                    btn.setAttribute("aria-label", tip);
                    btn.setAttribute("data-ibx-tip", tip);
                    btn.addEventListener("click", (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        if (!disabled) handler();
                    });
                    chip.appendChild(btn);
                };
                addSmallButton("↑", `Move ${value} left/up`, index <= 0, () => moveValue(axis, value, -1));
                addSmallButton("↓", `Move ${value} right/down`, index >= current.length - 1, () => moveValue(axis, value, 1));
                addSmallButton("×", `Remove ${value}`, false, () => remove(value));
                row.appendChild(chip);
            });
            body.appendChild(row);
            const addRow = doc.createElement("div");
            addRow.className = "ibx-assistant-matrix-add-row";
            const searchableOptions = (options || []).length > 6;
            if (searchableOptions) {
                const picker = doc.createElement("div");
                picker.className = "ibx-assistant-matrix-add-picker";
                const button = doc.createElement("button");
                button.type = "button";
                button.className = "ibx-assistant-matrix-add-trigger";
                const addLabel = `+ Add ${titleText.toLowerCase().replace(/s$/, "")}`;
                button.textContent = addLabel;
                button.setAttribute("aria-label", addLabel);
                const menu = doc.createElement("div");
                menu.className = "ibx-assistant-matrix-add-menu";
                menu.style.display = "none";
                const searchInput = doc.createElement("input");
                searchInput.type = "search";
                searchInput.className = "ibx-assistant-matrix-add-search";
                searchInput.placeholder = `Search ${titleText.toLowerCase()}...`;
                searchInput.setAttribute("aria-label", `Search ${titleText.toLowerCase()}`);
                const list = doc.createElement("div");
                list.className = "ibx-assistant-matrix-add-list";
                const availableOptions = () => (options || [])
                    .filter((option) => !(values || []).some((value) => this.sameText(value, option)));
                const renderList = () => {
                    const cleanQuery = this.normalizeSelectedTokenText(searchInput.value || "");
                    list.replaceChildren();
                    const matches = availableOptions()
                    .filter((option) => {
                        if (!cleanQuery) return true;
                        const cleanOption = this.normalizeSelectedTokenText(option);
                        return cleanOption.indexOf(cleanQuery) >= 0;
                    })
                        .slice(0, cleanQuery ? 60 : 250);
                    if (!matches.length) {
                        const empty = doc.createElement("div");
                        empty.className = "ibx-assistant-matrix-add-empty";
                        empty.textContent = `No ${titleText.toLowerCase()} found`;
                        list.appendChild(empty);
                        return;
                    }
                    matches.forEach((option) => {
                        const item = doc.createElement("button");
                        item.type = "button";
                        item.className = "ibx-assistant-matrix-add-option";
                    item.textContent = option;
                        item.addEventListener("click", (ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            apply(option);
                        });
                        list.appendChild(item);
                    });
                };
                searchInput.addEventListener("input", renderList);
                button.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const open = menu.style.display !== "none";
                    menu.style.display = open ? "none" : "";
                    button.classList.toggle("is-open", !open);
                    if (!open) {
                        searchInput.value = "";
                        renderList();
                        window.setTimeout(() => searchInput.focus(), 0);
                    }
                });
                menu.addEventListener("pointerdown", (ev) => ev.stopPropagation());
                menu.addEventListener("mousedown", (ev) => ev.stopPropagation());
                menu.addEventListener("click", (ev) => ev.stopPropagation());
                menu.appendChild(searchInput);
                menu.appendChild(list);
                picker.appendChild(button);
                picker.appendChild(menu);
                addRow.appendChild(picker);
            } else {
                const select = doc.createElement("select");
                select.className = "ibx-assistant-matrix-add-select";
                const placeholder = doc.createElement("option");
                placeholder.value = "";
                placeholder.textContent = `+ Add ${titleText.toLowerCase().replace(/s$/, "")}`;
                select.appendChild(placeholder);
                (options || [])
                    .filter((option) => !(values || []).some((value) => this.sameText(value, option)))
                    .forEach((option) => {
                        const item = doc.createElement("option");
                        item.value = option;
                        item.textContent = option;
                        select.appendChild(item);
                    });
                select.addEventListener("change", () => {
                    const value = select.value;
                    if (!value) return;
                    apply(value);
                    select.value = "";
                });
                addRow.appendChild(select);
            }
            body.appendChild(addRow);
            section.appendChild(body);
            return section;
        };

        const renderSections = () => {
            sectionsHost.replaceChildren();
            sectionsHost.appendChild(makeSection("Rows", "rows", draftQuery.rows, "No row field", matrix.fieldOptions?.rows || [], (field) => {
                updateDraft(addMatrixField(draftQuery, "rows", field));
            }, (field) => removeDraftField("rows", field)));
            sectionsHost.appendChild(makeSection("Columns", "columns", draftQuery.columns, "No column field", matrix.fieldOptions?.columns || [], (field) => {
                updateDraft(addMatrixField(draftQuery, "columns", field));
            }, (field) => removeDraftField("columns", field)));
            sectionsHost.appendChild(makeSection("Measures", "values", draftQuery.values, "No measure", matrix.fieldOptions?.values || [], (field) => {
                updateDraft(addMatrixField(draftQuery, "values", field));
            }, (field) => removeDraftField("values", field)));
        };
        renderSections();
        wrap.appendChild(sectionsHost);
        const selectedTokenForField = (field: string): SelectedAssistantToken => {
            const label = String(field || "").trim();
            const normalized = this.normalizeSelectedTokenText(label);
            const type = /\btenant\b/i.test(label)
                ? "filter"
                : /\bunit\b/i.test(label)
                ? "filter"
                : /\bgroup\b/i.test(label)
                ? "filter"
                : /\bcategory\b/i.test(label)
                ? "filter"
                : /\bzone\b/i.test(label)
                ? "filter"
                : /\bfloor\b/i.test(label)
                ? "filter"
                : "filter";
            return { type, id: `filter-field:${normalized || label}`, label };
        };
        const selectedTokenForMeasure = (measure: string): SelectedAssistantToken => {
            const label = String(measure || "").trim();
            const normalized = this.normalizeSelectedTokenText(label);
            return { type: "metric", id: `metric:${normalized || label}`, label, metricKey: normalized || label };
        };
        const applyDraft = () => {
            const next = cloneMatrixQuery(draftQuery);
            if (!hasDraftChanges()) {
                closeEditorPanel();
                return;
            }
            if (onApply) {
                onApply(next);
                closeEditorPanel();
                return;
            }
            const question = this.matrixQueryToQuestion(next);
            const tokens = ([] as SelectedAssistantToken[])
                .concat((next.rows || []).map(selectedTokenForField))
                .concat((next.columns || []).map(selectedTokenForField))
                .concat((next.values || []).map(selectedTokenForMeasure))
                .concat([{ type: "function", id: "output:matrix", label: "Matrix" } as SelectedAssistantToken]);
            this.input.value = question;
            this.selectedTokens = this.mergeSelectedTokens(tokens);
            this.renderInputHighlights();
            closeEditorPanel();
            this.submitQuestion();
        };

        const actions = doc.createElement("div");
        actions.className = "ibx-assistant-matrix-editor-actions";
        const addAction = (label: string, handler: () => void, primary = false) => {
            const btn = doc.createElement("button");
            btn.type = "button";
            btn.className = primary ? "ibx-assistant-action ibx-assistant-action--primary" : "ibx-assistant-action";
            btn.textContent = label;
            btn.addEventListener("click", (ev) => {
                ev.preventDefault();
                handler();
            });
            actions.appendChild(btn);
        };
        addAction("Apply", () => {
            applyDraft();
        }, true);
        addAction("Cancel", () => {
            draftQuery = cloneMatrixQuery(originalQuery);
            renderSections();
            closeEditorPanel();
        });
        if ((draftQuery.rows || []).length && (draftQuery.columns || []).length) {
            addAction("Swap rows/columns", () => {
                updateDraft(swapMatrixAxes(draftQuery));
            });
        }
        wrap.appendChild(actions);

        return wrap;
    }

    private parsePinnedMatrixReports(raw: string): AssistantPinnedMatrixReport[] {
        try {
            const parsed = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(parsed)) return [];
            return parsed
                .map((item) => {
                    const rawType = String(item?.type || "matrix").toLowerCase();
                    const type: NonNullable<AssistantPinnedMatrixReport["type"]> =
                        rawType === "table" || rawType === "chart" || rawType === "compare" || rawType === "list" || rawType === "kpi" ? rawType : "matrix";
                    const tableQuery = type === "table" && item?.tableQuery ? this.cloneTableQuery(item.tableQuery) : undefined;
                    const tableSnapshot = item?.tableSnapshot && Array.isArray(item.tableSnapshot.columns) && Array.isArray(item.tableSnapshot.rows)
                        ? {
                            title: item.tableSnapshot.title ? String(item.tableSnapshot.title) : undefined,
                            columns: item.tableSnapshot.columns.map((column: unknown) => String(column || "")),
                            rows: item.tableSnapshot.rows
                                .filter((row: unknown) => Array.isArray(row))
                                .map((row: unknown[]) => row.map((cell) => String(cell ?? "")))
                        }
                        : undefined;
                    const chartType = String(item?.chartSnapshot?.type || "bar");
                    const normalizedChartType = chartType === "pie" ? "donut" : chartType;
                    const safeChartType: NonNullable<AssistantResponse["chart"]>["type"] =
                        normalizedChartType === "column" || normalizedChartType === "donut" || normalizedChartType === "line" || normalizedChartType === "area"
                            ? normalizedChartType
                            : "bar";
                    const chartSnapshot = item?.chartSnapshot && Array.isArray(item.chartSnapshot.labels) && Array.isArray(item.chartSnapshot.values)
                        ? {
                            type: safeChartType,
                            title: String(item.chartSnapshot.title || item?.name || "Chart"),
                            labels: item.chartSnapshot.labels.map((label: unknown) => String(label || "")),
                            values: item.chartSnapshot.values.map((value: unknown) => Number(value) || 0),
                            valueLabels: Array.isArray(item.chartSnapshot.valueLabels)
                                ? item.chartSnapshot.valueLabels.map((label: unknown) => String(label || ""))
                                : item.chartSnapshot.values.map((value: unknown) => String(value ?? "")),
                            series: Array.isArray(item.chartSnapshot.series)
                                ? item.chartSnapshot.series
                                    .filter((series: unknown) => !!series && typeof series === "object")
                                    .map((series: any) => ({
                                        name: String(series.name || "Series"),
                                        labels: Array.isArray(series.labels) ? series.labels.map((label: unknown) => String(label || "")) : [],
                                        values: Array.isArray(series.values) ? series.values.map((value: unknown) => Number(value) || 0) : [],
                                        valueLabels: Array.isArray(series.valueLabels)
                                            ? series.valueLabels.map((label: unknown) => String(label || ""))
                                            : (Array.isArray(series.values) ? series.values.map((value: unknown) => String(value ?? "")) : [])
                                    }))
                                : undefined
                        }
                        : undefined;
                    const kpiSnapshot = item?.kpiSnapshot && typeof item.kpiSnapshot === "object"
                        ? {
                            title: String(item.kpiSnapshot.title || item?.name || "KPI"),
                            value: String(item.kpiSnapshot.value || "N/A"),
                            rawValue: Number(item.kpiSnapshot.rawValue),
                            metricKey: String(item.kpiSnapshot.metricKey || ""),
                            metricName: String(item.kpiSnapshot.metricName || item.kpiSnapshot.title || item?.name || "KPI"),
                            scopeLabel: item.kpiSnapshot.scopeLabel ? String(item.kpiSnapshot.scopeLabel) : undefined
                        }
                        : undefined;
                    return {
                        id: String(item?.id || ""),
                        name: String(item?.name || (type === "table" ? "Pinned table" : type === "kpi" ? "Pinned KPI" : "Pinned matrix")),
                        type,
                        query: type === "table" && tableQuery ? this.tableQueryToMatrixQuery(tableQuery) : normalizeMatrixQuery(item?.query),
                        tableQuery,
                        tableSnapshot,
                        chartSnapshot,
                        kpiSnapshot,
                        layout: {
                            size: this.normalizeSavedReportTileSize(item?.layout?.size),
                            height: this.normalizeSavedReportTileHeight(item?.layout?.height),
                            w: this.normalizeSavedReportGridWidth(item?.layout?.w, item?.layout?.size),
                            h: this.normalizeSavedReportGridHeight(item?.layout?.h, item?.layout?.height),
                            x: Number.isFinite(Number(item?.layout?.x)) ? Number(item.layout.x) : undefined,
                            y: Number.isFinite(Number(item?.layout?.y)) ? Number(item.layout.y) : undefined,
                            pxW: Number.isFinite(Number(item?.layout?.pxW)) ? Number(item.layout.pxW) : undefined,
                            pxH: Number.isFinite(Number(item?.layout?.pxH)) ? Number(item.layout.pxH) : undefined,
                            headerColor: this.normalizeSavedReportHeaderColor(item?.layout?.headerColor),
                            columnWidths: this.normalizeSavedReportColumnWidths(item?.layout?.columnWidths)
                        },
                        createdAt: Number(item?.createdAt) || Date.now(),
                        updatedAt: Number(item?.updatedAt) || Number(item?.createdAt) || Date.now()
                    };
                })
                .filter((item) => {
                    if (!item.id) return false;
                    if (item.type === "kpi" && item.kpiSnapshot) return true;
                    if ((item.type === "chart" || item.type === "compare") && item.chartSnapshot) return true;
                    if ((item.type === "table" || item.type === "list") && (item.tableQuery || item.tableSnapshot)) return true;
                    return !!(item.query && Array.isArray(item.query.rows) && Array.isArray(item.query.values));
                })
                .slice(0, 12);
        } catch {
            return [];
        }
    }

    private loadPinnedMatrixReports(savedReportsJson?: string): AssistantPinnedMatrixReport[] {
        const persisted = this.parsePinnedMatrixReports(savedReportsJson || "");
        if (savedReportsJson || persisted.length) return persisted;
        try {
            return this.parsePinnedMatrixReports(window.localStorage?.getItem(this.pinnedMatrixStorageKey) || "");
        } catch {
            return [];
        }
    }

    private savePinnedMatrixReports(): void {
        const reportsJson = JSON.stringify(this.pinnedMatrixReports.slice(0, 12));
        const previousJson = this.pinnedMatrixReportsJson;
        this.pinnedMatrixReportsJson = reportsJson;
        try {
            window.localStorage?.setItem(this.pinnedMatrixStorageKey, reportsJson);
        } catch {
            // Ignore storage failures in sandboxed hosts.
        }
        if (reportsJson !== previousJson) {
            this.onPinnedMatrixReportsChanged?.(reportsJson);
        }
    }

    private pinMatrixReport(matrix: NonNullable<AssistantResponse["matrix"]>): void {
        if (!matrix.query) return;
        const name = (matrix.title || this.makeSavedMatrixName(matrix.query)).trim().slice(0, 80) || "Pinned matrix";
        const now = Date.now();
        const report: AssistantPinnedMatrixReport = {
            id: `matrix-${Date.now()}`,
            name,
            type: "matrix",
            query: cloneMatrixQuery(matrix.query),
            createdAt: now,
            updatedAt: now
        };
        this.assignNewSavedReportCanvasLayout(report);
        this.pinnedMatrixReports.unshift(report);
        this.pinnedMatrixReports = this.pinnedMatrixReports.slice(0, 12);
        this.savePinnedMatrixReports();
        this.showAssistantToast(`Saved "${name}" to Saved Reports.`);
        if (this.savedReportsViewOpen) this.showSavedReportsView();
    }

    private pinTableArtifact(columns: string[], rows: string[][], titleText?: string, editableQuery?: AssistantEditableTableQuery): void {
        if (editableQuery) {
            this.pinTableReport(editableQuery, titleText);
            return;
        }
        if (!columns.length) return;
        const name = (titleText || "Table").trim().slice(0, 80) || "Table";
        const now = Date.now();
        const report: AssistantPinnedMatrixReport = {
            id: `table-${now}`,
            name,
            type: /^list/i.test(name) ? "list" : "table",
            query: normalizeMatrixQuery({ rows: [], columns: [], values: [], filters: [] }),
            tableSnapshot: {
                title: name,
                columns: columns.slice(),
                rows: rows.map((row) => row.slice())
            },
            createdAt: now,
            updatedAt: now
        };
        this.assignNewSavedReportCanvasLayout(report);
        this.pinnedMatrixReports.unshift(report);
        this.pinnedMatrixReports = this.pinnedMatrixReports.slice(0, 12);
        this.savePinnedMatrixReports();
        this.showAssistantToast(`Saved "${name}" to Saved Reports.`);
        if (this.savedReportsViewOpen) this.showSavedReportsView();
    }

    private pinTableReport(query: AssistantEditableTableQuery, titleText?: string): void {
        const tableQuery = this.cloneTableQuery(query);
        if (!tableQuery.fields.length && !tableQuery.measures.length) return;
        const name = (titleText || this.makeSavedTableName(tableQuery)).trim().slice(0, 80) || "Pinned table";
        const now = Date.now();
        const report: AssistantPinnedMatrixReport = {
            id: `table-${now}`,
            name,
            type: "table",
            query: this.tableQueryToMatrixQuery(tableQuery),
            tableQuery,
            createdAt: now,
            updatedAt: now
        };
        this.assignNewSavedReportCanvasLayout(report);
        this.pinnedMatrixReports.unshift(report);
        this.pinnedMatrixReports = this.pinnedMatrixReports.slice(0, 12);
        this.savePinnedMatrixReports();
        this.showAssistantToast(`Saved "${name}" to Saved Reports.`);
        if (this.savedReportsViewOpen) this.showSavedReportsView();
    }

    private pinChartReport(chart: NonNullable<AssistantResponse["chart"]>): void {
        const name = (chart.title || "Chart").trim().slice(0, 80) || "Chart";
        const now = Date.now();
        const chartSnapshot: NonNullable<AssistantResponse["chart"]> = {
            type: chart.type,
            title: name,
            labels: (chart.labels || []).slice(),
            values: (chart.values || []).slice(),
            valueLabels: (chart.valueLabels || []).slice()
        };
        if (chart.series?.length) {
            chartSnapshot.series = chart.series.map((series) => ({
                name: series.name,
                labels: (series.labels || []).slice(),
                values: (series.values || []).slice(),
                valueLabels: (series.valueLabels || []).slice()
            }));
        }
        const report: AssistantPinnedMatrixReport = {
            id: `chart-${now}`,
            name,
            type: /comparison/i.test(name) ? "compare" : "chart",
            query: normalizeMatrixQuery({ rows: [], columns: [], values: [], filters: [] }),
            chartSnapshot,
            createdAt: now,
            updatedAt: now
        };
        this.assignNewSavedReportCanvasLayout(report);
        this.pinnedMatrixReports.unshift(report);
        this.pinnedMatrixReports = this.pinnedMatrixReports.slice(0, 12);
        this.savePinnedMatrixReports();
        this.showAssistantToast(`Saved "${name}" to Saved Reports.`);
        if (this.savedReportsViewOpen) this.showSavedReportsView();
    }

    private pinKpiReport(kpi: NonNullable<AssistantResponse["kpi"]>): void {
        const name = (kpi.title || kpi.metricName || "KPI").trim().slice(0, 80) || "KPI";
        const now = Date.now();
        const report: AssistantPinnedMatrixReport = {
            id: `kpi-${now}`,
            name,
            type: "kpi",
            query: normalizeMatrixQuery({ rows: [], columns: [], values: [kpi.metricName || kpi.title], filters: [] }),
            kpiSnapshot: { ...kpi, title: name },
            createdAt: now,
            updatedAt: now
        };
        this.assignNewSavedReportCanvasLayout(report);
        this.pinnedMatrixReports.unshift(report);
        this.pinnedMatrixReports = this.pinnedMatrixReports.slice(0, 12);
        this.savePinnedMatrixReports();
        this.showAssistantToast(`Saved "${name}" to Saved Reports.`);
        if (this.savedReportsViewOpen) this.showSavedReportsView();
    }

    private showAssistantToast(message: string): void {
        const doc = this.host.ownerDocument || document;
        let toast = this.root.querySelector(".ibx-assistant-toast") as HTMLDivElement | null;
        if (!toast) {
            toast = doc.createElement("div");
            toast.className = "ibx-assistant-toast";
            this.root.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.add("ibx-assistant-toast--show");
        if (this.savedReportToastTimer !== null) {
            window.clearTimeout(this.savedReportToastTimer);
        }
        this.savedReportToastTimer = window.setTimeout(() => {
            toast?.classList.remove("ibx-assistant-toast--show");
            this.savedReportToastTimer = null;
        }, 2600);
    }

    private makeSavedMatrixName(query: MatrixQuery): string {
        const values = (query.values || []).join(", ") || "Matrix";
        const rows = (query.rows || []).join(" / ");
        const columns = (query.columns || []).join(" / ");
        const suffix = columns ? `${rows || "Rows"} by ${columns}` : rows;
        return `${values}${suffix ? ` by ${suffix}` : ""}`.slice(0, 80);
    }

    private makeSavedTableName(query: AssistantEditableTableQuery): string {
        const measures = (query.measures || []).join(", ") || "Table";
        const fields = (query.fields || []).join(" / ");
        return `${measures}${fields ? ` by ${fields}` : ""}`.slice(0, 80);
    }

    private formatSavedReportDate(value: number | undefined): string {
        if (!value) return "-";
        try {
            return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
        } catch {
            return "-";
        }
    }

    private formatSavedReportType(report: AssistantPinnedMatrixReport): string {
        switch (report.type) {
            case "table": return "Table";
            case "chart": return "Chart";
            case "compare": return "Compare";
            case "list": return "List";
            case "kpi": return "KPI";
            case "matrix":
            default: return "Matrix";
        }
    }

    private normalizeSavedReportHeaderColor(value: unknown): string {
        const clean = String(value || "").trim();
        return /^#[0-9a-f]{6}$/i.test(clean) ? clean.toUpperCase() : "";
    }

    private savedReportHeaderColor(report: AssistantPinnedMatrixReport): string {
        return this.normalizeSavedReportHeaderColor(report.layout?.headerColor) || "#F8FAFC";
    }

    private normalizeSavedReportColumnWidths(value: unknown): Record<string, number> | undefined {
        if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
        const out: Record<string, number> = {};
        Object.entries(value as Record<string, unknown>).forEach(([key, raw]) => {
            const cleanKey = String(key || "").trim();
            const width = Math.round(Number(raw));
            if (!cleanKey || !Number.isFinite(width)) return;
            out[cleanKey] = Math.max(72, Math.min(420, width));
        });
        return Object.keys(out).length ? out : undefined;
    }

    private savedReportColumnKey(label: string, index: number): string {
        const clean = String(label || "").trim().toLowerCase().replace(/\s+/g, " ");
        return `${index}:${clean || "column"}`;
    }

    private clampSavedReportColumnWidth(value: number): number {
        return Math.max(72, Math.min(420, Math.round(value)));
    }

    private setSavedReportColumnWidth(reportId: string, columnKey: string, width: number | null): void {
        const report = this.pinnedMatrixReports.find((item) => item.id === reportId);
        if (!report || !columnKey) return;
        const current = this.normalizeSavedReportColumnWidths(report.layout?.columnWidths) || {};
        if (width === null) delete current[columnKey];
        else current[columnKey] = this.clampSavedReportColumnWidth(width);
        report.layout = {
            ...(report.layout || {}),
            columnWidths: Object.keys(current).length ? current : undefined
        };
        report.updatedAt = Date.now();
        if (this.activeSavedReportRenderContext?.reportId === reportId) {
            this.activeSavedReportRenderContext.columnWidths = { ...(report.layout.columnWidths || {}) };
        }
        this.savePinnedMatrixReports();
    }

    private savedReportColumnWidth(label: string, index: number, fallback: number): number {
        const context = this.activeSavedReportRenderContext;
        if (!context) return this.clampSavedReportColumnWidth(fallback);
        const key = this.savedReportColumnKey(label, index);
        const saved = Number(context.columnWidths[key]);
        return this.clampSavedReportColumnWidth(Number.isFinite(saved) ? saved : fallback);
    }

    private savedReportColumnWidthForReport(report: AssistantPinnedMatrixReport, label: string, index: number, fallback: number): number {
        const widths = this.normalizeSavedReportColumnWidths(report.layout?.columnWidths) || {};
        const key = this.savedReportColumnKey(label, index);
        const saved = Number(widths[key]);
        return this.clampSavedReportColumnWidth(Number.isFinite(saved) ? saved : fallback);
    }

    private attachSavedReportColumnResizeOverlay(
        doc: Document,
        wrap: HTMLElement,
        table: HTMLElement,
        labels: string[],
        widths: number[],
        baseWidths: number[],
        applyWidths: () => void
    ): void {
        const context = this.activeSavedReportRenderContext;
        if (!context || !labels.length || !widths.length) return;
        const existingCleanup = (wrap as any).__ibxColumnResizeOverlayCleanup as (() => void) | undefined;
        if (existingCleanup) existingCleanup();
        wrap.querySelectorAll(":scope > .ibx-assistant-column-resize-overlay, :scope > .ibx-assistant-column-resize-guide").forEach((node) => node.remove());
        const overlay = doc.createElement("div");
        overlay.className = "ibx-assistant-column-resize-overlay";
        const guide = doc.createElement("div");
        guide.className = "ibx-assistant-column-resize-guide";
        wrap.appendChild(overlay);
        wrap.appendChild(guide);
        const win = doc.defaultView || window;
        let raf = 0;
        let resizing = false;
        const hideResizeGuides = () => {
            this.root.querySelectorAll<HTMLElement>(".ibx-assistant-column-resize-guide").forEach((item) => {
                item.style.display = "none";
            });
            this.root.querySelectorAll<HTMLElement>(".ibx-assistant-column-resize-grip.is-dragging").forEach((item) => {
                item.classList.remove("is-dragging");
                try { item.blur(); } catch { /* Ignore hosts that cannot blur detached controls. */ }
            });
            this.root.querySelectorAll<HTMLElement>(".ibx-assistant-table--resizing").forEach((item) => {
                item.classList.remove("ibx-assistant-table--resizing");
            });
        };
        const positionOverlay = () => {
            raf = 0;
            if (!overlay.isConnected || !table.isConnected) return;
            const wrapRect = wrap.getBoundingClientRect();
            const tableRect = table.getBoundingClientRect();
            const headers = Array.from(table.children).slice(0, labels.length) as HTMLElement[];
            overlay.replaceChildren();
            if (!resizing) guide.style.display = "none";
            guide.style.top = `${Math.round(tableRect.top - wrapRect.top + wrap.scrollTop)}px`;
            guide.style.height = `${Math.max(24, Math.round(tableRect.height))}px`;
            headers.forEach((cell, index) => {
                if (!cell) return;
                const cellRect = cell.getBoundingClientRect();
                const grip = doc.createElement("button");
                grip.type = "button";
                grip.className = "ibx-assistant-column-resize-grip";
                grip.setAttribute("aria-label", `Resize ${labels[index] || "column"}`);
                grip.title = "Drag to resize column. Double-click to reset.";
                grip.style.left = `${Math.round(cellRect.right - wrapRect.left + wrap.scrollLeft - 7)}px`;
                grip.style.top = `${Math.round(cellRect.top - wrapRect.top + wrap.scrollTop)}px`;
                grip.style.height = `${Math.max(28, Math.round(cellRect.height))}px`;
                grip.addEventListener("dblclick", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const key = this.savedReportColumnKey(labels[index] || "", index);
                    this.setSavedReportColumnWidth(context.reportId, key, null);
                    widths[index] = this.clampSavedReportColumnWidth(baseWidths[index] || widths[index] || 120);
                    applyWidths();
                    this.scheduleSavedReportColumnOverlayPosition(win, positionOverlay, () => raf, (next) => { raf = next; });
                });
                grip.addEventListener("pointerdown", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    try { grip.setPointerCapture(ev.pointerId); } catch { /* Ignore hosts without pointer capture. */ }
                    this.hideAssistantTooltip();
                    hideResizeGuides();
                    resizing = true;
                    const startX = ev.clientX;
                    const startWidth = widths[index] || baseWidths[index] || 120;
                    const startLeft = cellRect.right - wrapRect.left + wrap.scrollLeft;
                    let latestX = startX;
                    let moveFrame = 0;
                    let latestWidth = this.clampSavedReportColumnWidth(startWidth);
                    let finished = false;
                    grip.classList.add("is-dragging");
                    table.classList.add("ibx-assistant-table--resizing");
                    guide.style.display = "block";
                    guide.style.left = `${Math.round(startLeft)}px`;
                    const renderGuide = () => {
                        moveFrame = 0;
                        latestWidth = this.clampSavedReportColumnWidth(startWidth + latestX - startX);
                        widths[index] = latestWidth;
                        applyWidths();
                        guide.style.left = `${Math.round(startLeft + latestWidth - startWidth)}px`;
                    };
                    const move = (moveEv: PointerEvent) => {
                        moveEv.preventDefault();
                        moveEv.stopPropagation();
                        latestX = moveEv.clientX;
                        if (!moveFrame) moveFrame = win.requestAnimationFrame(renderGuide);
                    };
                    const finishResize = (upEv?: PointerEvent | Event) => {
                        if (finished) return;
                        finished = true;
                        upEv?.preventDefault();
                        upEv?.stopPropagation();
                        try {
                            const pointerId = (upEv as PointerEvent | undefined)?.pointerId;
                            if (pointerId !== undefined) grip.releasePointerCapture(pointerId);
                        } catch { /* Ignore hosts without pointer capture. */ }
                        win.removeEventListener("pointermove", move, true);
                        win.removeEventListener("pointerup", finishResize, true);
                        win.removeEventListener("pointercancel", finishResize, true);
                        win.removeEventListener("blur", finishResize, true);
                        grip.removeEventListener("lostpointercapture", finishResize);
                        if (moveFrame) {
                            win.cancelAnimationFrame(moveFrame);
                            moveFrame = 0;
                        }
                        resizing = false;
                        grip.classList.remove("is-dragging");
                        try { grip.blur(); } catch { /* Ignore hosts that cannot blur detached controls. */ }
                        table.classList.remove("ibx-assistant-table--resizing");
                        hideResizeGuides();
                        const next = this.clampSavedReportColumnWidth(latestWidth);
                        widths[index] = next;
                        applyWidths();
                        const key = this.savedReportColumnKey(labels[index] || "", index);
                        this.setSavedReportColumnWidth(context.reportId, key, next);
                        this.scheduleSavedReportColumnOverlayPosition(win, positionOverlay, () => raf, (nextFrame) => { raf = nextFrame; });
                    };
                    win.addEventListener("pointermove", move, true);
                    win.addEventListener("pointerup", finishResize, true);
                    win.addEventListener("pointercancel", finishResize, true);
                    win.addEventListener("blur", finishResize, true);
                    grip.addEventListener("lostpointercapture", finishResize);
                });
                overlay.appendChild(grip);
            });
        };
        const schedule = () => this.scheduleSavedReportColumnOverlayPosition(win, positionOverlay, () => raf, (next) => { raf = next; });
        const cleanup = () => {
            if (raf) win.cancelAnimationFrame(raf);
            resizing = false;
            hideResizeGuides();
            wrap.removeEventListener("scroll", schedule);
            win.removeEventListener("resize", schedule);
            overlay.remove();
            guide.remove();
            delete (wrap as any).__ibxColumnResizeOverlayCleanup;
        };
        (wrap as any).__ibxColumnResizeOverlayCleanup = cleanup;
        wrap.addEventListener("scroll", schedule, { passive: true });
        win.addEventListener("resize", schedule);
        schedule();
    }

    private attachSavedReportMiniColumnResize(
        doc: Document,
        host: HTMLElement,
        grid: HTMLElement,
        report: AssistantPinnedMatrixReport,
        labels: string[],
        widths: number[],
        baseWidths: number[],
        applyWidths: () => void
    ): void {
        if (!labels.length || !widths.length) return;
        const existingCleanup = (host as any).__ibxMiniColumnResizeCleanup as (() => void) | undefined;
        if (existingCleanup) existingCleanup();
        host.querySelectorAll(":scope > .ibx-assistant-saved-mini-resize-overlay, :scope > .ibx-assistant-saved-mini-resize-guide").forEach((node) => node.remove());
        const overlay = doc.createElement("div");
        overlay.className = "ibx-assistant-saved-mini-resize-overlay";
        const guide = doc.createElement("div");
        guide.className = "ibx-assistant-saved-mini-resize-guide";
        host.appendChild(overlay);
        host.appendChild(guide);
        const win = doc.defaultView || window;
        let raf = 0;
        let resizing = false;
        const schedule = () => {
            if (raf) return;
            raf = win.requestAnimationFrame(position);
        };
        const hideGuide = () => {
            if (!resizing) guide.style.display = "none";
            overlay.querySelectorAll<HTMLElement>(".ibx-assistant-saved-mini-resize-grip.is-dragging").forEach((item) => item.classList.remove("is-dragging"));
        };
        const position = () => {
            raf = 0;
            if (!host.isConnected || !grid.isConnected) return;
            const hostRect = host.getBoundingClientRect();
            const gridRect = grid.getBoundingClientRect();
            const headers = Array.from(grid.children).slice(0, labels.length) as HTMLElement[];
            overlay.replaceChildren();
            if (!resizing) guide.style.display = "none";
            guide.style.top = `${Math.round(gridRect.top - hostRect.top + host.scrollTop)}px`;
            guide.style.height = `${Math.max(24, Math.round(gridRect.height))}px`;
            headers.forEach((cell, index) => {
                if (index >= labels.length - 1) return;
                if (!cell) return;
                const rect = cell.getBoundingClientRect();
                if (rect.right < hostRect.left + 8 || rect.right > hostRect.right - 8 || rect.bottom < hostRect.top || rect.top > hostRect.bottom) return;
                const grip = doc.createElement("button");
                grip.type = "button";
                grip.className = "ibx-assistant-saved-mini-resize-grip";
                grip.setAttribute("aria-label", `Resize ${labels[index] || "column"}`);
                grip.title = "Drag to resize column. Double-click to reset.";
                grip.style.left = `${Math.round(rect.right - hostRect.left + host.scrollLeft - 5)}px`;
                grip.style.top = `${Math.round(rect.top - hostRect.top + host.scrollTop)}px`;
                grip.style.height = `${Math.max(22, Math.round(rect.height))}px`;
                grip.addEventListener("dblclick", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    this.setSavedReportColumnWidth(report.id, this.savedReportColumnKey(labels[index] || "", index), null);
                    widths[index] = this.clampSavedReportColumnWidth(baseWidths[index] || widths[index] || 96);
                    applyWidths();
                    schedule();
                });
                grip.addEventListener("pointerdown", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    try { grip.setPointerCapture(ev.pointerId); } catch { /* noop */ }
                    resizing = true;
                    const startX = ev.clientX;
                    const startWidth = widths[index] || baseWidths[index] || 96;
                    const startLeft = rect.right - hostRect.left + host.scrollLeft;
                    let latestWidth = this.clampSavedReportColumnWidth(startWidth);
                    let frame = 0;
                    let finished = false;
                    grip.classList.add("is-dragging");
                    guide.style.display = "block";
                    guide.style.left = `${Math.round(startLeft)}px`;
                    const render = (clientX: number) => {
                        latestWidth = this.clampSavedReportColumnWidth(startWidth + clientX - startX);
                        widths[index] = latestWidth;
                        applyWidths();
                        guide.style.left = `${Math.round(startLeft + latestWidth - startWidth)}px`;
                        schedule();
                    };
                    const move = (moveEv: PointerEvent) => {
                        moveEv.preventDefault();
                        moveEv.stopPropagation();
                        const clientX = moveEv.clientX;
                        if (frame) win.cancelAnimationFrame(frame);
                        frame = win.requestAnimationFrame(() => {
                            frame = 0;
                            render(clientX);
                        });
                    };
                    const finish = (upEv?: PointerEvent | Event) => {
                        if (finished) return;
                        finished = true;
                        upEv?.preventDefault();
                        upEv?.stopPropagation();
                        try {
                            const pointerId = (upEv as PointerEvent | undefined)?.pointerId;
                            if (pointerId !== undefined) grip.releasePointerCapture(pointerId);
                        } catch { /* noop */ }
                        win.removeEventListener("pointermove", move, true);
                        win.removeEventListener("pointerup", finish, true);
                        win.removeEventListener("pointercancel", finish, true);
                        win.removeEventListener("blur", finish, true);
                        grip.removeEventListener("lostpointercapture", finish);
                        if (frame) win.cancelAnimationFrame(frame);
                        resizing = false;
                        grip.classList.remove("is-dragging");
                        hideGuide();
                        const next = this.clampSavedReportColumnWidth(latestWidth);
                        widths[index] = next;
                        applyWidths();
                        this.setSavedReportColumnWidth(report.id, this.savedReportColumnKey(labels[index] || "", index), next);
                        schedule();
                    };
                    win.addEventListener("pointermove", move, true);
                    win.addEventListener("pointerup", finish, true);
                    win.addEventListener("pointercancel", finish, true);
                    win.addEventListener("blur", finish, true);
                    grip.addEventListener("lostpointercapture", finish);
                });
                overlay.appendChild(grip);
            });
        };
        const cleanup = () => {
            if (raf) win.cancelAnimationFrame(raf);
            resizing = false;
            host.removeEventListener("scroll", schedule);
            win.removeEventListener("resize", schedule);
            overlay.remove();
            guide.remove();
            delete (host as any).__ibxMiniColumnResizeCleanup;
        };
        (host as any).__ibxMiniColumnResizeCleanup = cleanup;
        host.addEventListener("scroll", schedule, { passive: true });
        win.addEventListener("resize", schedule);
        schedule();
    }

    private scheduleSavedReportColumnOverlayPosition(win: Window, render: () => void, getFrame: () => number, setFrame: (frame: number) => void): void {
        if (getFrame()) return;
        setFrame(win.requestAnimationFrame(render));
    }

    private savedReportHeaderTextColor(color: string): string {
        const clean = this.normalizeSavedReportHeaderColor(color) || "#F8FAFC";
        const r = parseInt(clean.slice(1, 3), 16);
        const g = parseInt(clean.slice(3, 5), 16);
        const b = parseInt(clean.slice(5, 7), 16);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance < 0.58 ? "#FFFFFF" : "#0F172A";
    }

    private setSavedReportHeaderColor(id: string, color: string): void {
        const report = this.pinnedMatrixReports.find((item) => item.id === id);
        if (!report) return;
        const clean = this.normalizeSavedReportHeaderColor(color);
        report.layout = {
            ...(report.layout || {}),
            headerColor: clean || undefined
        };
        report.updatedAt = Date.now();
        this.savePinnedMatrixReports();
        this.showSavedReportsView();
    }

    private closeSavedReportColorPopover(): void {
        if (this.savedReportColorPopover?.parentElement) {
            this.savedReportColorPopover.parentElement.removeChild(this.savedReportColorPopover);
        }
        this.savedReportColorPopover = null;
        this.root.ownerDocument.removeEventListener("pointerdown", this.handleSavedReportColorOutsidePointer, true);
    }

    private readonly handleSavedReportColorOutsidePointer = (ev: PointerEvent): void => {
        const target = ev.target as Node | null;
        if (target && this.savedReportColorPopover?.contains(target)) return;
        if (target instanceof Element && target.closest(".ibx-assistant-saved-color-swatch")) return;
        this.closeSavedReportColorPopover();
    };

    private openSavedReportColorPicker(reportId: string, color: string, anchor: HTMLElement, preview: (color: string) => void): void {
        this.closeSavedReportColorPopover();
        const doc = this.root.ownerDocument || document;
        const win = doc.defaultView || window;
        const initial = this.normalizeSavedReportHeaderColor(color) || "#F8FAFC";
        const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
            const clean = (this.normalizeSavedReportHeaderColor(hex) || "#F8FAFC").slice(1);
            return {
                r: parseInt(clean.slice(0, 2), 16),
                g: parseInt(clean.slice(2, 4), 16),
                b: parseInt(clean.slice(4, 6), 16)
            };
        };
        const rgbToHex = (r: number, g: number, b: number): string =>
            `#${[r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
        const rgbToHsv = (r: number, g: number, b: number): { h: number; s: number; v: number } => {
            const rr = r / 255;
            const gg = g / 255;
            const bb = b / 255;
            const max = Math.max(rr, gg, bb);
            const min = Math.min(rr, gg, bb);
            const d = max - min;
            let h = 0;
            if (d !== 0) {
                if (max === rr) h = 60 * (((gg - bb) / d) % 6);
                else if (max === gg) h = 60 * (((bb - rr) / d) + 2);
                else h = 60 * (((rr - gg) / d) + 4);
            }
            if (h < 0) h += 360;
            return { h, s: max === 0 ? 0 : d / max, v: max };
        };
        const hsvToRgb = (h: number, s: number, v: number): { r: number; g: number; b: number } => {
            const hh = ((h % 360) + 360) % 360;
            const c = v * s;
            const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
            const m = v - c;
            let r1 = 0;
            let g1 = 0;
            let b1 = 0;
            if (hh < 60) { r1 = c; g1 = x; }
            else if (hh < 120) { r1 = x; g1 = c; }
            else if (hh < 180) { g1 = c; b1 = x; }
            else if (hh < 240) { g1 = x; b1 = c; }
            else if (hh < 300) { r1 = x; b1 = c; }
            else { r1 = c; b1 = x; }
            return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) };
        };
        const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
        const state = rgbToHsv(...Object.values(hexToRgb(initial)) as [number, number, number]);
        let selected = initial;
        const rootRect = this.root.getBoundingClientRect();
        const anchorRect = anchor.getBoundingClientRect();
        const pickerW = 258;
        const left = clamp(anchorRect.right - rootRect.left - pickerW, 8, Math.max(8, rootRect.width - pickerW - 8));
        const top = clamp(anchorRect.bottom - rootRect.top + 8, 8, Math.max(8, rootRect.height - 306));
        const pop = doc.createElement("div");
        pop.className = "ibx-assistant-color-popover";
        pop.style.left = `${Math.round(left)}px`;
        pop.style.top = `${Math.round(top)}px`;
        pop.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        pop.addEventListener("mousedown", (ev) => ev.stopPropagation());
        pop.addEventListener("click", (ev) => ev.stopPropagation());
        this.root.appendChild(pop);
        this.savedReportColorPopover = pop;

        let colorPopoverDragging = false;
        const startPopoverDrag = (startClientX: number, startClientY: number, startEvent: Event): void => {
            startEvent.preventDefault();
            startEvent.stopPropagation();
            if (colorPopoverDragging) return;
            colorPopoverDragging = true;
            pop.classList.add("ibx-assistant-color-popover--dragging");
            const startLeft = parseFloat(pop.style.left || "0") || 0;
            const startTop = parseFloat(pop.style.top || "0") || 0;
            const moveTo = (clientX: number, clientY: number) => {
                const bounds = this.root.getBoundingClientRect();
                const popRect = pop.getBoundingClientRect();
                const maxLeft = Math.max(8, bounds.width - popRect.width - 8);
                const maxTop = Math.max(8, bounds.height - popRect.height - 8);
                const nextLeft = clamp(startLeft + clientX - startClientX, 8, maxLeft);
                const nextTop = clamp(startTop + clientY - startClientY, 8, maxTop);
                pop.style.left = `${Math.round(nextLeft)}px`;
                pop.style.top = `${Math.round(nextTop)}px`;
            };
            const finish = (endEvent: Event) => {
                endEvent.preventDefault();
                endEvent.stopPropagation();
                if (!colorPopoverDragging) return;
                colorPopoverDragging = false;
                pop.classList.remove("ibx-assistant-color-popover--dragging");
                win.removeEventListener("pointermove", onPointerMove, true);
                win.removeEventListener("pointerup", finish, true);
                win.removeEventListener("pointercancel", finish, true);
                win.removeEventListener("mousemove", onMouseMove, true);
                win.removeEventListener("mouseup", finish, true);
            };
            const onPointerMove = (moveEvent: Event) => {
                const pointerEvent = moveEvent as PointerEvent;
                moveEvent.preventDefault();
                moveEvent.stopPropagation();
                moveTo(pointerEvent.clientX, pointerEvent.clientY);
            };
            const onMouseMove = (moveEvent: Event) => {
                const mouseEvent = moveEvent as MouseEvent;
                moveEvent.preventDefault();
                moveEvent.stopPropagation();
                moveTo(mouseEvent.clientX, mouseEvent.clientY);
            };
            win.addEventListener("pointermove", onPointerMove, true);
            win.addEventListener("pointerup", finish, true);
            win.addEventListener("pointercancel", finish, true);
            win.addEventListener("mousemove", onMouseMove, true);
            win.addEventListener("mouseup", finish, true);
        };

        const head = doc.createElement("div");
        head.className = "ibx-assistant-color-head";
        head.setAttribute("data-ibx-tip", "Drag to move color picker");
        head.addEventListener("pointerdown", (ev) => startPopoverDrag(ev.clientX, ev.clientY, ev));
        head.addEventListener("mousedown", (ev) => startPopoverDrag(ev.clientX, ev.clientY, ev));
        const title = doc.createElement("div");
        title.textContent = "Header color";
        const headPreview = doc.createElement("div");
        headPreview.className = "ibx-assistant-color-head-preview";
        head.appendChild(title);
        head.appendChild(headPreview);
        pop.appendChild(head);

        const sv = doc.createElement("div");
        sv.className = "ibx-assistant-color-sv";
        const svWhite = doc.createElement("div");
        svWhite.className = "ibx-assistant-color-sv-white";
        const svBlack = doc.createElement("div");
        svBlack.className = "ibx-assistant-color-sv-black";
        const svThumb = doc.createElement("div");
        svThumb.className = "ibx-assistant-color-thumb";
        sv.appendChild(svWhite);
        sv.appendChild(svBlack);
        sv.appendChild(svThumb);
        pop.appendChild(sv);

        const hue = doc.createElement("div");
        hue.className = "ibx-assistant-color-hue";
        const hueThumb = doc.createElement("div");
        hueThumb.className = "ibx-assistant-color-hue-thumb";
        hue.appendChild(hueThumb);
        pop.appendChild(hue);

        const inputRow = doc.createElement("div");
        inputRow.className = "ibx-assistant-color-input-row";
        const hexInput = doc.createElement("input");
        hexInput.type = "text";
        hexInput.maxLength = 7;
        hexInput.setAttribute("aria-label", "Header color hex");
        inputRow.appendChild(hexInput);
        pop.appendChild(inputRow);

        const presets = doc.createElement("div");
        presets.className = "ibx-assistant-color-presets";
        ["#2563EB", "#7C3AED", "#EC4899", "#EF4444", "#F59E0B", "#22C55E", "#14B8A6", "#0F172A"].forEach((preset) => {
            const btn = doc.createElement("button");
            btn.type = "button";
            btn.style.background = preset;
            btn.setAttribute("aria-label", `Use ${preset}`);
            btn.addEventListener("click", () => sync(preset, true));
            presets.appendChild(btn);
        });
        pop.appendChild(presets);

        const actions = doc.createElement("div");
        actions.className = "ibx-assistant-color-actions";
        const cancel = doc.createElement("button");
        cancel.type = "button";
        cancel.className = "ibx-assistant-color-btn";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", () => {
            preview(initial);
            this.closeSavedReportColorPopover();
        });
        const apply = doc.createElement("button");
        apply.type = "button";
        apply.className = "ibx-assistant-color-btn ibx-assistant-color-btn--primary";
        apply.textContent = "Apply";
        apply.addEventListener("click", () => {
            sync(hexInput.value || selected, true);
            this.setSavedReportHeaderColor(reportId, selected);
            this.closeSavedReportColorPopover();
        });
        actions.appendChild(cancel);
        actions.appendChild(apply);
        pop.appendChild(actions);

        const updateUi = (emitPreview: boolean): void => {
            const hueRgb = hsvToRgb(state.h, 1, 1);
            const selectedRgb = hsvToRgb(state.h, state.s, state.v);
            selected = rgbToHex(selectedRgb.r, selectedRgb.g, selectedRgb.b);
            sv.style.background = rgbToHex(hueRgb.r, hueRgb.g, hueRgb.b);
            svThumb.style.left = `${state.s * 100}%`;
            svThumb.style.top = `${(1 - state.v) * 100}%`;
            hueThumb.style.left = `${(state.h / 360) * 100}%`;
            headPreview.style.background = selected;
            hexInput.value = selected;
            if (emitPreview) preview(selected);
        };
        function sync(hex: string, emitPreview: boolean): void {
            const safe = /^#[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : selected;
            const rgb = hexToRgb(safe);
            const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
            state.h = hsv.h;
            state.s = hsv.s;
            state.v = hsv.v;
            updateUi(emitPreview);
        }
        const setSvFromPoint = (clientX: number, clientY: number): void => {
            const rect = sv.getBoundingClientRect();
            state.s = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
            state.v = 1 - clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
            updateUi(true);
        };
        const setHueFromPoint = (clientX: number): void => {
            const rect = hue.getBoundingClientRect();
            state.h = clamp(((clientX - rect.left) / Math.max(1, rect.width)) * 360, 0, 359.999);
            updateUi(true);
        };
        const startDrag = (ev: PointerEvent, moveFn: (x: number, y: number) => void): void => {
            ev.preventDefault();
            ev.stopPropagation();
            const pointerId = ev.pointerId;
            const target = ev.currentTarget as HTMLElement;
            target.setPointerCapture?.(pointerId);
            const move = (moveEv: PointerEvent): void => {
                if (moveEv.pointerId !== pointerId) return;
                moveFn(moveEv.clientX, moveEv.clientY);
            };
            const up = (upEv: PointerEvent): void => {
                if (upEv.pointerId !== pointerId) return;
                target.releasePointerCapture?.(pointerId);
                target.removeEventListener("pointermove", move);
                target.removeEventListener("pointerup", up);
                target.removeEventListener("pointercancel", up);
            };
            target.addEventListener("pointermove", move);
            target.addEventListener("pointerup", up);
            target.addEventListener("pointercancel", up);
            moveFn(ev.clientX, ev.clientY);
        };
        sv.addEventListener("pointerdown", (ev) => startDrag(ev, setSvFromPoint));
        hue.addEventListener("pointerdown", (ev) => startDrag(ev, (x) => setHueFromPoint(x)));
        hexInput.addEventListener("input", () => {
            hexInput.value = hexInput.value.toUpperCase();
            if (/^#[0-9A-F]{6}$/.test(hexInput.value)) sync(hexInput.value, true);
        });
        hexInput.addEventListener("keydown", (ev) => {
            if (ev.key !== "Enter") return;
            ev.preventDefault();
            sync(hexInput.value || selected, true);
            this.setSavedReportHeaderColor(reportId, selected);
            this.closeSavedReportColorPopover();
        });
        updateUi(false);
        win.setTimeout(() => doc.addEventListener("pointerdown", this.handleSavedReportColorOutsidePointer, true), 0);
    }

    private savedReportsForDisplay(): AssistantPinnedMatrixReport[] {
        return this.savedReportsLayoutDraft || this.pinnedMatrixReports;
    }

    private beginSavedReportsLayoutEdit(): void {
        this.savedReportsLayoutEditing = true;
        this.savedReportsLayoutDraft = this.pinnedMatrixReports.map((report, index) => {
            const clone = this.cloneSavedReport(report);
            const rect = this.savedReportCanvasRect(clone, index);
            clone.layout = { ...(clone.layout || {}), x: rect.x, y: rect.y, pxW: rect.w, pxH: rect.h };
            return clone;
        });
        this.savedReportRenamingId = null;
        this.savedReportDeleteConfirmId = null;
        this.showSavedReportsView();
    }

    private saveSavedReportsLayout(): void {
        if (!this.savedReportsLayoutDraft) return;
        this.pinnedMatrixReports = this.savedReportsLayoutDraft.map((report) => this.cloneSavedReport(report));
        this.savedReportsLayoutDraft = null;
        this.savedReportsLayoutEditing = false;
        this.savedReportsDraggingId = null;
        this.savePinnedMatrixReports();
        this.showSavedReportsView();
        this.showAssistantToast("Saved Reports layout updated.");
    }

    private cancelSavedReportsLayoutEdit(): void {
        this.savedReportsLayoutDraft = null;
        this.savedReportsLayoutEditing = false;
        this.savedReportsDraggingId = null;
        this.showSavedReportsView();
    }

    private moveSavedReportInDraft(sourceId: string, targetId: string): void {
        if (!this.savedReportsLayoutDraft || sourceId === targetId) return;
        const sourceIndex = this.savedReportsLayoutDraft.findIndex((report) => report.id === sourceId);
        const targetIndex = this.savedReportsLayoutDraft.findIndex((report) => report.id === targetId);
        if (sourceIndex < 0 || targetIndex < 0) return;
        const [source] = this.savedReportsLayoutDraft.splice(sourceIndex, 1);
        this.savedReportsLayoutDraft.splice(targetIndex, 0, source);
        this.showSavedReportsView();
    }

    private setSavedReportDraftSize(id: string, size: AssistantSavedReportTileSize): void {
        if (!this.savedReportsLayoutDraft) return;
        const report = this.savedReportsLayoutDraft.find((item) => item.id === id);
        if (!report) return;
        report.layout = { ...(report.layout || {}), size };
        this.showSavedReportsView();
    }

    private setSavedReportDraftHeight(id: string, height: AssistantSavedReportTileHeight): void {
        if (!this.savedReportsLayoutDraft) return;
        const report = this.savedReportsLayoutDraft.find((item) => item.id === id);
        if (!report) return;
        report.layout = { ...(report.layout || {}), height };
        this.showSavedReportsView();
    }

    private setSavedReportDraftGridSize(id: string, w: number, h: number): void {
        if (!this.savedReportsLayoutDraft) return;
        const report = this.savedReportsLayoutDraft.find((item) => item.id === id);
        if (!report) return;
        const width = this.normalizeSavedReportGridWidth(w, report.layout?.size);
        const height = this.normalizeSavedReportGridHeight(h, report.layout?.height);
        report.layout = { ...(report.layout || {}), w: width, h: height };
    }

    private setSavedReportDraftCanvasRect(id: string, rect: { x?: number; y?: number; w?: number; h?: number }): void {
        if (!this.savedReportsLayoutDraft) return;
        const report = this.savedReportsLayoutDraft.find((item) => item.id === id);
        if (!report) return;
        const current = this.savedReportCanvasRect(report, this.savedReportsLayoutDraft.indexOf(report));
        report.layout = {
            ...(report.layout || {}),
            x: this.normalizeSavedReportCanvasValue(rect.x, current.x, 0, 4000),
            y: this.normalizeSavedReportCanvasValue(rect.y, current.y, 0, 4000),
            pxW: this.normalizeSavedReportCanvasValue(rect.w, current.w, 150, 980),
            pxH: this.normalizeSavedReportCanvasValue(rect.h, current.h, 140, 720)
        };
    }

    private savedReportSummaryLines(report: AssistantPinnedMatrixReport): string[] {
        if (report.kpiSnapshot) {
            return [
                report.kpiSnapshot.value || "N/A",
                report.kpiSnapshot.scopeLabel || "KPI"
            ];
        }
        if (report.chartSnapshot) {
            return [
                `${(report.chartSnapshot.labels || []).length} categories`,
                `${this.normalizeChartViewType(report.chartSnapshot.type) || "bar"} chart`
            ];
        }
        if (report.tableSnapshot) {
            return [
                `${report.tableSnapshot.columns.length} columns`,
                `${report.tableSnapshot.rows.length} rows`
            ];
        }
        if (report.tableQuery) {
            return [
                `${(report.tableQuery.fields || []).join(", ") || "Fields"}`,
                `${(report.tableQuery.measures || []).join(", ") || "Measures"}`
            ];
        }
        return [
            `${(report.query.rows || []).join(", ") || "Rows"}`,
            `${(report.query.values || []).join(", ") || "Values"}`
        ];
    }

    private savedReportPreviewTable(report: AssistantPinnedMatrixReport): { columns: string[]; rows: string[][] } | null {
        try {
            if (report.tableSnapshot) {
                return {
                    columns: report.tableSnapshot.columns.slice(),
                    rows: report.tableSnapshot.rows.map((row) => row.slice())
                };
            }
            if (report.tableQuery) {
                const response = this.engine.answer(this.tableQueryToQuestion(report.tableQuery));
                const table = response.table || response.tables?.[0];
                if (table) return { columns: table.columns.slice(), rows: table.rows.map((row) => row.slice()) };
            }
            if (report.query?.values?.length || report.query?.rows?.length) {
                const response = this.engine.answerSavedMatrixQuery(report.query);
                if (response.matrix) {
                    return {
                        columns: [response.matrix.rowHeader].concat(response.matrix.columnHeaders || []),
                        rows: (response.matrix.rows || []).map((row) => [row.label].concat(row.values || []))
                    };
                }
                const table = response.table || response.tables?.[0];
                if (table) return { columns: table.columns.slice(), rows: table.rows.map((row) => row.slice()) };
            }
        } catch {
            // Preview must never block opening Saved Reports.
        }
        return null;
    }

    private appendSavedReportMiniTable(doc: Document, host: HTMLElement, report: AssistantPinnedMatrixReport, size: AssistantSavedReportTileSize): boolean {
        void size;
        const table = this.savedReportPreviewTable(report);
        if (!table?.columns.length) return false;
        const columns = table.columns.slice();
        const rows = table.rows.slice();
        const baseColumnWidths = columns.map((_column, index) => index === 0 ? 128 : 92);
        const columnWidths = columns.map((column, index) => this.savedReportColumnWidthForReport(report, column, index, baseColumnWidths[index]));
        const applyMiniColumnWidths = () => {
            grid.style.gridTemplateColumns = columnWidths.map((width) => `minmax(${width}px, ${width}px)`).join(" ");
            grid.style.width = `${columnWidths.reduce((sum, width) => sum + width, 0)}px`;
        };
        const grid = doc.createElement("div");
        grid.className = "ibx-assistant-saved-mini-table";
        grid.addEventListener("pointerdown", (ev) => this.rememberAdditiveSelectionPointer(ev), true);
        grid.addEventListener("mousedown", (ev) => this.rememberAdditiveSelectionPointer(ev), true);
        applyMiniColumnWidths();
        let selectedRowSignature = "";
        const rowSelectionSignature = (indices: number[] | undefined): string => (indices || [])
            .map((idx) => Number(idx))
            .filter((idx) => Number.isFinite(idx) && idx >= 0)
            .sort((a, b) => a - b)
            .join(",");
        columns.forEach((column) => {
            const cell = doc.createElement("div");
            cell.className = "ibx-assistant-saved-mini-cell ibx-assistant-saved-mini-head";
            cell.textContent = column;
            cell.title = column;
            grid.appendChild(cell);
        });
        rows.forEach((row) => {
            const isTotalRow = /^(?:grand\s+total|total)$/i.test(String(row?.[0] || "").trim());
            const action = this.onSelectIndices
                ? columns.map((_, index) => this.engine.resolveTableCellAction(columns, row, index)).find((item) => !!item?.indices?.length) || null
                : null;
            const selectableRow = !!action?.indices?.length;
            const rowCells: HTMLDivElement[] = [];
            const toggle = (ev?: MouseEvent | KeyboardEvent) => {
                ev?.preventDefault?.();
                ev?.stopPropagation?.();
                (ev as any)?.stopImmediatePropagation?.();
                const signature = rowSelectionSignature(action?.indices);
                if (!signature || !this.onSelectIndices) return;
                const options = this.selectionOptionsFromEvent(ev);
                if (options?.additive) {
                    const hasLocalSelection = !!selectedRowSignature;
                    const nextSelected = selectedRowSignature !== signature;
                    selectedRowSignature = nextSelected ? signature : "";
                    Array.from(grid.querySelectorAll(".ibx-assistant-saved-mini-selected")).forEach((cell) => cell.classList.remove("ibx-assistant-saved-mini-selected"));
                    if (nextSelected) rowCells.forEach((cell) => cell.classList.add("ibx-assistant-saved-mini-selected"));
                    this.onSelectIndices(action?.indices || [], hasLocalSelection ? options : undefined);
                    return;
                }
                const nextSelected = selectedRowSignature !== signature;
                selectedRowSignature = nextSelected ? signature : "";
                Array.from(grid.querySelectorAll(".ibx-assistant-saved-mini-selected")).forEach((cell) => cell.classList.remove("ibx-assistant-saved-mini-selected"));
                if (nextSelected) rowCells.forEach((cell) => cell.classList.add("ibx-assistant-saved-mini-selected"));
                this.onSelectIndices(nextSelected ? (action?.indices || []) : []);
            };
            columns.forEach((_, index) => {
                const value = String(row[index] ?? "");
                const cell = doc.createElement("div");
                cell.className = `ibx-assistant-saved-mini-cell${index > 0 && Number.isFinite(this.parseTableNumber(value)) ? " ibx-assistant-saved-mini-num" : ""}${selectableRow ? " ibx-assistant-saved-mini-selectable" : ""}${isTotalRow ? " ibx-assistant-saved-mini-total" : ""}`;
                cell.textContent = value;
                cell.title = value;
                if (selectableRow) {
                    cell.setAttribute("role", "button");
                    cell.setAttribute("tabindex", "0");
                    cell.addEventListener("click", (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        toggle(ev);
                    });
                    cell.addEventListener("keydown", (ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                            ev.preventDefault();
                            toggle(ev);
                        }
                    });
                }
                rowCells.push(cell);
                grid.appendChild(cell);
            });
        });
        host.appendChild(grid);
        this.attachSavedReportMiniColumnResize(doc, host, grid, report, columns, columnWidths, baseColumnWidths, applyMiniColumnWidths);
        return true;
    }

    private appendSavedReportMiniChart(doc: Document, host: HTMLElement, chart: NonNullable<AssistantResponse["chart"]>, size: AssistantSavedReportTileSize): boolean {
        void size;
        const values = (chart.values || []).map((value) => Math.max(0, Number(value) || 0));
        if (!values.length) return false;
        const labels = chart.labels || [];
        const valueLabels = chart.valueLabels || [];
        const max = Math.max(...values, 1);
        const rows = values.slice();
        const chartHost = doc.createElement("div");
        chartHost.className = "ibx-assistant-saved-mini-chart";
        rows.forEach((value, index) => {
            const row = doc.createElement("div");
            row.className = "ibx-assistant-saved-mini-chart-row";
            const label = doc.createElement("div");
            label.className = "ibx-assistant-saved-mini-chart-label";
            label.textContent = String(labels[index] || "");
            label.title = String(labels[index] || "");
            const barWrap = doc.createElement("div");
            barWrap.className = "ibx-assistant-saved-mini-chart-bar-wrap";
            const bar = doc.createElement("div");
            bar.className = "ibx-assistant-saved-mini-chart-bar";
            bar.style.width = `${Math.max(4, Math.round((value / max) * 100))}%`;
            const val = doc.createElement("span");
            val.className = "ibx-assistant-saved-mini-chart-value";
            val.textContent = String(valueLabels[index] || value);
            barWrap.appendChild(bar);
            barWrap.appendChild(val);
            row.appendChild(label);
            row.appendChild(barWrap);
            chartHost.appendChild(row);
        });
        host.appendChild(chartHost);
        return true;
    }

    private appendSavedReportMiniKpi(doc: Document, host: HTMLElement, kpi: NonNullable<AssistantResponse["kpi"]>): boolean {
        const wrap = doc.createElement("div");
        wrap.className = "ibx-assistant-saved-mini-kpi";
        const value = doc.createElement("div");
        value.className = "ibx-assistant-saved-mini-kpi-value";
        value.textContent = kpi.value || "N/A";
        value.title = kpi.value || "N/A";
        const scope = doc.createElement("div");
        scope.className = "ibx-assistant-saved-mini-kpi-scope";
        scope.textContent = kpi.scopeLabel || kpi.metricName || "KPI";
        wrap.appendChild(value);
        wrap.appendChild(scope);
        host.appendChild(wrap);
        return true;
    }

    private appendSavedReportPreview(doc: Document, card: HTMLElement, report: AssistantPinnedMatrixReport, size: AssistantSavedReportTileSize): void {
        const preview = doc.createElement("div");
        preview.className = `ibx-assistant-saved-preview ibx-assistant-saved-preview--${report.kpiSnapshot ? "kpi" : report.chartSnapshot ? "chart" : "table"}`;
        const rendered = report.kpiSnapshot
            ? this.appendSavedReportMiniKpi(doc, preview, report.kpiSnapshot)
            : report.chartSnapshot
            ? this.appendSavedReportMiniChart(doc, preview, report.chartSnapshot, size)
            : this.appendSavedReportMiniTable(doc, preview, report, size);
        if (!rendered) {
            this.savedReportSummaryLines(report).slice(0, size === "large" ? 3 : 2).forEach((line) => {
                const item = doc.createElement("div");
                item.className = "ibx-assistant-saved-preview-line";
                item.textContent = line;
                preview.appendChild(item);
            });
        }
        card.appendChild(preview);
    }

    private showSavedReportsView(): void {
        this.setOpen(true);
        this.toggleFullscreenChat(true);
        this.hideAutocomplete();
        if (!this.savedReportsViewOpen) {
            this.savedReportsPreviousMessages = Array.from(this.messages.childNodes);
        }
        this.savedReportsViewOpen = true;
        this.savedReportsDetailId = null;
        this.activeSavedReportRenderContext = null;
        this.root.classList.add("ibx-assistant--saved-view");
        this.messages.replaceChildren();
        this.activeOutputHost = null;
        this.editingTurnRoot = null;

        const doc = this.host.ownerDocument || document;
        const wrap = doc.createElement("div");
        wrap.className = "ibx-assistant-saved-view";

        const head = doc.createElement("div");
        head.className = "ibx-assistant-saved-head";
        const titleGroup = doc.createElement("div");
        titleGroup.className = "ibx-assistant-saved-title-group";
        const back = doc.createElement("button");
        back.type = "button";
        back.className = "ibx-assistant-saved-back";
        const backIcon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        backIcon.classList.add("ibx-assistant-saved-back-icon");
        backIcon.setAttribute("viewBox", "0 0 20 20");
        backIcon.setAttribute("aria-hidden", "true");
        const backPath = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        backPath.setAttribute("d", "M11.5 5.5 7 10l4.5 4.5M7.5 10H15");
        backIcon.appendChild(backPath);
        const backLabel = doc.createElement("span");
        backLabel.textContent = "askBICS Assistant";
        back.appendChild(backIcon);
        back.appendChild(backLabel);
        back.setAttribute("data-ibx-tip", "Return to the chat");
        back.setAttribute("aria-label", "Back to askBICS Assistant");
        back.addEventListener("click", (ev) => {
            ev.preventDefault();
            this.closeSavedReportsView();
        });
        const title = doc.createElement("div");
        title.className = "ibx-assistant-saved-title";
        title.textContent = "Saved Reports";
        titleGroup.appendChild(back);
        titleGroup.appendChild(title);
        const reports = this.savedReportsForDisplay();
        const actions = doc.createElement("div");
        actions.className = "ibx-assistant-saved-head-actions";
        if (this.pinnedMatrixReports.length) {
            if (this.savedReportsLayoutEditing) {
                const saveLayout = doc.createElement("button");
                saveLayout.type = "button";
                saveLayout.className = "ibx-assistant-saved-inline-btn ibx-assistant-saved-inline-btn--primary";
                saveLayout.textContent = "Save layout";
                saveLayout.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    this.saveSavedReportsLayout();
                });
                const cancelLayout = doc.createElement("button");
                cancelLayout.type = "button";
                cancelLayout.className = "ibx-assistant-saved-inline-btn";
                cancelLayout.textContent = "Cancel";
                cancelLayout.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    this.cancelSavedReportsLayoutEdit();
                });
                actions.appendChild(saveLayout);
                actions.appendChild(cancelLayout);
            } else {
                const editLayout = doc.createElement("button");
                editLayout.type = "button";
                editLayout.className = "ibx-assistant-saved-inline-btn";
                editLayout.textContent = "Edit layout";
                editLayout.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    this.beginSavedReportsLayoutEdit();
                });
                actions.appendChild(editLayout);
            }
        }
        const meta = doc.createElement("div");
        meta.className = "ibx-assistant-saved-meta";
        meta.textContent = this.pinnedMatrixReports.length
            ? `${this.pinnedMatrixReports.length} saved report${this.pinnedMatrixReports.length === 1 ? "" : "s"}`
            : "No saved reports yet";
        actions.insertBefore(meta, actions.firstChild);
        head.appendChild(titleGroup);
        head.appendChild(actions);
        wrap.appendChild(head);

        if (!reports.length) {
            const empty = doc.createElement("div");
            empty.className = "ibx-assistant-saved-empty";
            empty.textContent = "Pin an answer to save it here.";
            wrap.appendChild(empty);
        } else {
            const list = doc.createElement("div");
            const canvasLayout = this.savedReportsLayoutEditing || this.hasSavedReportCanvasLayout(reports);
            list.className = `ibx-assistant-saved-list${this.savedReportsLayoutEditing ? " ibx-assistant-saved-list--editing" : ""}${canvasLayout ? " ibx-assistant-saved-list--canvas" : ""}`;
            if (canvasLayout) list.style.height = `${this.savedReportsCanvasHeight(reports)}px`;
            reports.forEach((report, index) => list.appendChild(this.createSavedReportCard(doc, report, this.savedReportsLayoutEditing, index)));
            wrap.appendChild(list);
        }

        this.messages.appendChild(wrap);
        this.messages.scrollTop = 0;
    }

    private closeSavedReportsView(): void {
        if (!this.savedReportsViewOpen) return;
        this.savedReportsViewOpen = false;
        this.savedReportsDetailId = null;
        this.activeSavedReportRenderContext = null;
        this.savedReportsLayoutEditing = false;
        this.savedReportsLayoutDraft = null;
        this.savedReportsDraggingId = null;
        this.root.classList.remove("ibx-assistant--saved-view");
        const previous = this.savedReportsPreviousMessages || [];
        this.savedReportsPreviousMessages = null;
        this.messages.replaceChildren(...previous);
        this.messages.scrollTop = this.messages.scrollHeight;
    }

    private createSavedReportCard(doc: Document, report: AssistantPinnedMatrixReport, editMode: boolean = false, index: number = 0): HTMLElement {
        const card = doc.createElement("div");
        const size = this.normalizeSavedReportTileSize(report.layout?.size);
        const height = this.normalizeSavedReportTileHeight(report.layout?.height);
        const gridW = this.normalizeSavedReportGridWidth(report.layout?.w, size);
        const gridH = this.normalizeSavedReportGridHeight(report.layout?.h, height);
        const canvasRect = this.savedReportCanvasRect(report, index);
        const useCanvasLayout = editMode || Number.isFinite(Number(report.layout?.x)) || Number.isFinite(Number(report.layout?.y)) || Number.isFinite(Number(report.layout?.pxW)) || Number.isFinite(Number(report.layout?.pxH));
        const headerColor = this.savedReportHeaderColor(report);
        card.className = `ibx-assistant-saved-card ibx-assistant-saved-card--${size} ibx-assistant-saved-card--h-${height}${editMode ? " ibx-assistant-saved-card--editing" : ""}`;
        card.style.setProperty("--saved-w", String(gridW));
        card.style.setProperty("--saved-h", String(gridH));
        card.style.setProperty("--saved-header-color", headerColor);
        card.style.setProperty("--saved-header-text", this.savedReportHeaderTextColor(headerColor));
        if (useCanvasLayout) {
            card.style.left = `${canvasRect.x}px`;
            card.style.top = `${canvasRect.y}px`;
            card.style.width = `${canvasRect.w}px`;
            card.style.height = `${canvasRect.h}px`;
        }
        card.tabIndex = editMode ? -1 : 0;
        card.setAttribute("role", "listitem");
        card.setAttribute("aria-label", editMode ? `Move or resize saved report ${report.name}` : `Saved report ${report.name}`);
        card.dataset.ibxReportId = report.id;
        if (editMode) {
            card.addEventListener("pointerdown", (ev) => {
                const target = ev.target as HTMLElement | null;
                if (target?.closest("button,input,select,textarea,.ibx-assistant-saved-resize")) return;
                ev.preventDefault();
                const startX = ev.clientX;
                const startY = ev.clientY;
                const startRect = this.savedReportCanvasRect(report, index);
                const win = doc.defaultView || window;
                card.setPointerCapture?.(ev.pointerId);
                card.classList.add("ibx-assistant-saved-card--dragging");
                const applyPosition = (clientX: number, clientY: number): void => {
                    const nextX = Math.max(0, Math.round(startRect.x + clientX - startX));
                    const nextY = Math.max(0, Math.round(startRect.y + clientY - startY));
                    card.style.left = `${nextX}px`;
                    card.style.top = `${nextY}px`;
                    const parent = card.parentElement;
                    if (parent) parent.style.height = `${Math.max(parent.clientHeight, nextY + startRect.h + 24)}px`;
                    this.setSavedReportDraftCanvasRect(report.id, { x: nextX, y: nextY, w: startRect.w, h: startRect.h });
                };
                const onMove = (moveEv: PointerEvent): void => {
                    moveEv.preventDefault();
                    applyPosition(moveEv.clientX, moveEv.clientY);
                };
                const onUp = (upEv: PointerEvent): void => {
                    upEv.preventDefault();
                    card.releasePointerCapture?.(ev.pointerId);
                    card.classList.remove("ibx-assistant-saved-card--dragging");
                    win.removeEventListener("pointermove", onMove);
                    win.removeEventListener("pointerup", onUp);
                };
                win.addEventListener("pointermove", onMove);
                win.addEventListener("pointerup", onUp);
            });
        }

        const top = doc.createElement("div");
        top.className = "ibx-assistant-saved-card-top";
        if (editMode) {
            const handle = doc.createElement("span");
            handle.className = "ibx-assistant-saved-drag";
            handle.textContent = "⋮⋮";
            handle.setAttribute("aria-hidden", "true");
            top.appendChild(handle);
        }
        const titleStack = doc.createElement("div");
        titleStack.className = "ibx-assistant-saved-card-title-stack";
        if (!editMode && this.savedReportRenamingId !== report.id) {
            const headerName = doc.createElement("div");
            headerName.className = "ibx-assistant-saved-card-name ibx-assistant-saved-card-name--header";
            headerName.textContent = report.name;
            headerName.title = report.name;
            titleStack.appendChild(headerName);
        }
        if (editMode) {
            const headerName = doc.createElement("div");
            headerName.className = "ibx-assistant-saved-card-name ibx-assistant-saved-card-name--header";
            headerName.textContent = report.name;
            headerName.title = report.name;
            titleStack.appendChild(headerName);
        }
        const menuWrap = doc.createElement("div");
        menuWrap.className = "ibx-assistant-saved-menu-wrap";
        menuWrap.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
        });
        const menuButton = doc.createElement("button");
        menuButton.type = "button";
        menuButton.className = "ibx-assistant-saved-menu-button";
        menuButton.textContent = "...";
        menuButton.setAttribute("aria-label", "Report actions");
        menuButton.setAttribute("data-ibx-tip", "Report actions");
        const actionsWrap = doc.createElement("div");
        actionsWrap.className = "ibx-assistant-saved-card-actions";
        if (!editMode) {
            const expandButton = doc.createElement("button");
            expandButton.type = "button";
            expandButton.className = "ibx-assistant-saved-menu-button ibx-assistant-saved-expand-button";
            expandButton.setAttribute("aria-label", "Expand saved report");
            expandButton.setAttribute("data-ibx-tip", "Expand report");
            const expandIcon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
            expandIcon.setAttribute("viewBox", "0 0 20 20");
            expandIcon.setAttribute("aria-hidden", "true");
            const expandPath = doc.createElementNS("http://www.w3.org/2000/svg", "path");
            expandPath.setAttribute("d", "M7 4H4v3M4 4l5 5M13 16h3v-3M16 16l-5-5");
            expandIcon.appendChild(expandPath);
            expandButton.appendChild(expandIcon);
            expandButton.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this.openSavedMatrixReport(report);
            });
            actionsWrap.appendChild(expandButton);
        }
        const menu = doc.createElement("div");
        menu.className = "ibx-assistant-saved-menu";
        menu.setAttribute("role", "menu");
        menu.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
        });
        let outsideMenuHandler: ((ev: Event) => void) | null = null;
        const closeMenu = (): void => {
            menu.classList.remove("is-open");
            menuButton.classList.remove("is-open");
            if (outsideMenuHandler) {
                doc.removeEventListener("pointerdown", outsideMenuHandler, true);
                outsideMenuHandler = null;
            }
        };
        const toggleMenu = (ev: Event): void => {
            ev.preventDefault();
            ev.stopPropagation();
            const willOpen = !menu.classList.contains("is-open");
            const openMenus = Array.from(this.root.querySelectorAll(".ibx-assistant-saved-menu.is-open"));
            openMenus.forEach((open) => open.classList.remove("is-open"));
            Array.from(this.root.querySelectorAll(".ibx-assistant-saved-menu-button.is-open")).forEach((open) => open.classList.remove("is-open"));
            menu.classList.toggle("is-open", willOpen);
            menuButton.classList.toggle("is-open", willOpen);
            if (willOpen) {
                outsideMenuHandler = (outsideEv: Event): void => {
                    const target = outsideEv.target as Node | null;
                    if (target && menuWrap.contains(target)) return;
                    closeMenu();
                };
                (doc.defaultView || window).setTimeout(() => {
                    if (outsideMenuHandler) doc.addEventListener("pointerdown", outsideMenuHandler, true);
                }, 0);
            } else {
                closeMenu();
            }
        };
        menuButton.addEventListener("click", toggleMenu);
        const addMenuItem = (label: string, tip: string, onClick: () => void, danger = false): void => {
            const item = doc.createElement("button");
            item.type = "button";
            item.className = danger ? "ibx-assistant-saved-menu-item ibx-assistant-saved-menu-item--danger" : "ibx-assistant-saved-menu-item";
            item.textContent = label;
            item.setAttribute("role", "menuitem");
            item.setAttribute("aria-label", tip);
            let handled = false;
            const runAction = (ev: Event): void => {
                ev.preventDefault();
                ev.stopPropagation();
                if (handled) return;
                handled = true;
                closeMenu();
                onClick();
                (doc.defaultView || window).setTimeout(() => {
                    handled = false;
                }, 0);
            };
            item.addEventListener("pointerdown", runAction);
            item.addEventListener("mousedown", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
            });
            item.addEventListener("click", runAction);
            menu.appendChild(item);
        };
        addMenuItem("Edit", "Edit saved report rows, columns, and measures", () => this.editSavedMatrixReportById(report.id));
        addMenuItem("Rename", "Rename saved report", () => this.renameSavedMatrixReportById(report.id));
        const colorLabel = doc.createElement("label");
        colorLabel.className = "ibx-assistant-saved-color-picker";
        colorLabel.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        colorLabel.addEventListener("mousedown", (ev) => ev.stopPropagation());
        colorLabel.addEventListener("click", (ev) => ev.stopPropagation());
        const colorText = doc.createElement("span");
        colorText.textContent = "Header color";
        const colorSwatch = doc.createElement("button");
        colorSwatch.type = "button";
        colorSwatch.className = "ibx-assistant-saved-color-swatch";
        colorSwatch.style.background = headerColor;
        colorSwatch.setAttribute("aria-label", "Choose saved report header color");
        colorSwatch.setAttribute("data-ibx-tip", "Choose header color");
        colorSwatch.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const currentColor = this.normalizeSavedReportHeaderColor(report.layout?.headerColor) || headerColor;
            this.openSavedReportColorPicker(report.id, currentColor, colorSwatch, (nextColor) => {
                card.style.setProperty("--saved-header-color", nextColor);
                card.style.setProperty("--saved-header-text", this.savedReportHeaderTextColor(nextColor));
                colorSwatch.style.background = nextColor;
            });
            closeMenu();
        });
        colorLabel.appendChild(colorText);
        colorLabel.appendChild(colorSwatch);
        addMenuItem("Delete", "Delete saved report", () => this.deleteSavedMatrixReportById(report.id), true);
        menu.appendChild(colorLabel);
        menuWrap.appendChild(menuButton);
        menuWrap.appendChild(menu);
        top.appendChild(titleStack);
        actionsWrap.appendChild(menuWrap);
        if (!editMode) top.appendChild(actionsWrap);
        card.appendChild(top);

        if (editMode) {
            const placeholder = doc.createElement("div");
            placeholder.className = "ibx-assistant-saved-layout-placeholder";
            const icon = doc.createElement("div");
            icon.className = "ibx-assistant-saved-layout-icon";
            icon.textContent = "Report";
            const lines = doc.createElement("div");
            lines.className = "ibx-assistant-saved-layout-lines";
            for (let i = 0; i < 4; i++) {
                const line = doc.createElement("span");
                line.className = "ibx-assistant-saved-layout-line";
                lines.appendChild(line);
            }
            placeholder.appendChild(icon);
            placeholder.appendChild(lines);
            card.appendChild(placeholder);

            const resize = doc.createElement("button");
            resize.type = "button";
            resize.className = "ibx-assistant-saved-resize";
            resize.setAttribute("aria-label", `Resize ${report.name}`);
            resize.setAttribute("data-ibx-tip", "Drag to resize");
            const resizeIcon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
            resizeIcon.setAttribute("viewBox", "0 0 20 20");
            resizeIcon.setAttribute("aria-hidden", "true");
            const resizePath = doc.createElementNS("http://www.w3.org/2000/svg", "path");
            resizePath.setAttribute("d", "M5 15L15 5M9 5h6v6M5 11v4h4");
            resizeIcon.appendChild(resizePath);
            resize.appendChild(resizeIcon);
            resize.addEventListener("pointerdown", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const startX = ev.clientX;
                const startY = ev.clientY;
                const startRect = this.savedReportCanvasRect(report, index);
                const win = doc.defaultView || window;
                resize.setPointerCapture?.(ev.pointerId);
                card.classList.add("ibx-assistant-saved-card--resizing");
                const applySize = (clientX: number, clientY: number): void => {
                    const nextW = Math.max(150, Math.min(980, Math.round(startRect.w + clientX - startX)));
                    const nextH = Math.max(140, Math.min(720, Math.round(startRect.h + clientY - startY)));
                    card.style.width = `${nextW}px`;
                    card.style.height = `${nextH}px`;
                    const parent = card.parentElement;
                    if (parent) parent.style.height = `${Math.max(parent.clientHeight, startRect.y + nextH + 24)}px`;
                    this.setSavedReportDraftCanvasRect(report.id, { x: startRect.x, y: startRect.y, w: nextW, h: nextH });
                };
                const onMove = (moveEv: PointerEvent): void => {
                    moveEv.preventDefault();
                    applySize(moveEv.clientX, moveEv.clientY);
                };
                const onUp = (upEv: PointerEvent): void => {
                    upEv.preventDefault();
                    resize.releasePointerCapture?.(ev.pointerId);
                    card.classList.remove("ibx-assistant-saved-card--resizing");
                    win.removeEventListener("pointermove", onMove);
                    win.removeEventListener("pointerup", onUp);
                };
                win.addEventListener("pointermove", onMove);
                win.addEventListener("pointerup", onUp);
            });
            card.appendChild(resize);
            return card;
        }

        if (!editMode && this.savedReportRenamingId === report.id) {
            const form = doc.createElement("form");
            form.className = "ibx-assistant-saved-rename";
            form.addEventListener("pointerdown", (ev) => ev.stopPropagation());
            form.addEventListener("mousedown", (ev) => ev.stopPropagation());
            form.addEventListener("click", (ev) => ev.stopPropagation());
            form.addEventListener("submit", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this.commitSavedReportRenameById(report.id, input.value);
            });
            const input = doc.createElement("input");
            input.className = "ibx-assistant-saved-rename-input";
            input.type = "text";
            input.value = report.name;
            input.maxLength = 80;
            input.setAttribute("aria-label", "Saved report name");
            input.setAttribute("placeholder", "Report name");
            const actions = doc.createElement("div");
            actions.className = "ibx-assistant-saved-rename-actions";
            const save = doc.createElement("button");
            save.type = "button";
            save.className = "ibx-assistant-saved-icon-btn ibx-assistant-saved-icon-btn--primary";
            save.textContent = "✓";
            save.setAttribute("aria-label", "Save report name");
            save.setAttribute("data-ibx-tip", "Save name");
            let renameHandled = false;
            const commitRename = (ev: Event): void => {
                ev.preventDefault();
                ev.stopPropagation();
                if (renameHandled) return;
                renameHandled = true;
                this.commitSavedReportRenameById(report.id, input.value);
            };
            save.addEventListener("pointerdown", commitRename);
            save.addEventListener("mousedown", commitRename);
            save.addEventListener("click", commitRename);
            input.addEventListener("keydown", (ev) => {
                if (ev.key !== "Enter") return;
                commitRename(ev);
            });
            const cancel = doc.createElement("button");
            cancel.type = "button";
            cancel.className = "ibx-assistant-saved-icon-btn";
            cancel.appendChild(this.createCloseIcon(doc));
            cancel.setAttribute("aria-label", "Cancel rename");
            cancel.setAttribute("data-ibx-tip", "Cancel rename");
            cancel.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this.cancelSavedReportCardAction();
            });
            form.appendChild(input);
            actions.appendChild(save);
            actions.appendChild(cancel);
            form.appendChild(actions);
            card.appendChild(form);
            (doc.defaultView || window).setTimeout(() => {
                input.focus();
                input.select();
            }, 0);
        }

        this.appendSavedReportPreview(doc, card, report, size);

        if (!editMode && this.savedReportDeleteConfirmId === report.id) {
            const confirm = doc.createElement("div");
            confirm.className = "ibx-assistant-saved-delete-confirm";
            confirm.addEventListener("pointerdown", (ev) => ev.stopPropagation());
            confirm.addEventListener("mousedown", (ev) => ev.stopPropagation());
            confirm.addEventListener("click", (ev) => ev.stopPropagation());
            const text = doc.createElement("div");
            text.className = "ibx-assistant-saved-delete-text";
            text.textContent = "Delete this saved report?";
            const actions = doc.createElement("div");
            actions.className = "ibx-assistant-saved-delete-actions";
            const cancel = doc.createElement("button");
            cancel.type = "button";
            cancel.className = "ibx-assistant-saved-inline-btn";
            cancel.textContent = "Cancel";
            cancel.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this.cancelSavedReportCardAction();
            });
            const remove = doc.createElement("button");
            remove.type = "button";
            remove.className = "ibx-assistant-saved-inline-btn ibx-assistant-saved-inline-btn--danger";
            remove.textContent = "Delete";
            remove.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this.confirmDeleteSavedMatrixReportById(report.id);
            });
            actions.appendChild(cancel);
            actions.appendChild(remove);
            confirm.appendChild(text);
            confirm.appendChild(actions);
            card.appendChild(confirm);
        }

        return card;
    }

    private openSavedMatrixReport(report: AssistantPinnedMatrixReport): void {
        this.savedReportRenamingId = null;
        this.savedReportDeleteConfirmId = null;
        this.showSavedReportDetail(report);
    }

    private editSavedMatrixReportById(id: string): void {
        const report = this.pinnedMatrixReports.find((item) => item.id === id);
        if (!report) return;
        this.savedReportRenamingId = null;
        this.savedReportDeleteConfirmId = null;
        this.showSavedReportDetail(report, true);
    }

    private updateSavedReportTableQuery(id: string, query: AssistantEditableTableQuery): void {
        const report = this.pinnedMatrixReports.find((item) => item.id === id);
        if (!report) return;
        const clean = this.cloneTableQuery(query);
        report.type = "table";
        report.tableQuery = clean;
        report.query = this.tableQueryToMatrixQuery(clean);
        report.tableSnapshot = undefined;
        report.chartSnapshot = undefined;
        report.updatedAt = Date.now();
        this.savePinnedMatrixReports();
        this.showSavedReportDetail(report, true);
    }

    private updateSavedReportMatrixQuery(id: string, query: MatrixQuery): void {
        const report = this.pinnedMatrixReports.find((item) => item.id === id);
        if (!report) return;
        report.type = "matrix";
        report.query = normalizeMatrixQuery(query);
        report.tableQuery = undefined;
        report.tableSnapshot = undefined;
        report.chartSnapshot = undefined;
        report.updatedAt = Date.now();
        this.savePinnedMatrixReports();
        this.showSavedReportDetail(report, true);
    }

    private showSavedReportDetail(report: AssistantPinnedMatrixReport, openEditor: boolean = false): void {
        this.setOpen(true);
        this.toggleFullscreenChat(true);
        this.hideAutocomplete();
        if (!this.savedReportsViewOpen) {
            this.savedReportsPreviousMessages = Array.from(this.messages.childNodes);
        }
        this.savedReportsViewOpen = true;
        this.savedReportsDetailId = report.id;
        this.root.classList.add("ibx-assistant--saved-view");
        this.messages.replaceChildren();
        this.activeOutputHost = null;
        this.editingTurnRoot = null;

        const doc = this.host.ownerDocument || document;
        const wrap = doc.createElement("div");
        wrap.className = "ibx-assistant-saved-view ibx-assistant-saved-report-view";

        const head = doc.createElement("div");
        head.className = "ibx-assistant-saved-head ibx-assistant-saved-report-head";
        const titleGroup = doc.createElement("div");
        titleGroup.className = "ibx-assistant-saved-title-group";

        const back = doc.createElement("button");
        back.type = "button";
        back.className = "ibx-assistant-saved-back";
        const backIcon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        backIcon.classList.add("ibx-assistant-saved-back-icon");
        backIcon.setAttribute("viewBox", "0 0 20 20");
        backIcon.setAttribute("aria-hidden", "true");
        const backPath = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        backPath.setAttribute("d", "M11.5 5.5 7 10l4.5 4.5M7.5 10H15");
        backIcon.appendChild(backPath);
        const backLabel = doc.createElement("span");
        backLabel.textContent = "Saved Reports";
        back.appendChild(backIcon);
        back.appendChild(backLabel);
        back.setAttribute("data-ibx-tip", "Return to saved reports");
        back.setAttribute("aria-label", "Back to Saved Reports");
        back.addEventListener("click", (ev) => {
            ev.preventDefault();
            this.showSavedReportsView();
        });

        const titleWrap = doc.createElement("div");
        titleWrap.className = "ibx-assistant-saved-report-title-wrap";
        const title = doc.createElement("div");
        title.className = "ibx-assistant-saved-title";
        title.textContent = report.name || "Saved report";
        const subtitle = doc.createElement("div");
        subtitle.className = "ibx-assistant-saved-report-subtitle";
        if (report.kpiSnapshot) {
            subtitle.textContent = "";
        } else if (report.chartSnapshot) {
            subtitle.textContent = `${this.formatSavedReportType(report)} chart`;
        } else if (report.tableSnapshot && !report.tableQuery) {
            subtitle.textContent = `${report.tableSnapshot.columns.length} columns`;
        } else {
            subtitle.textContent = report.type === "table" && report.tableQuery
                ? `${(report.tableQuery.measures || []).join(", ") || "Values"} by ${(report.tableQuery.fields || []).join(" / ") || "columns"}`
                : `${(report.query.values || []).join(", ") || "Values"} by ${(report.query.rows || []).join(" / ") || "rows"}`;
        }
        titleWrap.appendChild(title);
        if (subtitle.textContent) titleWrap.appendChild(subtitle);

        titleGroup.appendChild(back);
        titleGroup.appendChild(titleWrap);

        head.appendChild(titleGroup);
        wrap.appendChild(head);

        const content = doc.createElement("div");
        content.className = "ibx-assistant-saved-report-content";
        wrap.appendChild(content);
        this.messages.appendChild(wrap);

        const prevHost = this.activeOutputHost;
        this.activeOutputHost = content;
        this.activeSavedReportRenderContext = {
            reportId: report.id,
            columnWidths: this.normalizeSavedReportColumnWidths(report.layout?.columnWidths) || {}
        };
        try {
            if (report.kpiSnapshot) {
                this.appendKpiCard(report.kpiSnapshot);
                return;
            }
            if (report.chartSnapshot) {
                this.appendChart(report.chartSnapshot, { text: "", handled: true, chart: report.chartSnapshot }, report.name);
                return;
            }
            if (report.tableSnapshot && !report.tableQuery) {
                this.appendTable(
                    report.tableSnapshot.columns,
                    report.tableSnapshot.rows,
                    report.tableSnapshot.title || report.name
                );
                return;
            }
            const response = report.type === "table" && report.tableQuery
                ? this.engine.answer(this.tableQueryToQuestion(report.tableQuery))
                : this.engine.answerSavedMatrixQuery(report.query);
            if (report.type === "table" && response.table) {
                this.appendTable(response.table.columns, response.table.rows, undefined, response.table.editableQuery, openEditor, (next) => this.updateSavedReportTableQuery(report.id, next));
            } else if (report.type === "table" && response.tables?.length) {
                response.tables.forEach((table, index) => this.appendTable(table.columns, table.rows, table.title, table.editableQuery, openEditor && index === 0, (next) => this.updateSavedReportTableQuery(report.id, next)));
            } else if (response.matrix) {
                this.appendMatrix(response.matrix, openEditor, (next) => this.updateSavedReportMatrixQuery(report.id, next));
            } else if (response.table) {
                this.appendTable(response.table.columns, response.table.rows, undefined, response.table.editableQuery, openEditor, (next) => this.updateSavedReportTableQuery(report.id, next));
            } else if (response.tables?.length) {
                response.tables.forEach((table, index) => this.appendTable(table.columns, table.rows, table.title, table.editableQuery, openEditor && index === 0, (next) => this.updateSavedReportTableQuery(report.id, next)));
            } else {
                this.appendMessage(response.text || "This saved report could not be opened.", "assistant");
            }
        } finally {
            this.activeOutputHost = prevHost;
        }
        this.messages.scrollTop = 0;
    }

    private renameSavedMatrixReportById(id: string): void {
        if (!this.pinnedMatrixReports.some((item) => item.id === id)) return;
        this.savedReportRenamingId = id;
        this.savedReportDeleteConfirmId = null;
        this.showSavedReportsView();
    }

    private commitSavedReportRenameById(id: string, nextName: string): void {
        const report = this.pinnedMatrixReports.find((item) => item.id === id);
        if (!report) return;
        const name = nextName.trim().slice(0, 80);
        if (!name) return;
        report.name = name;
        if (report.tableSnapshot) report.tableSnapshot.title = name;
        if (report.chartSnapshot) report.chartSnapshot.title = name;
        if (report.kpiSnapshot) report.kpiSnapshot.title = name;
        report.updatedAt = Date.now();
        this.savedReportRenamingId = null;
        this.savedReportDeleteConfirmId = null;
        this.savePinnedMatrixReports();
        this.showSavedReportsView();
    }

    private cancelSavedReportCardAction(): void {
        this.savedReportRenamingId = null;
        this.savedReportDeleteConfirmId = null;
        this.showSavedReportsView();
    }

    private duplicateSavedMatrixReport(id: string): void {
        const report = this.pinnedMatrixReports.find((item) => item.id === id);
        if (!report) return;
        const now = Date.now();
        const copy: AssistantPinnedMatrixReport = {
            id: `matrix-${now}`,
            name: `Copy of ${report.name}`.slice(0, 80),
            type: report.type || "matrix",
            query: cloneMatrixQuery(report.query),
            tableQuery: report.tableQuery ? this.cloneTableQuery(report.tableQuery) : undefined,
            tableSnapshot: report.tableSnapshot
                ? {
                    title: report.tableSnapshot.title,
                    columns: report.tableSnapshot.columns.slice(),
                    rows: report.tableSnapshot.rows.map((row) => row.slice())
                }
                : undefined,
            chartSnapshot: report.chartSnapshot
                ? {
                    type: report.chartSnapshot.type,
                    title: report.chartSnapshot.title,
                    labels: (report.chartSnapshot.labels || []).slice(),
                    values: (report.chartSnapshot.values || []).slice(),
                    valueLabels: (report.chartSnapshot.valueLabels || []).slice(),
                    series: report.chartSnapshot.series?.map((series) => ({
                        name: series.name,
                        labels: (series.labels || []).slice(),
                        values: (series.values || []).slice(),
                        valueLabels: (series.valueLabels || []).slice()
                    }))
                }
                : undefined,
            kpiSnapshot: report.kpiSnapshot ? { ...report.kpiSnapshot } : undefined,
            layout: {
                size: this.normalizeSavedReportTileSize(report.layout?.size),
                height: this.normalizeSavedReportTileHeight(report.layout?.height),
                w: this.normalizeSavedReportGridWidth(report.layout?.w, report.layout?.size),
                h: this.normalizeSavedReportGridHeight(report.layout?.h, report.layout?.height),
                pxW: Number.isFinite(Number(report.layout?.pxW)) ? Number(report.layout?.pxW) : undefined,
                pxH: Number.isFinite(Number(report.layout?.pxH)) ? Number(report.layout?.pxH) : undefined,
                headerColor: this.normalizeSavedReportHeaderColor(report.layout?.headerColor),
                columnWidths: this.normalizeSavedReportColumnWidths(report.layout?.columnWidths)
            },
            createdAt: now,
            updatedAt: now
        };
        this.assignNewSavedReportCanvasLayout(copy);
        this.pinnedMatrixReports.unshift(copy);
        this.pinnedMatrixReports = this.pinnedMatrixReports.slice(0, 12);
        this.savePinnedMatrixReports();
        this.showSavedReportsView();
    }

    private deleteSavedMatrixReportById(id: string): void {
        if (!this.pinnedMatrixReports.some((item) => item.id === id)) return;
        this.savedReportDeleteConfirmId = id;
        this.savedReportRenamingId = null;
        this.showSavedReportsView();
    }

    private confirmDeleteSavedMatrixReportById(id: string): void {
        this.pinnedMatrixReports = this.pinnedMatrixReports.filter((item) => item.id !== id);
        this.savedReportRenamingId = null;
        this.savedReportDeleteConfirmId = null;
        this.savePinnedMatrixReports();
        this.showSavedReportsView();
    }

    private createPinnedMatrixReports(doc: Document): HTMLElement | null {
        if (!this.pinnedMatrixReports.length) return null;
        const wrap = doc.createElement("div");
        wrap.className = "ibx-assistant-pinned-matrix";
        const title = doc.createElement("div");
        title.className = "ibx-assistant-matrix-editor-title";
        title.textContent = "Pinned reports";
        wrap.appendChild(title);
        const row = doc.createElement("div");
        row.className = "ibx-assistant-matrix-editor-row";
        this.pinnedMatrixReports.slice(0, 6).forEach((report) => {
            const item = doc.createElement("span");
            item.className = "ibx-assistant-pinned-item";
            const btn = doc.createElement("button");
            btn.type = "button";
            btn.className = "ibx-assistant-chip";
            btn.textContent = report.name;
            btn.setAttribute("data-ibx-tip", report.type === "table" && report.tableQuery
                ? this.tableQueryToQuestion(report.tableQuery)
                : this.matrixQueryToQuestion(report.query));
            btn.addEventListener("click", (ev) => {
                ev.preventDefault();
                this.openSavedMatrixReport(report);
            });
            const del = doc.createElement("button");
            del.type = "button";
            del.className = "ibx-assistant-pinned-delete";
            del.appendChild(this.createCloseIcon(doc));
            del.setAttribute("aria-label", `Delete ${report.name}`);
            del.setAttribute("data-ibx-tip", `Delete ${report.name}`);
            del.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this.pinnedMatrixReports = this.pinnedMatrixReports.filter((itemReport) => itemReport.id !== report.id);
                this.savePinnedMatrixReports();
                this.appendMessage(`Deleted pinned report "${report.name}".`, "assistant");
            });
            item.appendChild(btn);
            item.appendChild(del);
            row.appendChild(item);
        });
        wrap.appendChild(row);
        return wrap;
    }

    private pinnedReportsResponse(): AssistantResponse {
        if (!this.pinnedMatrixReports.length) {
            return { handled: true, text: "No pinned matrix reports yet." };
        }
        return {
            handled: true,
            text: `Pinned matrix reports: ${this.pinnedMatrixReports.map((report) => report.name).join(", ")}.`,
            table: {
                columns: ["Report", "Type", "Rows", "Columns", "Values", "Updated"],
                rows: this.pinnedMatrixReports.map((report) => [
                    report.name,
                    "Matrix",
                    (report.query.rows || []).join(", ") || "-",
                    (report.query.columns || []).join(", ") || "-",
                    (report.query.values || []).join(", ") || "-",
                    this.formatSavedReportDate(report.updatedAt || report.createdAt)
                ])
            },
            suggestions: this.pinnedMatrixReports.slice(0, 5).map((report) => report.name)
        };
    }

    private deletePinnedMatrixReport(phrase: string): string {
        const clean = this.normalizeMatrixCommand(phrase);
        const index = this.pinnedMatrixReports.findIndex((report) => {
            const name = this.normalizeMatrixCommand(report.name);
            return name === clean || name.indexOf(clean) >= 0 || clean.indexOf(name) >= 0;
        });
        if (index < 0) return "";
        const [removed] = this.pinnedMatrixReports.splice(index, 1);
        this.savePinnedMatrixReports();
        return removed?.name || "";
    }

    private renamePinnedMatrixReport(phrase: string, nextName: string): string {
        const clean = this.normalizeMatrixCommand(phrase);
        const report = this.pinnedMatrixReports.find((item) => {
            const name = this.normalizeMatrixCommand(item.name);
            return name === clean || name.indexOf(clean) >= 0 || clean.indexOf(name) >= 0;
        });
        const name = String(nextName || "").trim();
        if (!report || !name) return "";
        report.name = name.slice(0, 80);
        report.updatedAt = Date.now();
        this.savePinnedMatrixReports();
        return report.name;
    }

    private toggleFullscreenChat(force?: boolean): void {
        const next = typeof force === "boolean"
            ? force
            : !this.root.classList.contains("ibx-assistant--fullscreen");
        this.updateRootFrame();
        this.root.classList.toggle("ibx-assistant--fullscreen", next);
        if (next) this.clearCompactPanelPosition();
        else this.positionCompactPanel();
        const expandBtn = this.root.querySelector(".ibx-assistant-expand") as HTMLButtonElement | null;
        if (expandBtn) {
            expandBtn.textContent = next ? "↙" : "⛶";
            expandBtn.setAttribute("aria-label", next ? "Exit full screen AI chat" : "Expand AI chat");
            expandBtn.setAttribute("data-ibx-tip", next ? "Exit full screen" : "Expand AI chat");
        }
        const title = this.root.querySelector(".ibx-assistant-title") as HTMLDivElement | null;
        if (title) title.textContent = next ? "askBICS Assistant · Full screen" : "askBICS Assistant";
        if (next && !this.open) this.setOpen(true);
        if (next) this.messages.scrollTop = this.messages.scrollHeight;
    }

    private appendBenchmarkCellContent(doc: Document, cell: HTMLElement, text: string): boolean {
        const clean = String(text || "").trim();
        if (/^average$/i.test(clean)) {
            const main = doc.createElement("span");
            main.className = "ibx-assistant-benchmark-main ibx-assistant-benchmark-main--average";
            main.textContent = clean;
            cell.appendChild(main);
            return true;
        }
        const match = clean.match(/^(.+?)\s*\((.+)\)$/);
        if (!match) return false;
        const mainText = String(match[1] || "").trim();
        const noteText = String(match[2] || "").trim();
        const wrap = doc.createElement("span");
        wrap.className = "ibx-assistant-benchmark-cell";
        const main = doc.createElement("span");
        const isAverage = /^average$/i.test(mainText);
        const isPercentile = /\bpercentile\b/i.test(mainText);
        main.className = [
            "ibx-assistant-benchmark-main",
            isPercentile ? "ibx-assistant-benchmark-main--percentile" : "",
            isAverage ? "ibx-assistant-benchmark-main--average" : ""
        ].filter(Boolean).join(" ");
        main.textContent = mainText;
        const note = doc.createElement("span");
        note.className = "ibx-assistant-benchmark-note";
        note.textContent = ` (${noteText})`;
        wrap.appendChild(main);
        wrap.appendChild(note);
        cell.appendChild(wrap);
        return true;
    }

    private parseTableNumber(value: string): number {
        const normalized = String(value || "").replace(/,/g, "").replace(/%/g, "").trim();
        if (!normalized || /^n\/a$/i.test(normalized)) return NaN;
        const compact = normalized.match(/^([-+]?\d+(?:\.\d+)?)\s*([kmb])$/i);
        if (compact) {
            const base = Number(compact[1]);
            if (!Number.isFinite(base)) return NaN;
            const suffix = compact[2].toLowerCase();
            const multiplier = suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : 1_000_000_000;
            return base * multiplier;
        }
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : NaN;
    }

    private formatAxisValue(value: number): string {
        if (!Number.isFinite(value) || value === 0) return "0";
        const abs = Math.abs(value);
        if (abs >= 1_000_000) return `${parseFloat((value / 1_000_000).toFixed(1))}M`;
        if (abs >= 1_000) return `${parseFloat((value / 1_000).toFixed(1))}K`;
        if (abs >= 10) return String(Math.round(value));
        return String(parseFloat(value.toFixed(1)));
    }

    private getTableColumnStats(rows: string[][], columnCount: number): Array<{ min: number; max: number; count: number } | null> {
        const stats: Array<{ min: number; max: number; count: number } | null> = [];
        for (let col = 0; col < columnCount; col++) {
            const values = rows.map((row) => this.parseTableNumber(row[col] || "")).filter((value) => Number.isFinite(value));
            if (!values.length) {
                stats[col] = null;
            } else {
                stats[col] = {
                    min: Math.min(...values),
                    max: Math.max(...values),
                    count: values.length
                };
            }
        }
        return stats;
    }

    private measureBarPercent(value: number, stat: { min: number; max: number; count: number } | null): number {
        if (!stat || stat.count <= 0 || !Number.isFinite(value)) return 0;
        const maxAbs = Math.max(Math.abs(stat.min), Math.abs(stat.max));
        if (!Number.isFinite(maxAbs) || maxAbs <= 0) return 0;
        return Math.max(0, Math.min(100, Math.abs(value) / maxAbs * 100));
    }

    private formatComparisonDelta(diff: number, baseline: number, metricName: string = ""): string {
        if (!Number.isFinite(diff) || diff === 0 || !Number.isFinite(baseline) || baseline === 0) return "";
        const arrow = diff > 0 ? "▲" : "▼";
        const comparisonMax = Math.max(Math.abs(baseline), Math.abs(baseline + diff));
        const isPercentageMeasure = this.looksLikePercentageMeasure(metricName);
        const percent = isPercentageMeasure
            ? Math.abs(diff) * (comparisonMax <= 1.5 ? 100 : 1)
            : Math.abs(diff) / Math.abs(baseline) * 100;
        if (!Number.isFinite(percent) || percent <= 0) return "";
        const fixed = percent >= 100
            ? Math.round(percent).toLocaleString(undefined, { maximumFractionDigits: 0 })
            : parseFloat(percent.toFixed(1)).toLocaleString(undefined, { maximumFractionDigits: 1 });
        return `${arrow} ${fixed}%`;
    }

    private looksLikePercentageMeasure(metricName: string): boolean {
        const text = String(metricName || "").toLowerCase();
        return /\b(percent|percentage|share|mix|occupancy|ratio|rate|growth|margin|yield)\b|%/.test(text);
    }

    private buildComparisonInsight(metricName: string, leftName: string, rightName: string, leftText: string, rightText: string): string {
        const left = this.parseTableNumber(leftText || "");
        const right = this.parseTableNumber(rightText || "");
        if (!Number.isFinite(left) || !Number.isFinite(right)) return "";
        const cleanLeft = String(leftName || "First item").trim() || "First item";
        const cleanRight = String(rightName || "Second item").trim() || "Second item";
        const cleanMetric = String(metricName || "this metric").trim() || "this metric";
        if (left === right) {
            const sameValue = String(leftText || rightText || "").trim() || this.formatTableNumber(left);
            return `For ${cleanMetric}, ${cleanLeft} and ${cleanRight} are equal at ${sameValue}.`;
        }
        const configuredLowerBetter = this.engine.metricLowerIsBetter(metricName);
        const lowerBetter = configuredLowerBetter !== null
            ? configuredLowerBetter
            : /\b(ocr|occupancy cost|cost ratio|rent to sales|rent sales ratio|vacancy|vacant|expense|cost)\b/i.test(metricName);
        const betterName = lowerBetter
            ? (left < right ? cleanLeft : cleanRight)
            : (left > right ? cleanLeft : cleanRight);
        const otherValue = betterName === cleanLeft ? right : left;
        const betterValue = betterName === cleanLeft ? left : right;
        const diff = Math.abs(betterValue - otherValue);
        if (!Number.isFinite(diff) || diff <= 0) return "";
        const baseline = Math.abs(otherValue);
        if (!Number.isFinite(baseline) || baseline <= 0) {
            const weakerName = betterName === cleanLeft ? cleanRight : cleanLeft;
            return `For ${cleanMetric}, ${betterName} is ${lowerBetter ? "lower" : "higher"} than ${weakerName} by ${this.formatTableNumber(diff)}.`;
        }
        const percent = diff / baseline * 100;
        if (!Number.isFinite(percent) || percent <= 0) return "";
        const percentText = percent >= 100
            ? Math.round(percent).toLocaleString(undefined, { maximumFractionDigits: 0 })
            : parseFloat(percent.toFixed(1)).toLocaleString(undefined, { maximumFractionDigits: 1 });
        const weakerName = betterName === cleanLeft ? cleanRight : cleanLeft;
        const betterDisplay = betterName === cleanLeft ? String(leftText || "").trim() : String(rightText || "").trim();
        const weakerDisplay = betterName === cleanLeft ? String(rightText || "").trim() : String(leftText || "").trim();
        const valueText = betterDisplay && weakerDisplay ? ` (${betterDisplay} vs ${weakerDisplay})` : "";
        return `For ${cleanMetric}, ${betterName} is ${percentText}% ${lowerBetter ? "lower" : "higher"} than ${weakerName}${valueText}.`;
    }

    private appendMeasureBar(doc: Document, cell: HTMLElement, text: string, percent: number, tone: "good" | "bad" | "neutral", deltaText: string = ""): void {
        cell.classList.add("ibx-assistant-table-cell--bar");
        const bar = doc.createElement("span");
        bar.className = `ibx-assistant-table-cell-bar ibx-assistant-table-cell-bar--${tone}`;
        bar.style.width = `${Math.max(3, Math.min(100, percent))}%`;
        cell.appendChild(bar);
        this.appendMeasureValue(doc, cell, text, deltaText);
    }

    private appendMeasureValue(doc: Document, cell: HTMLElement, text: string, deltaText: string = ""): void {
        const value = doc.createElement("span");
        value.className = "ibx-assistant-table-cell-value";
        const main = doc.createElement("span");
        main.className = "ibx-assistant-table-cell-main-value";
        main.textContent = text;
        value.appendChild(main);
        if (deltaText) {
            const delta = doc.createElement("span");
            delta.className = "ibx-assistant-table-cell-delta";
            const cleanDelta = String(deltaText || "").trim();
            const directionMatch = cleanDelta.match(/^([▲▼])\s*(.*)$/);
            if (directionMatch) {
                const direction = directionMatch[1];
                const percentText = directionMatch[2].trim();
                const open = doc.createElement("span");
                open.className = "ibx-assistant-table-cell-delta-muted";
                open.textContent = "(";
                const arrow = doc.createElement("span");
                arrow.className = `ibx-assistant-table-cell-delta-arrow ${direction === "▲" ? "ibx-assistant-table-cell-delta-arrow--up" : "ibx-assistant-table-cell-delta-arrow--down"}`;
                arrow.textContent = direction;
                const pct = doc.createElement("span");
                pct.className = `ibx-assistant-table-cell-delta-percent ${direction === "▲" ? "ibx-assistant-table-cell-delta-percent--up" : "ibx-assistant-table-cell-delta-percent--down"}`;
                pct.textContent = percentText ? ` ${percentText}` : "";
                const close = doc.createElement("span");
                close.className = "ibx-assistant-table-cell-delta-muted";
                close.textContent = ")";
                delta.appendChild(open);
                delta.appendChild(arrow);
                delta.appendChild(pct);
                delta.appendChild(close);
            } else {
                delta.textContent = `(${cleanDelta})`;
            }
            value.appendChild(delta);
        }
        cell.appendChild(value);
    }

    private appendKpiCard(kpi: NonNullable<AssistantResponse["kpi"]>): void {
        const doc = this.host.ownerDocument || document;
        const wrap = doc.createElement("div");
        wrap.className = "ibx-assistant-kpi-card";
        const head = doc.createElement("div");
        head.className = "ibx-assistant-kpi-head";
        const title = doc.createElement("div");
        title.className = "ibx-assistant-kpi-title";
        title.textContent = kpi.title || kpi.metricName || "KPI";
        title.title = title.textContent;
        head.appendChild(title);
        head.appendChild(this.createPinReportButton(doc, "Save this KPI to Saved Reports", () => this.pinKpiReport(kpi)));
        const value = doc.createElement("div");
        value.className = "ibx-assistant-kpi-value";
        value.textContent = kpi.value || "N/A";
        value.title = kpi.value || "N/A";
        wrap.appendChild(head);
        wrap.appendChild(value);
        if (kpi.scopeLabel) {
            const scope = doc.createElement("div");
            scope.className = "ibx-assistant-kpi-scope";
            scope.textContent = kpi.scopeLabel;
            wrap.appendChild(scope);
        }
        (this.activeOutputHost || this.messages).appendChild(wrap);
    }

    private appendChart(chart: NonNullable<AssistantResponse["chart"]>, response: AssistantResponse, engineQuestion: string): void {
        const doc = this.host.ownerDocument || document;
        const wrap = doc.createElement("div");
        wrap.className = "ibx-assistant-chart";
        const chartHead = doc.createElement("div");
        chartHead.className = "ibx-assistant-chart-head";
        const title = doc.createElement("div");
        title.className = "ibx-assistant-chart-title";
        title.textContent = chart.title || "Chart";
        chartHead.appendChild(title);
        wrap.appendChild(chartHead);
        const summary = doc.createElement("div");
        summary.className = "ibx-assistant-chart-summary";
        wrap.appendChild(summary);
        const metricRow = doc.createElement("div");
        metricRow.className = "ibx-assistant-chart-metrics";
        const typeRow = doc.createElement("div");
        typeRow.className = "ibx-assistant-chart-types";
        const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 520 190");
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", chart.title || "Assistant chart");
        const tableHost = doc.createElement("div");
        tableHost.className = "ibx-assistant-chart-table";
        const metrics = this.getInteractiveChartMetrics(response, chart);
        const initialMetricName = this.getInitialChartMetricName(chart, metrics);
        let activeMetricNames = initialMetricName ? [initialMetricName] : (metrics[0] ? [metrics[0].name] : []);
        const chartForMetric = (metricName: string): NonNullable<AssistantResponse["chart"]> => {
            const metric = this.findInteractiveMetric(metrics, metricName);
            if (!metric) return chart;
            return {
                type: chart.type,
                title: `${metric.name} comparison`,
                labels: metric.labels,
                values: metric.values,
                valueLabels: metric.valueLabels
            };
        };
        const requestedChartType = this.normalizeChartViewType(this.extractRequestedChartType(engineQuestion));
        let activeType: AssistantChartViewType = requestedChartType || this.recommendChartType(chartForMetric(activeMetricNames[0]), chart.type);
        let chartTypeManuallySelected = !!requestedChartType;
        const chartFor = (metricName: string, type: AssistantChartViewType): NonNullable<AssistantResponse["chart"]> => {
            const metric = this.findInteractiveMetric(metrics, metricName);
            if (!metric) return { ...chart, type: type === "table" ? chart.type : type };
            return {
                type: type === "table" ? chart.type : type,
                title: `${metric.name} comparison`,
                labels: metric.labels,
                values: metric.values,
                valueLabels: metric.valueLabels
            };
        };
        chartHead.appendChild(this.createPinReportButton(doc, "Save this chart to Saved Reports", () => {
            const selectedMetrics = this.getSelectedInteractiveMetrics(metrics, activeMetricNames);
            const activeChart = chartFor(activeMetricNames[0], activeType);
            const multiMetricBundle = this.buildInteractiveChartBundle(selectedMetrics);
            const shouldSaveBundle = !!multiMetricBundle && activeType !== "donut" && activeType !== "table";
            if (!shouldSaveBundle) {
                this.pinChartReport(activeChart);
                return;
            }
            const firstSeries = multiMetricBundle.series[0];
            const savedChartType: NonNullable<AssistantResponse["chart"]>["type"] = activeType === "table" ? activeChart.type : activeType;
            this.pinChartReport({
                type: savedChartType,
                title: multiMetricBundle.title,
                labels: multiMetricBundle.labels.slice(),
                values: (firstSeries?.values || []).slice(),
                valueLabels: (firstSeries?.valueLabels || []).slice(),
                series: multiMetricBundle.series.map((series) => ({
                    name: series.name,
                    labels: (series.labels || []).slice(),
                    values: (series.values || []).slice(),
                    valueLabels: (series.valueLabels || []).slice()
                }))
            });
        }));
        const render = () => {
            const selectedMetrics = this.getSelectedInteractiveMetrics(metrics, activeMetricNames);
            const activeChart = chartFor(activeMetricNames[0], activeType);
            const multiMetricBundle = this.buildInteractiveChartBundle(selectedMetrics);
            const chartItemCount = (activeChart.values || []).length;
            const isMultiMetric = selectedMetrics.length > 1 && activeType !== "donut" && activeType !== "table";
            wrap.style.setProperty("--ibx-assistant-chart-width", `${this.getPreferredChartWidth(activeChart, activeType, selectedMetrics)}px`);
            wrap.classList.toggle("ibx-assistant-chart--multi", isMultiMetric);
            wrap.classList.toggle("ibx-assistant-chart--single", !isMultiMetric && chartItemCount <= 1);
            wrap.classList.toggle("ibx-assistant-chart--compact", !isMultiMetric && chartItemCount > 1 && chartItemCount <= 3);
            wrap.classList.toggle("ibx-assistant-chart--donut", activeType === "donut");
            title.textContent = multiMetricBundle?.title || activeChart.title || "Chart";
            summary.textContent = multiMetricBundle
                ? this.getMultiMetricComparisonSummary(multiMetricBundle, activeType)
                : this.getChartComparisonSummary(activeChart);
            summary.style.display = summary.textContent ? "block" : "none";
            svg.setAttribute("aria-label", multiMetricBundle?.title || activeChart.title || "Assistant chart");
            this.redrawChart(doc, svg, activeChart, activeType, selectedMetrics);
            this.renderChartTable(doc, tableHost, activeChart, activeType === "table", selectedMetrics);
            this.syncChartChipStates(metricRow, typeRow, activeMetricNames, activeType);
        };
        this.appendChartMetricChips(doc, metricRow, metrics, activeMetricNames, (metric) => {
            activeMetricNames = this.toggleChartMetricSelection(activeMetricNames, metric);
            if (activeType === "donut" && activeMetricNames.length > 1) activeType = "bar";
            if (!chartTypeManuallySelected && activeMetricNames.length === 1) {
                activeType = this.recommendChartType(chartForMetric(activeMetricNames[0]), chart.type);
            }
            render();
        });
        this.appendChartTypeChips(doc, typeRow, activeType, (type) => {
            activeType = type;
            if (type === "donut" && activeMetricNames.length > 1) activeMetricNames = activeMetricNames.slice(0, 1);
            chartTypeManuallySelected = true;
            render();
        });
        if (metricRow.childElementCount) wrap.appendChild(metricRow);
        wrap.appendChild(typeRow);
        wrap.appendChild(svg);
        wrap.appendChild(tableHost);
        this.appendHost().appendChild(wrap);
        render();
        this.messages.scrollTop = this.messages.scrollHeight;
    }

    private appendChartMetricChips(
        doc: Document,
        row: HTMLDivElement,
        metrics: AssistantInteractiveChartMetric[],
        activeMetricNames: string[],
        onSelect: (metric: string) => void
    ): void {
        const options = metrics.map((metric) => metric.name);
        if (options.length <= 1) return;
        row.textContent = "";
        options.forEach((metric) => {
            const chip = doc.createElement("button");
            chip.type = "button";
            chip.className = `ibx-assistant-chart-metric${activeMetricNames.some((item) => this.sameText(item, metric)) ? " ibx-assistant-chart-metric--active" : ""}`;
            chip.textContent = metric;
            chip.setAttribute("aria-label", `Toggle ${metric} metric`);
            chip.setAttribute("data-ibx-tip", `Toggle ${metric} metric`);
            chip.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                onSelect(metric);
            });
            row.appendChild(chip);
        });
    }

    private appendChartTypeChips(
        doc: Document,
        row: HTMLDivElement,
        activeType: AssistantChartViewType,
        onSelect: (type: AssistantChartViewType) => void
    ): void {
        row.textContent = "";
        const types: Array<{ type: AssistantChartViewType; label: string }> = [
            { type: "bar", label: "Bar" },
            { type: "column", label: "Column" },
            { type: "line", label: "Line" },
            { type: "area", label: "Area" },
            { type: "donut", label: "Donut" },
            { type: "table", label: "Table" }
        ];
        types.forEach((item) => {
            const chip = doc.createElement("button");
            chip.type = "button";
            chip.className = `ibx-assistant-chart-type${item.type === activeType ? " ibx-assistant-chart-type--active" : ""}`;
            chip.textContent = item.label;
            chip.setAttribute("aria-label", `Show ${item.label} view`);
            chip.setAttribute("data-ibx-tip", `Show ${item.label} view`);
            chip.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                onSelect(item.type);
            });
            row.appendChild(chip);
        });
    }

    private syncChartChipStates(metricRow: HTMLDivElement, typeRow: HTMLDivElement, metricNames: string[], type: AssistantChartViewType): void {
        Array.from(metricRow.querySelectorAll<HTMLButtonElement>(".ibx-assistant-chart-metric")).forEach((chip) => {
            chip.classList.toggle("ibx-assistant-chart-metric--active", metricNames.some((metric) => this.sameText(chip.textContent || "", metric)));
        });
        Array.from(typeRow.querySelectorAll<HTMLButtonElement>(".ibx-assistant-chart-type")).forEach((chip) => {
            const label = String(chip.textContent || "").toLowerCase();
            const chipType = this.normalizeChartViewType(label) || "bar";
            chip.classList.toggle("ibx-assistant-chart-type--active", chipType === type);
        });
    }

    private clampChartNumber(value: number, min: number, max: number): number {
        if (!Number.isFinite(value)) return min;
        return Math.max(min, Math.min(max, value));
    }

    private longestChartText(values: string[]): number {
        return (values || []).reduce((max, value) => Math.max(max, String(value || "").trim().length), 0);
    }

    private getPreferredChartWidth(
        chart: NonNullable<AssistantResponse["chart"]>,
        type: AssistantChartViewType,
        selectedMetrics: AssistantInteractiveChartMetric[]
    ): number {
        if (type === "table") return 620;
        const multi = selectedMetrics.length > 1 && type !== "donut";
        const labels = multi ? (selectedMetrics[0]?.labels || []) : (chart.labels || []);
        const rowCount = Math.max(1, Math.min(8, labels.length || (chart.values || []).length || 1));
        const longestLabel = this.longestChartText(labels.map(String));
        const longestValue = this.longestChartText((multi ? selectedMetrics.flatMap((metric) => metric.valueLabels || []) : (chart.valueLabels || [])).map(String));
        if (type === "donut") {
            const legendBoost = this.clampChartNumber((longestLabel + longestValue - 28) * 5, 0, 80);
            return Math.round(this.clampChartNumber(390 + legendBoost, 360, 470));
        }
        const labelBoost = this.clampChartNumber((longestLabel - 12) * 7, -70, 150);
        const valueBoost = this.clampChartNumber((longestValue - 10) * 5, 0, 90);
        const base = multi
            ? 760
            : type === "bar"
            ? (rowCount <= 1 ? 520 : rowCount <= 3 ? 680 : 780)
            : type === "column" || type === "line" || type === "area"
            ? (rowCount <= 3 ? 720 : 840)
            : 520;
        return Math.round(this.clampChartNumber(base + labelBoost + valueBoost, multi ? 640 : 460, 980));
    }

    private getChartViewHeight(type: AssistantChartViewType, itemCount: number, metricCount: number): number {
        const rows = Math.max(1, Math.min(type === "column" || type === "line" ? 8 : 6, itemCount || 1));
        if (type === "bar" && metricCount > 1) {
            const barH = rows <= 3 ? 15 : 13;
            const groupHeight = metricCount * barH + Math.max(0, metricCount - 1) * 4;
            const groupGap = rows <= 3 ? 9 : 11;
            return Math.round(this.clampChartNumber(40 + rows * groupHeight + Math.max(0, rows - 1) * groupGap + 26, 128, 340));
        }
        if (type === "bar") {
            const barH = rows <= 1 ? 18 : 22;
            const gap = rows <= 1 ? 8 : rows <= 3 ? 8 : 10;
            const top = rows <= 1 ? 18 : rows <= 3 ? 14 : 16;
            const bottom = rows <= 1 ? 12 : 26;
            return Math.round(this.clampChartNumber(top + rows * barH + Math.max(0, rows - 1) * gap + bottom, rows <= 1 ? 54 : 120, 250));
        }
        if (type === "column") return rows <= 3 ? 150 : 190;
        if (type === "line" || type === "area") return rows <= 3 ? 160 : 190;
        if (type === "donut") return rows <= 4 ? 118 : 134;
        return 190;
    }

    private redrawChart(
        doc: Document,
        svg: SVGSVGElement,
        chart: NonNullable<AssistantResponse["chart"]>,
        type: AssistantChartViewType,
        selectedMetrics: AssistantInteractiveChartMetric[]
    ): void {
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        if (type === "table") {
            svg.style.display = "none";
            return;
        }
        svg.style.display = "";
        const itemCount = (chart.values || []).length;
        const multi = selectedMetrics.length > 1 && type !== "donut";
        const shownMetrics = multi ? selectedMetrics.slice(0, 3) : selectedMetrics.slice(0, 1);
        const viewHeight = this.getChartViewHeight(type, itemCount, shownMetrics.length);
        svg.setAttribute("viewBox",
            type === "bar" || type === "column" || type === "line" || type === "area"
                ? `0 0 520 ${viewHeight}`
                : `0 0 390 ${viewHeight}`);
        this.addChartDefs(doc, svg);
        if (multi && shownMetrics.length > 1) {
            if (type === "line") this.renderMultiLineChart(doc, svg, shownMetrics);
            else if (type === "column") this.renderMultiColumnChart(doc, svg, shownMetrics);
            else this.renderMultiBarChart(doc, svg, shownMetrics);
            return;
        }
        if (type === "donut") this.renderPieChart(doc, svg, { ...chart, type: "donut" }, true);
        else if (type === "line" || type === "area") this.renderLineChart(doc, svg, { ...chart, type: type === "area" ? "area" : "line" }, type === "area");
        else if (type === "column") this.renderColumnChart(doc, svg, { ...chart, type: "column" });
        else this.renderBarChart(doc, svg, { ...chart, type: "bar" });
    }

    private renderChartTable(
        doc: Document,
        host: HTMLDivElement,
        chart: NonNullable<AssistantResponse["chart"]>,
        visible: boolean,
        selectedMetrics: AssistantInteractiveChartMetric[]
    ): void {
        host.textContent = "";
        host.style.display = visible ? "block" : "none";
        if (!visible) return;
        if (selectedMetrics.length > 1) {
            const table = doc.createElement("div");
            table.className = "ibx-assistant-chart-table-grid";
            table.style.gridTemplateColumns = `minmax(118px, 1.3fr) repeat(${selectedMetrics.length}, minmax(72px, 1fr))`;
            const nameHead = doc.createElement("div");
            nameHead.className = "ibx-assistant-chart-table-name";
            nameHead.textContent = "Name";
            table.appendChild(nameHead);
            selectedMetrics.forEach((metric) => {
                const head = doc.createElement("div");
                head.className = "ibx-assistant-chart-table-value";
                head.textContent = metric.name;
                head.title = metric.name;
                table.appendChild(head);
            });
            (selectedMetrics[0]?.labels || []).forEach((label, index) => {
                const name = doc.createElement("div");
                name.className = "ibx-assistant-chart-table-name";
                name.textContent = String(label || "");
                name.title = String(label || "");
                table.appendChild(name);
                selectedMetrics.forEach((metric) => {
                    const value = doc.createElement("div");
                    value.className = "ibx-assistant-chart-table-value";
                    value.textContent = String(metric.valueLabels?.[index] || metric.values?.[index] || "");
                    value.title = `${label} - ${metric.name}: ${value.textContent}`;
                    table.appendChild(value);
                });
            });
            host.appendChild(table);
            return;
        }
        const table = doc.createElement("div");
        table.className = "ibx-assistant-chart-table-grid";
        (chart.labels || []).forEach((label, index) => {
            const name = doc.createElement("div");
            name.className = "ibx-assistant-chart-table-name";
            name.textContent = String(label || "");
            name.title = String(label || "");
            const value = doc.createElement("div");
            value.className = "ibx-assistant-chart-table-value";
            value.textContent = String(chart.valueLabels?.[index] || chart.values?.[index] || "");
            value.title = `${label}: ${value.textContent}`;
            table.appendChild(name);
            table.appendChild(value);
        });
        host.appendChild(table);
    }

    private recommendChartType(chart: NonNullable<AssistantResponse["chart"]>, fallback: NonNullable<AssistantResponse["chart"]>["type"]): AssistantChartViewType {
        const values = (chart.values || []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
        const labels = (chart.labels || []).map((label) => String(label || "").trim()).filter(Boolean);
        if (values.length > 1 && values.every((value) => value === values[0])) return "table";
        if (this.chartLooksLikeTimeSeries(labels, chart.title)) return "line";
        if (this.chartLooksLikeShare(chart.title, chart.valueLabels || [])) return "donut";
        if (labels.length <= 1 && (fallback === "bar" || fallback === "column")) return "bar";
        if (labels.length > 5) return "bar";
        if (labels.length >= 2 && labels.length <= 5) return fallback === "donut" ? "donut" : "bar";
        return fallback || "bar";
    }

    private chartLooksLikeTimeSeries(labels: string[], title: string): boolean {
        const month = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|q[1-4]|fy|ytd|mtd)\b/i;
        const dateish = /\b(?:20\d{2}|19\d{2})\b|^\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?$/;
        return labels.length >= 3 && (labels.some((label) => month.test(label) || dateish.test(label)) || /\btrend|monthly|quarter|year|period|timeline\b/i.test(title));
    }

    private chartLooksLikeShare(title: string, valueLabels: string[]): boolean {
        const text = `${title} ${(valueLabels || []).join(" ")}`;
        return /\b(percent|percentage|share|mix|occupancy|ratio)\b|%/.test(text.toLowerCase());
    }

    private getChartComparisonSummary(chart: NonNullable<AssistantResponse["chart"]>): string {
        const values = (chart.values || []).map((value, index) => ({
            value: Number(value),
            label: String(chart.labels?.[index] || "").trim(),
            valueLabel: String(chart.valueLabels?.[index] || "").trim()
        })).filter((item) => item.label && Number.isFinite(item.value));
        if (values.length < 2) return "";
        const metric = String(chart.title || "").replace(/\s+comparison\b.*$/i, "").trim() || "value";
        const allSame = values.every((item) => item.value === values[0].value);
        if (allSame) {
            const names = values.map((item) => item.label).join(" and ");
            return `${names} have the same ${metric} value: ${values[0].valueLabel || this.formatAxisValue(values[0].value)}.`;
        }
        const sorted = values.slice().sort((a, b) => b.value - a.value);
        const high = sorted[0];
        const low = sorted[sorted.length - 1];
        const diff = high.value - low.value;
        const diffText = this.formatChartSummaryNumber(diff, high.valueLabel || low.valueLabel);
        const pct = low.value !== 0 ? Math.abs(diff / low.value) * 100 : NaN;
        const pctText = Number.isFinite(pct) ? `, ${parseFloat(pct.toFixed(1)).toLocaleString()}% more` : "";
        return `${high.label} is higher than ${low.label} by ${diffText} ${metric}${pctText}.`;
    }

    private getMultiMetricComparisonSummary(bundle: AssistantInteractiveChartBundle, type: AssistantChartViewType): string {
        const names = bundle.series.map((metric) => metric.name);
        if (names.length <= 1) return this.getChartComparisonSummary({
            type: type === "table" ? "bar" : type,
            title: bundle.title,
            labels: bundle.labels,
            values: bundle.series[0]?.values || [],
            valueLabels: bundle.series[0]?.valueLabels || []
        });
        const subjectCount = bundle.labels.filter(Boolean).length;
        const mode = type === "line" ? "trend" : type === "table" ? "table" : "comparison";
        return `Comparing ${names.join(", ")} across ${subjectCount} ${subjectCount === 1 ? "tenant" : "tenants"} in one ${mode} view. Donut stays single-metric.`;
    }

    private formatChartSummaryNumber(value: number, sampleLabel: string): string {
        if (!Number.isFinite(value)) return "0";
        const decimals = /\.\d+/.test(String(sampleLabel || "")) ? 1 : 0;
        return value.toLocaleString(undefined, {
            maximumFractionDigits: decimals,
            minimumFractionDigits: 0
        });
    }

    private formatSharePercent(value: number, total: number): string {
        if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return "0%";
        return `${((value / total) * 100).toFixed(1).replace(/\.0$/, "")}%`;
    }

    private getInteractiveChartMetrics(response: AssistantResponse, chart: NonNullable<AssistantResponse["chart"]>): AssistantInteractiveChartMetric[] {
        const chartSeries = (chart.series || [])
            .map((series) => ({
                name: String(series.name || "").trim(),
                labels: (series.labels || []).map((label) => String(label || "").trim()),
                values: (series.values || []).map((value) => Number(value) || 0),
                valueLabels: (series.valueLabels || []).map((value) => String(value || ""))
            }))
            .filter((series) => series.name && series.labels.length && series.values.some((value) => Number.isFinite(value)));
        if (chartSeries.length) return chartSeries.slice(0, 30);
        const table = response.table;
        const rows = (table?.rows || []).filter((row) => !/^total$/i.test(String(row?.[0] || "").trim()));
        const labelIndex = this.getChartLabelColumnIndex(table?.columns || []);
        const labels = rows.length
            ? rows.map((row) => String(row[labelIndex] || row[0] || "").trim())
            : (chart.labels || []).map((label) => String(label || "").trim());
        const options = this.getStableChartMetricOptions(response, chart);
        const out: AssistantInteractiveChartMetric[] = [];
        if (table && rows.length && options.length) {
            options.forEach((name) => {
                const colIndex = (table.columns || []).findIndex((column) => this.sameText(column, name));
                if (colIndex < 0) return;
                const values = rows.map((row) => this.parseTableNumber(row[colIndex] || ""));
                if (!values.some((value) => Number.isFinite(value))) return;
                out.push({
                    name,
                    labels,
                    values: values.map((value) => Number.isFinite(value) ? value : 0),
                    valueLabels: rows.map((row) => String(row[colIndex] || ""))
                });
            });
        }
        const chartMetricName = this.getInitialChartMetricName(chart, out);
        if (!out.some((metric) => this.sameText(metric.name, chartMetricName))) {
            out.unshift({
                name: chartMetricName || "Value",
                labels: (chart.labels || []).map(String),
                values: (chart.values || []).map((value) => Number(value) || 0),
                valueLabels: (chart.valueLabels || []).map(String)
            });
        }
        return out.slice(0, 30);
    }

    private getInitialChartMetricName(chart: NonNullable<AssistantResponse["chart"]>, metrics: AssistantInteractiveChartMetric[]): string {
        const fromTitle = this.normalizeChartMetricTitle(chart.title || "");
        const match = metrics.find((metric) => this.sameText(metric.name, fromTitle));
        return match?.name || fromTitle || metrics[0]?.name || "Value";
    }

    private normalizeChartMetricTitle(title: string): string {
        let clean = String(title || "").replace(/\s+comparison\b.*$/i, "").trim();
        const rankMatch = clean.match(/^(?:highest|lowest|best|worst|top|bottom)\s+.+?\s+by\s+(.+)$/i);
        if (rankMatch?.[1]) clean = rankMatch[1].trim();
        return clean;
    }

    private getChartLabelColumnIndex(columns: string[]): number {
        const preferred = ["name", "tenant", "unit", "category", "group", "zone", "floor", "layer", "bookmark"];
        for (const wanted of preferred) {
            const index = (columns || []).findIndex((column) => this.sameText(column, wanted));
            if (index >= 0) return index;
        }
        return 0;
    }

    private isBenchmarkColumnName(column: string): boolean {
        return /^(benchmark|percentile)$/i.test(String(column || "").trim());
    }

    private findInteractiveMetric(metrics: AssistantInteractiveChartMetric[], name: string): AssistantInteractiveChartMetric | undefined {
        return metrics.find((metric) => this.sameText(metric.name, name)) || metrics[0];
    }

    private getSelectedInteractiveMetrics(metrics: AssistantInteractiveChartMetric[], names: string[]): AssistantInteractiveChartMetric[] {
        const out: AssistantInteractiveChartMetric[] = [];
        names.forEach((name) => {
            const metric = this.findInteractiveMetric(metrics, name);
            if (metric && !out.some((item) => this.sameText(item.name, metric.name))) out.push(metric);
        });
        if (!out.length && metrics[0]) out.push(metrics[0]);
        return out.slice(0, 3);
    }

    private toggleChartMetricSelection(active: string[], metric: string): string[] {
        const next = active.slice();
        const existingIndex = next.findIndex((item) => this.sameText(item, metric));
        if (existingIndex >= 0) {
            if (next.length === 1) return next;
            next.splice(existingIndex, 1);
            return next;
        }
        if (next.length >= 3) next.shift();
        next.push(metric);
        return next;
    }

    private buildInteractiveChartBundle(metrics: AssistantInteractiveChartMetric[]): AssistantInteractiveChartBundle | null {
        const series = metrics.filter((metric) => metric && metric.labels?.length);
        if (series.length <= 1) return null;
        return {
            title: `${series.map((metric) => metric.name).join(" / ")} comparison`,
            labels: series[0].labels,
            series
        };
    }

    private sameText(a: any, b: any): boolean {
        return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
    }

    private escapeRegExp(value: string): string {
        return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    private addSvgTitle(doc: Document, el: SVGElement, value: string): void {
        const clean = String(value || "").trim();
        if (!clean) return;
        const title = doc.createElementNS("http://www.w3.org/2000/svg", "title");
        title.textContent = clean;
        el.appendChild(title);
    }

    private truncateChartLabel(value: string, max: number): string {
        const clean = String(value || "").trim();
        return clean.length > max ? `${clean.slice(0, Math.max(1, max - 3))}...` : clean;
    }

    private getStableChartMetricOptions(response: AssistantResponse, chart: NonNullable<AssistantResponse["chart"]>): string[] {
        const current = this.getChartMetricOptions(response);
        const key = this.getChartMetricKey(response, chart);
        if (!key) return current;
        const remembered = this.chartMetricOptionsByKey[key] || [];
        const merged: string[] = [];
        [...remembered, ...current].forEach((metric) => {
            const clean = String(metric || "").trim();
            if (!clean || merged.some((item) => item.toLowerCase() === clean.toLowerCase())) return;
            merged.push(clean);
        });
        if (merged.length) this.chartMetricOptionsByKey[key] = merged.slice(0, 30);
        return merged.slice(0, 30);
    }

    private getChartMetricKey(response: AssistantResponse, chart: NonNullable<AssistantResponse["chart"]>): string {
        const rowLabels = (response.table?.rows || [])
            .map((row) => String(row?.[0] || "").trim())
            .filter((label) => label && !/^total$/i.test(label));
        const labels = rowLabels.length ? rowLabels : (chart.labels || []).map((label) => String(label || "").trim()).filter(Boolean);
        return labels
            .map((label) => label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
            .filter(Boolean)
            .sort()
            .join("|");
    }

    private getChartMetricOptions(response: AssistantResponse): string[] {
        const table = response.table;
        if (!table || !table.columns?.length || !table.rows?.length) return [];
        const requested = this.extractRequestedChartMetricName(response);
        const excluded = /^(name|tenant|bookmark|rank|value|category|group|floor|filters|heatmap fields|units)$/i;
        const rows = table.rows.filter((row) => !/^total$/i.test(String(row[0] || "").trim()));
        const allOptions = table.columns
            .map((column, index) => ({ column: String(column || "").trim(), index }))
            .filter((item) => item.index > 0 && item.column && (!excluded.test(item.column) || this.sameText(item.column, requested)))
            .filter((item) => rows.some((row) => Number.isFinite(this.parseTableNumber(row[item.index] || ""))))
            .map((item) => item.column);
        const preferred = this.engine.getHeatmapSelectedMetricNames();
        if (!preferred.length) return allOptions.slice(0, 30);
        const ordered: string[] = [];
        preferred.forEach((name) => {
            const match = allOptions.find((opt) => this.sameText(opt, name));
            if (match && !ordered.some((item) => this.sameText(item, match))) ordered.push(match);
        });
        allOptions.forEach((opt) => {
            if (!ordered.some((item) => this.sameText(item, opt))) ordered.push(opt);
        });
        return ordered.slice(0, 30);
    }

    private extractRequestedChartMetricName(response: AssistantResponse): string {
        const title = String(response.chart?.title || response.text || "");
        return this.normalizeChartMetricTitle(title).replace(/\s+for\b.*$/i, "").trim();
    }

    private buildChartMetricQuestion(engineQuestion: string, metric: string, type: string): string {
        const chartType = type === "donut" ? "donut" : type === "column" ? "column" : type === "line" ? "line" : type === "area" ? "area" : "bar";
        const metricText = String(metric || "").trim();
        let base = String(engineQuestion || "").trim();
        if (!base) return `${metricText} in ${chartType} chart`;
        base = this.stripChartWords(base)
            .replace(/\b(bar|column|line|pie|donut|doughnut|area)\s+(chart|graph|visual)\b/ig, "")
            .replace(/\s+/g, " ")
            .trim();
        if (/\bby\s+[^?]+$/i.test(base)) {
            base = base.replace(/\bby\s+[^?]+$/i, `by ${metricText}`);
        } else {
            base = `${base} by ${metricText}`;
        }
        return `${base} in ${chartType} chart`.replace(/\s+/g, " ").trim();
    }

    private addChartDefs(doc: Document, svg: SVGSVGElement): void {
        const defs = doc.createElementNS("http://www.w3.org/2000/svg", "defs");
        const bar = doc.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
        bar.setAttribute("id", "ibxAssistantBarGradient");
        bar.setAttribute("x1", "0%");
        bar.setAttribute("x2", "100%");
        [["0%", "#2563eb"], ["100%", "#3b82f6"]].forEach(([offset, color]) => {
            const stop = doc.createElementNS("http://www.w3.org/2000/svg", "stop");
            stop.setAttribute("offset", offset);
            stop.setAttribute("stop-color", color);
            bar.appendChild(stop);
        });
        const area = doc.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
        area.setAttribute("id", "ibxAssistantAreaGradient");
        area.setAttribute("x1", "0%");
        area.setAttribute("y1", "0%");
        area.setAttribute("x2", "0%");
        area.setAttribute("y2", "100%");
        [["0%", "#60a5fa", "0.34"], ["100%", "#60a5fa", "0.02"]].forEach(([offset, color, opacity]) => {
            const stop = doc.createElementNS("http://www.w3.org/2000/svg", "stop");
            stop.setAttribute("offset", offset);
            stop.setAttribute("stop-color", color);
            stop.setAttribute("stop-opacity", opacity);
            area.appendChild(stop);
        });
        defs.appendChild(bar);
        defs.appendChild(area);
        svg.appendChild(defs);
    }

    private getSeriesPalette(index: number): { fill: string; stroke: string } {
        const colors = [
            { fill: "#2563eb", stroke: "#1d4ed8" },
            { fill: "#7c3aed", stroke: "#6d28d9" },
            { fill: "#06b6d4", stroke: "#0891b2" }
        ];
        return colors[index % colors.length];
    }

    private renderSeriesLegend(doc: Document, svg: SVGSVGElement, series: AssistantInteractiveChartMetric[]): void {
        series.slice(0, 3).forEach((metric, index) => {
            const { fill } = this.getSeriesPalette(index);
            const x = 14 + index * 102;
            const swatch = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
            swatch.setAttribute("x", String(x));
            swatch.setAttribute("y", "8");
            swatch.setAttribute("width", "10");
            swatch.setAttribute("height", "10");
            swatch.setAttribute("rx", "2");
            swatch.setAttribute("fill", fill);
            svg.appendChild(swatch);
            const label = doc.createElementNS("http://www.w3.org/2000/svg", "text");
            label.setAttribute("x", String(x + 15));
            label.setAttribute("y", "17");
            label.setAttribute("class", "ibx-assistant-chart-axis");
            label.textContent = this.truncateChartLabel(metric.name, 14);
            this.addSvgTitle(doc, label, metric.name);
            svg.appendChild(label);
        });
    }

    private renderHorizontalAxis(
        doc: Document,
        svg: SVGSVGElement,
        left: number,
        top: number,
        width: number,
        height: number,
        max: number
    ): void {
        const axisY = top + height + 12;
        for (let i = 0; i <= 3; i++) {
            const x = left + (width * i) / 3;
            const grid = doc.createElementNS("http://www.w3.org/2000/svg", "line");
            grid.setAttribute("x1", String(x));
            grid.setAttribute("x2", String(x));
            grid.setAttribute("y1", String(top));
            grid.setAttribute("y2", String(top + height));
            grid.setAttribute("class", "ibx-assistant-chart-grid ibx-assistant-chart-grid--vertical");
            svg.appendChild(grid);
            const tick = doc.createElementNS("http://www.w3.org/2000/svg", "text");
            tick.setAttribute("x", String(x));
            tick.setAttribute("y", String(axisY));
            tick.setAttribute("class", "ibx-assistant-chart-axis");
            tick.setAttribute("text-anchor", i === 0 ? "start" : i === 3 ? "end" : "middle");
            tick.textContent = this.formatAxisValue((max * i) / 3);
            svg.appendChild(tick);
        }
    }

    private placeHorizontalValueLabel(
        valueNode: SVGTextElement,
        left: number,
        barW: number,
        y: number,
        barH: number,
        displayLabel: string,
        barWidth: number
    ): void {
        const estimatedTextWidth = Math.min(190, Math.max(32, displayLabel.length * 6.1));
        const clearInsideSpace = barW >= estimatedTextWidth + 24;
        const clearOutsideSpace = barWidth - barW >= estimatedTextWidth + 10;
        const inside = clearInsideSpace && !clearOutsideSpace;
        const outsideX = Math.min(left + barWidth + 8, left + barW + 8);
        valueNode.setAttribute("x", String(inside ? left + barW - 8 : outsideX));
        valueNode.setAttribute("y", String(y + barH / 2 + 4));
        valueNode.setAttribute("class", inside ? "ibx-assistant-chart-value ibx-assistant-chart-value--inside" : "ibx-assistant-chart-value");
        valueNode.setAttribute("data-inside", inside ? "1" : "0");
        valueNode.setAttribute("text-anchor", inside ? "end" : "start");
        valueNode.textContent = this.truncateChartLabel(displayLabel, inside ? Math.max(6, Math.floor((barW - 20) / 6.1)) : 26);
    }

    private activateChartValueLabel(valueNode: SVGTextElement): void {
        const base = valueNode.getAttribute("class") || "ibx-assistant-chart-value";
        if (valueNode.getAttribute("data-inside") === "1" || /\bibx-assistant-chart-value--inside\b/.test(base)) {
            valueNode.setAttribute("class", `${base.replace(/\s+ibx-assistant-chart-value--active\b/g, "")} ibx-assistant-chart-value--inside-active`);
            return;
        }
        valueNode.setAttribute("class", `${base.replace(/\s+ibx-assistant-chart-value--inside-active\b/g, "")} ibx-assistant-chart-value--active`);
    }

    private renderBarChart(doc: Document, svg: SVGSVGElement, chart: NonNullable<AssistantResponse["chart"]>): void {
        const values = (chart.values || []).map((value) => Math.max(0, Number(value) || 0));
        const max = Math.max(1, ...values);
        const visibleValues = values.slice(0, 6);
        const total = visibleValues.reduce((sum, value) => sum + value, 0);
        const rowCount = Math.min(6, values.length);
        const single = rowCount <= 1;
        const compact = rowCount <= 3;
        const viewW = 520;
        const visibleLabels = (chart.labels || []).slice(0, 6).map(String);
        const visibleValueLabels = (chart.valueLabels || []).slice(0, 6).map(String);
        const left = this.clampChartNumber(42 + this.longestChartText(visibleLabels) * 5.5, single ? 76 : 82, single ? 128 : 148);
        const valueLane = this.clampChartNumber(42 + this.longestChartText(visibleValueLabels) * 5.5, single ? 76 : 92, single ? 138 : 164);
        const right = 8;
        const top = single ? 18 : (compact ? 14 : 16);
        const barH = single ? 18 : (compact ? 22 : 22);
        const gap = single ? 8 : (compact ? 8 : 10);
        const width = viewW - left - valueLane - right;
        const plotHeight = rowCount * barH + Math.max(0, rowCount - 1) * gap;
        if (!single) this.renderHorizontalAxis(doc, svg, left, top, width, plotHeight, max);
        visibleValues.forEach((value, index) => {
            const y = top + index * (barH + gap);
            const label = String(chart.labels[index] || "");
            const valueLabel = String(chart.valueLabels[index] || "");
            const pctText = total > 0 ? ` (${this.formatSharePercent(value, total)})` : "";
            const displayLabel = `${valueLabel}${pctText}`;
            const barW = Math.max(2, (value / max) * width);
            const groupId = `bar-group-${index}`;
            
            const text = doc.createElementNS("http://www.w3.org/2000/svg", "text");
            text.setAttribute("x", "10");
            text.setAttribute("y", String(y + 15));
            text.setAttribute("class", "ibx-assistant-chart-label");
            text.textContent = this.truncateChartLabel(label, Math.max(9, Math.floor((left - 18) / 5.6)));
            this.addSvgTitle(doc, text, label);
            svg.appendChild(text);
            
            const bg = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
            bg.setAttribute("x", String(left));
            bg.setAttribute("y", String(y));
            bg.setAttribute("width", String(width));
            bg.setAttribute("height", String(barH));
            bg.setAttribute("rx", "5");
            bg.setAttribute("class", "ibx-assistant-chart-bar-bg");
            svg.appendChild(bg);
            
            const bar = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
            bar.setAttribute("x", String(left));
            bar.setAttribute("y", String(y));
            bar.setAttribute("width", String(barW));
            bar.setAttribute("height", String(barH));
            bar.setAttribute("rx", "5");
            bar.setAttribute("fill", "url(#ibxAssistantBarGradient)");
            bar.setAttribute("class", "ibx-assistant-chart-bar");
            bar.setAttribute("data-bar-index", String(index));
            bar.style.cursor = "pointer";
            this.addSvgTitle(doc, bar, `${label}: ${displayLabel}`);
            svg.appendChild(bar);
            
            const val = doc.createElementNS("http://www.w3.org/2000/svg", "text");
            val.setAttribute("data-bar-index", String(index));
            this.placeHorizontalValueLabel(val, left, barW, y, barH, displayLabel, width);
            this.addSvgTitle(doc, val, `${label}: ${displayLabel}`);
            svg.appendChild(val);
            
            bar.addEventListener("mouseenter", () => {
                bar.setAttribute("class", "ibx-assistant-chart-bar ibx-assistant-chart-bar--hover");
                this.placeHorizontalValueLabel(val, left, barW, y, barH, displayLabel, width);
                this.activateChartValueLabel(val);
            });
            bar.addEventListener("mouseleave", () => {
                bar.setAttribute("class", "ibx-assistant-chart-bar");
                this.placeHorizontalValueLabel(val, left, barW, y, barH, displayLabel, width);
            });
        });
    }

    private renderMultiBarChart(doc: Document, svg: SVGSVGElement, metrics: AssistantInteractiveChartMetric[]): void {
        const series = metrics.slice(0, 3);
        const labels = series[0]?.labels || [];
        const allValues = series.reduce<number[]>((acc, metric) => acc.concat(metric.values || []), []).map((value) => Math.max(0, Number(value) || 0));
        const max = Math.max(1, ...allValues);
        const totalsBySeries = series.map((metric) =>
            (metric.values || []).slice(0, 6).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0)
        );
        const viewW = 520;
        const visibleLabels = labels.slice(0, 6).map(String);
        const visibleValues = series.flatMap((metric) => (metric.valueLabels || []).slice(0, 6).map(String));
        const left = this.clampChartNumber(40 + this.longestChartText(visibleLabels) * 5.4, 78, 150);
        const valueLane = this.clampChartNumber(48 + this.longestChartText(visibleValues) * 5.2, 98, 170);
        const right = 8;
        const top = 26;
        const barH = labels.length <= 3 ? 15 : 13;
        const innerGap = 4;
        const groupGap = labels.length <= 3 ? 9 : 11;
        const width = viewW - left - valueLane - right;
        this.renderSeriesLegend(doc, svg, series);
        const shownLabels = labels.slice(0, 6);
        const groupHeight = series.length * barH + (series.length - 1) * innerGap;
        const plotHeight = shownLabels.length * groupHeight + Math.max(0, shownLabels.length - 1) * groupGap;
        this.renderHorizontalAxis(doc, svg, left, top, width, plotHeight, max);
        shownLabels.forEach((label, index) => {
            const yBase = top + index * (groupHeight + groupGap);
            const text = doc.createElementNS("http://www.w3.org/2000/svg", "text");
            text.setAttribute("x", "10");
            text.setAttribute("y", String(yBase + groupHeight / 2 + 4));
            text.setAttribute("class", "ibx-assistant-chart-label");
            text.textContent = this.truncateChartLabel(String(label || ""), Math.max(9, Math.floor((left - 18) / 5.6)));
            this.addSvgTitle(doc, text, String(label || ""));
            svg.appendChild(text);
            series.forEach((metric, seriesIndex) => {
                const value = Math.max(0, Number(metric.values?.[index]) || 0);
                const valueLabel = String(metric.valueLabels?.[index] || value);
                const pctText = totalsBySeries[seriesIndex] > 0 ? ` (${this.formatSharePercent(value, totalsBySeries[seriesIndex])})` : "";
                const displayLabel = `${valueLabel}${pctText}`;
                const y = yBase + seriesIndex * (barH + innerGap);
                const barW = Math.max(2, (value / max) * width);
                const bg = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
                bg.setAttribute("x", String(left));
                bg.setAttribute("y", String(y));
                bg.setAttribute("width", String(width));
                bg.setAttribute("height", String(barH));
                bg.setAttribute("rx", "4");
                bg.setAttribute("class", "ibx-assistant-chart-bar-bg");
                svg.appendChild(bg);
                const bar = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
                bar.setAttribute("x", String(left));
                bar.setAttribute("y", String(y));
                bar.setAttribute("width", String(barW));
                bar.setAttribute("height", String(barH));
                bar.setAttribute("rx", "4");
                bar.setAttribute("fill", this.getSeriesPalette(seriesIndex).fill);
                bar.setAttribute("class", "ibx-assistant-chart-bar");
                bar.style.cursor = "pointer";
                this.addSvgTitle(doc, bar, `${label} - ${metric.name}: ${displayLabel}`);
                svg.appendChild(bar);
                const val = doc.createElementNS("http://www.w3.org/2000/svg", "text");
                this.placeHorizontalValueLabel(val, left, barW, y, barH, displayLabel, width);
                this.addSvgTitle(doc, val, `${label} - ${metric.name}: ${displayLabel}`);
                svg.appendChild(val);
                bar.addEventListener("mouseenter", () => {
                    bar.setAttribute("class", "ibx-assistant-chart-bar ibx-assistant-chart-bar--hover");
                    this.placeHorizontalValueLabel(val, left, barW, y, barH, displayLabel, width);
                    this.activateChartValueLabel(val);
                });
                bar.addEventListener("mouseleave", () => {
                    bar.setAttribute("class", "ibx-assistant-chart-bar");
                    this.placeHorizontalValueLabel(val, left, barW, y, barH, displayLabel, width);
                });
            });
        });
    }

    private renderColumnChart(doc: Document, svg: SVGSVGElement, chart: NonNullable<AssistantResponse["chart"]>): void {
        const values = (chart.values || []).slice(0, 8).map((value) => Math.max(0, Number(value) || 0));
        const max = Math.max(1, ...values);
        if (values.length <= 1) {
            this.renderBarChart(doc, svg, { ...chart, type: "bar" });
            return;
        }
        const compact = values.length <= 3;
        const viewH = compact ? 158 : 190;
        const left = 36;
        const right = 18;
        const top = compact ? 14 : 16;
        const bottom = compact ? 34 : 42;
        const width = 520 - left - right;
        const height = viewH - top - bottom;
        for (let i = 0; i <= 3; i++) {
            const y = top + (height / 3) * i;
            const grid = doc.createElementNS("http://www.w3.org/2000/svg", "line");
            grid.setAttribute("x1", String(left));
            grid.setAttribute("x2", String(left + width));
            grid.setAttribute("y1", String(y));
            grid.setAttribute("y2", String(y));
            grid.setAttribute("class", "ibx-assistant-chart-grid");
            svg.appendChild(grid);
            const axisLabel = doc.createElementNS("http://www.w3.org/2000/svg", "text");
            axisLabel.setAttribute("x", String(left - 4));
            axisLabel.setAttribute("y", String(y + 4));
            axisLabel.setAttribute("class", "ibx-assistant-chart-axis");
            axisLabel.setAttribute("text-anchor", "end");
            axisLabel.textContent = this.formatAxisValue(max * (1 - i / 3));
            svg.appendChild(axisLabel);
        }
        const slot = width / Math.max(1, values.length);
        values.forEach((value, index) => {
            const barW = Math.max(12, Math.min(compact ? 38 : 46, slot * (compact ? 0.30 : 0.42)));
            const barH = Math.max(2, (value / max) * height);
            const x = left + index * slot + (slot - barW) / 2;
            const y = top + height - barH;
            const bar = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
            bar.setAttribute("x", String(x));
            bar.setAttribute("y", String(y));
            bar.setAttribute("width", String(barW));
            bar.setAttribute("height", String(barH));
            bar.setAttribute("rx", "5");
            bar.setAttribute("fill", "url(#ibxAssistantBarGradient)");
            bar.setAttribute("class", "ibx-assistant-chart-bar");
            bar.setAttribute("data-bar-index", String(index));
            bar.style.cursor = "pointer";
            bar.style.transformOrigin = `${x + barW / 2}px ${y + barH}px`;
            this.addSvgTitle(doc, bar, `${chart.labels[index] || ""}: ${chart.valueLabels[index] || ""}`);
            svg.appendChild(bar);
            const valueLabel = doc.createElementNS("http://www.w3.org/2000/svg", "text");
            valueLabel.setAttribute("x", String(x + barW / 2));
            const insideColumn = barH > 26 && y < top + 14;
            valueLabel.setAttribute("y", String(insideColumn ? y + 14 : Math.max(12, y - 6)));
            valueLabel.setAttribute("class", insideColumn ? "ibx-assistant-chart-value ibx-assistant-chart-value--center ibx-assistant-chart-value--inside" : "ibx-assistant-chart-value ibx-assistant-chart-value--center");
            valueLabel.setAttribute("data-inside", insideColumn ? "1" : "0");
            valueLabel.setAttribute("text-anchor", "middle");
            valueLabel.setAttribute("data-bar-index", String(index));
            valueLabel.textContent = String(chart.valueLabels[index] || "");
            this.addSvgTitle(doc, valueLabel, `${chart.labels[index] || ""}: ${chart.valueLabels[index] || ""}`);
            svg.appendChild(valueLabel);
            const label = doc.createElementNS("http://www.w3.org/2000/svg", "text");
            label.setAttribute("x", String(x + barW / 2));
            label.setAttribute("y", String(viewH - 14));
            label.setAttribute("class", "ibx-assistant-chart-label");
            label.setAttribute("text-anchor", "middle");
            label.textContent = this.truncateChartLabel(String(chart.labels[index] || ""), values.length <= 3 ? 16 : 10);
            this.addSvgTitle(doc, label, String(chart.labels[index] || ""));
            svg.appendChild(label);
            
            bar.addEventListener("mouseenter", () => {
                bar.setAttribute("class", "ibx-assistant-chart-bar ibx-assistant-chart-bar--hover");
                this.activateChartValueLabel(valueLabel);
            });
            bar.addEventListener("mouseleave", () => {
                bar.setAttribute("class", "ibx-assistant-chart-bar");
                valueLabel.setAttribute("class", insideColumn ? "ibx-assistant-chart-value ibx-assistant-chart-value--center ibx-assistant-chart-value--inside" : "ibx-assistant-chart-value ibx-assistant-chart-value--center");
            });
        });
    }

    private renderMultiColumnChart(doc: Document, svg: SVGSVGElement, metrics: AssistantInteractiveChartMetric[]): void {
        const series = metrics.slice(0, 3);
        const labels = series[0]?.labels?.slice(0, 8) || [];
        const values = series.reduce<number[]>((acc, metric) => acc.concat(metric.values || []), []).map((value) => Math.max(0, Number(value) || 0));
        const max = Math.max(1, ...values);
        const left = 36;
        const right = 18;
        const top = 30;
        const bottom = 42;
        const width = 520 - left - right;
        const height = 190 - top - bottom;
        this.renderSeriesLegend(doc, svg, series);
        for (let i = 0; i <= 3; i++) {
            const y = top + (height / 3) * i;
            const grid = doc.createElementNS("http://www.w3.org/2000/svg", "line");
            grid.setAttribute("x1", String(left));
            grid.setAttribute("x2", String(left + width));
            grid.setAttribute("y1", String(y));
            grid.setAttribute("y2", String(y));
            grid.setAttribute("class", "ibx-assistant-chart-grid");
            svg.appendChild(grid);
            const axisLabel = doc.createElementNS("http://www.w3.org/2000/svg", "text");
            axisLabel.setAttribute("x", String(left - 4));
            axisLabel.setAttribute("y", String(y + 4));
            axisLabel.setAttribute("class", "ibx-assistant-chart-axis");
            axisLabel.setAttribute("text-anchor", "end");
            axisLabel.textContent = this.formatAxisValue(max * (1 - i / 3));
            svg.appendChild(axisLabel);
        }
        const slot = width / Math.max(1, labels.length);
        const groupWidth = slot * 0.72;
        const gap = 3;
        const barW = Math.max(8, Math.min(18, (groupWidth - gap * Math.max(0, series.length - 1)) / Math.max(1, series.length)));
        labels.forEach((label, index) => {
            const groupX = left + index * slot + (slot - groupWidth) / 2;
            series.forEach((metric, seriesIndex) => {
                const value = Math.max(0, Number(metric.values?.[index]) || 0);
                const valueLabel = String(metric.valueLabels?.[index] || value);
                const barH = Math.max(2, (value / max) * height);
                const x = groupX + seriesIndex * (barW + gap);
                const y = top + height - barH;
                const bar = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
                bar.setAttribute("x", String(x));
                bar.setAttribute("y", String(y));
                bar.setAttribute("width", String(barW));
                bar.setAttribute("height", String(barH));
                bar.setAttribute("rx", "4");
                bar.setAttribute("fill", this.getSeriesPalette(seriesIndex).fill);
                bar.setAttribute("class", "ibx-assistant-chart-bar");
                bar.style.cursor = "pointer";
                bar.style.transformOrigin = `${x + barW / 2}px ${y + barH}px`;
                this.addSvgTitle(doc, bar, `${label} - ${metric.name}: ${valueLabel}`);
                svg.appendChild(bar);
                const valLabel = doc.createElementNS("http://www.w3.org/2000/svg", "text");
                valLabel.setAttribute("x", String(x + barW / 2));
                const insideColumn = barH > 24 && y < top + 16;
                valLabel.setAttribute("y", String(insideColumn ? y + 13 : Math.max(12, y - 3)));
                valLabel.setAttribute("class", insideColumn ? "ibx-assistant-chart-value ibx-assistant-chart-value--center ibx-assistant-chart-value--inside" : "ibx-assistant-chart-value ibx-assistant-chart-value--center");
                valLabel.setAttribute("data-inside", insideColumn ? "1" : "0");
                valLabel.setAttribute("text-anchor", "middle");
                valLabel.textContent = valueLabel;
                this.addSvgTitle(doc, valLabel, `${label} - ${metric.name}: ${valueLabel}`);
                svg.appendChild(valLabel);
                bar.addEventListener("mouseenter", () => {
                    bar.setAttribute("class", "ibx-assistant-chart-bar ibx-assistant-chart-bar--hover");
                    this.activateChartValueLabel(valLabel);
                });
                bar.addEventListener("mouseleave", () => {
                    bar.setAttribute("class", "ibx-assistant-chart-bar");
                    valLabel.setAttribute("class", insideColumn ? "ibx-assistant-chart-value ibx-assistant-chart-value--center ibx-assistant-chart-value--inside" : "ibx-assistant-chart-value ibx-assistant-chart-value--center");
                });
            });
            const labelEl = doc.createElementNS("http://www.w3.org/2000/svg", "text");
            labelEl.setAttribute("x", String(groupX + groupWidth / 2));
            labelEl.setAttribute("y", "172");
            labelEl.setAttribute("class", "ibx-assistant-chart-label");
            labelEl.setAttribute("text-anchor", "middle");
            labelEl.textContent = this.truncateChartLabel(String(label || ""), labels.length <= 3 ? 14 : 10);
            this.addSvgTitle(doc, labelEl, String(label || ""));
            svg.appendChild(labelEl);
        });
    }

    private renderLineChart(doc: Document, svg: SVGSVGElement, chart: NonNullable<AssistantResponse["chart"]>, area: boolean = false): void {
        const values = (chart.values || []).slice(0, 8).map((value) => Math.max(0, Number(value) || 0));
        const max = Math.max(1, ...values);
        const viewBox = String(svg.getAttribute("viewBox") || "");
        const viewHeight = Math.max(150, Number(viewBox.trim().split(/\s+/)[3]) || 190);
        const left = 48;
        const right = 18;
        const top = 18;
        const bottom = 42;
        const width = 520 - left - right;
        const height = Math.max(72, viewHeight - top - bottom);
        const labelY = Math.max(top + height + 18, viewHeight - 14);
        const count = Math.max(1, values.length - 1);
        const points = values.map((value, index) => {
            const x = left + (index / count) * width;
            const y = top + height - (value / max) * height;
            return { x, y };
        });
        for (let i = 0; i <= 3; i++) {
            const y = top + (height / 3) * i;
            const grid = doc.createElementNS("http://www.w3.org/2000/svg", "line");
            grid.setAttribute("x1", String(left));
            grid.setAttribute("x2", String(left + width));
            grid.setAttribute("y1", String(y));
            grid.setAttribute("y2", String(y));
            grid.setAttribute("class", "ibx-assistant-chart-grid");
            svg.appendChild(grid);
            const axisLabel = doc.createElementNS("http://www.w3.org/2000/svg", "text");
            axisLabel.setAttribute("x", String(left - 4));
            axisLabel.setAttribute("y", String(y + 4));
            axisLabel.setAttribute("class", "ibx-assistant-chart-axis");
            axisLabel.setAttribute("text-anchor", "end");
            axisLabel.textContent = this.formatAxisValue(max * (1 - i / 3));
            svg.appendChild(axisLabel);
        }
        if (points.length) {
            if (area) {
                const areaPath = doc.createElementNS("http://www.w3.org/2000/svg", "path");
                const line = points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
                const last = points[points.length - 1];
                const first = points[0];
                areaPath.setAttribute("d", `${line} L ${last.x} ${top + height} L ${first.x} ${top + height} Z`);
                areaPath.setAttribute("fill", "url(#ibxAssistantAreaGradient)");
                svg.appendChild(areaPath);
            }
            const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" "));
            path.setAttribute("fill", "none");
            path.setAttribute("stroke", "#2563eb");
            path.setAttribute("stroke-width", "4");
            path.setAttribute("stroke-linecap", "round");
            path.setAttribute("stroke-linejoin", "round");
            svg.appendChild(path);
        }
        points.forEach((point, index) => {
            const dot = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
            dot.setAttribute("cx", String(point.x));
            dot.setAttribute("cy", String(point.y));
            dot.setAttribute("r", "4");
            dot.setAttribute("fill", "#7c3aed");
            dot.setAttribute("stroke", "#ffffff");
            dot.setAttribute("stroke-width", "2");
            this.addSvgTitle(doc, dot, `${chart.labels[index] || ""}: ${chart.valueLabels[index] || ""}`);
            svg.appendChild(dot);
            const label = doc.createElementNS("http://www.w3.org/2000/svg", "text");
            label.setAttribute("x", String(point.x));
            label.setAttribute("y", String(labelY));
            label.setAttribute("class", "ibx-assistant-chart-label");
            label.setAttribute("text-anchor", "middle");
            label.textContent = this.truncateChartLabel(String(chart.labels[index] || ""), values.length <= 3 ? 16 : 10);
            this.addSvgTitle(doc, label, String(chart.labels[index] || ""));
            svg.appendChild(label);
            const value = doc.createElementNS("http://www.w3.org/2000/svg", "text");
            value.setAttribute("x", String(point.x));
            value.setAttribute("y", String(Math.max(12, point.y - 8)));
            value.setAttribute("class", "ibx-assistant-chart-value ibx-assistant-chart-value--center");
            value.setAttribute("text-anchor", "middle");
            value.textContent = String(chart.valueLabels[index] || "");
            this.addSvgTitle(doc, value, `${chart.labels[index] || ""}: ${chart.valueLabels[index] || ""}`);
            svg.appendChild(value);
        });
    }

    private renderMultiLineChart(doc: Document, svg: SVGSVGElement, metrics: AssistantInteractiveChartMetric[]): void {
        const series = metrics.slice(0, 3);
        const labels = series[0]?.labels?.slice(0, 8) || [];
        const values = series.reduce<number[]>((acc, metric) => acc.concat(metric.values || []), []).map((value) => Math.max(0, Number(value) || 0));
        const max = Math.max(1, ...values);
        const left = 48;
        const right = 18;
        const top = 30;
        const bottom = 48;
        const width = 520 - left - right;
        const height = 190 - top - bottom;
        const count = Math.max(1, labels.length - 1);
        this.renderSeriesLegend(doc, svg, series);
        for (let i = 0; i <= 3; i++) {
            const y = top + (height / 3) * i;
            const grid = doc.createElementNS("http://www.w3.org/2000/svg", "line");
            grid.setAttribute("x1", String(left));
            grid.setAttribute("x2", String(left + width));
            grid.setAttribute("y1", String(y));
            grid.setAttribute("y2", String(y));
            grid.setAttribute("class", "ibx-assistant-chart-grid");
            svg.appendChild(grid);
            const axisLabel = doc.createElementNS("http://www.w3.org/2000/svg", "text");
            axisLabel.setAttribute("x", String(left - 4));
            axisLabel.setAttribute("y", String(y + 4));
            axisLabel.setAttribute("class", "ibx-assistant-chart-axis");
            axisLabel.setAttribute("text-anchor", "end");
            axisLabel.textContent = this.formatAxisValue(max * (1 - i / 3));
            svg.appendChild(axisLabel);
        }
        series.forEach((metric, seriesIndex) => {
            const points = labels.map((label, index) => {
                const value = Math.max(0, Number(metric.values?.[index]) || 0);
                return {
                    x: left + (index / count) * width,
                    y: top + height - (value / max) * height,
                    label,
                    valueLabel: String(metric.valueLabels?.[index] || value)
                };
            });
            const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" "));
            path.setAttribute("fill", "none");
            path.setAttribute("stroke", this.getSeriesPalette(seriesIndex).fill);
            path.setAttribute("stroke-width", "3");
            path.setAttribute("stroke-linecap", "round");
            path.setAttribute("stroke-linejoin", "round");
            svg.appendChild(path);
            points.forEach((point) => {
                const dot = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
                dot.setAttribute("cx", String(point.x));
                dot.setAttribute("cy", String(point.y));
                dot.setAttribute("r", "3.5");
                dot.setAttribute("fill", this.getSeriesPalette(seriesIndex).fill);
                dot.setAttribute("stroke", "#ffffff");
                dot.setAttribute("stroke-width", "1.5");
                this.addSvgTitle(doc, dot, `${point.label} - ${metric.name}: ${point.valueLabel}`);
                svg.appendChild(dot);
            });
        });
        labels.forEach((label, index) => {
            const x = left + (index / count) * width;
            const labelEl = doc.createElementNS("http://www.w3.org/2000/svg", "text");
            labelEl.setAttribute("x", String(x));
            labelEl.setAttribute("y", "168");
            labelEl.setAttribute("class", "ibx-assistant-chart-label");
            labelEl.setAttribute("text-anchor", "middle");
            labelEl.textContent = this.truncateChartLabel(String(label || ""), labels.length <= 3 ? 16 : 10);
            this.addSvgTitle(doc, labelEl, String(label || ""));
            svg.appendChild(labelEl);
        });
    }

    private renderPieChart(doc: Document, svg: SVGSVGElement, chart: NonNullable<AssistantResponse["chart"]>, donut: boolean): void {
        const values = (chart.values || []).slice(0, 6).map((value) => Math.max(0, Number(value) || 0));
        const total = values.reduce((sum, value) => sum + value, 0) || 1;
        const colors = ["#2563eb", "#06b6d4", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444"];
        let start = -Math.PI / 2;
        const cx = 68;
        const cy = 58;
        const r = 48;
        const paths: { path: SVGPathElement; index: number; color: string }[] = [];
        values.forEach((value, index) => {
            const angle = (value / total) * Math.PI * 2;
            const end = start + angle;
            const large = angle > Math.PI ? 1 : 0;
            const x1 = cx + r * Math.cos(start);
            const y1 = cy + r * Math.sin(start);
            const x2 = cx + r * Math.cos(end);
            const y2 = cy + r * Math.sin(end);
            const segmentColor = colors[index % colors.length];
            const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`);
            path.setAttribute("fill", segmentColor);
            path.setAttribute("stroke", "#ffffff");
            path.setAttribute("stroke-width", "2");
            path.setAttribute("class", "ibx-assistant-chart-segment");
            path.setAttribute("data-segment-index", String(index));
            path.style.cursor = "pointer";
            this.addSvgTitle(doc, path, `${chart.labels[index] || ""}: ${chart.valueLabels[index] || value}`);
            paths.push({ path, index, color: segmentColor });
            svg.appendChild(path);
            start = end;
        });
        if (donut) {
            const hole = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
            hole.setAttribute("cx", String(cx));
            hole.setAttribute("cy", String(cy));
            hole.setAttribute("r", "25");
            hole.setAttribute("fill", "#ffffff");
            svg.appendChild(hole);
        }
        const legendItems: { swatch: SVGRectElement; text: SVGTextElement; index: number }[] = [];
        (chart.labels || []).slice(0, 6).forEach((label, index) => {
            const y = 34 + index * 18;
            const pct = this.formatSharePercent(values[index] || 0, total);
            const valueLabel = String(chart.valueLabels[index] || values[index] || "");
            const legendValue = donut ? `${valueLabel} (${pct})` : `${valueLabel || pct}`;
            const swatch = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
            swatch.setAttribute("x", "140");
            swatch.setAttribute("y", String(y - 10));
            swatch.setAttribute("width", "10");
            swatch.setAttribute("height", "10");
            swatch.setAttribute("rx", "2");
            swatch.setAttribute("fill", colors[index % colors.length]);
            swatch.setAttribute("data-legend-index", String(index));
            svg.appendChild(swatch);
            const text = doc.createElementNS("http://www.w3.org/2000/svg", "text");
            text.setAttribute("x", "156");
            text.setAttribute("y", String(y));
            text.setAttribute("class", "ibx-assistant-chart-label");
            text.setAttribute("data-legend-index", String(index));
            text.textContent = `${this.truncateChartLabel(String(label), 18)} ${legendValue}`;
            this.addSvgTitle(doc, text, `${label}: ${legendValue}`);
            legendItems.push({ swatch, text, index });
            svg.appendChild(text);
        });
        
        paths.forEach(({ path, index, color }) => {
            path.addEventListener("mouseenter", () => {
                path.setAttribute("class", "ibx-assistant-chart-segment ibx-assistant-chart-segment--hover");
                path.style.filter = "brightness(1.2)";
                legendItems.forEach(({ swatch, text, index: itemIndex }) => {
                    if (itemIndex === index) {
                        swatch.setAttribute("class", "ibx-assistant-chart-legend-swatch--active");
                        swatch.style.stroke = color;
                        text.setAttribute("class", "ibx-assistant-chart-label ibx-assistant-chart-legend-text--active");
                        text.style.fill = color;
                        text.style.fontWeight = "900";
                    }
                });
            });
            path.addEventListener("mouseleave", () => {
                path.setAttribute("class", "ibx-assistant-chart-segment");
                path.style.filter = "";
                legendItems.forEach(({ swatch, text }) => {
                    swatch.setAttribute("class", "");
                    swatch.style.stroke = "";
                    text.setAttribute("class", "ibx-assistant-chart-label");
                    text.style.fill = "";
                    text.style.fontWeight = "";
                });
            });
        });
    }

    private createAiIcon(doc: Document): SVGSVGElement {
        const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 32 32");
        svg.setAttribute("aria-hidden", "true");
        svg.classList.add("ibx-assistant-ai-icon");
        const sparkle = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        sparkle.setAttribute("d", "M16 3.5 L18.5 11 L26 13.5 L18.5 16 L16 23.5 L13.5 16 L6 13.5 L13.5 11 Z");
        sparkle.setAttribute("fill", "currentColor");
        svg.appendChild(sparkle);
        const smallA = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        smallA.setAttribute("d", "M7 23 L8.3 19.7 L11.6 18.4 L8.3 17.1 L7 13.8 L5.7 17.1 L2.4 18.4 L5.7 19.7 Z");
        smallA.setAttribute("fill", "currentColor");
        smallA.setAttribute("opacity", "0.92");
        svg.appendChild(smallA);
        const smallB = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        smallB.setAttribute("d", "M25 28 L26.1 25.2 L28.9 24.1 L26.1 23 L25 20.2 L23.9 23 L21.1 24.1 L23.9 25.2 Z");
        smallB.setAttribute("fill", "currentColor");
        smallB.setAttribute("opacity", "0.92");
        svg.appendChild(smallB);
        return svg;
    }

    private appendSuggestionChips(suggestions: string[], question: string, didYouMean?: string, clarification?: AssistantClarification, response?: AssistantResponse): void {
        const labels = Array.from(new Set((suggestions || []).map((value) => String(value || "").trim()).filter(Boolean))).slice(0, 5);
        if (didYouMean && !labels.some((label) => label.toLowerCase() === didYouMean.toLowerCase())) {
            labels.unshift(didYouMean);
        }
        if (!labels.length) return;
        const doc = this.host.ownerDocument || document;
        const wrap = doc.createElement("div");
        wrap.className = "ibx-assistant-suggestions";
        const title = doc.createElement("div");
        title.className = "ibx-assistant-suggestions-title";
        title.textContent = clarification?.kind === "compare" ? "Choose unit" : (didYouMean ? `Did you mean ${didYouMean}?` : "Suggestions");
        wrap.appendChild(title);
        const row = doc.createElement("div");
        row.className = "ibx-assistant-suggestions-row";
        labels.forEach((label) => {
            const chip = doc.createElement("button");
            chip.className = clarification?.kind === "compare" ? "ibx-assistant-chip ibx-assistant-chip--clarify" : "ibx-assistant-chip";
            chip.type = "button";
            chip.textContent = label;
            chip.setAttribute("aria-label", label);
            chip.setAttribute("data-ibx-tip", label);
            chip.addEventListener("click", (ev) => {
                ev.preventDefault();
                if (/^export table$/i.test(label)) {
                    this.exportLastResponseTable();
                    return;
                }
                if (/^show in report$/i.test(label)) {
                    const last = this.getLastAnalyticTurn();
                    if (last?.actionIndices?.length && this.onSelectIndices) this.onSelectIndices(last.actionIndices);
                    return;
                }
                if (clarification?.kind === "compare" || this.pendingCompareClarification) {
                    if (this.submitClarificationChoice(label)) return;
                }
                if (clarification?.kind === "entity") {
                    const choiceToken = (clarification.choiceTokens || []).find((token) => this.sameText(token.label, label));
                    const engineQuestion = clarification.originalEngineQuestion || clarification.originalQuestion || question;
                    if (choiceToken && engineQuestion) {
                        const turn = this.prepareTurnForQuestion(engineQuestion, [choiceToken]);
                        this.activeOutputHost = turn.output;
                        const thinkingMessage = this.appendMessage("", "assistant");
                        this.showTypingIndicator(thinkingMessage);
                        try {
                            const response = this.engine.answerWithTokens(engineQuestion, [choiceToken]);
                            this.renderEngineResponse(engineQuestion, engineQuestion, response, thinkingMessage, turn.output);
                        } catch (err: any) {
                            const msg = String(err?.message || err || "I could not answer that question.");
                            thinkingMessage.classList.remove("ibx-assistant-msg--typing");
                            thinkingMessage.textContent = `I could not answer that question. ${msg}`;
                        }
                        this.activeOutputHost = null;
                        return;
                    }
                }
                if (this.submitBenchmarkSuggestion(response?.benchmarkContext || this.lastRankBenchmarkContext, label)) return;
                const clickedTokens = this.resolveExactSuggestionTokens(label);
                this.rememberSuggestionAlias(question, label);
                this.input.value = this.buildSuggestionQuestion(question, label);
                if (clickedTokens.length) {
                    this.selectedTokens = this.mergeSelectedTokens(clickedTokens, this.selectedTokens);
                    this.renderInputHighlights();
                }
                this.submitQuestion();
            });
            row.appendChild(chip);
        });
        wrap.appendChild(row);
        this.appendHost().appendChild(wrap);
        this.messages.scrollTop = this.messages.scrollHeight;
    }

    private submitBenchmarkSuggestion(context: AssistantBenchmarkContext | null | undefined, label: string): boolean {
        const text = String(label || "").trim();
        const isBenchmark = /^(?:yes,\s*)?show benchmark statistics\b/i.test(text);
        const percentileMatch = text.match(/^show\s+(90|75|50|25)(?:th)?\s+percentile\b/i);
        if (!isBenchmark && !percentileMatch) return false;
        const percentile = percentileMatch ? Number(percentileMatch[1]) as 90 | 75 | 50 | 25 : undefined;
        const displayQuestion = isBenchmark
            ? "benchmark statistics"
            : `percentile ${percentile}`;
        this.hideAutocomplete();
        this.pendingCompareClarification = null;
        this.input.value = "";
        this.selectedTokens = [];
        this.renderInputHighlights();
        const turn = this.prepareTurnForQuestion(displayQuestion);
        this.activeOutputHost = turn.output;
        const thinkingMessage = this.appendMessage("", "assistant");
        this.showTypingIndicator(thinkingMessage);
        window.setTimeout(() => {
            try {
                const response = this.buildBenchmarkResponseFromContext(context || null, percentile);
                this.renderEngineResponse(displayQuestion, displayQuestion, response, thinkingMessage, turn.output);
            } catch (err: any) {
                const msg = String(err?.message || err || "I could not answer that question.");
                thinkingMessage.classList.remove("ibx-assistant-msg--typing");
                thinkingMessage.textContent = `I could not answer that question. ${msg}`;
            }
            this.activeOutputHost = null;
        }, 0);
        return true;
    }

    private buildBenchmarkResponseFromContext(context: AssistantBenchmarkContext | null, percentile?: 90 | 75 | 50 | 25): AssistantResponse {
        if (!context || !context.candidates?.length) {
            return {
                handled: true,
                text: "Please run a ranking first, for example: top tenants by sales."
            };
        }
        const candidates = context.candidates
            .filter((item) => item && Number.isFinite(Number(item.value)))
            .map((item) => ({ ...item, value: Number(item.value) }));
        const usableCandidates = candidates.filter((item) => this.isUsableBenchmarkValue(context, item.value));
        if (usableCandidates.length < 2) {
            return {
                handled: true,
                text: "Please run a ranking first, for example: top tenants by sales."
            };
        }
        const values = usableCandidates.map((item) => item.value).sort((a, b) => a - b);
        const totalValue = usableCandidates.reduce((sum, item) => sum + item.value, 0);
        const noun = String(context.dimensionLabel || "Item").toLowerCase();
        if (percentile) {
            const threshold = this.quantile(values, percentile / 100);
            const selected = percentile === 25
                ? usableCandidates.filter((item) => item.value <= threshold).sort((a, b) => b.value - a.value)
                : usableCandidates.filter((item) => item.value >= threshold).sort((a, b) => b.value - a.value);
            const detailLimit = 100;
            const shown = selected.slice(0, detailLimit);
            const remaining = selected.slice(detailLimit);
            const rows = shown.map((item, index) => [
                String(index + 1),
                item.label,
                item.valueLabel || this.formatBenchmarkContextValue(context, item.value),
                this.formatContributionPercent(item.value, totalValue)
            ]);
            if (remaining.length) {
                const otherTotal = remaining.reduce((sum, item) => sum + item.value, 0);
                rows.push([
                    "",
                    `Others (${remaining.length} more)`,
                    this.formatBenchmarkContextValue(context, otherTotal),
                    this.formatContributionPercent(otherTotal, totalValue)
                ]);
            }
            const selectedTotal = selected.reduce((sum, item) => sum + item.value, 0);
            rows.push([
                "",
                "Total",
                this.formatBenchmarkContextValue(context, selectedTotal),
                this.formatContributionPercent(selectedTotal, totalValue)
            ]);
            return {
                handled: true,
                text: `${percentile}th percentile ${noun}s by ${context.metricLabel}. Showing ${shown.length} of ${selected.length}.`,
                benchmarkContext: context,
                table: {
                    columns: ["Rank", context.dimensionLabel || "Name", context.metricLabel, "% of Total"],
                    rows
                },
                suggestions: ["Show 90th percentile tenants", "Show 75th percentile tenants", "Show 50th percentile tenants", "Show 25th percentile tenants"]
            };
        }
        const average = values.reduce((sum, value) => sum + value, 0) / values.length;
        const percentileBand = (pct: 90 | 75 | 50 | 25) => {
            const threshold = this.quantile(values, pct / 100);
            return pct === 25
                ? usableCandidates.filter((item) => item.value <= threshold)
                : usableCandidates.filter((item) => item.value >= threshold);
        };
        const bandContribution = (pct: 90 | 75 | 50 | 25) =>
            this.formatContributionPercent(percentileBand(pct).reduce((sum, item) => sum + item.value, 0), totalValue);
        const rows = [
            ["1", `90th (${percentileBand(90).length} ${noun}s higher than:)`, this.formatBenchmarkContextValue(context, this.quantile(values, 0.90)), bandContribution(90)],
            ["2", `75th (${percentileBand(75).length} ${noun}s higher than:)`, this.formatBenchmarkContextValue(context, this.quantile(values, 0.75)), bandContribution(75)],
            ["3", `50th (${percentileBand(50).length} ${noun}s higher than:)`, this.formatBenchmarkContextValue(context, this.quantile(values, 0.50)), bandContribution(50)],
            ["4", `25th (${percentileBand(25).length} ${noun}s lower than:)`, this.formatBenchmarkContextValue(context, this.quantile(values, 0.25)), bandContribution(25)],
            ["5", "Average", this.formatBenchmarkContextValue(context, average), "100%"]
        ];
        return {
            handled: true,
            text: `Benchmark statistics for ${usableCandidates.length} ${noun}${usableCandidates.length === 1 ? "" : "s"} by ${context.metricLabel}.`,
            benchmarkContext: context,
            tables: [{
                title: `Benchmark Statistics - ${usableCandidates.length} ${noun}${usableCandidates.length === 1 ? "" : "s"}`,
                columns: ["SN", "Percentile", context.metricLabel, "% of Total"],
                rows
            }],
            suggestions: ["Show 90th percentile tenants", "Show 75th percentile tenants", "Show 50th percentile tenants", "Show 25th percentile tenants"]
        };
    }

    private isUsableBenchmarkValue(context: AssistantBenchmarkContext, value: number): boolean {
        if (!Number.isFinite(value)) return false;
        const metricText = `${context.metricLabel || ""} ${context.metricKey || ""}`.toLowerCase();
        if (/\b(area|sqm|m2|sales|rent|revenue|turnover|units?|ocr|occupancy)\b/.test(metricText)) return value > 0;
        return true;
    }

    private formatBenchmarkContextValue(context: AssistantBenchmarkContext, value: number): string {
        if (!Number.isFinite(value)) return "N/A";
        const decimals = typeof context.metricDecimalPlaces === "number"
            ? Math.max(0, Math.min(6, context.metricDecimalPlaces))
            : (context.metricFormatHint === "percentage" ? 1 : 0);
        const formatted = value.toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: decimals
        });
        return context.metricFormatHint === "percentage" ? `${formatted}%` : formatted;
    }

    private formatContributionPercent(value: number, total: number): string {
        if (!Number.isFinite(value) || !Number.isFinite(total) || total === 0) return "N/A";
        const pct = (value / total) * 100;
        return `${pct.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: pct > 0 && pct < 1 ? 1 : 0 })}%`;
    }

    private buildBenchmarkResponseFromLastRank(baseQuestion: string, percentile?: 90 | 75 | 50 | 25): AssistantResponse | null {
        const source = this.lastRankTableForBenchmark;
        if (!source || !source.columns.length || !source.rows.length) return null;
        const baseClean = this.normalizeLooseText(this.stripBenchmarkWords(this.stripChartWords(baseQuestion)));
        const sourceClean = this.normalizeLooseText(this.stripBenchmarkWords(this.stripChartWords(source.question)));
        if (baseClean && sourceClean && baseClean !== sourceClean) return null;
        const metricIndex = this.findBenchmarkMetricColumn(source.columns, baseQuestion);
        if (metricIndex < 0) return null;
        const labelIndex = this.findBenchmarkLabelColumn(source.columns);
        const metricName = source.columns[metricIndex] || "Metric";
        const noun = String(source.columns[labelIndex] || "tenant").toLowerCase();
        const rows = source.rows
            .filter((row) => /^\d+$/.test(String(row[0] || "").trim()))
            .map((row) => ({
                label: String(row[labelIndex] || "").trim(),
                raw: String(row[metricIndex] || "").trim(),
                value: this.parseTableNumber(row[metricIndex] || ""),
                row
            }))
            .filter((item) => item.label && Number.isFinite(item.value));
        if (rows.length < 2) return null;
        const values = rows.map((row) => row.value).sort((a, b) => a - b);
        if (percentile) {
            const threshold = this.quantile(values, percentile / 100);
            const selected = percentile === 25
                ? rows.filter((row) => row.value <= threshold).sort((a, b) => b.value - a.value)
                : rows.filter((row) => row.value >= threshold).sort((a, b) => b.value - a.value);
            const detailLimit = 100;
            const shown = selected.slice(0, detailLimit);
            const remaining = selected.slice(detailLimit);
            const detailRows = shown.map((item, index) => [
                String(index + 1),
                item.label,
                item.raw || this.formatTableNumber(item.value)
            ]);
            if (remaining.length) {
                detailRows.push([
                    "",
                    `Others (${remaining.length} more)`,
                    this.formatTableNumber(remaining.reduce((sum, item) => sum + item.value, 0))
                ]);
            }
            detailRows.push([
                "",
                "Total",
                this.formatTableNumber(selected.reduce((sum, item) => sum + item.value, 0))
            ]);
            return {
                handled: true,
                text: `${percentile}th percentile ${noun}s by ${metricName}. Showing ${shown.length} of ${selected.length}.`,
                table: {
                    columns: ["Rank", source.columns[labelIndex] || "Name", metricName],
                    rows: detailRows
                }
            };
        }
        const benchmarkRows: string[][] = [
            ["1", `90th (${Math.round(rows.length * 0.10)} ${noun}s higher than:)`, this.formatTableNumber(this.quantile(values, 0.90))],
            ["2", `75th (${Math.round(rows.length * 0.25)} ${noun}s higher than:)`, this.formatTableNumber(this.quantile(values, 0.75))],
            ["3", `50th (${Math.round(rows.length * 0.50)} ${noun}s higher than:)`, this.formatTableNumber(this.quantile(values, 0.50))],
            ["4", `25th (${Math.round(rows.length * 0.25)} ${noun}s lower than:)`, this.formatTableNumber(this.quantile(values, 0.25))],
            ["5", "Average", this.formatTableNumber(values.reduce((sum, value) => sum + value, 0) / values.length)]
        ];
        return {
            handled: true,
            text: `Benchmark statistics for ${rows.length} ${noun}s by ${metricName}.`,
            tables: [{
                title: `Benchmark Statistics - ${rows.length} ${noun}s`,
                columns: ["SN", "Percentile", metricName],
                rows: benchmarkRows
            }],
            suggestions: ["Show 90th percentile tenants", "Show 75th percentile tenants", "Show 50th percentile tenants", "Show 25th percentile tenants"]
        };
    }

    private findBenchmarkLabelColumn(columns: string[]): number {
        const wanted = /^(tenant|name|unit|group|category|zone|floor|layer)$/i;
        const found = columns.findIndex((column, index) => index > 0 && wanted.test(String(column || "").trim()));
        return found >= 0 ? found : Math.min(1, Math.max(0, columns.length - 1));
    }

    private findBenchmarkMetricColumn(columns: string[], question: string): number {
        const cleanQuestion = this.normalizeLooseText(question);
        const exact = columns.findIndex((column, index) => index > 0 && cleanQuestion.indexOf(this.normalizeLooseText(column)) >= 0);
        if (exact >= 0) return exact;
        const excluded = /^(rank|tenant|name|unit|units|area|category|group|floor|zone|layer)$/i;
        return columns.findIndex((column, index) => index > 0 && !excluded.test(String(column || "").trim()));
    }

    private normalizeLooseText(value: string): string {
        return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    }

    private quantile(sortedValues: number[], p: number): number {
        const values = sortedValues.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
        if (!values.length) return NaN;
        if (values.length === 1) return values[0];
        const pos = (values.length - 1) * p;
        const lower = Math.floor(pos);
        const upper = Math.ceil(pos);
        if (lower === upper) return values[lower];
        return values[lower] + (values[upper] - values[lower]) * (pos - lower);
    }

    private formatTableNumber(value: number): string {
        if (!Number.isFinite(value)) return "N/A";
        return Math.round(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
    }

    private exportLastResponseTable(): void {
        const table = this.lastResponseTable;
        if (!table?.columns?.length || !table.rows?.length) {
            this.appendMessage("No table is available to export.", "assistant");
            return;
        }
        const escape = (value: string): string => {
            const raw = String(value || "");
            return /["\t\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
        };
        const tsv = [table.columns, ...table.rows].map((row) => row.map(escape).join("\t")).join("\n");
        const nav = this.host.ownerDocument.defaultView?.navigator || navigator;
        const clipboard = nav?.clipboard;
        if (clipboard?.writeText) {
            clipboard.writeText(tsv)
                .then(() => this.appendMessage("Table copied to clipboard.", "assistant"))
                .catch(() => this.appendMessage(tsv, "assistant"));
        } else {
            this.appendMessage(tsv, "assistant");
        }
    }

    private submitClarificationChoice(label: string): boolean {
        const pending = this.pendingCompareClarification;
        if (!pending || pending.kind !== "compare") return false;
        const choice = String(label || "").trim();
        if (!choice) return false;
        const remaining = (pending.remainingEntityPhrases || []).filter(Boolean);
        const subjects = [choice].concat(remaining.length ? remaining : (pending.resolvedEntityLabels || []));
        const formattedSubjects = subjects.map((subject) => this.formatCompareSubjectForQuestion(subject));
        const suffix = this.compareClarificationSuffix(pending.originalEngineQuestion || pending.originalQuestion || "");
        const engineQuestion = this.cleanResolvedQuestion(`compare ${formattedSubjects.join(" and ")}${suffix}`);

        // CRITICAL FIX: Pass tokens for ALL entities being compared, not just the clarified one
        // This ensures hasExplicitSelections captures ALL entities, preventing fuzzy matching for any of them
        const selectedTokens: SelectedAssistantToken[] = [];

        // Add token for the clarified choice
        const choiceToken = (pending.choiceTokens || []).find((token) => this.sameText(token.label, choice));
        if (choiceToken) selectedTokens.push(choiceToken);

        // Add tokens for remaining unresolved entities
        if (remaining.length) {
            remaining.forEach((phrase) => {
                const resolvedLabel = String(phrase || "").trim();
                const token = (pending.choiceTokens || []).find((t) => this.sameText(t.label, resolvedLabel));
                if (token) selectedTokens.push(token);
            });
        }

        // Add tokens for already-resolved entities
        const resolvedLabels = (pending.resolvedEntityLabels || []).filter(Boolean);
        if (resolvedLabels.length && !remaining.length) {
            resolvedLabels.forEach((label) => {
                const resolvedLabel = String(label || "").trim();
                const token = (pending.choiceTokens || []).find((t) => this.sameText(t.label, resolvedLabel));
                if (token) selectedTokens.push(token);
            });
        }

        this.pendingCompareClarification = null;
        const turn = this.prepareTurnForQuestion(engineQuestion, selectedTokens);
        this.activeOutputHost = turn.output;
        const thinkingMessage = this.appendMessage("", "assistant");
        this.showTypingIndicator(thinkingMessage);
        try {
            const response = selectedTokens.length
                ? this.engine.answerWithTokens(engineQuestion, selectedTokens)
                : this.engine.answer(engineQuestion);
            this.renderEngineResponse(engineQuestion, engineQuestion, response, thinkingMessage, turn.output);
        } catch (err: any) {
            const msg = String(err?.message || err || "I could not answer that question.");
            thinkingMessage.classList.remove("ibx-assistant-msg--typing");
            thinkingMessage.textContent = `I could not answer that question. ${msg}`;
        }
        this.activeOutputHost = null;
        return true;
    }

    private compareClarificationSuffix(question: string): string {
        const q = String(question || "").trim();
        const metricMatch = q.match(/\b(?:with|by|using)\s+(.+?)(?=\s+\bin\s+(?:bar|column|line|pie|donut|table|matrix)\b|$)/i);
        const metric = String(metricMatch?.[1] || "").trim();
        const chartMatch = q.match(/\bin\s+(bar|column|line|pie|donut|table|matrix)(?:\s+(?:chart|graph|view))?\b/i);
        const chart = String(chartMatch?.[1] || "").trim().replace(/^pie$/i, "donut");
        return `${metric ? ` with ${metric}` : ""}${chart ? ` in ${chart}` : ""}`;
    }

    private formatCompareSubjectForQuestion(subject: string): string {
        const value = String(subject || "").trim();
        if (!value) return "";
        const safe = value.replace(/"/g, "").trim();
        return `"${safe}"`;
    }

    private appendActionChips(actions: AssistantAction[], scroll: boolean): void {
        const usable = (actions || [])
            .filter((action) => action && action.kind === "select" && Array.isArray(action.indices) && action.indices.length)
            .slice(0, 5);
        if (!usable.length || !this.onSelectIndices) return;
        const doc = this.host.ownerDocument || document;
        const wrap = doc.createElement("div");
        wrap.className = "ibx-assistant-actions";
        usable.forEach((action) => {
            const btn = doc.createElement("button");
            btn.className = "ibx-assistant-action";
            btn.type = "button";
            btn.textContent = action.label || "Select in report";
            btn.setAttribute("aria-label", action.label || "Select in report");
            btn.setAttribute("data-ibx-tip", action.label || "Select in report");
            btn.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (this.onSelectIndices) this.onSelectIndices(action.indices, this.selectionOptionsFromEvent(ev));
            });
            wrap.appendChild(btn);
        });
        this.appendHost().appendChild(wrap);
        if (scroll) this.messages.scrollTop = this.messages.scrollHeight;
    }

    private visibleResponseActions(response: AssistantResponse): AssistantAction[] {
        const actions = response.actions || [];
        const auto = Array.from(new Set((response.autoSelectIndices || [])
            .map((idx) => Number(idx))
            .filter((idx) => Number.isFinite(idx))));
        if (!auto.length) return actions;
        const autoSet = new Set(auto);
        return actions.filter((action) => {
            if (!action || action.kind !== "select") return true;
            const indices = (action.indices || [])
                .map((idx) => Number(idx))
                .filter((idx) => Number.isFinite(idx));
            if (!indices.length) return false;
            return !(indices.length === auto.length && indices.every((idx) => autoSet.has(idx)));
        });
    }

    private buildSuggestionQuestion(question: string, suggestion: string): string {
        const base = String(question || "").trim();
        const label = String(suggestion || "").trim();
        if (!base) return label;
        if (/^(?:yes,\s*)?show benchmark statistics\b/i.test(label)) {
            return this.cleanResolvedQuestion(`benchmark statistics: ${this.stripBenchmarkWords(this.stripChartWords(base))}`);
        }
        const percentile = label.match(/^show\s+(90|75|50|25)(?:th)?\s+percentile\b/i)?.[1];
        if (percentile) {
            return this.cleanResolvedQuestion(`percentile ${percentile}: ${this.stripBenchmarkWords(this.stripChartWords(base))}`);
        }
        if (/^(compare with|show only|rank by|show in report|export table)/i.test(label)) return label;
        if (base.toLowerCase().indexOf(label.toLowerCase()) >= 0) return base;
        if (this.isStandaloneSuggestionQuestion(label)) return label;
        return `${base} ${label}`;
    }

    private isStandaloneSuggestionQuestion(value: string): boolean {
        const label = String(value || "").trim();
        if (!label) return false;
        return /^(?:list|show|display|compare|top|bottom|highest|lowest|rank|count|how\s+many|which|what)\b/i.test(label)
            || /\b(?:matrix|chart|table)\b/i.test(label);
    }

    private buildEngineQuestion(question: string): string {
        const raw = String(question || "").trim();
        if (this.isDirectFieldMetricQuestion(raw)) return raw;
        if (this.isAttributeLookupQuestion(raw)) return raw;
        const lastAnalytic = this.getLastAnalyticTurn();
        if (lastAnalytic) {
            const directRawFollowup = this.resolveDirectSuggestionFollowup(lastAnalytic, raw);
            if (directRawFollowup) return directRawFollowup;
        }
        const q = this.applyLearnedAlias(raw);
        if (this.isAttributeLookupQuestion(q)) return q;
        if (lastAnalytic) {
            const scopedCountFollowup = this.resolveScopedCountFollowup(lastAnalytic, q);
            if (scopedCountFollowup) return scopedCountFollowup;
        }
        if (this.isExplicitFreshAnalyticQuestion(q)) return q;
        const showMoreMatch = /^(?:show\s+more|more|more\s+results?|load\s+more|next\s*(\d+)?)$/i.exec(q);
        if (showMoreMatch && this.paginationState) {
            const addN = showMoreMatch[1] ? Math.min(50, Number(showMoreMatch[1])) : this.paginationState.limit;
            const newOffset = this.paginationState.offset + this.paginationState.limit;
            this.paginationState = { ...this.paginationState, offset: newOffset, limit: addN };
            return `${this.paginationState.question} offset ${newOffset}`;
        }
        const lastQuestion = lastAnalytic?.engineQuestion || this.lastAnalyticQuestion;
        if (lastAnalytic) {
            const directFollowup = this.resolveDirectSuggestionFollowup(lastAnalytic, q);
            if (directFollowup) return directFollowup;
            const sortQuestion = this.resolveSortFollowup(lastAnalytic, q);
            if (sortQuestion) return sortQuestion;
            const onlyQuestion = this.resolveShowOnlyFollowup(lastAnalytic, q);
            if (onlyQuestion) return onlyQuestion;
            const subjectMetricQuestion = this.resolveSubjectMetricFollowup(lastAnalytic, q);
            if (subjectMetricQuestion) return subjectMetricQuestion;
        }
        if (lastQuestion && this.isSameSubjectFollowup(q)) {
            return this.cleanResolvedQuestion(`${this.stripChartWords(lastQuestion)} ${this.stripSameSubjectWords(q)}`);
        }
        if (lastQuestion && this.isChartOnlyFollowup(q)) {
            return this.cleanResolvedQuestion(`${this.stripChartWords(lastQuestion)} ${q}`);
        }
        const metricFollowup = lastAnalytic && this.getMetricFollowupPhrase(q);
        if (lastAnalytic && metricFollowup) {
            return this.cleanResolvedQuestion(this.resolveMetricFollowup(lastAnalytic, metricFollowup));
        }
        if (lastAnalytic && this.isResultFollowup(q)) {
            const cleaned = this.stripResultFollowupWords(q);
            const base = this.stripChartWords(lastAnalytic.engineQuestion);
            return this.cleanResolvedQuestion(cleaned ? `${base} ${cleaned}` : base);
        }
        if (!this.lastSubjectLabel) return q;
        if (!/\b(it|that|this|again|check|correct|wrong|not correct|please check)\b/i.test(q)) return q;
        if (q.toLowerCase().indexOf(this.lastSubjectLabel.toLowerCase()) >= 0) return q;
        return this.cleanResolvedQuestion(`${q} ${this.lastSubjectLabel}`);
    }

    private resolveDirectSuggestionFollowup(turn: AssistantConversationTurn, question: string): string {
        const q = String(question || "").trim();
        if (/^(?:yes,\s*)?show benchmark statistics\b/i.test(q)) {
            const base = this.stripBenchmarkWords(this.stripChartWords(turn.engineQuestion));
            return this.cleanResolvedQuestion(`benchmark statistics: ${base}`);
        }
        const percentile = q.match(/^show\s+(90|75|50|25)(?:th)?\s+percentile\b/i)?.[1];
        if (percentile) {
            const base = this.stripBenchmarkWords(this.stripChartWords(turn.engineQuestion));
            return this.cleanResolvedQuestion(`percentile ${percentile}: ${base}`);
        }
        const metricMatch = /^(?:compare\s+with|compare\s+by|show\s+by|rank\s+by)\s+(.+?)$/i.exec(q);
        if (metricMatch?.[1]) {
            const metric = this.cleanMetricPhrase(metricMatch[1]);
            const subjects = turn.subjectLabels.filter(Boolean).slice(0, 8);
            if (metric && subjects.length >= 2 && /^compare/i.test(q)) return this.cleanResolvedQuestion(`compare ${subjects.join(" and ")} by ${metric}`);
            if (metric) return this.cleanResolvedQuestion(`top 10 tenants by ${metric}`);
        }
        const floorMatch = /^show\s+only\s+(.+?)$/i.exec(q);
        if (floorMatch?.[1]) {
            const base = this.stripChartWords(turn.engineQuestion);
            return this.cleanResolvedQuestion(`${base} in ${floorMatch[1]}`);
        }
        return "";
    }

    private resolveScopedCountFollowup(turn: AssistantConversationTurn, question: string): string {
        const q = String(question || "").trim();
        if (!q) return "";
        if (!/\b(?:how\s+many|count|number\s+of)\b/i.test(q)) return "";
        if (!/\b(?:tenants?|tenant\s+names?|brands?|shops?|stores?|units?|zones?|floors?|groups?|categories?)\b/i.test(q)) return "";
        if (/\b(?:in|inside|within|under|from|for|on|at)\s+.+/i.test(q)) return "";
        const scope = this.extractReusableScopeFromQuestion(turn.engineQuestion);
        if (!scope) return "";
        return this.cleanResolvedQuestion(`${q} in ${scope}`);
    }

    private extractReusableScopeFromQuestion(question: string): string {
        const q = String(question || "")
            .replace(/\boffset\s+\d+\b/ig, " ")
            .replace(/[?!.;]+$/g, "")
            .replace(/\s+/g, " ")
            .trim();
        if (!q) return "";
        const floor = q.match(/\b(?:in|on|at)\s+((?:ground|first|1st|second|2nd|third|3rd)\s+floor|floor\s*[123]|level\s*[123])\b/i)?.[1] || "";
        if (/\b(?:unzoned|un\s+zoned|no\s+zone|without\s+zone|not\s+zoned)\b/i.test(q)) {
            return this.cleanResolvedQuestion(`${floor ? `${floor} ` : ""}unzoned units`);
        }
        const scopedList = q.match(/\b(?:list|show|which|what)\s+(?:the\s+)?(?:tenants?|tenant\s+names?|brands?|shops?|stores?|units?)\s+(?:in|inside|within|under|from)\s+(.+?)$/i);
        if (scopedList?.[1]) return this.cleanScopePhrase(scopedList[1]);
        const scopedCount = q.match(/\b(?:how\s+many|count|number\s+of)\s+(?:tenants?|tenant\s+names?|brands?|shops?|stores?|units?|zones?|floors?|groups?|categories?)\s+(?:are\s+there\s+)?(?:in|inside|within|under|from)\s+(.+?)$/i);
        if (scopedCount?.[1]) return this.cleanScopePhrase(scopedCount[1]);
        return "";
    }

    private cleanScopePhrase(value: string): string {
        return String(value || "")
            .replace(/\b(?:group|category|zone|floor|layer|area|areas)\s*$/ig, (match) => match)
            .replace(/\b(?:shown|showing|found)\b.*$/ig, "")
            .replace(/[?!.;]+$/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    private resolveSubjectMetricFollowup(turn: AssistantConversationTurn, question: string): string {
        const q = String(question || "").trim();
        if (!q) return "";
        const subjects = turn.subjectLabels.filter(Boolean).slice(0, 6);
        if (!subjects.length) return "";
        // "compare it with Nike" / "vs Nike" / "add Nike" → expand previous subjects with new entity
        const addEntityMatch = /\bcompare\s+(?:it|them|those|these|this|that)\s+(?:with|vs|versus|against)\s+(.+?)(?:\s+by\s+.+)?$/i.exec(q)
            || /^(?:vs|versus|against)\s+(.+?)(?:\s+by\s+.+)?$/i.exec(q);
        if (addEntityMatch) {
            const newEntity = (addEntityMatch[1] || "").replace(/\s+/g, " ").trim();
            if (newEntity) {
                const lastMetric = turn.metricLabels.find((m) => m && !/^(name|tenant|category|group|floor|rank|value|units|area)$/i.test(m)) || "";
                const newChartType = this.extractRequestedChartType(q) || (turn.hadChart ? "bar" : "");
                const allSubjects = [...subjects.slice(0, 3), newEntity];
                const base = `compare ${allSubjects.join(" and ")}`;
                return this.cleanResolvedQuestion(`${base}${lastMetric ? ` by ${lastMetric}` : ""}${newChartType ? ` in ${newChartType} chart` : ""}`);
            }
        }
        const chartType = this.extractRequestedChartType(q);
        const byMetric = this.extractMetricAfterKeyword(q, "by");
        const metricSwitch = this.getMetricSwitchFollowupPhrase(q);
        const directMetric = this.getDirectMetricForPronounFollowup(q);
        const metric = byMetric || metricSwitch || directMetric;
        const pronounSubject = /\b(them|these|those|these two|those two|same ones|same tenants|last chart|previous chart|this chart|it|this|that)\b/i.test(q);
        const compareIntent = /\b(compare|versus|vs|which one|bigger|higher|larger|highest|biggest|better)\b/i.test(q);
        const showIntent = /\b(show|display|give|make|change|switch|use)\b/i.test(q);
        if (!metric && !(chartType && pronounSubject)) return "";
        if (!pronounSubject && !compareIntent && !showIntent) return "";
        const lastMetric = turn.metricLabels.find((label) => label && !/^(name|tenant|category|group|floor)$/i.test(label)) || "";
        const metricToUse = metric || lastMetric;
        if (!metricToUse) return "";
        const base = `compare ${subjects.join(" and ")} by ${metricToUse}`;
        return this.cleanResolvedQuestion(chartType ? `${base} in ${chartType} chart` : base);
    }

    private resolveSortFollowup(turn: AssistantConversationTurn, question: string): string {
        const q = String(question || "").trim();
        if (!/\b(sort|order|rank|highest|lowest|high to low|low to high|biggest|smallest)\b/i.test(q)) return "";
        const metric = this.extractMetricAfterKeyword(q, "by")
            || this.getMetricSwitchFollowupPhrase(q)
            || turn.metricLabels.find((label) => label && !/^(name|tenant|category|group|floor|rank|value)$/i.test(label))
            || "";
        if (!metric) return "";
        const direction = /\b(low to high|ascending|lowest|smallest|bottom)\b/i.test(q) ? "bottom" : "top";
        const limit = Math.max(2, Math.min(10, turn.subjectLabels.length || 5));
        const scope = turn.subjectLabels.length ? ` ${turn.subjectLabels.slice(0, 8).join(" and ")}` : "";
        const chartType = this.extractRequestedChartType(q) || (turn.hadChart ? "bar" : "");
        return this.cleanResolvedQuestion(`${direction} ${limit}${scope} by ${metric}${chartType ? ` in ${chartType} chart` : ""}`);
    }

    private resolveShowOnlyFollowup(turn: AssistantConversationTurn, question: string): string {
        const q = String(question || "").trim();
        const match = q.match(/\bshow\s+only\s+(.+?)(?:\s+(?:by|in|as)\b|$)/i);
        if (!match?.[1]) return "";
        const rawSubjects = this.cleanResolvedQuestion(match[1])
            .split(/\s+(?:and|with|vs|versus|against)\s+|,/i)
            .map((part) => part.trim())
            .filter(Boolean);
        if (rawSubjects.length < 2) return "";
        const metric = this.extractMetricAfterKeyword(q, "by")
            || turn.metricLabels.find((label) => label && !/^(name|tenant|category|group|floor|rank|value)$/i.test(label))
            || "area";
        const chartType = this.extractRequestedChartType(q);
        return this.cleanResolvedQuestion(`compare ${rawSubjects.join(" and ")} by ${metric}${chartType ? ` in ${chartType} chart` : ""}`);
    }

    private loadLearnedAliases(): Record<string, string> {
        try {
            const win = this.host.ownerDocument?.defaultView || window;
            const raw = win.localStorage ? win.localStorage.getItem("ibxAssistantAliases_v2") : "";
            const parsed = raw ? JSON.parse(raw) : {};
            if (!parsed || typeof parsed !== "object") return {};
            const out: Record<string, string> = {};
            Object.keys(parsed).forEach((key) => {
                // Discard single-word keys — structural words that slipped through the old schema
                if (key && key.trim().indexOf(" ") >= 0) out[key] = parsed[key];
            });
            return out;
        } catch (_err) {
            return {};
        }
    }

    private saveLearnedAliases(): void {
        try {
            const win = this.host.ownerDocument?.defaultView || window;
            if (win.localStorage) win.localStorage.setItem("ibxAssistantAliases_v2", JSON.stringify(this.learnedAliases));
        } catch (_err) {
            // Local storage can be blocked in embedded hosts; matching still works without memory.
        }
    }

    private learnedAliasKey(question: string): string {
        return String(question || "")
            .toLowerCase()
            .replace(/[?!.:,;()[\]{}]/g, " ")
            .replace(/\b(area|sqm|m2|size|rent|rental|lease|sales|revenue|turnover|ocr|occupancy|vacancy|vacant|occupied|units|unit|amount|value|compare|both|all|top|bottom|table|chart|of|for|by|in|the|a|an|what|show|tell|give|me|please|tenant|tenants|which|is|are|was|were|has|have|does|do|category|categories|group|groups|floor|floors|zone|zones|layer|layers|where|when|who|how|many|much|number|count|and|or|with|its|their)\b/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    private rememberSuggestionAlias(question: string, suggestion: string): void {
        if (/^(compare with|show only|rank by|show in report|export table|yes,\s*show benchmark statistics|show \d+(?:th)? percentile)/i.test(String(suggestion || "").trim())) return;
        const key = this.learnedAliasKey(question);
        const label = String(suggestion || "").trim();
        this.safeRememberAlias(key, label);
    }

    private learnAliasesFromResponse(question: string, response: AssistantResponse): void {
        if (!response.handled) return;
        if (this.isDirectFieldMetricQuestion(question)) return;
        if (response.matrix || response.clarification || response.autoSelectIndices?.length) return;
        const key = this.learnedAliasKey(question);
        if (!key) return;
        const subjects = (response.actions || [])
            .map((action) => this.cleanActionSubjectLabel(action.label || ""))
            .filter(Boolean);
        const uniqueSubjects = Array.from(new Set(subjects));
        if (uniqueSubjects.length === 1) this.safeRememberAlias(key, uniqueSubjects[0]);
        const didYouMean = String(response.didYouMean || "").trim();
        if (didYouMean) this.safeRememberAlias(key, didYouMean);
    }

    private safeRememberAlias(key: string, label: string): void {
        const cleanKey = String(key || "").toLowerCase().replace(/\s+/g, " ").trim();
        const cleanLabel = String(label || "").replace(/\s+/g, " ").trim();
        if (!cleanKey || cleanKey.length < 2 || cleanKey.length > 40 || !cleanLabel || cleanLabel.length > 80) return;
        if (/^\d+$/.test(cleanKey) || cleanKey === cleanLabel.toLowerCase()) return;
        if (/\b(select|showing|comparison|summary|scroll)\b/i.test(cleanLabel)) return;
        const existing = this.learnedAliases[cleanKey];
        if (existing && existing.toLowerCase() === cleanLabel.toLowerCase()) return;
        if (existing && existing.toLowerCase() !== cleanLabel.toLowerCase()) return;
        this.learnedAliases[cleanKey] = cleanLabel;
        this.saveLearnedAliases();
    }

    private applyLearnedAlias(question: string): string {
        const q = String(question || "").trim();
        if (!q) return q;
        if (this.isDirectFieldMetricQuestion(q)) return q;
        const key = this.learnedAliasKey(q);
        const direct = key ? this.learnedAliases[key] : "";
        if (direct && q.toLowerCase().indexOf(direct.toLowerCase()) < 0) {
            const pattern = new RegExp(`(^|\\s)${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`, "i");
            return pattern.test(q) ? q.replace(pattern, (_match, prefix) => `${prefix}${direct}`) : `${q} ${direct}`;
        }
        const aliases = Object.keys(this.learnedAliases).sort((a, b) => b.length - a.length);
        for (const alias of aliases) {
            const label = this.learnedAliases[alias];
            if (!alias || !label || q.toLowerCase().indexOf(label.toLowerCase()) >= 0) continue;
            const pattern = new RegExp(`(^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`, "i");
            if (pattern.test(q)) return q.replace(pattern, (_match, prefix) => `${prefix}${label}`);
        }
        return q;
    }

    private getLastAnalyticTurn(): AssistantConversationTurn | null {
        for (let i = this.conversationTurns.length - 1; i >= 0; i--) {
            const turn = this.conversationTurns[i];
            if (turn && turn.handled && (turn.hadTable || turn.hadChart || turn.subjectLabels.length || turn.actionIndices.length)) {
                return turn;
            }
        }
        return null;
    }

    private getMetricFollowupPhrase(question: string): string {
        const q = String(question || "").trim();
        if (!q) return "";
        const switchPhrase = this.getMetricSwitchFollowupPhrase(q);
        if (switchPhrase) return switchPhrase;
        if (/\b(compare|versus|vs|top|bottom|highest|lowest|list|summary|summarize)\b/i.test(q)) return "";
        if (/\b(unit|units|tenant|tenants|zone|zones|floor|floors|layer|layers|category|group)\b/i.test(q)) return "";
        if (/\b(of|for|by|in|within|on)\b/i.test(q)) return "";
        const cleaned = q
            .replace(/[?!.:,;]+$/g, "")
            .replace(/^\s*(what|how)\s+about\s+/i, "")
            .replace(/^\s*(and|now|then)\s+/i, "")
            .replace(/^\s*(show|display|give|tell|get|find)\s+(me\s+)?/i, "")
            .replace(/^\s*(the\s+)?/i, "")
            .replace(/\s+(instead|also|too)$/i, "")
            .replace(/\s+/g, " ")
            .trim();
        if (!cleaned || cleaned.split(/\s+/).length > 5) return "";
        if (/\b(it|that|this|those|these|same|previous|last|above|again)\b/i.test(cleaned)) return "";
        if (!this.isPureMetricFollowup(cleaned)) return "";
        return cleaned;
    }

    private getMetricSwitchFollowupPhrase(question: string): string {
        const q = String(question || "").trim();
        if (!q) return "";
        const match = q.match(/\b(?:change|switch|set)\s+(?:metric|field|measure|kpi|value)?\s*(?:to|as)\s+(.+?)\s*$/i)
            || q.match(/\buse\s+(.+?)\s+(?:instead|now)\s*$/i)
            || q.match(/\b(?:show|display)\s+(.+?)\s+instead\s*$/i);
        const raw = match?.[1] ? this.cleanMetricPhrase(match[1]) : "";
        if (!raw || this.isChartTypePhrase(raw)) return "";
        return raw;
    }

    private getDirectMetricForPronounFollowup(question: string): string {
        const q = String(question || "").trim();
        if (!q) return "";
        const showMatch = q.match(/\b(?:show|display|give)\s+(.+?)\s+(?:for|of)\s+(?:these|those|them|these two|those two|same ones|last|previous)\b/i);
        if (showMatch?.[1]) return this.cleanMetricPhrase(showMatch[1]);
        const shareMatch = q.match(/\bshow\s+(percentage\s+share|share|percent(?:age)?)\b/i);
        if (shareMatch?.[1]) return this.cleanMetricPhrase(shareMatch[1]);
        return "";
    }

    private extractMetricAfterKeyword(question: string, keyword: string): string {
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = String(question || "").match(new RegExp(`\\b${escaped}\\s+(.+?)(?:\\s+(?:in|as)\\s+(?:bar|column|line|pie|donut|doughnut|area|table)\\s*(?:chart|graph|visual)?|$)`, "i"));
        return match?.[1] ? this.cleanMetricPhrase(match[1]) : "";
    }

    private cleanMetricPhrase(value: string): string {
        return String(value || "")
            .replace(/[?!.:,;]+$/g, "")
            .replace(/^\s*(the|a|an)\s+/i, "")
            .replace(/\b(?:field|metric|measure|kpi|value)\b/ig, "")
            .replace(/\b(?:in|as)\s+(?:bar|column|line|pie|donut|doughnut|area|table)\s*(?:chart|graph|visual)?\b/ig, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    private extractRequestedChartType(question: string): string {
        const q = String(question || "").toLowerCase();
        if (/\btable|grid|tabular\b/.test(q)) return "table";
        if (/\bcolumn\b/.test(q)) return "column";
        if (/\bline\b/.test(q)) return "line";
        if (/\barea\b/.test(q)) return "area";
        if (/\bdonut|doughnut|pie\b/.test(q)) return "donut";
        if (/\bbar\b/.test(q) || /\bchart|graph|visual\b/.test(q)) return "bar";
        return "";
    }

    private normalizeChartViewType(value: string): AssistantChartViewType | "" {
        const q = String(value || "").trim().toLowerCase();
        if (q === "doughnut" || q === "pie") return "donut";
        if (q === "bar" || q === "column" || q === "line" || q === "area" || q === "donut" || q === "table") return q;
        return "";
    }

    private isChartTypePhrase(value: string): boolean {
        return /^(bar|column|line|pie|donut|doughnut|area|table)(\s+(chart|graph|visual))?$/i.test(String(value || "").trim());
    }

    private isExplicitFreshAnalyticQuestion(question: string): boolean {
        const q = String(question || "").toLowerCase();
        if (!q) return false;
        if (this.isDirectFieldMetricQuestion(q)) return true;
        if (this.isAttributeLookupQuestion(q)) return true;
        const hasMetric = /\b(?:sum\s+of\s+|total\s+)?(?:area|sqm|sq\s*m|m2|size|rent|rental|lease|sales|revenue|turnover|ocr|occupancy|vacancy|units?)\b/.test(q);
        const hasAnalyticVerb = /\b(show|display|get|give|top|bottom|compare|list|which|what)\b/.test(q);
        const hasExplicitSubject = /\b(?:of|for|by|in|inside|within|under)\s+["']?[a-z0-9&][a-z0-9&\s'.\/-]{2,}/i.test(q)
            || /\b(?:tenants?|tenant\s+names?|units?|categories|sales\s+categor(?:y|ies)|groups?|zones?|regions?|floors?|layers?)\b/i.test(q);
        const hasChartType = !!this.extractRequestedChartType(q);
        const hasPronounOnlySubject = /\b(it|this|that|same|previous|last|above|those|these|them)\b/i.test(q) && !hasExplicitSubject;
        return hasMetric && hasAnalyticVerb && hasExplicitSubject && !hasPronounOnlySubject && (hasChartType || /\b(?:of|for|by)\b/i.test(q));
    }

    private isDirectFieldMetricQuestion(question: string): boolean {
        const normalized = ` ${String(question || "")
            .toLowerCase()
            .replace(/&/g, " and ")
            .replace(/[^a-z0-9/%]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()} `;
        if (!normalized.trim()) return false;
        const hasField = [
            "assigned tenant name",
            "tenant name",
            "assigned unit",
            "unit",
            "assigned sales category",
            "sales category",
            "assigned group",
            "zone",
            "floor",
            "layer"
        ].some((field) => normalized.indexOf(` ${field} `) >= 0);
        const hasMetric = [
            "sum of area",
            "total area",
            "area",
            "sales sqm",
            "sales per sqm",
            "rent sqm",
            "rent per sqm",
            "ocr",
            "occupancy",
            "vacant units",
            "occupied units"
        ].some((metric) => normalized.indexOf(` ${metric} `) >= 0);
        return hasField && hasMetric;
    }

    private isAttributeLookupQuestion(question: string): boolean {
        const q = String(question || "")
            .toLowerCase()
            .replace(/[\u2022\u00a0]/g, " ")
            .replace(/[?!.:,;()[\]{}]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        if (!q) return false;
        const attr = "(?:assigned\\s+sales\\s+category|sales\\s+category|assigned\\s+category|category|assigned\\s+group|group|assigned\\s+tenant\\s+name|tenant\\s+name|tenant|assigned\\s+unit|unit\\s+id|unit|floor|level)";
        return new RegExp(`\\b(?:what|which|show|tell|get|give)\\b\\s*(?:is|are|the|me|please|can|you|show|tell|give|get|find|value|field|assigned)*\\s*(?:the\\s+)?${attr}\\s+(?:of|for)\\s+[a-z0-9&][a-z0-9&\\s'.\\/-]{1,}$`, "i").test(q);
    }

    private isPureMetricFollowup(question: string): boolean {
        const tokens = String(question || "")
            .toLowerCase()
            .split(/\s+/g)
            .map((token) => token.replace(/[^a-z0-9%]/g, ""))
            .filter(Boolean);
        if (!tokens.length) return false;
        const metricWords = new Set([
            "area", "sqm", "m2", "size", "rent", "sales", "revenue", "turnover", "ocr",
            "occupancy", "vacancy", "vacant", "occupied", "units", "unit", "amount", "value"
        ]);
        const metricModifiers = new Set(["base", "total", "actual", "floor", "fl", "fi", "gross", "net", "average", "avg", "sum", "monthly", "annual"]);
        const hasMetric = tokens.some((token) => metricWords.has(token));
        if (!hasMetric) return false;
        return tokens.every((token) => metricWords.has(token) || metricModifiers.has(token));
    }

    private resolveMetricFollowup(turn: AssistantConversationTurn, metricPhrase: string): string {
        const previous = this.stripChartWords(turn.engineQuestion);
        const metric = String(metricPhrase || "").trim();
        if (!metric) return previous;
        if (/\bby\s+[^?]+?(\s+(?:in|on|within|for)\s+.+)?$/i.test(previous)) {
            return previous.replace(/\bby\s+[^?]+?(\s+(?:in|on|within|for)\s+.+)?$/i, (_match, scope) => `by ${metric}${scope || ""}`);
        }
        if (/\b(of|for)\s+[^?]+$/i.test(previous)) {
            return previous.replace(/^(.+?)\b(of|for)\b/i, `${metric} $2`);
        }
        const subjects = turn.subjectLabels.filter(Boolean);
        if (subjects.length) return `${metric} for ${subjects.slice(0, 4).join(" and ")}`;
        return `${previous} ${metric}`;
    }

    private isResultFollowup(question: string): boolean {
        const q = String(question || "").toLowerCase();
        return /\b(above|same|those|these|previous|last|result|results|them)\b/.test(q);
    }

    private stripResultFollowupWords(question: string): string {
        return String(question || "")
            .replace(/\b(the\s+)?(above|same|those|these|previous|last)\s+(result|results|items|ones|rows)?\b/ig, "")
            .replace(/\b(result|results|them)\b/ig, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    private cleanResolvedQuestion(question: string): string {
        return String(question || "").replace(/\s+/g, " ").trim();
    }

    private normalizeFilterValue(value: string): string {
        const text = String(value || "").trim();
        return text || "N/A";
    }

    private isFilterActive(filter: AssistantColumnFilterState | undefined, allValues: string[]): boolean {
        if (!filter) return false;
        const query = filter.search.trim();
        if (query) return true;
        if (!filter.allowedValues) return false;
        return filter.allowedValues.length < allValues.length;
    }

    private cellPassesFilter(value: string, filter: AssistantColumnFilterState | undefined): boolean {
        if (!filter) return true;
        const normalized = this.normalizeFilterValue(value);
        const query = filter.search.trim().toLowerCase();
        if (query && !normalized.toLowerCase().includes(query)) return false;
        if (filter.allowedValues && !filter.allowedValues.includes(normalized)) return false;
        return true;
    }

    private uniqueFilterValues(rows: string[][], columnIndex: number): string[] {
        const values = new Set<string>();
        rows.forEach((row) => values.add(this.normalizeFilterValue(row[columnIndex] || "")));
        return Array.from(values).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
    }

    private closeColumnFilterPopovers(doc: Document): void {
        doc.querySelectorAll(".ibx-assistant-filter-popover").forEach((node) => node.remove());
    }

    private positionColumnFilterPopover(popover: HTMLElement, anchor: HTMLElement): void {
        const rect = anchor.getBoundingClientRect();
        const width = 188;
        const margin = 8;
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;
        const left = Math.max(margin, Math.min(rect.right - width, viewportWidth - width - margin));
        const preferredTop = rect.bottom + 5;
        const estimatedHeight = 204;
        const top = preferredTop + estimatedHeight > viewportHeight - margin
            ? Math.max(margin, rect.top - estimatedHeight - 5)
            : preferredTop;
        popover.style.left = `${Math.round(left)}px`;
        popover.style.top = `${Math.round(top)}px`;
    }

    private openColumnFilterPopover(
        doc: Document,
        anchor: HTMLElement,
        columnName: string,
        values: string[],
        current: AssistantColumnFilterState | undefined,
        onApply: (filter: AssistantColumnFilterState | null) => void
    ): void {
        const existing = doc.querySelector(`.ibx-assistant-filter-popover[data-anchor-id="${anchor.dataset.ibxFilterAnchorId || ""}"]`);
        if (existing) {
            existing.remove();
            return;
        }
        if (!anchor.dataset.ibxFilterAnchorId) {
            const cryptoObj = doc.defaultView?.crypto || globalThis.crypto;
            const randomValues = new Uint32Array(2);
            if (cryptoObj?.getRandomValues) cryptoObj.getRandomValues(randomValues);
            const randomPart = randomValues.some((value) => value > 0)
                ? Array.from(randomValues).map((value) => value.toString(36)).join("")
                : `${Date.now().toString(36)}${String(anchor.dataset.ibxTip || columnName || "filter").length.toString(36)}`;
            anchor.dataset.ibxFilterAnchorId = `filter-${Date.now()}-${randomPart}`;
        }
        this.closeColumnFilterPopovers(doc);
        const popover = doc.createElement("div");
        popover.className = "ibx-assistant-filter-popover";
        popover.dataset.anchorId = anchor.dataset.ibxFilterAnchorId;
        popover.addEventListener("click", (ev) => ev.stopPropagation());

        let removeOutsideListeners = () => { /* initialized after the popover is mounted */ };
        const closePopover = () => {
            popover.remove();
            removeOutsideListeners();
        };

        const header = doc.createElement("div");
        header.className = "ibx-assistant-filter-popover-header";
        const title = doc.createElement("div");
        title.className = "ibx-assistant-filter-popover-title";
        title.textContent = `Filter ${columnName}`;
        const close = doc.createElement("button");
        close.type = "button";
        close.className = "ibx-assistant-filter-close";
        close.appendChild(this.createCloseIcon(doc));
        close.setAttribute("aria-label", "Close filter");
        close.setAttribute("data-ibx-tip", "Close filter");
        close.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            closePopover();
        });
        header.appendChild(title);
        header.appendChild(close);
        popover.appendChild(header);

        const search = doc.createElement("input");
        search.className = "ibx-assistant-filter-search";
        search.type = "search";
        search.placeholder = "Search values";
        search.value = current?.search || "";
        popover.appendChild(search);

        const selected = new Set<string>(current?.allowedValues || values);
        const list = doc.createElement("div");
        list.className = "ibx-assistant-filter-values";
        popover.appendChild(list);

        const renderValues = () => {
            const query = search.value.trim().toLowerCase();
            list.replaceChildren();
            values
                .filter((value) => !query || value.toLowerCase().includes(query))
                .slice(0, 80)
                .forEach((value) => {
                    const label = doc.createElement("label");
                    label.className = "ibx-assistant-filter-value";
                    const checkbox = doc.createElement("input");
                    checkbox.type = "checkbox";
                    checkbox.checked = selected.has(value);
                    checkbox.addEventListener("change", () => {
                        if (checkbox.checked) selected.add(value);
                        else selected.delete(value);
                    });
                    const text = doc.createElement("span");
                    text.textContent = value;
                    label.appendChild(checkbox);
                    label.appendChild(text);
                    list.appendChild(label);
                });
        };

        const selectAll = doc.createElement("button");
        selectAll.type = "button";
        selectAll.textContent = "All";
        selectAll.addEventListener("click", () => {
            values.forEach((value) => selected.add(value));
            renderValues();
        });
        const clear = doc.createElement("button");
        clear.type = "button";
        clear.textContent = "None";
        clear.setAttribute("data-ibx-tip", "Select no values");
        clear.addEventListener("click", () => {
            selected.clear();
            renderValues();
        });
        const removeFilter = doc.createElement("button");
        removeFilter.type = "button";
        removeFilter.textContent = "Remove";
        removeFilter.setAttribute("data-ibx-tip", "Remove this column filter");
        removeFilter.addEventListener("click", (ev) => {
            ev.preventDefault();
            onApply(null);
            closePopover();
        });

        const actions = doc.createElement("div");
        actions.className = "ibx-assistant-filter-actions";
        const apply = doc.createElement("button");
        apply.type = "button";
        apply.className = "ibx-assistant-filter-apply";
        apply.textContent = "Apply";
        apply.addEventListener("click", () => {
            const searchText = search.value.trim();
            const allSelected = selected.size === values.length;
            onApply(searchText || !allSelected ? {
                search: searchText,
                allowedValues: allSelected ? undefined : Array.from(selected)
            } : null);
            closePopover();
        });
        actions.appendChild(selectAll);
        actions.appendChild(clear);
        if (current) actions.appendChild(removeFilter);
        actions.appendChild(apply);
        popover.appendChild(actions);

        search.addEventListener("input", renderValues);
        renderValues();
        doc.body.appendChild(popover);
        this.positionColumnFilterPopover(popover, anchor);
        const closeFromOutside = (ev: Event) => {
            const target = ev.target as Node | null;
            if (target && (popover.contains(target) || anchor.contains(target))) return;
            closePopover();
        };
        const repositionPopover = () => {
            if (!popover.isConnected) return;
            this.positionColumnFilterPopover(popover, anchor);
        };
        const closeFromEscape = (ev: KeyboardEvent) => {
            if (ev.key === "Escape") closePopover();
        };
        removeOutsideListeners = () => {
            doc.removeEventListener("mousedown", closeFromOutside, true);
            doc.removeEventListener("touchstart", closeFromOutside, true);
            doc.removeEventListener("keydown", closeFromEscape, true);
            window.removeEventListener("resize", repositionPopover, true);
            window.removeEventListener("scroll", repositionPopover, true);
        };
        window.setTimeout(() => {
            doc.addEventListener("mousedown", closeFromOutside, true);
            doc.addEventListener("touchstart", closeFromOutside, true);
            doc.addEventListener("keydown", closeFromEscape, true);
            window.addEventListener("resize", repositionPopover, true);
            window.addEventListener("scroll", repositionPopover, true);
        }, 0);
        search.focus();
    }

    private isChartOnlyFollowup(question: string): boolean {
        const q = String(question || "").toLowerCase();
        return /\b(show|display|make|change|convert|use)?\s*(it|this|that|last chart|previous chart)?\s*(but|to|in|as)?\s*(bar|column|line|pie|donut|doughnut|table)\s*(chart|graph|visual|view)?\b/.test(q)
            && !/\bcompare\b|\bversus\b|\bvs\b|\btop\b|\bbottom\b|\barea\b|\brent\b|\bocr\b|\bsales\b|\bunit\b/i.test(q);
    }

    private isSameSubjectFollowup(question: string): boolean {
        const q = String(question || "").toLowerCase();
        return /\b(above|same|those|these|previous|last)\s+(unit|units|tenant|tenants|shops|items|ones)\b/.test(q)
            || /\b(the above|same ones|those ones|these ones|previous ones|last ones)\b/.test(q);
    }

    private stripSameSubjectWords(question: string): string {
        return String(question || "")
            .replace(/\b(compare|show|display|make|change|convert)\b/ig, "")
            .replace(/\b(the\s+)?(above|same|those|these|previous|last)\s+(unit|units|tenant|tenants|shops|items|ones)\b/ig, "")
            .replace(/\b(the above|same ones|those ones|these ones|previous ones|last ones)\b/ig, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    private stripChartWords(question: string): string {
        return String(question || "")
            .replace(/\bas\s+(bar|column|line|pie|donut|doughnut|area|table)\s+(chart|graph|visual|view)\b/ig, "")
            .replace(/\bin\s+(bar|column|line|pie|donut|doughnut|area|table)\s+(chart|graph|visual|view)\b/ig, "")
            .replace(/\b(bar|column|line|pie|donut|doughnut|area|table)\s+(chart|graph|visual|view)\b/ig, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    private stripBenchmarkWords(question: string): string {
        return String(question || "")
            .replace(/\bbenchmark\s+statistics\s*:\s*/ig, "")
            .replace(/\bpercentile\s+(?:90|75|50|25)\s*:\s*/ig, "")
            .replace(/\bfor\s+benchmark\s+statistics\b/ig, "")
            .replace(/\bfor\s+show\s+(?:90|75|50|25)(?:th)?\s+percentile\s+tenants?\b/ig, "")
            .replace(/\bshow\s+(?:90|75|50|25)(?:th)?\s+percentile\s+tenants?\b/ig, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    private captureLastSubject(response: AssistantResponse): void {
        const action = (response.actions || []).find((item) => /^Select\s+/i.test(String(item?.label || "")));
        const label = String(action?.label || "").replace(/^Select\s+/i, "").replace(/\s+in report$/i, "").trim();
        if (label) this.lastSubjectLabel = label;
    }

    private captureLastAnalyticQuestion(question: string, response: AssistantResponse): void {
        if (!response.handled) return;
        if (response.table || response.tables?.length || response.chart || (response.actions || []).length) {
            this.lastAnalyticQuestion = String(question || "").trim();
        }
    }

    private captureConversationTurn(userQuestion: string, engineQuestion: string, response: AssistantResponse): void {
        const actions = (response.actions || []).filter((action) => action && action.kind === "select");
        const subjectLabels = actions
            .map((action) => this.cleanActionSubjectLabel(action.label || ""))
            .filter(Boolean);
        const actionIndices = Array.from(new Set(actions.reduce((out: number[], action) => {
            return out.concat((action.indices || []).map((idx) => Number(idx)).filter((idx) => Number.isFinite(idx)));
        }, [])));
        const metricLabels = this.extractMetricLabels(response);
        this.conversationTurns.push({
            userQuestion: String(userQuestion || "").trim(),
            engineQuestion: String(engineQuestion || "").trim(),
            handled: !!response.handled,
            subjectLabels,
            metricLabels,
            actionIndices,
            hadTable: !!response.table || !!response.tables?.length,
            hadChart: !!response.chart
        });
        if (this.conversationTurns.length > 10) {
            this.conversationTurns.splice(0, this.conversationTurns.length - 10);
        }
    }

    private cleanActionSubjectLabel(label: string): string {
        return String(label || "")
            .replace(/^Select\s+/i, "")
            .replace(/\s+in report$/i, "")
            .trim();
    }

    private extractMetricLabels(response: AssistantResponse): string[] {
        const labels: string[] = [];
        if (response.table) {
            (response.table.columns || []).forEach((column) => {
                const clean = String(column || "").trim();
                if (clean && !/^name$/i.test(clean)) labels.push(clean);
            });
        }
        if (response.chart?.title) {
            const titleMetric = String(response.chart.title || "")
                .replace(/\s+(comparison|for|by)\b.*$/i, "")
                .trim();
            if (titleMetric) labels.push(titleMetric);
        }
        const textMetric = String(response.text || "").match(/^(.+?)\s+for\s+/i);
        if (textMetric && textMetric[1]) labels.push(textMetric[1].trim());
        return Array.from(new Set(labels.filter(Boolean)));
    }

    private injectStyles(doc: Document): void {
        const existingStyle = doc.querySelector("style[data-ibx-assistant]") as HTMLStyleElement | null;
        const style = existingStyle || doc.createElement("style");
        style.setAttribute("data-ibx-assistant", "1");
        style.textContent = `
            .ibx-assistant { position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: 1000002; pointer-events: none; font-family: "Segoe UI", Arial, sans-serif; text-rendering: auto; -webkit-font-smoothing: subpixel-antialiased; -moz-osx-font-smoothing: auto; font-synthesis: none; }
            .ibx-assistant, .ibx-assistant input, .ibx-assistant button, .ibx-assistant select, .ibx-assistant textarea { font-family: "Segoe UI", Arial, sans-serif; }
            .ibx-assistant-close-icon { display: block; width: 15px; height: 15px; pointer-events: none; }
            .ibx-assistant,
            .ibx-assistant *,
            .ibx-assistant-ac,
            .ibx-assistant-ac * { font-family: "Segoe UI", Arial, sans-serif; }
            .ibx-assistant button,
            .ibx-assistant input,
            .ibx-assistant textarea,
            .ibx-assistant select,
            .ibx-assistant-ac button,
            .ibx-assistant-ac input { font-family: "Segoe UI", Arial, sans-serif; }
            .ibx-assistant-tooltip { position: fixed; z-index: 2147483647; max-width: min(420px, calc(100vw - 24px)); padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.34); background: rgba(248,250,252,0.96); color: #334155; font: 600 10.5px/14px "Segoe UI", Arial, sans-serif; letter-spacing: 0; white-space: normal; overflow-wrap: anywhere; text-align: left; box-shadow: 0 10px 24px rgba(15,23,42,0.14); pointer-events: none; opacity: 0; transform: translate(-50%, 2px); transition: opacity 90ms ease, transform 90ms ease; text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
            .ibx-assistant-tooltip--visible { opacity: 1; transform: translate(-50%, 0); }
            .ibx-assistant--fullscreen { left: 0; right: 0; top: 0; bottom: 0; width: auto; max-width: none; z-index: 1000005; pointer-events: auto; }
            .ibx-assistant--fullscreen .ibx-assistant-fab { display: none !important; }
            .ibx-assistant--fullscreen .ibx-assistant-panel { display: flex !important; right: 0; top: 0; bottom: 0; width: 100%; height: 100%; max-height: none; border-radius: 0; border: 0; background: #f3f5f8; box-shadow: none; overflow: hidden; }
            .ibx-assistant--fullscreen .ibx-assistant-head { flex: 0 0 auto; padding: 13px 20px; background: #ffffff; border-bottom: 1px solid rgba(15,23,42,0.08); box-shadow: none; z-index: 4; }
            .ibx-assistant--fullscreen .ibx-assistant-title { font-size: 14px; }
            .ibx-assistant--fullscreen .ibx-assistant-messages { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 24px max(16px, calc((100% - 1280px) / 2)) 30px; gap: 16px; align-items: stretch; background: #f3f5f8; }
            .ibx-assistant--fullscreen .ibx-assistant-turn { width: min(1280px, calc(100% - 32px)); margin: 0 auto; align-self: center; gap: 12px; }
            .ibx-assistant--fullscreen .ibx-assistant-turn-output { width: 100%; align-items: flex-start; gap: 10px; }
            .ibx-assistant--fullscreen .ibx-assistant-messages > .ibx-assistant-msg,
            .ibx-assistant--fullscreen .ibx-assistant-messages > .ibx-assistant-actions,
            .ibx-assistant--fullscreen .ibx-assistant-messages > .ibx-assistant-suggestions,
            .ibx-assistant--fullscreen .ibx-assistant-messages > .ibx-assistant-chart { width: min(1280px, calc(100% - 32px)); margin-left: auto; margin-right: auto; }
            .ibx-assistant--fullscreen .ibx-assistant-msg:not(.ibx-assistant-table-wrap):not(.ibx-assistant-chart) { max-width: min(940px, 100%); }
            .ibx-assistant--fullscreen .ibx-assistant-msg--assistant:not(.ibx-assistant-table-wrap):not(.ibx-assistant-chart) { align-self: flex-start; background: #ffffff; border: 1px solid rgba(15,23,42,0.08); border-radius: 12px; box-shadow: 0 4px 14px rgba(15,23,42,0.06); padding: 10px 12px; }
            .ibx-assistant--fullscreen .ibx-assistant-msg--user { align-self: flex-end; max-width: min(760px, 72%); padding: 8px 12px; border-radius: 13px; background: #2563eb; color: #ffffff; box-shadow: 0 6px 16px rgba(37,99,235,0.20); }
            .ibx-assistant--fullscreen .ibx-assistant-user-row { width: 100%; align-self: stretch; justify-content: flex-end; }
            .ibx-assistant--fullscreen .ibx-assistant-turn-output > .ibx-assistant-msg--assistant,
            .ibx-assistant--fullscreen .ibx-assistant-turn-output > .ibx-assistant-table-wrap,
            .ibx-assistant--fullscreen .ibx-assistant-turn-output > .ibx-assistant-chart,
            .ibx-assistant--fullscreen .ibx-assistant-turn-output > .ibx-assistant-actions,
            .ibx-assistant--fullscreen .ibx-assistant-turn-output > .ibx-assistant-suggestions { margin-left: 0; margin-right: auto; }
            .ibx-assistant--fullscreen .ibx-assistant-turn-output > .ibx-assistant-msg--assistant:not(.ibx-assistant-table-wrap):not(.ibx-assistant-chart) { width: fit-content; }
            .ibx-assistant--fullscreen .ibx-assistant-table-wrap { width: min(var(--ibx-fullscreen-table-width, 100%), 100%); max-width: 100%; min-width: 0; max-height: min(62vh, 640px); align-self: flex-start; overflow: auto; border-radius: 12px; box-shadow: 0 5px 16px rgba(15,23,42,0.06); }
            .ibx-assistant--fullscreen .ibx-assistant-table-wrap--single-metric,
            .ibx-assistant--fullscreen .ibx-assistant-table-wrap--wide { width: min(var(--ibx-fullscreen-table-width, 100%), 100%); max-width: 100%; min-width: 0; align-self: flex-start; }
            .ibx-assistant--fullscreen .ibx-assistant-table-wrap:not(.ibx-assistant-matrix-wrap) > .ibx-assistant-table { width: 100% !important; min-width: 100% !important; grid-template-columns: var(--ibx-fullscreen-table-columns) !important; }
            .ibx-assistant--fullscreen .ibx-assistant-table-cell:not(.ibx-assistant-table__num) { white-space: normal; overflow-wrap: anywhere; }
            .ibx-assistant--fullscreen .ibx-assistant-table-sort-label { white-space: normal; overflow: visible; text-overflow: clip; }
            .ibx-assistant--fullscreen .ibx-assistant-chart { width: min(var(--ibx-assistant-chart-width, 920px), 100%); max-width: 100%; align-self: flex-start; padding: 10px; }
            .ibx-assistant--fullscreen .ibx-assistant-chart--multi,
            .ibx-assistant--fullscreen .ibx-assistant-chart--compact,
            .ibx-assistant--fullscreen .ibx-assistant-chart--single { width: min(var(--ibx-assistant-chart-width, 920px), 100%); }
            .ibx-assistant--fullscreen .ibx-assistant-kpi-card { width: min(200px, 100%); }
            .ibx-assistant--fullscreen .ibx-assistant-actions,
            .ibx-assistant--fullscreen .ibx-assistant-suggestions { width: fit-content; max-width: min(760px, 92%); align-self: flex-start; }
            .ibx-assistant--fullscreen .ibx-assistant-form-wrap { flex: 0 0 auto; background: #ffffff; border-top: 1px solid rgba(15,23,42,0.08); box-shadow: 0 -14px 34px rgba(15,23,42,0.10); padding: 12px 20px 14px; z-index: 30; }
            .ibx-assistant--fullscreen .ibx-assistant-form { width: min(1280px, calc(100% - 32px)); margin: 0 auto; padding: 0; gap: 10px; }
            .ibx-assistant--fullscreen .ibx-assistant-input-wrap { min-height: 40px; border-radius: 12px; }
            .ibx-assistant--fullscreen .ibx-assistant-send { height: 40px; border-radius: 12px; padding: 0 18px; }
            .ibx-assistant--fullscreen .ibx-assistant-table-head { position: sticky; top: 0; z-index: 7; }
            .ibx-assistant--fullscreen .ibx-assistant-table-toolbar { position: sticky; top: 0; z-index: 9; }
            .ibx-assistant--fullscreen .ibx-assistant-table-total { position: sticky; bottom: 0; z-index: 1; box-shadow: 0 -1px 0 rgba(15,23,42,0.10); }
            @media (max-width: 640px) {
                .ibx-assistant--fullscreen .ibx-assistant-head { padding: 11px 12px; }
                .ibx-assistant--fullscreen .ibx-assistant-messages { padding-left: 12px; padding-right: 12px; }
                .ibx-assistant--fullscreen .ibx-assistant-turn,
                .ibx-assistant--fullscreen .ibx-assistant-form { width: calc(100% - 24px); }
                .ibx-assistant--fullscreen .ibx-assistant-msg--user { max-width: 85%; }
                .ibx-assistant--fullscreen .ibx-assistant-form-wrap { padding-left: 12px; padding-right: 12px; }
            }
            .ibx-assistant-fab { position: absolute; right: 0; top: clamp(76px, 26%, 38%); transform: translateY(-50%); width: 46px; height: 38px; border-radius: 999px; border: 1px solid rgba(125,92,255,0.55); background: linear-gradient(135deg, #2563eb 0%, #7c3aed 48%, #06b6d4 100%); color: #fff; display: inline-flex; align-items: center; justify-content: center; cursor: grab; pointer-events: auto; touch-action: none; user-select: none; box-shadow: 0 10px 28px rgba(37,99,235,0.34), 0 0 0 3px rgba(124,58,237,0.12); }
            .ibx-assistant-fab:active { cursor: grabbing; }
            .ibx-assistant-fab:hover { background: linear-gradient(135deg, #1d4ed8 0%, #6d28d9 48%, #0891b2 100%); box-shadow: 0 12px 32px rgba(37,99,235,0.42), 0 0 0 4px rgba(6,182,212,0.16); }
            .ibx-assistant-ai-icon { width: 27px; height: 27px; display: block; }
            .ibx-assistant-panel { display: none; position: absolute; right: 18px; top: 58px; bottom: 14px; width: min(448px, calc(100% - 36px)); min-height: 260px; background: #ffffff; border: 1px solid rgba(15,23,42,0.14); border-radius: 12px; box-shadow: 0 2px 0 rgba(15,23,42,0.05), 0 8px 18px rgba(15,23,42,0.10); overflow: hidden; flex-direction: column; pointer-events: auto; transform: none; contain: layout style; }
            .ibx-assistant-head { display: flex; align-items: center; justify-content: space-between; padding: 11px 13px; border-bottom: 1px solid rgba(15,23,42,0.10); background: #ffffff; }
            .ibx-assistant-title { font-size: 13px; line-height: 18px; font-weight: 800; color: #0f172a; letter-spacing: 0; }
            .ibx-assistant-head-actions { display: flex; align-items: center; gap: 6px; }
            .ibx-assistant-clear,
            .ibx-assistant-expand,
            .ibx-assistant-close { width: 28px; height: 28px; min-width: 28px; padding: 0; border: 1px solid rgba(148,163,184,0.30); border-radius: 8px; background: #ffffff; color: #475569; cursor: pointer; font: 800 14px/1 Segoe UI Symbol, Segoe UI, Arial, sans-serif; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 1px 2px rgba(15,23,42,0.05); transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease, box-shadow 120ms ease; }
            .ibx-assistant-reports { min-width: 28px; height: 28px; padding: 0 9px 0 7px; border: 1px solid rgba(148,163,184,0.30); border-radius: 8px; background: #ffffff; color: #475569; cursor: pointer; font: 800 12px/1 Segoe UI, Arial, sans-serif; display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 1px 2px rgba(15,23,42,0.05); transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease, box-shadow 120ms ease; }
            .ibx-assistant-reports-label { white-space: nowrap; }
            .ibx-assistant-reports:hover,
            .ibx-assistant-clear:hover,
            .ibx-assistant-expand:hover,
            .ibx-assistant-reports:focus-visible,
            .ibx-assistant-clear:focus-visible,
            .ibx-assistant-expand:focus-visible { background: #eff6ff; border-color: rgba(37,99,235,0.34); color: #1d4ed8; box-shadow: 0 0 0 3px rgba(37,99,235,0.10); outline: none; }
            .ibx-assistant-close:hover, .ibx-assistant-close:focus-visible { background: #fef2f2; border-color: rgba(248,113,113,0.45); color: #dc2626; box-shadow: 0 0 0 3px rgba(220,38,38,0.10); outline: none; }
            .ibx-assistant-reports:active,
            .ibx-assistant-clear:active,
            .ibx-assistant-expand:active,
            .ibx-assistant-close:active { box-shadow: inset 0 1px 2px rgba(15,23,42,0.12); }
            .ibx-assistant-header-icon { width: 18px; height: 18px; display: block; }
            .ibx-assistant:not(.ibx-assistant--fullscreen) .ibx-assistant-reports { width: 28px; padding: 0; gap: 0; }
            .ibx-assistant:not(.ibx-assistant--fullscreen) .ibx-assistant-reports-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
            .ibx-assistant-toast { position: absolute; left: 50%; bottom: 72px; transform: translateX(-50%) translateY(8px); z-index: 8; max-width: min(360px, calc(100% - 32px)); padding: 8px 12px; border-radius: 9px; background: #0f172a; color: #ffffff; font: 700 12px/16px Segoe UI, Arial, sans-serif; box-shadow: 0 8px 24px rgba(15,23,42,0.24); opacity: 0; pointer-events: none; transition: opacity 140ms ease, transform 140ms ease; text-align: center; }
            .ibx-assistant-toast--show { opacity: 1; transform: translateX(-50%) translateY(0); }
            .ibx-assistant--fullscreen .ibx-assistant-toast { bottom: 86px; }
            .ibx-assistant-messages { flex: 1 1 auto; min-height: 0; overflow-y: scroll; overflow-x: hidden; padding: 12px; display: flex; flex-direction: column; gap: 9px; background: #ffffff; scrollbar-width: thin; scrollbar-color: rgba(100,116,139,0.72) rgba(241,245,249,0.95); user-select: text !important; -webkit-user-select: text !important; text-rendering: optimizeLegibility; -webkit-font-smoothing: subpixel-antialiased; -moz-osx-font-smoothing: auto; font-synthesis: none; }
            .ibx-assistant-messages::-webkit-scrollbar { width: 9px; }
            .ibx-assistant-messages::-webkit-scrollbar-track { background: rgba(241,245,249,0.95); border-radius: 999px; }
            .ibx-assistant-messages::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.75); border-radius: 999px; border: 2px solid rgba(241,245,249,0.95); }
            .ibx-assistant-msg { white-space: pre-wrap; font: 600 12.5px/18px Segoe UI, Arial, sans-serif; letter-spacing: 0; padding: 8px 11px; border-radius: 9px; max-width: 78%; flex: 0 0 auto; animation: none; user-select: text !important; -webkit-user-select: text !important; text-rendering: optimizeLegibility; -webkit-font-smoothing: subpixel-antialiased; -moz-osx-font-smoothing: auto; font-synthesis: none; }
            .ibx-assistant-msg--assistant { align-self: flex-start; background: #ffffff; color: #0f172a; border: 1px solid rgba(15,23,42,0.10); box-shadow: 0 1px 0 rgba(15,23,42,0.05); }
            .ibx-assistant-msg--user { align-self: flex-end; background: #2563eb; color: #fff; font-weight: 700; box-shadow: 0 2px 0 rgba(29,78,216,0.18), 0 4px 10px rgba(37,99,235,0.18); }
            .ibx-assistant-turn { display: flex; flex-direction: column; gap: 9px; flex: 0 0 auto; width: min(920px, 100%); margin: 0 auto; }
            .ibx-assistant-turn-output { display: flex; flex-direction: column; gap: 9px; align-items: flex-start; }
            .ibx-assistant-user-row { display: flex; justify-content: flex-end; align-items: flex-end; gap: 4px; }
            .ibx-assistant-user-bubble { display: inline-flex; align-items: center; }
            .ibx-assistant-user-text { min-width: 0; overflow-wrap: anywhere; user-select: text !important; -webkit-user-select: text !important; cursor: text; }
            .ibx-assistant-edit { width: 20px; height: 20px; min-width: 20px; margin-bottom: 2px; border: 1px solid transparent; border-radius: 999px; background: transparent; color: #64748b; cursor: pointer; font: 900 11px/1 Segoe UI, Arial, sans-serif; display: inline-flex; align-items: center; justify-content: center; opacity: 0; box-shadow: none; transition: opacity 120ms ease, background-color 120ms ease, color 120ms ease, border-color 120ms ease; }
            .ibx-assistant-user-row:hover .ibx-assistant-edit, .ibx-assistant-edit:focus-visible { opacity: 1; background: #ffffff; border-color: rgba(37,99,235,0.24); color: #2563eb; outline: none; box-shadow: 0 3px 10px rgba(15,23,42,0.12); }
            .ibx-assistant-edit:hover { background: #eff6ff; }
            .ibx-assistant-turn--editing .ibx-assistant-edit { background: #2563eb; color: #ffffff; border-color: #2563eb; }
            .ibx-assistant-turn--editing .ibx-assistant-user-bubble { box-shadow: 0 0 0 3px rgba(37,99,235,0.18), 0 8px 22px rgba(37,99,235,0.22); }
            .ibx-assistant-msg--typing { min-width: 54px; min-height: 20px; display: inline-flex; align-items: center; }
            .ibx-assistant-typing { display: inline-flex; align-items: center; gap: 4px; height: 12px; }
            .ibx-assistant-typing span { width: 5px; height: 5px; border-radius: 999px; background: #64748b; opacity: 0.42; animation: ibxAssistantTyping 900ms ease-in-out infinite; }
            .ibx-assistant-typing span:nth-child(2) { animation-delay: 120ms; }
            .ibx-assistant-typing span:nth-child(3) { animation-delay: 240ms; }
            .ibx-assistant-table-wrap { align-self: flex-start; width: fit-content; max-width: 98%; overflow: auto; max-height: 230px; min-height: 118px; flex: 0 0 auto; background: #ffffff; border: 1px solid rgba(15,23,42,0.12); border-radius: 9px; box-shadow: 0 1px 0 rgba(15,23,42,0.05); padding: 0; position: relative; overscroll-behavior: contain; font-family: Segoe UI, Arial, sans-serif; text-rendering: optimizeLegibility; -webkit-font-smoothing: subpixel-antialiased; -moz-osx-font-smoothing: auto; font-synthesis: none; scrollbar-gutter: stable; }
            .ibx-assistant-table-wrap--metric-value { min-height: 0; max-height: none; width: fit-content; max-width: 100%; }
            .ibx-assistant-table-wrap--metric-value .ibx-assistant-table-toolbar { padding: 6px 8px; }
            .ibx-assistant-table-toolbar { position: sticky; left: 0; top: 0; z-index: 8; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; width: 100%; min-width: 100%; box-sizing: border-box; padding: 6px 8px; color: #0f172a; background: #ffffff; border-bottom: 1px solid rgba(15,23,42,0.08); }
            .ibx-assistant-table-toolbar > .ibx-assistant-matrix-controls { justify-self: end; margin-left: 0; position: sticky; right: 7px; z-index: 2; background: #ffffff; border-radius: 8px; }
            .ibx-assistant-table-title { min-width: 0; color: #0f172a; font-size: 12px; line-height: 16px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .ibx-assistant-table-scroll-hint { position: sticky; left: 0; top: 0; z-index: 4; padding: 5px 8px; color: #475569; background: linear-gradient(90deg, #f8fafc 0%, rgba(248,250,252,0.98) 80%, rgba(248,250,252,0) 100%); font-size: 11.5px; line-height: 16px; font-weight: 700; border-bottom: 1px solid rgba(15,23,42,0.10); }
            .ibx-assistant-table { display: grid; width: max-content; font: 600 12px/16px Segoe UI, Arial, sans-serif; color: #111827; letter-spacing: 0; text-rendering: optimizeLegibility; -webkit-font-smoothing: subpixel-antialiased; -moz-osx-font-smoothing: auto; font-synthesis: none; }
            .ibx-assistant-table-cell { min-width: 0; box-sizing: border-box; padding: 6px 10px; border-bottom: 1px solid rgba(15,23,42,0.08); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: #ffffff; user-select: text !important; -webkit-user-select: text !important; }
            .ibx-assistant-table-benchmark-col { text-align: left !important; white-space: normal !important; overflow-wrap: anywhere; line-height: 16px; }
            .ibx-assistant-benchmark-cell { display: inline; min-width: 0; }
            .ibx-assistant-benchmark-main { color: #0f172a; font-weight: 700; }
            .ibx-assistant-benchmark-main--percentile { color: #0f172a; font-weight: 700; }
            .ibx-assistant-benchmark-main--average { color: #1d4ed8; }
            .ibx-assistant-benchmark-note { color: #64748b; font-size: 10px; font-weight: 600; }
            .ibx-assistant-table-head { position: sticky; top: 0; z-index: 3; background: #f8fafc; color: #334155; font-weight: 700; border-bottom: 1px solid rgba(15,23,42,0.16); overflow: visible; }
            .ibx-assistant-table--column-resizable .ibx-assistant-table-head { padding-right: 18px; border-right: 1px solid rgba(100,116,139,0.22); }
            .ibx-assistant-table--column-resizable .ibx-assistant-table-sticky { max-width: none !important; }
            .ibx-assistant-column-resize-overlay { position: absolute; inset: 0 auto auto 0; width: 100%; min-height: 100%; z-index: 42; pointer-events: none; overflow: visible; }
            .ibx-assistant-column-resize-grip { position: absolute; width: 14px; min-height: 28px; margin: 0; padding: 0; border: 0; border-radius: 999px; background: transparent; cursor: ew-resize; pointer-events: auto; touch-action: none; }
            .ibx-assistant-column-resize-grip::after { content: ""; position: absolute; top: 4px; bottom: 4px; left: 6px; width: 2px; border-radius: 999px; background: rgba(100,116,139,0.34); opacity: 0.58; transition: opacity 120ms ease, background-color 120ms ease, box-shadow 120ms ease, width 120ms ease; }
            .ibx-assistant-column-resize-grip:hover::after,
            .ibx-assistant-column-resize-grip:focus-visible::after,
            .ibx-assistant-column-resize-grip.is-dragging::after { opacity: 0.95; width: 2px; background: rgba(100,116,139,0.58); box-shadow: none; }
            .ibx-assistant-column-resize-guide { position: absolute; top: 0; left: 0; width: 2px; display: none; z-index: 41; background: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.14); pointer-events: none; }
            .ibx-assistant-table--resizing,
            .ibx-assistant-table--resizing * { cursor: ew-resize !important; user-select: none !important; -webkit-user-select: none !important; }
            .ibx-assistant-table-head.ibx-assistant-table-name { white-space: nowrap; overflow-wrap: normal; line-height: 16px; }
            .ibx-assistant-table-name { text-align: left; white-space: normal; overflow-wrap: anywhere; line-height: 16px; }
            .ibx-assistant-table-cell:not(.ibx-assistant-table__num) { text-align: left; }
            .ibx-assistant-table-sticky { position: sticky; left: 0; z-index: 4; background: #ffffff; box-shadow: 1px 0 0 rgba(15,23,42,0.10); }
            .ibx-assistant-table-head.ibx-assistant-table-sticky { z-index: 6; background: #f8fafc; }
            .ibx-assistant-table-cell:nth-child(2n + 1) { background: #fbfdff; }
            .ibx-assistant-table__num { text-align: right; font-variant-numeric: tabular-nums; }
            .ibx-assistant-table-sortable { cursor: pointer; user-select: none; display: inline-flex; align-items: center; justify-content: flex-end; gap: 5px; flex-wrap: nowrap; min-height: 32px; }
            .ibx-assistant-table-sortable--text { justify-content: flex-start; }
            .ibx-assistant-table-sortable:hover { background: transparent; color: inherit; }
            .ibx-assistant-table-sort-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; overflow-wrap: normal; line-height: 16px; }
            .ibx-assistant-table-sort-label--row-header { flex: 1 1 auto; text-align: left; }
            .ibx-assistant-table-header-select { color: #004eea; cursor: pointer; border-radius: 5px; padding: 1px 3px; margin-left: -3px; }
            .ibx-assistant-table-header-select:hover, .ibx-assistant-table-header-select:focus-visible { background: #eaf2ff; outline: none; }
            .ibx-assistant-table-header-select--selected { background: rgba(100,116,139,0.24); color: #0f172a; }
            .ibx-assistant-table-head-tools { margin-left: 5px; display: inline-flex; align-items: center; justify-content: flex-end; gap: 3px; flex: 0 0 auto; white-space: nowrap; }
            .ibx-assistant-table-sort-icon { width: 17px; height: 17px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; border: 1px solid transparent; border-radius: 5px; background: transparent; color: #64748b; font-size: 10px; line-height: 1; box-sizing: border-box; }
            .ibx-assistant-table-sort-icon:hover, .ibx-assistant-table-sort-icon:focus-visible { border-color: rgba(37,99,235,0.22); background: #dbeafe; color: #1d4ed8; outline: none; }
            .ibx-assistant-table-sort-icon--active { border-color: rgba(100,116,139,0.30); background: #f8fafc; color: #475569; font-weight: 700; }
            .ibx-assistant-table-filter-btn { width: 17px; height: 17px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid transparent; border-radius: 5px; background: transparent; color: #64748b; padding: 0; cursor: pointer; }
            .ibx-assistant-table-filter-btn:hover { border-color: rgba(37,99,235,0.22); background: #dbeafe; color: #1d4ed8; }
            .ibx-assistant-table-filter-btn--active { border-color: rgba(37,99,235,0.38); background: #bfdbfe; color: #1d4ed8; }
            .ibx-assistant-table-bar-toggle { width: 17px; height: 17px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid transparent; border-radius: 5px; background: transparent; color: #94a3b8; padding: 0; cursor: pointer; }
            .ibx-assistant-table-bar-toggle:hover { border-color: rgba(37,99,235,0.22); background: #dbeafe; color: #1d4ed8; }
            .ibx-assistant-table-bar-toggle--active { border-color: rgba(37,99,235,0.30); background: #eff6ff; color: #2563eb; }
            .ibx-assistant-table-bar-toggle svg { width: 12px; height: 12px; display: block; }
            .ibx-assistant-comparison-insight-toggle svg { width: 15px; height: 15px; display: block; }
            .ibx-assistant-insight-icon { width: 15px; height: 15px; display: block; pointer-events: none; }
            .ibx-assistant-filter-icon { width: 12px; height: 12px; display: block; pointer-events: none; }
            .ibx-assistant-measure-bars-icon { width: 14px; height: 14px; display: block; pointer-events: none; }
            .ibx-assistant-filter-popover { position: fixed; z-index: 2147483000; width: 188px; max-height: 204px; display: flex; flex-direction: column; gap: 5px; padding: 7px; border: 1px solid rgba(148,163,184,0.35); border-radius: 7px; background: #ffffff; color: #0f172a; box-shadow: 0 10px 22px rgba(15,23,42,0.16); font: 500 11px/14px "Segoe UI", Arial, sans-serif; text-align: left; box-sizing: border-box; }
            .ibx-assistant-filter-popover-header { display: flex; align-items: center; gap: 6px; min-width: 0; }
            .ibx-assistant-filter-popover-title { min-width: 0; flex: 1 1 auto; font-size: 11px; line-height: 14px; font-weight: 600; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .ibx-assistant-filter-close { width: 20px; height: 20px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(148,163,184,0.35); border-radius: 5px; background: #ffffff; color: #475569; font: 600 14px/1 "Segoe UI", Arial, sans-serif; padding: 0; cursor: pointer; }
            .ibx-assistant-filter-close:hover { border-color: rgba(37,99,235,0.35); background: #eff6ff; color: #1d4ed8; }
            .ibx-assistant-filter-search { width: 100%; min-height: 24px; box-sizing: border-box; border: 1px solid rgba(148,163,184,0.42); border-radius: 6px; padding: 3px 6px; font: 400 11px/14px "Segoe UI", Arial, sans-serif; outline: none; }
            .ibx-assistant-filter-search:focus { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.15); }
            .ibx-assistant-filter-values { max-height: 82px; overflow: auto; border: 1px solid rgba(226,232,240,0.9); border-radius: 6px; background: #f8fafc; }
            .ibx-assistant-filter-value { min-height: 22px; display: flex; align-items: center; gap: 5px; padding: 2px 5px; border-bottom: 1px solid rgba(226,232,240,0.85); cursor: pointer; }
            .ibx-assistant-filter-value:last-child { border-bottom: 0; }
            .ibx-assistant-filter-value:hover { background: #eff6ff; }
            .ibx-assistant-filter-value input { width: 13px; height: 13px; margin: 0; flex: 0 0 auto; }
            .ibx-assistant-filter-value span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .ibx-assistant-filter-quick, .ibx-assistant-filter-actions { display: flex; align-items: center; justify-content: flex-end; gap: 5px; }
            .ibx-assistant-filter-quick button, .ibx-assistant-filter-actions button { min-height: 22px; border: 1px solid rgba(148,163,184,0.42); border-radius: 5px; background: #ffffff; color: #334155; font: 600 10.5px/1 "Segoe UI", Arial, sans-serif; padding: 3px 6px; cursor: pointer; }
            .ibx-assistant-filter-quick button:hover, .ibx-assistant-filter-actions button:hover { border-color: rgba(37,99,235,0.35); background: #eff6ff; color: #1d4ed8; }
            .ibx-assistant-filter-actions .ibx-assistant-filter-apply { border-color: rgba(37,99,235,0.65); background: #2563eb; color: #ffffff; }
            .ibx-assistant-table-link { max-width: 100%; padding: 0; border: 0; background: transparent; color: #1d4ed8; font: inherit; font-weight: 700; text-align: inherit; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: inherit; }
            .ibx-assistant-table-link:hover { color: #0f172a; text-decoration: underline; text-underline-offset: 2px; }
            .ibx-assistant-table__num .ibx-assistant-table-link { text-align: right; }
            .ibx-assistant-table-row-selectable { cursor: pointer; }
            .ibx-assistant-table-row-selectable:hover { background: #f1f5f9 !important; }
            .ibx-assistant-table-insight-head { text-align: left !important; justify-content: flex-start; color: #1f2937; }
            .ibx-assistant-table-insight-cell { color: #334155; font-weight: 650; font-size: 12px; line-height: 17px; white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere; text-align: left !important; background: #fbfdff; padding-top: 8px; padding-bottom: 8px; }
            .ibx-assistant-table-insight-cell.ibx-assistant-table-total { background: #eef2f7 !important; }
            .ibx-assistant-table-group-section {
                min-height: 28px;
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 7px 10px;
                background: linear-gradient(90deg, #eef6ff 0%, #f8fbff 100%) !important;
                border-top: 1px solid rgba(37,99,235,0.18);
                border-bottom: 1px solid rgba(37,99,235,0.18);
                color: #1e3a8a;
                font: 900 11px/1.2 Segoe UI, Arial, sans-serif;
                letter-spacing: 0;
                text-transform: none;
                box-shadow: inset 3px 0 0 rgba(37,99,235,0.55);
            }
            .ibx-assistant-table-wrap:not(.ibx-assistant-matrix-wrap) > .ibx-assistant-table .ibx-assistant-table-head { position: sticky; top: 36px; z-index: 12; background: #f8fafc !important; box-shadow: 0 1px 0 rgba(15,23,42,0.12); }
            .ibx-assistant-table-wrap:not(.ibx-assistant-matrix-wrap) > .ibx-assistant-table .ibx-assistant-table-head.ibx-assistant-table-sticky { left: 0; z-index: 16; box-shadow: 1px 0 0 rgba(15,23,42,0.12), 0 1px 0 rgba(15,23,42,0.12); }
            .ibx-assistant-table-wrap:not(.ibx-assistant-matrix-wrap) > .ibx-assistant-table .ibx-assistant-table-total { position: sticky; bottom: 0; z-index: 9; background: #eef2f7 !important; color: #0f172a; font-weight: 900; box-shadow: 0 -1px 0 rgba(15,23,42,0.12); }
            .ibx-assistant-table-wrap:not(.ibx-assistant-matrix-wrap) > .ibx-assistant-table .ibx-assistant-table-total.ibx-assistant-table-sticky { left: 0; z-index: 13; box-shadow: 1px 0 0 rgba(15,23,42,0.12), 0 -1px 0 rgba(15,23,42,0.12); }
            .ibx-assistant-table-row-selected,
            .ibx-assistant-table-row-selected.ibx-assistant-table-sticky,
            .ibx-assistant-table-row-selected.ibx-assistant-table-high,
            .ibx-assistant-table-row-selected.ibx-assistant-table-low,
            .ibx-assistant-table-row-selected.ibx-assistant-matrix-subtotal { background: #d1d5db !important; color: #0f172a !important; }
            .ibx-assistant-table-row-selected .ibx-assistant-table-link { color: #0f172a; text-decoration: none; }
            .ibx-assistant-matrix-wrap { width: fit-content; max-width: 96%; min-width: 0; }
            .ibx-assistant--fullscreen .ibx-assistant-matrix-wrap { width: min(var(--ibx-fullscreen-table-width, 100%), 100%); max-width: 100%; min-width: 0; max-height: min(62vh, 640px); }
            .ibx-assistant-matrix-controls { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 6px; margin-left: auto; }
            .ibx-assistant-matrix-toolbar-btn { min-height: 24px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(148,163,184,0.45); border-radius: 6px; background: #ffffff; color: #334155; font: 800 11px/1 Segoe UI, Arial, sans-serif; padding: 5px 8px; cursor: pointer; box-shadow: 0 1px 2px rgba(15,23,42,0.04); }
            .ibx-assistant-matrix-toolbar-btn:hover { border-color: rgba(37,99,235,0.35); background: #eff6ff; color: #1d4ed8; }
            .ibx-assistant-matrix-control { width: 28px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(148,163,184,0.45); border-radius: 7px; background: #ffffff; color: #334155; font: 900 15px/1 Segoe UI, Arial, sans-serif; padding: 0; cursor: pointer; box-shadow: 0 1px 2px rgba(15,23,42,0.04); }
            .ibx-assistant-matrix-control:hover { border-color: rgba(37,99,235,0.35); background: #eff6ff; color: #1d4ed8; }
            .ibx-assistant-matrix-control--active { border-color: rgba(37,99,235,0.45); background: #dbeafe; color: #1d4ed8; }
            .ibx-assistant-matrix-wrap > .ibx-assistant-table-toolbar { min-height: 36px; padding: 7px 8px 5px; border-bottom: 1px solid rgba(226,232,240,0.9); }
            .ibx-assistant-matrix-wrap > .ibx-assistant-table-toolbar .ibx-assistant-table-title { font: 800 12px/1.25 Segoe UI, Arial, sans-serif; color: #0f172a; }
            .ibx-assistant-matrix-wrap > .ibx-assistant-table-scroll-hint { padding: 6px 8px; border-bottom: 1px solid rgba(226,232,240,0.72); background: #f8fafc; color: #475569; font: 750 11px/1.25 Segoe UI, Arial, sans-serif; }
            .ibx-assistant-matrix .ibx-assistant-table-head { position: sticky; top: 0; z-index: 13; min-height: 30px; padding-top: 6px; padding-bottom: 6px; background: #ffffff !important; color: #334155; border-bottom: 1px solid rgba(15,23,42,0.14); box-shadow: 0 1px 0 rgba(15,23,42,0.08); }
            .ibx-assistant-matrix .ibx-assistant-table-head.ibx-assistant-table-sortable--text { justify-content: space-between; text-align: left; gap: 8px; }
            .ibx-assistant-matrix .ibx-assistant-table-head-tools { margin-left: auto; }
            .ibx-assistant-matrix .ibx-assistant-table-sticky { left: 0; min-width: 220px; max-width: 260px; z-index: 9; background-clip: padding-box; }
            .ibx-assistant-matrix .ibx-assistant-table-head.ibx-assistant-table-sticky { top: 0; z-index: 16; background: #f8fafc !important; box-shadow: 1px 0 0 rgba(15,23,42,0.12), 0 1px 0 rgba(15,23,42,0.14); }
            .ibx-assistant-matrix .ibx-assistant-matrix-row-label { z-index: 10; background: #ffffff !important; box-shadow: 1px 0 0 rgba(15,23,42,0.12); }
            .ibx-assistant-matrix .ibx-assistant-table-sticky.ibx-assistant-matrix-grand-total { z-index: 15; background: #eef2f7 !important; box-shadow: 1px 0 0 rgba(15,23,42,0.12), 0 -1px 0 rgba(15,23,42,0.10); }
            .ibx-assistant-matrix-row-label { padding-left: calc(8px + (var(--ibx-matrix-level, 0) * 18px)); display: flex; align-items: center; gap: 6px; }
            .ibx-assistant-matrix-row-label--parent { font-weight: 700; background: #fbfdff; }
            .ibx-assistant-matrix-row-label--collapsed { background: #ffffff !important; }
            .ibx-assistant-matrix-subtotal { font-weight: 850 !important; background: #eaf2ff !important; color: #0f172a; border-top: 1px solid rgba(37,99,235,0.18); border-bottom: 1px solid rgba(37,99,235,0.18); }
            .ibx-assistant-matrix-grand-total { position: sticky; bottom: 0; z-index: 1; font-weight: 900 !important; background: #eef2f7 !important; color: #0f172a; border-top: 1px solid rgba(15,23,42,0.18); box-shadow: 0 -1px 0 rgba(15,23,42,0.08); }
            .ibx-assistant-table-sticky.ibx-assistant-matrix-grand-total { z-index: 7; }
            .ibx-assistant-matrix-toggle { width: 18px; height: 18px; flex: 0 0 18px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(148,163,184,0.45); border-radius: 5px; background: #ffffff; color: #64748b; padding: 0; cursor: pointer; box-shadow: 0 1px 2px rgba(15,23,42,0.05); transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease; }
            .ibx-assistant-matrix-toggle svg { width: 12px; height: 12px; display: block; transform: rotate(0deg); transition: transform 120ms ease; }
            .ibx-assistant-matrix-toggle svg path { fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
            .ibx-assistant-matrix-toggle--open svg { transform: rotate(90deg); }
            .ibx-assistant-matrix-toggle--column { margin-right: 4px; }
            .ibx-assistant-matrix-toggle:hover { background: #eff6ff; border-color: rgba(37,99,235,0.45); color: #1d4ed8; }
            .ibx-assistant-matrix-spacer { flex: 0 0 18px; width: 18px; height: 18px; }
            .ibx-assistant-matrix-label-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .ibx-assistant-table-total { background: #f8fafc !important; color: #0f172a; font-weight: 700; border-top: 1px solid rgba(15,23,42,0.16); }
            .ibx-assistant-table-sticky.ibx-assistant-table-total { left: 0; z-index: 8; }
            .ibx-assistant-table-group-row { background: #f8fafc !important; color: #475569; font-weight: 850; text-transform: uppercase; letter-spacing: .03em; font-size: 10.5px; border-top: 1px solid rgba(148,163,184,0.22); border-bottom: 1px solid rgba(148,163,184,0.16); }
            .ibx-assistant-table-group-row:not(.ibx-assistant-table-name) { color: transparent; }
            .ibx-assistant-table-high { background: #f7fefb !important; color: #047857; font-weight: 700; }
            .ibx-assistant-table-low { background: #fffaf4 !important; color: #c2410c; font-weight: 700; }
            .ibx-assistant-table-cell--bar { position: relative; isolation: isolate; }
            .ibx-assistant-table-cell--bar.ibx-assistant-table-high,
            .ibx-assistant-table-cell--bar.ibx-assistant-table-low { background: #ffffff !important; }
            .ibx-assistant-table-cell-bar { position: absolute; top: 8px; bottom: 8px; left: 8px; min-width: 3px; border-radius: 999px; opacity: 1; pointer-events: none; z-index: 0; }
            .ibx-assistant-table-cell-bar--neutral { background: rgba(37,99,235,0.13); }
            .ibx-assistant-table-cell-bar--good { background: rgba(16,185,129,0.18); }
            .ibx-assistant-table-cell-bar--bad { background: rgba(249,115,22,0.16); }
            .ibx-assistant-table-cell-value { display: inline-flex; align-items: baseline; justify-content: flex-end; gap: 4px; max-width: 100%; min-width: 0; }
            .ibx-assistant-table-cell-main-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
            .ibx-assistant-table-cell-delta { flex: 0 0 auto; display: inline; max-width: 56px; padding: 0; border: 0; border-radius: 0; background: transparent; color: rgba(71,85,105,0.66); font-size: 9px; line-height: 1; font-weight: 650; letter-spacing: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .ibx-assistant-table-cell-delta-muted { color: rgba(71,85,105,0.62); }
            .ibx-assistant-table-cell-delta-arrow { font-size: 9px; font-weight: 900; line-height: 1; }
            .ibx-assistant-table-cell-delta-arrow--up { color: #059669; }
            .ibx-assistant-table-cell-delta-arrow--down { color: #dc2626; }
            .ibx-assistant-table-cell-delta-percent { font-size: 9px; font-weight: 700; line-height: 1; }
            .ibx-assistant-table-cell-delta-percent--up { color: #059669; }
            .ibx-assistant-table-cell-delta-percent--down { color: #dc2626; }
            .ibx-assistant-table-cell-delta--up,
            .ibx-assistant-table-cell-delta--down { color: rgba(71,85,105,0.66); }
            .ibx-assistant-table-cell-delta--good,
            .ibx-assistant-table-cell-delta--bad,
            .ibx-assistant-table-cell-delta--neutral { color: rgba(71,85,105,0.66); background: transparent; border: 0; }
            .ibx-assistant-table-cell-value,
            .ibx-assistant-table-cell--bar .ibx-assistant-table-link,
            .ibx-assistant-table-cell--bar .ibx-assistant-benchmark-cell { position: relative; z-index: 1; }
            .ibx-assistant-table-row-selected.ibx-assistant-table-cell--bar .ibx-assistant-table-cell-bar,
            .ibx-assistant-table-row-selected .ibx-assistant-table-cell-bar { opacity: 0.34; background: rgba(100,116,139,0.34); }
            .ibx-assistant-table .ibx-assistant-table-row-selected,
            .ibx-assistant-table .ibx-assistant-table-row-selected.ibx-assistant-table-sticky,
            .ibx-assistant-table .ibx-assistant-table-row-selected.ibx-assistant-table-high,
            .ibx-assistant-table .ibx-assistant-table-row-selected.ibx-assistant-table-low,
            .ibx-assistant-matrix .ibx-assistant-table-row-selected.ibx-assistant-matrix-row-label,
            .ibx-assistant-matrix .ibx-assistant-table-row-selected.ibx-assistant-matrix-row-label--parent,
            .ibx-assistant-matrix .ibx-assistant-table-row-selected.ibx-assistant-matrix-row-label--collapsed,
            .ibx-assistant-matrix .ibx-assistant-table-row-selected.ibx-assistant-matrix-subtotal,
            .ibx-assistant-matrix .ibx-assistant-table-row-selected.ibx-assistant-matrix-grand-total { background: #d1d5db !important; color: #0f172a !important; }
            .ibx-assistant-table .ibx-assistant-table-row-selected .ibx-assistant-table-link,
            .ibx-assistant-matrix .ibx-assistant-table-row-selected .ibx-assistant-table-link { color: #0f172a !important; text-decoration: none; }
            .ibx-assistant-kpi-card { align-self: flex-start; width: min(200px, 96%); background: #ffffff; border: 1px solid rgba(15,23,42,0.10); border-radius: 8px; box-shadow: 0 5px 16px rgba(15,23,42,0.06); padding: 9px 11px 10px; color: #0f172a; font-family: Segoe UI, Arial, sans-serif; }
            .ibx-assistant-kpi-head { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 8px; margin-bottom: 8px; }
            .ibx-assistant-kpi-title { min-width: 0; color: #334155; font: 800 12px/1.25 Segoe UI, Arial, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .ibx-assistant-kpi-value { color: #0f172a; font: 900 30px/1.05 Segoe UI, Arial, sans-serif; letter-spacing: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
            .ibx-assistant-kpi-scope { margin-top: 6px; color: #64748b; font: 700 11px/1.25 Segoe UI, Arial, sans-serif; }
            .ibx-assistant-chart { align-self: flex-start; width: min(var(--ibx-assistant-chart-width, 680px), 100%); flex: 0 0 auto; background: #ffffff; border: 1px solid rgba(15,23,42,0.08); border-radius: 8px; padding: 8px; box-shadow: 0 5px 16px rgba(15,23,42,0.05); }
            .ibx-assistant-chart--multi,
            .ibx-assistant-chart--compact,
            .ibx-assistant-chart--single { width: min(var(--ibx-assistant-chart-width, 680px), 100%); }
            .ibx-assistant-chart-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 4px; }
            .ibx-assistant-chart-title { color: #0f172a; font-size: 12px; font-weight: 800; margin: 0 0 4px; }
            .ibx-assistant-chart-head .ibx-assistant-chart-title { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .ibx-assistant-pin-report-btn { width: 28px !important; height: 26px !important; min-width: 28px !important; min-height: 26px !important; padding: 0 !important; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 28px; border-radius: 7px; box-sizing: border-box; }
            .ibx-assistant-pin-report-icon { width: 15px !important; height: 15px !important; display: block; flex: 0 0 15px; }
            .ibx-assistant-chart-summary { display: none; margin: 0 0 8px; padding: 0; border: 0; border-radius: 0; background: transparent; color: #334155; font: 700 11px/1.35 Segoe UI, Arial, sans-serif; }
            .ibx-assistant-chart svg { display: block; width: 100%; height: auto; margin-top: 2px; }
            .ibx-assistant--fullscreen .ibx-assistant-chart svg { max-height: 360px; }
            .ibx-assistant-chart--multi svg { max-height: none; }
            .ibx-assistant-chart--compact svg { max-height: 190px; }
            .ibx-assistant--fullscreen .ibx-assistant-chart--compact svg { max-height: 260px; }
            .ibx-assistant-chart--single svg { max-height: 128px; }
            .ibx-assistant--fullscreen .ibx-assistant-chart--single svg { max-height: 180px; }
            .ibx-assistant-chart--donut svg { max-height: 134px; margin-top: 0; }
            .ibx-assistant--fullscreen .ibx-assistant-chart--donut svg { max-height: 190px; }
            .ibx-assistant-chart-metrics { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 7px; padding: 0 0 7px; border-bottom: 1px solid rgba(15,23,42,0.07); }
            .ibx-assistant-chart-metric { border: 1px solid rgba(37,99,235,0.24); border-radius: 999px; background: #ffffff; color: #1d4ed8; padding: 4px 8px; font: 750 11px/1.2 Segoe UI, Arial, sans-serif; cursor: pointer; max-width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .ibx-assistant-chart-metric:hover { background: #dbeafe; border-color: rgba(37,99,235,0.42); }
            .ibx-assistant-chart-metric--active { background: #2563eb; border-color: #2563eb; color: #ffffff; }
            .ibx-assistant-chart-types { display: flex; flex-wrap: wrap; gap: 5px; margin: -2px 0 8px; }
            .ibx-assistant-chart-type { border: 1px solid rgba(100,116,139,0.18); border-radius: 6px; background: #ffffff; color: #475569; padding: 3px 7px; font: 750 11px/1.2 Segoe UI, Arial, sans-serif; cursor: pointer; }
            .ibx-assistant-chart-type:hover { background: #f1f5f9; border-color: rgba(37,99,235,0.32); color: #1d4ed8; }
            .ibx-assistant-chart-type--active { background: #0f172a; border-color: #0f172a; color: #ffffff; }
            .ibx-assistant-chart-table { display: none; padding: 2px 0 3px; }
            .ibx-assistant-chart-table-grid { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 0; border: 1px solid rgba(15,23,42,0.10); border-radius: 8px; overflow: hidden; background: #ffffff; }
            .ibx-assistant-chart-table-name,
            .ibx-assistant-chart-table-value { min-width: 0; padding: 7px 9px; border-bottom: 1px solid rgba(15,23,42,0.07); font: 700 11px/1.25 Segoe UI, Arial, sans-serif; color: #334155; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .ibx-assistant-chart-table-value { text-align: right; color: #0f172a; font-weight: 850; font-variant-numeric: tabular-nums; }
            .ibx-assistant-chart-table-name:nth-last-child(2),
            .ibx-assistant-chart-table-value:last-child { border-bottom: 0; }
            .ibx-assistant-chart-label { fill: #334155; font: 600 11px Segoe UI, Arial, sans-serif; letter-spacing: 0; }
            .ibx-assistant-chart-value { fill: #0f172a; font: 800 11px Segoe UI, Arial, sans-serif; letter-spacing: 0; }
            .ibx-assistant-chart-value--center { text-anchor: middle; }
            .ibx-assistant-chart-value--inside { fill: #ffffff; font-weight: 900; paint-order: stroke; stroke: rgba(15,23,42,0.16); stroke-width: 2px; stroke-linejoin: round; }
            .ibx-assistant-chart-value--inside-active { fill: #ffffff !important; font-weight: 950 !important; paint-order: stroke; stroke: rgba(15,23,42,0.38); stroke-width: 2.6px; stroke-linejoin: round; }
            .ibx-assistant-chart-grid { stroke: #e2e8f0; stroke-width: 1; }
            .ibx-assistant-chart-grid--vertical { stroke: #edf2f7; stroke-dasharray: 2 3; }
            .ibx-assistant-chart-axis { fill: #94a3b8; font: 600 9.5px Segoe UI, Arial, sans-serif; }
            .ibx-assistant-chart-bar-bg { fill: #e8eef7; opacity: 1; }
            .ibx-assistant-matrix-summary { display: grid; gap: 4px; margin: 6px 0 8px; padding: 7px 8px; border: 1px solid rgba(15,23,42,0.08); border-radius: 8px; background: #f8fafc; color: #334155; font: 650 11px/1.35 Segoe UI, Arial, sans-serif; }
            .ibx-assistant-matrix-summary-item { min-width: 0; overflow-wrap: anywhere; }
            .ibx-assistant-matrix-options { display: grid; gap: 8px; margin: 7px 0 8px; padding: 8px; border: 1px solid rgba(37,99,235,0.14); border-radius: 8px; background: #f8fbff; }
            .ibx-assistant-matrix-editor { display: grid; gap: 8px; margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
            .ibx-assistant-matrix-editor-section { display: grid; grid-template-columns: 72px minmax(0,1fr); align-items: start; gap: 8px; padding: 7px; border: 1px solid rgba(148,163,184,0.20); border-radius: 8px; background: #ffffff; }
            .ibx-assistant-matrix-editor-title { color: #475569; font: 850 11px/1.25 Segoe UI, Arial, sans-serif; padding-top: 6px; }
            .ibx-assistant-matrix-editor-body { display: grid; gap: 7px; min-width: 0; }
            .ibx-assistant-matrix-editor-row { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
            .ibx-assistant-matrix-pill { display: inline-flex; align-items: center; gap: 4px; min-height: 24px; max-width: 250px; padding: 3px 5px 3px 8px; border-radius: 999px; background: #eff6ff; border: 1px solid rgba(37,99,235,0.20); color: #1d4ed8; font: 750 11px/1.2 Segoe UI, Arial, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .ibx-assistant-matrix-drag-handle { flex: 0 0 auto; color: #94a3b8; font: 900 12px/1 "Segoe UI", Arial, sans-serif; cursor: grab; letter-spacing: -2px; padding-right: 2px; user-select: none; }
            .ibx-assistant-matrix-pill:active .ibx-assistant-matrix-drag-handle { cursor: grabbing; }
            .ibx-assistant-matrix-pill--dragging { opacity: 0.55; }
            .ibx-assistant-matrix-pill--drop-before { box-shadow: inset 3px 0 0 #2563eb; }
            .ibx-assistant-matrix-editor-row--drop { outline: 1px dashed rgba(37,99,235,0.45); outline-offset: 3px; border-radius: 7px; }
            .ibx-assistant-matrix-pill-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .ibx-assistant-matrix-pill-btn { width: 18px; height: 18px; flex: 0 0 18px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(37,99,235,0.16); border-radius: 999px; background: rgba(255,255,255,0.78); color: #1d4ed8; font: 850 10px/1 Segoe UI, Arial, sans-serif; padding: 0; cursor: pointer; }
            .ibx-assistant-matrix-pill-btn:hover:not(:disabled) { background: #dbeafe; border-color: rgba(37,99,235,0.34); }
            .ibx-assistant-matrix-pill-btn:disabled { opacity: 0.35; cursor: default; }
            button.ibx-assistant-matrix-pill { cursor: pointer; }
            button.ibx-assistant-matrix-pill:hover { background: #dbeafe; border-color: rgba(37,99,235,0.36); }
            .ibx-assistant-matrix-pill--empty { background: #f8fafc; border-color: rgba(148,163,184,0.28); color: #64748b; padding: 5px 9px; }
            .ibx-assistant-matrix-add-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0; }
            .ibx-assistant-matrix-add-picker { position: relative; width: min(270px, 100%); }
            .ibx-assistant-matrix-add-trigger { width: 100%; min-height: 28px; display: flex; align-items: center; justify-content: space-between; border: 1px solid rgba(148,163,184,0.42); border-radius: 7px; background: #ffffff; color: #0f172a; font: 750 11px/1.2 "Segoe UI", Arial, sans-serif; padding: 5px 28px 5px 9px; cursor: pointer; text-align: left; outline: none; }
            .ibx-assistant-matrix-add-trigger::after { content: ""; position: absolute; right: 10px; top: 50%; width: 7px; height: 7px; border-right: 2px solid #334155; border-bottom: 2px solid #334155; transform: translateY(-65%) rotate(45deg); pointer-events: none; }
            .ibx-assistant-matrix-add-trigger.is-open, .ibx-assistant-matrix-add-trigger:focus { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.10); }
            .ibx-assistant-matrix-add-menu { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 45; padding: 7px; border: 1px solid rgba(148,163,184,0.42); border-radius: 9px; background: #ffffff; box-shadow: 0 12px 26px rgba(15,23,42,0.16); }
            .ibx-assistant-matrix-add-search { width: min(260px, 100%); min-height: 28px; box-sizing: border-box; border: 1px solid rgba(148,163,184,0.42); border-radius: 7px; background: #ffffff; color: #0f172a; font: 700 11px/1.2 "Segoe UI", Arial, sans-serif; padding: 5px 9px; outline: none; }
            .ibx-assistant-matrix-add-search:focus { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.10); }
            .ibx-assistant-matrix-add-list { margin-top: 6px; max-height: 210px; overflow: auto; scrollbar-width: thin; }
            .ibx-assistant-matrix-add-option { width: 100%; min-height: 27px; display: block; border: 0; border-radius: 6px; background: transparent; color: #0f172a; padding: 6px 7px; font: 700 11px/1.25 "Segoe UI", Arial, sans-serif; text-align: left; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .ibx-assistant-matrix-add-option:hover, .ibx-assistant-matrix-add-option:focus { background: #eff6ff; color: #1d4ed8; outline: none; }
            .ibx-assistant-matrix-add-empty { padding: 8px 7px; color: #64748b; font: 700 11px/1.25 "Segoe UI", Arial, sans-serif; }
            .ibx-assistant-matrix-add-select { width: min(260px, 100%); min-height: 28px; border: 1px solid rgba(148,163,184,0.42); border-radius: 7px; background: #ffffff; color: #0f172a; font: 700 11px/1.2 "Segoe UI", Arial, sans-serif; padding: 5px 28px 5px 9px; outline: none; }
            .ibx-assistant-matrix-add-select:focus { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.10); }
            .ibx-assistant-matrix-add { max-width: 155px; padding: 3px 8px; font-size: 11px; }
            .ibx-assistant-matrix-editor-actions { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 2px; }
            .ibx-assistant-pinned-matrix { display: grid; grid-template-columns: 92px minmax(0,1fr); gap: 7px; align-items: start; border-top: 1px solid rgba(15,23,42,0.08); padding-top: 7px; }
            .ibx-assistant-pinned-item { display: inline-flex; align-items: center; gap: 3px; max-width: 210px; }
            .ibx-assistant-pinned-item .ibx-assistant-chip { max-width: 172px; }
            .ibx-assistant-pinned-delete { width: 20px; height: 20px; border: 1px solid rgba(148,163,184,0.32); border-radius: 999px; background: #ffffff; color: #64748b; font: 900 13px/18px Segoe UI, Arial, sans-serif; cursor: pointer; padding: 0; }
            .ibx-assistant-pinned-delete:hover { background: #fef2f2; border-color: rgba(220,38,38,0.32); color: #b91c1c; }
            .ibx-assistant--saved-view .ibx-assistant-form-wrap { display: none !important; }
            .ibx-assistant--saved-view .ibx-assistant-messages { padding-bottom: 18px; }
            .ibx-assistant--saved-view .ibx-assistant-reports { display: none; }
            .ibx-assistant--saved-view .ibx-assistant-clear { display: none; }
            .ibx-assistant-saved-view { width: min(1040px, calc(100% - 24px)); margin: 0 auto; display: flex; flex-direction: column; gap: 14px; font-family: Segoe UI, Arial, sans-serif; }
            .ibx-assistant-saved-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 4px 2px 2px; }
            .ibx-assistant-saved-title-group { display: flex; align-items: center; gap: 10px; min-width: 0; }
            .ibx-assistant-saved-head-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
            .ibx-assistant-saved-back { flex: 0 0 auto; height: 32px; display: inline-flex; align-items: center; gap: 7px; border: 0 !important; border-radius: 8px; background: transparent !important; color: #2563eb; padding: 0 9px 0 5px; font: 600 12px/16px "Segoe UI", Arial, sans-serif; cursor: pointer; box-shadow: none !important; letter-spacing: 0; }
            .ibx-assistant-saved-back-icon { width: 17px; height: 17px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; border-radius: 0; background: transparent !important; color: currentColor; box-shadow: none !important; }
            .ibx-assistant-saved-back-icon path { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
            .ibx-assistant-saved-back:hover { color: #1d4ed8; background: rgba(37,99,235,0.08) !important; box-shadow: none !important; }
            .ibx-assistant-saved-back:focus-visible { outline: 2px solid rgba(37,99,235,0.35); outline-offset: 2px; }
            .ibx-assistant-saved-back:hover .ibx-assistant-saved-back-icon { background: transparent !important; color: currentColor; box-shadow: none !important; }
            .ibx-assistant-saved-title { font: 800 18px/1.2 Segoe UI, Arial, sans-serif; color: #0f172a; }
            .ibx-assistant-saved-meta { font: 700 12px/1.35 Segoe UI, Arial, sans-serif; color: #64748b; }
            .ibx-assistant-saved-empty { width: fit-content; max-width: 520px; padding: 12px 14px; border: 1px solid rgba(148,163,184,0.22); border-radius: 12px; background: #ffffff; color: #475569; box-shadow: 0 4px 12px rgba(15,23,42,0.06); font: 600 13px/1.4 Segoe UI, Arial, sans-serif; }
            .ibx-assistant-saved-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); grid-auto-rows: 48px; grid-auto-flow: dense; gap: 10px; align-items: stretch; }
            .ibx-assistant-saved-list--canvas { position: relative; display: block; min-height: 520px; overflow: auto; }
            .ibx-assistant-saved-list--editing { padding: 10px; border: 1px dashed rgba(37,99,235,0.26); border-radius: 12px; background-color: rgba(239,246,255,0.42); background-image: linear-gradient(rgba(37,99,235,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(37,99,235,0.07) 1px, transparent 1px); background-size: 24px 24px; }
            .ibx-assistant-saved-card { position: relative; grid-column: span var(--saved-w, 2); grid-row: span var(--saved-h, 4); min-width: 0; min-height: 0; height: 100%; border: 1px solid rgba(148,163,184,0.22); border-radius: 10px; background: #ffffff; box-shadow: 0 3px 10px rgba(15,23,42,0.05); padding: 9px; display: flex; flex-direction: column; gap: 6px; cursor: default; outline: none; transition: border-color 130ms ease, box-shadow 130ms ease, transform 130ms ease, opacity 130ms ease; }
            .ibx-assistant-saved-list--canvas > .ibx-assistant-saved-card { position: absolute; grid-column: auto !important; grid-row: auto !important; box-sizing: border-box; }
            .ibx-assistant-saved-card--small,
            .ibx-assistant-saved-card--medium,
            .ibx-assistant-saved-card--large { grid-column: span var(--saved-w, 2); }
            .ibx-assistant-saved-card--h-short,
            .ibx-assistant-saved-card--h-normal,
            .ibx-assistant-saved-card--h-tall { height: 100%; }
            .ibx-assistant-saved-card--editing { cursor: grab; user-select: none; border-color: rgba(37,99,235,0.20); }
            .ibx-assistant-saved-card--editing:active { cursor: grabbing; }
            .ibx-assistant-saved-card--resizing, .ibx-assistant-saved-card--resizing:active { cursor: nwse-resize; }
            .ibx-assistant-saved-card--dragging { opacity: 0.48; transform: scale(0.985); }
            .ibx-assistant-saved-card--drop { border-color: rgba(37,99,235,0.60); box-shadow: 0 0 0 2px rgba(37,99,235,0.14), 0 8px 20px rgba(37,99,235,0.12); }
            .ibx-assistant-saved-card:hover, .ibx-assistant-saved-card:focus-visible { border-color: rgba(148,163,184,0.32); box-shadow: 0 5px 16px rgba(15,23,42,0.07); }
            .ibx-assistant-saved-card--editing:hover, .ibx-assistant-saved-card--editing:focus-visible { border-color: rgba(37,99,235,0.45); box-shadow: 0 10px 24px rgba(37,99,235,0.13); }
            .ibx-assistant-saved-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 36px; margin: -9px -9px 0; padding: 8px 9px; border-radius: 10px 10px 0 0; background: var(--saved-header-color, #f8fafc); border-bottom: 1px solid rgba(15,23,42,0.07); }
            .ibx-assistant-saved-drag { flex: 0 0 auto; color: #94a3b8; font: 900 13px/1 Segoe UI, Arial, sans-serif; letter-spacing: -3px; transform: rotate(90deg); }
            .ibx-assistant-saved-card-title-stack { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 1px; align-items: flex-start; overflow: hidden; }
            .ibx-assistant-saved-card-name { min-width: 0; color: #0f172a; font: 800 12.5px/1.18 Segoe UI, Arial, sans-serif; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
            .ibx-assistant-saved-card-name--header { width: 100%; -webkit-line-clamp: 1; color: var(--saved-header-text, #0f172a); }
            .ibx-assistant-saved-card-name--renaming { color: #334155; font-size: 12px; -webkit-line-clamp: 1; }
            .ibx-assistant-saved-card--large .ibx-assistant-saved-card-name { font-size: 13px; -webkit-line-clamp: 2; }
            .ibx-assistant-saved-type { flex: 0 1 auto; min-width: 0; color: #64748b; padding: 0; font: 650 10px/1.1 Segoe UI, Arial, sans-serif; letter-spacing: 0; text-transform: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .ibx-assistant-saved-preview { position: relative; min-width: 0; min-height: 0; display: block; flex: 1 1 auto; overflow: auto; padding-top: 1px; overscroll-behavior: contain; scrollbar-width: thin; }
            .ibx-assistant-saved-preview-line { min-width: 0; color: #475569; font: 650 11.5px/1.25 Segoe UI, Arial, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .ibx-assistant-saved-mini-table { display: grid; width: max-content; min-width: 100%; border: 1px solid rgba(15,23,42,0.08); border-radius: 7px; overflow: hidden; background: #ffffff; }
            .ibx-assistant-saved-mini-resize-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 6; overflow: hidden; }
            .ibx-assistant-saved-mini-resize-grip { position: absolute; width: 10px; min-width: 10px; padding: 0; margin: 0; border: 0; border-radius: 0; background: transparent; cursor: ew-resize; pointer-events: auto; }
            .ibx-assistant-saved-mini-resize-grip::after { content: ""; position: absolute; left: 4px; top: 2px; bottom: 2px; width: 1px; border-radius: 999px; background: rgba(148,163,184,0.68); }
            .ibx-assistant-saved-mini-resize-grip:hover::after,
            .ibx-assistant-saved-mini-resize-grip.is-dragging::after { left: 3px; width: 2px; background: #2563eb; box-shadow: 0 0 0 1px rgba(37,99,235,0.12); }
            .ibx-assistant-saved-mini-resize-guide { position: absolute; display: none; width: 2px; border-radius: 999px; background: #2563eb; box-shadow: 0 0 0 1px rgba(37,99,235,0.10), 0 0 10px rgba(37,99,235,0.22); pointer-events: none; z-index: 7; }
            .ibx-assistant-saved-mini-cell { min-width: 0; padding: 4px 5px; border-right: 1px solid rgba(15,23,42,0.06); border-bottom: 1px solid rgba(15,23,42,0.06); color: #0f172a; font: 700 10.5px/1.25 Segoe UI, Arial, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: #ffffff; }
            .ibx-assistant-saved-mini-head { background: #f8fafc; color: #334155; font-weight: 850; }
            .ibx-assistant-saved-mini-num { text-align: right; font-variant-numeric: tabular-nums; color: #047857; background: #ecfdf5; }
            .ibx-assistant-saved-mini-total { position: sticky; bottom: 0; z-index: 4; background: #f1f5f9 !important; color: #0f172a !important; font-weight: 900; box-shadow: inset 0 1px 0 rgba(148,163,184,0.55); transform: translateZ(0); backface-visibility: hidden; will-change: transform; }
            .ibx-assistant-saved-mini-total.ibx-assistant-saved-mini-num { color: #0f172a !important; }
            .ibx-assistant-saved-mini-selectable { cursor: pointer; }
            .ibx-assistant-saved-mini-selectable:hover { background: #f1f5f9 !important; color: #0f172a !important; }
            .ibx-assistant-saved-mini-selected { background: #d1d5db !important; color: #0f172a !important; }
            .ibx-assistant-saved-mini-chart { display: grid; gap: 5px; min-width: 0; padding: 2px 0; }
            .ibx-assistant-saved-mini-chart-row { display: grid; grid-template-columns: minmax(42px, 0.7fr) minmax(0, 1.4fr); gap: 6px; align-items: center; min-width: 0; }
            .ibx-assistant-saved-mini-chart-label { min-width: 0; color: #334155; font: 750 10.5px/1.2 Segoe UI, Arial, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .ibx-assistant-saved-mini-chart-bar-wrap { position: relative; height: 17px; min-width: 0; border-radius: 5px; background: #e8eef7; overflow: hidden; }
            .ibx-assistant-saved-mini-chart-bar { height: 100%; border-radius: 5px; background: #2563eb; }
            .ibx-assistant-saved-mini-chart-value { position: absolute; right: 5px; top: 2px; color: #0f172a; font: 850 10px/1.2 Segoe UI, Arial, sans-serif; font-variant-numeric: tabular-nums; }
            .ibx-assistant-saved-mini-kpi { min-height: 86px; display: flex; flex-direction: column; justify-content: center; gap: 7px; padding: 10px 12px; border: 1px solid rgba(15,23,42,0.08); border-radius: 7px; background: linear-gradient(180deg,#ffffff 0%,#f8fafc 100%); }
            .ibx-assistant-saved-mini-kpi-value { color: #0f172a; font: 900 24px/1.05 Segoe UI, Arial, sans-serif; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .ibx-assistant-saved-mini-kpi-scope { color: #64748b; font: 750 10.5px/1.2 Segoe UI, Arial, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .ibx-assistant-saved-updated { margin-top: auto; color: #64748b; font: 650 11.5px/1.35 Segoe UI, Arial, sans-serif; }
            .ibx-assistant-saved-layout-placeholder { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 10px; padding: 8px; border: 1px solid rgba(148,163,184,0.18); border-radius: 8px; background: #f8fafc; overflow: hidden; }
            .ibx-assistant-saved-layout-icon { min-width: 46px; height: 34px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(37,99,235,0.16); border-radius: 7px; background: #eff6ff; color: #1d4ed8; font: 850 10.5px/1 Segoe UI, Arial, sans-serif; }
            .ibx-assistant-saved-layout-lines { min-width: 0; display: grid; gap: 5px; }
            .ibx-assistant-saved-layout-line { display: block; height: 6px; border-radius: 999px; background: rgba(148,163,184,0.24); }
            .ibx-assistant-saved-layout-line:nth-child(2) { width: 78%; }
            .ibx-assistant-saved-layout-line:nth-child(3) { width: 92%; }
            .ibx-assistant-saved-layout-line:nth-child(4) { width: 64%; }
            .ibx-assistant-saved-resize { position: absolute; right: 6px; bottom: 6px; width: 28px; height: 28px; border: 0; border-radius: 8px; background: rgba(255,255,255,0.78); color: #2563eb; cursor: nwse-resize; display: inline-flex; align-items: center; justify-content: center; padding: 0; box-shadow: 0 2px 8px rgba(15,23,42,0.10); opacity: 0.78; }
            .ibx-assistant-saved-resize svg { width: 18px; height: 18px; display: block; pointer-events: none; }
            .ibx-assistant-saved-resize path { fill: none; stroke: currentColor; stroke-width: 2.1; stroke-linecap: round; stroke-linejoin: round; }
            .ibx-assistant-saved-resize:hover, .ibx-assistant-saved-card--resizing .ibx-assistant-saved-resize { background: #eff6ff; color: #1d4ed8; opacity: 1; box-shadow: 0 4px 12px rgba(37,99,235,0.16); }
            .ibx-assistant-saved-card-actions { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px; }
            .ibx-assistant-saved-menu-wrap { position: relative; flex: 0 0 auto; }
            .ibx-assistant-saved-menu-button { width: 28px; height: 26px; border: 1px solid rgba(148,163,184,0.34); border-radius: 8px; background: #ffffff; color: #475569; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font: 900 14px/1 Segoe UI, Arial, sans-serif; box-shadow: 0 1px 3px rgba(15,23,42,0.06); }
            .ibx-assistant-saved-menu-button:hover, .ibx-assistant-saved-menu-button.is-open { border-color: rgba(37,99,235,0.42); background: #eff6ff; color: #1d4ed8; }
            .ibx-assistant-saved-expand-button svg { width: 16px; height: 16px; display: block; pointer-events: none; }
            .ibx-assistant-saved-expand-button path { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
            .ibx-assistant-saved-menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 30; min-width: 158px; display: none; padding: 5px; border: 1px solid rgba(148,163,184,0.28); border-radius: 10px; background: #ffffff; box-shadow: 0 12px 28px rgba(15,23,42,0.16); }
            .ibx-assistant-saved-menu.is-open { display: flex; flex-direction: column; gap: 2px; }
            .ibx-assistant-saved-menu-item { width: 100%; border: 0; border-radius: 7px; background: transparent; color: #0f172a; text-align: left; padding: 7px 9px; cursor: pointer; font: 700 12px/1.25 Segoe UI, Arial, sans-serif; }
            .ibx-assistant-saved-menu-item:hover { background: #eff6ff; color: #1d4ed8; }
            .ibx-assistant-saved-menu-item--danger { color: #b91c1c; }
            .ibx-assistant-saved-menu-item--danger:hover { background: #fef2f2; color: #991b1b; }
            .ibx-assistant-saved-color-picker { min-height: 32px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 8px; border-top: 1px solid rgba(148,163,184,0.18); color: #334155; font: 700 12px/1.2 "Segoe UI", Arial, sans-serif; cursor: default; }
            .ibx-assistant-saved-color-swatch { width: 28px; height: 28px; flex: 0 0 28px; border: 2px solid #ffffff; border-radius: 999px; padding: 0; cursor: pointer; box-shadow: 0 0 0 1px rgba(148,163,184,0.45), 0 3px 9px rgba(15,23,42,0.14); }
            .ibx-assistant-saved-color-swatch:hover { box-shadow: 0 0 0 2px rgba(37,99,235,0.24), 0 5px 13px rgba(15,23,42,0.18); }
            .ibx-assistant-color-popover { position: absolute; z-index: 80; width: 258px; box-sizing: border-box; padding: 12px; border: 1px solid rgba(148,163,184,0.20); border-radius: 16px; background: linear-gradient(180deg, rgba(255,255,255,0.99), rgba(248,250,252,0.99)); box-shadow: 0 20px 46px rgba(15,23,42,0.20); font-family: "Segoe UI", Arial, sans-serif; }
            .ibx-assistant-color-head { display: flex; align-items: center; justify-content: space-between; gap: 9px; margin: -3px -3px 9px; padding: 3px; border-radius: 12px; color: #334155; font: 850 10.5px/1.2 "Segoe UI", Arial, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; cursor: grab; user-select: none; touch-action: none; }
            .ibx-assistant-color-head:hover { background: rgba(37,99,235,0.05); }
            .ibx-assistant-color-popover--dragging,
            .ibx-assistant-color-popover--dragging .ibx-assistant-color-head { cursor: grabbing; user-select: none; }
            .ibx-assistant-color-head-preview { width: 30px; height: 30px; border-radius: 999px; border: 2px solid #ffffff; box-shadow: 0 0 0 1px rgba(148,163,184,0.42), 0 5px 10px rgba(15,23,42,0.12); }
            .ibx-assistant-color-sv { position: relative; width: 100%; height: 122px; margin-bottom: 10px; border-radius: 14px; overflow: hidden; cursor: crosshair; box-shadow: inset 0 1px 0 rgba(255,255,255,0.3), 0 8px 18px rgba(15,23,42,0.09); touch-action: none; }
            .ibx-assistant-color-sv-white, .ibx-assistant-color-sv-black { position: absolute; inset: 0; pointer-events: none; }
            .ibx-assistant-color-sv-white { background: linear-gradient(90deg,#ffffff 0%, rgba(255,255,255,0) 100%); }
            .ibx-assistant-color-sv-black { background: linear-gradient(180deg,rgba(0,0,0,0) 0%, #000000 100%); }
            .ibx-assistant-color-thumb { position: absolute; width: 16px; height: 16px; border-radius: 999px; border: 2px solid rgba(255,255,255,0.96); box-shadow: 0 3px 9px rgba(15,23,42,0.28); transform: translate(-50%,-50%); pointer-events: none; }
            .ibx-assistant-color-hue { position: relative; width: 100%; height: 10px; margin-bottom: 10px; border-radius: 999px; cursor: pointer; background: linear-gradient(90deg,#ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%); box-shadow: inset 0 1px 1px rgba(255,255,255,0.35), inset 0 0 0 1px rgba(15,23,42,0.06); touch-action: none; }
            .ibx-assistant-color-hue-thumb { position: absolute; top: 50%; width: 16px; height: 16px; border-radius: 999px; border: 2px solid rgba(255,255,255,0.96); background: #fff; box-shadow: 0 3px 9px rgba(15,23,42,0.26); transform: translate(-50%,-50%); pointer-events: none; }
            .ibx-assistant-color-input-row { margin-bottom: 10px; }
            .ibx-assistant-color-input-row input { width: 100%; height: 32px; box-sizing: border-box; border: 1px solid rgba(203,213,225,0.95); border-radius: 10px; background: #ffffff; color: #334155; padding: 0 10px; outline: none; font: 750 11px/1 "Segoe UI", Arial, sans-serif; text-transform: uppercase; }
            .ibx-assistant-color-input-row input:focus { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.12); }
            .ibx-assistant-color-presets { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; margin-bottom: 11px; }
            .ibx-assistant-color-presets button { height: 22px; border: 1px solid rgba(15,23,42,0.08); border-radius: 999px; cursor: pointer; box-shadow: 0 2px 7px rgba(15,23,42,0.08); }
            .ibx-assistant-color-presets button:hover { transform: translateY(-1px); box-shadow: 0 5px 12px rgba(15,23,42,0.13); }
            .ibx-assistant-color-actions { display: flex; justify-content: flex-end; gap: 6px; }
            .ibx-assistant-color-btn { height: 28px; border: 1px solid rgba(148,163,184,0.34); border-radius: 8px; background: #ffffff; color: #0f172a; padding: 0 9px; cursor: pointer; font: 750 11px/1 "Segoe UI", Arial, sans-serif; box-shadow: 0 1px 2px rgba(15,23,42,0.06); }
            .ibx-assistant-color-btn:hover { border-color: rgba(37,99,235,0.38); background: #eff6ff; color: #1d4ed8; }
            .ibx-assistant-color-btn--primary { border-color: #2563eb; background: #2563eb; color: #ffffff; }
            .ibx-assistant-color-btn--primary:hover { border-color: #1d4ed8; background: #1d4ed8; color: #ffffff; }
            .ibx-assistant-saved-rename { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: center; margin-top: 0; cursor: default; }
            .ibx-assistant-saved-rename-input { min-width: 0; width: 100%; height: 32px; border: 1px solid rgba(148,163,184,0.42); border-radius: 8px; background: #ffffff; color: #0f172a; padding: 0 9px; box-sizing: border-box; font: 700 13px/1.2 "Segoe UI", Arial, sans-serif; outline: none; }
            .ibx-assistant-saved-rename-input:focus { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.13); }
            .ibx-assistant-saved-rename-actions { display: inline-flex; align-items: center; gap: 4px; }
            .ibx-assistant-saved-icon-btn { width: 30px; height: 30px; border: 1px solid rgba(148,163,184,0.34); border-radius: 8px; background: #ffffff; color: #475569; padding: 0; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font: 900 15px/1 "Segoe UI", Arial, sans-serif; box-shadow: 0 1px 2px rgba(15,23,42,0.06); }
            .ibx-assistant-saved-icon-btn:hover { border-color: rgba(37,99,235,0.38); background: #eff6ff; color: #1d4ed8; }
            .ibx-assistant-saved-icon-btn--primary { border-color: #2563eb; background: #2563eb; color: #ffffff; }
            .ibx-assistant-saved-icon-btn--primary:hover { border-color: #1d4ed8; background: #1d4ed8; color: #ffffff; }
            .ibx-assistant-saved-inline-btn { height: 28px; border: 1px solid rgba(148,163,184,0.34); border-radius: 8px; background: #ffffff; color: #0f172a; padding: 0 9px; cursor: pointer; font: 600 12px/1 "Segoe UI", Arial, sans-serif; box-shadow: 0 1px 2px rgba(15,23,42,0.06); }
            .ibx-assistant-saved-inline-btn:hover { border-color: rgba(37,99,235,0.38); background: #eff6ff; color: #1d4ed8; }
            .ibx-assistant-saved-inline-btn--primary { border-color: #2563eb; background: #2563eb; color: #ffffff; }
            .ibx-assistant-saved-inline-btn--primary:hover { border-color: #1d4ed8; background: #1d4ed8; color: #ffffff; }
            .ibx-assistant-saved-inline-btn--danger { border-color: #dc2626; background: #dc2626; color: #ffffff; }
            .ibx-assistant-saved-inline-btn--danger:hover { border-color: #b91c1c; background: #b91c1c; color: #ffffff; }
            .ibx-assistant-saved-delete-confirm { margin-top: 1px; padding: 9px; border: 1px solid rgba(220,38,38,0.18); border-radius: 10px; background: #fff7f7; cursor: default; display: flex; flex-direction: column; gap: 8px; }
            .ibx-assistant-saved-delete-text { color: #7f1d1d; font: 600 12px/1.3 "Segoe UI", Arial, sans-serif; }
            .ibx-assistant-saved-delete-actions { display: flex; justify-content: flex-end; gap: 6px; }
            .ibx-assistant-saved-actions { display: none; }
            .ibx-assistant-saved-report-view { min-height: 100%; gap: 12px; }
            .ibx-assistant-saved-report-head { padding: 8px 2px 12px; border-bottom: 1px solid rgba(148,163,184,0.16); }
            .ibx-assistant-saved-report-head .ibx-assistant-saved-title-group { gap: 12px; }
            .ibx-assistant-saved-report-head .ibx-assistant-saved-back { height: 32px; padding: 0 9px 0 5px; font: 600 12px/16px "Segoe UI", Arial, sans-serif; }
            .ibx-assistant-saved-report-title-wrap { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
            .ibx-assistant-saved-report-subtitle { max-width: 620px; color: #64748b; font: 650 12px/1.35 Segoe UI, Arial, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .ibx-assistant-saved-report-content { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; min-height: 0; padding: 2px 0 0; }
            .ibx-assistant-saved-report-content > .ibx-assistant-msg { margin-left: 0; margin-right: 0; }
            .ibx-assistant-saved-report-content .ibx-assistant-table-wrap,
            .ibx-assistant-saved-report-content .ibx-assistant-matrix-wrap { max-width: 100%; }
            .ibx-assistant-suggestions { align-self: flex-start; max-width: 92%; background: #ffffff; border: 1px solid rgba(15,23,42,0.14); border-radius: 8px; padding: 7px; box-shadow: 0 1px 0 rgba(15,23,42,0.05); }
            .ibx-assistant-suggestions-title { color: #334155; font-size: 12px; line-height: 16px; font-weight: 700; margin: 0 0 6px; }
            .ibx-assistant-suggestions-row { display: flex; flex-wrap: wrap; gap: 6px; }
            .ibx-assistant-suggestions .ibx-assistant-chip { max-width: none; white-space: normal; overflow: visible; text-overflow: clip; }
            .ibx-assistant-actions { align-self: flex-start; display: flex; flex-wrap: wrap; gap: 6px; max-width: 92%; flex: 0 0 auto; }
            .ibx-assistant-action { border: 1px solid rgba(15,23,42,0.18); border-radius: 6px; background: #ffffff; color: #0f172a; padding: 5px 8px; font-size: 12px; font-weight: 700; line-height: 16px; cursor: pointer; box-shadow: 0 1px 0 rgba(15,23,42,0.08); max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-rendering: optimizeLegibility; -webkit-font-smoothing: subpixel-antialiased; -moz-osx-font-smoothing: auto; }
            .ibx-assistant-action:hover { border-color: rgba(37,99,235,0.35); background: #eff6ff; color: #1d4ed8; }
            .ibx-assistant-chip { border: 1px solid rgba(148,163,184,0.42); border-radius: 999px; background: #ffffff; color: #1f2937; padding: 4px 9px; font-size: 12px; font-weight: 700; line-height: 16px; cursor: pointer; max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 1px 0 rgba(15,23,42,0.06); transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease; text-rendering: optimizeLegibility; -webkit-font-smoothing: subpixel-antialiased; -moz-osx-font-smoothing: auto; font-synthesis: none; }
            .ibx-assistant-chip--clarify { background: #faf5ff; color: #5b21b6; border-color: rgba(167,139,250,0.34); max-width: 190px; }
            .ibx-assistant-chip:hover, .ibx-assistant-chip:focus-visible { background: #eff6ff; border-color: rgba(37,99,235,0.34); color: #1d4ed8; box-shadow: 0 2px 6px rgba(37,99,235,0.10); outline: none; }
            .ibx-assistant-chip--clarify:hover, .ibx-assistant-chip--clarify:focus-visible { background: #f5f3ff; border-color: rgba(124,58,237,0.38); color: #6d28d9; }
            .ibx-assistant-form-wrap { position: relative; flex-shrink: 0; background: #ffffff; border-top: 1px solid rgba(15,23,42,0.12); box-shadow: 0 -1px 0 rgba(15,23,42,0.04); }
            .ibx-assistant-ac { position: fixed; left: 0; top: 0; width: 0; background: #ffffff; border: 1px solid rgba(15,23,42,0.14); border-bottom: none; border-radius: 10px 10px 0 0; box-shadow: 0 -6px 20px rgba(15,23,42,0.10); max-height: 210px; overflow-y: auto; z-index: 1000007; scrollbar-width: thin; pointer-events: auto; transform: none; text-rendering: auto; -webkit-font-smoothing: subpixel-antialiased; -moz-osx-font-smoothing: auto; font-synthesis: none; }
            .ibx-assistant-ac-item { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 34px; box-sizing: border-box; padding: 7px 10px; border: none; border-bottom: 1px solid rgba(15,23,42,0.05); background: transparent; color: #0f172a; font: 700 12px/16px Segoe UI, Arial, sans-serif; letter-spacing: 0; cursor: pointer; text-align: left; text-rendering: auto; -webkit-font-smoothing: subpixel-antialiased; -moz-osx-font-smoothing: auto; font-synthesis: none; }
            .ibx-assistant-ac-item:last-child { border-bottom: none; }
            .ibx-assistant-ac-item:hover,.ibx-assistant-ac-item--active { background: #f1f5f9; }
            .ibx-assistant-ac-empty { padding: 10px 12px; color: #64748b; font: 600 11px/1.25 Segoe UI, Arial, sans-serif; border-bottom: 1px solid rgba(15,23,42,0.06); }
            .ibx-assistant-ac-pager { position: sticky; bottom: 0; display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-top: 1px solid rgba(15,23,42,0.08); background: rgba(248,250,252,0.98); box-shadow: 0 -4px 10px rgba(15,23,42,0.05); }
            .ibx-assistant-ac-page-info { flex: 1 1 auto; min-width: 0; color: #64748b; font: 700 10px/1.2 Segoe UI, Arial, sans-serif; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .ibx-assistant-ac-page-btn { flex: 0 0 auto; border: 1px solid rgba(148,163,184,0.45); border-radius: 7px; background: #ffffff; color: #0f172a; padding: 5px 8px; font: 800 10px/1 Segoe UI, Arial, sans-serif; cursor: pointer; box-shadow: 0 1px 2px rgba(15,23,42,0.05); }
            .ibx-assistant-ac-page-btn:hover:not(:disabled) { border-color: rgba(37,99,235,0.45); color: #1d4ed8; background: #eff6ff; }
            .ibx-assistant-ac-page-btn:disabled { opacity: 0.45; cursor: default; }
            .ibx-assistant-ac-badge { flex-shrink: 0; width: 18px; height: 18px; border-radius: 4px; font: 700 9px/18px Segoe UI, Arial, sans-serif; text-align: center; }
            .ibx-assistant-ac-badge--tenant { background: #dbeafe; color: #1d4ed8; }
            .ibx-assistant-ac-badge--unit { background: #ede9fe; color: #6d28d9; }
            .ibx-assistant-ac-badge--metric { background: #dcfce7; color: #15803d; }
            .ibx-assistant-ac-badge--filter { background: #fae8ff; color: #a21caf; }
            .ibx-assistant-ac-badge--function { background: #e0f2fe; color: #0369a1; }
            .ibx-assistant-ac-badge--floor,.ibx-assistant-ac-badge--category,.ibx-assistant-ac-badge--group { background: #fef3c7; color: #92400e; }
            .ibx-assistant-ac-badge--zone,.ibx-assistant-ac-badge--layer { background: #e2e8f0; color: #475569; }
            .ibx-assistant-ac-badge--example { background: #f1f5f9; color: #334155; }
            .ibx-assistant-ac-text { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
            .ibx-assistant-ac-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .ibx-assistant-ac-detail { min-width: 0; color: #475569; font-size: 11px; line-height: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .ibx-assistant-ac-subtitle { flex: 0 0 auto; max-width: 112px; color: #334155; font-size: 11px; line-height: 16px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
            .ibx-assistant-form { display: flex; align-items: center; gap: 8px; padding: 9px 10px 10px; }
            .ibx-assistant-input-wrap { position: relative; flex: 1; min-width: 0; display: flex; align-items: center; padding: 4px 8px; border: 1px solid rgba(148,163,184,0.45); border-radius: 9px; background: #ffffff; box-shadow: 0 1px 2px rgba(15,23,42,0.04) inset; min-height: 36px; cursor: text; box-sizing: border-box; overflow: hidden; }
            .ibx-assistant-input-wrap:focus-within { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.12), 0 1px 2px rgba(15,23,42,0.04) inset; }
            .ibx-assistant-input-highlight { position: absolute; left: 11px; right: 11px; top: 4px; transform: translateX(0); z-index: 0; height: 28px; overflow: hidden; white-space: pre; pointer-events: none; color: #0f172a; font: 500 12.5px/28px "Segoe UI", Arial, sans-serif; letter-spacing: 0; }
            .ibx-assistant-input-highlight[hidden] { display: none; }
            .ibx-assistant-input-ghost { color: #94a3b8; }
            .ibx-assistant-input-token { font-weight: 500; }
            .ibx-assistant-input-token--tenant,.ibx-assistant-input-token--unit { color: #1a6fba; }
            .ibx-assistant-input-token--metric { color: #0e7a47; }
            .ibx-assistant-input-token--filter { color: #a21caf; }
            .ibx-assistant-input-token--function { color: #0369a1; }
            .ibx-assistant-input-token[data-bookmark-measures="true"] { color: #4f46e5; }
            .ibx-assistant-input-token--category,.ibx-assistant-input-token--group { color: #a16207; }
            .ibx-assistant-input-token--floor,.ibx-assistant-input-token--zone,.ibx-assistant-input-token--layer { color: #5a6a7e; }
            .ibx-assistant-input { position: relative; z-index: 1; flex: 1; min-width: 60px; height: 28px; border: none; border-radius: 0; padding: 0 3px; color: #0f172a; font: 500 12.5px/1.2 "Segoe UI", Arial, sans-serif; letter-spacing: 0; outline: none; background: transparent; -webkit-font-smoothing: subpixel-antialiased; text-rendering: optimizeLegibility; }
            .ibx-assistant-input:focus { color: #0f172a; caret-color: #0f172a; }
            .ibx-assistant-input::placeholder { color: #64748b; opacity: 0.82; font-weight: 500; }
            .ibx-assistant-send { height: 36px; min-width: 52px; border: 0; border-radius: 9px; background: #2563eb; color: #fff; padding: 0 14px; font: 800 12.5px/1 "Segoe UI", Arial, sans-serif; letter-spacing: 0; cursor: pointer; box-shadow: 0 2px 0 rgba(29,78,216,0.20), 0 4px 10px rgba(37,99,235,0.18); -webkit-font-smoothing: subpixel-antialiased; text-rendering: optimizeLegibility; }
            .ibx-assistant-send:hover { background: #1d4ed8; box-shadow: 0 2px 0 rgba(29,78,216,0.24), 0 4px 10px rgba(37,99,235,0.20); }
            .ibx-assistant-chart-bar { transform-origin: left center; animation: ibxBarIn 280ms cubic-bezier(0.22,1,0.36,1) both; transition: opacity 120ms ease; }
            .ibx-assistant-chart-bar--hover { opacity: 0.86 !important; }
            @keyframes ibxBarIn { from { transform: scaleX(0); opacity: 0.4; } to { transform: scaleX(1); opacity: 1; } }
            .ibx-assistant-chart-value { transition: fill 120ms ease, font-size 120ms ease; }
            .ibx-assistant-chart-value--active { fill: #1d4ed8 !important; font-weight: 900 !important; }
            .ibx-assistant-chart-segment { transition: opacity 120ms ease, stroke-width 120ms ease; }
            .ibx-assistant-chart-segment--hover { opacity: 0.88 !important; stroke-width: 3 !important; }
            .ibx-assistant-chart-legend-swatch--active { stroke-width: 1.5 !important; }
            .ibx-assistant-chart-legend-text--active { font-weight: 900 !important; }
            @keyframes ibxAssistantTyping { 0%, 80%, 100% { transform: translateY(0); opacity: 0.38; } 40% { transform: translateY(-3px); opacity: 0.9; } }
            @keyframes ibxAssistantIn { from { opacity: 0; } to { opacity: 1; } }
        `;
        if (!existingStyle) doc.head.appendChild(style);
    }
}

