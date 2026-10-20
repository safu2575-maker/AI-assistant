import { revenueQuestion, revenueRequest } from './revenue';
import { visualBuild } from "./buildInfo";
import { indexGroupRows, collectTextValues } from "./queryPerformance";
import { monthlyPeriod } from "./monthlyPeriods";
import { compareTimeLabels, timeFieldOrder } from "./qna/timeLayout";
import { TimeSetup, normalizeMonthPeriods, recognizedTimeTerms, calendarMonths, monthIndexLabel } from "./timeSetup";
import { settingsSelect } from "./qna/settingsSelect";
import powerbi from "powerbi-visuals-api";
import { discoverParameter, parameterMetadataColumns } from "./parameterDiscovery";
import { modelHierarchy } from "./modelFeatures";
import { readModelMatrix } from "./modelMatrix";
import { pivotModelTable } from "./modelPivot";
import { IFilter, IFilterColumnTarget } from "powerbi-models";
import { categoricalAsTable, formatPowerBiValue } from "./dataAdapter";
import { ModelSelection, QnaChartType, QnaResponse } from "./qna/types";
import { resolveFilterTarget } from "./selectionFilter";
import { filterSignature, ModelField, ParameterConfig, ParameterPlan, parameterFilters, planParameterQuestion, sameGrouping, validateParameterConfig, selectedParameterMeasures } from "./parameterQuery";

export class FieldParameterTrial {
    private panel: HTMLDetailsElement;
    private timePanel: HTMLElement;
    private timeSelectRefreshers: Array<() => void> = [];
    private status: HTMLElement;
    private table: HTMLInputElement;
    private column: HTMLInputElement;
    private options: HTMLInputElement;
    private mappings: HTMLTextAreaElement;
    private measureTable: HTMLInputElement;
    private measureColumn: HTMLInputElement;
    private measureLabels: HTMLInputElement;
    private measureStatus: HTMLElement;
    private timeSelectors: Partial<Record<"dateField" | "yearField" | "monthField" | "monthIndexField", HTMLSelectElement>> = {};
    private timeOrder: HTMLSelectElement;
    private timeYearStart: HTMLInputElement;
    public measureOptions = (): string[] => this.fieldOnlyBinding ? [] : this.measureBindingObserved ? this.measures : this.measureLabels.value.trim() ? this.measureLabels.value.split(",").map(name => name.trim()).filter(Boolean) : this.measures;
    private automatic: HTMLInputElement;
    private select: HTMLSelectElement;
    private groupingChoices: HTMLElement;
    private hydrated = false;
    private autoDetected = false;
    private setupSummary: HTMLElement;
    private savedConfiguration = "";
    private recoveredEmptyMeasureFilter = false;
    private hasParameterContext = false;
    private latest?: powerbi.DataView;
    private latestFilters: powerbi.IFilter[] = [];
    private measures: string[] = [];
    private directMeasures: string[] = [];
    private measureBindingObserved = false;
    private hasMeasureParameter = false;
    public startupLoading = false;
    public startupAcceptsSegments(view: powerbi.DataView): boolean { const table = view.table || categoricalAsTable(view.categorical) || readModelMatrix(view.matrix)?.table; return sameGrouping((table?.columns || []).filter(column => !column.isMeasure && !column.roles?.measures).map(column => column.displayName), this.startup?.()?.fields || []); }
    public startup?: () => { enabled: boolean; fields: string[]; measure: string } | undefined;
    private startupNeeded = true;
    public runStartup = (): void => {
        const setup = this.startup?.();
        if (!this.startupNeeded || !setup?.enabled || this.pending || this.loadingSuggestionValues || !this.latest || !this.automaticEnabled()) return;
        this.startupNeeded = false;
        try {
            const config = this.readConfig();
            if (!this.hasParameterContext) throw new Error("Startup selection requires a field parameter. Directly bound fields are controlled by Power BI.");
            if (!setup.fields.length || setup.fields.length > 3 || new Set(setup.fields).size !== setup.fields.length || setup.fields.some(name => !config.options.includes(name)) || !this.measureOptions().includes(setup.measure)) throw new Error("Choose 1–3 available startup fields and one measure in Startup loading.");
            this.startupLoading = true;
            void this.requestBase({ groups: setup.fields, measures: [setup.measure], totalOnly: !setup.fields.length, filters: [], summary: [] }, config).catch(error => { this.status.textContent = String(error.message || error); }).finally(() => { this.startupLoading = false; });
        } catch (error) { this.status.textContent = String(error); }
    };
    public applyStartup = (): void => { this.startupNeeded = true; this.runStartup(); };
    private fieldOnlyBinding = false;
    private learnedFields = new Map<string, ModelField>();
    private suggestionFieldsLoaded = new Set<string>();
    public loadingSuggestionValues = false;
    public dataRequestsStopped = false;
    public onSuggestionValuesChanged?: () => void;
    private suggestionLoadRevision = 0;
    /** Load dictionaries in the current user's model context, never persist row values. */
    public async loadSuggestionValues(fields: string[]): Promise<void> {
        if (!this.automaticEnabled() || !this.latest || this.pending || this.loadingSuggestionValues || this.dataRequestsStopped) return;
        const config = this.readConfig();
        const missing = fields.filter(name => config.options.includes(name) && !this.suggestionFieldsLoaded.has(name));
        if (!missing.length) return;
        const revision = ++this.suggestionLoadRevision;
        const previousFilters = this.appliedFilters.slice();
        const previousTable = this.latest?.table || categoricalAsTable(this.latest?.categorical) || readModelMatrix(this.latest?.matrix)?.table;
        const previousPlan: ParameterPlan = { groups: (previousTable?.columns || []).filter(column => !column.isMeasure && !column.roles?.measures).map(column => column.displayName), measures: (previousTable?.columns || []).filter(column => column.isMeasure || column.roles?.measures).map(column => column.displayName), filters: [], summary: [] };
        this.loadingSuggestionValues = true;
        try {
            for (const name of missing) {
                if (revision !== this.suggestionLoadRevision) return;
                const response = await this.request({ groups: [name], measures: [], listOnly: true, filters: [], summary: [] }, config);
                if (revision !== this.suggestionLoadRevision) return;
                const field = this.readConfig().fields.find(field => field.name === name);
                if (field && response.table) {
                    const values = collectTextValues([], response.table.rows, 0);
                    this.learnedFields.set(name, { ...field, values });
                }
                this.suggestionFieldsLoaded.add(name);
                this.onSuggestionValuesChanged?.();
            }
        } catch (error) {
            this.trace("suggestion-values-unavailable", { message: String(error) });
        } finally {
            if (revision === this.suggestionLoadRevision) {
                if (this.dataRequestsStopped) { this.loadingSuggestionValues = false; return; }
                try {
                    await new Promise<void>((resolve, reject) => {
                        this.pending = { plan: previousPlan, filters: previousFilters, restoringSuggestions: true, resolve: () => resolve(), reject };
                        this.timer = setTimeout(() => this.fail("Could not restore the previous view after loading suggestions."), 60000);
                        this.clearPendingFilters();
                    });
                } catch { /* A submitted question takes priority over restoration. */ }
                if (revision === this.suggestionLoadRevision) this.loadingSuggestionValues = false;
            }
        }
    }
    private stopSuggestionLoading(): void {
        ++this.suggestionLoadRevision;
        if (this.loadingSuggestionValues) this.cancel();
        this.loadingSuggestionValues = false;
    }
    public valueOptions = (): Array<{ label: string; detail: string }> => {
        try { return this.readConfig().fields.flatMap(field => (field.values || []).map(label => ({ label, detail: field.name }))); } catch { return []; }
    };
    private requestConfig?: ParameterConfig;
    private waitingReason = "Power BI has not delivered an updated data view.";
    private appliedFilters: IFilter[] = [];
    private pending?: { plan: ParameterPlan; filters: IFilter[]; clearing?: boolean; restoringSuggestions?: boolean; resolve: (response: QnaResponse) => void; reject: (error: Error) => void };
    private timer?: ReturnType<typeof setTimeout>;
    private recoveryTimer?: ReturnType<typeof setTimeout>;
    private recoveredRequest = false;
    private questionRevision = 0;
    private dataRevision = 0;
    private submittedRevision = -1;
    private confirmedView?: powerbi.DataView;
    private confirmedFilters = "";
    private diagnostics: Array<Record<string, unknown>> = [];
    private trace(event: string, details: Record<string, unknown> = {}): void {
        this.diagnostics.push({ time: new Date().toISOString(), event, ...details });
        if (this.diagnostics.length > 50) this.diagnostics.shift();
    }
    public cancelQuestion = (): void => { ++this.questionRevision; this.dataRequestsStopped = true; this.stopSuggestionLoading(); this.cancel(); };
    public onDataContextChanged?: () => void;
    public onProgress?: (message: string) => void;
    private queryCache = new Map<string, powerbi.DataView>();
    private lastDataSignature = "";
    private uiStateWrites = new Map<string, { signature: string; at: number }>();
    public noteUiStateWrite(value: string): void {
        this.uiStateWrites.set(value, { signature: this.lastDataSignature, at: Date.now() });
        if (this.uiStateWrites.size > 8) this.uiStateWrites.delete(this.uiStateWrites.keys().next().value!);
    }
    private queryKey(plan: ParameterPlan, config: ParameterConfig): string {
        return JSON.stringify({ groups: [...plan.groups].sort(), measures: [...plan.measures].sort(), filters: parameterFilters(plan, config).map(filterSignature).sort(), schema: config.fields.map(field => ({ name: field.name, table: field.table, column: field.column, type: field.type })) });
    }
    private rememberQuery(plan: ParameterPlan, config: ParameterConfig, view: powerbi.DataView): void {
        const key = this.queryKey(plan, config);
        this.queryCache.delete(key); this.queryCache.set(key, view);
        if (this.queryCache.size > 24) this.queryCache.delete(this.queryCache.keys().next().value!);
    }
    private completed?: { question: string; config: string; view: powerbi.DataView | undefined; response: QnaResponse };
    public automaticEnabled = (): boolean => this.automatic.checked && this.hydrated;
    private settingsSnapshot?: { values: string[]; automatic: boolean; autoDetected: boolean; hydrated: boolean; summary: string | null };
    private settingsInputs(): Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> { return [this.table, this.column, this.options, this.measureTable, this.measureColumn, this.measureLabels, this.mappings, ...Object.values(this.timeSelectors), this.timeOrder, this.timeYearStart]; }
    private captureSettings(): NonNullable<FieldParameterTrial["settingsSnapshot"]> { return { values: this.settingsInputs().map(input => input.value), automatic: this.automatic.checked, autoDetected: this.autoDetected, hydrated: this.hydrated, summary: this.setupSummary.textContent }; }
    public cancelSettings = (): void => {
        const snapshot = this.settingsSnapshot;
        if (!snapshot) return;
        this.settingsInputs().forEach((input, index) => { input.value = snapshot.values[index]; });
        this.automatic.checked = snapshot.automatic; this.autoDetected = snapshot.autoDetected; this.hydrated = snapshot.hydrated;
        this.setupSummary.textContent = snapshot.summary;
        this.settingsSnapshot = undefined;
        if (this.hydrated) this.fillOptions(this.readConfig());
    };
    public saveSettings = (): boolean => {
        const snapshot = this.settingsSnapshot;
        if (snapshot && JSON.stringify(snapshot) === JSON.stringify(this.captureSettings())) { this.settingsSnapshot = undefined; return true; }
        try {
            const config = this.readConfig();
            this.stopSuggestionLoading(); this.cancel(); this.suggestionFieldsLoaded.clear(); this.hydrated = true; this.fillOptions(config);
            this.settingsSnapshot = undefined; this.persistConfig();
            this.status.textContent = "Configuration saved."; return true;
        } catch (error) { this.settingsSnapshot = snapshot; this.status.textContent = String((error as Error).message); return false; }
    };
    public mountSettings = (container: HTMLElement): void => { this.cancelSettings(); try { this.refreshTimeFields(this.mappedFields()); } catch { /* Allow invalid setup to be edited. */ } this.settingsSnapshot = this.captureSettings(); this.panel.hidden = false; this.panel.open = true; container.append(this.panel); };
    public mountTimeSettings = (container: HTMLElement): void => {
        container.append(this.timePanel);
        if (!this.timeSelectRefreshers.length) this.timeSelectRefreshers = [...Object.values(this.timeSelectors), this.timeOrder].map(select => settingsSelect(select));
        this.timeSelectRefreshers.forEach(refresh => refresh());
    };
    public groupingOptions = (): string[] => this.options.value.split(",").map(value => value.trim()).filter(Boolean);
    public groupAliases?: () => Record<string, string[]>;
    public defaultMeasure?: () => string | undefined;
    public additiveMeasures?: () => string[];
    public revenue?: () => ParameterConfig["revenue"];
    public preferMatrix?: (cardinalities: number[]) => boolean;

