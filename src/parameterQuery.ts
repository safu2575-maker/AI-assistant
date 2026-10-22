import { QnaChartType } from "./qna/types";
import { timeFieldOrder } from "./qna/timeLayout";
import { TimeSetup, monthIndexValues, normalizeMonthPeriods } from "./timeSetup";
import { AdvancedFilter, BasicFilter, IFilter, TupleFilter } from "powerbi-models";

export interface ModelField {
    name: string;
    table: string;
    column: string;
    type?: "text" | "number" | "date";
    aliases?: string[];
    values?: string[];
}
export interface ParameterConfig {
    analysis?: import("./analysisTemplates").AnalysisSettings;
    table: string;
    column: string;
    options: string[];
    fields: ModelField[];
    enabled: boolean;
    autoDetected?: boolean;
    directMeasures?: string[];
    measureParameter?: { table: string; column: string; options: string[] };
    groupAliases?: Record<string, string[]>;
    defaultMeasure?: string;
    additiveMeasures?: string[];
    revenue?: { field: string; value: string; childFields?: string[] };
    revenuePercentage?: boolean;
    time?: TimeSetup;
}
export interface ParameterPlan {
    groups: string[];
    measures: string[];
    filters: IFilter[];
    summary: string[];
    presentation?: "table" | "matrix" | QnaChartType;
    rank?: { count: number; ascending: boolean };
    matrixRowCount?: number;
    totalOnly?: boolean;
    listOnly?: boolean;
}
export const normalizeParameterName = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();
const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const phrase = (value: string): RegExp => new RegExp(`(?<![\\w])${escape(value)}(?![\\w])`, "i");
const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const iso = (date: Date): string => date.toISOString().slice(0, 10);
function date(value: string): Date {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || iso(parsed) !== value) throw new Error(`Invalid date: ${value}. Use YYYY-MM-DD.`);
    return parsed;
}

export function validateParameterConfig(config: ParameterConfig): void {
    if (!config || typeof config.table !== "string" || typeof config.column !== "string" || !config.table.trim() || !config.column.trim() || !Array.isArray(config.options) || !config.options.length || config.options.some(option => typeof option !== "string") || !Array.isArray(config.fields)) throw new Error("Enter the parameter table, label column, grouping options and field mappings.");
    const labels = config.options.map(normalizeParameterName);
    if (labels.some(label => !label) || new Set(labels).size !== labels.length) throw new Error("Grouping options must be unique and nonempty.");
    if (config.measureParameter) {
        const measure = config.measureParameter;
        if (!measure.table?.trim() || !measure.column?.trim() || !Array.isArray(measure.options) || !measure.options.length || measure.options.some(name => typeof name !== "string" || !name.trim()) || new Set(measure.options).size !== measure.options.length) throw new Error("Measure parameter needs a table, label column and unique measure labels.");
        if (measure.table === config.table) throw new Error("Use a separate parameter table for measures and grouping fields.");
    }
    const aliases = new Set<string>();
    for (const field of config.fields) {
        if (!field || typeof field.name !== "string" || !field.name.trim() || typeof field.table !== "string" || !field.table.trim() || typeof field.column !== "string" || !field.column.trim()) throw new Error("Each mapped field needs a name, table and column.");
        if (field.type && !["text", "number", "date"].includes(field.type)) throw new Error(`Invalid type for ${field.name}.`);
        for (const entries of [field.aliases, field.values]) if (entries && (!Array.isArray(entries) || entries.some(value => typeof value !== "string" || !value.trim()))) throw new Error(`Invalid aliases or values for ${field.name}.`);
        for (const alias of new Set([field.name, ...(field.aliases || [])].map(normalizeParameterName))) {
            if (aliases.has(alias)) throw new Error(`Ambiguous field alias: ${alias}.`);
            aliases.add(alias);
        }
    }
    if (config.time) {
        for (const key of ["dateField", "yearField", "monthField", "monthIndexField"] as const) {
            const name = config.time[key];
            if (name && !config.fields.some(field => field.name === name)) throw new Error(`Time setup: map ${name} before selecting it.`);
        }
        if (config.time.dateField && config.fields.find(field => field.name === config.time!.dateField)?.type !== "date") throw new Error("Time setup: the calendar date field must have type date.");
        if (config.time.monthIndexField && config.fields.find(field => field.name === config.time!.monthIndexField)?.type !== "number") throw new Error("Time setup: MonthIndex must be numeric.");
        if (config.time.numericOrder && !["auto", "month-year", "year-month"].includes(config.time.numericOrder)) throw new Error("Invalid numeric month/year order.");
        if (config.time.monthIndexBase !== undefined && ![0, 1].includes(config.time.monthIndexBase)) throw new Error("MonthIndex base must be 0 or 1.");
        const start = config.time.twoDigitYearStart;
        if (start !== undefined && (!Number.isInteger(start) || start < 1900 || start > 9899)) throw new Error("The two-digit year window must start between 1900 and 9899.");
    }
    if (!config.time?.dateField && config.fields.filter(field => field.type === "date").length > 1) throw new Error("Select the calendar date field in Time setup when multiple date fields are mapped.");
}

