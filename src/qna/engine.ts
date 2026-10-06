import { QnaAggregation, QnaAutocompleteItem, QnaChartType, QnaContext, QnaField, QnaLayoutSettings, QnaMeasure, QnaResponse } from "./types";

const clean = (value: unknown): string => String(value ?? "").replace(/\s+/g, " ").trim();
const norm = (value: unknown): string => clean(value).toLowerCase().replace(/[^a-z0-9%]+/g, " ").replace(/\s+/g, " ").trim();
const measureAliases = (name: string): string[] => {
    const full = norm(name);
    const short = full.replace(/^(?:sum|total|average|avg|minimum|min|maximum|max|count|distinct count)\s+of\s+/, "").trim();
    return Array.from(new Set([full, short].filter(Boolean)));
};

export class GlobalQnaEngine {
    private layoutSettings: QnaLayoutSettings = { conversationMode: "history", cardinalityFallbackEnabled: true, cardinalityMatrixThresholdPct: 25, cardinalityMaxColumnValues: 5, cardinalityLowToHighHierarchy: true };
    private dashboardDateRange: { start: number; end: number } | null = null;
    private termCandidates: Array<{ label: string; lower: string; kind: "measure" | "field" | "value" }> | null = null;
    private autocompleteItems = new Map<string, QnaAutocompleteItem[]>();
    private cachedDateValues: Array<{ index: number; time: number }> | null = null;
    private allIndices: number[];
    private responseCache = new Map<string, QnaResponse>();
    private selectedIndexSet = new Set<number>();
    private selectedFieldKeys = new Set<string>();
    constructor(private context: QnaContext) { this.selectedIndexSet = new Set(context.selectedIndices); this.allIndices = Array.from({ length: context.rowCount }, (_, index) => index); }

    updateContext(context: QnaContext): void { this.context = context; this.selectedIndexSet = new Set(context.selectedIndices); this.allIndices = Array.from({ length: context.rowCount }, (_, index) => index); this.invalidateCaches(); }
    updateSelection(selectedIndices: number[], activeFieldNames: string[] = []): void {
        this.context.selectedIndices = selectedIndices;
        this.selectedIndexSet = new Set(selectedIndices);
        this.selectedFieldKeys = new Set(activeFieldNames.map(norm).filter(Boolean));
        this.responseCache.clear();
    }

    dataSummary(): { rows: number; fields: number; measures: number } {
        return { rows: this.context.rowCount, fields: this.context.fields.length, measures: this.context.measures.length };
    }

    selectionSummary(): { active: boolean; selectedRows: number; totalRows: number } {
        const selectedRows = this.context.selectedIndices.length;
        return { active: selectedRows > 0 && selectedRows < this.context.rowCount, selectedRows, totalRows: this.context.rowCount };
    }

    selectionMatches(indices: number[], activeFieldNames: string[] = []): boolean {
        if (!indices.length || !this.context.selectedIndices.length) return false;
        if (activeFieldNames.length) { const requested = new Set(activeFieldNames.map(norm).filter(Boolean)); if (requested.size !== this.selectedFieldKeys.size || Array.from(requested).some((key) => !this.selectedFieldKeys.has(key))) return false; }
        return indices.every((index) => this.selectedIndexSet.has(index));
    }

    configurationOptions(): { fields: string[]; measures: string[] } {
        return { fields: this.context.fields.map((field) => field.name), measures: this.context.measures.map((measure) => measure.name) };
    }

    getLayoutSettings(): QnaLayoutSettings { return { ...this.layoutSettings, autocompleteFields: this.layoutSettings.autocompleteFields?.slice(), autocompleteMeasures: this.layoutSettings.autocompleteMeasures?.slice(), synonyms: Object.fromEntries(Object.entries(this.layoutSettings.synonyms || {}).map(([key, values]) => [key, values.slice()])), synonymEnabled: { ...(this.layoutSettings.synonymEnabled || {}) } }; }
    measureNamesForQuestion(question: string): string[] { return this.resolveMeasures(norm(question)).map((measure) => measure.name); }
    answerIgnoringSelection(question: string): QnaResponse { const selected = this.context.selectedIndices; this.context.selectedIndices = []; try { return this.computeAnswer(question); } finally { this.context.selectedIndices = selected; } }
    setLayoutSettings(settings: Partial<QnaLayoutSettings>): void { this.layoutSettings = { ...this.layoutSettings, ...settings, autocompleteFields: settings.autocompleteFields?.slice() ?? this.layoutSettings.autocompleteFields, autocompleteMeasures: settings.autocompleteMeasures?.slice() ?? this.layoutSettings.autocompleteMeasures, synonyms: settings.synonyms ? Object.fromEntries(Object.entries(settings.synonyms).map(([key, values]) => [key, values.slice()])) : this.layoutSettings.synonyms, synonymEnabled: settings.synonymEnabled ? { ...settings.synonymEnabled } : this.layoutSettings.synonymEnabled }; this.invalidateCaches(); }
    dateExtent(): { min: Date; max: Date } | null { const values = this.dateValues(); if (!values.length) return null; let min = values[0].time; let max = min; for (let index = 1; index < values.length; index++) { const time = values[index].time; if (time < min) min = time; if (time > max) max = time; } return { min: new Date(min), max: new Date(max) }; }
    setDashboardDateRange(start?: Date, end?: Date): void { this.dashboardDateRange = start && end ? { start: start.getTime(), end: end.getTime() } : null; }
    answerInDateRange(question: string, start: Date, end: Date): QnaResponse { const previous = this.dashboardDateRange; this.dashboardDateRange = { start: start.getTime(), end: end.getTime() }; try { return this.answer(question); } finally { this.dashboardDateRange = previous; } }

    starterPrompts(): Array<{ icon: string; title: string; prompt: string }> {
        const measure = this.context.measures[0]?.name;
        const secondMeasure = this.context.measures[1]?.name;
        const field = this.context.fields[0]?.name;
        const secondField = this.context.fields[1]?.name;
        const prompts: Array<{ icon: string; title: string; prompt: string }> = [];
        if (measure) prompts.push({ icon: "Σ", title: "Summarize", prompt: `Show total ${measure}` });
        if (measure && field) prompts.push({ icon: "▥", title: "Visualize", prompt: `Show ${measure} by ${field} as a bar chart` });
        if (measure && field) prompts.push({ icon: "↑", title: "Rank", prompt: `Show top 5 ${field} by ${measure}` });
        if (measure && secondField) prompts.push({ icon: "↔", title: "Compare", prompt: `Compare ${measure} by ${secondField}` });
        if (secondMeasure && field && prompts.length < 4) prompts.push({ icon: "▤", title: "Create table", prompt: `Show ${measure} and ${secondMeasure} by ${field} in a table` });
        return prompts.slice(0, 4);
    }