    constructor(element: HTMLElement, private host: powerbi.extensibility.visual.IVisualHost) {
        this.panel = document.createElement("details"); this.panel.className = "askbics-parameter-trial";
        const title = document.createElement("summary"); title.textContent = "Automatic data setup"; this.panel.append(title);
        this.setupSummary = document.createElement("p"); this.setupSummary.setAttribute("role", "status");
        this.setupSummary.textContent = "Waiting for field-parameter metadata. Add a field parameter to Fields and enable Show selected field in Power BI.";
        this.panel.append(this.setupSummary);
        const detect = document.createElement("button"); detect.type = "button"; detect.textContent = "Use detected setup";
        detect.onclick = () => {
            const columns = this.latest ? parameterMetadataColumns(this.latest) : [];
            const detected = discoverParameter(columns);
            if (!detected?.options.length) { this.status.textContent = "Power BI has not exposed an unambiguous parameter source. Select all parameter fields with Show selected field enabled, or review Field and measure configuration below."; this.setupSummary.textContent = this.status.textContent; return; }
            if (this.hydrated && (this.table.value !== detected.table || this.column.value !== detected.column)) { this.status.textContent = "A different parameter was detected. Review its target in Field and measure configuration below before switching."; this.setupSummary.textContent = this.status.textContent; return; }
            const measures = discoverParameter(columns, true);
            if (measures?.options.length) {
                this.measureTable.value = measures.table; this.measureColumn.value = measures.column;
                this.measureLabels.value = measures.options.join(", ");
            }
            this.autoDetected = true; this.discoverSetup(columns);
            advanced.open = true;
            this.status.textContent = "Detected setup loaded below. Review the fields and measures, then click Save settings to apply. Existing mappings are preserved.";
            this.setupSummary.textContent = this.status.textContent;
        };
        this.panel.append(detect);
        const advanced = document.createElement("details"); const advancedTitle = document.createElement("summary"); advancedTitle.textContent = "Field and measure configuration"; advanced.open = false; advanced.append(advancedTitle);
        const help = document.createElement("p"); help.textContent = "Fields are learned as Power BI exposes them. Select all parameter fields once to expose all options. Use overrides for custom parameter labels or metadata Power BI does not expose."; advanced.append(help);
        const input = (text: string, placeholder: string): HTMLInputElement => {
            const label = document.createElement("label"); label.textContent = text;
            const field = document.createElement("input"); field.placeholder = placeholder; label.append(field); advanced.append(label); return field;
        };
        this.table = input("Parameter table", "Parameter");
        this.column = input("Parameter label column", "Parameter");
        this.options = input("Grouping options (comma-separated)", "Year, City, Assigned Tenant Name");
        const automaticLabel = document.createElement("label"); automaticLabel.className = "askbics-setup-toggle";
        this.automatic = document.createElement("input"); this.automatic.type = "checkbox"; this.automatic.setAttribute("role", "switch");
        automaticLabel.append(this.automatic, document.createTextNode(" Switch grouping and filters from questions")); this.panel.insertBefore(automaticLabel, this.setupSummary);
        this.measureTable = input("Measure parameter table (optional)", "Measure Selection");
        this.measureColumn = input("Measure parameter label column", "Measure Selection");
        this.measureLabels = input("Measure parameter options (comma-separated)", "Rent Measure, Revenue");
        this.measureStatus = document.createElement("p"); this.measureStatus.textContent = "Direct measure bindings query every bound measure. For selective queries, bind a separate measure field parameter to Measures and KPIs instead."; this.panel.append(this.measureStatus);
        const mapLabel = document.createElement("label"); mapLabel.textContent = "Model field mappings (JSON, report author setup)";
        this.mappings = document.createElement("textarea"); this.mappings.rows = 6;
        this.mappings.placeholder = '[{"name":"Assigned Tenant Name","table":"Retail","column":"Tenant","aliases":["Tenant"],"values":["Home Living"]},{"name":"Date","table":"Calendar","column":"Date","type":"date"}]';
        mapLabel.append(this.mappings); advanced.append(mapLabel);
        const label = document.createElement("label"); label.textContent = "Fields to test";
        this.select = document.createElement("select"); this.select.multiple = true; this.select.size = 3;
        this.select.setAttribute("aria-label", "Grouping fields"); this.select.hidden = true; this.groupingChoices = document.createElement("div"); this.groupingChoices.className = "askbics-grouping-choices"; this.groupingChoices.setAttribute("role", "group"); this.groupingChoices.setAttribute("aria-label", "Fields to test"); label.append(this.select, this.groupingChoices);
        const troubleshooting = document.createElement("details"); const troubleshootingTitle = document.createElement("summary"); troubleshootingTitle.textContent = "Troubleshooting"; troubleshooting.append(troubleshootingTitle, label);
        const save = document.createElement("button"); save.type = "button"; save.textContent = "Save configuration";
        save.onclick = () => { this.saveSettings(); };
        const test = document.createElement("button"); test.type = "button"; test.textContent = "Test grouping";
        test.onclick = async () => {
            try {
                const config = this.readConfig(); const groups = Array.from(this.select.selectedOptions).map(option => option.value);
                if (!groups.length) throw new Error("Save configuration and select one or more grouping options.");
                await this.request({ groups, measures: this.measures, filters: [], summary: [] }, config);
            } catch (error) { this.status.textContent = String((error as Error).message); }
        };
        const reset = document.createElement("button"); reset.type = "button"; reset.textContent = "Reset query filters";
        reset.onclick = () => {
            this.cancel(); this.latest = undefined;
            this.host.applyJsonFilter(null as unknown as IFilter, "parameterTrial", "filter", powerbi.FilterAction.remove);
            this.status.textContent = "Query filters removed. Report filters still apply.";
        };
        this.status = document.createElement("p"); this.status.setAttribute("role", "status");
        this.status.textContent = "Use a real calendar date column for date ranges, calendar YTD and TTM. Failed queries never fall back to local answers.";
        const diagnosticButton = document.createElement("button"); diagnosticButton.type = "button";
        diagnosticButton.textContent = `Show / copy query diagnostics (${visualBuild})`;
        const diagnosticText = document.createElement("textarea"); diagnosticText.readOnly = true; diagnosticText.rows = 12; diagnosticText.hidden = true;
        diagnosticText.setAttribute("aria-label", "Query diagnostics: select and copy this text");
        diagnosticButton.onclick = async () => {
            diagnosticText.value = JSON.stringify({ build: visualBuild, mappingRevision: "categorical-v3-compatible", reason: this.waitingReason, events: this.diagnostics }, null, 2);
            diagnosticText.hidden = false; diagnosticText.focus(); diagnosticText.select();
            try { await navigator.clipboard.writeText(diagnosticText.value); this.status.textContent = "Query diagnostics copied. No row values are included."; }
            catch { this.status.textContent = "Diagnostics are selected below. Press Ctrl+C to copy them."; }
        };
        save.hidden = true; advanced.append(save); const testActions = document.createElement("div"); testActions.className = "askbics-setup-actions"; testActions.append(test, reset); troubleshooting.append(testActions, diagnosticButton, diagnosticText);
        const timePanel = document.createElement("section"); timePanel.className = "askbics-time-setup"; this.timePanel = timePanel;
        const timeTitle = document.createElement("h3"); timeTitle.textContent = "Time intelligence settings";
        const timeHelp = document.createElement("p"); timeHelp.textContent = "Select your Year, Month and existing numeric MonthIndex columns. YTD and TTM require MonthIndex and use it directly to filter months. Use a continuous monthly index where January 2024 is 24289 and February 2024 is 24290.";
        timePanel.append(timeTitle, timeHelp);
        const timeSelect = (labelText: string, choices: Array<[string, string]>) => {
            const label = document.createElement("label"); label.textContent = labelText;
            const select = document.createElement("select"); select.setAttribute("aria-label", labelText);
            choices.forEach(([value, text]) => { const option = document.createElement("option"); option.value = value; option.textContent = text; select.append(option); });
            label.append(select); timePanel.append(label); return select;
        };
        for (const [key, label] of [["yearField", "Year column"], ["monthField", "Month column"], ["monthIndexField", "MonthIndex column (required for YTD / TTM)"]] as const) this.timeSelectors[key] = timeSelect(label, [["", key === "monthIndexField" ? "Not configured" : "Automatic (existing behavior)"]]);
        this.timeOrder = timeSelect("Ambiguous numeric periods (for example 06/07)", [["auto", "Ask for a clearer period"], ["month-year", "Month / year → June 2007"], ["year-month", "Year / month → July 2006"]]); this.timeOrder.value = "auto";
        const yearLabel = document.createElement("label"); yearLabel.textContent = "Two-digit year window starts at";
        this.timeYearStart = document.createElement("input"); this.timeYearStart.type = "number"; this.timeYearStart.min = "1900"; this.timeYearStart.max = "9899"; this.timeYearStart.value = "2000"; yearLabel.append(this.timeYearStart); timePanel.append(yearLabel);
        const examples = document.createElement("p"); examples.textContent = "June 2026, Jun 26, 26 June, 2026 Jun, 06-26 and 26/06 all mean June 2026. The default short-year window is 2000–2099. YTD is January through the selected month; TTM includes that month and the previous 11."; timePanel.append(examples);
        this.panel.append(advanced, troubleshooting, this.status); this.panel.hidden = true; element.prepend(this.panel);
        this.settingsInputs().forEach(input => { input.oninput = () => { this.autoDetected = false; }; });
        this.automatic.onchange = () => {
            try { this.persistConfig(); this.status.textContent = this.settingsSnapshot ? "Save settings to apply changes." : this.automatic.checked ? "Automatic question grouping enabled." : "Automatic question grouping disabled."; }
            catch (error) { this.status.textContent = String((error as Error).message); }
        };
    }