/** Conservative grammar: unrecognized text fails instead of broadening a query. */
export function planParameterQuestion(question: string, config: ParameterConfig, availableMeasures: string[]): ParameterPlan {
    validateParameterConfig(config);
    let text = normalizeMonthPeriods(question, config.time, [...availableMeasures, ...config.fields.flatMap(field => [field.name, ...(field.aliases || []), ...(field.type !== "date" ? field.values || [] : [])])]).trim().replace(/[.!?]+$/, "");
    const scopeMatch = /;\s*modelScope:\s*(\S+)\s*$/i.exec(text);
    const scope: { start: string; end: string } | undefined = scopeMatch ? JSON.parse(decodeURIComponent(scopeMatch[1])) : undefined;
    if (scopeMatch) text = text.slice(0, scopeMatch.index);
    const encodedFilters = /;\s*answerFilters:\s*(.*)$/i.exec(text);
    let editorFilters: Array<{ field: string; values: string[] }> = [];
    if (encodedFilters) {
        editorFilters = JSON.parse(decodeURIComponent(encodedFilters[1]));
        if (!Array.isArray(editorFilters) || editorFilters.some(item => typeof item.field !== "string" || !Array.isArray(item.values) || item.values.some(value => typeof value !== "string"))) throw new Error("Invalid editor filters.");
        text = text.slice(0, encodedFilters.index);
    }
    const editor = /^(Table|Matrix);\s*rows:\s*([^;]*);\s*columns:\s*([^;]*);\s*values:\s*([^;]*)$/i.exec(text);
    if (editor) text = `${editor[2]} ${editor[3]} ${editor[4]} as a ${editor[1].toLowerCase()}`;
    const plan: ParameterPlan = { groups: [], measures: [], filters: [], summary: [] };
    // Tolerate repeated presentation connectors without dropping arbitrary words
    // or interpreting presentation phrases inside explicit filter values.
    const presentationText = text.replace(/"[^"]*"|\[[^\]]*\]|\([^)]*\)/g, value => " ".repeat(value.length)).replace(/\b(?:where|with)\s+[\s\S]*$/i, value => " ".repeat(value.length));
    const presentation = /\b(?:(?:as|in)\s+(?:an?\s+)?)+(list|table|matrix|stacked bar|stacked column|small multiples|kpi trend|bar|column|line|area|pie|donut|combo|waterfall|scatter|treemap|funnel|gauge|bullet|heatmap|sparkline)(?:\s+(?:chart|graph))?\b/i.exec(presentationText);
    if (presentation) { const name = presentation[1].toLowerCase(); const special: Record<string, QnaChartType> = { "stacked bar": "stackedBar", "stacked column": "stackedColumn", "small multiples": "smallMultiples", "kpi trend": "kpiTrend" }; plan.presentation = name === "list" ? "table" : special[name] || name as ParameterPlan["presentation"]; text = text.slice(0, presentation.index) + " " + text.slice(presentation.index + presentation[0].length); }
    const rank = /\b(top|bottom)\s+(\d+)\b/i.exec(text);
    if (rank) { const count = Number(rank[2]); if (count < 1 || count > 1000) throw new Error("Choose between 1 and 1000 results."); plan.rank = { count, ascending: rank[1].toLowerCase() === "bottom" }; text = text.replace(rank[0], " "); }
    const fieldFor = (name: string): ModelField | undefined => {
        const canonical = config.fields.find(field => normalizeParameterName(field.name) === normalizeParameterName(name));
        if (canonical) return canonical;
        const matches = config.fields.filter(field => [...(field.aliases || []), ...(config.groupAliases?.[field.name] || [])].some(alias => normalizeParameterName(alias) === normalizeParameterName(name)));
        if (matches.length > 1) throw new Error(`Ambiguous synonym ${name}; use the full field name.`);
        return matches[0];
    };
    const calendarField = config.time?.dateField ? fieldFor(config.time.dateField) : config.fields.find(field => field.type === "date");
    const indexField = config.time?.monthIndexField ? fieldFor(config.time.monthIndexField) : undefined;
    const yearField = fieldFor(config.time?.yearField || "Year"), monthField = fieldFor(config.time?.monthField || "Month");
    const addValues = (field: ModelField, values: string[]) => {
        if (field.type === "date") throw new Error("Use a date range for the calendar field.");
        const typed = values.map(value => {
            if (field.type !== "number") return value;
            if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error(`${field.name} needs a numeric value.`);
            return Number(value);
        });
        if (plan.filters.some(filter => JSON.stringify(filter.target) === JSON.stringify({ table: field.table, column: field.column }))) throw new Error(`Specify ${field.name} once; use | between alternative values.`);
        plan.filters.push(new BasicFilter({ table: field.table, column: field.column }, "In", typed).toJSON());
        plan.summary.push(`${field.name}: ${values.join(" or ")}`);
    };
    for (const item of editorFilters) {
        const field = fieldFor(item.field);
        if (!field) throw new Error(`Configure the model mapping for ${item.field}.`);
        if (item.values.length) addValues(field, item.values);
    }
    // Explicit filters are intentionally independent of currently loaded values.
    const where = text.match(/\b(?:where|with)\s+(.+)$/i);
    if (where) {
        text = text.slice(0, where.index).trim();
        const clauses = where[1].split(/;|\s+and\s+(?=[^=;]+\s*=)/i);
        for (const clause of clauses) {
            const parts = clause.match(/^\s*(.+?)\s*=\s*(.+?)\s*$/);
            if (!parts) throw new Error("Use filters such as where Tenant = Home Living; City = Riyadh.");
            const field = fieldFor(parts[1]);
            if (!field) throw new Error(`Configure the model mapping for ${parts[1]}.`);
            const values = parts[2].split("|").map(value => value.trim().replace(/^"(.*)"$/, "$1"));
            if (values.some(value => !value)) throw new Error("Filter values cannot be empty.");
            addValues(field, values);
        }
    }
    const measureMatches: Array<{name: string; position: number}> = [];
    for (const measure of [...availableMeasures].sort((a, b) => b.length - a.length)) {
        const match = phrase(measure).exec(text);
        if (match) { measureMatches.push({name: measure, position: match.index}); text = text.slice(0,match.index) + " ".repeat(match[0].length) + text.slice(match.index + match[0].length); }
    }
    const measureAliases = availableMeasures.flatMap(name => (config.groupAliases?.[name] || []).filter(alias => alias.trim()).map(alias => ({name, alias}))).sort((a,b) => b.alias.length - a.alias.length);
    for (const {name, alias} of measureAliases) {
        const aliasText = text.replace(/"[^"]*"|\([^)]*\)|\[[^\]]*\]/g, value => " ".repeat(value.length));
        const match = phrase(alias).exec(aliasText); if (!match) continue;
        const owners = new Set(measureAliases.filter(item => normalizeParameterName(item.alias) === normalizeParameterName(alias)).map(item => item.name));
        const fieldCollision = config.fields.some(field => [field.name, ...(field.aliases || []), ...(config.groupAliases?.[field.name] || [])].some(value => normalizeParameterName(value) === normalizeParameterName(alias)));
        if (owners.size > 1 || fieldCollision) throw new Error(`Ambiguous synonym ${alias}; use the full field or measure name.`);
        measureMatches.push({name, position: match.index}); text = text.slice(0,match.index) + " ".repeat(match[0].length) + text.slice(match.index + match[0].length);
    }
    plan.measures = [...new Set(measureMatches.sort((a,b) => a.position - b.position).map(item => item.name))];
    if (!plan.measures.length && config.defaultMeasure && !editor && !/\blist\b/i.test(question)) {
        if (!availableMeasures.includes(config.defaultMeasure)) throw new Error("The default measure is no longer available. Choose another default in Preferences or name a measure.");
        plan.measures = [config.defaultMeasure];
    }
    if (!plan.measures.length && /\b(total|sum|average|count|top|bottom)\b/i.test(question)) {
        if (availableMeasures.length !== 1) throw new Error("Name the measure to calculate.");
        plan.measures = availableMeasures.slice();
    }
    plan.listOnly = plan.measures.length === 0;
    // Autocomplete's established syntax: Field (Value).
    for (const field of [...config.fields].sort((a, b) => b.name.length - a.name.length)) {
        const match = new RegExp(`(?:${[field.name, ...(field.aliases || [])].sort((a,b) => b.length-a.length).map(escape).join("|")})\\s*\\(([^)]+)\\)`, "i").exec(text);
        if (match) { const values = match[1].split("|").map(value => value.trim()); if (values.some(value => !value)) throw new Error("Filter values cannot be empty."); addValues(field, values); text = text.replace(match[0], field.name); }
    }
    const period = /\b(ttm|trailing 12 months|ytd|year to date)\b/i.exec(text);
    if (period) text = text.replace(period[0], " ");
    let start: Date | undefined, end: Date | undefined;
    const range = /\b(?:from|between)\s+(\d{4}-\d{2}-\d{2})\s+(?:to|and)\s+(\d{4}-\d{2}-\d{2})\b/i.exec(text);
    const month = new RegExp(`\\b(${monthNames.join("|")})\\s+(\\d{4})\\b`, "i").exec(text);
    if (range) {
        if (period) throw new Error("Use either an explicit range or an anchored YTD/TTM period.");
        start = date(range[1]); end = date(range[2]);
        if (end < start) throw new Error("The end date must not precede the start date.");
        end.setUTCDate(end.getUTCDate() + 1); text = text.replace(range[0], " ");
    } else if (month) {
        if (period && !indexField) throw new Error("Select a numeric MonthIndex column in Time intelligence settings to use YTD or TTM.");
        const year = Number(month[2]), index = monthNames.findIndex(value => value.toLowerCase() === month[1].toLowerCase());
        if (year < 1900 || year > 9998) throw new Error("Choose a year between 1900 and 9998.");
        end = new Date(Date.UTC(year, index + 1, 1));
        start = new Date(Date.UTC(year, period && /ttm|trailing/i.test(period[0]) ? index - 11 : period ? 0 : index, 1));
        // Consume "of" only when it directly introduces a recognized period.
        // Do not globally erase it from business names or calculation phrases.
        const beforeMonth = text.slice(0, month.index).replace(/\bof\s*$/i, " ");
        text = beforeMonth + " " + text.slice(month.index + month[0].length);
        if (indexField) {
            plan.filters.push(new BasicFilter({ table: indexField.table, column: indexField.column }, "In", monthIndexValues(start, end, config.time?.monthIndexBase)).toJSON());
            plan.summary.push(`${period ? period[0].toUpperCase() + " ending " : "Month: "}${monthNames[index]} ${year}`);
            start = undefined; end = undefined;
        } else if (!calendarField) {
            if (yearField && monthField) {
                const monthValue = (index: number) => monthField.type === "number" ? index + 1 : (monthField.values || []).find(value => value.toLowerCase() === monthNames[index].toLowerCase() || value.toLowerCase() === monthNames[index].slice(0, 3).toLowerCase()) || monthNames[index];
                if (period && /ttm|trailing/i.test(period[0])) {
                    const tuples = Array.from({ length: 12 }, (_, offset) => {
                        const point = new Date(Date.UTC(year, index - 11 + offset, 1));
                        return [{ value: yearField.type === "number" ? point.getUTCFullYear() : String(point.getUTCFullYear()) }, { value: monthValue(point.getUTCMonth()) }];
                    });
                    plan.filters.push(new TupleFilter([{ table: yearField.table, column: yearField.column }, { table: monthField.table, column: monthField.column }], "In", tuples).toJSON());
                    plan.summary.push(`TTM ending ${monthNames[index]} ${year}`);
                } else {
                    addValues(yearField, [String(year)]);
                    addValues(monthField, (period ? Array.from({length: index + 1}, (_, month) => month) : [index]).map(month => String(monthValue(month))));
                }
                start = undefined; end = undefined;
            }
        }
    } else {
        const year = /\b(?:for|in|during|of)\s+(\d{4})\b/i.exec(text);
        if (period) throw new Error("YTD and TTM need an end month, for example TTM ending June 2025.");
        if (year) {
            const number = Number(year[1]);
            if (number < 1900 || number > 9998) throw new Error("Choose a year between 1900 and 9998.");
            const mappedYear = yearField;
            if (mappedYear) addValues(mappedYear, [year[1]]);
            else { start = new Date(Date.UTC(number, 0, 1)); end = new Date(Date.UTC(number + 1, 0, 1)); }
            text = text.replace(year[0], " ");
        }
    }
    if (start && end) {
        const calendar = calendarField;
        if (!calendar && indexField && start.getUTCDate() === 1 && end.getUTCDate() === 1) {
            plan.filters.push(new BasicFilter({ table: indexField.table, column: indexField.column }, "In", monthIndexValues(start, end, config.time?.monthIndexBase)).toJSON());
            plan.summary.push(`Date: ${iso(start)} to ${iso(new Date(end.getTime() - 86400000))}`);
        } else {
        if (!calendar) throw new Error("Map a real calendar date column (type date) before using month, date-range, YTD or TTM filters. A day-of-month number is not a date.");
        plan.filters.push(new AdvancedFilter({ table: calendar.table, column: calendar.column }, "And", { operator: "GreaterThanOrEqual", value: `${iso(start)}T00:00:00.000Z` }, { operator: "LessThan", value: `${iso(end)}T00:00:00.000Z` }).toJSON());
        const last = new Date(end.getTime() - 86400000);
        plan.summary.push(`${period ? period[0].toUpperCase() + ": " : "Date: "}${iso(start)} to ${iso(last)}`);
        }
    }
    // Fields may precede the measure ("show Tenant by Rent Measure by Year")
    // or stand alone ("show Assigned Group"). Identify configured field names
    // throughout the remaining text instead of requiring a particular word order.
    let groupText = text;
    text = "";
    // Recognize complete field aliases longest-first; do not confuse Year with Fiscal Year.
    const aliases = config.options.flatMap(option => {
        const shortName = option.replace(/\s+Name$/i, "");
        const uniqueShortName = shortName !== option && !config.options.some(other => other !== option && other.toLowerCase().startsWith(shortName.toLowerCase()));
        return [option, ...(fieldFor(option)?.aliases || []), ...(config.groupAliases?.[option] || []), ...(uniqueShortName ? [shortName] : [])].map(alias => ({ option, alias }));
    }).sort((a, b) => b.alias.length - a.alias.length);
    const groupMatches: Array<{ option: string; position: number }> = [];
    for (const { option, alias } of aliases) {
        const match = phrase(alias).exec(groupText);
        if (!match) continue;
        groupMatches.push({ option, position: match.index });
        groupText = groupText.slice(0, match.index) + " ".repeat(match[0].length) + groupText.slice(match.index + match[0].length);
    }
    plan.groups = Array.from(new Set(groupMatches.sort((a, b) => a.position - b.position).map(match => match.option)));
    const matches = config.fields.flatMap(field => (field.values || []).map(value => ({ field, value }))).sort((a, b) => b.value.length - a.value.length);
    let remaining = `${text} ${groupText}`;
    for (const { field, value } of matches) {
        const valuePattern = new RegExp(`(?<![\\w])${value.split(/\s+/).map(escape).join("\\s*")}(?![\\w])`, "i");
        if (!valuePattern.test(remaining)) continue;
        const competing = matches.filter(item => normalizeParameterName(item.value) === normalizeParameterName(value));
        if (new Set(competing.map(item => item.field.name)).size > 1) throw new Error(`Ambiguous value ${value}; use an explicit field = value filter.`);
        addValues(field, [value]); remaining = remaining.replace(valuePattern, " ");
    }
    // Only discard conversational language AFTER field, measure and value
    // recognition. Never remove negation, comparisons, or unknown business terms.
    remaining = remaining
        .replace(/\b(?:i would like to see|i would like|i want to see|i want|can you|could you|would you|will you|let me see|show me|give me|tell me|and also)\b/gi, " ")
        .replace(/\b(?:shw|shwo|sho|shwoing|showing|dispaly|disply|comapre|compar|plese|pleae|pls|plz|kindly|also)\b/gi, " ")
        .replace(/\b(list of|list|show|compare|display|give|me|please|the|total|for|in|during|ending|as of|and|as a table|as table|grouped by|group by|by|per)\b/gi, " ").replace(/[,>&]/g, " ").trim();
    if (remaining) throw new Error(`Could not safely interpret “${remaining}”. Use mapped field names and explicit filters (where Tenant = Home Living).`);
    if (!plan.groups.length) {
        if (plan.listOnly) throw new Error("Choose a field to list.");
        if (plan.rank) throw new Error("Choose a field to rank, for example top 5 tenants by Rent Measure.");
        plan.totalOnly = true; plan.groups = config.options.slice(0, 1);
    }
    if (scope) {
        const calendar = calendarField;
        const start = date(scope.start), end = date(scope.end); end.setUTCDate(end.getUTCDate() + 1);
        if (end <= start) throw new Error("The dashboard date range is invalid.");
        if (indexField && start.getUTCDate() === 1 && end.getUTCDate() === 1) plan.filters.push(new BasicFilter({ table: indexField.table, column: indexField.column }, "In", monthIndexValues(start, end, config.time?.monthIndexBase)).toJSON());
        else if (calendar) plan.filters.push(new AdvancedFilter({ table: calendar.table, column: calendar.column }, "And", { operator: "GreaterThanOrEqual", value: start.toISOString() }, { operator: "LessThan", value: end.toISOString() }).toJSON());
        else {
            const year = yearField, month = monthField;
            if (!year || !month || start.getUTCDate() !== 1 || end.getUTCDate() !== 1) throw new Error("Map a calendar date column for day-level dashboard ranges.");
            const values: Array<Array<{ value: string | number }>> = [];
            for (let point = new Date(start); point < end && values.length < 1200; point.setUTCMonth(point.getUTCMonth() + 1)) {
                const index = point.getUTCMonth();
                const label = (month.values || []).find(value => value.toLowerCase() === monthNames[index].toLowerCase() || value.toLowerCase() === monthNames[index].slice(0,3).toLowerCase()) || monthNames[index];
                values.push([{ value: year.type === "number" ? point.getUTCFullYear() : String(point.getUTCFullYear()) }, { value: month.type === "number" ? index + 1 : label }]);
            }
            if (values.length >= 1200) throw new Error("Choose a dashboard range shorter than 100 years.");
            plan.filters.push(new TupleFilter([{table:year.table,column:year.column},{table:month.table,column:month.column}], "In", values).toJSON());
        }
    }
    if (editor) {
        const rowNames = editor[2].split(/\s*>\s*|\s*,\s*/).filter(Boolean);
        plan.matrixRowCount = rowNames.length;
    }
    if (!editor && !presentation && !plan.listOnly && !plan.totalOnly && !plan.rank) {
        const timeOrder = (name: string) => name === config.time?.yearField ? 0 : name === config.time?.monthField ? 1 : timeFieldOrder(name);
        const time = plan.groups.filter(name=>timeOrder(name)>=0).sort((a,b)=>timeOrder(a)-timeOrder(b));
        const categories = plan.groups.filter(name=>timeOrder(name)<0);
        if (time.length) {
            plan.groups = [...categories,...time];
            plan.presentation = categories.length ? "matrix" : "table";
            if (categories.length) plan.matrixRowCount = categories.length;
        }
    }
    return plan;
}

