import powerbi from "powerbi-visuals-api";
import { AdvancedFilter, BasicFilter, IFilter, IdentityFilter, IFilterTarget, TupleFilter } from "powerbi-models";

// All answer types use the same toggle semantics, including period and YTD cells.
export function toggleSelection(current: number[], incoming: number[], additive: boolean): number[] {
    const selected = new Set(current);
    const requested = new Set(incoming);
    const alreadySelected = incoming.length > 0 && incoming.every((index) => selected.has(index));
    if (alreadySelected && (additive || requested.size === selected.size)) return current.filter((index) => !requested.has(index));
    return additive ? [...new Set([...current, ...incoming])] : [...requested];
}

export function canCompactSelection(
    rows: powerbi.DataViewTableRow[],
    indices: number[],
    parts: Array<{ index: number; rawValues: Array<string | number | boolean> }>
): boolean {
    if (!indices.length || !parts.length || parts.some((part) => !part.rawValues.length)) return false;
    const selected = new Set(indices);
    const allowed = parts.map((part) => ({ index: part.index, values: new Set<unknown>(part.rawValues) }));
    const matched = rows.map((row, index) => allowed.every((part) => part.values.has(row[part.index])) ? index : -1).filter((index) => index >= 0);
    return matched.length === selected.size && matched.every((index) => selected.has(index));
}

// A cell is an intersection. Never weaken it to the first resolvable field.
export function buildSelectionFilters(parts: Array<{ target?: IFilterTarget; supported: boolean; rawValues: Array<string | number | boolean> }>): BasicFilter[] {
    if (!parts.length || parts.some((part) => !part.target || !part.supported || !part.rawValues.length)) return [];
    return parts.map((part) => new BasicFilter(part.target!, "In", part.rawValues));
}

export function resolveFilterTarget(column: powerbi.DataViewMetadataColumn): IFilterTarget | undefined {
    // Auto-date columns can expose their physical hidden-date-table reference
    // only in identityExprs. Prefer that reference over the display hierarchy.
    const identityTargets = (column.identityExprs || []).map((expression) => {
        const expr = expression as any;
        const entity = expr?.source?.entity || expr?.Column?.Expression?.SourceRef?.Entity;
        const property = expr?.ref || expr?.property || expr?.Column?.Property;
        return entity && property ? { table: entity, column: property } : undefined;
    }).filter((target): target is { table: string; column: string } => !!target);
    const uniqueTargets = [...new Map(identityTargets.map((target) => [JSON.stringify(target), target])).values()];
    if (uniqueTargets.length === 1) return uniqueTargets[0];
    const expr = column.expr as any;
    // Runtime SQ expressions use source/entity/ref, unlike serialized query expressions.
    const level = expr?.HierarchyLevel;
    const hierarchy = level?.Expression?.Hierarchy;
    if (hierarchy?.Expression?.SourceRef?.Entity && hierarchy.Hierarchy && level.Level) {
        return { table: hierarchy.Expression.SourceRef.Entity, hierarchy: hierarchy.Hierarchy, hierarchyLevel: level.Level };
    }
    const hierarchySource = expr?.arg?.arg;
    const hierarchyEntity = hierarchySource?.entity || hierarchySource?.source?.entity;
    if (hierarchyEntity && expr.arg.hierarchy && expr.level) {
        return { table: hierarchyEntity, hierarchy: expr.arg.hierarchy, hierarchyLevel: expr.level };
    }
    const serialized = expr?.Column;
    if (serialized?.Expression?.SourceRef?.Entity && serialized.Property) {
        return { table: serialized.Expression.SourceRef.Entity, column: serialized.Property };
    }
    const columnName = expr?.ref || expr?.property;
    if (expr?.source?.entity && columnName) return { table: expr.source.entity, column: columnName };
    // Never reinterpret an unresolved hierarchy level as a physical column.
    if (level || expr?.level) return undefined;
    const queryName = column.queryName?.trim();
    if (!queryName) return undefined;
    const bracketed = queryName.match(/^'?(.+?)'?\[([^\]]+)\]$/);
    if (bracketed) return { table: bracketed[1].replace(/^'|'$/g, ""), column: bracketed[2] };
    const parts = queryName.split(".");
    if (parts.length === 3 && parts.every(Boolean)) return { table: parts[0].replace(/^'|'$/g, ""), hierarchy: parts[1], hierarchyLevel: parts[2] };
    if (parts.length !== 2 || parts.some((part) => !part)) return undefined;
    return { table: parts[0].replace(/^'|'$/g, ""), column: parts[1] };
}

// Keep the entire selection in general.filter. Extra properties are legacy
// slots, cleared before applying the new selection so they cannot retain context.
export function applySelectionFilter(
    host: Pick<powerbi.extensibility.visual.IVisualHost, "applyJsonFilter">,
    indices: number[],
    filters: IFilter[],
    tuples?: Array<Array<string | number | boolean>>,
    preserveTuples = false
): void {
    const properties = ["filter", "filter2", "filter3", "filter4", "filter5", "filter6", "filter7", "filter8"];
    const clear = (propertyName: string) => {
        // Power BI accepts null to remove a filter; its API declaration omits null.
        const clearFilter = null as unknown as Parameters<typeof host.applyJsonFilter>[0];
        host.applyJsonFilter(clearFilter, "general", propertyName, powerbi.FilterAction.remove);
    };
    properties.slice(1).forEach(clear);
    if (!indices.length) {
        clear("filter");
    } else if (preserveTuples && filters.length > 1 && tuples?.length) {
        clear("filter");
        const uniqueTuples = Array.from(new Map(tuples.map((tuple) => [JSON.stringify(tuple), tuple])).values());
        const tupleFilter = new TupleFilter(filters.map((filter) => filter.target as IFilterTarget), "In", uniqueTuples.map((tuple) => tuple.map((value) => ({ value }))));
        host.applyJsonFilter(tupleFilter.toJSON(), "general", "filter", powerbi.FilterAction.merge);
    } else if (filters.length) {
        // Replace a previous identity filter instead of merging a different filter
        // type into the same property and leaving the old row selection behind.
        clear("filter");
        // Send the complete conjunction through the one registered filter property.
        // Separate property calls can leave only the first condition effective.
        host.applyJsonFilter(filters, "general", "filter", powerbi.FilterAction.merge);
    } else {
        host.applyJsonFilter(new IdentityFilter(indices, "In").toJSON(), "general", "filter", powerbi.FilterAction.merge);
    }
}

/** Exact union of day intervals: outer bounds AND exclusion of every gap.
 * Keeps date comparisons as date predicates, including times within each day.
 */
export function dateSelectionFilters(target: IFilterTarget, values: string[]): IFilter[] {
    const times = [...new Set(values.map(value => Date.parse(value)))].sort((a,b) => a-b);
    if (!times.length || times.some(value => !Number.isFinite(value))) throw new Error("Invalid date selection.");
    const ranges: Array<{start: number; end: number}> = [];
    for (const time of times) {
        const last = ranges.at(-1);
        if (last && last.end === time) last.end += 86400000;
        else ranges.push({start: time, end: time + 86400000});
    }
    const iso = (time: number) => new Date(time).toISOString();
    return [new AdvancedFilter(target, "And", {operator: "GreaterThanOrEqual", value: iso(ranges[0].start)}, {operator: "LessThan", value: iso(ranges.at(-1)!.end)}).toJSON(),
        ...ranges.slice(1).map((range,index) => new AdvancedFilter(target, "Or", {operator: "LessThan", value: iso(ranges[index].end)}, {operator: "GreaterThanOrEqual", value: iso(range.start)}).toJSON())];
}
