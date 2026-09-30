import powerbi from "powerbi-visuals-api";
import { QnaContext, QnaField, QnaMeasure } from "./qna/types";

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
        const values = rows.map((row) => text(row[index]) || "(Blank)");
        const groups = new Map<string, number[]>();
        values.forEach((value, rowIndex) => { const indices = groups.get(value) || []; indices.push(rowIndex); groups.set(value, indices); });
        return { key: key(column), name: column.displayName, values, uniqueValues: Array.from(groups, ([label, indices]) => ({ label, indices })) };
    });
    const measures: QnaMeasure[] = measureColumns.map(({ column, index }) => ({
        key: key(column), name: column.displayName,
        values: rows.map((row) => { const value = row[index]; if (value == null) return null; if (column.type?.dateTime) { const time = new Date(value as any).getTime(); return Number.isFinite(time) ? time : null; } const number = Number(value); return Number.isFinite(number) ? number : null; }),
        formatHint: column.type?.dateTime ? "date" : column.format?.includes("%") ? "percentage" : "number",
        formatString: column.format
    }));
    return {
        rowCount: rows.length, fields, measures, selectedIndices,
        formatValue: (measure, value) => {
            if (!Number.isFinite(value)) return "—";
            return formatPowerBiValue(value, measure.formatString, measure.formatHint);
        }
    };
}
