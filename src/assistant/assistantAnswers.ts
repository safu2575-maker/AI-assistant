import {
    AssistantAnswerContext,
    AssistantAction,
    AssistantEntity,
    AssistantMetric,
    AssistantResponse,
    ParsedAssistantFilter,
    ParsedAssistantQuestion,
    ParsedTopBottomQuery,
    SelectedAssistantToken
} from "./assistantTypes";
import { matrixFilterToText, normalizeMatrixQuery } from "./matrixQueryBuilder";
import { normalizeMetricResolverText } from "./assistantMetricResolver";

function uniqNums(values: number[]): number[] {
    return Array.from(new Set(values.map(Number).filter((value) => Number.isFinite(value) && value >= 0)));
}

function selectedScopedIndices(ctx: AssistantAnswerContext, indices: number[]): number[] {
    const unique = uniqNums(indices);
    const selected = uniqNums(ctx.selectedIndices || []);
    if (!unique.length || !selected.length) return unique;
    const selectedSet = new Set(selected);
    const scoped = unique.filter((idx) => selectedSet.has(idx));
    return scoped.length ? scoped : unique;
}

function scopeLabel(entity: AssistantEntity): string {
    if (entity.kind === "context") return entity.label;
    return `${entity.label}${entity.kind === "tenant" || entity.kind === "unit" ? "" : ` ${entity.kind}`}`;
}

type AssistantTable = NonNullable<AssistantResponse["table"]>;

function projectTable(table: AssistantTable, desiredColumns: string[]): AssistantTable {
    const columns = Array.from(new Set((desiredColumns || []).filter(Boolean)));
    const positions = columns
        .map((column) => table.columns.indexOf(column))
        .filter((index) => index >= 0);
    if (!positions.length) return table;
    return {
        columns: positions.map((index) => table.columns[index]),
        rows: table.rows.map((row) => positions.map((index) => row[index] ?? ""))
    };
}

function firstExistingColumn(columns: string[], candidates: string[]): string | null {
    return candidates.find((candidate) => columns.indexOf(candidate) >= 0) || null;
}

function focusedRankTable(table: AssistantTable, dimensionName: string, metricNames: string[]): AssistantTable {
    const requestedMetrics = metricNames.filter((name) => table.columns.indexOf(name) >= 0);
    return projectTable(table, ["Rank", dimensionName].concat(requestedMetrics));
}

function focusedLookupDetailTable(table: AssistantTable, metricName: string): AssistantTable {
    return projectTable(table, [metricName]);
}

function focusedCompareTable(table: AssistantTable, metricName: string | undefined): AssistantTable {
    const metricColumns = metricName && table.columns.indexOf(metricName) >= 0
        ? [metricName]
        : table.columns.filter((column) => column !== "Name" && column !== "Units" && column !== "Area" && column !== "Category" && column !== "Group" && column !== "Floor").slice(0, 1);
    const contextColumns = ["Category", "Group"].filter((column) => table.columns.indexOf(column) >= 0);
    return projectTable(table, ["Name"].concat(metricColumns, contextColumns));
}

function isScopeEntity(entity: AssistantEntity): boolean {
    return entity.kind === "zone" || entity.kind === "layer" || entity.kind === "floor" || entity.kind === "bookmark" || entity.kind === "context";
}

function isRankScopeEntity(entity: AssistantEntity): boolean {
    return isScopeEntity(entity) || entity.kind === "category" || entity.kind === "group" || entity.kind === "filter";
}

function isPlaceholderTenantName(value: string): boolean {
    const clean = String(value || "").trim().toLowerCase();
    return !clean || clean === "n/a" || clean === "na" || clean === "none" || clean === "null" || clean === "undefined" || clean === "-" || clean === "no tenant" || clean === "(no name)";
}

function entityMatchesScopePhrase(entity: AssistantEntity, phrase: string): boolean {
    const normalized = normalizeAnswerText(phrase);
    if (!normalized) return false;
    const tokens = new Set(normalized.split(/\s+/g).filter(Boolean));
    return [entity.label].concat(entity.aliases || []).some((label) => {
        const clean = normalizeAnswerText(label);
        if (!clean || clean.length < 2) return false;
        if (normalized === clean || normalized.indexOf(clean) >= 0 || clean.indexOf(normalized) >= 0) return true;
        const cleanTokens = clean.split(/\s+/g).filter((token) => token.length >= 3);
        return cleanTokens.length >= 2 && cleanTokens.every((token) => tokens.has(token));
    });
}

function entityPrimaryLabelMatchesScopePhrase(entity: AssistantEntity, phrase: string): boolean {
    const normalized = normalizeAnswerText(phrase);
    const clean = normalizeAnswerText(entity.label);
    if (!normalized || !clean) return false;
    return normalized === clean || normalized.indexOf(clean) >= 0 || clean.indexOf(normalized) >= 0;
}

function scopeKindRank(kind: AssistantEntity["kind"]): number {
    if (kind === "group") return 0;
    if (kind === "category") return 1;
    if (kind === "filter") return 2;
    if (kind === "zone") return 3;
    if (kind === "floor") return 4;
    if (kind === "layer") return 5;
    if (kind === "context") return 6;
    return 9;
}

function isGenericScopeAlias(value: string): boolean {
    return /^(category|categories|group|groups|filter|filters|zone|zones|floor|floors|level|levels|layer|layers|context|selection|selected units|current view)$/i.test(normalizeAnswerText(value));
}

