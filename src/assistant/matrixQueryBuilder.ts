export type MatrixValueMode = "raw" | "percentOfRow" | "percentOfColumn" | "percentOfTotal";

export interface MatrixFilter {
    type: "include" | "exclude" | "raw";
    phrase: string;
}

export interface MatrixQuery {
    rows: string[];
    columns: string[];
    values: string[];
    filters: MatrixFilter[];
    sort?: { by: "grandTotal" | string; direction: "asc" | "desc" };
    topN?: number;
    hideZeros?: boolean;
    valueMode?: MatrixValueMode;
    expandedRows?: { [key: string]: boolean };
}

export type MatrixQueryInput = Partial<Omit<MatrixQuery, "filters">> & {
    filters?: Array<MatrixFilter | string>;
};

function cleanText(value: unknown): string {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

function dedupeText(values: unknown[], limit: number): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    (values || []).forEach((value) => {
        const clean = cleanText(value);
        const key = clean.toLowerCase();
        if (!clean || seen.has(key)) return;
        seen.add(key);
        out.push(clean);
    });
    return out.slice(0, limit);
}

export function normalizeMatrixFilter(value: MatrixFilter | string): MatrixFilter | null {
    if (typeof value === "string") {
        const clean = cleanText(value);
        if (!clean) return null;
        const include = clean.match(/^include\s+(.+)$/i);
        if (include?.[1]) return { type: "include", phrase: cleanText(include[1]) };
        const exclude = clean.match(/^exclude\s+(.+)$/i);
        if (exclude?.[1]) return { type: "exclude", phrase: cleanText(exclude[1]) };
        return { type: "raw", phrase: clean };
    }
    const phrase = cleanText(value?.phrase);
    if (!phrase) return null;
    const type = value.type === "include" || value.type === "exclude" || value.type === "raw" ? value.type : "raw";
    return { type, phrase };
}

export function matrixFilterToText(filter: MatrixFilter | string): string {
    const normalized = normalizeMatrixFilter(filter);
    if (!normalized) return "";
    if (normalized.type === "include") return `include ${normalized.phrase}`;
    if (normalized.type === "exclude") return `exclude ${normalized.phrase}`;
    return normalized.phrase;
}

export function normalizeMatrixQuery(input?: MatrixQueryInput | null): MatrixQuery {
    const query = input || {};
    const filters = (query.filters || [])
        .map((filter) => normalizeMatrixFilter(filter))
        .filter((filter): filter is MatrixFilter => !!filter);
    const expandedRows = Object.keys(query.expandedRows || {}).reduce((out: { [key: string]: boolean }, key) => {
        const clean = cleanText(key);
        if (clean) out[clean] = !!query.expandedRows?.[key];
        return out;
    }, {});
    return {
        rows: dedupeText(query.rows || [], 5),
        columns: dedupeText(query.columns || [], 4),
        values: dedupeText(query.values || [], 6),
        filters,
        sort: query.sort?.by ? { by: query.sort.by, direction: query.sort.direction === "asc" ? "asc" : "desc" } : undefined,
        topN: Number.isFinite(Number(query.topN)) ? Math.max(1, Math.min(100, Number(query.topN))) : undefined,
        hideZeros: !!query.hideZeros,
        valueMode: query.valueMode === "percentOfRow" || query.valueMode === "percentOfColumn" || query.valueMode === "percentOfTotal" || query.valueMode === "raw"
            ? query.valueMode
            : undefined,
        expandedRows: Object.keys(expandedRows).length ? expandedRows : undefined
    };
}

export function cloneMatrixQuery(query: MatrixQueryInput): MatrixQuery {
    return normalizeMatrixQuery(query);
}

export function matrixQueryToQuestion(input: MatrixQueryInput): string {
    const query = normalizeMatrixQuery(input);
    const values = query.values.length ? query.values.join(" and ") : "Area";
    const rows = query.rows.join(", ");
    const columns = query.columns.join(", ");
    const filters = query.filters.map(matrixFilterToText).filter(Boolean).join(" ");
    const axis = columns
        ? `${columns} as columns and ${rows || "Assigned Sales Category"} as rows`
        : `${rows || "Assigned Sales Category"} as rows`;
    const options = [
        query.topN ? `top ${query.topN}` : "",
        query.sort ? `sort by ${query.sort.by === "grandTotal" ? "grand total" : query.sort.by} ${query.sort.direction}` : "",
        query.hideZeros ? "hide zeros" : "",
        query.valueMode && query.valueMode !== "raw" ? query.valueMode.replace(/^percentOf/, "percent of ").toLowerCase() : ""
    ].filter(Boolean).join(" ");
    return `show ${values} matrix of ${axis}${filters ? ` ${filters}` : ""}${options ? ` ${options}` : ""}`.replace(/\s+/g, " ").trim();
}

export function addMatrixField(input: MatrixQueryInput, axis: "rows" | "columns" | "values", field: string): MatrixQuery {
    const query = normalizeMatrixQuery(input);
    const clean = cleanText(field);
    if (!clean) return query;
    if (!query[axis].some((item) => item.toLowerCase() === clean.toLowerCase())) query[axis] = query[axis].concat([clean]);
    return query;
}

export function removeMatrixField(input: MatrixQueryInput, field: string, axis: "rows" | "columns" | "values" | "any"): MatrixQuery | null {
    const query = normalizeMatrixQuery(input);
    const clean = cleanText(field).toLowerCase();
    if (!clean) return null;
    const same = (value: string) => {
        const candidate = cleanText(value).toLowerCase();
        return candidate === clean || candidate.indexOf(clean) >= 0 || clean.indexOf(candidate) >= 0;
    };
    const removeFrom = (key: "rows" | "columns" | "values") => {
        const before = query[key].length;
        query[key] = query[key].filter((value) => !same(value));
        return before !== query[key].length;
    };
    const changed = axis === "any"
        ? (removeFrom("rows") || removeFrom("columns") || removeFrom("values"))
        : removeFrom(axis);
    return changed ? query : null;
}

export function swapMatrixAxes(input: MatrixQueryInput): MatrixQuery {
    const query = normalizeMatrixQuery(input);
    return { ...query, rows: query.columns.slice(), columns: query.rows.slice() };
}

export function addMatrixFilter(input: MatrixQueryInput, type: "include" | "exclude" | "raw", phrase: string): MatrixQuery {
    const query = normalizeMatrixQuery(input);
    const filter = normalizeMatrixFilter({ type, phrase });
    return filter ? { ...query, filters: query.filters.concat([filter]) } : query;
}

export function clearMatrixFilters(input: MatrixQueryInput): MatrixQuery {
    return { ...normalizeMatrixQuery(input), filters: [] };
}

export function withMatrixSort(input: MatrixQueryInput, direction: "asc" | "desc", by: "grandTotal" | string = "grandTotal", topN?: number): MatrixQuery {
    const query = normalizeMatrixQuery(input);
    return {
        ...query,
        sort: { by, direction },
        topN: Number.isFinite(Number(topN)) ? Math.max(1, Math.min(100, Number(topN))) : query.topN
    };
}
