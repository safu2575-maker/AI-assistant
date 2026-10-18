import powerbi from "powerbi-visuals-api";
import { IFilterTarget } from "powerbi-models";
import { applySelectionFilter, dateSelectionFilters, buildSelectionFilters, canCompactSelection, resolveFilterTarget, toggleSelection } from "./selectionFilter";
import { buildContext, categoricalAsTable } from "./dataAdapter";
import { GlobalQnaEngine } from "./qna/engine";
import { GlobalQnaUi } from "./qna/ui";
import "../style/visual.less";
import { FieldParameterTrial } from "./fieldParameterTrial";
import { readModelMatrix } from "./modelMatrix";
import { BasicFilter } from "powerbi-models";

export class Visual implements powerbi.extensibility.visual.IVisual {
    private parameterTrial: FieldParameterTrial;
    private readonly host: powerbi.extensibility.visual.IVisualHost;
    private readonly selection: powerbi.extensibility.ISelectionManager;
    private readonly engine: GlobalQnaEngine;
    private readonly ui: GlobalQnaUi;
    private table?: powerbi.DataViewTable;
    private categorical?: powerbi.DataViewCategorical;
    private hasDataContext = false;
    private selectedIndices: number[] = [];
    private selectionRevision = 0;
    private restoredState = "";
    private stateHydrated = false;
    private restoringData = true;
    private loadingSegments = false;
    private selectedFilter?: { fieldName: string; values: string[]; activeFieldNames: string[]; backgroundFields?: string[]; filters?: Array<{ fieldName: string; values: string[] }>; contextLabel?: string };