function stripChartScopeWords(value: string): string {
    return normalizeAnswerText(value)
        .replace(/\b(?:in|as|to|use|using|with)\s+(?:bar|column|line|pie|donut|doughnut|area|table)\s*(?:chart|graph|visual|view)?\b/g, " ")
        .replace(/\b(?:bar|column|line|pie|donut|doughnut|area|table)\s+(?:chart|graph|visual|view)\b/g, " ")
        .replace(/\b(?:chart|graph|visual|view)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function inferRankScopesFromQuestion(ctx: AssistantAnswerContext, parsed: ParsedAssistantQuestion, existing: AssistantEntity[]): AssistantEntity[] {
    const rawScopeText = String(parsed.raw || parsed.normalized || "");
    const hasAuthoritativeFilters = (parsed.filters?.includeFilters || [])
        .some((filter) => filter.phrase && (filter.matchedIndices || []).length > 0);
    if (hasAuthoritativeFilters) return extractInlineOrdinalScopeEntities(ctx, parsed);
    const hasExplicitScopeConnector = /\b(?:in|inside|within|under|from|for|excluding|exclude|except|without|including|include|only|just|limited\s+to|filtered\s+by)\b/i.test(rawScopeText)
        || !!(parsed.explicitScopes || []).length;
    if (!hasExplicitScopeConnector) return extractInlineOrdinalScopeEntities(ctx, parsed);
    const excludedPhrases = new Set((parsed.filters?.excludeFilters || [])
        .concat(parsed.filters?.includeFilters || [])
        .map((filter) => normalizeAnswerText(filter.phrase))
        .filter(Boolean));
    [
        parsed.explicitMetricPhrase,
        parsed.topBottom?.metricPhrase
    ]
        .concat(parsed.metricPhrases || [])
        .concat(parsed.requestedFields?.values || [])
        .concat(parsed.requestedFields?.metrics || [])
        .forEach((phrase) => {
            const clean = normalizeAnswerText(phrase || "");
            if (!clean) return;
            excludedPhrases.add(clean);
            if (/^(?:sum of|total of|total|average|avg)\s+/.test(clean)) {
                excludedPhrases.add(clean.replace(/^(?:sum of|total of|total|average|avg)\s+/, "").trim());
            }
        });
    const normalized = stripChartScopeWords(parsed.normalized || parsed.raw || "")
        .replace(/\b(?:excluding|exclude|except|without|not including|remove|including|include|only|just|limited to|filtered by)\b.+$/i, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!normalized) return [];
    const allowBookmarkScopes = /\b(bookmark|bookmarks|saved\s+view|saved\s+views)\b/i.test(parsed.normalized || parsed.raw || "");
    const tokens = new Set(normalized.split(/\s+/g).filter(Boolean));
    const existingKeys = new Set((existing || []).map((entity) => `${entity.kind}:${entity.id}`));
    const hasExplicitScopes = !!(parsed.explicitScopes || []).length;
    const out: AssistantEntity[] = [];
    const push = (entity: AssistantEntity) => {
        const key = `${entity.kind}:${entity.id}`;
        if (existingKeys.has(key) || out.some((item) => item.kind === entity.kind && item.id === entity.id)) return;
        out.push(entity);
    };
    extractInlineOrdinalScopeEntities(ctx, parsed).forEach(push);
    if (hasExplicitScopes) {
        (parsed.explicitScopes || []).forEach((scope) => {
            const allowedKinds = scope.kind
                ? new Set<AssistantEntity["kind"]>([scope.kind])
                : new Set<AssistantEntity["kind"]>(["group", "category", "filter", "zone", "floor", "layer", "context"]);
            const candidates = (ctx.entities || [])
                .filter((entity) => allowedKinds.has(entity.kind))
                .filter((entity) => entityPrimaryLabelMatchesScopePhrase(entity, scope.phrase));
            const primary = scope.kind
                ? candidates
                : candidates.filter((entity) => entity.kind === candidates.slice().sort((a, b) => scopeKindRank(a.kind) - scopeKindRank(b.kind))[0]?.kind);
            const matches = primary.length
                ? primary
                : (ctx.entities || [])
                    .filter((entity) => allowedKinds.has(entity.kind))
                    .filter((entity) => scope.kind ? entityMatchesScopePhrase(entity, scope.phrase) : false);
            matches.forEach(push);
        });
        return out;
    }
    (ctx.entities || [])
        .filter((entity) => entity.kind === "category" || entity.kind === "group" || entity.kind === "filter" || isScopeEntity(entity))
        .filter((entity) => entity.kind !== "bookmark" || allowBookmarkScopes)
        .forEach((entity) => {
            const labels = [entity.label].concat(entity.aliases || []);
            const matched = labels.some((label) => {
                const clean = normalizeAnswerText(label);
                if (excludedPhrases.has(clean)) return false;
                if (isGenericScopeAlias(clean)) return false;
                if (!clean || clean.length < 3) return false;
                if (normalized === clean || normalized.indexOf(clean) >= 0) return true;
                const cleanTokens = clean.split(/\s+/g).filter((token) => token.length >= 3);
                return cleanTokens.length >= 2 && cleanTokens.every((token) => tokens.has(token));
            });
            if (matched) push(entity);
        });
    return out;
}

function extractInlineOrdinalScopeEntities(ctx: AssistantAnswerContext, parsed: ParsedAssistantQuestion): AssistantEntity[] {
    const q = String(parsed.raw || parsed.normalized || "").toLowerCase();
    if (!/\b(zone|layer)s?\s*\d/.test(q)) return [];
    const expanded = q
        .replace(/\b(zone|layer)s?\s+((?:\d+\s*(?:,|and)?\s*){1,12})/g, (_m, kind, nums) => {
            const singular = /^layer/i.test(String(kind)) ? "layer" : "zone";
            return String(nums || "").replace(/\d+/g, (n) => ` ${singular} ${n} `);
        })
        .replace(/\b(zone|layer)\s*(\d+)/g, "$1 $2");
    const wanted = new Set<string>();
    Array.from(expanded.matchAll(/\b(zone|layer)\s*(\d+)\b/g)).forEach((match) => {
        const kind = String(match[1] || "").toLowerCase();
        const n = Number(match[2]);
        if (Number.isFinite(n)) wanted.add(`${kind} ${n}`);
    });
    if (!wanted.size) return [];
    return (ctx.entities || [])
        .filter((entity) => entity.kind === "zone" || entity.kind === "layer")
        .filter((entity) => [entity.label].concat(entity.aliases || [])
            .map((label) => normalizeAnswerText(label))
            .some((label) => wanted.has(label)));
}

function intersectNums(a: number[], b: number[]): number[] {
    const set = new Set(uniqNums(b));
    return uniqNums(a).filter((value) => set.has(value));
}

function combineScopeIndices(scopes: AssistantEntity[]): number[] | null {
    const valid = (scopes || []).filter((entity) => (entity.indices || []).length > 0);
    if (!valid.length) return null;
    const spatialKinds = new Set<AssistantEntity["kind"]>(["zone", "layer", "floor"]);
    const unionIndices = (items: AssistantEntity[]): number[] => uniqNums(items.reduce((out: number[], entity) => out.concat(entity.indices || []), []));
    const combineByKind = (items: AssistantEntity[]): number[] | null => {
        const groups = new Map<string, AssistantEntity[]>();
        items.forEach((entity) => {
            const key = entity.kind;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(entity);
        });
        const groupedUnions = Array.from(groups.values()).map(unionIndices).filter((indices) => indices.length > 0);
        if (!groupedUnions.length) return null;
        return groupedUnions.slice(1).reduce((out, indices) => intersectNums(out, indices), groupedUnions[0]);
    };
    const spatial = valid.filter((entity) => spatialKinds.has(entity.kind));
    const nonSpatial = valid.filter((entity) => !spatialKinds.has(entity.kind));
    const spatialUnion = spatial.length ? unionIndices(spatial) : null;
    const nonSpatialCombined = nonSpatial.length ? combineByKind(nonSpatial) : null;
    if (spatialUnion && nonSpatialCombined) return intersectNums(nonSpatialCombined, spatialUnion);
    return spatialUnion || nonSpatialCombined || null;
}

function scopeTextForEntities(scopes: AssistantEntity[]): string {
    return (scopes || []).map((entity) => scopeLabel(entity)).join(", ");
}

function isSuspiciousScopeList(scopes: AssistantEntity[], scopeText?: string): boolean {
    const cleanText = String(scopeText || scopeTextForEntities(scopes || []));
    return (scopes || []).length > 8 || cleanText.length > 260;
}

function suspiciousScopeResponse(scopes: AssistantEntity[], dimension: string = "answer"): AssistantResponse | null {
    if (!isSuspiciousScopeList(scopes)) return null;
    const labels = (scopes || []).slice(0, 5).map((entity) => entity.label).filter(Boolean);
    return {
        handled: true,
        text: `I could not identify a single scope for this ${dimension}. Please choose the category, group, zone, floor, or filter field.`,
        suggestions: labels
    };
}

function scopeContext(entities: AssistantEntity[]): { scopes: AssistantEntity[]; subjects: AssistantEntity[]; scopeIndices: number[] | null; scopeText: string } {
    const scopes = entities.filter(isRankScopeEntity);
    const subjects = entities.filter((entity) => !isRankScopeEntity(entity));
    if (!scopes.length) return { scopes, subjects, scopeIndices: null, scopeText: "" };
    const scopeIndices = combineScopeIndices(scopes);
    const scopeText = scopeTextForEntities(scopes);
    return { scopes, subjects, scopeIndices, scopeText };
}

function tenantEntitiesForScope(ctx: AssistantAnswerContext, scopeIndices: number[] | null): AssistantEntity[] {
    const tenants = ctx.entities.filter((entity) => entity.kind === "tenant" && !isPlaceholderTenantName(entity.label));
    if (!scopeIndices) return tenants;
    return tenants
        .map((entity) => ({ ...entity, indices: intersectNums(entity.indices, scopeIndices) }))
        .filter((entity) => entity.indices.length > 0);
}

function tenantOrUnitEntitiesForScope(ctx: AssistantAnswerContext, scopeIndices: number[] | null): AssistantEntity[] {
    const tenants = tenantEntitiesForScope(ctx, scopeIndices);
    if (tenants.length) return tenants;
    const units = ctx.entities.filter((entity) => entity.kind === "unit");
    if (!scopeIndices) return units;
    return units
        .map((entity) => ({ ...entity, indices: intersectNums(entity.indices, scopeIndices) }))
        .filter((entity) => entity.indices.length > 0);
}

function validValue(value: number): boolean {
    return Number.isFinite(value);
}

function getPreferredAreaMetric(ctx: AssistantAnswerContext): AssistantMetric | undefined {
    const candidates = (ctx.metrics || []).filter((item) => {
        if (!item || item.kind !== "dynamic") return false;
        const haystack = [item.name].concat(item.aliases || []).join(" ").toLowerCase();
        return /\b(sum of area|actual area|area|sqm|sq\.?m|m2)\b/.test(haystack);
    });
    const score = (metric: AssistantMetric): number => {
        const haystack = [metric.name].concat(metric.aliases || []).join(" ").toLowerCase();
        let out = 0;
        if (/\bsum of area\b/.test(haystack)) out += 100;
        if (/\bactual area\b/.test(haystack)) out += 70;
        if (/\barea\b/.test(haystack)) out += 50;
        if (/\bsqm\b|\bsq\.?m\b|\bm2\b/.test(haystack)) out += 20;
        if (metric.role === "heatmap") out += 12;
        if (metric.role === "bar") out += 6;
        if (/\bfloor area variance\b|\bvariance\b/.test(haystack)) out -= 120;
        if (/\bfloor area\b/.test(haystack)) out -= 80;
        return out;
    };
    return candidates.sort((a, b) => score(b) - score(a))[0];
}

function metricCalculationNote(metric: AssistantMetric): string {
    if (metric.kind === "builtin") return "";
    if (metric.isCustomKpi) {
        return metric.isNonAdditive === false
            ? `${metric.name} is a custom KPI calculated by the visual formula logic.`
            : `${metric.name} is a non-additive custom KPI calculated by the visual formula logic.`;
    }
    if (metric.aggregationHint === "average" || metric.formatHint === "percentage") {
        return `${metric.name} is treated as non-additive and averaged across matched rows.`;
    }
    return "";
}

function metricCalculationNotes(metrics: AssistantMetric[]): string {
    return "";
}

function metricBusinessNote(metric: AssistantMetric, direction?: "top" | "bottom"): string {
    const label = `${metric?.name || ""} ${(metric?.aliases || []).join(" ")}`.toLowerCase();
    if (/\b(ocr|occupancy cost|cost ratio|rent to sales|rent sales ratio)\b/.test(label)) {
        if (direction === "top") return "OCR is lower-is-better, so top performers are ranked by lowest OCR unless you explicitly ask for highest OCR.";
        if (direction === "bottom") return "OCR is lower-is-better, so worst performers are ranked by highest OCR unless you explicitly ask for lowest OCR.";
        return "OCR is lower-is-better: low OCR tenants are generally stronger performers, while high OCR can indicate pressure.";
    }
    if (/\b(vacancy|vacant|expense|cost)\b/.test(label)) {
        return "This metric is usually lower-is-better, so high values may need review.";
    }
    return "";
}

function metricBusinessNotes(metrics: AssistantMetric[], direction?: "top" | "bottom"): string {
    const notes = Array.from(new Set((metrics || []).map((metric) => metricBusinessNote(metric, direction)).filter(Boolean)));
    return notes.length ? `\nBusiness note: ${notes.join(" ")}` : "";
}

function metricSemanticKind(metric: AssistantMetric): "sales" | "rent" | "ocr" | "occupancy" | "vacancy" | "area" | "units" | "other" {
    const label = `${metric?.name || ""} ${(metric?.aliases || []).join(" ")}`.toLowerCase();
    if (/\b(ocr|occupancy cost|cost ratio|rent to sales|rent sales ratio)\b/.test(label)) return "ocr";
    if (/\b(sales|sale|revenue|turnover|income)\b/.test(label)) return "sales";
    if (/\b(rent|rental|lease|base rent|passing rent)\b/.test(label)) return "rent";
    if (/\b(vacancy|vacant)\b/.test(label)) return "vacancy";
    if (/\b(occupancy|occupied|occ)\b/.test(label)) return "occupancy";
    if (/\b(area|sqm|m2|gla|size)\b/.test(label) || metric.key === "__builtin::area") return "area";
    if (/\b(units?|stores?|shops?)\b/.test(label) || metric.key === "__builtin::units") return "units";
    return "other";
}

function metricPerformanceDirection(metric: AssistantMetric): "higher" | "lower" | "neutral" {
    const kind = metricSemanticKind(metric);
    if (kind === "ocr" || kind === "vacancy") return "lower";
    if (kind === "sales" || kind === "occupancy" || kind === "units" || kind === "area") return "higher";
    return "neutral";
}

function rankWantsLiteralHigh(parsed: ParsedAssistantQuestion): boolean {
    return /\b(highest|largest|maximum|max|biggest|most)\b/i.test(parsed.normalized || "");
}

function rankWantsLiteralLow(parsed: ParsedAssistantQuestion): boolean {
    return /\b(lowest|smallest|minimum|min|least)\b/i.test(parsed.normalized || "");
}

function effectiveRankSortDirection(metric: AssistantMetric, parsed: ParsedAssistantQuestion, requested: "top" | "bottom"): "asc" | "desc" {
    if (rankWantsLiteralHigh(parsed)) return "desc";
    if (rankWantsLiteralLow(parsed)) return "asc";
    const performance = metricPerformanceDirection(metric);
    if (performance === "lower") return requested === "top" ? "asc" : "desc";
    return requested === "bottom" ? "asc" : "desc";
}

function rankHeading(metric: AssistantMetric, parsed: ParsedAssistantQuestion, requested: "top" | "bottom", noun: string): string {
    if (rankWantsLiteralHigh(parsed)) return `Highest ${noun}`;
    if (rankWantsLiteralLow(parsed)) return `Lowest ${noun}`;
    const performance = metricPerformanceDirection(metric);
    if (performance === "lower") return requested === "top" ? `Best ${noun} (lowest)` : `Worst ${noun} (highest)`;
    if (performance === "higher") return requested === "top" ? `Best ${noun} (highest)` : `Lowest ${noun}`;
    return requested === "bottom" ? `Lowest ${noun}` : `Highest ${noun}`;
}

function isCompareDefaultExcluded(metric: AssistantMetric): boolean {
    const key = String(metric.key || "");
    if (key === "__builtin::occupancy" || key === "__builtin::vacant" || key === "__builtin::occupied") return true;
    const name = String(metric.name || "").toLowerCase();
    if (metric.formatHint === "text") return true;
    return /\boccupancy\b|\bocc\b|vacant|occupied|\bcategory\b|\btenant\b|\bgroup\b|\bfloor\b|\bunit\s*id\b/.test(name);
}

function defaultCompareMetrics(ctx: AssistantAnswerContext, entities: AssistantEntity[]): AssistantMetric[] {
    const out: AssistantMetric[] = [];
    const seen = new Set<string>();
    const add = (metric: AssistantMetric | undefined) => {
        if (!metric || isCompareDefaultExcluded(metric)) return;
        const key = String(metric.key || "").trim();
        if (!key || seen.has(key)) return;
        const hasValue = entities.some((entity) => validValue(resolveMetricValue(ctx, metric, entity.indices)));
        if (!hasValue) return;
        seen.add(key);
        out.push(metric);
    };
    const selectedKeys = ctx.heatmapSelectedKeys || [];
    if (selectedKeys.length) {
        selectedKeys.forEach((key) => add(ctx.metrics.find((m) => m.key === key)));
    } else {
        ctx.metrics.filter((metric) => metric.kind === "dynamic" && metric.role === "heatmap").forEach(add);
    }
    return out;
}

function enrichWithHeatmapMetrics(ctx: AssistantAnswerContext, metrics: AssistantMetric[], limit: number = 30): AssistantMetric[] {
    const out: AssistantMetric[] = [];
    const add = (metric: AssistantMetric | undefined) => {
        if (!metric) return;
        const key = String(metric.key || "").trim();
        if (!key || out.some((item) => item.key === key)) return;
        out.push(metric);
    };
    (metrics || []).forEach(add);
    (ctx.heatmapSelectedKeys || []).forEach((key) => add(ctx.metrics.find((metric) => metric.key === key)));
    ctx.metrics
        .filter((metric) => metric.kind === "dynamic" && metric.role === "heatmap")
        .forEach(add);
    return out.slice(0, limit);
}

function shouldExpandRankMetrics(parsed: ParsedAssistantQuestion): boolean {
    const text = `${parsed.raw || ""} ${parsed.normalized || ""}`.toLowerCase();
    return /\b(all\s+(?:heatmap\s+)?(?:metrics|measures|fields)|heatmap\s+(?:metrics|measures|fields)|selected\s+(?:metrics|measures|fields)|compare\s+(?:metrics|measures|fields)|show\s+other\s+(?:metrics|measures|fields))\b/.test(text);
}

function distinctRowValues(ctx: AssistantAnswerContext, indices: number[], pick: (row: NonNullable<AssistantAnswerContext["rows"][number]>) => string | string[]): string {
    const values = new Set<string>();
    uniqNums(indices).forEach((idx) => {
        const row = ctx.rows[idx];
        if (!row) return;
        const raw = pick(row);
        (Array.isArray(raw) ? raw : [raw]).forEach((value) => {
            const clean = String(value || "").trim();
            if (clean) values.add(clean);
        });
    });
    const out = Array.from(values.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
    if (!out.length) return "N/A";
    return out.slice(0, 3).join(", ") + (out.length > 3 ? ` +${out.length - 3}` : "");
}

function normalizeAnswerText(value: string): string {
    return String(value || "").toLowerCase().replace(/[\/\\]+/g, " ").replace(/\s+-\s+/g, " ").replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
}

function floorPhraseMatches(rowFloor: string, phrase: string): boolean {
    const floor = normalizeAnswerText(rowFloor);
    const q = normalizeAnswerText(phrase);
    if (!q) return true;
    if (floor === q || floor.indexOf(q) >= 0) return true;
    if ((q === "ground" || q === "floor 1" || q === "level 1") && /ground|floor 1|level 1|first|1st/.test(floor)) return true;
    if ((q === "first" || q === "1st" || q === "floor 2" || q === "level 2") && /first|1st|floor 2|level 2|second|2nd/.test(floor)) return true;
    if ((q === "second" || q === "2nd" || q === "floor 3" || q === "level 3") && /second|2nd|floor 3|level 3|third|3rd/.test(floor)) return true;
    return false;
}

function findNearEntity(ctx: AssistantAnswerContext, phrase?: string): AssistantEntity | null {
    const q = normalizeAnswerText(phrase || "");
    if (!q) return null;
    const compactQ = q.replace(/\s+/g, "");
    const candidates = (ctx.entities || []).filter((entity) => entity.kind === "tenant" || entity.kind === "unit");
    return candidates.find((entity) => {
        const labels = [entity.label].concat(entity.aliases || []);
        return labels.some((label) => {
            const clean = normalizeAnswerText(label);
            const compact = clean.replace(/\s+/g, "");
            return clean === q || compact === compactQ || clean.indexOf(q) >= 0 || q.indexOf(clean) >= 0;
        });
    }) || null;
}

function metricMatchesPhrase(metric: AssistantMetric, phrase: string): boolean {
    const q = normalizeAnswerText(phrase);
    if (!q) return false;
    return [metric.name].concat(metric.aliases || []).some((label) => {
        const clean = normalizeAnswerText(label);
        return clean === q || clean.indexOf(q) >= 0 || q.indexOf(clean) >= 0;
    });
}

function resolveFilterMetric(ctx: AssistantAnswerContext, phrase: string): AssistantMetric | null {
    const q = normalizeAnswerText(phrase);
    if (!q) return null;
    if (/\b(area|sqm|m2|size)\b/.test(q)) return ctx.metrics.find((metric) => metric.key === "__builtin::area" || metricMatchesPhrase(metric, phrase)) || null;
    if (/\b(units?|unit count)\b/.test(q)) return ctx.metrics.find((metric) => metric.key === "__builtin::units" || metricMatchesPhrase(metric, phrase)) || null;
    return (ctx.metrics || []).find((metric) => metricMatchesPhrase(metric, phrase)) || null;
}

function rowMatchesTextFilter(ctx: AssistantAnswerContext, idx: number, phrase: string, type?: string): boolean {
    const row = ctx.rows[idx];
    if (!row) return false;
    const q = normalizeAnswerText(phrase);
    if (!q) return false;
    const strict = q.length <= 3 || q.split(/\s+/g).every((token) => token.length <= 3);
    const matches = (value: string): boolean => {
        const clean = normalizeAnswerText(value);
        if (!clean) return false;
        if (clean === q) return true;
        if (strict) return false;
        return clean.indexOf(q) >= 0 || q.indexOf(clean) >= 0;
    };
    if ((!type || type === "tenant") && matches(row.tenant || "")) return true;
    if ((!type || type === "unit") && (matches(row.unitId || "") || matches(row.combinedUnit || "") || matches(row.shapeKey || ""))) return true;
    if ((!type || type === "category") && matches(row.category || "")) return true;
    if ((!type || type === "group") && matches(row.group || "")) return true;
    if ((!type || type === "floor") && (row.floors || []).some(matches)) return true;
    if (!strict && (!type || type === "category" || type === "group")) {
        if (Object.keys(row.filters || {}).some((key) => matches(key) || matches((row.filters || {})[key]))) return true;
    }
    return false;
}

function rowIndicesForParsedFilter(ctx: AssistantAnswerContext, filter: ParsedAssistantFilter): number[] {
    if ((filter.matchedIndices || []).length) {
        return uniqNums(filter.matchedIndices || []);
    }
    if ((filter.matchedEntityIds || []).length) {
        const idSet = new Set((filter.matchedEntityIds || []).map((id) => String(id || "")));
        const exactEntities = (ctx.entities || []).filter((entity) => {
            if (!idSet.has(String(entity.id || ""))) return false;
            return !filter.type || entity.kind === filter.type;
        });
        return uniqNums(exactEntities.reduce((out: number[], entity) => out.concat(entity.indices || []), []));
    }
    if (filter.type === "metricCondition" && filter.metricCondition) {
        const metric = resolveFilterMetric(ctx, filter.metricCondition.metricPhrase);
        if (!metric) return [];
        const op = filter.metricCondition.operator;
        const threshold = Number(filter.metricCondition.value);
        return uniqNums((ctx.rows || []).map((row) => row.idx)).filter((idx) => {
            const value = resolveMetricValue(ctx, metric, [idx]);
            if (!Number.isFinite(value)) return false;
            if (op === ">") return value > threshold;
            if (op === ">=") return value >= threshold;
            if (op === "<") return value < threshold;
            if (op === "<=") return value <= threshold;
            return value === threshold;
        });
    }
    if (!filter.type) {
        const subjectMatches = (ctx.entities || [])
            .filter((entity) => entity.kind === "tenant" || entity.kind === "unit")
            .filter((entity) => entityPrimaryLabelMatchesScopePhrase(entity, filter.phrase));
        if (subjectMatches.length) {
            return uniqNums(subjectMatches.reduce((out: number[], entity) => out.concat(entity.indices || []), []));
        }
    }
    const allowedKinds = filter.type
        ? new Set<AssistantEntity["kind"]>([filter.type as AssistantEntity["kind"], filter.type === "category" || filter.type === "group" ? "filter" as AssistantEntity["kind"] : filter.type as AssistantEntity["kind"]])
        : null;
    const entityMatches = (ctx.entities || [])
        .filter((entity) => !allowedKinds || allowedKinds.has(entity.kind))
        .filter((entity) => entityMatchesScopePhrase(entity, filter.phrase));
    const entityIndices = uniqNums(entityMatches.reduce((out: number[], entity) => out.concat(entity.indices || []), []));
    const rowTextIndices = uniqNums((ctx.rows || []).map((row) => row.idx).filter((idx) => rowMatchesTextFilter(ctx, idx, filter.phrase, filter.type)));
    return uniqNums(entityIndices.concat(rowTextIndices));
}

function applyIncludeExcludeFilters(ctx: AssistantAnswerContext, indices: number[], filters?: ParsedAssistantQuestion["filters"]): number[] {
    let out = uniqNums(indices);
    if (!filters) return out;
    const include = filters.includeFilters || [];
    const exclude = filters.excludeFilters || [];
    if (include.length) {
        const includeIndices = uniqNums(include.reduce((acc: number[], filter) => acc.concat(rowIndicesForParsedFilter(ctx, filter)), []));
        if (includeIndices.length) out = intersectNums(out, includeIndices);
    }
    if (exclude.length) {
        const excludeSet = new Set(uniqNums(exclude.reduce((acc: number[], filter) => acc.concat(rowIndicesForParsedFilter(ctx, filter)), [])));
        if (excludeSet.size) out = out.filter((idx) => !excludeSet.has(idx));
    }
    return out;
}

function filterSummaryText(parsed?: ParsedAssistantQuestion): string {
    const include = (parsed?.filters?.includeFilters || []).map((filter) => filter.phrase).filter(Boolean);
    const exclude = (parsed?.filters?.excludeFilters || []).map((filter) => filter.phrase).filter(Boolean);
    const parts: string[] = [];
    if (include.length) parts.push(`including ${include.join(", ")}`);
    if (exclude.length) parts.push(`excluding ${exclude.join(", ")}`);
    return parts.length ? `, ${parts.join(", ")}` : "";
}

function editableFilterTokens(parsed?: ParsedAssistantQuestion): SelectedAssistantToken[] {
    return (parsed?.filters?.includeFilters || [])
        .filter((filter) => String(filter.phrase || "").trim())
        .map((filter) => {
            const label = String(filter.phrase || "").trim();
            const tokenType = filter.type && filter.type !== "metricCondition" && filter.type !== "bookmark" ? filter.type : "filter";
            return {
                type: tokenType,
                id: `value:${tokenType}:${normalizeAnswerText(label) || label}`,
                label,
                indices: uniqNums(filter.matchedIndices || [])
            } as SelectedAssistantToken;
        });
}

function filterRowIndicesByParsed(ctx: AssistantAnswerContext, indices: number[], parsed?: ParsedAssistantQuestion): number[] {
    const filters = parsed?.filters;
    let out = uniqNums(indices);
    if (!filters) return out;
    out = applyIncludeExcludeFilters(ctx, out, filters);
    if (filters.areaMin !== undefined) {
        out = out.filter((idx) => Number(ctx.rows[idx]?.area) > Number(filters.areaMin));
    }
    if (filters.areaMax !== undefined) {
        out = out.filter((idx) => Number(ctx.rows[idx]?.area) < Number(filters.areaMax));
    }
    if (filters.floorPhrase) {
        out = out.filter((idx) => (ctx.rows[idx]?.floors || []).some((floor) => floorPhraseMatches(floor, filters.floorPhrase || "")));
    }
    if (filters.nearPhrase) {
        const near = findNearEntity(ctx, filters.nearPhrase);
        if (near) {
            const nearFloors = new Set<string>();
            uniqNums(near.indices).forEach((idx) => (ctx.rows[idx]?.floors || []).forEach((floor) => nearFloors.add(normalizeAnswerText(floor))));
            const nearSet = new Set(uniqNums(near.indices));
            out = out.filter((idx) => {
                if (nearSet.has(idx)) return false;
                const floors = (ctx.rows[idx]?.floors || []).map(normalizeAnswerText);
                return !nearFloors.size || floors.some((floor) => nearFloors.has(floor));
            });
        }
    }
    return out;
}

function fieldValueMatchesFilterPhrase(value: string, phrase: string): boolean {
    const clean = normalizeAnswerText(value);
    const q = normalizeAnswerText(phrase);
    if (!clean || !q) return false;
    const compact = clean.replace(/\s+/g, "");
    const compactQ = q.replace(/\s+/g, "");
    if (clean === q || compact === compactQ) return true;
    const strict = q.length <= 3 || q.split(/\s+/g).every((token) => token.length <= 3);
    if (strict) return false;
    return clean.indexOf(q) >= 0 || q.indexOf(clean) >= 0;
}

function canonicalBreakdownFieldValue(ctx: AssistantAnswerContext, row: NonNullable<AssistantAnswerContext["rows"][number]>, field: string): string {
    const clean = normalizeAnswerText(field);
    const exactFilter = filterFieldKeyForRank(ctx, field);
    if (exactFilter && normalizeAnswerText(exactFilter) === clean) return matrixCleanLabel((row.filters || {})[exactFilter]);
    if (/^(assigned\s+sales\s+category|sales\s+category|category|categories)$/.test(clean)) return matrixCleanLabel(row.category || matrixFilterFieldValue(row, ["Assigned Sales Category", "Sales Category", "Category"]));
    if (/^(assigned\s+group|group|groups)$/.test(clean)) return matrixCleanLabel(row.group || matrixFilterFieldValue(row, ["Assigned Group", "Group"]));
    if (/^(assigned\s+tenant\s+name|assigned\s+tenant|tenant\s+name|tenant\s+names|tenant|tenants)$/.test(clean)) return matrixCleanLabel(matrixFilterFieldValue(row, ["Assigned Tenant Name", "Assigned Tenant", "Tenant Name", "Tenant"]) || row.tenant || row.unitId || row.combinedUnit || "");
    if (/^(assigned\s+unit|unit|units|unit\s+id|unit\s+ids|unit\s+name|unit\s+names)$/.test(clean)) return matrixCleanLabel(row.unitId || row.combinedUnit || matrixFilterFieldValue(row, ["Assigned Unit", "Unit", "Unit ID", "Unit Name"]));
    if (/^(floor|floors|level|levels)$/.test(clean)) return (row.floors || []).map(matrixCleanLabel).filter(Boolean).join(", ");
    if (/^(zone|zones|region|regions)$/.test(clean)) return entityLabelsForRow(ctx, "zone", row.idx).map(matrixCleanLabel).filter(Boolean).join(", ");
    if (/^(layer|layers)$/.test(clean)) return entityLabelsForRow(ctx, "layer", row.idx).map(matrixCleanLabel).filter(Boolean).join(", ");
    return matrixCleanLabel((row.filters || {})[field]);
}

function rowIndicesForBreakdownFieldFilter(ctx: AssistantAnswerContext, fields: string[], filter: ParsedAssistantFilter): number[] {
    if (filter.type === "metricCondition") return [];
    if (filter.type && !/^(category|group|filter)$/i.test(filter.type)) return [];
    const wantedFields = (fields || []).map((field) => String(field || "").trim()).filter(Boolean);
    if (!wantedFields.length) return [];
    return uniqNums((ctx.rows || [])
        .filter((row) => wantedFields.some((field) => fieldValueMatchesFilterPhrase(canonicalBreakdownFieldValue(ctx, row, field), filter.phrase)))
        .map((row) => row.idx));
}

function filterRowIndicesForFieldBreakdown(ctx: AssistantAnswerContext, indices: number[], parsed: ParsedAssistantQuestion | undefined, fields: string[]): number[] {
    let out = uniqNums(indices);
    const filters = parsed?.filters;
    if (!filters) return out;
    const include = filters.includeFilters || [];
    const exclude = filters.excludeFilters || [];
    const remainingInclude: ParsedAssistantFilter[] = [];
    const remainingExclude: ParsedAssistantFilter[] = [];
    include.forEach((filter) => {
        const fieldMatches = rowIndicesForBreakdownFieldFilter(ctx, fields, filter);
        if (fieldMatches.length) out = intersectNums(out, fieldMatches);
        else remainingInclude.push(filter);
    });
    exclude.forEach((filter) => {
        const fieldMatches = rowIndicesForBreakdownFieldFilter(ctx, fields, filter);
        if (fieldMatches.length) {
            const remove = new Set(fieldMatches);
            out = out.filter((idx) => !remove.has(idx));
        } else {
            remainingExclude.push(filter);
        }
    });
    const remainingFilters = {
        ...filters,
        includeFilters: remainingInclude,
        excludeFilters: remainingExclude
    };
    return filterRowIndicesByParsed(ctx, out, { ...(parsed as ParsedAssistantQuestion), filters: remainingFilters });
}

function filterEntitiesByParsed(ctx: AssistantAnswerContext, entities: AssistantEntity[], parsed?: ParsedAssistantQuestion): AssistantEntity[] {
    return entities
        .map((entity) => ({ ...entity, indices: filterRowIndicesByParsed(ctx, entity.indices, parsed) }))
        .filter((entity) => entity.indices.length > 0);
}

function builtInValue(ctx: AssistantAnswerContext, metric: AssistantMetric, indices: number[]): number {
    const unique = metric.key === "__builtin::area" ? selectedScopedIndices(ctx, indices) : uniqNums(indices);
    if (!unique.length) return NaN;
    if (metric.key === "__builtin::units") {
        const keys = new Set<string>();
        unique.forEach((idx) => {
            const row = ctx.rows[idx];
            if (!row) return;
            keys.add(row.combinedUnit || row.unitId || row.shapeKey || `row-${idx}`);
        });
        return keys.size;
    }
    if (metric.key === "__builtin::area") {
        const entries: Array<{ key: string; parts: Set<string>; area: number }> = [];
        unique.forEach((idx) => {
            const row = ctx.rows[idx];
            const area = Number(row?.area);
            if (!row || !Number.isFinite(area)) return;
            const key = row.combinedUnit || row.unitId || row.shapeKey || `row-${idx}`;
            const parts = new Set(String(key || "")
                .split(/[|,]/g)
                .map((part) => part.trim())
                .filter(Boolean));
            if (!parts.size) parts.add(key);
            entries.push({ key, parts, area });
        });
        const filtered = entries.filter((entry, index) => {
            return !entries.some((other, otherIndex) => {
                if (otherIndex === index || other.parts.size <= entry.parts.size) return false;
                for (const part of Array.from(entry.parts.values())) {
                    if (!other.parts.has(part)) return false;
                }
                return true;
            });
        });
        const areaByUnit = new Map<string, number>();
        filtered.forEach((entry) => {
            const prev = areaByUnit.get(entry.key);
            if (prev === undefined || entry.area > prev) areaByUnit.set(entry.key, entry.area);
        });
        const area = Array.from(areaByUnit.values()).reduce((sum, value) => sum + value, 0);
        if (area > 0) return area;
        return area;
    }
    if (metric.key === "__builtin::vacant") {
        return unique.reduce((sum, idx) => {
            const row = ctx.rows[idx];
            const text = `${row?.tenant || ""} ${row?.category || ""} ${row?.group || ""}`.toLowerCase();
            return sum + (/vacant|empty|available/.test(text) ? 1 : 0);
        }, 0);
    }
    if (metric.key === "__builtin::occupied") {
        const units = builtInValue(ctx, { ...metric, key: "__builtin::units" }, unique);
        const vacant = builtInValue(ctx, { ...metric, key: "__builtin::vacant" }, unique);
        return units - vacant;
    }
    if (metric.key === "__builtin::occupancy") {
        const units = builtInValue(ctx, { ...metric, key: "__builtin::units" }, unique);
        const occupied = builtInValue(ctx, { ...metric, key: "__builtin::occupied" }, unique);
        return units > 0 ? (occupied / units) * 100 : NaN;
    }
    return NaN;
}

function distinctUnitCount(ctx: AssistantAnswerContext, indices: number[]): number {
    return builtInValue(ctx, { key: "__builtin::units", name: "Units", kind: "builtin", aliases: [] }, indices);
}

function visibleSingleUnitArea(ctx: AssistantAnswerContext, indices: number[]): number {
    const unique = selectedScopedIndices(ctx, indices);
    if (distinctUnitCount(ctx, unique) !== 1) return NaN;
    const rows = unique
        .map((idx) => ctx.rows[idx])
        .filter(Boolean);
    const visibleRows = rows.filter((row) => row.visibleOnMap);
    const visibleCombinedRows = visibleRows.filter((row) => String(row.combinedUnit || "").trim());
    const combinedRows = rows.filter((row) => String(row.combinedUnit || "").trim());
    const sourceRows = visibleCombinedRows.length ? visibleCombinedRows : (visibleRows.length ? visibleRows : (combinedRows.length ? combinedRows : rows));
    for (const row of sourceRows) {
        const area = Number(row.area);
        if (Number.isFinite(area) && area > 0) return area;
    }
    return NaN;
}

function selectAction(entity: AssistantEntity, label?: string): AssistantAction {
    return {
        kind: "select",
        label: label || `Select ${entity.label} in report`,
        indices: uniqNums(entity.indices)
    };
}

function wantsMapShow(parsed: ParsedAssistantQuestion): boolean {
    const tokens = new Set((parsed.tokens || []).map((token) => String(token || "").toLowerCase()));
    return tokens.has("show") || tokens.has("display") || tokens.has("select") || tokens.has("zoom") || tokens.has("focus");
}

function wantsTable(parsed?: ParsedAssistantQuestion): boolean {
    const tokens = new Set((parsed?.tokens || []).map((token) => String(token || "").toLowerCase()));
    return tokens.has("table") || tokens.has("tabular") || tokens.has("grid") || tokens.has("rows") || tokens.has("row");
}

function wantsAllValues(parsed?: ParsedAssistantQuestion): boolean {
    const tokens = new Set((parsed?.tokens || []).map((token) => String(token || "").toLowerCase()));
    return tokens.has("all") || tokens.has("both") || tokens.has("each") || tokens.has("every") || tokens.has("list") || wantsTable(parsed);
}

function unitKeyForRow(row: NonNullable<AssistantAnswerContext["rows"][number]>): string {
    return row.combinedUnit || row.unitId || row.shapeKey || `row-${row.idx}`;
}

function unitLabelForRow(row: NonNullable<AssistantAnswerContext["rows"][number]>, fallback: string): string {
    const unit = row.unitId || row.shapeKey || "";
    return unit ? `${fallback} (${unit})` : fallback;
}

function splitEntityByUnit(ctx: AssistantAnswerContext, entity: AssistantEntity): AssistantEntity[] {
    const byUnit = new Map<string, number[]>();
    uniqNums(entity.indices).forEach((idx) => {
        const row = ctx.rows[idx];
        if (!row) return;
        const key = unitKeyForRow(row);
        if (!byUnit.has(key)) byUnit.set(key, []);
        byUnit.get(key)!.push(idx);
    });
    if (byUnit.size <= 1) return [entity];
    return Array.from(byUnit.entries()).map(([key, indices], index) => {
        const first = ctx.rows[indices[0]];
        return {
            id: `${entity.kind}:${entity.id}:unit:${key || index}`,
            kind: "unit",
            label: unitLabelForRow(first, entity.label),
            aliases: [entity.label, first?.tenant || "", first?.unitId || "", first?.combinedUnit || "", first?.shapeKey || ""].filter(Boolean),
            indices
        } as AssistantEntity;
    });
}

function expandDuplicateTenantCompareEntities(
    ctx: AssistantAnswerContext,
    entities: AssistantEntity[],
    parsed?: ParsedAssistantQuestion
): AssistantEntity[] {
    const wantsSplit = wantsAllValues(parsed);
    const out: AssistantEntity[] = [];
    entities.forEach((entity) => {
        if (entity.kind === "tenant" && (wantsSplit || entities.length === 1)) {
            splitEntityByUnit(ctx, entity).forEach((item) => out.push(item));
        } else {
            out.push(entity);
        }
    });
    return out;
}

function wantsDependencyInfo(parsed?: ParsedAssistantQuestion): boolean {
    const tokens = new Set((parsed?.tokens || []).map((token) => String(token || "").toLowerCase()));
    return tokens.has("depends") || tokens.has("dependency") || tokens.has("dependencies") || tokens.has("uses") || tokens.has("used");
}

function requestedDetailFields(ctx: AssistantAnswerContext, parsed?: ParsedAssistantQuestion): string[] {
    const baseNames = new Set(["unit", "tenant", "assigned tenant", "assigned tenant name", "category", "assigned sales category", "group", "assigned group", "floor", "area"]);
    const candidates = ([] as string[])
        .concat(parsed?.requestedFields?.rows || [])
        .concat(parsed?.requestedFields?.columns || [])
        .concat(parsed?.requestedFields?.values || [])
        .concat(parsed?.requestedFields?.metrics || [])
        .concat(parsed?.requestedFields?.entities || [])
        .concat(parsed?.metricPhrases || [])
        .concat(parsed?.entityPhrases || [])
        .map((field) => String(field || "").trim())
        .filter(Boolean);
    const available = new Map<string, string>();
    (ctx.rows || []).slice(0, 200).forEach((row) => {
        Object.keys(row.filters || {}).forEach((field) => {
            const clean = normalizeAnswerText(field);
            if (clean && !available.has(clean)) available.set(clean, field);
        });
    });
    return candidates
        .map((field) => {
            const clean = normalizeAnswerText(field);
            if (!clean || baseNames.has(clean)) return "";
            return available.get(clean) || "";
        })
        .filter(Boolean)
        .filter((field, index, arr) => arr.findIndex((item) => normalizeAnswerText(item) === normalizeAnswerText(field)) === index)
        .slice(0, 8);
}

function rowDetailTable(ctx: AssistantAnswerContext, indices: number[], metric?: AssistantMetric, extraFields: string[] = []): string[][] {
    const seen = new Set<string>();
    const metricNames = new Set<string>();
    if (metric) {
        [metric.name].concat(metric.aliases || []).forEach((name) => {
            const clean = normalizeAnswerText(name);
            if (clean) metricNames.add(clean);
        });
    }
    const fields = (extraFields || [])
        .map((field) => String(field || "").trim())
        .filter(Boolean)
        .filter((field) => !metricNames.has(normalizeAnswerText(field)))
        .filter((field, index, arr) => arr.findIndex((item) => normalizeAnswerText(item) === normalizeAnswerText(field)) === index);
    return uniqNums(indices)
        .map((idx) => ctx.rows[idx])
        .filter(Boolean)
        .map((row) => {
            const unit = row.unitId || row.shapeKey || "";
            const tenant = row.tenant || "";
            const key = `${unit}::${tenant}::${row.category || ""}::${row.group || ""}::${(row.floors || []).join("|")}`;
            if (seen.has(key)) return null;
            seen.add(key);
            const base = [
                unit || "N/A",
                tenant || "N/A",
                row.category || "N/A",
                row.group || "N/A",
                (row.floors || []).filter(Boolean).join(", ") || "N/A",
                typeof row.area === "number" && Number.isFinite(row.area) ? ctx.formatNumber(row.area, { maximumFractionDigits: 0 }) : "N/A"
            ];
            fields.forEach((field) => base.push(String((row.filters || {})[field] || "N/A")));
            if (!metric) return base;
            const value = resolveMetricValue(ctx, metric, [row.idx]);
            return base.concat(formatAssistantMetric(ctx, metric, value));
        })
        .filter((row): row is string[] => !!row)
        .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base", numeric: true }) || a[1].localeCompare(b[1], undefined, { sensitivity: "base", numeric: true }));
}

function parseAssistantNumberText(value: unknown): number {
    const clean = String(value ?? "")
        .replace(/,/g, "")
        .replace(/[^\d.+-]/g, "")
        .trim();
    if (!clean || clean === "-" || clean === "." || clean === "+") return NaN;
    const num = Number(clean);
    return Number.isFinite(num) ? num : NaN;
}

function metricRowFieldFallbackValue(ctx: AssistantAnswerContext, metric: AssistantMetric, indices: number[]): number {
    const labels = [metric.name].concat(metric.aliases || [])
        .map((label) => normalizeAnswerText(label))
        .filter(Boolean);
    if (!labels.length) return NaN;
    let sum = 0;
    let count = 0;
    uniqNums(indices).forEach((idx) => {
        const row = ctx.rows[idx];
        if (!row?.filters) return;
        const key = Object.keys(row.filters).find((field) => labels.indexOf(normalizeAnswerText(field)) >= 0);
        if (!key) return;
        const value = parseAssistantNumberText(row.filters[key]);
        if (!Number.isFinite(value)) return;
        sum += value;
        count += 1;
    });
    return count > 0 ? sum : NaN;
}

function tenantListTable(ctx: AssistantAnswerContext, rows: NonNullable<AssistantAnswerContext["rows"][number]>[], extraFields: string[] = []): string[][] {
    const byTenant = new Map<string, { label: string; indices: number[] }>();
    rows.forEach((row) => {
        const label = String(row.tenant || row.unitId || row.shapeKey || `Row ${row.idx + 1}`).trim();
        if (!label) return;
        const key = label.toLowerCase();
        const existing = byTenant.get(key);
        if (existing) {
            existing.indices.push(row.idx);
        } else {
            byTenant.set(key, { label, indices: [row.idx] });
        }
    });
    const fields = (extraFields || [])
        .map((field) => String(field || "").trim())
        .filter(Boolean)
        .filter((field, index, arr) => arr.findIndex((item) => normalizeAnswerText(item) === normalizeAnswerText(field)) === index);
    return Array.from(byTenant.values())
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true }))
        .map((item) => {
            const indices = uniqNums(item.indices);
            const rowValues = [item.label];
            fields.forEach((field) => rowValues.push(distinctRowValues(ctx, indices, (row) => (row.filters || {})[field])));
            return rowValues;
        });
}

export function resolveMetricValue(ctx: AssistantAnswerContext, metric: AssistantMetric, indices: number[]): number {
    if (metric.kind === "builtin") return builtInValue(ctx, metric, indices);
    const unique = uniqNums(indices);
    const singleValues = (): number[] => unique
        .map((idx) => ctx.getMetricValue(metric.key, [idx]))
        .filter(validValue);
    if (metric.aggregationHint === "average") {
        const values = singleValues();
        if (values.length) return values.reduce((sum, value) => sum + value, 0) / values.length;
    }
    if (metric.aggregationHint === "min") {
        const values = singleValues();
        if (values.length) return Math.min(...values);
    }
    if (metric.aggregationHint === "max") {
        const values = singleValues();
        if (values.length) return Math.max(...values);
    }
    const value = ctx.getMetricValue(metric.key, unique);
    if (matrixMetricDedupeKey(metric) === "__semantic::generic-area" && (!validValue(value) || Math.abs(value) < 1e-12)) {
        const areaValue = builtInValue(ctx, { key: "__builtin::area", name: "Area", kind: "builtin", aliases: [] }, unique);
        if (validValue(areaValue) && Math.abs(areaValue) > 1e-12) return areaValue;
        const fieldValue = metricRowFieldFallbackValue(ctx, metric, unique);
        if (validValue(fieldValue) && Math.abs(fieldValue) > 1e-12) return fieldValue;
    }
    return value;
}