    autocomplete(query: string, limit = 12, contextText = query): QnaAutocompleteItem[] {
        const searchAll = /^\s*@/.test(query); const q = norm(query.replace(/^\s*@/, ""));
        const cacheKey = searchAll ? "all" : "enabled"; let items = this.autocompleteItems.get(cacheKey);
        const enabledMeasures = this.layoutSettings.autocompleteMeasures; const enabledFields = this.layoutSettings.autocompleteFields;
        if (!items) { items = []; this.context.measures.filter((measure) => searchAll || enabledMeasures === undefined || enabledMeasures.includes(measure.name)).forEach((measure) => { items!.push({ label: measure.name, detail: "Measure" }); if (!/^(?:sum|total|average|avg|minimum|min|maximum|max|count)\b/i.test(measure.name)) { items!.push({ label: `Sum of ${measure.name}`, detail: "Measure" }, { label: `Average ${measure.name}`, detail: "Measure" }); } }); this.context.fields.filter((field) => searchAll || enabledFields === undefined || enabledFields.includes(field.name)).forEach((field) => { items!.push({ label: field.name, detail: "Field" }); field.uniqueValues.slice(0, 100).forEach((value) => items!.push({ label: value.label, detail: field.name })); }); [...this.context.fields, ...this.context.measures].forEach((entity) => this.configuredAliases(entity.name).forEach((alias) => items!.push({ label: alias, detail: `Synonym for ${entity.name}` }))); this.autocompleteItems.set(cacheKey, items); }
        items = items.slice();
        const visualContext = norm(contextText.replace(/\bas\b.*$/i, "")); const mentions = (name: string) => { const normalized = norm(name); const short = normalized.replace(/^(?:sum|total|average|avg|minimum|min|maximum|max|count|distinct count)\s+(?:of\s+)?/, ""); return !!visualContext && (visualContext.includes(normalized) || (!!short && visualContext.includes(short))); }; const mentionedMeasures = this.context.measures.filter((measure) => mentions(measure.name)); const mentionedFields = this.context.fields.filter((field) => mentions(field.name)); const temporal = mentionedFields.some((field) => /\b(?:date|time|year|quarter|month|week|day)\b/i.test(field.name)); const targetContext = mentionedMeasures.some((measure) => /\b(?:target|budget|goal)\b/i.test(measure.name)); let visualLabels: string[]; if (!mentionedMeasures.length && mentionedFields.length) visualLabels = ["as a table", "as a matrix"]; else if (mentionedMeasures.length && !mentionedFields.length) visualLabels = ["as a KPI", "as a table", ...(targetContext ? ["as a gauge", "as a bullet chart"] : [])]; else if (mentionedMeasures.length && mentionedFields.length) { visualLabels = ["as a table", ...(mentionedFields.length > 1 ? ["as a matrix", "as a heatmap", "as small multiples"] : []), "as a bar chart", "as a column chart", ...(temporal ? ["as a line chart", "as an area chart", "as a KPI trend", "as a sparkline"] : []), ...(mentionedFields.length === 1 ? ["as a pie chart", "as a donut chart", "as a treemap", "as a funnel chart"] : []), ...(mentionedFields.length > 1 || mentionedMeasures.length > 1 ? ["as a stacked bar chart", "as a stacked column chart", "as a combo chart"] : []), ...(mentionedMeasures.length > 1 ? ["as a scatter chart"] : [])]; } else visualLabels = ["as a table", "as a matrix", "as a bar chart", "as a column chart", "as a line chart", "as a heatmap", "as small multiples", "as a KPI trend", "as a sparkline"];
        const normalizedContext = norm(contextText); const hasCompletedVisual = visualLabels.some((label) => normalizedContext.endsWith(norm(label))); if (!hasCompletedVisual) visualLabels.forEach((label) => items.push({ label, detail: "Visual" }));
        const score = (item: QnaAutocompleteItem): number => {
            const label = norm(item.label);
            if (!q) return item.detail === "Measure" ? 2 : item.detail === "Field" ? 1 : 0;
            if (label === q) return 10;
            if (label.startsWith(q)) return 8;
            if (label.includes(q)) return 6;
            return -1;
        };
        return items.map((item, index) => ({ item, index, score: score(item) })).filter((x) => x.score >= 0)
            .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).map((x) => x.item);
    }

    recognizedTerms(text: string): Array<{ start: number; end: number; kind: "measure" | "field" | "value" }> {
        if (!this.termCandidates) { const candidates: Array<{ label: string; lower: string; kind: "measure" | "field" | "value" }> = []; this.context.measures.forEach((item) => { candidates.push({ label: item.name, lower: item.name.toLowerCase(), kind: "measure" }); const short = item.name.replace(/^(?:sum|total|average|avg|minimum|min|maximum|max|count|distinct count)\s+of\s+/i, "").trim(); if (short !== item.name) candidates.push({ label: short, lower: short.toLowerCase(), kind: "measure" }); }); this.context.fields.forEach((field) => { candidates.push({ label: field.name, lower: field.name.toLowerCase(), kind: "field" }); field.uniqueValues.forEach((item) => candidates.push({ label: item.label, lower: item.label.toLowerCase(), kind: "value" })); }); this.context.measures.forEach((item) => this.configuredAliases(item.name).forEach((alias) => candidates.push({ label: alias, lower: alias.toLowerCase(), kind: "measure" }))); this.context.fields.forEach((item) => this.configuredAliases(item.name).forEach((alias) => candidates.push({ label: alias, lower: alias.toLowerCase(), kind: "field" }))); this.termCandidates = candidates.sort((a, b) => b.label.length - a.label.length); }
        const lower = text.toLowerCase(); const matches: Array<{ start: number; end: number; kind: "measure" | "field" | "value" }> = [];
        this.termCandidates.forEach((item) => { let from = 0; const needle = item.lower; if (!needle) return; while (from < lower.length) { const start = lower.indexOf(needle, from); if (start < 0) break; const end = start + needle.length; const boundary = (start === 0 || /[^a-z0-9]/i.test(text[start - 1])) && (end === text.length || /[^a-z0-9]/i.test(text[end])); if (boundary && !matches.some((match) => start < match.end && end > match.start)) matches.push({ start, end, kind: item.kind }); from = start + Math.max(1, needle.length); } });
        return matches.sort((a, b) => a.start - b.start);
    }

    private invalidateCaches(): void { this.termCandidates = null; this.autocompleteItems.clear(); this.cachedDateValues = null; this.responseCache.clear(); }
    private configuredAliases(name: string): string[] { if (this.layoutSettings.synonymEnabled?.[name] === false) return []; return (this.layoutSettings.synonyms?.[name] || []).map(norm).filter(Boolean); }

    answer(question: string): QnaResponse {
        const range = this.dashboardDateRange; const cacheKey = `${range?.start || 0}:${range?.end || 0}:${question}`; const cached = this.responseCache.get(cacheKey); if (cached) return cached;
        const response = this.computeAnswer(question); this.responseCache.set(cacheKey, response); if (this.responseCache.size > 100) this.responseCache.delete(this.responseCache.keys().next().value!); return response;
    }

    private computeAnswer(question: string): QnaResponse {
        const explicitFilter = this.resolveExplicitFilters(question); const q = norm(explicitFilter.question);
        if (!q) return this.help();
        if (!this.context.rowCount) return { text: "Add fields and measures to this visual before asking a question." };
        const structured = this.structuredConfiguration(explicitFilter.question);
        if (structured) return this.configuredAnswer(structured.mode, structured.rows, structured.columns, structured.measures, explicitFilter.values);
        const explicitFields = this.resolveFields(q);
        const measureQuery = explicitFields.reduce((text, field) => text.replace(new RegExp(`\\b${norm(field.name).replace(/\s+/g, "\\s+")}\\b`, "g"), " "), q);
        const measures = this.resolveMeasures(measureQuery);
        const measure = measures[0];
        const requestedAggregation = this.resolveAggregation(q); const aggregation = (requestedAggregation === "count" || requestedAggregation === "distinctCount") && /^(?:distinct count|count|row count|record count|number of)\b/i.test(measure?.name || "") ? "sum" : requestedAggregation;
        const chartType = this.resolveChartType(q);
        const ranking = this.resolveRanking(q);
        const matchedValues = [...this.resolveValues(q), ...explicitFilter.values].filter((item, index, all) => all.findIndex((other) => other.field.key === item.field.key && norm(other.label) === norm(item.label)) === index);
        const comparisonValues = this.valueComparison(matchedValues);
        const explicitField = explicitFields[0];
        let field = explicitField;
        if (explicitFields.length > 1 && measures.length) {
            const multiScope = this.scopeIndicesExcept(matchedValues, new Set(explicitFields.map((item) => item.key)));
            const yearField = explicitFields.find((item) => /\byear\b/i.test(item.name)); const monthField = explicitFields.find((item) => /\bmonth\b/i.test(item.name)); const categoryFields = explicitFields.filter((item) => item.key !== yearField?.key && item.key !== monthField?.key); const automaticPeriodLayout = !chartType && !/\btable\b/.test(q);
            const selectedPeriods = matchedValues.filter((item) => /\b(?:year|month)\b/i.test(item.field.name)); if (automaticPeriodLayout && !yearField && !monthField && selectedPeriods.length === 1) return this.hierarchyMatrix(this.orderFieldsByCardinality(explicitFields, multiScope), [], measures, aggregation, multiScope, selectedPeriods[0].label);
            if (automaticPeriodLayout && yearField && monthField && yearField.key !== monthField.key) return this.hierarchyMatrix([monthField, ...categoryFields], [yearField], measures, aggregation, multiScope);
            const singlePeriod = yearField || monthField; if (automaticPeriodLayout && singlePeriod && categoryFields.length) return this.hierarchyMatrix(categoryFields, [singlePeriod], measures, aggregation, multiScope);
            if (/\bmatrix\b/.test(q)) return this.hierarchyMatrix(this.orderFieldsByCardinality(explicitFields, multiScope), [], measures, aggregation, multiScope);
            const visibleFields = explicitFields.filter((item) => this.fieldCardinality(item, multiScope) > 1);
            if (!chartType && !/\btable\b/.test(q) && visibleFields.length > 1 && this.shouldUseMatrix(visibleFields, multiScope)) return this.hierarchyMatrix(this.orderFieldsByCardinality(visibleFields, multiScope), [], measures, aggregation, multiScope);
            return this.groupedByFields(explicitFields, measures, aggregation, multiScope, chartType, ranking);
        }
        if (measures.length > 1) {
            const comparisonField = explicitField || comparisonValues?.field;
            const comparisonScope = this.scopeIndices(matchedValues, comparisonField);
            return comparisonField
                ? this.groupedMeasures(comparisonField, measures, aggregation, comparisonScope, chartType, comparisonValues?.field.key === comparisonField.key ? comparisonValues.labels : [])
                : this.compareMeasures(measures, aggregation, this.scopeIndices(matchedValues), chartType);
        }
        if (measure && !explicitField && comparisonValues) {
            const comparisonScope = this.scopeIndices(matchedValues, comparisonValues.field);
            return this.grouped(comparisonValues.field, measure, aggregation, comparisonScope, chartType, ranking, comparisonValues.labels, true);
        }
        if (!field && (ranking || chartType || /\bby\b/.test(q))) field = matchedValues[0]?.field || this.context.fields[0];
        if (/\bcompare|comparison|versus|\bvs\b/.test(q) && matchedValues.length) field = matchedValues[0].field;
        const scope = this.scopeIndices(matchedValues, field);

        if (!measure && /\b(?:how many|count|number of)\b/.test(q)) {
            if (field) return this.grouped(field, undefined, "count", scope, chartType, ranking);
            return { text: `Row count: ${scope.length.toLocaleString()}.`, kpi: { title: "Row count", value: scope.length.toLocaleString() } };
        }
        if (!measure) {
            if (field && matchedValues.length) return this.grouped(field, undefined, "count", scope, chartType, ranking);
            return { text: "I could not identify a measure. Try naming one of the measures loaded into this visual.", suggestions: this.context.measures.slice(0, 6).map((m) => `Show total ${m.name}`) };
        }
        if (field) {
            const requestedGroups = matchedValues.filter((value) => value.field.key === field!.key).map((value) => value.label);
            return this.grouped(field, measure, aggregation, scope, chartType, ranking, requestedGroups, requestedGroups.length > 1);
        }
        const value = this.aggregate(measure, scope, aggregation);
        const formatted = this.formatAggregate(measure, value, aggregation);
        return {
            text: `${this.aggregationLabel(aggregation)} ${measure.name}: ${formatted}.`,
            kpi: { title: `${this.aggregationLabel(aggregation)} ${measure.name}`, value: formatted, subtitle: `${scope.length.toLocaleString()} rows` },
            suggestions: this.context.fields.slice(0, 4).map((f) => `Show ${measure.name} by ${f.name}`)
        };
    }

    private help(): QnaResponse {
        return { text: "Ask about any loaded field or measure. Request a total, comparison, table, chart, trend, top or bottom ranking, or highest and lowest value.", suggestions: ["Show total", "Create a bar chart", "Show top 5", "Compare values"] };
    }

    private resolveMeasures(q: string): QnaMeasure[] {
        const matches = this.context.measures.map((measure) => ({ measure, keys: Array.from(new Set([...measureAliases(measure.name), ...this.configuredAliases(measure.name)])) }))
            .map((item) => ({ ...item, matchedKey: item.keys.filter((key) => (` ${q} `).includes(` ${key} `)).sort((a, b) => b.length - a.length)[0] }))
            .filter((item) => !!item.matchedKey).sort((a, b) => b.matchedKey!.length - a.matchedKey!.length).map((item) => item.measure);
        return matches.length ? Array.from(new Map(matches.map((measure) => [measure.key, measure])).values()) : (this.context.measures.length === 1 ? [this.context.measures[0]] : []);
    }

    private resolveFields(q: string): QnaField[] {
        return this.context.fields.map((field) => ({ field, keys: [norm(field.name), ...this.configuredAliases(field.name)] }))
            .map((item) => ({ ...item, key: item.keys.filter((key) => (` ${q} `).includes(` ${key} `)).sort((a, b) => b.length - a.length)[0] }))
            .filter((item) => !!item.key).sort((a, b) => q.indexOf(a.key!) - q.indexOf(b.key!) || b.key!.length - a.key!.length).map((item) => item.field);
    }

    private resolveValues(q: string): Array<{ field: QnaField; label: string; indices: number[] }> {
        const matches: Array<{ field: QnaField; label: string; indices: number[]; key: string }> = [];
        this.context.fields.forEach((field) => field.uniqueValues.forEach((value) => {
            const key = norm(value.label);
            if (key.length >= 2 && (` ${q} `).includes(` ${key} `)) matches.push({ field, label: value.label, indices: value.indices, key });
        }));
        return matches.sort((a, b) => b.key.length - a.key.length).filter((item, index, all) =>
            all.findIndex((other) => other.field.key === item.field.key && other.label === item.label) === index);
    }

    private resolveExplicitFilters(question: string): { question: string; values: Array<{ field: QnaField; label: string; indices: number[] }> } {
        let remaining = question; const values: Array<{ field: QnaField; label: string; indices: number[] }> = [];
        const fields = this.context.fields.slice().sort((a, b) => b.name.length - a.name.length);
        fields.forEach((field) => {
            const escaped = field.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); const pattern = new RegExp(`(^|[\\s,;])${escaped}\\s*\\(([^()]*)\\)`, "gi");
            remaining = remaining.replace(pattern, (match, prefix: string, content: string) => {
                const requested = String(content || "").split(/\s*(?:,|\|)\s*/).map((item) => item.trim()).filter(Boolean);
                requested.forEach((requestedValue) => { const found = field.uniqueValues.find((item) => norm(item.label) === norm(requestedValue)); values.push({ field, label: found?.label || requestedValue, indices: found?.indices || [] }); });
                return prefix;
            });
        });
        return { question: remaining, values };
    }

    private valueComparison(values: Array<{ field: QnaField; label: string }>): { field: QnaField; labels: string[] } | undefined {
        const groups = new Map<string, { field: QnaField; labels: string[] }>();
        values.forEach((value) => { const group = groups.get(value.field.key) || { field: value.field, labels: [] }; if (!group.labels.includes(value.label)) group.labels.push(value.label); groups.set(value.field.key, group); });
        return Array.from(groups.values()).filter((group) => group.labels.length > 1).sort((a, b) => b.labels.length - a.labels.length)[0];
    }

    private dateValues(): Array<{ index: number; time: number }> { if (this.cachedDateValues) return this.cachedDateValues; const field = this.context.fields.find((item) => /(^|\s)date($|\s)/i.test(item.name)) || this.context.fields.find((item) => /(^|\s)month($|\s)/i.test(item.name)) || this.context.fields.find((item) => /(^|\s)year($|\s)/i.test(item.name)); if (!field) return this.cachedDateValues = []; const values: Array<{ index: number; time: number }> = []; for (let index = 0; index < field.values.length; index++) { const text = String(field.values[index] || "").trim(); const normalized = /^\d{4}-\d{2}$/.test(text) ? `${text}-01` : /^\d{4}$/.test(text) ? `${text}-01-01` : text; const time = new Date(normalized).getTime(); if (Number.isFinite(time)) values.push({ index, time }); } return this.cachedDateValues = values; }
    private baseIndices(): number[] { const selected = this.context.selectedIndices.length ? this.context.selectedIndices : this.allIndices; if (!this.dashboardDateRange) return selected; const range = this.dashboardDateRange; const allowed = new Set<number>(); for (const item of this.dateValues()) if (item.time >= range.start && item.time <= range.end) allowed.add(item.index); return selected.filter((index) => allowed.has(index)); }

    private scopeIndices(values: Array<{ field: QnaField; indices: number[] }>, groupedField?: QnaField): number[] {
        const base = this.baseIndices();
        const filters = values.filter((value) => !groupedField || value.field.key !== groupedField.key);
        if (!filters.length) return base;
        const byField = new Map<string, Set<number>>();
        filters.forEach((value) => {
            const set = byField.get(value.field.key) || new Set<number>();
            value.indices.forEach((index) => set.add(index)); byField.set(value.field.key, set);
        });
        const sets = Array.from(byField.values());
        return base.filter((index) => sets.every((set) => set.has(index)));
    }

    private scopeIndicesExcept(values: Array<{ field: QnaField; indices: number[] }>, excludedFields: Set<string>): number[] {
        const base = this.baseIndices();
        const filters = values.filter((value) => !excludedFields.has(value.field.key)); const byField = new Map<string, Set<number>>();
        filters.forEach((value) => { const set = byField.get(value.field.key) || new Set<number>(); value.indices.forEach((index) => set.add(index)); byField.set(value.field.key, set); });
        const sets = Array.from(byField.values());
        return base.filter((index) => sets.every((set) => set.has(index)));
    }

    private grouped(field: QnaField, measure: QnaMeasure | undefined, aggregation: QnaAggregation, scope: number[], chartType?: QnaChartType, ranking?: { direction: "top" | "bottom"; limit: number }, requestedGroups: string[] = [], _includeTotal = false): QnaResponse {
        const allowed = new Set(scope);
        const requested = new Set(requestedGroups);
        const groups = field.uniqueValues
            .filter((item) => !requested.size || requested.has(item.label))
            .map((item) => ({ label: item.label, indices: item.indices.filter((index) => allowed.has(index)) }))
            .filter((item) => item.indices.length);
        const rows = groups.map((group) => ({ ...group, value: measure ? this.aggregate(measure, group.indices, aggregation) : group.indices.length }));
        rows.sort((a, b) => ranking ? (ranking.direction === "top" ? b.value - a.value : a.value - b.value) : this.compareFieldLabels(field, a.label, b.label));
        const chartLimit = chartType && rows.length > 15 ? 15 : 100;
        if (chartType && !ranking && rows.length > 15) rows.sort((a, b) => b.value - a.value);
        const limited = ranking ? rows.slice(0, ranking.limit) : rows.slice(0, chartLimit);
        const metricName = measure ? `${this.aggregationLabel(aggregation)} ${measure.name}` : "Count";
        const valueLabel = (value: number) => measure ? this.formatAggregate(measure, value, aggregation) : value.toLocaleString();
        const type = chartType || (ranking ? "bar" : undefined);
        const text = `${ranking ? `${ranking.direction === "top" ? "Top" : "Bottom"} ${limited.length}` : metricName} by ${field.name}.`;
        if (type) return { text, chart: { type, title: `${metricName} by ${field.name}`, labels: limited.map((x) => x.label), values: limited.map((x) => x.value), valueLabels: limited.map((x) => valueLabel(x.value)), rowIndices: limited.map((x) => x.indices), totalLabel: valueLabel(limited.reduce((sum, item) => sum + item.value, 0)), valueFormat: measure?.formatString, formatHint: measure?.formatHint } };
        const tableRows = limited.map((x) => [x.label, valueLabel(x.value)]); const rowIndices = limited.map((x) => x.indices);
        if (limited.length) { const totalIndices = requested.size ? Array.from(new Set(groups.flatMap((item) => item.indices))) : scope.slice(); const totalValue = measure ? this.aggregate(measure, totalIndices, aggregation) : totalIndices.length; tableRows.push(["Grand Total", valueLabel(totalValue)]); rowIndices.push(totalIndices); }
        return { text, table: { columns: [field.name, metricName], rows: tableRows, rowIndices } };
    }

    private compareMeasures(measures: QnaMeasure[], aggregation: QnaAggregation, scope: number[], chartType?: QnaChartType): QnaResponse {
        const values = measures.map((measure) => this.aggregate(measure, scope, aggregation));
        const title = `${measures.map((measure) => measure.name).join(" vs ")}`;
        if (chartType) return { text: `${title}.`, chart: { type: chartType, title, labels: measures.map((measure) => measure.name), values, valueLabels: values.map((value, index) => this.formatAggregate(measures[index], value, aggregation)), rowIndices: measures.map(() => scope), valueFormat: measures.length === 1 ? measures[0].formatString : undefined, formatHint: measures.length === 1 ? measures[0].formatHint : undefined } };
        return { text: `${title}.`, table: { columns: ["Measure", this.aggregationLabel(aggregation)], rows: [...measures.map((measure, index) => [measure.name, this.formatAggregate(measure, values[index], aggregation)]), ["Grand Total", values.reduce((sum, value) => sum + value, 0).toLocaleString()]], rowIndices: [...measures.map(() => scope), scope] } };
    }

    private groupedMeasures(field: QnaField, measures: QnaMeasure[], aggregation: QnaAggregation, scope: number[], chartType?: QnaChartType, requestedGroups: string[] = []): QnaResponse {
        const allowed = new Set(scope); const requested = new Set(requestedGroups); let groups = field.uniqueValues.filter((item) => !requested.size || requested.has(item.label)).map((item) => ({ label: item.label, indices: item.indices.filter((index) => allowed.has(index)) })).filter((item) => item.indices.length);
        if (chartType && groups.length > 15) groups = groups.sort((a, b) => this.aggregate(measures[0], b.indices, aggregation) - this.aggregate(measures[0], a.indices, aggregation)).slice(0, 15); else groups = groups.slice(0, 30);
        const series = measures.map((measure) => { const values = groups.map((group) => this.aggregate(measure, group.indices, aggregation)); return { name: measure.name, values, valueLabels: values.map((value) => this.formatAggregate(measure, value, aggregation)) }; });
        const title = `${measures.map((measure) => measure.name).join(" vs ")} by ${field.name}`;
        if (chartType) return { text: `${title}.`, chart: { type: chartType, title, axisTitle: field.name, labels: groups.map((group) => group.label), values: series[0].values, valueLabels: series[0].valueLabels, rowIndices: groups.map((group) => group.indices), series, totalLabel: measures.length === 1 ? this.formatAggregate(measures[0], series[0].values.reduce((sum, value) => sum + value, 0), aggregation) : undefined, valueFormat: measures.length === 1 ? measures[0].formatString : undefined, formatHint: measures.length === 1 ? measures[0].formatHint : undefined } };
        const rows = groups.map((group, groupIndex) => [group.label, ...series.map((item) => item.valueLabels[groupIndex])]); const rowIndices = groups.map((group) => group.indices);
        if (groups.length) { const totalIndices = requested.size ? Array.from(new Set(groups.flatMap((group) => group.indices))) : scope.slice(); rows.push(["Grand Total", ...measures.map((measure) => this.formatAggregate(measure, this.aggregate(measure, totalIndices, aggregation), aggregation))]); rowIndices.push(totalIndices); }
        return { text: `${title}.`, table: { columns: [field.name, ...measures.map((measure) => measure.name)], rows, rowIndices } };
    }

    private groupedByFields(fields: QnaField[], measures: QnaMeasure[], aggregation: QnaAggregation, scope: number[], chartType?: QnaChartType, ranking?: { direction: "top" | "bottom"; limit: number }): QnaResponse {
        const groups = new Map<string, { labels: string[]; indices: number[] }>();
        scope.forEach((index) => { const labels = fields.map((field) => field.values[index] || "(Blank)"); const key = JSON.stringify(labels); const group = groups.get(key) || { labels, indices: [] }; group.indices.push(index); groups.set(key, group); });
        let rows = Array.from(groups.values()).map((group) => ({ ...group, values: measures.map((measure) => this.aggregate(measure, group.indices, aggregation)) }));
        if (ranking) rows.sort((a, b) => ranking.direction === "top" ? b.values[0] - a.values[0] : a.values[0] - b.values[0]);
        else rows.sort((a, b) => { for (let index = 0; index < fields.length; index++) { const result = this.compareFieldLabels(fields[index], a.labels[index], b.labels[index]); if (result) return result; } return 0; });
        const pivotChart = !!chartType && !ranking && fields.length === 2 && measures.length === 1;
        if (chartType && !ranking && !pivotChart && rows.length > 15) rows.sort((a, b) => b.values[0] - a.values[0]);
        rows = rows.slice(0, ranking?.limit || (chartType && !pivotChart ? 15 : 100));
        const title = `${measures.map((measure) => measure.name).join(" vs ")} by ${fields.map((field) => field.name).join(" and ")}`;
        const rowIndices = rows.map((row) => row.indices); const labels = rows.map((row) => row.labels.join(" · "));
        if (chartType) {
            if (!ranking && fields.length === 2 && measures.length === 1) {
                const temporalIndex = fields.findIndex((field) => /\b(?:year|quarter|month|week|date|day)\b/i.test(field.name));
                const axisIndex = temporalIndex >= 0 ? temporalIndex : 1;
                const seriesIndex = axisIndex === 0 ? 1 : 0;
                const axisLabels = Array.from(new Set(rows.map((row) => row.labels[axisIndex]))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
                const seriesLabels = Array.from(new Set(rows.map((row) => row.labels[seriesIndex]))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
                const measure = measures[0];
                const pivotSeries = seriesLabels.map((seriesLabel) => {
                    const values = axisLabels.map((axisLabel) => rows.find((row) => row.labels[axisIndex] === axisLabel && row.labels[seriesIndex] === seriesLabel)?.values[0] || 0);
                    return { name: seriesLabel, values, valueLabels: values.map((value) => this.formatAggregate(measure, value, aggregation)) };
                });
                const pivotRowIndices = axisLabels.map((axisLabel) => Array.from(new Set(rows.filter((row) => row.labels[axisIndex] === axisLabel).flatMap((row) => row.indices))));
                return { text: `${title}.`, chart: { type: chartType, title, axisTitle: fields[axisIndex].name, labels: axisLabels, values: pivotSeries[0]?.values || [], valueLabels: pivotSeries[0]?.valueLabels || [], rowIndices: pivotRowIndices, series: pivotSeries, totalLabel: this.formatAggregate(measure, rows.reduce((sum, row) => sum + row.values[0], 0), aggregation), valueFormat: measure.formatString, formatHint: measure.formatHint } };
            }
            const series = measures.length > 1 ? measures.map((measure, measureIndex) => ({ name: measure.name, values: rows.map((row) => row.values[measureIndex]), valueLabels: rows.map((row) => this.formatAggregate(measure, row.values[measureIndex], aggregation)) })) : undefined;
            return { text: `${title}.`, chart: { type: chartType, title, axisTitle: fields.map((field) => field.name).join(" · "), labels, values: rows.map((row) => row.values[0]), valueLabels: rows.map((row) => this.formatAggregate(measures[0], row.values[0], aggregation)), rowIndices, series, totalLabel: measures.length === 1 ? this.formatAggregate(measures[0], rows.reduce((sum, row) => sum + row.values[0], 0), aggregation) : undefined, valueFormat: measures.length === 1 ? measures[0].formatString : undefined, formatHint: measures.length === 1 ? measures[0].formatHint : undefined } };
        }
        const tableRows = rows.map((row) => [...row.labels, ...row.values.map((value, index) => this.formatAggregate(measures[index], value, aggregation))]);
        if (rows.length) { const totalIndices = scope.slice(); tableRows.push([...fields.map((_, index) => index === 0 ? "Grand Total" : ""), ...measures.map((measure) => this.formatAggregate(measure, this.aggregate(measure, totalIndices, aggregation), aggregation))]); rowIndices.push(totalIndices); }
        return { text: `${title}.`, table: { columns: [...fields.map((field) => field.name), ...measures.map((measure) => measure.name)], rows: tableRows, rowIndices } };
    }

    configuredAnswer(mode: "table" | "matrix", rowNames: string[], columnNames: string[], measureNames: string[], filters: Array<{ field: QnaField; indices: number[] }> = []): QnaResponse {
        const fieldByName = (name: string) => this.context.fields.find((field) => norm(field.name) === norm(name)); const measureByName = (name: string) => this.context.measures.find((measure) => norm(measure.name) === norm(name));
        let rows = rowNames.map(fieldByName).filter((item): item is QnaField => !!item); const columns = columnNames.map(fieldByName).filter((item): item is QnaField => !!item); const measures = measureNames.map(measureByName).filter((item): item is QnaMeasure => !!item); const scope = this.scopeIndices(filters);
        if (!rows.length || !measures.length) return { text: "Choose at least one row field and one measure." };
        if (mode === "matrix") { if (this.layoutSettings.cardinalityLowToHighHierarchy) rows = this.orderFieldsByCardinality(rows, scope); return this.hierarchyMatrix(rows, columns, measures, "sum", scope); }
        return this.groupedByFields([...rows, ...columns], measures, "sum", scope);
    }

    private structuredConfiguration(question: string): { mode: "table" | "matrix"; rows: string[]; columns: string[]; measures: string[] } | null {
        const modeMatch = question.match(/^\s*(table|matrix)\s*;/i); if (!modeMatch) return null; const section = (name: string) => question.match(new RegExp(`${name}\\s*:\\s*([^;]*)`, "i"))?.[1].split(/\s*>\s*|\s*,\s*/).map((item) => item.trim()).filter(Boolean) || [];
        return { mode: modeMatch[1].toLowerCase() as "table" | "matrix", rows: section("rows"), columns: section("columns"), measures: section("values") };
    }

    private fieldCardinality(field: QnaField, scope: number[]): number { const allowed = new Set(scope); return field.uniqueValues.filter((item) => item.indices.some((index) => allowed.has(index))).length; }
    private compareFieldLabels(field: QnaField, a: string, b: string): number { if (/\bmonth\b/i.test(field.name)) { const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]; const monthRank = (value: string) => { const normalized = value.trim().toLowerCase(); const direct = months.findIndex((month) => month === normalized || month.startsWith(normalized.slice(0, 3))); if (direct >= 0) return direct; const numeric = normalized.match(/(?:^|\D)(1[0-2]|0?[1-9])(?:\D|$)/); return numeric ? Number(numeric[1]) - 1 : 99; }; const rank = monthRank(a) - monthRank(b); if (rank) return rank; } if (/\bquarter\b/i.test(field.name)) { const quarter = (value: string) => Number(value.match(/[1-4]/)?.[0] || 99); const rank = quarter(a) - quarter(b); if (rank) return rank; } return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }); }
    private orderFieldsByCardinality(fields: QnaField[], scope: number[]): QnaField[] { return this.layoutSettings.cardinalityLowToHighHierarchy ? fields.slice().sort((a, b) => this.fieldCardinality(a, scope) - this.fieldCardinality(b, scope) || a.name.localeCompare(b.name)) : fields; }
    private shouldUseMatrix(fields: QnaField[], scope: number[]): boolean { if (!this.layoutSettings.cardinalityFallbackEnabled || fields.length < 2) return false; const counts = fields.map((field) => this.fieldCardinality(field, scope)).filter(Boolean); if (counts.length < 2) return false; const highest = Math.max(...counts); const threshold = highest * Math.max(1, Math.min(100, this.layoutSettings.cardinalityMatrixThresholdPct)) / 100; return counts.some((count) => count < highest && count <= threshold); }

    private hierarchyMatrix(rowFields: QnaField[], columnFields: QnaField[], measures: QnaMeasure[], aggregation: QnaAggregation, scope: number[], contextLabel = ""): QnaResponse {
        const maxColumns = Math.max(0, this.layoutSettings.cardinalityMaxColumnValues); const temporalColumns = columnFields.some((field) => /\b(?:year|quarter|month|week|date|day)\b/i.test(field.name)); const columnLimit = temporalColumns ? Math.max(12, maxColumns) : maxColumns; const columnMap = new Map<string, { labels: string[]; label: string; indices: number[] }>(); if (columnFields.length) scope.forEach((index) => { const labels = columnFields.map((field) => field.values[index] || "(Blank)"); const key = JSON.stringify(labels); const group = columnMap.get(key) || { labels, label: labels.join(" > "), indices: [] }; group.indices.push(index); columnMap.set(key, group); }); const columnGroups = Array.from(columnMap.values()).sort((a, b) => { for (let index = 0; index < columnFields.length; index++) { const result = this.compareFieldLabels(columnFields[index], a.labels[index], b.labels[index]); if (result) return result; } return 0; }).slice(0, columnLimit || undefined);
        type Group = { key: string; label: string; indices: number[]; level: number; parentKey?: string; hasChildren: boolean }; const groups: Group[] = []; const walk = (indices: number[], level: number, parentKey?: string) => { const field = rowFields[level]; if (!field) return; const indexSet = new Set(indices); field.uniqueValues.map((item) => ({ label: item.label, indices: item.indices.filter((index) => indexSet.has(index)) })).filter((item) => item.indices.length).sort((a, b) => this.compareFieldLabels(field, a.label, b.label)).slice(0, 100).forEach((item) => { const key = `${parentKey || "root"}>${level}:${item.label}`; const hasChildren = level < rowFields.length - 1; groups.push({ key, label: item.label, indices: item.indices, level, parentKey, hasChildren }); if (hasChildren) walk(item.indices, level + 1, key); }); }; walk(scope, 0);
        const matrixTotalColumns = columnGroups.length ? measures.map((measure) => measures.length === 1 ? "Total" : `${measure.name} Total`) : []; const valueColumns = columnGroups.length ? [...columnGroups.flatMap((column) => measures.map((measure) => measures.length === 1 ? column.label : `${column.label} · ${measure.name}`)), ...matrixTotalColumns] : measures.map((measure) => contextLabel ? `${measure.name} · ${contextLabel}` : measure.name); const intersections = groups.map((group) => { const groupSet = new Set(group.indices); return columnGroups.map((column) => column.indices.filter((index) => groupSet.has(index))); }); const rows = groups.map((group, groupIndex) => { const values = columnGroups.length ? [...columnGroups.flatMap((_, columnIndex) => measures.map((measure) => this.formatAggregate(measure, this.aggregate(measure, intersections[groupIndex][columnIndex], aggregation), aggregation))), ...measures.map((measure) => this.formatAggregate(measure, this.aggregate(measure, group.indices, aggregation), aggregation))] : measures.map((measure) => this.formatAggregate(measure, this.aggregate(measure, group.indices, aggregation), aggregation)); return [group.label, ...values]; });
        const totalValues = columnGroups.length ? [...columnGroups.flatMap((column) => measures.map((measure) => this.formatAggregate(measure, this.aggregate(measure, column.indices, aggregation), aggregation))), ...measures.map((measure) => this.formatAggregate(measure, this.aggregate(measure, scope, aggregation), aggregation))] : measures.map((measure) => this.formatAggregate(measure, this.aggregate(measure, scope, aggregation), aggregation)); rows.push(["Grand Total", ...totalValues]); const rowIndices = [...groups.map((group) => group.indices), scope]; const cellIndices = groups.map((group, groupIndex) => [group.indices, ...(columnGroups.length ? [...intersections[groupIndex].flatMap((indices) => measures.map(() => indices)), ...measures.map(() => group.indices)] : measures.map(() => group.indices))]); cellIndices.push([scope, ...(columnGroups.length ? [...columnGroups.flatMap((column) => measures.map(() => column.indices)), ...measures.map(() => scope)] : measures.map(() => scope))]); const rowSelectionFields = rowFields.map((field) => field.name); const selectionFieldsByColumn = [rowSelectionFields, ...(columnGroups.length ? [...columnGroups.flatMap(() => measures.map(() => [...rowSelectionFields, ...columnFields.map((field) => field.name)])), ...measures.map(() => rowSelectionFields)] : measures.map(() => rowSelectionFields))]; const columnTitle = columnFields.length ? ` with columns ${columnFields.map((field) => field.name).join(" > ")}` : ""; const contextTitle = contextLabel ? ` for ${contextLabel}` : ""; const title = `${measures.map((measure) => measure.name).join(" vs ")} matrix by ${rowFields.map((field) => field.name).join(" > ")}${columnTitle}${contextTitle}`; return { text: `${title}.`, table: { columns: [rowFields.map((field) => field.name).join(" > "), ...valueColumns], rows, rowIndices, cellIndices, selectionFieldsByColumn, matrix: { levels: [...groups.map((group) => group.level), 0], keys: [...groups.map((group) => group.key), "grand-total"], parentKeys: [...groups.map((group) => group.parentKey), undefined], hasChildren: [...groups.map((group) => group.hasChildren), false], rowHeader: rowFields.map((field) => field.name).join(" > ") } } };
    }

    private matrixByFields(rowFields: QnaField[], columnField: QnaField, measures: QnaMeasure[], aggregation: QnaAggregation, scope: number[]): QnaResponse {
        const allowed = new Set(scope); const columnGroups = columnField.uniqueValues.map((item) => ({ ...item, indices: item.indices.filter((index) => allowed.has(index)) })).filter((item) => item.indices.length).slice(0, 12);
        const rows = new Map<string, { labels: string[]; indices: number[] }>(); scope.forEach((index) => { const labels = rowFields.map((field) => field.values[index] || "(Blank)"); const key = JSON.stringify(labels); const row = rows.get(key) || { labels, indices: [] }; row.indices.push(index); rows.set(key, row); }); const matrixRows = Array.from(rows.values()).sort((a, b) => { for (let index = 0; index < rowFields.length; index++) { const result = this.compareFieldLabels(rowFields[index], a.labels[index], b.labels[index]); if (result) return result; } return 0; }).slice(0, 100).map((row) => { const rowSet = new Set(row.indices); return { ...row, intersections: columnGroups.map((column) => column.indices.filter((index) => rowSet.has(index))) }; });
        const columns = [...rowFields.map((field) => field.name), ...columnGroups.flatMap((column) => measures.map((measure) => measures.length === 1 ? column.label : `${column.label} · ${measure.name}`)), "Total"];
        const tableRows = matrixRows.map((row) => { const cells = row.intersections.flatMap((indices) => measures.map((measure) => this.formatAggregate(measure, this.aggregate(measure, indices, aggregation), aggregation))); const total = this.formatAggregate(measures[0], this.aggregate(measures[0], row.indices, aggregation), aggregation); return [...row.labels, ...cells, total]; });
        const rowIndices = matrixRows.map((row) => row.indices); const totalIndices = scope.slice(); if (matrixRows.length) { tableRows.push([...rowFields.map((_, index) => index === 0 ? "Grand Total" : ""), ...columnGroups.flatMap((column) => measures.map((measure) => this.formatAggregate(measure, this.aggregate(measure, column.indices, aggregation), aggregation))), this.formatAggregate(measures[0], this.aggregate(measures[0], totalIndices, aggregation), aggregation)]); rowIndices.push(totalIndices); }
        const cellIndices = matrixRows.map((row) => [...rowFields.map(() => row.indices), ...row.intersections.flatMap((indices) => measures.map(() => indices)), row.indices]); if (matrixRows.length) cellIndices.push([...rowFields.map(() => totalIndices), ...columnGroups.flatMap((column) => measures.map(() => column.indices)), totalIndices]); const rowSelectionFields = rowFields.map((field) => field.name); const selectionFieldsByColumn = [...rowFields.map(() => rowSelectionFields), ...columnGroups.flatMap(() => measures.map(() => [...rowSelectionFields, columnField.name])), rowSelectionFields]; const title = `${measures.map((measure) => measure.name).join(" vs ")} matrix by ${rowFields.map((field) => field.name).join(" and ")} and ${columnField.name}`; return { text: `${title}.`, table: { columns, rows: tableRows, rowIndices, cellIndices, selectionFieldsByColumn } };
    }

    private aggregate(measure: QnaMeasure, indices: number[], aggregation: QnaAggregation): number {
        if (aggregation === "sum" && measure.modelTotal !== undefined && indices.length === this.context.rowCount && indices.every((value, index) => value === index)) return measure.modelTotal;
        let count = 0; let sum = 0; let min = Infinity; let max = -Infinity;
        const distinct = aggregation === "distinctCount" ? new Set<number>() : undefined;
        for (const index of indices) {
            const value = measure.values[index];
            if (value === null || !Number.isFinite(value)) continue;
            count++; sum += value;
            if (value < min) min = value;
            if (value > max) max = value;
            distinct?.add(value);
        }
        if (!count) return 0;
        if (aggregation === "average") return sum / count;
        if (aggregation === "min") return min;
        if (aggregation === "max") return max;
        if (aggregation === "count") return count;
        if (aggregation === "distinctCount") return distinct!.size;
        return sum;
    }

    private resolveAggregation(q: string): QnaAggregation {
        if (/\bdistinct count|unique count\b/.test(q)) return "distinctCount";
        if (/\baverage|avg|mean\b/.test(q)) return "average";
        if (/\bminimum|min\b/.test(q)) return "min";
        if (/\bmaximum|max\b/.test(q)) return "max";
        if (/\b(?:count|how many|number of)\b/.test(q)) return "count";
        return "sum";
    }

    private resolveChartType(q: string): QnaChartType | undefined {
        if (/\bheat\s*map\b/.test(q)) return "heatmap";
        if (/\bsmall\s+multiples?\b/.test(q)) return "smallMultiples";
        if (/\bkpi\s+trend|trend\s+card\b/.test(q)) return "kpiTrend";
        if (/\bsparklines?\b/.test(q)) return "sparkline";
        if (/\bstacked\s+(?:bar|graph)\b/.test(q)) return "stackedBar";
        if (/\bstacked\s+column\b/.test(q)) return "stackedColumn";
        if (/\bcombo|column(?:s)?\s+and\s+line|line\s+and\s+column/.test(q)) return "combo";
        if (/\bwaterfall|variance\s+(?:chart|graph)|change contribution\b/.test(q)) return "waterfall";
        if (/\bscatter|bubble|correlation|relationship between\b/.test(q)) return "scatter";
        if (/\btreemap|tree map|share of\b/.test(q)) return "treemap";
        if (/\bfunnel\b/.test(q)) return "funnel";
        if (/\bgauge|against target|progress to target\b/.test(q)) return "gauge";
        if (/\bbullet\b/.test(q)) return "bullet";
        if (/\bdonut|doughnut\b/.test(q)) return "donut";
        if (/\bpie\b/.test(q)) return "pie";
        if (/\bline|trend|over time\b/.test(q)) return "line";
        if (/\barea chart|area graph\b/.test(q)) return "area";
        if (/\bcolumn\b/.test(q)) return "column";
        if (/\bbar|chart|graph|visual\b/.test(q)) return "bar";
        return undefined;
    }

    private resolveRanking(q: string): { direction: "top" | "bottom"; limit: number } | undefined {
        const top = /\btop|highest|largest|best|most\b/.test(q);
        const bottom = /\bbottom|lowest|smallest|worst|least\b/.test(q);
        if (!top && !bottom) return undefined;
        const match = q.match(/\b(?:top|bottom)\s+(\d{1,3})\b/);
        return { direction: bottom ? "bottom" : "top", limit: Math.min(100, Math.max(1, Number(match?.[1]) || 5)) };
    }

    private aggregationLabel(aggregation: QnaAggregation): string {
        return ({ sum: "Total", average: "Average", min: "Minimum", max: "Maximum", count: "Count", distinctCount: "Distinct count" })[aggregation];
    }

    private formatAggregate(measure: QnaMeasure, value: number, aggregation: QnaAggregation): string {
        return aggregation === "count" || aggregation === "distinctCount" ? Math.round(value).toLocaleString() : this.context.formatValue(measure, value);
    }
}
