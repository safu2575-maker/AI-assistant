import powerbi from "powerbi-visuals-api";
import { BasicFilter, IBasicFilter, IdentityFilter, IFilterTarget } from "powerbi-models";

// A cell is an intersection. Never weaken it to the first resolvable field.
export function buildSelectionFilters(parts: Array<{ target?: IFilterTarget; supported: boolean; rawValues: Array<string | number | boolean> }>): BasicFilter[] {
    if (!parts.length || parts.some((part) => !part.target || !part.supported || !part.rawValues.length)) return [];
    return parts.map((part) => new BasicFilter(part.target!, "In", part.rawValues));
}

export function resolveFilterTarget(column: powerbi.DataViewMetadataColumn): IFilterTarget | undefined {
    const expr = column.expr as any;
    // Runtime SQ expressions use source/entity/ref, unlike serialized query expressions.
    const level = expr?.HierarchyLevel;
    const hierarchy = level?.Expression?.Hierarchy;
    if (hierarchy?.Expression?.SourceRef?.Entity && hierarchy.Hierarchy && level.Level) {
        return { table: hierarchy.Expression.SourceRef.Entity, hierarchy: hierarchy.Hierarchy, hierarchyLevel: level.Level };
    }
    if (expr?.arg?.arg?.entity && expr.arg.hierarchy && expr.level) {
        return { table: expr.arg.arg.entity, hierarchy: expr.arg.hierarchy, hierarchyLevel: expr.level };
    }
    const serialized = expr?.Column;
    if (serialized?.Expression?.SourceRef?.Entity && serialized.Property) {
        return { table: serialized.Expression.SourceRef.Entity, column: serialized.Property };
    }
    if (expr?.source?.entity && expr.ref) return { table: expr.source.entity, column: expr.ref };
    // Never reinterpret an unresolved hierarchy level as a physical column.
    if (level || expr?.level) return undefined;
    const queryName = column.queryName?.trim();
    if (!queryName) return undefined;
    const bracketed = queryName.match(/^'?(.+?)'?\[([^\]]+)\]$/);
    if (bracketed) return { table: bracketed[1].replace(/^'|'$/g, ""), column: bracketed[2] };
    const separator = queryName.indexOf(".");
    if (separator <= 0 || separator === queryName.length - 1) return undefined;
    const property = queryName.slice(separator + 1);
    if (property.includes(".")) return undefined;
    return { table: queryName.slice(0, separator).replace(/^'|'$/g, ""), column: property };
}

// Apply exactly one host operation: never remove a filter just merged here.
export function applySelectionFilter(
    host: Pick<powerbi.extensibility.visual.IVisualHost, "applyJsonFilter">,
    indices: number[],
    filters: IBasicFilter[]
): void {
    if (!indices.length) {
        host.applyJsonFilter(null, "general", "filter", powerbi.FilterAction.remove);
    } else if (filters.length) {
        host.applyJsonFilter(filters, "general", "filter", powerbi.FilterAction.merge);
    } else {
        host.applyJsonFilter(new IdentityFilter(indices, "In").toJSON(), "general", "filter", powerbi.FilterAction.merge);
    }
}