function percentilePosition(value: number, values: number[]): number {
    const clean = values.filter(validValue).sort((a, b) => a - b);
    if (!validValue(value) || clean.length <= 1) return NaN;
    const belowOrEqual = clean.filter((item) => item <= value).length;
    return Math.max(0, Math.min(1, belowOrEqual / clean.length));
}

function quantileValue(values: number[], p: number): number {
    const clean = values.filter(validValue).sort((a, b) => a - b);
    if (!clean.length) return NaN;
    if (clean.length === 1) return clean[0];
    const pos = (clean.length - 1) * p;
    const lower = Math.floor(pos);
    const upper = Math.ceil(pos);
    const weight = pos - lower;
    return clean[lower] + (clean[upper] - clean[lower]) * weight;
}

function usableBenchmarkValue(metric: AssistantMetric, value: number): boolean {
    if (!validValue(value)) return false;
    const kind = metricSemanticKind(metric);
    if (kind === "area" || kind === "sales" || kind === "rent" || kind === "units" || kind === "occupancy" || kind === "ocr") {
        return value > 0;
    }
    return true;
}

function benchmarkMeaning(percentile: 90 | 75 | 50 | 25, count: number, noun: string): string {
    const n = Math.max(0, Math.round(count));
    const label = n === 1 ? noun.replace(/s$/i, "") : noun;
    if (percentile === 90) return `${Math.round(n * 0.10)} ${label} higher than:`;
    if (percentile === 75) return `${Math.round(n * 0.25)} ${label} higher than:`;
    if (percentile === 50) return `${Math.round(n * 0.50)} ${label} higher than:`;
    return `${Math.round(n * 0.25)} ${label} lower than:`;
}

function concentrationLabel(value: number): string {
    if (!validValue(value)) return "N/A";
    const pct = value * 100;
    const formatted = `${pct.toFixed(1).replace(/\.0$/, "")}%`;
    if (Math.abs(pct) < 5) return `${formatted} - balanced`;
    if (pct >= 25) return `${formatted} - high dependence on few strong tenants`;
    if (pct >= 10) return `${formatted} - moderate dependence on top tenants`;
    if (pct > 0) return `${formatted} - slight top-tenant concentration`;
    if (pct <= -25) return `${formatted} - many tenants are above the average`;
    return `${formatted} - average is below median`;
}

function buildBenchmarkStatisticsTable(
    ctx: AssistantAnswerContext,
    metrics: AssistantMetric[],
    entityIndices: number[][],
    noun: string,
    valueResolver: (metric: AssistantMetric, indices: number[]) => number,
    valueFormatter: (metric: AssistantMetric, value: number) => string
): NonNullable<AssistantResponse["tables"]>[number] | null {
    const usableMetrics = (metrics || []).filter((metric) =>
        entityIndices.some((indices) => usableBenchmarkValue(metric, valueResolver(metric, indices)))
    ).slice(0, 8);
    if (!usableMetrics.length || entityIndices.length < 2) return null;
    const valuesByMetric = usableMetrics.map((metric) =>
        entityIndices.map((indices) => valueResolver(metric, indices)).filter((value) => usableBenchmarkValue(metric, value))
    );
    const rows = [
        { sn: "1", label: `90th (${benchmarkMeaning(90, entityIndices.length, noun)})`, p: 0.90 },
        { sn: "2", label: `75th (${benchmarkMeaning(75, entityIndices.length, noun)})`, p: 0.75 },
        { sn: "3", label: `50th (${benchmarkMeaning(50, entityIndices.length, noun)})`, p: 0.50 },
        { sn: "4", label: `25th (${benchmarkMeaning(25, entityIndices.length, noun)})`, p: 0.25 }
    ].map((row) => [
        row.sn,
        row.label
    ].concat(usableMetrics.map((metric, index) => valueFormatter(metric, quantileValue(valuesByMetric[index], row.p)))));
    const averageRow = [
        "5",
        "Average"
    ].concat(usableMetrics.map((_metric, index) => {
        const values = valuesByMetric[index];
        const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
        return valueFormatter(usableMetrics[index], avg);
    }));
    return {
        title: `Benchmark Statistics - ${entityIndices.length} ${entityIndices.length === 1 ? noun.replace(/s$/i, "") : noun}`,
        columns: ["SN", "Percentile"].concat(usableMetrics.map((metric) => metric.name)),
        rows: rows.concat([averageRow])
    };
}

function buildTenantConcentrationTable(
    metrics: AssistantMetric[],
    entityIndices: number[][],
    valueResolver: (metric: AssistantMetric, indices: number[]) => number
): NonNullable<AssistantResponse["tables"]>[number] | null {
    const rows = (metrics || []).slice(0, 8).map((metric) => {
        const values = entityIndices.map((indices) => valueResolver(metric, indices)).filter((value) => usableBenchmarkValue(metric, value));
        const median = quantileValue(values, 0.50);
        const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
        const concentration = validValue(avg) && validValue(median) && median !== 0 ? (avg - median) / median : NaN;
        return [metric.name, concentrationLabel(concentration)];
    }).filter((row) => row[1] !== "N/A");
    if (!rows.length || entityIndices.length < 2) return null;
    return {
        title: "Tenant Concentration Indicator",
        columns: ["Metric", "Indicator"],
        rows
    };
}

function wantsBenchmarkStatistics(parsed: ParsedAssistantQuestion): boolean {
    const text = `${parsed.raw || ""} ${parsed.normalized || ""}`.toLowerCase();
    return /\b(benchmark|benchmarks|percentile|percentiles|statistics|statistic|statics|tenant concentration|concentration)\b/.test(text);
}

function requestedPercentileDetail(parsed: ParsedAssistantQuestion): 90 | 75 | 50 | 25 | null {
    const text = `${parsed.raw || ""} ${parsed.normalized || ""}`.toLowerCase();
    const match = text.match(/\b(90|75|50|25)(?:th)?\s+percentile\b/) || text.match(/\bpercentile\s+(90|75|50|25)\b/);
    const pct = Number(match?.[1]);
    return pct === 90 || pct === 75 || pct === 50 || pct === 25 ? pct : null;
}

function benchmarkFallbackDimension(parsed: ParsedAssistantQuestion): ParsedTopBottomQuery["dimensionType"] {
    const text = `${parsed.raw || ""} ${parsed.normalized || ""}`.toLowerCase();
    if (/\bunits?\b/.test(text)) return "unit";
    if (/\bcategor(?:y|ies)\b/.test(text)) return "category";
    if (/\bgroups?\b/.test(text)) return "group";
    if (/\bzones?\b/.test(text)) return "zone";
    if (/\bfloors?\b|\blevels?\b/.test(text)) return "floor";
    if (/\blayers?\b/.test(text)) return "layer";
    return "tenant";
}

export function answerBenchmarkRankFallback(
    ctx: AssistantAnswerContext,
    parsed: ParsedAssistantQuestion,
    metrics: AssistantMetric[]
): AssistantResponse | null {
    const percentileDetail = requestedPercentileDetail(parsed);
    if (!wantsBenchmarkStatistics(parsed) && !percentileDetail) return null;
    const rankMetrics = metrics.filter((candidate, index, arr) =>
        candidate && arr.findIndex((item) => item.key === candidate.key) === index
    ).slice(0, 30);
    const metric = rankMetrics[0];
    if (!metric) return null;
    const rank: ParsedTopBottomQuery = parsed.topBottom || {
        direction: "top",
        limit: 5,
        dimensionType: benchmarkFallbackDimension(parsed),
        metricPhrase: metric.name
    };
    const dimensionName = rank.dimensionType === "filter" && rank.dimensionField
        ? rank.dimensionField
        : dimensionLabel(rank.dimensionType);
    const entities = buildStructuredRankEntities(ctx, rank.dimensionType, parsed);
    const sortDirection = effectiveRankSortDirection(metric, parsed, rank.direction);
    const allSorted = entities
        .map((entity) => ({ entity, value: resolveRankValue(ctx, metric, entity.indices, rank) }))
        .filter((item) => validValue(item.value))
        .filter((item) => conditionMatches(item.value, rank.metricCondition))
        .sort((a, b) => sortDirection === "asc" ? a.value - b.value : b.value - a.value);
    if (!allSorted.length) return null;
    if (percentileDetail) {
        const detailResponse = buildPercentileDetailResponse(
            ctx,
            metric,
            allSorted,
            percentileDetail,
            dimensionName,
            (candidate, value) => formatRankMetricValue(ctx, candidate, value, rank)
        );
        if (detailResponse) return detailResponse;
    }
    const benchmarkTable = buildBenchmarkStatisticsTable(
        ctx,
        rankMetrics,
        allSorted.map((item) => item.entity.indices),
        `${dimensionName.toLowerCase()}${allSorted.length === 1 ? "" : "s"}`,
        (candidate, indices) => resolveRankValue(ctx, candidate, indices, rank),
        (candidate, value) => formatRankMetricValue(ctx, candidate, value, rank)
    );
    const concentrationTable = buildTenantConcentrationTable(
        rankMetrics,
        allSorted.map((item) => item.entity.indices),
        (candidate, indices) => resolveRankValue(ctx, candidate, indices, rank)
    );
    const tables = [benchmarkTable, concentrationTable].filter((table): table is NonNullable<AssistantResponse["tables"]>[number] => !!table);
    if (!tables.length) return null;
    return {
        handled: true,
        text: `Benchmark statistics for ${allSorted.length} ${dimensionName.toLowerCase()}${allSorted.length === 1 ? "" : "s"} by ${rankMetrics.map((item) => item.name).join(", ")}.`,
        tables,
        suggestions: ["Show 90th percentile tenants", "Show 75th percentile tenants", "Show 50th percentile tenants", "Show 25th percentile tenants"]
    };
}

function percentileDetailMeaning(percentile: 90 | 75 | 50 | 25, count: number, noun: string): string {
    const label = count === 1 ? noun.replace(/s$/i, "") : noun;
    if (percentile === 25) return `${count} ${label} at or below the 25th percentile`;
    return `${count} ${label} at or above the ${percentile}th percentile`;
}

function buildPercentileDetailResponse(
    ctx: AssistantAnswerContext,
    metric: AssistantMetric,
    rankedAll: Array<{ entity: AssistantEntity; value: number }>,
    percentile: 90 | 75 | 50 | 25,
    dimensionName: string,
    valueFormatter: (metric: AssistantMetric, value: number) => string,
    extraColumns: Array<{ name: string; value: (entity: AssistantEntity) => string }> = []
): AssistantResponse | null {
    const clean = rankedAll.filter((item) => usableBenchmarkValue(metric, item.value));
    if (!clean.length) return null;
    const threshold = quantileValue(clean.map((item) => item.value), percentile / 100);
    if (!validValue(threshold)) return null;
    const selected = clean
        .filter((item) => percentile === 25 ? item.value <= threshold : item.value >= threshold)
        .sort((a, b) => b.value - a.value);
    if (!selected.length) return null;
    const columns = ["Rank", dimensionName]
        .concat([metric.name])
        .concat(extraColumns.map((column) => column.name));
    const rows = selected.map((item, index) => {
        const indices = item.entity.indices || [];
        return [
            String(index + 1),
            item.entity.label
        ]
            .concat([
                valueFormatter(metric, item.value)
            ])
            .concat(extraColumns.map((column) => column.value(item.entity)));
    });
    const totalIndices = uniqNums(selected.reduce((out: number[], item) => out.concat(item.entity.indices || []), []));
    const totalMetricValue = resolveMetricValue(ctx, metric, totalIndices);
    rows.push([
        "",
        "Total"
    ]
        .concat([
            valueFormatter(metric, totalMetricValue)
        ])
        .concat(extraColumns.map(() => "")));
    const noun = `${dimensionName.toLowerCase()}s`;
    return {
        handled: true,
        text: `${percentile}th percentile details: ${percentileDetailMeaning(percentile, selected.length, noun)}. Threshold: ${valueFormatter(metric, threshold)}.`,
        actions: selected.slice(0, 5).map((item) => selectAction(item.entity, `Select ${item.entity.label}`)),
        table: {
            columns,
            rows
        },
        suggestions: ["Show 90th percentile tenants", "Show 75th percentile tenants", "Show 50th percentile tenants", "Show 25th percentile tenants"]
    };
}

function peerTenantEntities(ctx: AssistantAnswerContext, entity: AssistantEntity): AssistantEntity[] {
    const tenants = (ctx.entities || []).filter((item) => item.kind === "tenant" && !isPlaceholderTenantName(item.label) && (item.indices || []).length);
    const categories = new Set((entity.indices || []).map((idx) => normalizeAnswerText(ctx.rows[idx]?.category || "")).filter(Boolean));
    const sameCategory = tenants.filter((tenant) => (tenant.indices || []).some((idx) => categories.has(normalizeAnswerText(ctx.rows[idx]?.category || ""))));
    return sameCategory.length >= 4 ? sameCategory : tenants;
}

function findMetricByKind(ctx: AssistantAnswerContext, kind: ReturnType<typeof metricSemanticKind>): AssistantMetric | null {
    if (kind === "area") return ctx.metrics.find((metric) => metric.key === "__builtin::area") || null;
    if (kind === "units") return ctx.metrics.find((metric) => metric.key === "__builtin::units") || null;
    return ctx.metrics.find((metric) => metric.kind === "dynamic" && metricSemanticKind(metric) === kind) || null;
}

function metricPositionPhrase(metric: AssistantMetric, pct: number): string {
    const direction = metricPerformanceDirection(metric);
    if (!Number.isFinite(pct)) return "";
    if (direction === "lower") {
        if (pct <= 0.25) return `${metric.name} is in the strongest quartile versus peers`;
        if (pct >= 0.75) return `${metric.name} is in the weakest quartile versus peers`;
        return `${metric.name} is around the peer middle range`;
    }
    if (pct >= 0.75) return `${metric.name} is in the strongest quartile versus peers`;
    if (pct <= 0.25) return `${metric.name} is in the weakest quartile versus peers`;
    return `${metric.name} is around the peer middle range`;
}

function buildReasoningInsights(ctx: AssistantAnswerContext, entity: AssistantEntity, requestedMetrics: AssistantMetric[] = []): { sentences: string[]; rows: string[][] } {
    if (!entity || !(entity.indices || []).length) return { sentences: [], rows: [] };
    const preferredKinds: Array<ReturnType<typeof metricSemanticKind>> = ["sales", "rent", "ocr", "occupancy", "vacancy", "area"];
    const metrics = preferredKinds
        .map((kind) => findMetricByKind(ctx, kind))
        .concat((requestedMetrics || []).filter((metric) => metric.kind === "dynamic"))
        .filter((metric): metric is AssistantMetric => !!metric)
        .filter((metric, index, arr) => arr.findIndex((item) => item.key === metric.key) === index)
        .slice(0, 8);
    const peers = peerTenantEntities(ctx, entity);
    const rows: string[][] = [];
    const positions = new Map<string, { metric: AssistantMetric; value: number; pct: number }>();
    metrics.forEach((metric) => {
        const value = metric.key === "__builtin::area" && shouldUsePrimaryAreaForEntity(ctx, entity)
            ? primaryAreaValue(ctx, entity.indices)
            : resolveMetricValue(ctx, metric, entity.indices);
        if (!validValue(value)) return;
        const peerValues = peers.map((peer) => resolveMetricValue(ctx, metric, peer.indices)).filter(validValue);
        const pct = percentilePosition(value, peerValues);
        const phrase = metricPositionPhrase(metric, pct);
        const peerText = Number.isFinite(pct) ? `${Math.round(pct * 100)}th percentile` : "N/A";
        rows.push([metric.name, formatAssistantMetric(ctx, metric, value), peerText, phrase || "No peer signal"]);
        positions.set(metricSemanticKind(metric), { metric, value, pct });
    });

    const sentenceCandidates: string[] = [];
    const sales = positions.get("sales");
    const rent = positions.get("rent");
    const ocr = positions.get("ocr");
    const occupancy = positions.get("occupancy");
    const vacancy = positions.get("vacancy");
    const area = positions.get("area");

    if (sales && ocr && sales.pct >= 0.65 && ocr.pct <= 0.35) {
        sentenceCandidates.push(`${entity.label} looks like a strong performer: sales are above peers while OCR is low.`);
    } else if (sales && ocr && sales.pct <= 0.35 && ocr.pct >= 0.65) {
        sentenceCandidates.push(`${entity.label} shows pressure: sales are weak while OCR is high, which can indicate rent-to-sales stress.`);
    } else if (ocr && ocr.pct >= 0.75) {
        sentenceCandidates.push(`${entity.label} has high OCR versus peers, so review rent pressure or sales productivity.`);
    } else if (ocr && ocr.pct <= 0.25) {
        sentenceCandidates.push(`${entity.label} has low OCR versus peers, which is generally a healthy rent-to-sales signal.`);
    }

    if (rent && sales && rent.pct >= 0.65 && sales.pct <= 0.35) {
        sentenceCandidates.push(`Rent is high while sales are low, pointing to lease-cost pressure.`);
    }
    if (area && sales && area.pct >= 0.65 && sales.pct <= 0.35) {
        sentenceCandidates.push(`Area is large but sales are below peers, suggesting a space productivity issue.`);
    }
    if (occupancy && occupancy.pct >= 0.75) sentenceCandidates.push(`Occupancy is strong versus peers.`);
    if (vacancy && vacancy.pct >= 0.75) sentenceCandidates.push(`Vacancy is elevated versus peers and should be reviewed.`);

    rows.slice(0, 4).forEach((row) => {
        if (sentenceCandidates.length >= 4) return;
        const signal = row[3];
        if (signal && !/middle range|No peer signal/i.test(signal)) sentenceCandidates.push(signal + ".");
    });

    const sentences = Array.from(new Set(sentenceCandidates)).slice(0, 4);
    if (!sentences.length && rows.length) sentences.push(`No major risk signal detected from the available peer metrics.`);
    if (!rows.length) sentences.push(`Reasoning is limited because no comparable KPI values are available for this selection.`);
    return { sentences, rows };
}

function wantsTotalMetric(parsed: ParsedAssistantQuestion): boolean {
    const tokens = new Set((parsed.tokens || []).map((token) => String(token || "").toLowerCase()));
    return tokens.has("sum") || tokens.has("total") || tokens.has("overall") || tokens.has("combined") || tokens.has("all");
}

function primaryAreaValue(ctx: AssistantAnswerContext, indices: number[]): number {
    const visibleArea = visibleSingleUnitArea(ctx, indices);
    if (Number.isFinite(visibleArea)) return visibleArea;
    const unique = selectedScopedIndices(ctx, indices);
    for (const idx of unique) {
        const rowArea = Number(ctx.rows[idx]?.area);
        if (Number.isFinite(rowArea)) return rowArea;
    }
    return NaN;
}

function shouldUsePrimaryAreaForEntity(ctx: AssistantAnswerContext, entity: AssistantEntity): boolean {
    if (entity.kind === "unit") return true;
    if (entity.kind !== "tenant") return false;
    return distinctUnitCount(ctx, entity.indices) === 1;
}

export function formatAssistantMetric(ctx: AssistantAnswerContext, metric: AssistantMetric, value: number): string {
    if (!validValue(value)) return "N/A";
    if (metric.kind === "builtin") {
        if (metric.key === "__builtin::occupancy") return `${ctx.formatNumber(value, { maximumFractionDigits: 1 })}%`;
        return ctx.formatNumber(value, { maximumFractionDigits: metric.key === "__builtin::area" ? 0 : 0 });
    }
    if (metric.formatHint !== "date") {
        const formatted = ctx.formatMetricValue(metric.key, value);
        const looksLikeDate = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(formatted || "");
        if (!looksLikeDate) return formatted;
        return ctx.formatNumber(value, { maximumFractionDigits: metric.decimalPlaces ?? 0 });
    }
    return ctx.formatMetricValue(metric.key, value);
}

function heatmapChartMetrics(ctx: AssistantAnswerContext, current: AssistantMetric): AssistantMetric[] {
    const out: AssistantMetric[] = [];
    const push = (metric: AssistantMetric | undefined) => {
        if (!metric) return;
        if (metric.formatHint === "text") return;
        if (out.some((item) => item.key === metric.key || normalizeAnswerText(item.name) === normalizeAnswerText(metric.name))) return;
        out.push(metric);
    };
    push(current);
    const selectedKeys = ctx.heatmapSelectedKeys || [];
    if (selectedKeys.length) {
        selectedKeys.forEach((key) => push((ctx.metrics || []).find((metric) => metric.key === key)));
    } else {
        (ctx.metrics || [])
            .filter((metric) => metric.kind === "dynamic" && metric.role === "heatmap")
            .forEach(push);
    }
    return out.slice(0, 30);
}

function buildHeatmapChartSeries(
    ctx: AssistantAnswerContext,
    current: AssistantMetric,
    labels: string[],
    indexGroups: number[][]
): NonNullable<NonNullable<AssistantResponse["chart"]>["series"]> {
    return heatmapChartMetrics(ctx, current)
        .map((metric) => {
            const values = indexGroups.map((indices) => resolveMetricValue(ctx, metric, indices));
            return {
                name: metric.name,
                labels,
                values: values.map((value) => validValue(value) ? value : 0),
                valueLabels: values.map((value) => formatAssistantMetric(ctx, metric, value)),
                hasData: values.some(validValue)
            };
        })
        .filter((series) => series.hasData)
        .map(({ hasData, ...series }) => series);
}

function breakdownDimensionLabel(dimension: NonNullable<ParsedAssistantQuestion["breakdown"]>["dimensions"][number]): string {
    if (dimension === "tenant") return "Tenant";
    if (dimension === "unit") return "Unit";
    if (dimension === "category") return "Category";
    if (dimension === "group") return "Group";
    if (dimension === "zone") return "Zone";
    if (dimension === "floor") return "Floor";
    return "Layer";
}

function entityLabelsForRow(ctx: AssistantAnswerContext, kind: "zone" | "layer", idx: number): string[] {
    return (ctx.entities || [])
        .filter((entity) => entity.kind === kind && (entity.indices || []).indexOf(idx) >= 0)
        .map((entity) => String(entity.label || "").trim())
        .filter(Boolean);
}

function rowDimensionValues(
    ctx: AssistantAnswerContext,
    row: NonNullable<AssistantAnswerContext["rows"][number]>,
    dimension: NonNullable<ParsedAssistantQuestion["breakdown"]>["dimensions"][number]
): string[] {
    if (dimension === "tenant") return [row.tenant || row.unitId || row.shapeKey || "N/A"];
    if (dimension === "unit") return [row.unitId || row.shapeKey || row.combinedUnit || "N/A"];
    if (dimension === "category") return [row.category || "N/A"];
    if (dimension === "group") return [row.group || "N/A"];
    if (dimension === "floor") return (row.floors || []).filter(Boolean).length ? (row.floors || []).filter(Boolean) : ["N/A"];
    if (dimension === "zone") {
        const labels = entityLabelsForRow(ctx, "zone", row.idx);
        return labels.length ? labels : ["N/A"];
    }
    const labels = entityLabelsForRow(ctx, "layer", row.idx);
    return labels.length ? labels : ["N/A"];
}

function addBreakdownCombinations(
    ctx: AssistantAnswerContext,
    row: NonNullable<AssistantAnswerContext["rows"][number]>,
    dimensions: NonNullable<ParsedAssistantQuestion["breakdown"]>["dimensions"],
    onCombo: (values: string[]) => void
): void {
    const sets = dimensions.map((dimension) => rowDimensionValues(ctx, row, dimension));
    const walk = (index: number, values: string[]) => {
        if (index >= sets.length) {
            onCombo(values);
            return;
        }
        sets[index].forEach((value) => walk(index + 1, values.concat(value)));
    };
    walk(0, []);
}

export function answerBreakdown(
    ctx: AssistantAnswerContext,
    parsed: ParsedAssistantQuestion,
    entities: AssistantEntity[],
    metric: AssistantMetric,
    extraMetrics: AssistantMetric[] = []
): AssistantResponse {
    const dimensions = parsed.breakdown?.dimensions || [];
    if (!dimensions.length) return { handled: false, text: "I could not identify the breakdown dimension." };
    const scopeEntities = entities.filter(isRankScopeEntity);
    const scopeIndices = combineScopeIndices(scopeEntities);
    const baseIndices = scopeIndices || ctx.rows.map((row) => row.idx);
    const filteredIndices = filterRowIndicesByParsed(ctx, baseIndices, parsed);
    const groups = new Map<string, { values: string[]; indices: number[] }>();

    filteredIndices.forEach((idx) => {
        const row = ctx.rows[idx];
        if (!row) return;
        addBreakdownCombinations(ctx, row, dimensions, (values) => {
            const key = values.map((value) => normalizeAnswerText(value)).join("||");
            const existing = groups.get(key);
            if (existing) {
                if (existing.indices.indexOf(idx) < 0) existing.indices.push(idx);
            } else {
                groups.set(key, { values, indices: [idx] });
            }
        });
    });

    const breakdownMetrics = [metric].concat(extraMetrics).filter((item, index, arr) => item && arr.findIndex((candidate) => candidate.key === item.key) === index);
    const allRows = Array.from(groups.values())
        .map((item) => {
            const indices = uniqNums(item.indices);
            const value = resolveMetricValue(ctx, metric, indices);
            return { ...item, indices, value };
        })
        .filter((item) => item.indices.length > 0)
        .sort((a, b) => {
            const av = validValue(a.value) ? a.value : Number.NEGATIVE_INFINITY;
            const bv = validValue(b.value) ? b.value : Number.NEGATIVE_INFINITY;
            return bv - av || a.values.join(" ").localeCompare(b.values.join(" "), undefined, { sensitivity: "base", numeric: true });
        });

    if (!allRows.length) {
        const scopeText = scopeTextForEntities(scopeEntities);
        return { handled: true, text: `No ${metric.name} breakdown found${scopeText ? ` in ${scopeText}` : ""}.` };
    }

    const limit = Math.max(1, Math.min(50, parsed.limit || 50));
    const shown = allRows.slice(0, limit);
    const rows = shown.map((item) => item.values.concat(
        breakdownMetrics.map((candidate) => formatAssistantMetric(ctx, candidate, resolveMetricValue(ctx, candidate, item.indices)))
    ));
    const totalIndices = uniqNums(allRows.reduce((out: number[], item) => out.concat(item.indices), []));
    rows.push(dimensions.map(() => "").concat(
        breakdownMetrics.map((candidate) => formatAssistantMetric(ctx, candidate, resolveMetricValue(ctx, candidate, totalIndices)))
    ));
    rows[rows.length - 1][0] = "Total";

    const scopeText = scopeTextForEntities(scopeEntities);
    const dimensionText = dimensions.map(breakdownDimensionLabel).join(" / ");
    const hasMore = allRows.length > shown.length;
    return {
        handled: true,
        text: `${breakdownMetrics.map((item) => item.name).join(" and ")} by ${dimensionText}${scopeText ? ` in ${scopeText}` : ""}: ${shown.length} row${shown.length !== 1 ? "s" : ""} shown${hasMore ? `, ${allRows.length - shown.length} more not shown` : ""}.${metricCalculationNotes(breakdownMetrics)}`,
        actions: scopeEntities.length ? [selectAction({ ...scopeEntities[0], indices: filteredIndices }, `Select ${scopeText}`)] : undefined,
        table: {
            columns: dimensions.map(breakdownDimensionLabel).concat(breakdownMetrics.map((item) => item.name)),
            rows
        },
        chart: parsed.chartType && dimensions.length === 1 ? {
            type: parsed.chartType,
            title: `${metric.name} by ${dimensionText}`,
            labels: shown.map((item) => item.values[0]),
            values: shown.map((item) => validValue(item.value) ? item.value : 0),
            valueLabels: shown.map((item) => formatAssistantMetric(ctx, metric, item.value))
        } : undefined
    };
}