    private refreshTimeFields(fields: ModelField[]): void {
        for (const [key, select] of Object.entries(this.timeSelectors)) {
            const selected = select.value;
            select.replaceChildren();
            const blank = document.createElement("option"); blank.value = ""; blank.textContent = key === "monthIndexField" ? "Not configured" : "Automatic (existing behavior)"; select.append(blank);
            fields.filter(field => key === "dateField" ? field.type === "date" : key === "monthIndexField" ? field.type === "number" : field.type !== "date").forEach(field => {
                const option = document.createElement("option"); option.value = field.name; option.textContent = `${field.name} — ${field.table}[${field.column}]`; select.append(option);
            });
            if (selected && !fields.some(field => field.name === selected)) { const missing = document.createElement("option"); missing.value = selected; missing.textContent = selected + " (mapping missing)"; select.append(missing); }
            select.value = selected;
        }
    }

    public readTimeSetup(): TimeSetup {
        return { ...Object.fromEntries(Object.entries(this.timeSelectors).filter(([, select]) => !!select.value).map(([key, select]) => [key, select.value])), numericOrder: this.timeOrder.value as TimeSetup["numericOrder"], monthIndexBase: 1, twoDigitYearStart: Number(this.timeYearStart.value) };
    }

    private persistConfig(): void {
        if (this.settingsSnapshot) return;
        const { directMeasures: _directMeasures, ...config } = this.readConfig();
        // Persist schema once, not newly observed row values on every question.
        if (this.autoDetected) {
            const overrides = JSON.parse(this.mappings.value.trim() || "[]") as ModelField[];
            config.fields = config.fields.map(field => {
                const { values: _values, ...schema } = field;
                const explicit = overrides.find(override => override.name === field.name)?.values;
                return explicit ? { ...schema, values: explicit } : schema;
            });
        }
        const serialized = JSON.stringify(config);
        if (serialized === this.savedConfiguration) return;
        this.savedConfiguration = serialized;
        this.host.persistProperties({ merge: [{ objectName: "parameterTrial", selector: null as unknown as powerbi.data.Selector, properties: { configuration: serialized } }] });
    }

    private discoverSetup(columns: powerbi.DataViewMetadataColumn[]): void {
        if (this.hydrated && !this.autoDetected) return;
        const detected = discoverParameter(columns);
        if (!detected || !detected.options.length) return;
        if (this.hydrated && (this.table.value !== detected.table || this.column.value !== detected.column)) return;
        const previousOptions = this.groupingOptions();
        const options = Array.from(new Set([...previousOptions, ...detected.options]));
        this.table.value = detected.table; this.column.value = detected.column; this.options.value = options.join(", ");
        if (!this.hydrated) this.automatic.checked = true;
        this.autoDetected = true; this.hydrated = true;
        if (options.length !== previousOptions.length) this.fillOptions(this.readConfig());
        this.setupSummary.textContent = `Detected: ${detected.table} · ${options.length} grouping fields. More fields are learned as Power BI exposes them.`;
        this.persistConfig();
    }

    private mappedFields(): ModelField[] {
        let fields = JSON.parse(this.mappings.value.trim() || "[]");
        if (!Array.isArray(fields)) throw new Error("Model field mappings must be a JSON array.");
        fields = [...fields.map((field: ModelField) => ({ ...field, ...(this.learnedFields.get(field.name)?.values?.length ? { values: Array.from(new Set([...(field.values || []), ...(this.learnedFields.get(field.name)?.values || [])])) } : {}) })), ...[...this.learnedFields.values()].filter(field => !fields.some((existing: ModelField) => existing.name === field.name))];
        return fields;
    }

    private readConfig(): ParameterConfig {
        const fields = this.mappedFields();
        const config = { table: this.table.value.trim(), column: this.column.value.trim(), options: this.options.value.split(",").map(value => value.trim()).filter(Boolean), fields, enabled: this.automatic.checked, autoDetected: this.autoDetected };
        const measureParameter = !this.fieldOnlyBinding && (!this.measureBindingObserved || this.hasMeasureParameter) && (this.measureTable.value.trim() || this.measureColumn.value.trim() || this.measureLabels.value.trim())
            ? { table: this.measureTable.value.trim(), column: this.measureColumn.value.trim(), options: this.measureLabels.value.split(",").map(name => name.trim()).filter(Boolean) } : undefined;
        const time = this.readTimeSetup();
        const hasTimeSetup = Object.values(this.timeSelectors).some(select => !!select.value) || time.numericOrder !== "auto" || time.monthIndexBase !== 1 || time.twoDigitYearStart !== 2000;
const complete = { ...config, directMeasures: this.directMeasures, revenue: this.revenue?.(), ...(this.additiveMeasures?.().length ? {additiveMeasures: this.additiveMeasures()} : {}), ...(measureParameter ? { measureParameter } : {}), ...(hasTimeSetup ? { time } : {}), ...(!this.fieldOnlyBinding && this.defaultMeasure?.() ? {defaultMeasure: this.defaultMeasure()} : {}) };
        validateParameterConfig(complete); return complete;
    }

    private fillOptions(config: ParameterConfig): void {
        this.refreshTimeFields(config.fields);
        this.select.replaceChildren();
        this.groupingChoices.replaceChildren();
        config.options.forEach(value => { const option = document.createElement("option"); option.value = value; option.textContent = value; this.select.append(option); const label = document.createElement("label"), check = document.createElement("input"); check.type = "checkbox"; check.onchange = () => { option.selected = check.checked; }; label.append(check, document.createTextNode(value)); this.groupingChoices.append(label); });
    }

    selectDataView(views: powerbi.DataView[]): powerbi.DataView | undefined {
        // Inspect every incoming shape before selecting one. Do not include row values.
        this.trace("host-response", { views: views.map((view, index) => ({
            index, hasTable: !!view.table, hasMatrix: !!view.matrix, hasCategorical: !!view.categorical,
            tableRows: view.table?.rows?.length,
            matrixLevels: view.matrix?.rows?.levels?.length,
            matrixChildren: view.matrix?.rows?.root?.children?.length,
            categoricalColumns: view.categorical?.categories?.length,
            metadataColumns: view.metadata?.columns?.map(column => column.displayName)
        })) });
        const candidates = views.flatMap(view => {
            const tables = [view.table, categoricalAsTable(view.categorical), readModelMatrix(view.matrix)?.table].filter(Boolean) as powerbi.DataViewTable[];
            return tables.map(table => ({ ...view, table }));
        });
        const score = (view: powerbi.DataView): number => {
            const fields = view.table!.columns.filter(column => !column.roles?.measures && !column.isMeasure);
            const resolved = fields.filter(column => column.sourceFieldParameters?.length && column.displayName !== this.column.value.trim()).length;
            return (this.pending && sameGrouping(fields.map(column => column.displayName), this.pending.plan.groups) ? 1000 : 0) + resolved * 10 + (view.table!.columns.length ? 1 : 0);
        };
        return candidates.sort((a, b) => score(b) - score(a))[0] || views[0];
    }

    hydrate(dataView?: powerbi.DataView): void {
        if (!dataView) return;
        const saved = dataView.metadata.objects?.parameterTrial?.configuration;
        const owned = dataView.metadata.objects?.parameterTrial?.filter as unknown as IFilter | IFilter[] | undefined;
        if (saved && !this.recoveredEmptyMeasureFilter) {
            try {
                const measure = (JSON.parse(String(saved)) as ParameterConfig).measureParameter;
                const filters = owned ? Array.isArray(owned) ? owned : [owned] : [];
                if (measure && filters.some(filter => {
                    const basic = filter as IFilter & { operator?: string; values?: unknown[] };
                    return filterSignature({target:basic.target}) === filterSignature({target:{table:measure.table,column:measure.column}}) && basic.operator === "In" && basic.values?.length === 0;
                })) {
                    this.recoveredEmptyMeasureFilter = true;
                    this.host.applyJsonFilter(null as unknown as IFilter, "parameterTrial", "filter", powerbi.FilterAction.remove);
                }
            } catch { /* Invalid saved configuration is handled below. */ }
        }
        // Power BI can send an initial data update before persisted objects are
        // attached. Keep looking on later updates instead of permanently
        // disabling model-backed questions after that first incomplete update.
        if (!saved) return;
        const serialized = String(saved);
        if (this.hydrated && serialized === this.savedConfiguration) return;
        try {
            const config = JSON.parse(serialized) as ParameterConfig; validateParameterConfig(config);
            this.table.value = config.table; this.column.value = config.column;
            this.options.value = config.options.join(", "); this.mappings.value = JSON.stringify(config.fields, null, 2); this.automatic.checked = config.enabled; this.fillOptions(config);
            this.measureTable.value = config.measureParameter?.table || ""; this.measureColumn.value = config.measureParameter?.column || ""; this.measureLabels.value = config.measureParameter?.options.join(", ") || "";
            for (const [key, select] of Object.entries(this.timeSelectors)) select.value = config.time?.[key as "dateField" | "yearField" | "monthField" | "monthIndexField"] || "";
            this.timeOrder.value = config.time?.numericOrder || "auto"; this.timeYearStart.value = String(config.time?.twoDigitYearStart ?? 2000);
            this.savedConfiguration = serialized; this.hydrated = true; this.autoDetected = config.autoDetected === true;
            this.setupSummary.textContent = `${this.autoDetected ? "Detected" : "Configured"}: ${config.table} · ${config.options.length} grouping fields.`;
        } catch { this.status.textContent = "Saved configuration is invalid. Review and save it again."; }
    }

    async prepareQuestion(question: string, refresh = false): Promise<QnaResponse | undefined> {
        this.stopSuggestionLoading();
        const key = question.trim().toLowerCase().replace(/\s+/g, " ");
        const config = this.automaticEnabled() ? JSON.stringify({...this.readConfig(), groupAliases: this.groupAliases?.()}) : "";
        if (!refresh && !this.pending && this.completed?.question === key && this.completed.config === config && this.completed.view === this.latest) {
            return structuredClone(this.completed.response);
        }
        const response = await this.executeQuestion(question, refresh);
        if (response) this.completed = { question: key, config: this.automaticEnabled() ? JSON.stringify({...this.readConfig(), groupAliases: this.groupAliases?.()}) : "", view: this.latest,
            response: structuredClone(response) };
        return response;
    }

