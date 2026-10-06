import powerbi from "powerbi-visuals-api";
import { IFilterTarget } from "powerbi-models";
import { applySelectionFilter, buildSelectionFilters, resolveFilterTarget } from "./selectionFilter";
import { buildContext, categoricalAsTable } from "./dataAdapter";
import { GlobalQnaEngine } from "./qna/engine";
import { GlobalQnaUi } from "./qna/ui";
import "../style/visual.less";

export class Visual implements powerbi.extensibility.visual.IVisual {
    private readonly host: powerbi.extensibility.visual.IVisualHost;
    private readonly selection: powerbi.extensibility.ISelectionManager;
    private readonly engine: GlobalQnaEngine;
    private readonly ui: GlobalQnaUi;
    private table?: powerbi.DataViewTable;
    private categorical?: powerbi.DataViewCategorical;
    private hasDataContext = false;
    private selectedIndices: number[] = [];
    private restoredState = "";
    private stateHydrated = false;
    private restoringData = true;
    private loadingSegments = false;
    private selectedFilter?: { fieldName: string; values: string[]; activeFieldNames: string[]; filters?: Array<{ fieldName: string; values: string[] }> };

    constructor(options: powerbi.extensibility.visual.VisualConstructorOptions) {
        this.host = options.host;
        this.selection = this.host.createSelectionManager();
        options.element.classList.add("askbics-host");
        this.engine = new GlobalQnaEngine(buildContext(undefined));
        this.ui = new GlobalQnaUi(options.element, this.engine, this.selectRows, this.persistState, this.showContextMenu);
    }

    public update(options: powerbi.extensibility.visual.VisualUpdateOptions): void {
        const dataView = options.dataViews?.[0];
        const stored = String(dataView?.metadata?.objects?.state?.conversation || "");
        let restoredUiState: any;
        if (!this.stateHydrated && options.dataViews?.length) {
            this.stateHydrated = true;
            if (stored) { try { restoredUiState = JSON.parse(stored); const savedFilter = restoredUiState?.selectionFilter; if (savedFilter?.fieldName && Array.isArray(savedFilter.values)) this.selectedFilter = { fieldName: String(savedFilter.fieldName), values: savedFilter.values.map(String), activeFieldNames: Array.isArray(savedFilter.activeFieldNames) ? savedFilter.activeFieldNames.map(String) : [String(savedFilter.fieldName)], filters: Array.isArray(savedFilter.filters) ? savedFilter.filters.map((filter: any) => ({ fieldName: String(filter.fieldName), values: Array.isArray(filter.values) ? filter.values.map(String) : [] })) : undefined }; this.restoredState = stored; } catch { this.restoredState = ""; } }
        }
        const nextTable = dataView?.table || categoricalAsTable(dataView?.categorical);
        const dataChanged = !this.hasDataContext || (options.type & powerbi.VisualUpdateType.Data) !== 0;
        const hasIncomingDataView = !!dataView;
        const hasMoreSegments = !!dataView?.metadata?.segment;
        if (dataChanged && hasIncomingDataView) {
            this.table = nextTable;
            this.categorical = dataView.categorical;
            this.hasDataContext = true;
            if (this.selectedFilter && this.table) {
                const filters = this.selectedFilter.filters?.length ? this.selectedFilter.filters : [{ fieldName: this.selectedFilter.fieldName, values: this.selectedFilter.values }];
                const resolved = filters.map((filter) => ({ columnIndex: this.table!.columns.findIndex((column) => column.displayName === filter.fieldName), values: new Set(filter.values) }));
                this.selectedIndices = resolved.every((filter) => filter.columnIndex >= 0) ? this.table.rows.map((row, index) => resolved.every((filter) => filter.values.has(String(row[filter.columnIndex] ?? "(Blank)"))) ? index : -1).filter((index) => index >= 0) : [];
            } else this.selectedIndices = this.selectedIndices.filter((index) => index >= 0 && index < (this.table?.rows?.length ?? 0));
            this.engine.updateContext(buildContext(this.table, this.selectedIndices));
            this.ui.updateEngine(this.engine, this.stateHydrated, this.restoringData || this.loadingSegments || hasMoreSegments);
        }
        if (restoredUiState) { this.ui.restoreState(restoredUiState); if (this.selectedFilter && this.selectedIndices.length) { const indices = this.selectedIndices.slice(); this.selectedIndices = []; this.selectRows(indices, false, this.selectedFilter.activeFieldNames); } }
        if (hasMoreSegments) this.host.fetchMoreData(true);
        else if (hasIncomingDataView) this.restoringData = false;
        this.loadingSegments = hasMoreSegments;
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return { cards: [] };
    }

    private persistState = (): void => {
        const value = JSON.stringify({ ...this.ui.getState(), selectionFilter: this.selectedFilter });
        this.restoredState = value;
        // Power BI uses a null selector for visual-level properties, although its API declaration
        // currently exposes Selector as non-nullable.
        const globalSelector = null as unknown as powerbi.data.Selector;
        this.host.persistProperties({ merge: [{ objectName: "state", selector: globalSelector, properties: { conversation: value } }] });
    };