function cardinalityFallbackReasonText(ctx: AssistantAnswerContext, parsed: ParsedAssistantQuestion, fields: string[]): string {
    const reasons = parsed.detectedIntent?.reasons || [];
    if (!reasons.some((reason) => /cardinality_table_fallback/i.test(reason))) return "";
    const thresholdPct = Math.max(1, Math.min(100, Number(ctx.matrixConfig?.cardinalityMatrixThresholdPct ?? 25)));
    const stats = fields
        .map((field) => {
            const values = new Set<string>();
            (ctx.rows || []).forEach((row) => {
                const clean = normalizeAnswerText(canonicalBreakdownFieldValue(ctx, row, field));
                if (clean && !/^(n\/a|na|none|null|undefined|-)$/.test(clean)) values.add(clean);
            });
            return { field, count: values.size };
        })
        .filter((item) => item.count > 0);
    if (!stats.length) return " Table selected by cardinality check.";
    const highest = Math.max(...stats.map((item) => item.count));
    const threshold = highest * (thresholdPct / 100);
    const highCardinalityFields = stats.filter((item) => item.count > threshold);
    if (highCardinalityFields.length <= 1) return " Table selected by cardinality check.";
    const summary = highCardinalityFields
        .map((item) => `${item.field} has ${ctx.formatNumber(item.count, { maximumFractionDigits: 0 })} distinct values`)
        .join(", ");
    return ` Table selected by cardinality check: ${summary}, more than one field is above the ${thresholdPct}% threshold (${ctx.formatNumber(threshold, { maximumFractionDigits: 0 })}).`;
}

