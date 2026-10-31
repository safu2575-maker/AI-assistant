export const MAX_CATEGORY_COLUMNS = 12;
export const COLUMN_LAYOUT_NOTICE = 'Category fields with more than 12 column values are shown in rows. Month and year columns are retained.';

export function isMonthOrYear(name: string, configured: string[] = []): boolean {
    return configured.includes(name) || /\b(?:months?|years?)\b/i.test(name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' '));
}

/** Count category combinations in the filtered result, not in the entire model. */
export function wideCategoryFields(names: string[], rows: unknown[][], configuredTimeFields: string[] = []): number[] {
    const categories = names.flatMap((name, i) => isMonthOrYear(name, configuredTimeFields) ? [] : [i]);
    if (!categories.length) return [];
    const values = new Set<string>();
    for (const row of rows) {
        values.add(JSON.stringify(categories.map(i => row[i] ?? null)));
        if (values.size > MAX_CATEGORY_COLUMNS) return categories;
    }
    return [];
}