    private async executeQuestion(question: string, refresh = false): Promise<QnaResponse | undefined> {
        if (!this.automaticEnabled()) {
            if (this.hasParameterContext) throw new Error("Dynamic grouping configuration is not loaded. Open Settings > Data, save the on-demand grouping configuration once, and retry.");
            return undefined;
        }
        const revision = ++this.questionRevision;
        this.cancel();
        let config = this.readConfig();
        config.groupAliases = this.groupAliases?.();
        const revenue = revenueQuestion(question);
        if (revenue.enabled) {
            if (!config.revenue?.field || !config.revenue.value?.trim()) throw new Error('Configure Settings > Percentage of Revenue before asking this question.');
            config = { ...config, revenuePercentage: true, additiveMeasures: [] }; question = revenue.question;
        }
        question = normalizeMonthPeriods(question, config.time, [...this.measures, ...config.fields.flatMap(field => [field.name, ...(field.aliases || []), ...(field.type !== "date" ? field.values || [] : [])])]);
        const months = "January|February|March|April|May|June|July|August|September|October|November|December";
        const comparison = new RegExp(`\\b((?:${months})\\s+\\d{4})\\s+(?:vs\\.?|versus)\\s+((?:${months})\\s+\\d{4})\\b`, "i").exec(question);
        const periodWord = /\b(ttm|trailing 12 months|ytd|year to date)\b/i.exec(question);
        const bareMonth = /\b(January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sept|Sep|October|Oct|November|Nov|December|Dec)\b/i.exec(question);
        if (periodWord && bareMonth && !/\b\d{4}\b/.test(question) && !recognizedTimeTerms(question, config.time).length) {
            if (!config.time?.monthIndexField) throw new Error("Select a numeric MonthIndex column in Time intelligence settings to use YTD or TTM.");
            const yearField = config.fields.find(field => field.name === config.time?.yearField) || config.fields.find(field => /^year$/i.test(field.name));
            if (!yearField || !config.options.includes(yearField.name)) throw new Error("Map a Year column available in the field parameter to calculate this month across available years.");
            const month = calendarMonths.find(name => name.slice(0, 3).toLowerCase() === bareMonth[0].slice(0, 3).toLowerCase())!;
            const kind = /ttm|trailing/i.test(periodWord[0]) ? "TTM" : "YTD";
            const base = question.replace(periodWord[0], " ").replace(bareMonth[0], " ").replace(/\bending\b/i, " ");
            const basePlan = planParameterQuestion(base, config, this.measures);
            if (!basePlan.measures.length) throw new Error("Name a measure for the yearly period calculation.");
            const discoverCoverage = config.options.includes(config.time.monthIndexField);
            const categoryGroups = basePlan.totalOnly ? [] : basePlan.groups;
            const timeNames = new Set([yearField.name,config.time.monthField,config.time.monthIndexField,config.time.dateField]);
            const hasTimeFilter = basePlan.filters.some(filter=>config.fields.some(field=>timeNames.has(field.name) && JSON.stringify(filter.target)===JSON.stringify({table:field.table,column:field.column})));
            const useMonthly = discoverCoverage && !basePlan.rank && !hasTimeFilter && !categoryGroups.some(name=>timeNames.has(name)) && basePlan.measures.every(name=>config.additiveMeasures?.includes(name));
            let monthly: QnaResponse | undefined;
            if (useMonthly) {
                monthly = await this.request({...basePlan,groups:[...categoryGroups,config.time.monthIndexField],totalOnly:false,listOnly:false,presentation:"table",matrixRowCount:undefined},config,refresh);
                const table = monthly.table;
                if (!table || !table.modelRawRows || table.rows.length > 30000 || table.rows.length * basePlan.measures.length > 200000) throw new Error("Monthly optimization exceeds its safe result limit or raw values are unavailable. Narrow the question filters or disable Additive across months for this measure.");
                const seen = new Set<string>();
                for (const row of table.rows) {
                    const index = Number(row[categoryGroups.length]), key=JSON.stringify(row.slice(0,categoryGroups.length+1));
                    if (!Number.isInteger(index) || index < 1900*12+1 || index > 9999*12 || seen.has(key)) throw new Error("Monthly optimization requires unique category/month rows and valid MonthIndex values.");
                    seen.add(key);
                }
            }
            const yearAnswer = monthly ? {table:{rows:monthly.table!.rows.map(row=>{const index=Number(row[categoryGroups.length]);return [String(Math.floor((index-1)/12)),String(index)];})}} : await this.request({groups:[yearField.name,...(discoverCoverage ? [config.time.monthIndexField] : [])],measures:[],listOnly:true,filters:basePlan.filters,summary:[]},config,refresh);
            if (revision !== this.questionRevision) throw new Error("Query cancelled.");
            const years = [...new Set((yearAnswer.table?.rows || []).map(row => Number(row[0])).filter(year => Number.isInteger(year) && year >= 1900 && year <= 9998))].sort((a,b)=>a-b);
            const availableMonths = discoverCoverage ? new Set((yearAnswer.table?.rows || []).map(row=>Number(row[1])).filter(Number.isInteger)) : undefined;
            const rows: string[][] = [], selections: ModelSelection[][] = [], rawRows: Array<Array<number | null>> = [], details: string[] = [];
            let formats: Array<string | undefined> = [];
            for (const year of years) {
                if (revision !== this.questionRevision) throw new Error("Query cancelled.");
                const boundary = /;\s*(?:answerFilters|modelScope):|\b(?:where|with)\b/i.exec(base)?.index ?? base.length;
                const dated = base.slice(0,boundary) + ` ${kind} ending ${month} ${year} ` + base.slice(boundary);
                const yearlyPlan = planParameterQuestion(dated,config,this.measures);
                const end = year*12+calendarMonths.indexOf(month)+1;
                const result = monthly ? monthlyPeriod(monthly.table!,categoryGroups.length,basePlan.measures,kind === "TTM" ? end-11 : year*12+1,end,!!yearlyPlan.totalOnly) : await this.request({...yearlyPlan,totalOnly:false,presentation:"table"},config,refresh);
                if (revision !== this.questionRevision) throw new Error("Query cancelled.");
                formats = result.table?.modelFormats?.slice(yearlyPlan.groups.length) || [];
                const endIndex = year * 12 + calendarMonths.indexOf(month) + 1;
                const startIndex = kind === "TTM" ? endIndex - 11 : year * 12 + 1;
                const expectedMonths = endIndex - startIndex + 1;
                const covered = availableMonths ? Array.from({length:expectedMonths},(_,i)=>startIndex+i).filter(index=>availableMonths.has(index)).length : undefined;
                const coverage = covered === undefined ? "Coverage not verified" : covered < expectedMonths ? `Partial period: ${covered}/${expectedMonths} months available` : `${expectedMonths} months available`;
                const windowLabel = `${monthIndexLabel(startIndex)} – ${monthIndexLabel(endIndex)} · ${coverage}`;
                if (yearlyPlan.totalOnly) {
                    const values = result.table?.modelTotals?.slice(yearlyPlan.groups.length);
                    if (!values) throw new Error("Power BI did not return model totals for the period.");
                    rows.push([`${month} ${year}`,...values]);
                    rawRows.push(result.table?.modelRawTotals?.slice(yearlyPlan.groups.length) || values.map(()=>null)); details.push(windowLabel);
                    selections.push(this.selectionWithContext([],{...yearlyPlan,groups:[]}));
                } else {
                    for (const [index,row] of (result.table?.rows || []).entries()) {
                        rows.push([`${month} ${year}`,...row]);
                        rawRows.push(result.table?.modelRawRows?.[index]?.slice(yearlyPlan.groups.length) || basePlan.measures.map(()=>null)); details.push(windowLabel);
                        selections.push(result.table?.modelRowSelections?.[index] || []);
                    }
                }
            }
            const response: QnaResponse = {modelQuery:true,text:`${kind} ending ${month} for each available year.`,table:{columns:["Period",...(basePlan.totalOnly ? [] : basePlan.groups),...basePlan.measures],rows,rowIndices:rows.map(()=>[]),modelRowSelections:selections,modelSnapshot:true}};
            if (basePlan.presentation && basePlan.presentation !== "table" && basePlan.presentation !== "matrix" && rawRows.length && rawRows.every(row=>row.every(value=>value !== null && Number.isFinite(value)))) {
                const labelCount = response.table!.columns.length - basePlan.measures.length;
response.chart = {type:basePlan.presentation || "column",title:`${basePlan.measures.join(" and ")} · ${kind} ending ${month}`,subtitle:[...basePlan.summary,`${years.length} years`,availableMonths ? (details.some(detail=>detail.includes("Partial period")) ? "Partial period — see tooltips" : "Month coverage verified") : "Period coverage not verified"].join(" · "),labels:rows.map(row=>row.slice(0,labelCount).join(" · ")),values:rawRows.map(row=>row[0]!),valueLabels:rows.map(row=>row[labelCount]),valueFormat:formats[0],rowIndices:rows.map((_,index)=>[index]),modelRowSelections:selections,periodDetails:details,series:basePlan.measures.length>1 ? basePlan.measures.map((name,index)=>({name,values:rawRows.map(row=>row[index]!),valueLabels:rows.map(row=>row[labelCount+index])})) : undefined};
            }
            return response;
        }
        // Discover actual Year/Month targets from a small grouped response rather
        // than guessing a physical date column or retrieving transaction rows.
        if (new RegExp(`\\b(?:${months})\\s+\\d{4}\\b`, "i").test(question) && !config.time?.monthIndexField && !config.time?.yearField && !config.time?.monthField && !config.fields.some(field => field.type === "date") &&
            ["Year", "Month"].every(name => config.options.includes(name)) && !["Year", "Month"].every(name => config.fields.some(field => field.name === name))) {
            await this.request({ groups: ["Year", "Month"], measures: [], listOnly: true, filters: [], summary: [] }, config);
            if (revision !== this.questionRevision) throw new Error("Query cancelled.");
            config = { ...this.readConfig(), ...(revenue.enabled ? { revenuePercentage: true, additiveMeasures: [] } : {}) }; config.groupAliases = this.groupAliases?.();
        }
        if (comparison) {
            const base = question.replace(comparison[0], " ");
            const plans = [comparison[1], comparison[2]].map(period => {
                const where = /;\s*(?:answerFilters|modelScope):|\b(?:where|with)\b/i.exec(base);
                const dated = where ? `${base.slice(0, where.index)} for ${period} ${base.slice(where.index)}` : `${base} for ${period}`;
                return planParameterQuestion(dated, config, this.measures);
            });
            const answers: QnaResponse[] = [];
            for (const plan of plans) {
                if (revision !== this.questionRevision) throw new Error("Query cancelled.");
                const answer = await this.request({ ...plan, presentation: plan.presentation && plan.presentation !== "matrix" ? plan.presentation : "table" }, config, refresh);
                if (revision !== this.questionRevision) throw new Error("Query cancelled.");
                if (answer.table && !plan.listOnly && !plan.totalOnly && !plan.rank &&
                    plan.measures.some((_, index) => !answer.table!.modelTotals?.[plan.groups.length + index] || answer.table!.modelTotals![plan.groups.length + index] === "—")) {
                    // Each comparison column has its own date/filter context.
                    // Categorical responses often contain cells but no aggregate metadata.
                    const scalar = await this.request({...plan, groups: [], presentation: "table", totalOnly: false, rank: undefined}, config, refresh);
                    if (revision !== this.questionRevision) throw new Error("Query cancelled.");
                    if (scalar.table?.rows.length === 1) {
                        answer.table.modelTotals = ["Grand Total", ...Array(Math.max(0, plan.groups.length - 1)).fill(""), ...scalar.table.rows[0]];
                        answer.table.modelRawTotals = [...plan.groups.map(() => null), ...(scalar.table.modelRawRows?.[0] || plan.measures.map(() => null))];
                    }
                }
                answers.push(answer);
            }
            const count = plans[0].groups.length;
            if (!answers.every(answer => answer.table) || plans.some(plan => plan.listOnly || plan.totalOnly)) throw new Error("Choose grouping fields and a measure for the comparison.");
            const keys = new Map<string, string[]>();
            const data = answers.map(answer => new Map(answer.table!.rows.map(row => { const labels = row.slice(0, count); const key = JSON.stringify(labels); keys.set(key, labels); return [key, row.slice(count)] as const; })));
            const rows = [...keys].map(([key, labels]) => [...labels, ...data.flatMap(values => values.get(key) || plans[0].measures.map(() => "—"))]);
            const totals = answers.every(answer => answer.table?.modelTotals) ? ["Grand Total", ...Array(count - 1).fill(""), ...answers.flatMap(answer => answer.table!.modelTotals!.slice(count))] : undefined;
            const rowIndices = answers.map(answer => indexGroupRows(answer.table!.rows, count));
            const periodSelections = [...keys.keys()].map(key => answers.map((answer, periodIndex) => {
                const index = rowIndices[periodIndex].get(key) ?? -1;
                return index < 0 ? [] : answer.table!.modelRowSelections?.[index] || [];
            }));
            const comparisonAnswer: QnaResponse = { modelQuery: true, text: `${comparison[1]} vs ${comparison[2]} by ${plans[0].groups.join(" and ")}.`, table: {
                columns: [...plans[0].groups, ...[comparison[1], comparison[2]].flatMap(period => plans[0].measures.map(measure => plans[0].measures.length === 1 ? period : `${period} ${measure}`))], rows, rowIndices: rows.map(() => []), modelTotals: totals,
                modelEditor: { rows: plans[0].groups, columns: [], measures: plans[0].measures, filters: (() => {
                    // Only shared predicates belong to the answer editor. Period-specific
                    // MonthIndex/date/year predicates must stay with their own column.
                    const key = (filter: {field: string; values: string[]}) => JSON.stringify([filter.field, [...filter.values].sort()]);
                    const shared = (answers[0].table!.modelEditor?.filters || []).filter(filter => answers.every(answer => answer.table?.modelEditor?.filters.some(other => key(other) === key(filter))));
                    return [...new Map(shared.map(filter => [key(filter), filter])).values()];
                })() },
                modelPeriods: [comparison[1], comparison[2]].flatMap((period, index) => plans[0].measures.map((measure, measureIndex) => ({ sourceColumn: count + index * plans[0].measures.length + measureIndex, period, question: base + (revenue.enabled ? " as percentage of revenue" : ""), measure, groupCount: count }))),
                modelRowSelections: periodSelections.map(periods => periods.flat()),
                modelCellSelections: periodSelections.map(periods => [...plans[0].groups.map(() => periods.flat()), ...periods.flatMap(selections => plans[0].measures.map(() => selections))]),
                modelSelections: [...keys.keys()].map(key => {
                    for (const [periodIndex, answer] of answers.entries()) {
                        const index = answer.table!.rows.findIndex(row => JSON.stringify(row.slice(0, count)) === key);
                        if (index >= 0) return answer.table!.modelSelections?.[index] || [];
                    }
                    return [];
                })
            } };
            if (answers.every(answer => answer.chart)) {
                const charts = answers.map(answer => answer.chart!);
                comparisonAnswer.chart = {
                    type: charts[0].type, title: comparisonAnswer.text,
                    labels: charts.flatMap((chart, index) => chart.labels.map(label => label + " · " + comparison[index + 1])),
                    values: charts.flatMap(chart => chart.values), valueLabels: charts.flatMap(chart => chart.valueLabels),
                    valueFormat: charts[0].valueFormat,
                    rowIndices: charts.flatMap(chart => chart.labels).map((_, index) => [index]),
                    modelRowSelections: charts.flatMap(chart => chart.modelRowSelections || chart.labels.map(() => [])),
                    series: plans[0].measures.length > 1 ? plans[0].measures.map((name, index) => ({ name,
                        values: charts.flatMap(chart => chart.series![index].values),
                        valueLabels: charts.flatMap(chart => chart.series![index].valueLabels) })) : undefined
                };
            }
            return comparisonAnswer;
        }
        const plan = planParameterQuestion(question, config, this.measures);
        const answer = await this.request(plan, config, refresh);
        // A single anchored month supports the same period actions as a comparison.
        // Use parser-recognized spans, so aliases and numeric date formats behave alike.
        if (answer.table && !answer.table.modelPivot && !plan.listOnly && !plan.totalOnly && config.time?.monthIndexField && !/\b(ytd|ttm|year to date|trailing 12 months)\b/i.test(question)) {
            const anchors = recognizedTimeTerms(question, config.time, config.fields.flatMap(field => [field.name, ...(field.values || [])]));
            if (anchors.length === 1) {
                const anchor = anchors[0];
                const period = question.slice(anchor.start, anchor.end);
                const base = question.slice(0, anchor.start) + " " + question.slice(anchor.end);
                answer.table.modelPeriods = plan.measures.map((measure, index) => ({sourceColumn: plan.groups.length + index, period, question: base + (revenue.enabled ? " as percentage of revenue" : ""), measure, groupCount: plan.groups.length}));
            }
        }
        const pivot = answer.table?.modelPivot;
        if (pivot && answer.table) {
            // Marginal totals are separate model evaluations, never sums of cells.
            // This also works when the host supplies categorical data only.
            if (revision !== this.questionRevision) throw new Error("Query cancelled.");
            const existingRowTotals = answer.table.columns.length > pivot.rowFields.length + pivot.columnValues.length * pivot.measures.length;
            const rowAnswer = existingRowTotals ? undefined : await this.request({ ...plan, groups: pivot.rowFields, presentation: "table" }, config, refresh);
            if (revision !== this.questionRevision) throw new Error("Query cancelled.");
            const columnAnswer = await this.request({ ...plan, groups: pivot.columnFields || [pivot.columnField], presentation: "table" }, config, refresh);
            if (revision !== this.questionRevision) throw new Error("Query cancelled.");
            const rowCount = pivot.rowFields.length, measureCount = pivot.measures.length;
            const width = rowCount + pivot.columnValues.length * measureCount;
            const rowTotals = new Map((existingRowTotals ? answer.table.rows : rowAnswer?.table?.rows || []).map(row => [JSON.stringify(row.slice(0, rowCount)), row.slice(existingRowTotals ? width : rowCount)]));
            const columnCount = pivot.columnFields?.length || 1;
            const columnTotals = new Map((columnAnswer.table?.rows || []).map(row => [row.slice(0, columnCount).join(" · "), row.slice(columnCount)]));
            let grand = [rowAnswer?.table?.modelTotals?.slice(rowCount), columnAnswer.table?.modelTotals?.slice(columnCount), answer.table.modelTotals?.slice(-measureCount)]
                .find(values => values?.length === measureCount && values.every(value => value !== "—"));
            if (!grand) {
                // Evaluate the measure without grouping; adding visible cells is invalid
                // for averages, distinct counts, ratios, and other non-additive measures.
                const scalar = await this.request({ ...plan, groups: [], presentation: "table", totalOnly: false, rank: undefined }, config, refresh);
                if (revision !== this.questionRevision) throw new Error("Query cancelled.");
                grand = scalar.table?.rows.length === 1 ? scalar.table.rows[0].slice(0, measureCount) : pivot.measures.map(() => "—");
            }
            answer.table.columns = [...answer.table.columns.slice(0, width), ...pivot.measures.map(measure => measureCount === 1 ? "Total" : `${measure} Total`)];
            answer.table.modelCellSelections = answer.table.modelCellSelections?.map((cells, index) => [...cells.slice(0, width), ...pivot.measures.map(() => answer.table!.modelRowSelections?.[index] || [])]);
            answer.table.rows = answer.table.rows.map(row => [...row.slice(0, width), ...(rowTotals.get(JSON.stringify(row.slice(0, rowCount))) || pivot.measures.map(() => "—"))]);
            answer.table.modelTotals = ["Grand Total", ...Array(rowCount - 1).fill(""), ...pivot.columnValues.flatMap(value => columnTotals.get(value) || pivot.measures.map(() => "—")), ...grand];
        }
        return answer;
    }