function pruneBreakdownMetricsToExplicitRequest(parsed: ParsedAssistantQuestion, metrics: AssistantMetric[]): AssistantMetric[] {
    const cleanMetrics = (metrics || [])
        .filter(Boolean)
        .filter((item, index, arr) => arr.findIndex((candidate) => candidate.key === item.key) === index);
    if (!cleanMetrics.length) return [];
    const raw = String(parsed.raw || parsed.normalized || "");
    if (/#\s*[\w]/.test(raw)) return cleanMetrics;
    const normalizedRaw = ` ${normalizeAnswerText(raw.replace(/\b(area|rent|sales|ocr|units?|sqm|m2)of\b/ig, "$1 of"))} `;
    const rawExactKeys = new Set(cleanMetrics
        .filter((metric) => {
            const name = normalizeAnswerText(metric.name || "");
            return name.length >= 2 && normalizedRaw.indexOf(` ${name} `) >= 0;
        })
        .map((metric) => metric.key));
    if (rawExactKeys.size) return cleanMetrics.filter((metric) => rawExactKeys.has(metric.key));
    const explicitNames = new Set(([] as string[])
        .concat(parsed.explicitMetricPhrase ? [parsed.explicitMetricPhrase] : [])
        .concat(parsed.metricPhrases || [])
        .concat(parsed.matrix?.values || [])
        .concat(parsed.matrix?.metricPhrases || [])
        .concat(parsed.matrix?.metricPhrase ? [parsed.matrix.metricPhrase] : [])
        .concat(parsed.requestedFields?.values || [])
        .concat(parsed.requestedFields?.metrics || [])
        .map((value) => normalizeAnswerText(value))
        .filter(Boolean));
    if (!explicitNames.size) return cleanMetrics;
    const explicitKeys = new Set(cleanMetrics
        .filter((metric) => explicitNames.has(normalizeAnswerText(metric.name || "")))
        .map((metric) => metric.key));
    return explicitKeys.size ? cleanMetrics.filter((metric) => explicitKeys.has(metric.key)) : cleanMetrics;
}

export function answerFilterFieldBreakdown(
    ctx: AssistantAnswerContext,
    parsed: ParsedAssistantQuestion,
    metric: AssistantMetric,
    fieldKeys: string[],
    extraMetrics: AssistantMetric[] = []
): AssistantResponse {
    const fields = Array.from(new Set((fieldKeys || []).map((field) => String(field || "").trim()).filter(Boolean))).slice(0, 4);
    if (!fields.length) return { handled: false, text: "I could not identify the selected field." };
    const groups = new Map<string, { values: string[]; indices: number[] }>();
    const baseIndices = filterRowIndicesForFieldBreakdown(ctx, ctx.rows.map((row) => row.idx), parsed, fields);
    baseIndices.forEach((idx) => {
        const row = ctx.rows[idx];
        if (!row) return;
        const values = fields.map((field) => {
            const value = canonicalBreakdownFieldValue(ctx, row, field);
            return value && !/^n\/a$|^na$|^none$|^null$|^undefined$|^-$/i.test(value) ? value : "N/A";
        });
        const key = values.map((value) => normalizeAnswerText(value)).join("||");
        const existing = groups.get(key);
        if (existing) {
            if (existing.indices.indexOf(idx) < 0) existing.indices.push(idx);
        } else {
            groups.set(key, { values, indices: [idx] });
        }
    });
    const normalizedFields = new Set(fields.map((field) => normalizeAnswerText(field)));
    const breakdownMetrics = pruneBreakdownMetricsToExplicitRequest(parsed, [metric].concat(extraMetrics)
        .filter((item, index, arr) => item && arr.findIndex((candidate) => candidate.key === item.key) === index)
        .filter((item) => !normalizedFields.has(normalizeAnswerText(item.name))));
    const includeMetricColumns = breakdownMetrics.length > 0;
    const allRows = Array.from(groups.values())
        .map((item) => {
            const indices = uniqNums(item.indices);
            const value = resolveMetricValue(ctx, metric, indices);
            return { ...item, indices, value };
        })
        .filter((item) => item.indices.length > 0)
        .sort((a, b) => {
            const av = validValue(a.value) ? a.value : Number.NEGATIVE_INFINITY;
            const bv = validValue(b.value) ? b.value : Number.NEGATIVE_INFINITY;
            return bv - av || a.values.join(" ").localeCompare(b.values.join(" "), undefined, { sensitivity: "base", numeric: true });
        });
    if (!allRows.length) return { handled: true, text: `No ${metric.name} breakdown found by ${fields.join(" / ")}.` };
    const offset = Math.max(0, parsed.offset || 0);
    const limit = Math.max(1, Math.min(500, parsed.limit || 100));
    const shown = allRows.slice(offset, offset + limit);
    if (!shown.length) {
        return { handled: true, text: `No more rows to show for ${metric.name} by ${fields.join(" / ")}.` };
    }
    const rows = shown.map((item) => item.values.concat(
        breakdownMetrics.map((candidate) => formatAssistantMetric(ctx, candidate, resolveMetricValue(ctx, candidate, item.indices)))
    ));
    const nextOffset = offset + shown.length;
    const hasMore = allRows.length > nextOffset;
    const remaining = hasMore ? allRows.slice(nextOffset) : [];
    if (remaining.length) {
        const remainingIndices = uniqNums(remaining.reduce((out: number[], item) => out.concat(item.indices), []));
        rows.push(fields.map(() => "").concat(
            breakdownMetrics.map((candidate) => formatAssistantMetric(ctx, candidate, resolveMetricValue(ctx, candidate, remainingIndices)))
        ));
        rows[rows.length - 1][0] = `Others (${remaining.length} more)`;
    }
    const totalIndices = uniqNums(allRows.reduce((out: number[], item) => out.concat(item.indices), []));
    rows.push(fields.map(() => "").concat(
        breakdownMetrics.map((candidate) => formatAssistantMetric(ctx, candidate, resolveMetricValue(ctx, candidate, totalIndices)))
    ));
    rows[rows.length - 1][0] = "Total";
    const dimensionText = fields.join(" / ");
    const rangeText = (offset > 0 || hasMore || allRows.length > shown.length)
        ? `Showing ${offset + 1}-${nextOffset} of ${allRows.length}`
        : `${shown.length} row${shown.length !== 1 ? "s" : ""} shown`;
    const cardinalityReason = cardinalityFallbackReasonText(ctx, parsed, fields);
    const chart = parsed.chartType && fields.length === 1 ? {
        type: parsed.chartType,
        title: `${metric.name} by ${dimensionText}`,
        labels: shown.map((item) => item.values[0]),
        values: shown.map((item) => validValue(item.value) ? item.value : 0),
        valueLabels: shown.map((item) => formatAssistantMetric(ctx, metric, item.value)),
        series: buildHeatmapChartSeries(ctx, metric, shown.map((item) => item.values[0]), shown.map((item) => item.indices))
    } : parsed.chartType && fields.length === 2 ? (() => {
        const primaryLabels = Array.from(new Set(shown.map((item) => item.values[0]).filter(Boolean)));
        const seriesLabels = Array.from(new Set(shown.map((item) => item.values[1]).filter(Boolean))).slice(0, 12);
        const byPair = new Map<string, { value: number; indices: number[] }>();
        shown.forEach((item) => {
            const key = `${normalizeAnswerText(item.values[0])}||${normalizeAnswerText(item.values[1])}`;
            byPair.set(key, { value: validValue(item.value) ? item.value : 0, indices: item.indices });
        });
        const chartSeries = seriesLabels.map((seriesName) => {
            const values = primaryLabels.map((label) => {
                const item = byPair.get(`${normalizeAnswerText(label)}||${normalizeAnswerText(seriesName)}`);
                return item ? item.value : 0;
            });
            return {
                name: seriesName,
                labels: primaryLabels,
                values,
                valueLabels: values.map((value) => formatAssistantMetric(ctx, metric, value))
            };
        });
        const totals = primaryLabels.map((label) => chartSeries.reduce((sum, series) => {
            const index = primaryLabels.indexOf(label);
            return sum + (series.values[index] || 0);
        }, 0));
        return {
            type: parsed.chartType,
            title: `${metric.name} by ${dimensionText}`,
            labels: primaryLabels,
            values: totals,
            valueLabels: totals.map((value) => formatAssistantMetric(ctx, metric, value)),
            series: chartSeries
        };
    })() : undefined;
    return {
        handled: true,
        text: `${breakdownMetrics.length ? breakdownMetrics.map((item) => item.name).join(" and ") : metric.name} by ${dimensionText}${filterSummaryText(parsed)}: ${rangeText}.${cardinalityReason}${metricCalculationNotes(breakdownMetrics.length ? breakdownMetrics : [metric])}`,
        suggestions: hasMore ? ["Show more"] : undefined,
        table: {
            columns: fields.concat(includeMetricColumns ? breakdownMetrics.map((item) => item.name) : []),
            rows,
            editableQuery: {
                fields,
                measures: breakdownMetrics.map((item) => item.name),
                filters: editableFilterTokens(parsed),
                fieldOptions: matrixFieldOptions(ctx).rows,
                measureOptions: matrixFieldOptions(ctx).values
            }
        },
        chart
    };
}

export function answerHelp(ctx: AssistantAnswerContext): AssistantResponse {
    const heatmapMetrics = ctx.metrics.filter((metric) => metric.kind === "dynamic" && metric.role === "heatmap");
    const metricSource = heatmapMetrics.length ? heatmapMetrics : ctx.metrics.filter((metric) => metric.kind === "dynamic");
    const metricNames = metricSource.map((metric) => metric.name).join(", ");
    const metricCount = metricSource.length ? `${metricSource.length} metric${metricSource.length === 1 ? "" : "s"}` : "the fields loaded in the visual";
    return {
        handled: true,
        text: `Ask about tenants, units, categories, zones, layers, floors, or metrics. Available examples: "rent of Zara", "compare Zara and H&M by OCR", "top 5 tenants by sales", "which shops are weak in Zone A", "risky tenants", "summarize Zone A". Heatmap metrics available in chat: ${metricCount}${metricNames ? `: ${metricNames}` : ""}.`,
        suggestions: [
            "show top 5 tenants by sales",
            "which shops are weak in Zone A",
            "show risky tenants",
            "which tenant has highest OCR",
            "show top 5 zones by OCR"
        ]
    };
}

export function answerBookmarkCount(ctx: AssistantAnswerContext): AssistantResponse {
    const bookmarks = (ctx.entities || []).filter((entity) => entity.kind === "bookmark");
    const count = bookmarks.length;
    return {
        handled: true,
        text: count === 1 ? "There is 1 bookmark." : `There are ${ctx.formatNumber(count, { maximumFractionDigits: 0 })} bookmarks.`,
        table: count ? {
            columns: ["Bookmark"],
            rows: bookmarks.map((bookmark) => [bookmark.label])
        } : undefined
    };
}

export function answerEntityCount(ctx: AssistantAnswerContext, kind: AssistantEntity["kind"], label: string): AssistantResponse {
    const items = (ctx.entities || [])
        .filter((entity) => entity.kind === kind)
        .filter((entity) => kind !== "tenant" || !isPlaceholderTenantName(entity.label));
    const unique = items.filter((entity, index, arr) =>
        arr.findIndex((item) => item.kind === entity.kind && item.id === entity.id) === index
    );
    const count = unique.length;
    return {
        handled: true,
        text: count === 1 ? `There is 1 ${label}.` : `There are ${ctx.formatNumber(count, { maximumFractionDigits: 0 })} ${label}s.`,
        table: count ? {
            columns: [label.charAt(0).toUpperCase() + label.slice(1)],
            rows: unique.map((entity) => [entity.label])
        } : undefined
    };
}

export function answerFormula(
    ctx: AssistantAnswerContext,
    parsed: ParsedAssistantQuestion,
    metrics: AssistantMetric[]
): AssistantResponse {
    const customMetrics = (ctx.metrics || []).filter((metric) => metric.isCustomKpi);
    const metric = metrics.find((item) => item.isCustomKpi) || metrics[0];
    if (!metric) {
        const names = customMetrics.slice(0, 8).map((item) => item.name);
        return {
            handled: true,
            text: names.length
                ? `Custom KPIs available: ${names.join(", ")}. Ask for the formula or dependencies of one KPI.`
                : "No custom KPI formulas are loaded in the visual."
        };
    }

    if (!metric.isCustomKpi) {
        const haystack = [metric.name].concat(metric.aliases || []).map((value) => String(value || "").toLowerCase());
        const related = customMetrics.filter((item) => {
            const formula = String(item.formula || "").toLowerCase();
            return haystack.some((term) => term && formula.indexOf(term) >= 0);
        });
        if (related.length && wantsDependencyInfo(parsed)) {
            return {
                handled: true,
                text: `Custom KPIs using ${metric.name}: ${related.map((item) => item.name).join(", ")}.`,
                table: {
                    columns: ["KPI", "Formula", "Mode", "Format"],
                    rows: related.map((item) => [
                        item.name,
                        item.formula || "N/A",
                        item.isNonAdditive === false ? "Additive" : "Non-additive",
                        item.formatHint === "percentage" ? "Percentage" : "Number"
                    ])
                }
            };
        }
        return { handled: false, text: `${metric.name} is a data field, not a custom KPI formula.` };
    }

    const formula = String(metric.formula || "").trim() || "N/A";
    const dependsOn = (metric.dependsOn || []).filter(Boolean);
    const usedBy = (metric.usedBy || []).filter(Boolean);
    const mode = metric.isNonAdditive === false ? "Additive" : "Non-additive";
    const format = metric.formatHint === "percentage" ? "Percentage" : "Number";
    const details = [
        `Formula: ${formula}`,
        `Mode: ${mode}`,
        `Format: ${format}`,
        dependsOn.length ? `Depends on: ${dependsOn.join(", ")}` : "Depends on: native fields only",
        usedBy.length ? `Used by: ${usedBy.join(", ")}` : "",
        metric.description ? `Description: ${metric.description}` : ""
    ].filter(Boolean);
    return {
        handled: true,
        text: `${metric.name} KPI\n${details.join("\n")}`,
        table: {
            columns: ["KPI", "Formula", "Mode", "Format", "Depends on", "Used by"],
            rows: [[
                metric.name,
                formula,
                mode,
                format,
                dependsOn.length ? dependsOn.join(", ") : "Native fields only",
                usedBy.length ? usedBy.join(", ") : "N/A"
            ]]
        }
    };
}

function lookupMetricRequestSources(parsed: ParsedAssistantQuestion): string[] {
    const raw = String(parsed.raw || parsed.normalized || "");
    const metricSide = raw.match(/\b(?:what|show|tell|get|give|find)?\s*(?:is|are|the)?\s*(.+?)\s+\b(?:of|for)\b\s+.+$/i);
    const sources = [
        metricSide?.[1] || "",
        parsed.explicitMetricPhrase || ""
    ]
        .concat(parsed.metricPhrases || [])
        .concat(parsed.requestedFields?.values || [])
        .concat(parsed.requestedFields?.metrics || []);
    return sources
        .flatMap((source) => String(source || "").split(/\s*,\s*|\s+;\s*|\s+\band\b\s+|\s+\bplus\b\s+/i))
        .map((source) => source
            .replace(/\b(?:what|show|tell|get|give|find|is|are|the|value|field|metric|measure|chart|table|graph|visual)\b/ig, " ")
            .replace(/\s+/g, " ")
            .trim())
        .filter(Boolean);
}

function lookupMetricPhraseVariants(phrase: string): string[] {
    const normalized = normalizeMetricResolverText(phrase);
    const variants = [normalized];
    const collapsedAggregation = normalized.replace(/^(sum of|total of|average of|avg of|min of|max of|earliest|latest)\s+(sum of|total of|average of|avg of|min of|max of|earliest|latest)\s+/, "$2 ");
    if (collapsedAggregation !== normalized) variants.push(collapsedAggregation);
    const strippedAggregation = collapsedAggregation.replace(/^(sum of|total of|average of|avg of|min of|max of|earliest|latest)\s+/, "");
    if (strippedAggregation !== collapsedAggregation) variants.push(strippedAggregation);
    return variants.filter((item, index, arr) => item && arr.indexOf(item) === index);
}

function lookupExactMetricScore(metric: AssistantMetric, sources: string[]): number {
    const metricName = normalizeMetricResolverText(metric.name);
    if (!metricName) return 0;
    let score = 0;
    sources.forEach((source) => {
        lookupMetricPhraseVariants(source).forEach((variant, index) => {
            if (variant !== metricName) return;
            const exactness = index === 0 ? 1000 : index === 1 ? 900 : 100;
            score = Math.max(score, exactness + metricName.length);
        });
    });
    return score;
}

function filterLookupMetricsToExactRequest(parsed: ParsedAssistantQuestion, metrics: AssistantMetric[]): AssistantMetric[] {
    const unique = (metrics || []).filter((item, index, arr) =>
        !!item && arr.findIndex((candidate) => candidate.key === item.key) === index
    );
    const rawNormalized = ` ${normalizeMetricResolverText(`${parsed.raw || ""} ${parsed.normalized || ""}`)} `;
    const exactNameMatches = unique
        .map((metric) => ({ metric, name: normalizeMetricResolverText(metric.name) }))
        .filter((item) => item.name && rawNormalized.indexOf(` ${item.name} `) >= 0)
        .filter((item, _index, arr) =>
            !arr.some((other) =>
                other.metric.key !== item.metric.key
                && other.name.length > item.name.length
                && ` ${other.name} `.indexOf(` ${item.name} `) >= 0
            )
        );
    if (exactNameMatches.length) return exactNameMatches.map((item) => item.metric);
    const sources = lookupMetricRequestSources(parsed);
    if (!sources.length || unique.length < 2) return unique;
    const scored = unique
        .map((metric) => ({ metric, score: lookupExactMetricScore(metric, sources) }))
        .filter((item) => item.score > 0);
    if (!scored.length) return unique;
    const strongExact = scored.filter((item) => item.score >= 900);
    if (strongExact.length) return strongExact.map((item) => item.metric);
    const best = Math.max(...scored.map((item) => item.score));
    return scored
        .filter((item) => item.score >= best)
        .map((item) => item.metric);
}

export function answerLookup(
    ctx: AssistantAnswerContext,
    parsed: ParsedAssistantQuestion,
    entities: AssistantEntity[],
    metrics: AssistantMetric[]
): AssistantResponse {
    const entity = entities[0];
    const metric = metrics[0];
    if (!entity && !metric) return answerHelp(ctx);
    if (!entity) {
        const indices = uniqNums((ctx.selectedIndices && ctx.selectedIndices.length ? ctx.selectedIndices : (ctx.rows || []).map((row) => row.idx)));
        const value = resolveMetricValue(ctx, metric, indices);
        const formatted = formatAssistantMetric(ctx, metric, value);
        const scope = ctx.selectedIndices && ctx.selectedIndices.length ? "Selected units" : "All loaded rows";
        return {
            handled: true,
            text: `${metric.name}: ${formatted}.`,
            kpi: {
                title: metric.name,
                value: formatted,
                rawValue: value,
                metricKey: metric.key,
                metricName: metric.name,
                scopeLabel: scope
            }
        };
    }
    if (!metric || parsed.intent === "summary") {
        if (parsed.intent !== "summary" && wantsMapShow(parsed)) {
            const action = selectAction(entity, `Select ${entity.label} in report`);
            return {
                handled: true,
                text: `Showing ${scopeLabel(entity)} in report.`,
                actions: [action],
                autoSelectIndices: action.indices
            };
        }
        return answerSummary(ctx, entity, metrics);
    }

    const requestedMetrics = filterLookupMetricsToExactRequest(parsed, metrics || [])
        .filter((item, index, arr) => item && arr.findIndex((candidate) => candidate.key === item.key) === index);
    if (requestedMetrics.length > 1 && !wantsAllValues(parsed) && !wantsTable(parsed)) {
        const rows = requestedMetrics.map((candidate) => {
            const value = candidate.key === "__builtin::area" && entity.kind === "unit" && !wantsTotalMetric(parsed)
                ? primaryAreaValue(ctx, entity.indices)
                : resolveMetricValue(ctx, candidate, entity.indices);
            return [candidate.name, formatAssistantMetric(ctx, candidate, value)];
        });
        const primary = rows.slice(0, 3).map((row) => `${row[0]} ${row[1]}`).join(", ");
        return {
            handled: true,
            text: `${scopeLabel(entity)}: ${primary}${rows.length > 3 ? `, plus ${rows.length - 3} more metric${rows.length - 3 === 1 ? "" : "s"}` : ""}.`,
            actions: [selectAction(entity)],
            table: {
                columns: ["Metric", "Value"],
                rows
            },
            chart: parsed.chartType ? {
                type: parsed.chartType,
                title: `${scopeLabel(entity)} metrics`,
                labels: rows.map((row) => row[0]),
                values: requestedMetrics.map((candidate) => {
                    const value = candidate.key === "__builtin::area" && entity.kind === "unit" && !wantsTotalMetric(parsed)
                        ? primaryAreaValue(ctx, entity.indices)
                        : resolveMetricValue(ctx, candidate, entity.indices);
                    return validValue(value) ? value : 0;
                }),
                valueLabels: rows.map((row) => row[1]),
                series: requestedMetrics.map((candidate) => ({
                    name: candidate.name,
                    labels: [scopeLabel(entity)],
                    values: [resolveMetricValue(ctx, candidate, entity.indices)],
                    valueLabels: [formatAssistantMetric(ctx, candidate, resolveMetricValue(ctx, candidate, entity.indices))]
                }))
            } : undefined
        };
    }

    const unitSplits = entity.kind === "tenant" && wantsAllValues(parsed) && !wantsTotalMetric(parsed)
        ? splitEntityByUnit(ctx, entity)
        : [];
    if (unitSplits.length > 1) {
        const rows = unitSplits.map((unit) => {
            const first = uniqNums(unit.indices).map((idx) => ctx.rows[idx]).filter(Boolean)[0];
            const value = metric.key === "__builtin::area"
                ? primaryAreaValue(ctx, unit.indices)
                : resolveMetricValue(ctx, metric, unit.indices);
            return [
                first?.unitId || first?.shapeKey || unit.label,
                first?.tenant || entity.label,
                formatAssistantMetric(ctx, metric, value),
                first?.category || "N/A",
                first?.group || "N/A",
                (first?.floors || []).filter(Boolean).join(", ") || "N/A"
            ];
        });
        const totalValue = metric.key === "__builtin::area"
            ? resolveMetricValue(ctx, metric, entity.indices)
            : resolveMetricValue(ctx, metric, entity.indices);
        rows.push([
            "Total",
            "-",
            formatAssistantMetric(ctx, metric, totalValue),
            "-",
            "-",
            "-"
        ]);
        const labels = unitSplits.map((unit) => unit.label);
        const rawValues = unitSplits
            .map((unit) => metric.key === "__builtin::area" ? primaryAreaValue(ctx, unit.indices) : resolveMetricValue(ctx, metric, unit.indices));
        const values = rawValues.filter(validValue);
        const series = [{
            name: metric.name,
            labels,
            values: rawValues.map((value) => validValue(value) ? value : 0),
            valueLabels: rawValues.map((value) => formatAssistantMetric(ctx, metric, value))
        }];
        return {
            handled: true,
            text: `I found ${unitSplits.length} ${entity.label} units. ${metric.name} is shown by unit.${metricCalculationNotes([metric])}`,
            actions: unitSplits.slice(0, 5).map((unit) => selectAction(unit)),
            table: projectTable({
                columns: ["Unit", "Tenant", metric.name, "Category", "Group", "Floor"],
                rows
            }, ["Unit", "Tenant", metric.name]),
            chart: parsed.chartType && values.length ? {
                type: parsed.chartType,
                title: `${metric.name} by ${entity.label} unit`,
                labels,
                values: rawValues.map((value) => validValue(value) ? value : 0),
                valueLabels: rawValues.map((value) => formatAssistantMetric(ctx, metric, value)),
                series
            } : undefined
        };
    }

    const value = metric.key === "__builtin::area" && entity.kind === "unit" && !wantsTotalMetric(parsed)
        ? primaryAreaValue(ctx, entity.indices)
        : resolveMetricValue(ctx, metric, entity.indices);
    const extraFields = requestedDetailFields(ctx, parsed);
    const detailRows = wantsAllValues(parsed) || wantsTable(parsed) || extraFields.length > 0
        ? rowDetailTable(ctx, entity.indices, metric, extraFields)
        : [];
    return {
        handled: true,
        text: `${metric.name} for ${scopeLabel(entity)} is ${formatAssistantMetric(ctx, metric, value)}.${metricCalculationNotes([metric])}`,
        actions: [selectAction(entity)],
        table: detailRows.length ? {
            ...focusedLookupDetailTable({
                columns: ["Unit", "Tenant", "Category", "Group", "Floor", "Area"].concat(extraFields, [metric.name]),
                rows: detailRows
            }, metric.name)
        } : undefined,
        chart: parsed.chartType && validValue(value) ? {
            type: parsed.chartType,
            title: `${metric.name} for ${entity.label}`,
            labels: [entity.label],
            values: [value],
            valueLabels: [formatAssistantMetric(ctx, metric, value)],
            series: [{
                name: metric.name,
                labels: [entity.label],
                values: [value],
                valueLabels: [formatAssistantMetric(ctx, metric, value)]
            }]
        } : undefined
    };
}

export function answerAttributeLookup(
    ctx: AssistantAnswerContext,
    entity: AssistantEntity,
    attribute: "group" | "category" | "unit" | "tenant" | "floor",
    parsed?: ParsedAssistantQuestion
): AssistantResponse {
    const labels: Record<typeof attribute, string> = {
        group: "Group",
        category: "Category",
        unit: "Unit",
        tenant: "Tenant",
        floor: "Floor"
    };
    const values = new Set<string>();
    uniqNums(entity.indices).forEach((idx) => {
        const row = ctx.rows[idx];
        if (!row) return;
        if (attribute === "group") {
            if (row.group) values.add(row.group);
        } else if (attribute === "category") {
            if (row.category) values.add(row.category);
        } else if (attribute === "unit") {
            if (row.unitId || row.shapeKey) values.add(row.unitId || row.shapeKey);
        } else if (attribute === "tenant") {
            if (row.tenant) values.add(row.tenant);
        } else if (attribute === "floor") {
            (row.floors || []).forEach((floor) => { if (floor) values.add(floor); });
        }
    });
    const list = Array.from(values.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
    const valueText = list.length ? list.join(", ") : "N/A";
    if ((attribute === "unit" || attribute === "tenant") && (wantsAllValues(parsed) || list.length > 3)) {
        const seen = new Set<string>();
        const rows = uniqNums(entity.indices)
            .map((idx) => ctx.rows[idx])
            .filter(Boolean)
            .map((row) => {
                const unit = row.unitId || row.shapeKey || "";
                const tenant = row.tenant || "";
                const key = `${unit}::${tenant}::${row.category || ""}::${row.group || ""}`;
                if (seen.has(key)) return null;
                seen.add(key);
                return [
                    unit || "N/A",
                    tenant || "N/A",
                    row.category || "N/A",
                    row.group || "N/A",
                    (row.floors || []).filter(Boolean).join(", ") || "N/A",
                    typeof row.area === "number" && Number.isFinite(row.area) ? ctx.formatNumber(row.area, { maximumFractionDigits: 0 }) : "N/A"
                ];
            })
            .filter((row): row is string[] => !!row)
            .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base", numeric: true }) || a[1].localeCompare(b[1], undefined, { sensitivity: "base", numeric: true }));
        const label = attribute === "unit" ? "Units" : "Tenants";
        return {
            handled: true,
            text: `${label} for ${scopeLabel(entity)}: ${rows.length} found.`,
            actions: [selectAction(entity)],
            table: projectTable({
                columns: ["Unit", "Tenant", "Category", "Group", "Floor", "Area"],
                rows
            }, attribute === "unit" ? ["Unit", "Tenant"] : ["Tenant", "Unit"])
        };
    }
    return {
        handled: true,
        text: `${labels[attribute]} for ${scopeLabel(entity)} is ${valueText}.`,
        actions: [selectAction(entity)]
    };
}

export function answerCompare(
    ctx: AssistantAnswerContext,
    entities: AssistantEntity[],
    metrics: AssistantMetric[],
    parsed?: ParsedAssistantQuestion
): AssistantResponse {
    const scoped = scopeContext(entities);
    const tokens = new Set((parsed?.tokens || []).map((token) => String(token || "").toLowerCase()));
    const rawQuestion = String(parsed?.raw || parsed?.normalized || "");
    const compareTenantScope = tokens.has("tenant") || tokens.has("tenants");
    const directScopeComparison = scoped.scopes.length >= 2
        && !compareTenantScope
        && !tokens.has("unit")
        && !tokens.has("units")
        && scoped.subjects.length === 0;
    const scopeGuard = !directScopeComparison ? suspiciousScopeResponse(scoped.scopes, "comparison") : null;
    if (scopeGuard) return scopeGuard;
    const attributeScopes = compareTenantScope
        ? entities.filter((entity) => entity.kind === "category" || entity.kind === "group" || entity.kind === "filter")
        : [];
    const attributeScopeGuard = suspiciousScopeResponse(attributeScopes, "tenant breakdown");
    if (attributeScopeGuard) return attributeScopeGuard;
    const attributeScopeIndices = attributeScopes.length
        ? uniqNums(attributeScopes.reduce((out: number[], entity) => out.concat(entity.indices || []), []))
        : null;
    const effectiveScopeIndices = directScopeComparison ? null : (scoped.scopeIndices || attributeScopeIndices);
    const effectiveScopeText = directScopeComparison ? "" : (scoped.scopeText || attributeScopes.map((entity) => scopeLabel(entity)).join(", "));
    const requestedMetrics = metrics.length
        ? metrics.filter((metric) => !isCompareDefaultExcluded(metric)).slice(0, 30)
        : [];

    const scopedTopMatch = rawQuestion.match(/\b(top|bottom|highest|lowest|best|worst)\s+(\d+)?\b/i);
    if (scopedTopMatch && scoped.scopes.length >= 2) {
        const direction: "top" | "bottom" = /\b(bottom|lowest|worst)\b/i.test(scopedTopMatch[1] || "") ? "bottom" : "top";
        const limit = Math.max(1, Math.min(20, Number(scopedTopMatch[2]) || parsed?.limit || 5));
        const fallbackEntities = tenantOrUnitEntitiesForScope(ctx, null);
        const metric = requestedMetrics[0] || defaultCompareMetrics(ctx, fallbackEntities)[0];
        if (!metric) return { handled: false, text: "Which metric should I use for the top comparison?" };
        const sortDirection = effectiveRankSortDirection(metric, parsed || { raw: rawQuestion, normalized: rawQuestion, tokens: [], intent: "compare", metricPhrases: [], entityPhrases: [] }, direction);
        const rows: string[][] = [];
        const actions: AssistantAction[] = [];
        scoped.scopes.forEach((scope) => {
            const pool = tenantOrUnitEntitiesForScope(ctx, scope.indices);
            const ranked = pool
                .map((entity) => ({ entity, value: resolveMetricValue(ctx, metric, entity.indices) }))
                .filter((item) => validValue(item.value))
                .filter((item) => direction === "bottom" || item.value > 0)
                .sort((a, b) => sortDirection === "asc" ? a.value - b.value : b.value - a.value)
                .slice(0, limit);
            ranked.forEach((item, index) => {
                rows.push([
                    scope.label,
                    String(index + 1),
                    item.entity.label,
                    formatAssistantMetric(ctx, metric, item.value)
                ]);
                if (actions.length < 8) actions.push(selectAction(item.entity, `Select ${item.entity.label}`));
            });
        });
        if (!rows.length) return { handled: false, text: `I could not compare top ${limit} by ${metric.name} in the selected scopes.` };
        return {
            handled: true,
            text: `${direction === "bottom" ? "Bottom" : "Top"} ${limit} by ${metric.name} for ${scoped.scopes.map((entity) => scopeLabel(entity)).join(", ")}.`,
            actions,
            table: {
                columns: ["Scope", "Rank", "Name", metric.name],
                rows
            }
        };
    }

    const subjectPool = directScopeComparison
        ? scoped.scopes
        : attributeScopes.length
        ? tenantEntitiesForScope(ctx, effectiveScopeIndices)
        : scoped.subjects.length
        ? scoped.subjects
        : ((scoped.scopes.length || attributeScopes.length) ? tenantEntitiesForScope(ctx, effectiveScopeIndices) : entities.filter((entity) => !isScopeEntity(entity)));
    const preferredSubjectKinds = subjectPool.some((entity) => entity.kind === "tenant" || entity.kind === "unit")
        ? subjectPool.filter((entity) => entity.kind === "tenant" || entity.kind === "unit")
        : subjectPool;
    const isScopedTenantBreakdown = compareTenantScope && !!effectiveScopeIndices && !!effectiveScopeIndices.length;
    const compareLimit = isScopedTenantBreakdown
        ? Math.max(1, Math.min(50, parsed?.limit || 50))
        : 4;
    let allCompareEntities = expandDuplicateTenantCompareEntities(ctx, preferredSubjectKinds, parsed)
        .map((entity) => effectiveScopeIndices && !directScopeComparison ? { ...entity, indices: intersectNums(entity.indices, effectiveScopeIndices) } : entity)
        .filter((entity) => entity.indices.length > 0);
    if (parsed?.hasExplicitSelections && ((parsed.explicitSelectedEntityKeys || []).length || (parsed.explicitSelectedEntityLabels || []).length)) {
        const lockedKeys = new Set((parsed.explicitSelectedEntityKeys || []).map((key) => String(key || "").trim()).filter(Boolean));
        const lockedLabels = new Set((parsed.explicitSelectedEntityLabels || []).map(normalizeAnswerText).filter(Boolean));
        allCompareEntities = allCompareEntities.filter((entity) => {
            const key = `${entity.kind}:${entity.id}`;
            const label = normalizeAnswerText(entity.label || "");
            return lockedKeys.has(key) || (!!label && lockedLabels.has(label));
        });
    }
    const compareEntities = allCompareEntities.slice(0, compareLimit);
    if (compareEntities.length < 2) {
        return { handled: false, text: "I need at least two matching tenants, units, groups, categories, zones, layers, or floors to compare." };
    }
    const metricList = requestedMetrics.length ? requestedMetrics : defaultCompareMetrics(ctx, compareEntities).slice(0, 30);

    const comparisonMetrics = metricList
        .filter((metric, index, arr) => metric && arr.findIndex((item) => item.key === metric.key) === index)
        .slice(0, requestedMetrics.length > 1
            ? Math.min(8, requestedMetrics.length)
            : wantsAllValues(parsed || { raw: rawQuestion, normalized: rawQuestion, tokens: [], intent: "compare", metricPhrases: [], entityPhrases: [] })
            ? 8
            : 1);
    const requestedMetric = comparisonMetrics[0] || null;
    const wantsContextColumns = /\b(?:details?|with\s+(?:category|group|floor)|show\s+(?:category|group|floor)|include\s+(?:category|group|floor))\b/i.test(rawQuestion);
    const baseColumns = wantsContextColumns ? ["Category", "Group", "Floor"] : [];
    const headers = ["Name"]
        .concat(comparisonMetrics.map((metric) => metric.name))
        .concat(baseColumns);
    const chartMetric = requestedMetric;
    const chartValues = chartMetric ? compareEntities.map((entity) => resolveMetricValue(ctx, chartMetric, entity.indices)) : [];
    const rows = compareEntities.map((entity) => {
        const requestedValues = comparisonMetrics.map((metric) => {
            const value = resolveMetricValue(ctx, metric, entity.indices);
            return formatAssistantMetric(ctx, metric, value);
        });
        const contextValues = wantsContextColumns ? [
            distinctRowValues(ctx, entity.indices, (row) => row.category),
            distinctRowValues(ctx, entity.indices, (row) => row.group),
            distinctRowValues(ctx, entity.indices, (row) => row.floors || [])
        ] : [];
        return [entity.label].concat(requestedValues, contextValues);
    });
    const totalIndices = uniqNums(compareEntities.reduce((out: number[], entity) => out.concat(entity.indices || []), []));
    const hasMore = isScopedTenantBreakdown && allCompareEntities.length > compareEntities.length;
    rows.push([
        "Total",
    ].concat(comparisonMetrics.map((metric) => formatAssistantMetric(ctx, metric, resolveMetricValue(ctx, metric, totalIndices))))
    .concat(baseColumns.map(() => "-")));
    const shouldTransposeComparison = comparisonMetrics.length > 1
        && compareEntities.length >= 2
        && compareEntities.length <= 4
        && !isScopedTenantBreakdown
        && !wantsContextColumns
        && !/\b(?:normal\s+table|row\s+layout|by\s+(?:tenant|name|group|category|unit)\s+rows?)\b/i.test(rawQuestion);
    if (shouldTransposeComparison) {
        const transposedRows = comparisonMetrics.map((metric) => [
            metric.name,
            ...compareEntities.map((entity) => formatAssistantMetric(ctx, metric, resolveMetricValue(ctx, metric, entity.indices)))
        ]);
        return {
            handled: true,
            text: `Comparison for ${compareEntities.map((entity) => entity.label).join(", ")}${effectiveScopeText ? ` in ${effectiveScopeText}` : ""}.${metricCalculationNotes(metricList)}`,
            actions: compareEntities.slice(0, 8).map((entity) => selectAction(entity, `Select ${entity.label}`)),
            table: {
                columns: ["Metric"].concat(compareEntities.map((entity) => entity.label)),
                rows: transposedRows
            },
            chart: parsed?.chartType && chartMetric && chartValues.some(validValue) ? {
                type: parsed.chartType,
                title: `${chartMetric.name} comparison`,
                labels: compareEntities.map((entity) => entity.label),
                values: chartValues.map((value) => validValue(value) ? value : 0),
                valueLabels: chartValues.map((value) => formatAssistantMetric(ctx, chartMetric, value)),
                series: buildHeatmapChartSeries(ctx, chartMetric, compareEntities.map((entity) => entity.label), compareEntities.map((entity) => entity.indices))
            } : undefined
        };
    }
    return {
        handled: true,
        text: `${isScopedTenantBreakdown ? `Tenant breakdown${effectiveScopeText ? ` in ${effectiveScopeText}` : ""}: ${compareEntities.length} shown` : `Comparison for ${compareEntities.map((entity) => entity.label).join(", ")}${effectiveScopeText ? ` in ${effectiveScopeText}` : ""}`}${hasMore ? `, ${allCompareEntities.length - compareEntities.length} more not shown` : ""}.${metricCalculationNotes(metricList)}`,
        actions: compareEntities.slice(0, 8).map((entity) => selectAction(entity, `Select ${entity.label}`)),
        table: {
            columns: headers,
            rows
        },
        chart: parsed?.chartType && chartMetric && chartValues.some(validValue) ? {
            type: parsed.chartType,
            title: `${chartMetric.name} comparison`,
            labels: compareEntities.map((entity) => entity.label),
            values: chartValues.map((value) => validValue(value) ? value : 0),
            valueLabels: chartValues.map((value) => formatAssistantMetric(ctx, chartMetric, value)),
            series: buildHeatmapChartSeries(ctx, chartMetric, compareEntities.map((entity) => entity.label), compareEntities.map((entity) => entity.indices))
        } : undefined
    };
}

export function answerRank(
    ctx: AssistantAnswerContext,
    parsed: ParsedAssistantQuestion,
    entities: AssistantEntity[],
    metrics: AssistantMetric[]
): AssistantResponse {
    if (parsed.topBottom) metrics = preferPlainAreaRankMetrics(ctx, parsed.topBottom, metrics);
    const metric = metrics[0];
    if (!metric) return { handled: false, text: "I could not identify the metric to rank by." };
    const benchmarkFallback = answerBenchmarkRankFallback(ctx, parsed, metrics);
    if (benchmarkFallback) return benchmarkFallback;
    if (parsed.topBottom) {
        return answerStructuredTopBottomRank(ctx, parsed, parsed.topBottom, metrics);
    }
    const requestedRankMetrics = metrics.filter((candidate, index, arr) =>
        candidate && arr.findIndex((item) => item.key === candidate.key) === index
    ).slice(0, 30);
    const rankMetrics = shouldExpandRankMetrics(parsed)
        ? enrichWithHeatmapMetrics(ctx, requestedRankMetrics, 30)
        : requestedRankMetrics;
    const asksSingleBest = !parsed.limit && (parsed.tokens || []).some((token) => token === "biggest" || token === "highest" || token === "largest" || token === "maximum" || token === "max" || token === "best");
    const limit = asksSingleBest ? 1 : parsed.limit || 5;
    const offset = parsed.offset || 0;
    const direction = parsed.direction || "top";
    const sortDirection = effectiveRankSortDirection(metric, parsed, direction);
    const heading = rankHeading(metric, parsed, direction, metric.name);
    const scoped = scopeContext(entities);
    const inferredRankScopes = inferRankScopesFromQuestion(ctx, parsed, entities);
    const rankScopes = entities.filter(isRankScopeEntity).concat(inferredRankScopes.filter(isRankScopeEntity));
    const rankScopeGuard = suspiciousScopeResponse(rankScopes.length ? rankScopes : scoped.scopes, "ranking");
    if (rankScopeGuard) return rankScopeGuard;
    const rankScopeIndices = rankScopes.length
        ? combineScopeIndices(rankScopes)
        : scoped.scopeIndices;
    const rankScopeText = rankScopes.length
        ? rankScopes.map((entity) => scopeLabel(entity)).join(", ")
        : scoped.scopeText;
    const explicitSubjects = entities.filter((entity) => entity.kind === "tenant" || entity.kind === "unit");

    // Only apply a context-kind scope (e.g. "Selected units") when the query explicitly mentions
    // selection words. Without this guard, the entity matcher can accidentally pull in the
    // context entity via generic words like "tenants", scoping the rank to the data selectionion
    // even when the user just asked "top 10 tenants by area".
    const queryMentionsSelection = /\b(selected|selection|current\s+selection|visible|current\s+view)\b/i.test(parsed.normalized || "");
    const contextOnlyScope = rankScopes.length > 0
        ? rankScopes.every((s) => s.kind === "context")
        : scoped.scopes.every((s) => s.kind === "context");
    const effectiveScopeIndices = (!queryMentionsSelection && contextOnlyScope)
        ? null
        : rankScopeIndices;
    const effectiveScopeText = (!queryMentionsSelection && contextOnlyScope)
        ? ""
        : rankScopeText;

    const pool = explicitSubjects.length
        ? explicitSubjects
            .filter((entity) => !isPlaceholderTenantName(entity.label))
            .map((entity) => effectiveScopeIndices ? { ...entity, indices: intersectNums(entity.indices, effectiveScopeIndices) } : entity)
        : tenantEntitiesForScope(ctx, effectiveScopeIndices);
    const allSorted = filterEntitiesByParsed(ctx, pool, parsed)
        .filter((entity) => entity.indices.length > 0)
        .map((entity) => ({ entity, value: resolveMetricValue(ctx, metric, entity.indices) }))
        .filter((item) => validValue(item.value))
        .filter((item) => direction === "bottom" || item.value > 0)
        .sort((a, b) => sortDirection === "asc" ? a.value - b.value : b.value - a.value);
    const ranked = allSorted.slice(offset, offset + limit);
    const filterText = parsed.filters?.floorPhrase ? ` in ${parsed.filters.floorPhrase} floor` : "";
    if (!ranked.length) {
        return {
            handled: true,
            text: `No matching ${direction === "bottom" ? "bottom" : "top"} tenants found for ${metric.name}${effectiveScopeText ? ` in ${effectiveScopeText}` : filterText}.`,
            suggestions: [`top tenants by ${metric.name}`, "show tenants by area", "remove filter"]
        };
    }
    const pageSummary = rankPageSummary(allSorted.length, offset, ranked.length);
    const percentileDetail = requestedPercentileDetail(parsed);
    if (percentileDetail) {
        const detailResponse = buildPercentileDetailResponse(
            ctx,
            metric,
            allSorted,
            percentileDetail,
            "Tenant",
            (candidate, value) => formatAssistantMetric(ctx, candidate, value)
        );
        if (detailResponse) return detailResponse;
    }
    if (wantsBenchmarkStatistics(parsed)) {
        const benchmarkTable = buildBenchmarkStatisticsTable(
            ctx,
            rankMetrics,
            allSorted.map((item) => item.entity.indices),
            "tenants",
            (candidate, indices) => resolveMetricValue(ctx, candidate, indices),
            (candidate, value) => formatAssistantMetric(ctx, candidate, value)
        );
        const concentrationTable = buildTenantConcentrationTable(
            rankMetrics,
            allSorted.map((item) => item.entity.indices),
            (candidate, indices) => resolveMetricValue(ctx, candidate, indices)
        );
        const tables = [benchmarkTable, concentrationTable].filter((table): table is NonNullable<AssistantResponse["tables"]>[number] => !!table);
        if (tables.length) {
            return {
                handled: true,
                text: `Benchmark statistics for ${allSorted.length} tenants by ${rankMetrics.map((item) => item.name).join(", ")}.`,
                tables,
                suggestions: ["Show 90th percentile tenants", "Show 75th percentile tenants", "Show 50th percentile tenants", "Show 25th percentile tenants"]
            };
        }
    }
    const rawTable = {
        columns: ["Rank", "Name"].concat(rankMetrics.map((candidate) => candidate.name)),
        rows: ranked.map((item, i) => [
            String(offset + i + 1),
            item.entity.label
        ].concat(rankMetrics.map((candidate) => formatAssistantMetric(ctx, candidate, resolveMetricValue(ctx, candidate, item.entity.indices)))))
    };
    const focusedTable = focusedRankTable(rawTable, "Name", rankMetrics.map((candidate) => candidate.name));
    return {
        handled: true,
        text: `${heading}${effectiveScopeText ? ` in ${effectiveScopeText}` : filterText}${filterSummaryText(parsed)}.${pageSummary}${metricBusinessNotes([metric], direction)}${metricCalculationNotes(rankMetrics)}`,
        actions: ranked.slice(0, 5).map((item) => selectAction(item.entity, `Select ${item.entity.label}`)),
        table: focusedTable,
        benchmarkContext: {
            dimensionType: "tenant",
            dimensionLabel: "Tenant",
            metricKey: metric.key,
            metricLabel: metric.name,
            metricFormatHint: metric.formatHint,
            metricDecimalPlaces: metric.decimalPlaces,
            candidates: allSorted.map((item) => ({
                label: item.entity.label,
                indices: uniqNums(item.entity.indices || []),
                value: item.value,
                valueLabel: formatAssistantMetric(ctx, metric, item.value)
            })),
            rankedLabels: ranked.map((item) => item.entity.label),
            scopeText: effectiveScopeText || filterText.replace(/^\s*in\s+/i, "").trim()
        },
        suggestions: ["Yes, show benchmark statistics"],
        chart: parsed.chartType ? {
            type: parsed.chartType,
            title: heading,
            labels: ranked.map((item) => item.entity.label),
            values: ranked.map((item) => item.value),
            valueLabels: ranked.map((item) => formatAssistantMetric(ctx, metric, item.value)),
            series: buildHeatmapChartSeries(ctx, metric, ranked.map((item) => item.entity.label), ranked.map((item) => item.entity.indices))
        } : undefined
    };
}

function conditionMatches(value: number, condition?: ParsedTopBottomQuery["metricCondition"]): boolean {
    if (!condition) return true;
    if (!validValue(value)) return false;
    if (condition.operator === ">") return value > condition.value;
    if (condition.operator === ">=") return value >= condition.value;
    if (condition.operator === "<") return value < condition.value;
    if (condition.operator === "<=") return value <= condition.value;
    return value === condition.value;
}

function dimensionLabel(kind: ParsedTopBottomQuery["dimensionType"]): string {
    if (kind === "tenant") return "Tenant";
    if (kind === "unit") return "Unit";
    if (kind === "category") return "Category";
    if (kind === "group") return "Group";
    if (kind === "zone") return "Zone";
    if (kind === "floor") return "Floor";
    if (kind === "layer") return "Layer";
    if (kind === "filter") return "Filter";
    return "Bookmark";
}

function representativeValue(ctx: AssistantAnswerContext, indices: number[], pick: (row: NonNullable<AssistantAnswerContext["rows"][number]>) => string | string[]): string {
    return distinctRowValues(ctx, indices, pick);
}

function areaValueForIndices(ctx: AssistantAnswerContext, indices: number[]): number {
    const areaMetric = ctx.metrics.find((candidate) => candidate.key === "__builtin::area");
    return areaMetric ? resolveMetricValue(ctx, areaMetric, indices) : builtInValue(ctx, { key: "__builtin::area", name: "Area", kind: "builtin", aliases: [] }, indices);
}

function wantsPlainAreaMetric(phrase?: string): boolean {
    const clean = normalizeAnswerText(phrase || "");
    if (!clean) return false;
    if (/\b(floor|fi|fl|external|seating|variance|va)\b/.test(clean)) return false;
    return /^(?:sum of |total )?(?:area|sqm|sq m|m2|size)$/.test(clean)
        || /\b(?:largest|biggest|highest|top|smallest|lowest|bottom)\s+(?:area|sqm|sq m|m2|size)\b/.test(clean);
}

function preferPlainAreaRankMetrics(ctx: AssistantAnswerContext, rank: ParsedTopBottomQuery, metrics: AssistantMetric[]): AssistantMetric[] {
    if (!wantsPlainAreaMetric(rank.metricPhrase)) return metrics;
    const requested = normalizeMetricResolverText(rank.metricPhrase || "");
    const exactRequestedMetric = (metrics || []).find((metric) =>
        metric.key !== "__builtin::area"
        && normalizeMetricResolverText(metric.name || "") === requested
    );
    if (exactRequestedMetric) return [exactRequestedMetric].concat((metrics || []).filter((metric) => metric.key !== exactRequestedMetric.key));
    const areaMetric = ctx.metrics.find((candidate) => candidate.key === "__builtin::area");
    if (!areaMetric) return metrics;
    return [areaMetric].concat((metrics || []).filter((metric) => metric.key !== areaMetric.key));
}

function resolveRankValue(ctx: AssistantAnswerContext, metric: AssistantMetric, indices: number[], rank?: ParsedTopBottomQuery): number {
    const value = resolveMetricValue(ctx, metric, indices);
    if (!rank?.perArea) return value;
    if (metricAlreadyPerArea(metric)) return value;
    const area = areaValueForIndices(ctx, indices);
    return validValue(value) && validValue(area) && area > 0 ? value / area : NaN;
}

function metricAlreadyPerArea(metric: AssistantMetric): boolean {
    const metricText = [metric.name].concat(metric.aliases || []).join(" ").toLowerCase();
    return /\b(?:per\s+(?:sqm|sq m|m2|area)|psm|productivity|density)\b|\/\s*(?:sqm|sq\s*m|m2|area)\b/.test(metricText);
}

function formatRankMetricValue(ctx: AssistantAnswerContext, metric: AssistantMetric, value: number, rank?: ParsedTopBottomQuery): string {
    if (!rank?.perArea) return formatAssistantMetric(ctx, metric, value);
    if (metricAlreadyPerArea(metric)) return formatAssistantMetric(ctx, metric, value);
    if (!validValue(value)) return "N/A";
    return `${ctx.formatNumber(value, { maximumFractionDigits: 2 })} / sqm`;
}

function wantsSeparateMetricRankings(parsed: ParsedAssistantQuestion): boolean {
    const text = `${parsed.raw || ""} ${parsed.normalized || ""}`.toLowerCase();
    return /\b(for each metric|separately|separate rankings|separate ranking|each measure|each metric)\b/.test(text);
}

function wantsCombinedMetricRanking(parsed: ParsedAssistantQuestion): boolean {
    const text = `${parsed.raw || ""} ${parsed.normalized || ""}`.toLowerCase();
    return /\b(overall|combined|across all metrics|across all selected metrics)\b/.test(text);
}

function metricWorstPercentile(metric: AssistantMetric, value: number, peerValues: number[], direction: "top" | "bottom"): number {
    const pct = percentilePosition(value, peerValues);
    if (!Number.isFinite(pct)) return NaN;
    const perf = metricPerformanceDirection(metric);
    if (perf === "lower") return pct;
    if (perf === "higher") return 1 - pct;
    return direction === "bottom" ? 1 - pct : pct;
}

function rankInsightLabel(metric: AssistantMetric, value: number): string {
    const kind = metricSemanticKind(metric);
    if (!validValue(value)) return "";
    if (kind === "ocr") return value > 0 ? `high ${metric.name}` : metric.name;
    if (kind === "vacancy") return value > 0 ? `elevated ${metric.name}` : metric.name;
    if (kind === "sales") return value < 0 ? `negative ${metric.name}` : `low ${metric.name}`;
    if (kind === "rent") return value > 0 ? `${metric.name}` : "";
    const name = String(metric.name || "");
    if (/growth|mom|ytd|annual|yoy|change/i.test(name) && value < 0) return `negative ${name}`;
    return "";
}

function buildRankInsight(
    ctx: AssistantAnswerContext,
    entity: AssistantEntity,
    metrics: AssistantMetric[],
    direction: "top" | "bottom",
    rank?: ParsedTopBottomQuery,
    combined: boolean = false
): string {
    if (!entity || !metrics.length) return "";
    const parts = (metrics || [])
        .slice(0, 5)
        .map((metric) => {
            const value = rank ? resolveRankValue(ctx, metric, entity.indices || [], rank) : resolveMetricValue(ctx, metric, entity.indices || []);
            return { metric, value, label: rankInsightLabel(metric, value) };
        })
        .filter((item) => item.label);
    const metricText = parts.slice(0, 3).map((item) => item.label).join(" and ");
    if (!metricText) return "";
    if (!combined) return "";
    const prefix = combined
        ? (direction === "bottom" ? "Top issue" : "Top opportunity")
        : "";
    return `${prefix}: ${entity.label} stands out with ${metricText}.`;
}

function rankPageSummary(total: number, offset: number, shown: number): string {
    if (!Number.isFinite(total) || (total <= shown && offset <= 0)) return "";
    return ` Showing ${offset + 1}-${offset + shown} of ${total}.`;
}

function filterFieldKeyForRank(ctx: AssistantAnswerContext, phrase?: string): string | null {
    const wanted = normalizeAnswerText(phrase || "");
    if (!wanted) return null;
    const tokenKey = (value: string): string[] => normalizeAnswerText(value)
        .split(/\s+/g)
        .map((token) => token.endsWith("ies") && token.length > 4 ? `${token.slice(0, -3)}y` : token.endsWith("s") && token.length > 3 ? token.slice(0, -1) : token)
        .filter((token) => token.length >= 2);
    const wantedTokens = tokenKey(wanted);
    const keys = new Set<string>();
    (ctx.rows || []).forEach((row) => Object.keys(row?.filters || {}).forEach((key) => keys.add(key)));
    const scored = Array.from(keys.values())
        .map((key) => {
            const clean = normalizeAnswerText(key);
            const cleanTokens = new Set(tokenKey(clean));
            let score = 99;
            if (clean === wanted) score = 0;
            else if (clean.replace(/\s+/g, "") === wanted.replace(/\s+/g, "")) score = 1;
            else if (clean.indexOf(wanted) >= 0 || wanted.indexOf(clean) >= 0) score = 2;
            else if (wantedTokens.length && wantedTokens.every((token) => cleanTokens.has(token))) score = 3;
            return { key, score };
        })
        .filter((item) => item.score < 99)
        .sort((a, b) => a.score - b.score || a.key.localeCompare(b.key));
    return scored[0]?.key || null;
}

function buildFilterFieldRankEntities(ctx: AssistantAnswerContext, fieldKey: string, scopeIndices: number[] | null): AssistantEntity[] {
    const byValue = new Map<string, number[]>();
    const scopeSet = scopeIndices ? new Set(uniqNums(scopeIndices)) : null;
    (ctx.rows || []).forEach((row) => {
        if (!row || (scopeSet && !scopeSet.has(row.idx))) return;
        const value = String((row.filters || {})[fieldKey] || "").trim();
        if (!value || /^n\/a$|^na$|^none$|^null$|^undefined$|^-$/i.test(value)) return;
        const key = value.toLowerCase();
        if (!byValue.has(key)) byValue.set(key, []);
        byValue.get(key)!.push(row.idx);
    });
    return Array.from(byValue.entries()).map(([key, indices]) => ({
        id: `filter-field:${fieldKey}:${key}`,
        kind: "filter" as const,
        label: String((ctx.rows[indices[0]]?.filters || {})[fieldKey] || key),
        aliases: [],
        indices: uniqNums(indices),
        meta: { field: fieldKey }
    }));
}

function rowBackedRankValuesForKind(ctx: AssistantAnswerContext, kind: ParsedTopBottomQuery["dimensionType"], row: NonNullable<AssistantAnswerContext["rows"][number]>): string[] {
    if (kind === "category") return [row.category || (row.filters || {})["Assigned Sales Category"] || ""];
    if (kind === "group") return [row.group || (row.filters || {})["Assigned Group"] || ""];
    if (kind === "floor") return (row.floors || []).filter(Boolean);
    if (kind === "unit") return [row.combinedUnit || row.unitId || row.shapeKey || ""];
    if (kind === "tenant") return [row.tenant || (row.filters || {})["Assigned Tenant Name"] || (row.filters || {})["Assigned Tenant"] || (row.filters || {})["Tenant"] || ""];
    return [];
}

function buildRowBackedRankEntities(ctx: AssistantAnswerContext, kind: ParsedTopBottomQuery["dimensionType"], scopeIndices: number[] | null): AssistantEntity[] {
    if (kind !== "category" && kind !== "group" && kind !== "floor" && kind !== "unit" && kind !== "tenant") return [];
    const scopeSet = scopeIndices ? new Set(uniqNums(scopeIndices)) : null;
    const byValue = new Map<string, { label: string; indices: number[] }>();
    (ctx.rows || []).forEach((row) => {
        if (!row || (scopeSet && !scopeSet.has(row.idx))) return;
        rowBackedRankValuesForKind(ctx, kind, row).forEach((rawValue) => {
            const label = String(rawValue || "").trim();
            if (!label || /^n\/a$|^na$|^none$|^null$|^undefined$|^-$/i.test(label)) return;
            const key = normalizeAnswerText(label);
            if (!key) return;
            const existing = byValue.get(key);
            if (existing) {
                existing.indices.push(row.idx);
                return;
            }
            byValue.set(key, { label, indices: [row.idx] });
        });
    });
    const entityKind = kind as AssistantEntity["kind"];
    return Array.from(byValue.entries()).map(([key, value]) => ({
        id: `row-field:${kind}:${key}`,
        kind: entityKind,
        label: value.label,
        aliases: [value.label],
        indices: uniqNums(value.indices)
    } as AssistantEntity));
}

function buildStructuredRankEntities(ctx: AssistantAnswerContext, kind: ParsedTopBottomQuery["dimensionType"], parsed: ParsedAssistantQuestion): AssistantEntity[] {
    const scopes = inferRankScopesFromQuestion(ctx, parsed, [])
        .filter((entity) => entity.kind !== kind);
    const scopeIndices = combineScopeIndices(scopes);
    if (kind === "filter") {
        const fieldKey = filterFieldKeyForRank(ctx, parsed.topBottom?.dimensionField);
        return fieldKey ? buildFilterFieldRankEntities(ctx, fieldKey, scopeIndices) : [];
    }
    const rowBacked = filterEntitiesByParsed(ctx, buildRowBackedRankEntities(ctx, kind, scopeIndices), parsed)
        .filter((entity) => entity.indices.length > 0)
        .filter((entity) => String(entity.label || "").trim())
        .filter((entity) => kind !== "tenant" && kind !== "unit" || !isPlaceholderTenantName(entity.label));
    if (rowBacked.length) return rowBacked;
    const all = (ctx.entities || []).filter((entity) => entity.kind === kind);
    const scoped = scopeIndices
        ? all.map((entity) => ({ ...entity, indices: intersectNums(entity.indices || [], scopeIndices) }))
        : all;
    const filtered = filterEntitiesByParsed(ctx, scoped, parsed)
        .filter((entity) => entity.indices.length > 0);
    if (kind === "tenant") {
        const tenants = filtered.filter((entity) => !isPlaceholderTenantName(entity.label));
        if (tenants.length) return tenants;
        const unitFallback = (ctx.entities || []).filter((entity) => entity.kind === "unit");
        const scopedUnits = scopeIndices
            ? unitFallback.map((entity) => ({ ...entity, indices: intersectNums(entity.indices || [], scopeIndices) }))
            : unitFallback;
        return filterEntitiesByParsed(ctx, scopedUnits, parsed)
            .filter((entity) => entity.indices.length > 0)
            .filter((entity) => String(entity.label || "").trim() && !isPlaceholderTenantName(entity.label));
    }
    if (kind === "unit") {
        const units = filtered.filter((entity) => String(entity.label || "").trim() && !isPlaceholderTenantName(entity.label));
        if (units.length) return units;
        return buildRowBackedRankEntities(ctx, kind, scopeIndices)
            .filter((entity) => String(entity.label || "").trim() && !isPlaceholderTenantName(entity.label));
    }
    const cleanFiltered = filtered.filter((entity) => String(entity.label || "").trim());
    if (cleanFiltered.length) return cleanFiltered;
    return buildRowBackedRankEntities(ctx, kind, scopeIndices)
        .filter((entity) => String(entity.label || "").trim());
}

function answerStructuredTopBottomRank(
    ctx: AssistantAnswerContext,
    parsed: ParsedAssistantQuestion,
    rank: ParsedTopBottomQuery,
    metrics: AssistantMetric[]
): AssistantResponse {
    metrics = preferPlainAreaRankMetrics(ctx, rank, metrics);
    const metric = metrics[0];
    if (!metric) return { handled: false, text: "I could not identify the metric to rank by." };
    const requestedRankMetrics = metrics.filter((candidate, index, arr) =>
        candidate && arr.findIndex((item) => item.key === candidate.key) === index
    ).slice(0, 30);
    const rankMetrics = shouldExpandRankMetrics(parsed)
        ? enrichWithHeatmapMetrics(ctx, requestedRankMetrics, 30)
        : requestedRankMetrics;
    const direction = rank.direction;
    const sortDirection = effectiveRankSortDirection(metric, parsed, direction);
    const offset = parsed.offset || 0;
    const limit = Math.max(1, Math.min(50, rank.limit || parsed.limit || 5));
    const scopes = inferRankScopesFromQuestion(ctx, parsed, []);
    const effectiveScopes = rank.dimensionType === "filter"
        ? scopes.filter((scope) => normalizeAnswerText(scope.meta?.field || "") !== normalizeAnswerText(rank.dimensionField || ""))
        : scopes.filter((scope) => scope.kind !== rank.dimensionType);
    const scopeGuard = suspiciousScopeResponse(effectiveScopes, "ranking");
    if (scopeGuard) return scopeGuard;
    const scopeText = scopeTextForEntities(effectiveScopes);
    const entities = buildStructuredRankEntities(ctx, rank.dimensionType, parsed);
    const dimensionName = rank.dimensionType === "tenant" && entities.length && entities.every((entity) => entity.kind === "unit")
        ? "Unit"
        : rank.dimensionType === "filter" && rank.dimensionField
        ? rank.dimensionField
        : dimensionLabel(rank.dimensionType);
    const buildSingleMetricTable = (rankMetric: AssistantMetric, titlePrefix?: string) => {
        const metricSortDirection = effectiveRankSortDirection(rankMetric, parsed, direction);
        const sorted = entities
            .map((entity) => ({ entity, value: resolveRankValue(ctx, rankMetric, entity.indices, rank) }))
            .filter((item) => validValue(item.value))
            .filter((item) => direction === "bottom" || item.value > 0)
            .filter((item) => conditionMatches(item.value, rank.metricCondition))
            .sort((a, b) => metricSortDirection === "asc" ? a.value - b.value : b.value - a.value);
        const shown = sorted.slice(offset, offset + limit);
        const rawCols = ["Rank", dimensionName, rankMetric.name];
        const rawRows = shown.map((item, i) => {
            return [
                String(offset + i + 1),
                item.entity.label,
                formatRankMetricValue(ctx, rankMetric, item.value, rank)
            ];
        });
        const focused = focusedRankTable({ columns: rawCols, rows: rawRows }, dimensionName, [rankMetric.name]);
        return {
            title: titlePrefix || rankHeading(rankMetric, parsed, direction, `${dimensionName.toLowerCase()} by ${rankMetric.name}${rank.perArea ? " per sqm" : ""}`),
            columns: focused.columns,
            rows: focused.rows,
            ranked: shown
        };
    };

    if (rankMetrics.length > 1 && wantsSeparateMetricRankings(parsed)) {
        const built = rankMetrics.map((rankMetric) => buildSingleMetricTable(rankMetric)).filter((table) => table.rows.length > 0);
        if (!built.length) return {
            handled: true,
            text: `No matching ${dimensionName.toLowerCase()} rows found for the selected metrics.`,
            suggestions: [`top ${dimensionName.toLowerCase()} by ${metric.name}`, "remove filter"]
        };
        return {
            handled: true,
            text: `Separate rankings for ${rankMetrics.map((item) => item.name).join(", ")}${scopeText ? ` in ${scopeText}` : ""}.`,
            actions: built[0].ranked.slice(0, 5).map((item) => selectAction(item.entity, `Select ${item.entity.label}`)),
            tables: built.map(({ title, columns, rows }) => ({ title, columns, rows }))
        };
    }

    if (rankMetrics.length > 1 && wantsCombinedMetricRanking(parsed)) {
        const metricPeerValues = new Map<string, number[]>();
        rankMetrics.forEach((rankMetric) => {
            metricPeerValues.set(rankMetric.key, entities.map((entity) => resolveRankValue(ctx, rankMetric, entity.indices, rank)).filter(validValue));
        });
        const scored = entities.map((entity) => {
            const metricValues = rankMetrics.map((rankMetric) => {
                const value = resolveRankValue(ctx, rankMetric, entity.indices, rank);
                const score = metricWorstPercentile(rankMetric, value, metricPeerValues.get(rankMetric.key) || [], direction);
                return { rankMetric, value, score };
            }).filter((item) => validValue(item.value) && Number.isFinite(item.score));
            const score = metricValues.length ? metricValues.reduce((sum, item) => sum + item.score, 0) / metricValues.length : NaN;
            return { entity, score, metricValues };
        })
            .filter((item) => Number.isFinite(item.score))
            .sort((a, b) => b.score - a.score);
        const rankedCombined = scored.slice(offset, offset + limit);
        if (!rankedCombined.length) return { handled: false, text: `I could not calculate an overall ranking for the selected metrics from the loaded data.` };
        const combinedInsight = buildRankInsight(ctx, rankedCombined[0].entity, rankMetrics, direction, rank, true);
        const rawColumns = ["Rank", dimensionName, "Combined score"]
            .concat(rankMetrics.map((candidate) => candidate.name));
        const rawRows = rankedCombined.map((item, i) => {
            const valueByKey = new Map(item.metricValues.map((metricValue) => [metricValue.rankMetric.key, metricValue.value]));
            return [
                String(offset + i + 1),
                item.entity.label,
                ctx.formatNumber(item.score * 100, { maximumFractionDigits: 0 })
            ]
                .concat(rankMetrics.map((candidate) => formatRankMetricValue(ctx, candidate, valueByKey.get(candidate.key) as number, rank)));
        });
        const focused = focusedRankTable({ columns: rawColumns, rows: rawRows }, dimensionName, ["Combined score"].concat(rankMetrics.map((candidate) => candidate.name)));
        return {
            handled: true,
            text: `Overall ${direction === "bottom" ? "worst" : "best"} ${dimensionName.toLowerCase()} across ${rankMetrics.map((item) => item.name).join(", ")}${scopeText ? ` in ${scopeText}` : ""}.${combinedInsight ? ` ${combinedInsight}` : ""}`,
            actions: rankedCombined.slice(0, 5).map((item) => selectAction(item.entity, `Select ${item.entity.label}`)),
            table: { columns: focused.columns, rows: focused.rows }
        };
    }

    const allSorted = entities
        .map((entity) => ({ entity, value: resolveRankValue(ctx, metric, entity.indices, rank) }))
        .filter((item) => validValue(item.value))
        .filter((item) => direction === "bottom" || item.value > 0)
        .filter((item) => conditionMatches(item.value, rank.metricCondition))
        .sort((a, b) => sortDirection === "asc" ? a.value - b.value : b.value - a.value);
    const ranked = allSorted.slice(offset, offset + limit);
    if (!ranked.length) {
        const conditionText = rank.metricCondition ? ` matching ${rank.metricCondition.rawText}` : "";
        return {
            handled: true,
            text: `No matching ${dimensionName.toLowerCase()} rows found for ${metric.name}${scopeText ? ` in ${scopeText}` : ""}${conditionText}.`,
            suggestions: [`top ${dimensionName.toLowerCase()} by ${metric.name}`, "remove filter"]
        };
    }

    const rawColumns = ["Rank", dimensionName]
        .concat(rankMetrics.map((candidate) => candidate.name));

    const rows = ranked.map((item, i) => {
        const indices = item.entity.indices || [];
        return [
            String(offset + i + 1),
            item.entity.label
        ]
            .concat(rankMetrics.map((candidate) => formatRankMetricValue(ctx, candidate, resolveRankValue(ctx, candidate, indices, rank), rank)));
    });

    const totalIndices = uniqNums(ranked.reduce((out: number[], item) => out.concat(item.entity.indices || []), []));
    const totalRow = [
        "Total",
        ""
    ]
        .concat(rankMetrics.map((candidate) => formatRankMetricValue(ctx, candidate, resolveRankValue(ctx, candidate, totalIndices, rank), rank)));
    const focusedRank = focusedRankTable({ columns: rawColumns, rows: rows.concat([totalRow]) }, dimensionName, rankMetrics.map((candidate) => candidate.name));

    const conditionText = rank.metricCondition ? ` where ${rank.metricCondition.rawText}` : "";
    const pageSummary = rankPageSummary(allSorted.length, offset, ranked.length);
    const heading = rankHeading(metric, parsed, direction, `${dimensionName.toLowerCase()} by ${metric.name}${rank.perArea ? " per sqm" : ""}`);
    const appliedFilterText = filterSummaryText(parsed);
    const conciseRankText = rank.dimensionType === "filter"
        ? `${dimensionName} by ${metric.name}${appliedFilterText}.${pageSummary}`
        : `${heading}${scopeText ? ` in ${scopeText}` : ""}${conditionText}${appliedFilterText}.${pageSummary}${metricBusinessNotes([metric], direction)}${metricCalculationNotes(rankMetrics)}`;
    const benchmarkContext = {
        dimensionType: rank.dimensionType,
        dimensionLabel: dimensionName,
        metricKey: metric.key,
        metricLabel: metric.name,
        metricFormatHint: metric.formatHint,
        metricDecimalPlaces: metric.decimalPlaces,
        candidates: allSorted.map((item) => ({
            label: item.entity.label,
            indices: uniqNums(item.entity.indices || []),
            value: item.value,
            valueLabel: formatRankMetricValue(ctx, metric, item.value, rank)
        })),
        rankedLabels: ranked.map((item) => item.entity.label),
        scopeText
    };
    const percentileDetail = requestedPercentileDetail(parsed);
    if (percentileDetail) {
        const detailResponse = buildPercentileDetailResponse(
            ctx,
            metric,
            allSorted,
            percentileDetail,
            dimensionName,
            (candidate, value) => formatRankMetricValue(ctx, candidate, value, rank),
            []
        );
        if (detailResponse) return detailResponse;
    }
    if (wantsBenchmarkStatistics(parsed)) {
        const benchmarkTable = buildBenchmarkStatisticsTable(
            ctx,
            rankMetrics,
            allSorted.map((item) => item.entity.indices),
            `${dimensionName.toLowerCase()}s`,
            (candidate, indices) => resolveRankValue(ctx, candidate, indices, rank),
            (candidate, value) => formatRankMetricValue(ctx, candidate, value, rank)
        );
        const concentrationTable = buildTenantConcentrationTable(
            rankMetrics,
            allSorted.map((item) => item.entity.indices),
            (candidate, indices) => resolveRankValue(ctx, candidate, indices, rank)
        );
        const tables = [benchmarkTable, concentrationTable].filter((table): table is NonNullable<AssistantResponse["tables"]>[number] => !!table);
        if (tables.length) {
            return {
                handled: true,
                text: `Benchmark statistics for ${allSorted.length} ${dimensionName.toLowerCase()}${allSorted.length === 1 ? "" : "s"} by ${rankMetrics.map((item) => item.name).join(", ")}.`,
                tables,
                suggestions: ["Show 90th percentile tenants", "Show 75th percentile tenants", "Show 50th percentile tenants", "Show 25th percentile tenants"]
            };
        }
    }
    return {
        handled: true,
        text: conciseRankText,
        actions: ranked.slice(0, 5).map((item) => selectAction(item.entity, `Select ${item.entity.label}`)),
        table: {
            columns: focusedRank.columns,
            rows: focusedRank.rows
        },
        benchmarkContext,
        suggestions: ["Yes, show benchmark statistics"],
        chart: parsed.chartType ? {
            type: parsed.chartType,
            title: heading,
            labels: ranked.map((item) => item.entity.label),
            values: ranked.map((item) => item.value),
            valueLabels: ranked.map((item) => formatRankMetricValue(ctx, metric, item.value, rank)),
            series: buildHeatmapChartSeries(ctx, metric, ranked.map((item) => item.entity.label), ranked.map((item) => item.entity.indices))
        } : undefined
    };
}

type MatrixGroup = { key: string; label: string; indices: number[]; level: number; parentKey?: string; hasChildren: boolean };
type MatrixDimension = {
    key: string;
    label: string;
    valuesForIndex: (idx: number) => string[];
};

function explicitMatrixRowsFromQuestion(question: string): string[] {
    const text = String(question || "").toLowerCase().replace(/[?!.:,;()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
    if (!text || /\bas\s+(?:columns?|cols?)\b|\b(?:columns?|cols?)\s*:/i.test(text)) return [];
    const specs: Array<{ field: string; re: RegExp }> = [
        { field: "Assigned Group", re: /\b(?:assigned\s+groups?|groups?)\b/g },
        { field: "Assigned Sales Category", re: /\b(?:assigned\s+sales\s+categor(?:y|ies)|sales\s+categor(?:y|ies)|categor(?:y|ies))\b/g },
        { field: "Assigned Tenant Name", re: /\b(?:assigned\s+tenant\s+names?|assigned\s+tenants?|tenant\s+names?|tenants?)\b/g },
        { field: "Unit", re: /\b(?:combined\s+units?|unit\s+ids?|unit\s+names?|units?)\b/g },
        { field: "Zone", re: /\b(?:zones?|regions?)\b/g },
        { field: "Floor", re: /\b(?:floors?|levels?|ground\s+floor|first\s+floor|second\s+floor)\b/g },
        { field: "Layer", re: /\b(?:layers?)\b/g }
    ];
    const matches: Array<{ field: string; index: number }> = [];
    specs.forEach((spec) => {
        Array.from(text.matchAll(spec.re)).forEach((match) => matches.push({ field: spec.field, index: Number(match.index || 0) }));
    });
    const seen = new Set<string>();
    return matches
        .sort((a, b) => a.index - b.index)
        .map((match) => match.field)
        .filter((field) => {
            const key = normalizeAnswerText(field);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function sortMatrixRowsByCardinality(ctx: AssistantAnswerContext, rows: string[], indices: number[]): string[] {
    if ((ctx.matrixConfig?.cardinalityLowToHighHierarchy === false) || rows.length < 2) return rows;
    return rows
        .map((row, index) => {
            const dim = resolveMatrixDimension(ctx, row);
            const values = new Set<string>();
            if (dim) {
                uniqNums(indices).forEach((idx) => {
                    dim.valuesForIndex(idx).forEach((value) => {
                        const clean = normalizeAnswerText(value);
                        if (clean && clean !== "n/a" && clean !== "na" && clean !== "none" && clean !== "null" && clean !== "undefined" && clean !== "-") values.add(clean);
                    });
                });
            }
            return { row, index, cardinality: values.size || Number.MAX_SAFE_INTEGER };
        })
        .sort((a, b) => a.cardinality - b.cardinality || a.row.localeCompare(b.row, undefined, { sensitivity: "base" }) || a.index - b.index)
        .map((item) => item.row);
}

function hasExplicitMatrixRowAxis(question: string): boolean {
    return /\bas\s+rows?\b|\brows?\s*:/i.test(String(question || ""));
}

function matrixCleanLabel(value: string): string {
    return String(value || "").trim();
}

function matrixFilterFieldValue(row: NonNullable<AssistantAnswerContext["rows"][number]>, names: string[]): string {
    const filters = row.filters || {};
    const wanted = names.map((name) => normalizeAnswerText(name));
    const key = Object.keys(filters).find((item) => wanted.indexOf(normalizeAnswerText(item)) >= 0);
    return key ? matrixCleanLabel(filters[key]) : "";
}

function matrixTenantValue(ctx: AssistantAnswerContext, idx: number): string {
    const row = ctx.rows[idx];
    if (!row) return "";
    return matrixCleanLabel(matrixFilterFieldValue(row, ["Assigned Tenant Name", "Assigned Tenant", "Tenant Name", "Tenant"]) || row.tenant);
}

function matrixUnitValue(ctx: AssistantAnswerContext, idx: number): string {
    const row = ctx.rows[idx];
    if (!row) return "";
    return matrixCleanLabel(row.unitId || row.combinedUnit || matrixFilterFieldValue(row, ["Assigned Unit", "Unit", "Unit ID", "Unit Name"]));
}

function matrixCategoryValue(ctx: AssistantAnswerContext, idx: number): string {
    const row = ctx.rows[idx];
    if (!row) return "";
    return matrixCleanLabel(row.category || matrixFilterFieldValue(row, ["Assigned Sales Category", "Sales Category", "Category"]));
}

function matrixGroupValue(ctx: AssistantAnswerContext, idx: number): string {
    const row = ctx.rows[idx];
    if (!row) return "";
    return matrixCleanLabel(row.group || matrixFilterFieldValue(row, ["Assigned Group", "Group"]));
}

function findMatrixEntity(ctx: AssistantAnswerContext, phrase: string): AssistantEntity | null {
    const q = normalizeAnswerText(phrase);
    if (!q) return null;
    const compact = q.replace(/\s+/g, "");
    return (ctx.entities || []).find((entity) => {
        if (entity.kind !== "tenant" && entity.kind !== "unit" && entity.kind !== "category" && entity.kind !== "group" && entity.kind !== "zone" && entity.kind !== "layer" && entity.kind !== "floor" && entity.kind !== "filter") return false;
        return [entity.label].concat(entity.aliases || []).some((label) => {
            const clean = normalizeAnswerText(label);
            return clean === q || clean.replace(/\s+/g, "") === compact;
        });
    }) || null;
}

function findMatrixEntityByPhrase(ctx: AssistantAnswerContext, phrase: string): AssistantEntity | null {
    return findMatrixEntity(ctx, phrase);
}

function resolveMatrixDimension(ctx: AssistantAnswerContext, phrase: string): MatrixDimension | null {
    const clean = normalizeAnswerText(phrase);
    if (!clean) return null;
    const exactFilterField = filterFieldKeyForRank(ctx, clean);
    if (exactFilterField && normalizeAnswerText(exactFilterField) === clean) {
        return {
            key: `filter:${exactFilterField}`,
            label: exactFilterField,
            valuesForIndex: (idx) => {
                const value = matrixCleanLabel((ctx.rows[idx]?.filters || {})[exactFilterField]);
                return value ? [value] : [];
            }
        };
    }
    const generic = clean.replace(/\bassigned\b/g, " ").replace(/\s+/g, " ").trim();
    if (/^(tenant|tenants|tenent|tenents|tenant name|tenant names|tenant label|tenant labels|brand|brands|shop|shops|store|stores)$/.test(generic)) {
        return { key: "tenant", label: "Tenant", valuesForIndex: (idx) => matrixTenantValue(ctx, idx) ? [matrixTenantValue(ctx, idx)] : [] };
    }
    if (/^(unit|units|unit id|unit ids|unitid|unitids|unit name|unit names)$/.test(generic)) {
        return { key: "unit", label: "Unit", valuesForIndex: (idx) => matrixUnitValue(ctx, idx) ? [matrixUnitValue(ctx, idx)] : [] };
    }
    if (/^(category|categories|cat|cats|catgory|catgry|catagory|cathgry|cathgory|sales cat|sales cats|sales category|sales categories|assigned sales category|assigned sales categories)$/.test(generic)) {
        return { key: "category", label: "Category", valuesForIndex: (idx) => matrixCategoryValue(ctx, idx) ? [matrixCategoryValue(ctx, idx)] : [] };
    }
    if (/^(group|groups|assigned group|assigned groups)$/.test(generic)) {
        return { key: "group", label: "Group", valuesForIndex: (idx) => matrixGroupValue(ctx, idx) ? [matrixGroupValue(ctx, idx)] : [] };
    }
    if (/^(zone|zones|region|regions)$/.test(generic)) {
        const filterField = filterFieldKeyForRank(ctx, clean);
        if (!filterField) {
            const entities = (ctx.entities || []).filter((item) => item.kind === "zone");
            return {
                key: "zone",
                label: "Zone",
                valuesForIndex: (idx) => entities.filter((entity) => (entity.indices || []).indexOf(idx) >= 0).map((entity) => entity.label)
            };
        }
    }
    if (/^(floor|floors|level|levels)$/.test(generic)) {
        return { key: "floor", label: "Floor", valuesForIndex: (idx) => (ctx.rows[idx]?.floors || []).map(matrixCleanLabel).filter(Boolean) };
    }
    const filterField = filterFieldKeyForRank(ctx, clean);
    if (filterField && !/^(tenant|tenants|unit|units|category|categories|group|groups|zone|zones|floor|floors|layer|layers)$/.test(generic)) {
        return {
            key: `filter:${filterField}`,
            label: filterField,
            valuesForIndex: (idx) => {
                const value = matrixCleanLabel((ctx.rows[idx]?.filters || {})[filterField]);
                return value ? [value] : [];
            }
        };
    }
    if (/^(tenant|tenants|tenent|tenents|tenant name|tenant names|assigned tenant|assigned tenants|assigned tenant name|assigned tenant names|brand|brands|shop|shops|store|stores)$/.test(clean)) {
        return { key: "tenant", label: "Tenant", valuesForIndex: (idx) => matrixTenantValue(ctx, idx) ? [matrixTenantValue(ctx, idx)] : [] };
    }
    if (/^(unit|units|unit id|unit ids|unitid|unitids|unit name|unit names|assigned unit|assigned units)$/.test(clean)) {
        return { key: "unit", label: "Unit", valuesForIndex: (idx) => matrixUnitValue(ctx, idx) ? [matrixUnitValue(ctx, idx)] : [] };
    }
    if (/^(category|categories|sales category|sales categories|assigned sales category|assigned sales categories|assigned category|assigned categories)$/.test(clean)) {
        return { key: "category", label: "Category", valuesForIndex: (idx) => matrixCategoryValue(ctx, idx) ? [matrixCategoryValue(ctx, idx)] : [] };
    }
    if (/^(group|groups|assigned group|assigned groups)$/.test(clean)) {
        return { key: "group", label: "Group", valuesForIndex: (idx) => matrixGroupValue(ctx, idx) ? [matrixGroupValue(ctx, idx)] : [] };
    }
    if (/^(zone|zones|region|regions)$/.test(clean)) {
        const filterField = filterFieldKeyForRank(ctx, clean);
        if (!filterField) {
            const entities = (ctx.entities || []).filter((item) => item.kind === "zone");
            return {
                key: "zone",
                label: "Zone",
                valuesForIndex: (idx) => entities.filter((entity) => (entity.indices || []).indexOf(idx) >= 0).map((entity) => entity.label)
            };
        }
    }
    if (/^(floor|floors|level|levels)$/.test(clean)) {
        return { key: "floor", label: "Floor", valuesForIndex: (idx) => (ctx.rows[idx]?.floors || []).map(matrixCleanLabel).filter(Boolean) };
    }
    const entity = findMatrixEntity(ctx, phrase);
    if (entity) {
        const indexSet = new Set(uniqNums(entity.indices || []));
        return {
            key: `entity:${entity.kind}:${entity.id}`,
            label: entity.label,
            valuesForIndex: (idx) => indexSet.has(idx) ? [entity.label] : []
        };
    }
    if (/^(zone|zones|region|regions|layer|layers)$/.test(clean)) {
        const kind = /^(zone|region)/.test(clean) ? "zone" : "layer";
        const entities = (ctx.entities || []).filter((item) => item.kind === kind);
        return {
            key: kind,
            label: kind === "zone" ? "Zone" : "Layer",
            valuesForIndex: (idx) => entities.filter((entity) => (entity.indices || []).indexOf(idx) >= 0).map((entity) => entity.label)
        };
    }
    return null;
}

function buildMatrixGroups(ctx: AssistantAnswerContext, dims: MatrixDimension[], baseIndices: number[], maxLeafGroups: number = 80): MatrixGroup[] {
    const out: MatrixGroup[] = [];
    const walk = (indices: number[], level: number, parentKey?: string) => {
        const dim = dims[level];
        if (!dim) return;
        const byValue = new Map<string, { label: string; indices: number[] }>();
        uniqNums(indices).forEach((idx) => {
            const values = dim.valuesForIndex(idx);
            values.forEach((value) => {
                const label = matrixCleanLabel(value);
                if (!label || /^n\/a$|^na$|^none$|^null$|^undefined$|^-$/i.test(label)) return;
                const key = label.toLowerCase();
                if (!byValue.has(key)) byValue.set(key, { label, indices: [] });
                byValue.get(key)!.indices.push(idx);
            });
        });
        Array.from(byValue.values())
            .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true }))
            .slice(0, maxLeafGroups)
            .forEach((group) => {
                const key = `${parentKey || "root"}>${level}:${group.label.toLowerCase()}`;
                const hasChildren = level < dims.length - 1;
                const row: MatrixGroup = { key, label: group.label, indices: uniqNums(group.indices), level, parentKey, hasChildren };
                out.push(row);
                if (hasChildren) walk(row.indices, level + 1, key);
            });
    };
    walk(baseIndices, 0);
    return out;
}

function buildFlatMatrixGroups(ctx: AssistantAnswerContext, dims: MatrixDimension[], baseIndices: number[], maxGroups: number = 24): MatrixGroup[] {
    if (!dims.length) return [];
    if (dims.length === 1) return buildMatrixGroups(ctx, dims, baseIndices, maxGroups).filter((group) => group.level === 0).slice(0, maxGroups);
    const all = buildMatrixGroups(ctx, dims, baseIndices, maxGroups);
    const byKey = new Map(all.map((group) => [group.key, group]));
    const lineage = (group: MatrixGroup): string[] => {
        const parts: string[] = [];
        let current: MatrixGroup | undefined = group;
        while (current) {
            parts.unshift(current.label);
            current = current.parentKey ? byKey.get(current.parentKey) : undefined;
        }
        return parts;
    };
    return all
        .filter((group) => group.level === dims.length - 1)
        .slice(0, maxGroups)
        .map((group) => {
            const parts = lineage(group);
            const leaf = parts[parts.length - 1] || group.label;
            const parents = parts.slice(0, -1);
            return {
                ...group,
                label: parents.length ? `${leaf} (${parents.join(" > ")})` : leaf,
                hasChildren: false,
                parentKey: undefined,
                level: 0
            };
        });
}

function matrixFilterLabels(parsed: ParsedAssistantQuestion): string[] {
    const filters = parsed.filters;
    if (!filters) return [];
    const out: string[] = [];
    if (filters.floorPhrase) out.push(`floor ${filters.floorPhrase}`);
    if (filters.nearPhrase) out.push(`near ${filters.nearPhrase}`);
    if (filters.areaMin !== undefined) out.push(`area >= ${filters.areaMin}`);
    if (filters.areaMax !== undefined) out.push(`area <= ${filters.areaMax}`);
    (filters.includeFilters || []).forEach((filter) => out.push(`include ${filter.phrase}`));
    (filters.excludeFilters || []).forEach((filter) => out.push(`exclude ${filter.phrase}`));
    return out;
}

function matrixFieldOptions(ctx: AssistantAnswerContext): { rows: string[]; columns: string[]; values: string[] } {
    const fieldNames = ["Assigned Sales Category", "Assigned Group", "Assigned Tenant Name", "Unit", "Zone", "Floor"];
    const filterFields = new Set<string>();
    (ctx.rows || []).forEach((row) => Object.keys(row?.filters || {}).forEach((key) => {
        const clean = String(key || "").trim();
        if (clean) filterFields.add(clean);
    }));
    const values = Array.from(new Set((ctx.metrics || [])
        .map((metric) => String(metric.name || "").trim())
        .filter(Boolean)));
    return {
        rows: fieldNames.concat(Array.from(filterFields).slice(0, 8)),
        columns: fieldNames.concat(Array.from(filterFields).slice(0, 8)),
        values
    };
}

function matrixMetricDedupeKey(metric: AssistantMetric): string {
    const primary = String(metric.name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    if (metric.key === "__builtin::area" || primary === "area" || primary === "sum of area" || primary === "total area") {
        return "__semantic::generic-area";
    }
    const labels = [metric.name].concat(metric.aliases || [])
        .map((label) => String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim())
        .filter(Boolean);
    const genericArea = labels.some((label) => label === "area" || label === "sum of area" || label === "total area" || label === "sqm" || label === "gla");
    const specificArea = labels.some((label) => /\b(?:floor|variance|delta|erv|sales|rent|revenue|turnover|ocr|occupancy|ratio|rate|per)\b/.test(label));
    if (genericArea && !specificArea) return "__semantic::generic-area";
    return String(metric.key || metric.name || "");
}

function matrixFilterMentionedInQuestion(parsed: ParsedAssistantQuestion, phrase: string): boolean {
    const cleanPhrase = normalizeAnswerText(String(phrase || "").replace(/^(?:include|exclude)\s+/i, ""));
    if (!cleanPhrase) return false;
    const raw = ` ${normalizeAnswerText(`${parsed.raw || ""} ${parsed.normalized || ""}`)} `;
    return raw.indexOf(` ${cleanPhrase} `) >= 0;
}

function pruneUnmentionedMatrixFilters(parsed: ParsedAssistantQuestion): ParsedAssistantQuestion {
    const filters = parsed.filters;
    const includeFilters = (filters?.includeFilters || []).filter((filter) =>
        matrixFilterMentionedInQuestion(parsed, filter.phrase)
    );
    const excludeFilters = (filters?.excludeFilters || []).filter((filter) =>
        matrixFilterMentionedInQuestion(parsed, filter.phrase)
    );
    const matrix = parsed.matrix
        ? {
            ...parsed.matrix,
            filters: (parsed.matrix.filters || []).filter((filter) => matrixFilterMentionedInQuestion(parsed, filter)),
            query: parsed.matrix.query
                ? {
                    ...parsed.matrix.query,
                    filters: (parsed.matrix.query.filters || []).filter((filter) =>
                        matrixFilterMentionedInQuestion(parsed, filter.phrase)
                    )
                }
                : parsed.matrix.query
        }
        : parsed.matrix;
    return {
        ...parsed,
        matrix,
        filters: includeFilters.length || excludeFilters.length
            ? { ...(filters || {}), includeFilters, excludeFilters }
            : undefined
    };
}

export function answerMatrix(
    ctx: AssistantAnswerContext,
    parsed: ParsedAssistantQuestion,
    metric: AssistantMetric | AssistantMetric[],
    _entities: AssistantEntity[]
): AssistantResponse {
    parsed = pruneUnmentionedMatrixFilters(parsed);
    const spec = parsed.matrix;
    if (!spec) return { handled: false, text: "I could not identify the matrix rows and columns." };
    const seenMetricKeys = new Set<string>();
    const metrics = (Array.isArray(metric) ? metric : [metric])
        .filter((item) => {
            if (!item) return false;
            const key = matrixMetricDedupeKey(item);
            if (seenMetricKeys.has(key)) return false;
            seenMetricKeys.add(key);
            return true;
        })
        .slice(0, 6);
    const metricLabelSet = new Set<string>();
    metrics.forEach((item) => {
        [item.name].concat(item.aliases || []).forEach((label) => {
            const clean = normalizeAnswerText(label);
            if (clean) metricLabelSet.add(clean);
        });
    });
    const isMetricAxis = (value: string): boolean => {
        const clean = normalizeAnswerText(value);
        if (!clean) return false;
        if (metricLabelSet.has(clean)) return true;
        return clean.split(/\s*>\s*|\s*\/\s*/g).some((part) => metricLabelSet.has(normalizeAnswerText(part)));
    };
    const rawMatrixQuery = normalizeMatrixQuery(spec.query || {
        rows: spec.rows?.length ? spec.rows : spec.rowPhrases,
        columns: spec.columns?.length ? spec.columns : spec.columnPhrases,
        values: spec.defaultValue ? [] : (spec.values?.length ? spec.values : (spec.metricPhrases?.length ? spec.metricPhrases : [spec.metricPhrase])),
        filters: spec.filters?.length ? spec.filters : matrixFilterLabels(parsed),
        topN: spec.topN,
        sort: spec.sortByTotal ? { by: "grandTotal", direction: spec.sortByTotal } : undefined,
        hideZeros: spec.hideZeros,
        valueMode: spec.valueMode
    });
    const baseIndices = filterRowIndicesByParsed(ctx, uniqNums((ctx.rows || []).map((row) => row.idx)), parsed);
    const explicitRows = hasExplicitMatrixRowAxis(parsed.raw || parsed.normalized || "")
        ? explicitMatrixRowsFromQuestion(parsed.raw || parsed.normalized || "")
        : [];
    const correctedRows = explicitRows.length >= 2
        ? explicitRows
        : explicitRows.length > rawMatrixQuery.rows.length
        ? explicitRows
        : sortMatrixRowsByCardinality(ctx, rawMatrixQuery.rows, baseIndices);
    const correctedColumns = explicitRows.length >= 2 || explicitRows.length > rawMatrixQuery.rows.length
        ? []
        : rawMatrixQuery.columns;
    const matrixQuery = normalizeMatrixQuery({
        ...rawMatrixQuery,
        rows: correctedRows.filter((row) => !isMetricAxis(row)),
        columns: correctedColumns.filter((column) => !isMetricAxis(column)),
        values: metrics.length ? metrics.map((item) => item.name) : rawMatrixQuery.values
    });
    const queryRows = matrixQuery.rows.slice(0, 5);
    const queryColumns = matrixQuery.columns.slice(0, 4);
    const queryValues = matrixQuery.values.slice(0, 6);
    const queryFilters = matrixQuery.filters.map(matrixFilterToText).filter(Boolean);
    const primaryMetric = metrics[0];
    if (!primaryMetric) return { handled: false, text: "I could not identify the matrix metric." };
    const rowDims = queryRows.map((phrase) => resolveMatrixDimension(ctx, phrase)).filter((item): item is MatrixDimension => !!item);
    const resolvedColumnDims = queryColumns.map((phrase) => resolveMatrixDimension(ctx, phrase));
    const columnDims = resolvedColumnDims.filter((item): item is MatrixDimension => !!item);
    const explicitColumnEntities = columnDims.length ? [] : queryColumns.map((phrase) => findMatrixEntityByPhrase(ctx, phrase));
    const useExplicitColumns = !columnDims.length && explicitColumnEntities.length > 0 && explicitColumnEntities.every(Boolean);
    const missingRows = queryRows.filter((phrase, index) => !rowDims[index]);
    const missingCols = queryColumns.filter((phrase, index) => !resolvedColumnDims[index]);
    if ((!rowDims.length && queryRows.length) || (!columnDims.length && !useExplicitColumns && queryColumns.length)) {
        const missing = missingRows.concat(missingCols).join(", ");
        return { handled: true, text: `I couldn't find ${missing || "the requested row/column fields"} in the loaded fields.` };
    }
    const rowGroups = rowDims.length
        ? buildMatrixGroups(ctx, rowDims, baseIndices, 100)
        : [{ key: "metric", label: "Total", indices: baseIndices, level: 0, hasChildren: false }];
    const columnGroups: MatrixGroup[] = useExplicitColumns
        ? (explicitColumnEntities as AssistantEntity[]).map((entity) => ({ key: `${entity.kind}:${entity.id}`, label: entity.label, indices: uniqNums(entity.indices || []), level: 0, hasChildren: false }))
        : columnDims.length
        ? buildFlatMatrixGroups(ctx, columnDims, baseIndices, 20)
        : [];
    if (!rowGroups.length || (!columnGroups.length && !metrics.length)) return { handled: true, text: "No matching rows or columns were found for this matrix." };
    const sortDirection = matrixQuery.sort?.direction || spec.sortByTotal;
    const topN = matrixQuery.topN || spec.topN;
    const hideZeros = parsed.hasExplicitSelections ? false : (matrixQuery.hideZeros || spec.hideZeros);
    const responseMatrixQuery = parsed.hasExplicitSelections ? { ...matrixQuery, hideZeros: false } : matrixQuery;
    const valueMode = matrixQuery.valueMode || spec.valueMode;
    const valueFor = (rowIndices: number[], colIndices: number[], currentMetric: AssistantMetric): string => {
        const intersected = intersectNums(rowIndices, colIndices);
        if (!intersected.length) return "0";
        const value = resolveMetricValue(ctx, currentMetric, intersected);
        return validValue(value) ? formatAssistantMetric(ctx, currentMetric, value) : "0";
    };
    const rawValueFor = (rowIndices: number[], colIndices: number[], currentMetric: AssistantMetric): number => {
        const intersected = intersectNums(rowIndices, colIndices);
        if (!intersected.length) return NaN;
        return resolveMetricValue(ctx, currentMetric, intersected);
    };
    const formatMatrixValue = (value: number, currentMetric: AssistantMetric): string => {
        if (!validValue(value)) return "0";
        if (valueMode && valueMode !== "raw") return `${ctx.formatNumber(value, { maximumFractionDigits: 1 })}%`;
        return formatAssistantMetric(ctx, currentMetric, value);
    };
    const valueColumns: NonNullable<NonNullable<AssistantResponse["matrix"]>["columns"]> = [];
    const valueColumnSpecs: Array<{ key: string; indices: number[]; metric: AssistantMetric; label: string; level: number; parentKey?: string }> = [];
    const addValueColumn = (key: string, label: string, indices: number[], currentMetric: AssistantMetric, level: number = 0, parentKey?: string) => {
        valueColumns.push({ key, label, level, hasChildren: false, parentKey });
        valueColumnSpecs.push({ key, label, indices, metric: currentMetric, level, parentKey });
    };
    if (columnGroups.length) {
        columnGroups.forEach((group) => {
            if (metrics.length === 1) {
                addValueColumn(group.key, group.label, group.indices, primaryMetric, group.level, group.parentKey);
            } else {
                metrics.forEach((currentMetric) => {
                    addValueColumn(`${group.key}::${currentMetric.key}`, `${group.label} / ${currentMetric.name}`, group.indices, currentMetric, group.level, group.parentKey);
                });
            }
        });
        metrics.forEach((currentMetric) => {
            addValueColumn(`grand-total::${currentMetric.key}`, metrics.length === 1 ? "Grand Total" : `Grand Total / ${currentMetric.name}`, baseIndices, currentMetric, 0);
        });
    } else {
        metrics.forEach((currentMetric) => {
            addValueColumn(`metric::${currentMetric.key}`, currentMetric.name, baseIndices, currentMetric, 0);
        });
    }
    let effectiveRowGroups = rowGroups.slice();
    if (sortDirection || topN) {
        effectiveRowGroups = effectiveRowGroups.slice().sort((a, b) => {
            const av = rawValueFor(a.indices, baseIndices, primaryMetric);
            const bv = rawValueFor(b.indices, baseIndices, primaryMetric);
            const an = validValue(av) ? av : 0;
            const bn = validValue(bv) ? bv : 0;
            return sortDirection === "asc" ? an - bn : bn - an;
        });
    }
    if (topN) effectiveRowGroups = effectiveRowGroups.slice(0, topN);

    let matrixRows: NonNullable<AssistantResponse["matrix"]>["rows"] = effectiveRowGroups.map((row) => ({
        key: row.key,
        label: row.label,
        level: row.level,
        hasChildren: row.hasChildren,
        parentKey: row.parentKey,
        indices: row.indices,
        values: valueColumnSpecs.map((col) => {
            const raw = rawValueFor(row.indices, col.indices, col.metric);
            if (valueMode === "percentOfRow") {
                const denom = rawValueFor(row.indices, baseIndices, col.metric);
                return formatMatrixValue(validValue(raw) && validValue(denom) && Math.abs(denom) > 1e-12 ? (raw / denom) * 100 : NaN, col.metric);
            }
            if (valueMode === "percentOfColumn") {
                const denom = rawValueFor(baseIndices, col.indices, col.metric);
                return formatMatrixValue(validValue(raw) && validValue(denom) && Math.abs(denom) > 1e-12 ? (raw / denom) * 100 : NaN, col.metric);
            }
            if (valueMode === "percentOfTotal") {
                const denom = rawValueFor(baseIndices, baseIndices, col.metric);
                return formatMatrixValue(validValue(raw) && validValue(denom) && Math.abs(denom) > 1e-12 ? (raw / denom) * 100 : NaN, col.metric);
            }
            return valueFor(row.indices, col.indices, col.metric);
        })
    }));
    if (hideZeros) {
        const isZeroText = (value: string): boolean => {
            const n = Number(String(value || "").replace(/,/g, "").replace(/%/g, "").trim());
            return !Number.isFinite(n) || Math.abs(n) < 1e-12;
        };
        matrixRows = matrixRows.filter((row) => row.values.some((value) => !isZeroText(value)));
    }
    if (spec.totalsMode !== "hide") {
        const totalRow = {
            key: "grand-total",
            label: "Grand Total",
            level: 0,
            hasChildren: false,
            isTotal: true,
            indices: baseIndices,
            values: valueColumnSpecs.map((col) => {
                if (valueMode === "percentOfRow" || valueMode === "percentOfColumn" || valueMode === "percentOfTotal") {
                    return "100%";
                }
                return valueFor(baseIndices, col.indices, col.metric);
            })
        };
        matrixRows = spec.totalsMode === "only" ? [totalRow] : matrixRows.concat(totalRow);
    }
    let effectiveValueColumns = valueColumns;
    if (hideZeros && matrixRows.length) {
        const keepColumns = valueColumnSpecs.map((_col, index) => matrixRows.some((row) => {
            const n = Number(String(row.values[index] || "").replace(/,/g, "").replace(/%/g, "").trim());
            return Number.isFinite(n) && Math.abs(n) > 1e-12;
        }));
        effectiveValueColumns = valueColumns.filter((_col, index) => keepColumns[index]);
        valueColumnSpecs.splice(0, valueColumnSpecs.length, ...valueColumnSpecs.filter((_col, index) => keepColumns[index]));
        matrixRows = matrixRows.map((row) => ({ ...row, values: row.values.filter((_value, index) => keepColumns[index]) }));
    }
    const rowHeader = rowDims.length ? rowDims.map((dim) => dim.label).join(" > ") : "Scope";
    const colHeader = columnGroups.length
        ? (useExplicitColumns ? "Selection" : columnDims.map((dim) => dim.label).join(" > "))
        : metrics.length > 1 ? "Metric" : "Total";
    const metricNames = metrics.map((item) => item.name);
    const matrixFieldConfidence = (parsed.fieldResolutions || [])
        .filter((resolution) => resolution.role === "row" || resolution.role === "column" || resolution.role === "value")
        .map((resolution) => resolution.confidence);
    const needsInterpretationConfirmation = matrixFieldConfidence.some((confidence) => confidence >= 0.55 && confidence < 0.9);
    return {
        handled: true,
        text: `${metricNames.join(", ")} matrix by ${rowHeader} rows and ${colHeader} columns.`,
        matrix: {
            title: `${metricNames.join(", ")} matrix`,
            metricName: metricNames.join(", "),
            metricNames,
            rowHeader,
            columnHeaders: effectiveValueColumns.map((group) => group.label),
            query: {
                ...responseMatrixQuery,
                rows: queryRows,
                columns: queryColumns,
                values: queryValues.length ? queryValues : metricNames
            },
            summary: [],
            interpretation: needsInterpretationConfirmation ? {
                rows: queryRows,
                columns: queryColumns,
                values: queryValues.length ? queryValues : metricNames,
                filters: queryFilters,
                needsConfirmation: true
            } : undefined,
            fieldOptions: matrixFieldOptions(ctx),
            columns: effectiveValueColumns,
            rows: matrixRows
        }
    };
}

export function answerList(
    ctx: AssistantAnswerContext,
    parsed: ParsedAssistantQuestion,
    entities: AssistantEntity[]
): AssistantResponse {
    const scopeEntities = entities.filter(isRankScopeEntity);
    const fallbackScope = !scopeEntities.length && entities[0] ? entities[0] : null;
    const scopeIndices = combineScopeIndices(scopeEntities);
    const base = scopeIndices || (fallbackScope ? uniqNums(fallbackScope.indices) : ctx.rows.map((row) => row.idx));
    const wantsVacant = parsed.tokens.some((token) => token === "vacant" || token === "empty" || token === "available");
    const wantsOccupied = parsed.tokens.some((token) => token === "occupied");
    let rows = filterRowIndicesByParsed(ctx, base, parsed).map((idx) => ctx.rows[idx]).filter(Boolean);
    if (wantsVacant) {
        rows = rows.filter((row) => /vacant|empty|available/i.test(`${row.tenant} ${row.category} ${row.group}`));
    } else if (wantsOccupied) {
        rows = rows.filter((row) => !/vacant|empty|available/i.test(`${row.tenant} ${row.category} ${row.group}`));
    }
    const wantsTenantList = parsed.tokens.some((token) => token === "tenant" || token === "tenants" || token === "brand" || token === "brands" || token === "shop" || token === "shops")
        || /\b(who|brands?|shops?|stores?|retailers?)\b/i.test(parsed.normalized || "");
    const filterParts = [
        parsed.filters?.areaMin !== undefined ? `over ${ctx.formatNumber(Number(parsed.filters.areaMin), { maximumFractionDigits: 0 })} sqm` : "",
        parsed.filters?.areaMax !== undefined ? `under ${ctx.formatNumber(Number(parsed.filters.areaMax), { maximumFractionDigits: 0 })} sqm` : "",
        parsed.filters?.floorPhrase ? `on ${parsed.filters.floorPhrase} floor` : "",
        parsed.filters?.nearPhrase ? `near ${parsed.filters.nearPhrase}` : ""
    ].filter(Boolean);
    if (wantsTenantList) {
        const extraFields = requestedDetailFields(ctx, parsed);
        const tenantRows = tenantListTable(ctx, rows, extraFields);
        if (!tenantRows.length) return { handled: true, text: "No matching tenants found in the loaded visual data." };
        const defaultLimit = 20;
        const limit = Math.max(1, Math.min(100, parsed.limit || defaultLimit));
        const displayRows = tenantRows.slice(0, limit);
        const scopeText = scopeEntities.length ? ` in ${scopeTextForEntities(scopeEntities)}` : (fallbackScope ? ` in ${scopeLabel(fallbackScope)}` : "");
        const actionScope = scopeEntities.length
            ? { ...scopeEntities[0], indices: rows.map((row) => row.idx) }
            : (fallbackScope ? { ...fallbackScope, indices: rows.map((row) => row.idx) } : null);
        return {
            handled: true,
            text: `Found ${tenantRows.length} tenant${tenantRows.length !== 1 ? "s" : ""}${scopeText}. Showing ${displayRows.length}${tenantRows.length > displayRows.length ? ` of ${tenantRows.length}` : ""}.${filterParts.length ? ` Filters: ${filterParts.join(", ")}.` : ""}`,
            actions: actionScope ? [selectAction(actionScope)] : undefined,
            table: {
                columns: ["Tenant"].concat(extraFields),
                rows: displayRows
            }
        };
    }
    const limit = parsed.limit || 10;
    const names = rows.slice(0, limit).map((row) => row.tenant || row.unitId || row.shapeKey || `Row ${row.idx + 1}`);
    if (!names.length) return { handled: true, text: "No matching rows found in the loaded visual data." };
    const suffix = rows.length > names.length ? `, and ${rows.length - names.length} more` : "";
    const extraFields = requestedDetailFields(ctx, parsed);
    const tableRows = rowDetailTable(ctx, rows.slice(0, limit).map((row) => row.idx), undefined, extraFields);
    return {
        handled: true,
        text: `${names.join(", ")}${suffix}.${filterParts.length ? ` (${filterParts.join(", ")})` : ""}`,
        actions: fallbackScope ? [selectAction({ ...fallbackScope, indices: rows.map((row) => row.idx) })] : undefined,
        table: projectTable({
            columns: ["Unit", "Tenant", "Category", "Group", "Floor", "Area"].concat(extraFields),
            rows: tableRows
        }, ["Unit", "Tenant"].concat(extraFields))
    };
}

export function answerSummary(
    ctx: AssistantAnswerContext,
    entity: AssistantEntity,
    metrics: AssistantMetric[]
): AssistantResponse {
    const unitMetric = ctx.metrics.find((metric) => metric.key === "__builtin::units");
    const areaMetric = ctx.metrics.find((metric) => metric.key === "__builtin::area");
    const summaryMetrics = [unitMetric, areaMetric].filter(Boolean) as AssistantMetric[];
    const dynamic = metrics.filter((metric) => metric.kind === "dynamic").slice(0, 3);
    const parts = summaryMetrics.concat(dynamic).map((metric) => {
        const value = metric.key === "__builtin::area" && shouldUsePrimaryAreaForEntity(ctx, entity)
            ? primaryAreaValue(ctx, entity.indices)
            : resolveMetricValue(ctx, metric, entity.indices);
        return `${metric.name}: ${formatAssistantMetric(ctx, metric, value)}`;
    });
    const reasoning = buildReasoningInsights(ctx, entity, dynamic);
    const reasoningText = reasoning.sentences.length ? ` ${reasoning.sentences.join(" ")}` : "";
    const notes = metricCalculationNotes(dynamic);
    if (entity.kind === "bookmark") {
        const heatmapFields = String(entity.meta?.heatmapFields || "").trim();
        const filters = String(entity.meta?.filters || "").trim();
        const description = String(entity.meta?.description || "").trim();
        const details = [
            heatmapFields ? `Measures: ${heatmapFields}` : "",
            filters ? `Filters: ${filters}` : "",
            description ? `Description: ${description}` : ""
        ].filter(Boolean);
        return {
            handled: true,
            text: `${scopeLabel(entity)} summary: ${parts.join("; ")}.${details.length ? ` ${details.join("; ")}.` : ""}${reasoningText}${notes}`,
            actions: [selectAction(entity)],
            table: reasoning.rows.length ? { columns: ["Metric", "Value", "Peer position", "Reasoning signal"], rows: reasoning.rows } : undefined
        };
    }
    return {
        handled: true,
        text: `${scopeLabel(entity)} summary: ${parts.join("; ")}.${reasoningText}${notes}`,
        actions: [selectAction(entity)],
        table: reasoning.rows.length ? { columns: ["Metric", "Value", "Peer position", "Reasoning signal"], rows: reasoning.rows } : undefined
    };
}

export function answerTrend(
    ctx: AssistantAnswerContext,
    parsed: ParsedAssistantQuestion,
    entities: AssistantEntity[],
    metrics: AssistantMetric[]
): AssistantResponse {
    const isTrendMetric = (m: AssistantMetric): boolean => {
        const haystack = [m.name].concat(m.aliases || []).join(" ").toLowerCase();
        return /\b(yoy|ytd|year|quarter|q[1-4]|month|monthly|period|trend|growth|change|increase|decrease|previous|prior|last\s+year|vs\s+(?:last|prev))\b/.test(haystack);
    };
    const stripPeriodWords = (name: string): string =>
        name.toLowerCase()
            .replace(/\b(yoy|ytd|q[1-4]|year|quarter|month|period|growth|change|trend|previous|prior|last|vs|over)\b/g, "")
            .replace(/\s+/g, " ").trim();
    const relatedToBase = (base: AssistantMetric, candidate: AssistantMetric): boolean => {
        const b = stripPeriodWords(base.name);
        const c = stripPeriodWords(candidate.name);
        return !!b && !!c && (b === c || b.includes(c) || c.includes(b));
    };

    let trendMetrics: AssistantMetric[];
    if (metrics.length) {
        trendMetrics = ctx.metrics.filter((m) => m.key === metrics[0].key || (isTrendMetric(m) && relatedToBase(metrics[0], m)));
        if (trendMetrics.length <= 1) trendMetrics = ctx.metrics.filter(isTrendMetric);
    } else {
        trendMetrics = ctx.metrics.filter(isTrendMetric);
    }

    if (!trendMetrics.length) {
        const available = ctx.metrics.filter((m) => m.kind === "dynamic").slice(0, 5).map((m) => m.name);
        return {
            handled: true,
            text: `No time-period metrics found for trend analysis. Trend requires fields like YoY, YTD, Q1/Q2, or growth metrics. Available metrics: ${available.join(", ") || "none"}.`,
            suggestions: available
        };
    }

    const entity = entities[0];

    if (entity) {
        const validTrend = trendMetrics.filter((m) => validValue(resolveMetricValue(ctx, m, entity.indices)));
        const tableRows = validTrend.map((m) => [m.name, formatAssistantMetric(ctx, m, resolveMetricValue(ctx, m, entity.indices))]);
        const chartValues = validTrend.map((m) => resolveMetricValue(ctx, m, entity.indices));
        return {
            handled: true,
            text: `Trend data for ${entity.label} across ${tableRows.length} time-period metric${tableRows.length !== 1 ? "s" : ""}.`,
            table: tableRows.length ? { columns: ["Metric", "Value"], rows: tableRows } : undefined,
            chart: chartValues.length >= 2 ? {
                type: "line",
                title: `${entity.label} trend`,
                labels: validTrend.map((m) => m.name),
                values: chartValues,
                valueLabels: chartValues.map((v, i) => formatAssistantMetric(ctx, validTrend[i], v))
            } : undefined,
            actions: [selectAction(entity)]
        };
    }

    const growthMetric = trendMetrics.find((m) =>
        /yoy|growth|change|increase/.test([m.name].concat(m.aliases || []).join(" ").toLowerCase())
    ) || trendMetrics[0];
    const tenantPool = ctx.entities.filter((e) => (e.kind === "tenant" || e.kind === "unit") && e.indices.length > 0);
    const ranked = tenantPool
        .map((e) => ({ entity: e, value: resolveMetricValue(ctx, growthMetric, e.indices) }))
        .filter((item) => validValue(item.value))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8);
    if (!ranked.length) {
        return { handled: true, text: `No tenant data found for ${growthMetric.name}.` };
    }
    return {
        handled: true,
        text: `Tenants ranked by ${growthMetric.name}.${metricCalculationNotes([growthMetric])}`,
        table: {
            columns: ["Rank", "Tenant", growthMetric.name],
            rows: ranked.map((item, i) => [String(i + 1), item.entity.label, formatAssistantMetric(ctx, growthMetric, item.value)])
        },
        chart: {
            type: parsed.chartType || "bar",
            title: `${growthMetric.name} trend`,
            labels: ranked.map((item) => item.entity.label),
            values: ranked.map((item) => item.value),
            valueLabels: ranked.map((item) => formatAssistantMetric(ctx, growthMetric, item.value))
        }
    };
}

export function answerFilter(
    ctx: AssistantAnswerContext,
    parsed: ParsedAssistantQuestion,
    entities: AssistantEntity[]
): AssistantResponse {
    const filters = parsed.filters;
    const hasFilter = filters && (
        filters.areaMin !== undefined ||
        filters.areaMax !== undefined ||
        !!filters.floorPhrase ||
        !!filters.nearPhrase
    );
    if (!hasFilter) {
        return {
            handled: true,
            text: `I couldn't detect filter criteria. Try: "show tenants under 500 sqm", "tenants on floor 2", or "tenants between 100 and 1000 sqm".`
        };
    }

    const criteria: string[] = [];
    if (filters!.areaMin !== undefined) criteria.push(`area > ${ctx.formatNumber(filters!.areaMin, { maximumFractionDigits: 0 })} sqm`);
    if (filters!.areaMax !== undefined) criteria.push(`area < ${ctx.formatNumber(filters!.areaMax, { maximumFractionDigits: 0 })} sqm`);
    if (filters!.floorPhrase) criteria.push(`on ${filters!.floorPhrase} floor`);
    if (filters!.nearPhrase) criteria.push(`near ${filters!.nearPhrase}`);

    const scopeEntities = entities.filter(isScopeEntity);
    const baseIndices = scopeEntities.length
        ? uniqNums(scopeEntities.reduce((out: number[], e) => out.concat(e.indices), []))
        : ctx.rows.map((_, idx) => idx);

    const filteredIndices = filterRowIndicesByParsed(ctx, baseIndices, parsed);
    if (!filteredIndices.length) {
        return { handled: true, text: `No tenants found matching: ${criteria.join(", ")}.` };
    }

    const filteredRows = filteredIndices.map((idx) => ctx.rows[idx]).filter(Boolean);
    const wantsUnits = (parsed.tokens || []).some((token) => token === "unit" || token === "units");
    if (wantsUnits) {
        const extraFields = requestedDetailFields(ctx, parsed);
        const tableRows = rowDetailTable(ctx, filteredIndices, undefined, extraFields);
        return {
            handled: true,
            text: `Found ${tableRows.length} unit${tableRows.length !== 1 ? "s" : ""} matching: ${criteria.join(", ")}.`,
            autoSelectIndices: filteredIndices,
            table: projectTable({
                columns: ["Unit", "Tenant", "Category", "Group", "Floor", "Area"].concat(extraFields),
                rows: tableRows
            }, ["Unit", "Tenant"].concat(extraFields))
        };
    }
    const extraFields = requestedDetailFields(ctx, parsed);
    const tableRows = tenantListTable(ctx, filteredRows, extraFields);

    const seenLabels = new Set<string>();
    const actions: AssistantAction[] = [];
    filteredRows.forEach((row) => {
        const label = String(row.tenant || row.unitId || "").trim();
        const key = label.toLowerCase();
        if (!label || seenLabels.has(key) || actions.length >= 5) return;
        seenLabels.add(key);
        actions.push(selectAction({ id: key, kind: "tenant" as const, label, aliases: [], indices: [row.idx] }, `Select ${label}`));
    });

    return {
        handled: true,
        text: `Found ${tableRows.length} tenant${tableRows.length !== 1 ? "s" : ""} matching: ${criteria.join(", ")}.`,
        actions,
        autoSelectIndices: filteredIndices,
        table: { columns: ["Tenant"].concat(extraFields), rows: tableRows }
    };
}

export function answerExplain(
    ctx: AssistantAnswerContext,
    parsed: ParsedAssistantQuestion,
    entities: AssistantEntity[],
    metrics: AssistantMetric[]
): AssistantResponse {
    const normalized = String(parsed.normalized || "").toLowerCase();
    const asksRed = /\b(red|amber|orange|warning|bad|poor|danger)\b/.test(normalized);
    const asksGreen = /\b(green|good|success|positive|best)\b/.test(normalized);
    const asksColor = asksRed || asksGreen || /\b(highlight|color|colour|heatmap)\b/.test(normalized);
    const entity = entities[0];

    if (!entity) {
        if (asksColor) {
            const heatMetrics = ctx.metrics.filter((m) => m.role === "heatmap");
            const metricList = heatMetrics.length
                ? heatMetrics.map((m) => m.name).join(", ")
                : ctx.metrics.filter((m) => m.kind === "dynamic").slice(0, 4).map((m) => m.name).join(", ");
            return {
                handled: true,
                text: `Choose a field value and measure to explain its performance relative to other loaded rows. Available metric${heatMetrics.length > 1 ? "s" : ""}: ${metricList || "none active"}.`
            };
        }
        return { handled: false, text: "Please specify a tenant, zone, or category to explain." };
    }

    const dynamicMetrics = ctx.metrics.filter((m) => m.kind === "dynamic");
    const heatMetrics = dynamicMetrics.filter((m) => m.role === "heatmap");
    const checkMetrics = (metrics.length ? metrics : (heatMetrics.length ? heatMetrics : dynamicMetrics)).slice(0, 6);
    const tenants = ctx.entities.filter((e) => (e.kind === "tenant" || e.kind === "unit") && e.indices.length > 0);

    const metricRows: string[][] = [];
    const colorParts: string[] = [];

    checkMetrics.forEach((m) => {
        const value = resolveMetricValue(ctx, m, entity.indices);
        if (!validValue(value)) return;
        const formatted = formatAssistantMetric(ctx, m, value);
        const allValues = tenants.map((t) => resolveMetricValue(ctx, m, t.indices)).filter(validValue).sort((a, b) => a - b);
        const rank = allValues.filter((v) => v <= value).length;
        const pct = allValues.length > 1 ? Math.round((rank / allValues.length) * 100) : 50;
        const isHighBad = /\b(ocr|cost ratio|expense|vacancy|vacant)\b/.test(m.name.toLowerCase());
        const colorSignal = isHighBad
            ? (pct >= 70 ? "red — high is unfavourable" : pct <= 30 ? "green — low is favourable" : "amber — mid range")
            : (pct >= 70 ? "green — high is favourable" : pct <= 30 ? "red — low is unfavourable" : "amber — mid range");
        const rankLabel = `#${tenants.length - rank + 1} of ${allValues.length}`;
        metricRows.push([m.name, formatted, rankLabel, colorSignal]);
        colorParts.push(`${m.name}: ${formatted} (${colorSignal})`);
    });

    const category = distinctRowValues(ctx, entity.indices, (row) => row.category);
    const floors = distinctRowValues(ctx, entity.indices, (row) => row.floors || []);
    const unitCount = distinctUnitCount(ctx, entity.indices);
    const intro = `${entity.label} — ${category !== "N/A" ? category : "tenant"}, ${floors !== "N/A" ? floors : "unknown floor"}, ${unitCount} unit${unitCount !== 1 ? "s" : ""}.`;
    const reasoning = buildReasoningInsights(ctx, entity, checkMetrics);

    const relevantParts = asksRed
        ? colorParts.filter((p) => p.includes("red"))
        : asksGreen
        ? colorParts.filter((p) => p.includes("green"))
        : colorParts.slice(0, 3);
    const colorSummary = relevantParts.join(" ") ||
        (asksRed ? `No metrics are flagged red for ${entity.label}.` :
            asksGreen ? `No metrics are flagged green for ${entity.label}.` : "");

    return {
        handled: true,
        text: `${intro}${colorSummary ? " " + colorSummary : ""}${reasoning.sentences.length ? " " + reasoning.sentences.join(" ") : ""}`,
        table: metricRows.length || reasoning.rows.length ? {
            columns: ["Metric", "Value", "Rank", "Color signal"],
            rows: metricRows.concat(reasoning.rows.length ? [["", "", "", ""]] : []).concat(reasoning.rows.map((row) => [row[0], row[1], row[2], row[3]]))
        } : undefined,
        actions: [selectAction(entity, `Select ${entity.label} in report`)]
    };
}

export function answerAverageComparison(
    ctx: AssistantAnswerContext,
    entity: AssistantEntity,
    metric: AssistantMetric,
    operator: "above" | "below" | "compare"
): AssistantResponse {
    const entityValue = resolveMetricValue(ctx, metric, entity.indices || []);
    if (!validValue(entityValue)) {
        return { handled: true, text: `No ${metric.name} data available for ${entity.label}.` };
    }

    const allTenants = (ctx.entities || []).filter((e) => e.kind === "tenant" || e.kind === "unit");
    const allValues = allTenants
        .map((t) => resolveMetricValue(ctx, metric, t.indices || []))
        .filter((v) => validValue(v) && v > 0);

    if (allValues.length < 2) {
        return { handled: true, text: `Not enough tenant data to compute an average for ${metric.name}.` };
    }

    const avg = allValues.reduce((sum, v) => sum + v, 0) / allValues.length;
    const diff = entityValue - avg;
    const pctDiff = avg > 0 ? (diff / avg) * 100 : 0;
    const direction = diff > 0.001 ? "above" : diff < -0.001 ? "below" : "equal to";
    const formattedValue = formatAssistantMetric(ctx, metric, entityValue);
    const formattedAvg = formatAssistantMetric(ctx, metric, avg);
    const absPct = Math.abs(pctDiff);
    const pctText = absPct < 0.5 ? "at" : `${absPct.toFixed(1)}% ${direction}`;

    const rank = allValues.filter((v) => v > entityValue).length + 1;
    const rankText = `ranked ${rank} of ${allValues.length}`;

    return {
        handled: true,
        text: `${entity.label}'s ${metric.name} is ${formattedValue}, ${pctText} the average of ${formattedAvg} across ${allValues.length} tenants (${rankText}).`
    };
}

export function answerMetricThreshold(
    ctx: AssistantAnswerContext,
    parsed: ParsedAssistantQuestion,
    metric: AssistantMetric,
    entities: AssistantEntity[]
): AssistantResponse {
    const threshold = parsed.metricThreshold!;
    const scoped = scopeContext(entities);
    const pool = tenantEntitiesForScope(ctx, scoped.scopeIndices);
    const matched = pool.filter((entity) => {
        const value = resolveMetricValue(ctx, metric, entity.indices);
        if (!validValue(value)) return false;
        return threshold.operator === "above" ? value > threshold.value : value < threshold.value;
    }).sort((a, b) => {
        const va = resolveMetricValue(ctx, metric, a.indices);
        const vb = resolveMetricValue(ctx, metric, b.indices);
        return threshold.operator === "above" ? vb - va : va - vb;
    });
    if (!matched.length) {
        return { handled: true, text: `No tenants found with ${metric.name} ${threshold.operator} ${ctx.formatNumber(threshold.value)}${metric.formatHint === "percentage" ? "%" : ""}.` };
    }
    const tableRows = matched.map((entity) => {
        const value = resolveMetricValue(ctx, metric, entity.indices);
        return [
            entity.label,
            formatAssistantMetric(ctx, metric, value)
        ];
    });
    const allIndices = uniqNums(matched.reduce((out: number[], e) => out.concat(e.indices), []));
    return {
        handled: true,
        text: `Found ${matched.length} tenant${matched.length !== 1 ? "s" : ""} with ${metric.name} ${threshold.operator} ${ctx.formatNumber(threshold.value)}${metric.formatHint === "percentage" ? "%" : ""}:`,
        actions: matched.slice(0, 5).map((entity) => selectAction(entity, `Select ${entity.label}`)),
        autoSelectIndices: allIndices,
        table: { columns: ["Tenant", metric.name], rows: tableRows }
    };
}

function entityPoolForCrossMetric(ctx: AssistantAnswerContext, kind: NonNullable<ParsedAssistantQuestion["crossMetric"]>["dimensionType"], scopeIndices: number[] | null): AssistantEntity[] {
    const pool = (ctx.entities || []).filter((entity) => entity.kind === kind);
    return pool
        .map((entity) => scopeIndices ? { ...entity, indices: intersectNums(entity.indices || [], scopeIndices) } : entity)
        .filter((entity) => entity.indices.length > 0)
        .filter((entity) => kind !== "tenant" || !isPlaceholderTenantName(entity.label));
}

function percentileRank(value: number, values: number[]): number {
    const clean = values.filter(validValue).sort((a, b) => a - b);
    if (!validValue(value) || !clean.length) return NaN;
    if (clean.length === 1) return 1;
    const below = clean.filter((item) => item <= value).length - 1;
    return Math.max(0, Math.min(1, below / Math.max(1, clean.length - 1)));
}

export function answerCrossMetric(
    ctx: AssistantAnswerContext,
    parsed: ParsedAssistantQuestion,
    entities: AssistantEntity[],
    metrics: AssistantMetric[]
): AssistantResponse {
    const spec = parsed.crossMetric;
    if (!spec) return { handled: false, text: "I could not identify the metric comparison." };
    const firstMetric = metrics[0];
    const secondMetric = metrics[1];
    if (!firstMetric || !secondMetric) {
        return { handled: true, text: `I need both metrics for this comparison: ${spec.firstMetricPhrase} and ${spec.secondMetricPhrase}.` };
    }

    const scopeEntities = entities.filter(isRankScopeEntity);
    const scopeIndices = combineScopeIndices(scopeEntities);
    const pool = entityPoolForCrossMetric(ctx, spec.dimensionType, scopeIndices);
    const values = pool.map((entity) => ({
        entity,
        first: resolveMetricValue(ctx, firstMetric, entity.indices),
        second: resolveMetricValue(ctx, secondMetric, entity.indices)
    })).filter((item) => validValue(item.first) && validValue(item.second));
    const firstValues = values.map((item) => item.first);
    const secondValues = values.map((item) => item.second);
    const scored = values.map((item) => {
        const firstPct = percentileRank(item.first, firstValues);
        const secondPct = percentileRank(item.second, secondValues);
        const firstScore = spec.firstDirection === "high" ? firstPct : 1 - firstPct;
        const secondScore = spec.secondDirection === "high" ? secondPct : 1 - secondPct;
        return { ...item, score: firstScore + secondScore };
    }).sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(50, parsed.limit || 10)));

    if (!scored.length) {
        return { handled: true, text: `No ${spec.dimensionType} data found for ${firstMetric.name} and ${secondMetric.name}.` };
    }

    const scopeText = scopeTextForEntities(scopeEntities);
    const rows = scored.map((item, index) => [
        String(index + 1),
        item.entity.label,
        formatAssistantMetric(ctx, firstMetric, item.first),
        formatAssistantMetric(ctx, secondMetric, item.second)
    ]);
    return {
        handled: true,
        text: `${spec.firstDirection === "high" ? "High" : "Low"} ${firstMetric.name} and ${spec.secondDirection === "high" ? "high" : "low"} ${secondMetric.name} ${spec.dimensionType}s${scopeText ? ` in ${scopeText}` : ""}:${metricBusinessNotes([firstMetric, secondMetric])}`,
        actions: scored.slice(0, 5).map((item) => selectAction(item.entity, `Select ${item.entity.label}`)),
        table: {
            columns: ["Rank", dimensionLabel(spec.dimensionType), firstMetric.name, secondMetric.name],
            rows
        },
        chart: parsed.chartType ? {
            type: parsed.chartType,
            title: `${firstMetric.name} vs ${secondMetric.name}`,
            labels: scored.map((item) => item.entity.label),
            values: scored.map((item) => item.score),
            valueLabels: scored.map((item) => ctx.formatNumber(item.score, { maximumFractionDigits: 2 }))
        } : undefined
    };
}
