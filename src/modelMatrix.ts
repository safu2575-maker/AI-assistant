import powerbi from "powerbi-visuals-api";

export interface ModelMatrixData {
    table: powerbi.DataViewTable;
    hierarchy: Array<{ label: string; depth: number; key: string; parent?: string; values: powerbi.PrimitiveValue[]; branch: boolean }>;
}

/** Rows-only matrix: every measure is already evaluated by the semantic model. */
export function readModelMatrix(matrix?: powerbi.DataViewMatrix): ModelMatrixData | undefined {
    if (!matrix) return undefined;
    const levels = matrix.rows.levels;
    const fields = levels.flatMap(level => level.sources);
    const measures = matrix.valueSources.map(source => ({ ...source, isMeasure: true, roles: { ...source.roles, measures: true } }));
    const rows: powerbi.DataViewTableRow[] = [];
    const hierarchy: ModelMatrixData["hierarchy"] = [];
    let totals: powerbi.PrimitiveValue[] | undefined;
    const values = (node: powerbi.DataViewMatrixNode): powerbi.PrimitiveValue[] => {
        const result = measures.map(() => null as unknown as powerbi.PrimitiveValue);
        Object.values(node.values || {}).forEach(value => { result[value.valueSourceIndex || 0] = value.value ?? (null as unknown as powerbi.PrimitiveValue); });
        return result;
    };
    const visit = (node: powerbi.DataViewMatrixNode, path: powerbi.PrimitiveValue[], parent?: string) => {
        if (node.isSubtotal) { if (!path.length) totals = values(node); return; }
        const sources = levels[node.level ?? path.length]?.sources || [];
        const groupValues = sources.length > 1 ? sources.map((_, index) => node.levelValues?.find(value => value.levelSourceIndex === index)?.value ?? (null as unknown as powerbi.PrimitiveValue)) : [node.levelValues?.[0]?.value ?? node.value ?? (null as unknown as powerbi.PrimitiveValue)];
        const next = [...path, ...groupValues];
        const key = JSON.stringify(next);
        const children = node.children?.filter(child => !child.isSubtotal) || [];
        const subtotal = node.children?.find(child => child.isSubtotal);
        hierarchy.push({ label: String(next[next.length - 1] ?? "(Blank)"), depth: next.length - 1, key, parent,
            values: values(subtotal || node), branch: children.length > 0 });
        if (children.length) children.forEach(child => visit(child, next, key));
        else if (next.length === fields.length) rows.push([...next, ...values(node)]);
    };
    if (matrix.rows.root.values) totals = values(matrix.rows.root);
    // A measure-only matrix stores its single result on the root.
    if (!fields.length && totals) rows.push([...totals]);
    (matrix.rows.root.children || []).forEach(node => visit(node, []));
    return { table: { columns: [...fields, ...measures], rows, totals: totals ? [...fields.map(() => null), ...totals] as powerbi.DataViewTable["totals"] : undefined }, hierarchy };
}