    private request(plan: ParameterPlan, config: ParameterConfig, refresh = false): Promise<QnaResponse> {
        if (config.revenuePercentage && plan.measures.length && !plan.listOnly) return revenueRequest(plan, config, p => this.requestBase(p, config, refresh), (view, p) => { this.requestConfig = config; return this.answer(view, p); });
        return this.requestBase(plan, config, refresh);
    }
    private requestBase(plan: ParameterPlan, config: ParameterConfig, refresh = false): Promise<QnaResponse> {
        if (!plan.groups.length) return this.requestScalarWithGrouping(plan, config, refresh);
        if (this.fieldOnlyBinding && plan.measures.length) return Promise.reject(new Error("This visual is configured for field-only lists. Add a measure or Measure Selector to Measures and KPIs to ask measure questions."));
        this.dataRequestsStopped = false;
        this.onProgress?.("Checking available data…");
        this.trace("request", { groups: plan.groups, measures: plan.measures, predicates: plan.filters.length });
        this.cancel(); this.requestConfig = config; const filters = parameterFilters(plan, config);
        const cached = !refresh && this.queryCache.get(this.queryKey(plan, config));
        if (cached) { this.rememberQuery(plan, config, cached); this.trace("query-cache-hit", { groups: plan.groups }); return Promise.resolve(this.answer(cached, plan)); }
        const parameterTarget = filterSignature({ target: { table: config.table, column: config.column } });
        const priorPredicates = this.appliedFilters.filter(filter => filterSignature({ target: filter.target }) !== parameterTarget);
        const needsReset = priorPredicates.length > 0 && JSON.stringify(priorPredicates.map(filterSignature).sort()) !== JSON.stringify(filters.filter(filter => filterSignature({ target: filter.target }) !== parameterTarget).map(filterSignature).sort());
        const setupError = this.parameterLabelError(this.latest, config);
        if (setupError) { this.status.textContent = setupError; return Promise.reject(new Error(setupError)); }
        const matchesCurrent = this.matches(this.latest, plan, filters);
        // The current data view is already Power BI's latest completed result.
        // Re-render it immediately on Refresh instead of starting a redundant
        // host refresh and showing a loading state for up to 60 seconds.
        if (matchesCurrent && !needsReset) { this.rememberQuery(plan, config, this.latest!); return Promise.resolve(this.answer(this.latest!, plan)); }
        this.waitingReason = "Power BI has not delivered an updated data view.";
        this.status.textContent = `Loading ${plan.groups.join(" + ")}${plan.summary.length ? " • " + plan.summary.join("; ") : ""}…`;
        return new Promise((resolve, reject) => {
            this.pending = { plan, filters, resolve, reject }; this.recoveredRequest = false;
            this.timer = setTimeout(() => this.fail(`Power BI did not return matching complete data within 60 seconds. ${this.waitingReason} Check askBICS's query in Performance Analyzer and keep Show selected field enabled. No answer was calculated.`), 60000);
            try {
                if (needsReset) {
                    this.clearPendingFilters();
                } else this.sendPending();            } catch (error) { this.fail(`Could not request model data: ${String(error)}`); }
        });
    }