export function selectedParameterMeasures(plan: ParameterPlan, config: ParameterConfig): string[] {
    if (!config.measureParameter) return plan.measures;
    const requested = plan.measures.filter(name => !(config.directMeasures || []).includes(name));
    if (requested.length) return requested;
    const support = config.measureParameter.options.find(name => name === "askBICS List Support");
    return support ? [support] : config.measureParameter.options.slice(0, 1);
}

export function parameterFilters(plan: ParameterPlan, config: ParameterConfig): IFilter[] {
    const measures = config.measureParameter;
    const selected = selectedParameterMeasures(plan, config);
    if (measures && selected.some(name => !measures.options.includes(name))) throw new Error("A requested measure is missing from the measure parameter options.");
    return [new BasicFilter({ table: config.table, column: config.column }, "In", plan.groups).toJSON(),
        ...(measures ? [new BasicFilter({ table: measures.table, column: measures.column }, "In", selected).toJSON()] : []), ...plan.filters];
}

export function sameGrouping(actual: string[], expected: string[]): boolean {
    return actual.length === expected.length && expected.every(field => actual.some(value => normalizeParameterName(value) === normalizeParameterName(field)));
}

// Compare semantic filter payloads, ignoring optional host presentation metadata.
export function filterSignature(filter: any): string {
    const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    return JSON.stringify({ target: canonical(filter.target), operator: filter.operator, values: filter.values?.slice().sort(), logicalOperator: filter.logicalOperator, conditions: filter.conditions?.map((condition: any) => ({ operator: condition.operator, value: condition.value })).sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b))) });
}