    constructor(options?: powerbi.extensibility.visual.VisualConstructorOptions) {
        if (!options) throw new Error("Power BI visual constructor options are required.");
        this.host = options.host;
        this.selection = this.host.createSelectionManager();
        options.element.classList.add("askbics-host");
        this.engine = new GlobalQnaEngine(buildContext(undefined));
        this.ui = new GlobalQnaUi(options.element, this.engine, this.selectRows, this.persistState, this.showContextMenu);
        this.parameterTrial = new FieldParameterTrial(options.element, this.host);
        this.parameterTrial.onDataContextChanged = () => this.ui.invalidateModelAnswers();
        this.parameterTrial.onProgress = message => this.ui.setLoadingStage(message);
        this.ui.prepareQuestion = (question, refresh) => this.parameterTrial.prepareQuestion(question, refresh);
        this.ui.cancelQuestion = () => this.parameterTrial.cancelQuestion();
        this.ui.downloadPdf = async (content, filename) => {
            const service=this.host.downloadService;
            if (!service) return "This Power BI host does not provide the download service.";
            const status = await service.exportStatus();
            if (status === powerbi.PrivilegeStatus.DisabledByAdmin) return "Power BI reports DisabledByAdmin for this session. If the tenant setting is already enabled, reopen Power BI and verify that you are signed into the same organization. In Desktop, also check the download group policy.";
            if (status === powerbi.PrivilegeStatus.NotDeclared) return "Power BI reports NotDeclared. Reimport the current askBICS visual package with its ExportContent permission and republish the report.";
            if (status !== powerbi.PrivilegeStatus.Allowed) return `Power BI download API is unavailable (status ${status}).`;
            const completed = typeof service.exportVisualsContentExtended === "function"
                ? (await service.exportVisualsContentExtended(content, filename, "base64", "askBICS PDF report")).downloadCompleted
                : await service.exportVisualsContent(content, filename, "base64", "askBICS PDF report");
            return completed || "Power BI reports downloads are Allowed, but the download did not complete. Check the Power BI consent dialog and browser downloads. The API did not provide a failure reason.";
        };
        this.ui.resetQuestionSelection = () => {
            if (!this.selectedIndices.length && !this.selectedFilter && !this.selectionRevision) return;
            ++this.selectionRevision; // Invalidate callbacks from an earlier row/cell click.
            this.selectedIndices = []; this.selectedFilter = undefined;
            this.engine.updateSelection([]);
            applySelectionFilter(this.host, [], []);
            void this.selection.clear().then(() => {}, () => {});
            this.persistState();
        };
        this.ui.selectModelRows = rows => {
            const revision = ++this.selectionRevision;
            const targetOf = (part: typeof rows[number][number]): IFilterTarget => part.column ? { table: part.table, column: part.column } : { table: part.table, hierarchy: part.hierarchy!, hierarchyLevel: part.hierarchyLevel! };
            const normalized = rows.map(row => [...row].sort((a,b) => JSON.stringify(targetOf(a)).localeCompare(JSON.stringify(targetOf(b)))));
            const first = normalized[0] || [];
            const compatible = normalized.every(row => row.length === first.length && row.every((part, index) => JSON.stringify(targetOf(part)) === JSON.stringify(targetOf(first[index]))));
            if (!compatible) { this.ui.setFilterChips(['Select items with the same fields together.']); return; }
            this.selectedIndices = []; this.selectedFilter = undefined; this.engine.updateSelection([]);
            this.selection.clear().then(() => {
                if (revision !== this.selectionRevision) return;
                if (!first.length) { applySelectionFilter(this.host, [], []); this.ui.setFilterChips([]); this.persistState(); return; }
                const filters = first.map((part, index) => new BasicFilter(targetOf(part), 'In', [...new Set(normalized.map(row => row[index].value))]).toJSON());
                const tuples = [...new Map(normalized.map(row => { const tuple = row.map(part => part.value); return [JSON.stringify(tuple), tuple]; })).values()];
                const product = filters.reduce((count, filter) => count * filter.values.length, 1);
                const rectangular = product === tuples.length;
                const outputFilters = rectangular ? filters.flatMap((filter,index) => first[index].dateDay
                    ? dateSelectionFilters(filter.target as IFilterTarget, filter.values.map(String)) : [filter]) : filters;
                applySelectionFilter(this.host, tuples.map((_, index) => index), outputFilters, tuples, !rectangular);
                const labels = filters.map((filter,index) => first[index].dateDay
                    ? [...new Set(filter.values.map(value => new Date(String(value)).toLocaleDateString('en-US', {month:'long',year:'numeric',timeZone:'UTC'})))].join(' + ')
                    : filter.values.length <= 4 ? filter.values.join(', ') : filter.values.length + ' selected values');
                this.ui.setFilterChips([labels.join(' · ')], () => this.ui.clearModelSelection());
                this.persistState();
            });
        };
        this.ui.automaticGroupingEnabled = () => this.parameterTrial.automaticEnabled();
        this.ui.mountDataSettings = container => this.parameterTrial.mountSettings(container);
        this.ui.mountTimeSettings = container => this.parameterTrial.mountTimeSettings(container);
        this.ui.timeSettings = () => this.parameterTrial.readTimeSetup();
        this.ui.saveDataSettings = () => this.parameterTrial.saveSettings();
        this.ui.cancelDataSettings = () => this.parameterTrial.cancelSettings();
        this.ui.measureOptions = () => this.parameterTrial.measureOptions();
        this.parameterTrial.defaultMeasure = () => this.engine.getLayoutSettings().defaultMeasure;
        this.parameterTrial.additiveMeasures = () => this.engine.getLayoutSettings().additiveMeasures || [];
        this.ui.groupingOptions = () => this.parameterTrial.groupingOptions();
        this.ui.valueOptions = () => this.parameterTrial.valueOptions();
        this.ui.loadSuggestionValues = fields => this.parameterTrial.loadSuggestionValues(fields);
        this.parameterTrial.onSuggestionValuesChanged = () => this.ui.refreshValueSuggestions();
        this.parameterTrial.groupAliases = () => {
            const settings = this.engine.getLayoutSettings();
            return Object.fromEntries(Object.entries(settings.synonyms || {}).filter(([name]) => settings.synonymEnabled?.[name] !== false));
        };
        this.parameterTrial.preferMatrix = counts => {
            const settings = this.engine.getLayoutSettings();
            if (!settings.cardinalityFallbackEnabled || counts.length < 2) return false;
            const highest = Math.max(...counts);
            return counts.some(count => count > 0 && count < highest && count <= highest * settings.cardinalityMatrixThresholdPct / 100);
        };
    }

