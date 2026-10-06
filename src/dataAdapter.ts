import powerbi from "powerbi-visuals-api";
import { QnaContext, QnaField, QnaMeasure } from "./qna/types";

export function categoricalAsTable(categorical: powerbi.DataViewCategorical | undefined): powerbi.DataViewTable | undefined {
    if (!categorical) return undefined;
    const categories = categorical.categories || [];
    const values = Array.from(categorical.values || []);
    const columns = [...categories.map((column) => column.source), ...values.map((column) => column.source)];
    if (!columns.length) return undefined;
    const rowCount = Math.max(0, ...categories.map((column) => column.values.length), ...values.map((column) => column.values.length));
    const rows: powerbi.DataViewTableRow[] = new Array(rowCount);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
        const row: powerbi.DataViewTableRow = new Array(columns.length);
        let columnIndex = 0;
        for (const column of categories) row[columnIndex++] = column.values[rowIndex] ?? null;
        for (const column of values) row[columnIndex++] = column.values[rowIndex] ?? null;
        rows[rowIndex] = row;
    }
    const totals = columns.map((column) => column.aggregates?.subtotal ?? column.aggregates?.single ?? null);
    return { columns, rows, totals };
}

export function formatPowerBiValue(value: number, formatString = "", formatHint: QnaMeasure["formatHint"] = "number", compact = false): string {
    if (!Number.isFinite(value)) return "—";
    if (formatHint === "date") return new Date(value).toLocaleDateString();
    const positivePattern = String(formatString || "").split(";")[0].replace(/\[[^\]]*\]/g, "");
    const placeholder = positivePattern.match(/[0#][0#,.]*/)?.[0] || "";
    const decimals = placeholder ? Math.min(12, placeholder.includes(".") ? (placeholder.split(".")[1].match(/[0#]/g) || []).length : 0) : 2;
    const requiredDecimals = Math.min(decimals, placeholder.includes(".") ? (placeholder.split(".")[1].match(/0/g) || []).length : 0);
    const percentage = formatHint === "percentage" || positivePattern.includes("%");
    const scaled = percentage ? value * 100 : value;
    const prefix = positivePattern.slice(0, positivePattern.indexOf(placeholder)).replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1").trim();
    const suffix = positivePattern.slice(positivePattern.indexOf(placeholder) + placeholder.length).replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1").replace(/%/g, "").trim();
    const formatted = scaled.toLocaleString(undefined, compact && !percentage ? { notation: "compact", maximumFractionDigits: Math.max(1, decimals) } : { useGrouping: !placeholder || placeholder.includes(","), minimumFractionDigits: requiredDecimals, maximumFractionDigits: decimals });
    const signWrapped = value < 0 && String(formatString).split(";")[1]?.includes("(") ? `(${formatted.replace(/^-/, "")})` : formatted;
    return `${prefix}${signWrapped}${percentage ? "%" : suffix}`;
}

export function buildContext(table: powerbi.DataViewTable | undefined, selectedIndices: number[] = []): QnaContext {
    const columns = table?.columns || [];
    const rows = table?.rows || [];
    const fieldColumns = columns.map((column, index) => ({ column, index })).filter(({ column }) => !column.roles?.measures);
    const measureColumns = columns.map((column, index) => ({ column, index })).filter(({ column }) => !!column.roles?.measures);
    const key = (column: powerbi.DataViewMetadataColumn): string => column.queryName || column.displayName;
    const text = (value: unknown): string => value == null ? "" : value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
    const fields: QnaField[] = fieldColumns.map(({ column, index }) => {
        const values = new Array<string>(rows.length);
        const groups = new Map<string, number[]>();
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            const value = text(rows[rowIndex][index]) || "(Blank)";
            values[rowIndex] = value;
            const indices = groups.get(value);
            if (indices) indices.push(rowIndex);
            else groups.set(value, [rowIndex]);
        }
        return { key: key(column), name: column.displayName, values, uniqueValues: Array.from(groups, ([label, indices]) => ({ label, indices })) };
    });
    const measures: QnaMeasure[] = measureColumns.map(({ column, index }) => {
        const measureValues = new Array<number | null>(rows.length);
        const isDate = !!column.type?.dateTime;
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            const value = rows[rowIndex][index];
            if (value == null) measureValues[rowIndex] = null;
            else if (isDate) { const time = new Date(value as any).getTime(); measureValues[rowIndex] = Number.isFinite(time) ? time : null; }
            else { const number = Number(value); measureValues[rowIndex] = Number.isFinite(number) ? number : null; }
        }
        return {
            key: key(column), name: column.displayName, values: measureValues,
            formatHint: isDate ? "date" : column.format?.includes("%") ? "percentage" : "number",
            formatString: column.format,
            modelTotal: table?.totals?.[index] != null && Number.isFinite(Number(table.totals[index])) ? Number(table.totals[index]) : undefined
        };
    });
    return {
        rowCount: rows.length, fields, measures, selectedIndices,
        formatValue: (measure, value) => {
            if (!Number.isFinite(value)) return "—";
            return formatPowerBiValue(value, measure.formatString, measure.formatHint);
        }
    };
}