    private selectRows = (indices: number[], additive = false, activeFieldNames: string[] = []): void => {
        const table = this.table;
        if (!table) return;
        const valid = Array.from(new Set(indices)).filter((index) => index >= 0 && index < (table.rows?.length ?? 0));
        const currentSelection = new Set(this.selectedIndices);
        const validSet = new Set(valid);
        const selectedAlready = valid.length > 0 && valid.every((index) => currentSelection.has(index));
        const sameSelection = !additive && selectedAlready && valid.length === currentSelection.size;
        const nextIndices = additive
            ? selectedAlready ? this.selectedIndices.filter((index) => !validSet.has(index)) : Array.from(new Set(this.selectedIndices.concat(valid)))
            : sameSelection ? [] : valid;
        const categories = this.categorical?.categories || [];
        const clean = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const rowSelectionIncludesAllYears = activeFieldNames.length === 1 && /tenant|name/i.test(activeFieldNames[0] || "");
        const effectiveFieldNames = rowSelectionIncludesAllYears ? [...activeFieldNames, ...table.columns.filter((column) => !column.roles?.measures && /\byear\b/i.test(column.displayName)).map((column) => column.displayName)] : activeFieldNames;
        const requestedFields = new Set(effectiveFieldNames.map(clean).filter(Boolean));
        const activeColumns = table.columns.map((column, index) => ({ column, index })).filter(({ column }) => requestedFields.has(clean(column.displayName)));
        const chipColumn = activeColumns[0];
        const filterParts = activeColumns.map(({ column, index }) => { const selectedValues = nextIndices.map((rowIndex) => table.rows[rowIndex]?.[index]); const supported = selectedValues.every((value) => typeof value === "string" || typeof value === "number" || typeof value === "boolean"); return { column, index, target: this.filterTarget(column), supported, rawValues: supported ? Array.from(new Set(selectedValues as Array<string | number | boolean>)) : [] }; });
        const semanticFilters = buildSelectionFilters(filterParts);
        const canUseSemanticFilter = !nextIndices.length || semanticFilters.length > 0;
        const applyState = () => {
            this.selectedIndices = nextIndices;
            this.engine.updateSelection(this.selectedIndices, activeFieldNames);
            const filterState = filterParts.map((part) => ({ fieldName: part.column.displayName, values: Array.from(new Set(this.selectedIndices.map((rowIndex) => String(table.rows[rowIndex]?.[part.index] ?? "(Blank)")))).filter(Boolean) }));
            const tupleEntries = filterState.length > 1 && !rowSelectionIncludesAllYears ? Array.from(new Map(this.selectedIndices.map((rowIndex) => { const values = filterParts.map((part) => String(table.rows[rowIndex]?.[part.index] ?? "(Blank)")); return [JSON.stringify(values), { label: values.join(" · "), values }]; })).values()) : [];
            const chipEntries = (filterState.length === 1 || rowSelectionIncludesAllYears) ? filterState[0].values.map((label) => ({ fieldName: filterState[0].fieldName, label })) : [];
            const chipLabels = tupleEntries.length ? tupleEntries.map((entry) => entry.label) : chipEntries.map((entry) => entry.label);
            this.selectedFilter = this.selectedIndices.length && chipColumn ? { fieldName: chipColumn.column.displayName, values: filterState[0]?.values || [], activeFieldNames: activeFieldNames.slice(), filters: filterState } : undefined;
            if (this.selectedIndices.length && !chipLabels.length) chipLabels.push(`Selected: ${this.selectedIndices.length.toLocaleString()} ${this.selectedIndices.length === 1 ? "row" : "rows"}`);
            this.ui.setFilterChips(this.selectedIndices.length ? chipLabels : [], chipColumn ? (label) => {
                const tupleEntry = tupleEntries.find((item) => item.label === label);
                if (tupleEntry) { const remaining = this.selectedIndices.filter((rowIndex) => !filterParts.every((part, partIndex) => String(table.rows[rowIndex]?.[part.index] ?? "(Blank)") === tupleEntry.values[partIndex])); this.selectRows(remaining, false, activeFieldNames); return; }
                const entry = chipEntries.find((item) => item.label === label); if (!entry) return;
                if (rowSelectionIncludesAllYears) {
                    const remaining = this.selectedIndices.filter((rowIndex) => String(table.rows[rowIndex]?.[chipColumn.index] ?? "(Blank)") !== label);
                    this.selectRows(remaining, false, activeFieldNames);
                    return;
                }
                const remainingFilters = filterState.map((filter) => filter.fieldName === entry.fieldName ? { ...filter, values: filter.values.filter((value) => value !== label) } : filter).filter((filter) => filter.values.length);
                if (!remainingFilters.length) { this.selectRows([], false, []); return; }
                const resolved = remainingFilters.map((filter) => ({ index: table.columns.findIndex((column) => column.displayName === filter.fieldName), values: new Set(filter.values) }));
                const remaining = table.rows.map((row, rowIndex) => resolved.every((filter) => filter.index >= 0 && filter.values.has(String(row[filter.index] ?? "(Blank)"))) ? rowIndex : -1).filter((rowIndex) => rowIndex >= 0);
                this.selectRows(remaining, false, remainingFilters.map((filter) => filter.fieldName));
            } : undefined);
            this.ui.updateEngine(this.engine, false);
            this.persistState();
        };
        if (canUseSemanticFilter) {
            this.selection.clear().then(() => {
                applyState();
                applySelectionFilter(this.host, nextIndices, semanticFilters.map((filter) => filter.toJSON()));
            });
            return;
        }
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
        this.host.applyJsonFilter(null, "general", "filter", powerbi.FilterAction.remove);
        (identities.length ? this.selection.select(identities, false) : this.selection.clear()).then(applyState);
    };

    private filterTarget(column: powerbi.DataViewMetadataColumn): IFilterTarget | undefined {
        return resolveFilterTarget(column);
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
