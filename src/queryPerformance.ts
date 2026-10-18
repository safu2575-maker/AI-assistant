/** First matching row wins, matching the previous findIndex selection behavior. */
export function indexGroupRows(rows: string[][], groupCount: number): Map<string, number> {
    const indices = new Map<string, number>();
    rows.forEach((row, index) => {
        const key = JSON.stringify(row.slice(0, groupCount));
        if (!indices.has(key)) indices.set(key, index);
    });
    return indices;
}

/** Keep the existing suggestion order and cap without allocating full column copies. */
export function collectTextValues(existing: string[], rows: unknown[][], column: number, limit = 10000): string[] {
    const values = new Set<string>();
    for (const value of existing) { if (values.size >= limit) break; values.add(value); }
    for (const row of rows) {
        if (values.size >= limit) break;
        const value = row[column];
        if (typeof value === "string") values.add(value);
    }
    return [...values];
}