    public update(options: powerbi.extensibility.visual.VisualUpdateOptions): void {
        // Persisted visual objects are not guaranteed to be attached to the
        // first data view in a multi-mapping update.
        options.dataViews?.forEach(view => this.parameterTrial.hydrate(view));
        const dataView = this.parameterTrial.selectDataView(options.dataViews || []);
        const stored = String(dataView?.metadata?.objects?.state?.conversation || "");
        let restoredUiState: any;
        if (!this.stateHydrated && options.dataViews?.length) {
            this.stateHydrated = true;
            if (stored) { try { restoredUiState = JSON.parse(stored); this.restoredState = stored; } catch { this.restoredState = ""; } }
        }
        const dataChanged = !this.hasDataContext || (options.type & powerbi.VisualUpdateType.Data) !== 0;
        const hasIncomingDataView = !!dataView;
        const hasMoreSegments = !!dataView?.metadata?.segment;
        // Deliver host responses before presentation/state restoration. A UI
        // update must not prevent the waiting query from seeing its data.
        if (hasIncomingDataView) this.parameterTrial.update(dataView, options.jsonFilters, dataChanged);
        if (dataChanged && hasIncomingDataView && !hasMoreSegments && !this.parameterTrial.dataRequestsStopped && !this.parameterTrial.loadingSuggestionValues) {
            this.table = dataView.table || categoricalAsTable(dataView.categorical) || readModelMatrix(dataView.matrix)?.table;
            this.categorical = dataView.categorical;
            this.hasDataContext = true;
            if (this.selectedFilter && this.table) {
                const filters = this.selectedFilter.filters?.length ? this.selectedFilter.filters : [{ fieldName: this.selectedFilter.fieldName, values: this.selectedFilter.values }];
                const resolved = filters.map((filter) => ({ columnIndex: this.table!.columns.findIndex((column) => column.displayName === filter.fieldName), values: new Set(filter.values) }));
                this.selectedIndices = resolved.every((filter) => filter.columnIndex >= 0) ? (this.table.rows || []).map((row, index) => resolved.every((filter) => filter.values.has(String(row[filter.columnIndex] ?? "(Blank)"))) ? index : -1).filter((index) => index >= 0) : [];
            } else this.selectedIndices = this.selectedIndices.filter((index) => index >= 0 && index < (this.table?.rows?.length ?? 0));
            this.engine.updateContext(buildContext(this.table, this.selectedIndices));
            this.ui.updateEngine(this.engine, this.stateHydrated, this.restoringData || this.loadingSegments || hasMoreSegments);
        }
        if (restoredUiState) this.ui.restoreState(restoredUiState);
        if (hasMoreSegments && !this.parameterTrial.dataRequestsStopped) {
            if (!this.host.fetchMoreData(true)) this.parameterTrial.fail("Power BI could not load the complete query result. Narrow the grouping or filters; no complete answer is available.");
        } else if (hasIncomingDataView) this.restoringData = false;
        this.loadingSegments = hasMoreSegments;
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return { cards: [] };
    }

    public destroy(): void { this.ui.cancelSelectionDispatch(); this.parameterTrial.destroy(); }

    private persistState = (): void => {
        const value = JSON.stringify({ ...this.ui.getState(), selectionFilter: this.selectedFilter });
        this.restoredState = value;
        // Power BI uses a null selector for visual-level properties, although its API declaration
        // currently exposes Selector as non-nullable.
        const globalSelector = null as unknown as powerbi.data.Selector;
        this.parameterTrial.noteUiStateWrite(value);
        this.host.persistProperties({ merge: [{ objectName: "state", selector: globalSelector, properties: { conversation: value } }] });
    };