    private async requestScalarWithGrouping(plan: ParameterPlan, config: ParameterConfig, refresh: boolean): Promise<QnaResponse> {
        // An empty field-parameter selection can remove the entire host data
        // shape, even when a measure parameter remains bound. Never send it.
        const fixedField = config.fields.find(field => config.options.includes(field.name) && plan.filters.some(filter => {
            const basic = filter as any;
            return basic.target?.table === field.table && basic.target?.column === field.column &&
                basic.operator === "In" && basic.values?.length === 1;
        }));
        const anchor = fixedField?.name || config.options[0];
        if (!anchor) throw new Error("Keep at least one grouping field available in Data setup.");
        const response = await this.requestBase({...plan, groups: [anchor], totalOnly: false, presentation: "table", rank: undefined}, config, refresh);
        const table = response.table;
        if (!table) throw new Error("Power BI did not return the grouped measure data.");
        // A fixed revenue member is evaluated directly in its requested context.
        // Otherwise use only host aggregate metadata, never sums of grouped cells.
        const fixedRow = fixedField && table.rows.length === 1 ? 0 : undefined;
        const raw = plan.measures.map((measure, i) => {
            const column = table.columns.indexOf(measure);
            return fixedRow !== undefined ? table.modelRawRows?.[fixedRow]?.[column] ?? null : table.modelRawTotals?.[column] ?? null;
        });
        const formats = plan.measures.map(measure => table.modelFormats?.[table.columns.indexOf(measure)]);
        const values = raw.map((value, index) => value === null ? "—" : formatPowerBiValue(value, formats[index]));
        return {text: response.text, modelQuery: true, table: {
            columns: plan.measures, rows: [values], rowIndices: [[]], modelRawRows: [raw],
            modelTotals: values, modelRawTotals: raw, modelFormats: formats
        }};
    }

    private clearPendingFilters(): void {
        const pending = this.pending;
        if (!pending) return;
        pending.clearing = true;
        this.waitingReason = "Waiting for Power BI to clear the previous question filters.";
        this.onProgress?.("Waiting for Power BI to reset question filters…");
        this.trace("clear-owned-filters");
        if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
        // A no-op removal may not produce a Data event. Request one without
        // merging new filters before the cleared state has been acknowledged.
        this.recoveryTimer = setTimeout(() => {
            if (this.pending !== pending || !pending.clearing) return;
            this.trace("refresh-clear-acknowledgement");
            try { this.host.refreshHostData(); }
            catch (error) { this.fail("Could not refresh the cleared query: " + String(error)); }
        }, 4000);
        this.host.applyJsonFilter(null as unknown as IFilter, "parameterTrial", "filter", powerbi.FilterAction.remove);
    }

    private sendPending(): void {
        const pending = this.pending;
        if (!pending) return;
        this.onProgress?.("Waiting for Power BI…");
        const unchanged = JSON.stringify(pending.filters.map(filterSignature)) === JSON.stringify(this.appliedFilters.map(filterSignature));
        this.appliedFilters = pending.filters;
        this.submittedRevision = this.dataRevision;
        this.trace(unchanged ? "refresh-host" : "apply-filters", { predicates: pending.filters.length, targets: pending.filters.map(filter => filter.target) });
        if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
        const submitted = this.dataRevision;
        if (!this.recoveredRequest) this.recoveryTimer = setTimeout(() => {
            if (this.pending !== pending || pending.clearing || this.dataRevision !== submitted) return;
            this.recoveredRequest = true;
            // Retry once only when the host delivered no Data event at all.
            // Clear acknowledgement must arrive before the filter is reapplied.
            pending.clearing = true;
            this.confirmedView = undefined;
            this.trace("recover-no-host-response", { targets: pending.filters.map(filter => filter.target) });
            try { this.clearPendingFilters(); }
            catch (error) { this.fail("Could not retry the query: " + String(error)); }
        }, 4000);
        if (unchanged) this.host.refreshHostData();
        else this.host.applyJsonFilter(pending.filters, "parameterTrial", "filter", powerbi.FilterAction.merge);
    }

    update(dataView?: powerbi.DataView, jsonFilters?: powerbi.IFilter[], isDataUpdate = true): void {
        if (!dataView) return;
        if (!isDataUpdate) { this.trace("presentation-update-ignored"); return; }
        if (!this.pending) this.fieldOnlyBinding = !!dataView.table?.columns.length && !parameterMetadataColumns(dataView).some(column => column.roles?.measures || column.isMeasure);
        const table = dataView.table || categoricalAsTable(dataView.categorical) || readModelMatrix(dataView.matrix)?.table;
        const signature = JSON.stringify({ table, filters: jsonFilters || [], metadata: { ...dataView.metadata, objects: { ...dataView.metadata.objects, state: undefined } }, owned: dataView.metadata.objects?.parameterTrial?.filter });
        const uiState = String(dataView.metadata.objects?.state?.conversation || "");
        const write = this.uiStateWrites.get(uiState);
        if (write) {
            this.uiStateWrites.delete(uiState);
            if (Date.now() - write.at < 5000 && signature === write.signature && signature === this.lastDataSignature) {
                this.trace("ui-state-echo-cache-retained");
                // Our own conversation save is not a query response or context change.
                return;
            }
        }
        if (!this.pending && !this.loadingSuggestionValues && (dataView !== this.latest || signature !== this.lastDataSignature)) {
            this.startupNeeded = true; this.queryCache.clear(); this.completed = undefined;
            this.suggestionFieldsLoaded.clear();
            this.learnedFields.forEach((field, name) => this.learnedFields.set(name, { ...field, values: [] }));
            this.onDataContextChanged?.();
        }
        this.lastDataSignature = signature;
        ++this.dataRevision;
        this.latest = dataView;

        this.trace("host-shape", { tableColumns: dataView.table?.columns.map(c => ({ name: c.displayName, roles: c.roles, isMeasure: c.isMeasure })), matrixLevels: dataView.matrix?.rows.levels.map(level => level.sources.map(c => c.displayName)), matrixMeasures: dataView.matrix?.valueSources.map(c => c.displayName), metadataColumns: dataView.metadata.columns?.map(c => ({ name: c.displayName, roles: c.roles, isMeasure: c.isMeasure, parameters: c.sourceFieldParameters?.map(p => p.displayName) })) });
        this.trace("data-view", { columns: table?.columns.map(column => column.displayName), rows: table?.rows?.length, segmented: !!dataView.metadata.segment, pending: !!this.pending });
        this.hasParameterContext = this.hasParameterContext || (table?.columns || []).some(column =>
            !!column.sourceFieldParameters?.length || column.displayName === this.column.value.trim());
        const deliveredMeasures = (table?.columns || []).filter(column => column.roles?.measures || column.isMeasure);
        const previousMeasureSetup = JSON.stringify([this.measureTable.value, this.measureColumn.value, this.measureLabels.value]);
        const metadataColumns = parameterMetadataColumns(dataView);
        const detectedMeasures = discoverParameter(metadataColumns, true);
        const catalogMeasures = metadataColumns.filter(column => column.roles?.measures || column.isMeasure);
        if (catalogMeasures.length || table?.columns.length && !this.pending) {
        this.measureBindingObserved = true;
        this.hasMeasureParameter = !!detectedMeasures || metadataColumns.some(column => (column.roles?.measures || column.isMeasure) && !!column.sourceFieldParameters?.length) || (!!this.pending && !deliveredMeasures.length && !!this.requestConfig?.measureParameter);
        this.directMeasures = [...new Map(catalogMeasures.map(column => [column.displayName, column])).values()].filter(column => !column.sourceFieldParameters?.length && !metadataColumns.some(metadata => metadata.displayName === column.displayName && !!metadata.sourceFieldParameters?.length)).map(column => column.displayName);
        }
        this.trace("parameter-metadata", { measures: metadataColumns.filter(column => column.roles?.measures || column.isMeasure).map(column => ({ name: column.displayName, isMeasure: column.isMeasure, numeric: !!(column.type?.numeric || column.type?.integer), sources: column.sourceFieldParameters?.map(source => ({name: source.displayName, hasExpression: !!source.expr})) })) });
        if (detectedMeasures?.options.length && (!this.measureTable.value || this.measureTable.value === detectedMeasures.table && this.measureColumn.value === detectedMeasures.column)) {
            this.measureTable.value = detectedMeasures.table; this.measureColumn.value = detectedMeasures.column;
            this.measureLabels.value = [...new Set([...this.measureLabels.value.split(",").map(name => name.trim()).filter(Boolean), ...detectedMeasures.options])].join(", ");
        }
        this.measures = this.fieldOnlyBinding ? [] : [...new Set([...this.directMeasures, ...(this.hasMeasureParameter ? this.measureLabels.value.split(",").map(name => name.trim()).filter(Boolean) : this.directMeasures)])];
        this.measureStatus.textContent = this.hasMeasureParameter
            ? "Selective measures configured. Lists use one available measure internally and display only field values. No additional support measure is required."
            : "Direct measure bindings query every bound measure. Bind a measure field parameter to enable selective queries.";
        table?.columns.forEach((column, index) => {
            if (column.roles?.measures || column.isMeasure) return;
            const target = resolveFilterTarget(column) as { table?: string; column?: string } | undefined;
            if (!target?.table || !target.column) return;
            const existing = this.learnedFields.get(column.displayName);
            const values = collectTextValues(existing?.values || [], table.rows || [], index);
            this.learnedFields.set(column.displayName, { name: column.displayName, table: target.table, column: target.column,
                type: column.type?.dateTime ? "date" : column.type?.numeric || column.type?.integer ? "number" : "text", values });
        });
        this.discoverSetup(metadataColumns);
        if (detectedMeasures?.options.length && this.hydrated && previousMeasureSetup !== JSON.stringify([this.measureTable.value, this.measureColumn.value, this.measureLabels.value])) this.persistConfig();
        const owned = dataView.metadata.objects?.parameterTrial?.filter as unknown;
        const ownedList = owned ? (Array.isArray(owned) ? owned : [owned]) as IFilter[] : [];
        // The owned property can echo only the field-parameter predicate while
        // the public update carries the model-column predicates. Neither is a
        // complete replacement for the other. Preserve conflicts: matches()
        // must reject a stale predicate rather than silently picking one copy.
        const ownedJson = ownedList.filter(filter => !!filter?.target);
        // general.filter is the outgoing selection (selfFilter: false), not
        // an acknowledgement of this visual's parameterTrial self-filter.
        const outgoing = dataView.metadata.objects?.general?.filter as unknown;
        const outgoingFilters = (outgoing ? Array.isArray(outgoing) ? outgoing : [outgoing] : []) as IFilter[];
        const outgoingSignatures = new Set(outgoingFilters.filter(filter => !!filter?.target).map(filterSignature));
        const publicJson = (jsonFilters || []).filter(filter => !!(filter as IFilter)?.target && !outgoingSignatures.has(filterSignature(filter)));
        this.latestFilters = [...new Map([...ownedJson, ...publicJson].map(filter => [filterSignature(filter), filter])).values()];
        const describe = (filters: powerbi.IFilter[]) => filters.map(filter => {
            const json = filter as IFilter;
            return { target: json.target, matchesRequested: !!this.pending?.filters.some(expected => filterSignature(expected) === filterSignature(json)) };
        });
        if (this.pending) this.trace("filter-acknowledgement", { owned: describe(ownedJson), public: describe(publicJson) });
        if (this.pending?.clearing) {
            // Wait for the host's cleared state; never merge into the same
            // turn as remove, and never interpret this intermediate data as an answer.
            const oldTargets = this.appliedFilters.map(filter => filterSignature({ target: filter.target }));
            if (this.latestFilters.some(filter => oldTargets.includes(filterSignature({ target: (filter as IFilter).target })))) {
                this.waitingReason = "Waiting for Power BI to clear the previous question filters.";
                return;
            }
            this.trace("owned-filters-cleared");
            this.pending.clearing = false;
            this.appliedFilters = [];
            try { this.sendPending(); } catch (error) { this.fail(`Could not request model data: ${String(error)}`); }
            return;
        }
        // Restore only filters owned by this visual, never report/page filters.
        if (!this.pending && !this.appliedFilters.length && ownedList.length && ownedList.every(filter => !!filter?.target)) this.appliedFilters = ownedList;
        if (this.pending && this.requestConfig) {
            const setupError = this.parameterLabelError(dataView, this.requestConfig);
            if (setupError) { this.fail(setupError); return; }
            const pendingGroups = (table?.columns || []).filter(column => !column.roles?.measures && !column.isMeasure).map(column => column.displayName);
            if (this.requestConfig.measureParameter && this.pending.plan.measures.length && !dataView.metadata.segment &&
                this.dataRevision > this.submittedRevision && sameGrouping(pendingGroups, this.pending.plan.groups) && !deliveredMeasures.length) {
                this.fail("Power BI returned the requested grouping but no measure values. The measure field parameter must reference explicit DAX measures (calculator icon), not numeric columns such as Rent or Sales. Check its NAMEOF entries and enable Show values of selected field. No answer was calculated."); return;
            }
        }
        if (this.pending && this.matches(dataView, this.pending.plan, this.pending.filters)) {
            const { plan, resolve } = this.pending;
            try {
                this.onProgress?.("Preparing results…");
                const answer = this.pending.restoringSuggestions ? { text: "" } : this.answer(dataView, plan);
                if (!this.pending.restoringSuggestions) this.rememberQuery(plan, this.requestConfig!, dataView);
                this.confirmedView = dataView;
                this.confirmedFilters = JSON.stringify(this.pending.filters.map(filterSignature).sort());
                this.pending = undefined; if (this.timer) clearTimeout(this.timer); if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
                this.status.textContent = `Loaded ${plan.groups.join(" + ")} with matching model filters. ${table?.rows?.length || 0} result rows.`;
                resolve(answer);
            } catch (error) { this.fail(String((error as Error).message)); }
        } else if (this.pending) {
            this.onProgress?.("Waiting for Power BI. " + this.waitingReason);
            this.trace("waiting", { reason: this.waitingReason });
            this.status.textContent = `Waiting for Power BI. ${this.waitingReason}`;
        }
    }

