import powerbi from "powerbi-visuals-api";
import { resolveFilterTarget } from "./selectionFilter";

export function parameterMetadataColumns(view: powerbi.DataView): powerbi.DataViewMetadataColumn[] {
    return [...(view.metadata.columns || []), ...(view.table?.columns || []),
        ...(view.categorical?.categories || []).map(category => category.source),
        ...(view.categorical?.values || []).map(value => ({...value.source, roles: {...value.source.roles, measures: true}})),
        ...(view.matrix?.rows.levels || []).flatMap(level => level.sources),
        ...(view.matrix?.valueSources || []).map(source => ({...source, roles: {...source.roles, measures: true}}))];
}

/** Discover only an unambiguous source supplied by the host. Never guess table names. */
export function discoverParameter(columns: powerbi.DataViewMetadataColumn[], measures = false): { table: string; column: string; options: string[] } | undefined {
    const candidates = new Map<string, { table: string; column: string; options: string[] }>();
    for (const field of columns) {
        if (!!(field.isMeasure || field.roles?.measures) !== measures) continue;
        for (const source of field.sourceFieldParameters || []) {
            if (!source.expr) return undefined;
            const target = resolveFilterTarget({ displayName: source.displayName, expr: source.expr });
            if (!target || !("column" in target) || typeof target.column !== "string") return undefined;
            const key = JSON.stringify(target);
            const candidate = candidates.get(key) || { table: target.table, column: target.column, options: [] };
            const actual = resolveFilterTarget(field);
            // An unresolved parameter-label column is not a grouping option.
            const unresolved = actual && JSON.stringify(actual) === key || measures && field.type?.text;
            if (!unresolved && (measures || actual) && !candidate.options.includes(field.displayName)) candidate.options.push(field.displayName);
            candidates.set(key, candidate);
        }
    }
    return candidates.size === 1 ? [...candidates.values()][0] : undefined;
}