    private selectRows = (indices: number[], additive = false, activeFieldNames: string[] = [], backgroundFields: string[] = this.selectedFilter?.backgroundFields || [], replace = false, contextLabel = ""): void => {
        const table = this.table;
        if (!table) return;
        const rows = table.rows || [];
        const valid = Array.from(new Set(indices)).filter((index) => index >= 0 && index < (table.rows?.length ?? 0));
        const nextIndices = replace ? valid : toggleSelection(this.selectedIndices, valid, additive);
        const revision = ++this.selectionRevision;
        this.selectedIndices = nextIndices;
        const categories = this.categorical?.categories || [];
        const clean = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const effectiveFieldNames = activeFieldNames;
        const requestedFields = new Set(effectiveFieldNames.map(clean).filter(Boolean));
        const activeColumns = table.columns.map((column, index) => ({ column, index })).filter(({ column }) => requestedFields.has(clean(column.displayName)));
        const chipColumn = activeColumns[0];
        const filterParts = activeColumns.map(({ column, index }) => { const selectedValues = nextIndices.map((rowIndex) => rows[rowIndex]?.[index]); const supported = selectedValues.every((value) => typeof value === "string" || typeof value === "number" || typeof value === "boolean"); return { column, index, target: this.filterTarget(column), supported, rawValues: supported ? Array.from(new Set(selectedValues as Array<string | number | boolean>)) : [] }; });
        const backgroundColumns = table.columns.map((column, index) => ({ column, index })).filter(({ column }) => backgroundFields.includes(column.displayName) && !requestedFields.has(clean(column.displayName)));
        const backgroundParts = backgroundColumns.map(({ column, index }) => { const values = nextIndices.map((rowIndex) => rows[rowIndex]?.[index]); return { column, index, target: this.filterTarget(column), supported: values.every((value) => typeof value === "string" || typeof value === "number" || typeof value === "boolean"), rawValues: Array.from(new Set(values)) as Array<string | number | boolean> }; });
        const semanticFilters = buildSelectionFilters([...filterParts, ...backgroundParts]);
        const canUseSemanticFilter = !nextIndices.length || semanticFilters.length > 0;
        const selectionParts = [...filterParts, ...backgroundParts];
        const compactSemanticSelection = canUseSemanticFilter && canCompactSelection(rows, nextIndices, selectionParts);
        const applyState = () => {
            if (revision !== this.selectionRevision) return;
            this.selectedIndices = nextIndices;
            this.engine.updateSelection(this.selectedIndices, activeFieldNames, [...effectiveFieldNames, ...backgroundFields]);
            const filterState = filterParts.map((part) => ({ fieldName: part.column.displayName, values: Array.from(new Set(this.selectedIndices.map((rowIndex) => String(rows[rowIndex]?.[part.index] ?? "(Blank)")))).filter(Boolean) }));
            const tupleEntries = filterState.length > 1 ? Array.from(new Map(this.selectedIndices.map((rowIndex) => { const values = filterParts.map((part) => String(rows[rowIndex]?.[part.index] ?? "(Blank)")); return [JSON.stringify(values), { label: values.join(" · "), values }]; })).values()) : [];
            const chipEntries = filterState.length === 1 ? filterState[0].values.map((label) => ({ fieldName: filterState[0].fieldName, label })) : [];
            const chipLabels = tupleEntries.length ? tupleEntries.map((entry) => entry.label) : chipEntries.map((entry) => entry.label);
            const backgroundLabel = backgroundParts.map((part) => part.rawValues.join(", ")).filter(Boolean).join(" · ");
            const displayLabels = new Map(chipLabels.map((label) => [backgroundLabel ? `${backgroundLabel} · ${label}` : label, label]));
            const timeWindowLabel = (() => { const kind = contextLabel.match(/\b(YTD|TTM)\b/i)?.[1]?.toUpperCase(); if (!kind) return undefined; const monthPart = filterParts.find((part) => /(^|\s)month($|\s)/i.test(part.column.displayName)); const yearPart = filterParts.find((part) => /(^|\s)year($|\s)/i.test(part.column.displayName)); if (!monthPart || !yearPart) return undefined; const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]; const monthNumber = (value: unknown) => { const normalized = String(value || "").trim().toLowerCase(); const named = months.findIndex((month) => month.toLowerCase() === normalized.slice(0, 3)); return named >= 0 ? named + 1 : Number(normalized.match(/\b(?:1[0-2]|0?[1-9])\b/)?.[0] || 0); }; const points = this.selectedIndices.map((rowIndex) => { const year = Number(String(rows[rowIndex]?.[yearPart.index] || "").match(/\b\d{4}\b/)?.[0]); const month = monthNumber(rows[rowIndex]?.[monthPart.index]); return { year, month, ordinal: year * 12 + month - 1 }; }).filter((point) => Number.isFinite(point.year) && point.month > 0).sort((a, b) => a.ordinal - b.ordinal); if (!points.length) return undefined; const first = points[0]; const last = points[points.length - 1]; const prefix = filterParts.filter((part) => part !== monthPart && part !== yearPart).flatMap((part) => part.rawValues.map(String)).join(" · "); const range = first.year === last.year ? `${months[first.month - 1]}–${months[last.month - 1]} ${last.year}` : `${months[first.month - 1]} ${first.year}–${months[last.month - 1]} ${last.year}`; return `${prefix ? `${prefix} · ` : ""}${kind}: ${range}`; })();
            const compactLabel = timeWindowLabel || (compactSemanticSelection && tupleEntries.length > 1
                ? selectionParts.map((part) => `${part.column.displayName}: ${part.rawValues.join(", ")}`).join(" · ") : undefined);
            this.selectedFilter = this.selectedIndices.length && chipColumn ? { fieldName: chipColumn.column.displayName, values: filterState[0]?.values || [], activeFieldNames: activeFieldNames.slice(), backgroundFields: backgroundFields.slice(), filters: [...filterState, ...backgroundParts.map((part) => ({ fieldName: part.column.displayName, values: part.rawValues.map(String) }))], contextLabel } : undefined;
            if (this.selectedIndices.length && !chipLabels.length) chipLabels.push(`Selected: ${this.selectedIndices.length.toLocaleString()} ${this.selectedIndices.length === 1 ? "row" : "rows"}`);
            this.ui.setFilterChips(this.selectedIndices.length ? (compactLabel ? [compactLabel] : displayLabels.size ? [...displayLabels.keys()] : chipLabels) : [], chipColumn ? (displayLabel) => {
                if (compactLabel && displayLabel === compactLabel) { this.selectRows([], false, [], [], true); return; }
                const label = displayLabels.get(displayLabel) ?? displayLabel;
                const tupleEntry = tupleEntries.find((item) => item.label === label);
                if (tupleEntry) { const remaining = this.selectedIndices.filter((rowIndex) => !filterParts.every((part, partIndex) => String(rows[rowIndex]?.[part.index] ?? "(Blank)") === tupleEntry.values[partIndex])); this.selectRows(remaining, false, activeFieldNames, backgroundFields, true); return; }
                const entry = chipEntries.find((item) => item.label === label); if (!entry) return;
                const remainingFilters = filterState.map((filter) => filter.fieldName === entry.fieldName ? { ...filter, values: filter.values.filter((value) => value !== label) } : filter).filter((filter) => filter.values.length);
                if (!remainingFilters.length) { this.selectRows([], false, []); return; }
                const resolved = remainingFilters.map((filter) => ({ index: table.columns.findIndex((column) => column.displayName === filter.fieldName), values: new Set(filter.values) }));
                const remaining = this.selectedIndices.filter((rowIndex) => resolved.every((filter) => filter.index >= 0 && filter.values.has(String(rows[rowIndex][filter.index] ?? "(Blank)"))));
                this.selectRows(remaining, false, remainingFilters.map((filter) => filter.fieldName), backgroundFields, true);
            } : undefined);
            if (nextIndices.length && !compactSemanticSelection) {
                const describe = (expr: any, depth = 0): any => {
                    if (!expr || typeof expr !== "object" || depth > 6) return typeof expr === "string" ? expr : undefined;
                    const result: Record<string, unknown> = {};
                    for (const key of ["entity", "ref", "property", "hierarchy", "level", "Entity", "Property", "Level", "source", "arg", "Column", "Hierarchy", "HierarchyLevel", "Expression", "SourceRef"]) {
                        if (expr[key] !== undefined) result[key] = typeof expr[key] === "string" ? expr[key] : describe(expr[key], depth + 1);
                    }
                    return result;
                };
                this.ui.setSelectionDiagnostics?.({
                    version: "2.1.5.0", selectedRows: nextIndices.length,
                    reason: !semanticFilters.length ? "Unresolved filter target or unsupported value type" : "Field filters would include additional rows",
                    fields: selectionParts.map((part) => ({ name: part.column.displayName, queryName: part.column.queryName, target: part.target, supported: part.supported,
                        expression: describe(part.column.expr), identityExpressions: part.column.identityExprs?.map((expr) => describe(expr)),
                        categoryIdentityFields: categories.find((category) => category.source === part.column)?.identityFields?.map((expr) => describe(expr)),
                        valueTypes: [...new Set(nextIndices.map((index) => typeof rows[index][part.index]))]
                    }))
                });
            }
            this.ui.updateEngine(this.engine, false);
            this.persistState();
        };
        backgroundFields.forEach((field) => requestedFields.add(clean(field)));
        const selectionCategories = requestedFields.size ? categories.filter((category) => requestedFields.has(clean(category.source.displayName))) : categories;
        const identitiesByKey = new Map<string, powerbi.visuals.ISelectionId>();
        const useTableIntersection = filterParts.length > 1;
        nextIndices.forEach((index) => {
            let builder = this.host.createSelectionIdBuilder(); let hasIdentity = false;
            if (useTableIntersection && table.identity?.[index]) { builder = builder.withTable(table, index); hasIdentity = true; }
            else selectionCategories.forEach((category) => { if (category.identity?.[index]) { builder = builder.withCategory(category, index); hasIdentity = true; } });
            if (!hasIdentity && table.identity?.[index]) builder = builder.withTable(table, index);
            const identity = builder.createSelectionId(); identitiesByKey.set(identity.getKey(), identity);
        });
        const identities = Array.from(identitiesByKey.values());
        // Categorical row identities preserve the exact intersections, including
        // hidden question filters and auto-date levels, without guessing targets.
        const hasCategoricalIdentities = categories.length > 0 && nextIndices.every((index) => categories.some((category) => !!category.identity?.[index]));
        if (hasCategoricalIdentities && !compactSemanticSelection) {
            applySelectionFilter(this.host, [], []);
            this.selection.clear().then(() => {
                if (revision !== this.selectionRevision) return;
                const tuples = nextIndices.map((rowIndex) => selectionParts.map((part) => rows[rowIndex][part.index] as string | number | boolean));
                applySelectionFilter(this.host, nextIndices, semanticFilters.map((filter) => filter.toJSON()), tuples, true);
                applyState();
            });
            return;
        }
        if (canUseSemanticFilter) {
            (compactSemanticSelection ? this.selection.clear() : identities.length ? this.selection.select(identities, false) : this.selection.clear()).then(() => {
                if (revision !== this.selectionRevision) return;
                applyState();
                const tuples = nextIndices.map((rowIndex) => selectionParts.map((part) => rows[rowIndex][part.index] as string | number | boolean));
                applySelectionFilter(this.host, nextIndices, semanticFilters.map((filter) => filter.toJSON()), tuples, !compactSemanticSelection);
            });
            return;
        }
        applySelectionFilter(this.host, [], []);
        (identities.length ? this.selection.select(identities, false) : this.selection.clear()).then(applyState);
    };

    private filterTarget(column: powerbi.DataViewMetadataColumn): IFilterTarget | undefined {
        const category = this.categorical?.categories?.find((item) => item.source === column || (!!column.queryName && item.source.queryName === column.queryName));
        return resolveFilterTarget({ ...column, identityExprs: column.identityExprs?.length ? column.identityExprs : category?.identityFields });
    }

    private showContextMenu = (indices: number[], position: { x: number; y: number }, dataRole = "fields", measureName = "", activeFieldNames: string[] = []): void => {
        const table = this.table;
        if (!table) return;
        const index = indices.find((item) => item >= 0 && item < (table.rows?.length ?? 0));
        if (index === undefined) return;
        this.persistState();
        const clean = (value: string) => value.toLowerCase().replace(/^(?:total|average|minimum|maximum|count|distinct count)\s+/, "").replace(/^sum of\s+/, "").replace(/\s+·.*$/, "").trim();
        const requestedMeasure = clean(measureName);
        const measureColumns = table.columns.filter((column) => column.roles?.measures);
        const measure = dataRole === "measures" ? measureColumns.find((column) => column.displayName === measureName || clean(column.displayName) === requestedMeasure) || (measureColumns.length === 1 ? measureColumns[0] : undefined) : undefined;
        const requestedFields = new Set(activeFieldNames.flatMap((name) => name.split(/[>·]/)).map(clean).filter(Boolean));
        const activeColumns = table.columns.map((column, columnIndex) => ({ column, columnIndex })).filter(({ column }) => !column.roles?.measures && requestedFields.has(clean(column.displayName)));
        let builder = this.host.createSelectionIdBuilder();
        let hasScopedCategory = false;
        const categories = this.categorical?.categories || [];
        if (dataRole === "measures" && measure?.queryName) {
            // Power BI identities for the shared Fields role contain every loaded field.
            // Use a measure-only selector to guarantee that hidden dimensions are not sent.
            builder = builder.withMeasure(measure.queryName);
        } else {
            categories.filter((category) => requestedFields.has(clean(category.source.displayName))).forEach((category) => {
                if (!category.identity?.[index]) return;
                builder = builder.withCategory(category, index);
                hasScopedCategory = true;
            });
            if (!categories.length && table.identity?.[index]) {
                activeColumns.forEach(({ column, columnIndex }) => {
                    const identityFields = column.identityExprs || (column.expr ? [column.expr] : undefined);
                    if (!identityFields?.length) return;
                    const category: powerbi.DataViewCategoryColumn = { source: column, values: (table.rows || []).map((row) => row[columnIndex]), identity: table.identity, identityFields };
                    builder = builder.withCategory(category, index);
                    hasScopedCategory = true;
                });
            }
            if (!hasScopedCategory) builder = builder.withTable(table, index);
        }
        const identity = builder.createSelectionId();
        // The third showContextMenu argument is reserved for drill-down roles.
        // Report-page drillthrough is resolved from the category/measure selection identity.
        this.selection.showContextMenu(identity, position);
    };
}