    private parameterLabelError(dataView: powerbi.DataView | undefined, config: ParameterConfig): string | undefined {
        const table = dataView?.table || categoricalAsTable(dataView?.categorical) || readModelMatrix(dataView?.matrix)?.table;
        const labelTarget = filterSignature({ target: { table: config.table, column: config.column } });
        const unresolved = table?.columns.some((column, index) => {
            // sourceFieldParameters can be attached to the parameter-label
            // column too. Its presence alone does not prove field resolution.
            if (column.roles?.measures) return false;
            const target = resolveFilterTarget(column);
            if (target && filterSignature({ target }) === labelTarget) return true;
            // Some hosts omit queryName/expr. Parameter labels still identify the
            // unresolved binding when both the column name and row values agree.
            const rows = table.rows || [];
            return column.displayName === config.column && rows.length > 0 &&
                rows.every(row => typeof row[index] === "string" && config.options.includes(String(row[index])));
        });
        return unresolved ? `Setup required: select askBICS, open the menu beside ${config.column} in the Fields well, and choose “Show selected field”. Power BI is returning parameter labels instead of the selected data column. Then ask your question again.` : undefined;
    }

    private matches(dataView: powerbi.DataView | undefined, plan: ParameterPlan, filters: IFilter[]): boolean {
        if (!dataView) { this.waitingReason = "No data view received."; return false; }
        if (dataView.metadata.segment) { this.waitingReason = "Power BI is still returning result segments."; return false; }
        const table = dataView.table || categoricalAsTable(dataView.categorical) || readModelMatrix(dataView.matrix)?.table;
        if (!table) { this.waitingReason = "Power BI returned metadata without usable table, matrix, or categorical result data. Check the visual data mapping and bindings."; return false; }
        const columns = (table?.columns || []).filter(column => !column.roles?.measures && !column.isMeasure);
        if (!sameGrouping(columns.map(column => column.displayName), plan.groups)) { this.waitingReason = `Requested: ${plan.groups.join(", ")}. Received: ${columns.map(column => column.displayName).join(", ") || "no grouping fields"}.`; return false; }
        if (!columns.every(column => column.sourceFieldParameters?.length)) { this.waitingReason = "Returned fields lack source field-parameter metadata."; return false; }
        const measureParameter = this.requestConfig?.measureParameter;
        if (measureParameter) {
            const expectedMeasures = selectedParameterMeasures(plan, this.requestConfig!);
            const actualMeasures = (table?.columns || []).filter(column => column.roles?.measures || column.isMeasure).map(column => column.displayName);
            const allowed = [...new Set([...expectedMeasures, ...(this.requestConfig?.directMeasures || [])])];
            if (!sameGrouping(actualMeasures, allowed)) { this.waitingReason = "Waiting for the requested parameter measures and directly bound measures."; return false; }
        }
        const availableMeasures = (table?.columns || []).filter(column => column.roles?.measures || column.isMeasure).map(column => column.displayName);
        if (plan.measures.some(name => !availableMeasures.includes(name))) { this.waitingReason = "Waiting for the requested measure values."; return false; }
        const expected = filters.map(filterSignature), actual = this.latestFilters.map(filterSignature);
        // Resolved parameter fields acknowledge a grouping-only selection. Some
        // Power BI hosts do not echo that self-filter in the JSON filter payload.
        // Never use this fallback for value/date filters or their later removal.
        const explicitAcknowledgement = plan.filters.every(filter => actual.includes(filterSignature(filter)));
        // Desktop can apply self-filters in DAX while returning neither owned
        // JSON filters nor options.jsonFilters. A fresh Data update after the
        // serialized submission is the host completion signal in that mode.
        // Never infer completion from a resize/style update or cached old data.
        const noEcho = this.latestFilters.length === 0;
        const freshSubmission = !!this.pending && !this.pending.clearing && this.dataRevision > this.submittedRevision &&
            JSON.stringify(this.pending.filters.map(filterSignature).sort()) === JSON.stringify(expected.slice().sort());
        const confirmed = this.confirmedView === dataView && this.confirmedFilters === JSON.stringify(expected.slice().sort());
        if (!explicitAcknowledgement && !(noEcho && (freshSubmission || confirmed))) { this.waitingReason = "Waiting for a fresh model result or matching value/date filter acknowledgement."; return false; }
        const config = this.requestConfig;
        if (!config) return false;
        const targets = [{ table: config.table, column: config.column }, ...(config.measureParameter ? [{ table: config.measureParameter.table, column: config.measureParameter.column }] : []), ...config.fields.map(field => ({ table: field.table, column: field.column }))].map(target => filterSignature({ target }));
        const matched = this.latestFilters.every(filter => (filter as { operator?: string }).operator === "All" || !targets.includes(filterSignature({ target: (filter as IFilter).target })) || expected.includes(filterSignature(filter)));
        if (!matched) this.waitingReason = "Power BI returned additional filters on configured fields. Check conflicting report or parameter filters.";
        return matched;
    }

    private selectionWithContext(selection: ModelSelection, plan: ParameterPlan): ModelSelection[] {
        if (selection.length !== plan.groups.length) return [];
        let rows = [selection];
        for (const filter of plan.filters) {
            if (Array.isArray(filter.target)) {
                const tuple = filter as IFilter & { values: Array<Array<{ value: string | number | boolean }>> };
                const targets = filter.target as IFilterColumnTarget[];
                rows = rows.flatMap(row => tuple.values.flatMap(values => {
                    if (values.length !== targets.length || targets.some(target => !target.column)) return [];
                    const parts = targets.map((target, index) => ({ table: target.table, column: target.column, value: values[index].value }));
                    if (parts.some(part => row.some(existing => existing.table === part.table && existing.column === part.column && existing.value !== part.value))) return [];
                    return [[...row, ...parts.filter(part => !row.some(existing => existing.table === part.table && existing.column === part.column))]];
                }));
                if (rows.length > 30000) return [];
                continue;
            }
            const target = filter.target as IFilterColumnTarget;
            if (!target?.column || !target.table) return [];
            const predicate = filter as IFilter & { values?: Array<string | number | boolean>; conditions?: Array<{ operator: string; value: string }> };
            let values = predicate.values;
            if (!values && predicate.conditions) {
                const start = predicate.conditions.find(item => item.operator === 'GreaterThanOrEqual')?.value;
                const end = predicate.conditions.find(item => item.operator === 'LessThan')?.value;
                if (start && end) {
                    values = this.expandedDateValues.get(filter);
                    if (!values) {
                    values = []; const finish = Date.parse(end);
                    for (let time = Date.parse(start); time < finish && values.length < 10000; time += 86400000) values.push(new Date(time).toISOString());
                    if (values.length === 10000) return [];
                    this.expandedDateValues.set(filter, values);
                    }
                }
            }
            if (!values?.length) return [];
            rows = rows.flatMap(row => {
                const existing = row.find(part => part.table === target.table && part.column === target.column);
                return existing ? (values!.includes(existing.value) ? [row] : []) : values!.map(value => [...row, { table: target.table, column: target.column, ...(predicate.conditions ? { dateDay: true } : {}), value }]);
            });
            if (rows.length > 30000) return [];
        }
        return rows;
    }

    private expandedDateValues = new WeakMap<object, Array<string | number | boolean>>();

    private answer(dataView: powerbi.DataView, plan: ParameterPlan): QnaResponse {
        const sourceTable = dataView.table || categoricalAsTable(dataView.categorical) || readModelMatrix(dataView.matrix)?.table;
        if (!sourceTable) throw new Error("Power BI returned no data table.");
        let table: powerbi.DataViewTable = sourceTable;
        const time = this.requestConfig?.time;
        if (!plan.rank && (plan.listOnly || plan.groups.some(name=>timeFieldOrder(name)>=0 || name === time?.yearField || name === time?.monthField))) {
            const columns = plan.groups.map(name=>table!.columns.findIndex(column=>column.displayName === name));
            table = {...table,rows:[...(table.rows || [])].sort((a,b)=>compareTimeLabels(columns.map(index=>String(a[index] ?? "")).join(" · "),columns.map(index=>String(b[index] ?? "")).join(" · ")))};
        }
        const names = [...plan.groups, ...plan.measures];
        const indices = names.map(name => table.columns.findIndex(column => column.displayName.toLowerCase() === name.toLowerCase()));
        if (indices.some(index => index < 0)) throw new Error("The response is missing a requested field or measure.");
        if (!plan.listOnly && !plan.presentation && !plan.rank && !plan.totalOnly && this.preferMatrix?.(indices.slice(0, plan.groups.length).map(index => new Set((table.rows || []).map(row => row[index])).size))) plan = { ...plan, presentation: "matrix" };
        const rows = (table.rows || []).map(row => indices.map(index => {
            const value = row[index], column = table.columns[index];
            if (value == null) return "—";
            return column.roles?.measures && typeof value === "number" ? formatPowerBiValue(value, column.format) : String(value);
        }));
        const text = `${plan.listOnly ? "List of " : plan.measures.join(", ") + " by "}${plan.groups.join(" and ")}.${plan.summary.length ? " Filtered by: " + plan.summary.join("; ") + "." : ""}${rows.length ? "" : " No matching data."}`;
        const result: QnaResponse = { text, modelQuery: true, table: { columns: names, rows, rowIndices: rows.map(() => []) } };
        result.table!.modelRawRows = (table.rows || []).map(row=>indices.map(index=>typeof row[index] === "number" ? Number(row[index]) : null));
        result.table!.modelRawTotals = table.totals ? indices.map(index=>typeof table.totals![index] === "number" ? Number(table.totals![index]) : null) : undefined;
        result.table!.modelFormats = indices.map(index=>table.columns[index].format);
        result.table!.modelEditor = { rows: plan.groups, columns: [], measures: plan.measures, filters: plan.filters.flatMap(filter => {
            const basic = filter as IFilter & { values?: Array<string | number | boolean> };
            const field = this.requestConfig?.fields.find(item => JSON.stringify({ table: item.table, column: item.column }) === JSON.stringify(filter.target));
            return field && basic.values ? [{ field: field.name, values: basic.values.map(String) }] : [];
        }) };
        result.table!.modelSelections = (table.rows || []).map(row => plan.groups.flatMap((name, position) => {
            const column = table.columns[indices[position]];
            const resolved = resolveFilterTarget(column) as { table: string; column?: string; hierarchy?: string; hierarchyLevel?: string } | undefined;
            const mapped = this.requestConfig?.fields.find(field => field.name === name);
            const target = resolved?.column || resolved?.hierarchyLevel ? resolved : mapped ? { table: mapped.table, column: mapped.column } : undefined;
            const value = row[indices[position]];
            return target?.table && (target.column || target.hierarchyLevel) && ["string", "number", "boolean"].includes(typeof value)
                ? [{ ...target, value: value as string | number | boolean }] : [];
        }));
        result.table!.modelSelections = result.table!.modelSelections.map(selection => selection.length === plan.groups.length ? selection : []);
        result.table!.modelRowSelections = result.table!.modelSelections.map(selection => this.selectionWithContext(selection, plan));
        result.table!.modelCellSelections = result.table!.modelRowSelections.map(selection => names.map(() => selection));
        if (plan.listOnly) {
            const unique = [...new Map(rows.map((row, index) => [JSON.stringify(row), index])).values()];
            result.table!.rows = unique.map(index => rows[index]);
            result.table!.modelRowSelections = unique.map(index => result.table!.modelRowSelections![index]);
            result.table!.modelCellSelections = unique.map(index => result.table!.modelCellSelections![index]);
            result.table!.modelSelections = unique.map(index => result.table!.modelSelections![index]);
            result.table!.rowIndices = result.table!.rows.map(() => []);
            return result;
        }
        // V3 default: prefer model totals, otherwise sum complete returned values.
        // Derived percentage totals must retain their numerator/denominator logic.
        if (!dataView.metadata.segment && !plan.rank) {
            const totals = table.totals?.slice() || table.columns.map(() => null);
            plan.measures.forEach(name => {
                const column = table.columns.findIndex(item => item.displayName === name);
                if (column < 0 || totals[column] != null || table.columns[column].format?.includes("%")) return;
                const values = (table.rows || []).map(row => row[column]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
                if (values.length) totals[column] = values.reduce((sum, value) => sum + value, 0);
            });
            table = {...table, totals: totals as powerbi.DataViewTable["totals"]};
            result.table!.modelRawTotals = indices.map(index => typeof totals[index] === "number" ? Number(totals[index]) : null);
        }
        // Other measures require model-supplied totals.
        if (table.totals && plan.measures.every(name => table.columns.some(column => column.displayName === name))) {
            result.table!.modelTotals = indices.map((index, position) => position < plan.groups.length ? (position === 0 ? "Grand Total" : "") : typeof table.totals![index] === "number" ? formatPowerBiValue(Number(table.totals![index]), table.columns[index].format) : "—");
        }
        if (!result.table!.modelTotals && plan.measures.length) {
            result.table!.modelTotals = [...plan.groups.map((_, index) => index === 0 ? "Grand Total" : ""), ...plan.measures.map(() => "—")];
        }
        if (plan.totalOnly) {
            if (!result.table?.modelTotals) throw new Error("Power BI did not return the total for this measure. Refresh the visual to load model totals.");
            if (plan.measures.length === 1) return { modelQuery: true, text: `${plan.measures[0]}.${plan.summary.length ? " Filtered by: " + plan.summary.join("; ") : ""}`, kpi: { title: plan.measures[0], value: result.table.modelTotals[plan.groups.length] } };
            return { modelQuery: true, text: "Totals", table: { columns: plan.measures, rows: [result.table.modelTotals.slice(plan.groups.length)], rowIndices: [[]] } };
        }
        if (plan.presentation && !["table", "matrix"].includes(plan.presentation)) {
            const measureIndex = indices[plan.groups.length];
            let sourceRows = (table.rows || []).filter(row => typeof row[measureIndex] === "number");
            if (plan.rank) sourceRows = sourceRows.slice().sort((a,b) => (Number(a[measureIndex]) - Number(b[measureIndex])) * (plan.rank!.ascending ? 1 : -1)).slice(0, plan.rank.count);
            result.chart = {
                type: plan.presentation as QnaChartType,
                totalLabel: result.table?.modelTotals?.[plan.groups.length],
                series: plan.measures.length > 1 ? plan.measures.map((name, index) => { const column = indices[plan.groups.length + index]; return { name, values: sourceRows.map(row => typeof row[column] === "number" ? Number(row[column]) : 0), valueLabels: sourceRows.map(row => typeof row[column] === "number" ? formatPowerBiValue(Number(row[column]), table.columns[column].format) : "—") }; }) : undefined,
                title: `${plan.measures.join(" and ")} by ${plan.groups.join(" and ")}`,
                groupNames: plan.groups,
                groupValues: sourceRows.map(row => indices.slice(0, plan.groups.length).map(index => String(row[index] ?? ""))),
                labels: sourceRows.map(row => indices.slice(0, plan.groups.length).map(index => String(row[index] ?? "—")).join(" · ")),
                values: sourceRows.map(row => Number(row[measureIndex])),
                valueLabels: sourceRows.map(row => formatPowerBiValue(Number(row[measureIndex]), table.columns[measureIndex].format)),
                valueFormat: table.columns[measureIndex].format,
                rowIndices: sourceRows.map((_, index) => [index]),
                modelRowSelections: sourceRows.map(row => result.table!.modelRowSelections![(table.rows || []).indexOf(row)])
            };
        }
        if (plan.presentation === "matrix") {
            const model = readModelMatrix(dataView.matrix);
            if (model && plan.matrixRowCount === plan.groups.length && model.table.columns.slice(0, plan.groups.length).every((column, index) => column.displayName === plan.groups[index])) {
                const hierarchy = modelHierarchy(result.table!, model, plan.groups, plan.measures);
                if (hierarchy.matrix) hierarchy.rows = hierarchy.rows.map((row, index) => [row[0], ...plan.measures.map(name => { const sourceIndex = dataView.matrix!.valueSources.findIndex(source => source.displayName === name); const value = model.hierarchy[index].values[sourceIndex]; return typeof value === "number" ? formatPowerBiValue(value, dataView.matrix!.valueSources[sourceIndex].format) : "—"; })]);
                result.table = hierarchy; return result;
            }
            const rowTotals = new Map<string, string[]>();
            if (model && sameGrouping(model.table.columns.slice(0, plan.groups.length).map(column => column.displayName), plan.groups) && model.table.columns.slice(0, plan.groups.length).every((column, index) => column.displayName === plan.groups[index])) {
                const measureIndices = plan.measures.map(name => dataView.matrix!.valueSources.findIndex(source => source.displayName === name));
                model.hierarchy.filter(row => row.branch && row.depth === (plan.matrixRowCount ?? plan.groups.length - 1) - 1).forEach(row => {
                    if (measureIndices.every(index => row.values[index] != null)) rowTotals.set(row.key, measureIndices.map(index => formatPowerBiValue(Number(row.values[index]), dataView.matrix!.valueSources[index].format)));
                });
            }
            const editor = result.table!.modelEditor;
            result.table = pivotModelTable(result.table!, plan.groups.length, rowTotals, plan.matrixRowCount);
            if (editor) result.table.modelEditor = { ...editor, rows: plan.groups.slice(0, plan.matrixRowCount ?? -1), columns: plan.groups.slice(plan.matrixRowCount ?? -1) };
        }
        if (plan.rank) {
            if (plan.presentation === "matrix") throw new Error("Use table or chart format for ranked answers.");
            const measureIndex = indices[plan.groups.length];
            const ranked = (table.rows || []).map((row, index) => ({ index, value: row[measureIndex] })).filter(row => typeof row.value === "number")
                .sort((a, b) => (Number(a.value) - Number(b.value)) * (plan.rank!.ascending ? 1 : -1)).slice(0, plan.rank.count).map(row => row.index);
            result.table!.modelRowSelections = ranked.map(index => result.table!.modelRowSelections![index]);
            result.table!.modelCellSelections = ranked.map(index => result.table!.modelCellSelections![index]);
            result.table!.rows = ranked.map(index => rows[index]); result.table!.rowIndices = ranked.map(() => []);
            result.table!.modelRawRows = ranked.map(index => result.table!.modelRawRows![index]);
            result.table!.modelSelections = ranked.map(index => result.table!.modelSelections![index]);
            // The model total covers the full filter context, not the top/bottom subset.
            delete result.table!.modelTotals;
            if (result.chart) {
                const chart = result.chart;
                const rankIndices = chart.values.map((value, index) => ({ value, index })).sort((a, b) => (a.value - b.value) * (plan.rank!.ascending ? 1 : -1)).slice(0, plan.rank.count).map(row => row.index);
                chart.labels = rankIndices.map(index => chart.labels[index]); chart.valueLabels = rankIndices.map(index => chart.valueLabels[index]); chart.values = rankIndices.map(index => chart.values[index]); chart.rowIndices = rankIndices.map(() => []);
            }
        }
        return result;
    }

    fail(message: string): void { this.dataRequestsStopped = true; this.status.textContent = message; this.cancel(message); }
    private cancel(message = "Query cancelled. No answer was calculated from previous data."): void {
        if (this.timer) clearTimeout(this.timer); if (this.recoveryTimer) clearTimeout(this.recoveryTimer); const pending = this.pending; this.pending = undefined; pending?.reject(new Error(message));
    }
    destroy(): void { this.stopSuggestionLoading(); this.cancel(); this.panel.remove(); }
}
