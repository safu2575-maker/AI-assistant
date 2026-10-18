export interface TimeSetup {
    dateField?: string;
    yearField?: string;
    monthField?: string;
    monthIndexField?: string;
    monthIndexBase?: 0 | 1;
    numericOrder?: "auto" | "month-year" | "year-month";
    twoDigitYearStart?: number;
}

export const calendarMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function monthIndexLabel(value: string | number, base: 0 | 1 = 1): string {
    const index = Number(value) - base;
    if (!Number.isInteger(index) || index < 1900 * 12 || index >= 9999 * 12) return String(value);
    return `${calendarMonths[index % 12]} ${Math.floor(index / 12)}`;
}
const monthPattern = "January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sept|Sep|October|Oct|November|Nov|December|Dec";

/** Canonicalize periods only; preserve explicit filters, literal values and ISO dates. */
export function normalizeMonthPeriods(question: string, setup: TimeSetup = {}, literals: string[] = []): string {
    const protectedParts: string[] = [];
    const protect = (value: string) => { protectedParts.push(value); return `\uE000${String.fromCharCode(0xE100 + protectedParts.length - 1)}\uE001`; };
    let text = question.replace(/;\s*(?:answerFilters|modelScope):[\s\S]*$|\b(?:where|with)\s+[\s\S]*$/i, protect);
    text = text.replace(/"[^"]*"|'[^']*'|\([^)]*\)|\[[^\]]*\]|\b\d{4}-\d{2}-\d{2}\b/g, protect);
    for (const literal of [...new Set(literals)].filter(value => value && !/^\d+$/.test(value) && !new RegExp(`^(?:${monthPattern})$`, "i").test(value)).sort((a, b) => b.length - a.length)) {
        const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        text = text.replace(new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "gi"), protect);
    }
    const year = (value: string) => {
        const number = Number(value);
        const start = setup.twoDigitYearStart ?? 2000;
        const result = value.length === 2 ? start + ((number - start % 100 + 100) % 100) : number;
        if (result < 1900 || result > 9998) throw new Error("Choose a year between 1900 and 9998.");
        return result;
    };
    const named = (name: string, value: string) => `${calendarMonths.find(month => month.slice(0, 3).toLowerCase() === name.slice(0, 3).toLowerCase())} ${year(value)}`;
    text = text.replace(new RegExp(`\\b(${monthPattern})\\.?[\\s/-]+(\\d{4}|\\d{2})\\b`, "gi"), (_, month, value) => named(month, value));
    text = text.replace(new RegExp(`\\b(\\d{4}|\\d{2})[\\s/-]+(${monthPattern})\\.?\\b`, "gi"), (_, value, month) => named(month, value));
    text = text.replace(/(?<![\w/.-])(\d{4}|\d{1,2})\s*[-/]\s*(\d{4}|\d{1,2})(?![\w/.-])/g, (match, left: string, right: string) => {
        const a = Number(left), b = Number(right);
        let month: number, value: string;
        if (left.length === 4) { month = b; value = left; }
        else if (right.length === 4) { month = a; value = right; }
        else if ((a > 12 || a === 0) && b >= 1 && b <= 12) { month = b; value = left; }
        else if ((b > 12 || b === 0) && a >= 1 && a <= 12) { month = a; value = right; }
        else if (a >= 1 && a <= 12 && b >= 1 && b <= 12 && setup.numericOrder === "month-year") { month = a; value = right; }
        else if (a >= 1 && a <= 12 && b >= 1 && b <= 12 && setup.numericOrder === "year-month") { month = b; value = left; }
        else if (a >= 1 && a <= 12 && b >= 1 && b <= 12) throw new Error(`Ambiguous period ${match}. Use a month name and four-digit year, or set numeric month/year order in Time setup.`);
        else throw new Error(`Invalid month/year: ${match}. Use a month from 01 to 12 and a year.`);
        if (month < 1 || month > 12) throw new Error(`Invalid month in ${match}. Use 01 to 12.`);
        if (value.length !== 2 && value.length !== 4) throw new Error(`Use a two- or four-digit year in ${match}.`);
        return `${calendarMonths[month - 1]} ${year(value)}`;
    });
    return text.replace(/\uE000([\uE100-\uFFFF])\uE001/g, (_, key: string) => protectedParts[key.charCodeAt(0) - 0xE100]);
}

export function monthIndexValues(start: Date, end: Date, base: 0 | 1 = 1): number[] {
    const first = start.getUTCFullYear() * 12 + start.getUTCMonth();
    const last = end.getUTCFullYear() * 12 + end.getUTCMonth();
    if (start.getUTCDate() !== 1 || end.getUTCDate() !== 1 || last <= first || last - first > 1200) throw new Error("MonthIndex requires whole-month ranges of at most 100 years. Map a calendar date field for day-level ranges.");
    return Array.from({ length: last - first }, (_, index) => first + index + base);
}

/** Highlight original input using the same validation and ambiguity rules as parsing. */
export function recognizedTimeTerms(text: string, setup: TimeSetup = {}, literals: string[] = [], includeYearlyPeriods = false): Array<{start: number; end: number; kind: "value"}> {
    const terms: Array<{start: number; end: number; kind: "value"}> = [];
    const mask = (value: string) => " ".repeat(value.length);
    let searchable = text.replace(/;\s*(?:answerFilters|modelScope):[\s\S]*$|\b(?:where|with)\s+[\s\S]*$/i, mask)
        .replace(/"[^"]*"|'[^']*'|\([^)]*\)|\[[^\]]*\]|\b\d{4}-\d{2}-\d{2}\b/g, mask);
    for (const literal of literals.filter(value => value && !/^\d+$/.test(value) && !new RegExp(`^(?:${monthPattern})$`, "i").test(value))) {
        searchable = searchable.replace(new RegExp(`(?<![\\w])${literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "gi"), mask);
    }
    const pattern = new RegExp(`\\b(?:${monthPattern})\\.?[\\s/-]+(?:\\d{4}|\\d{2})\\b|\\b(?:\\d{4}|\\d{2})[\\s/-]+(?:${monthPattern})\\.?\\b|(?<![\\w/.-])(?:\\d{4}|\\d{1,2})\\s*[-/]\\s*(?:\\d{4}|\\d{1,2})(?![\\w/.-])`, "gi");
    for (const match of searchable.matchAll(pattern)) {
        try {
            const canonical = normalizeMonthPeriods(match[0], setup);
            if (new RegExp(`^(?:${calendarMonths.join("|")}) \\d{4}$`).test(canonical)) terms.push({start: match.index!, end: match.index! + match[0].length, kind: "value"});
        } catch { /* Incomplete, invalid or ambiguous periods are not recognized. */ }
    }
    if (includeYearlyPeriods && !terms.length && setup.monthIndexField && !/\d/.test(searchable.replace(/trailing 12 months/gi, "")) && /\b(?:ytd|ttm|year to date|trailing 12 months)\b/i.test(searchable)) {
        for (const match of searchable.matchAll(new RegExp(`\\b(?:${monthPattern})\\b`, "gi"))) terms.push({start:match.index!,end:match.index!+match[0].length,kind:"value"});
    }
    if (terms.length && setup.monthIndexField) for (const match of searchable.matchAll(/\b(?:ytd|ttm|year to date|trailing 12 months)\b/gi)) terms.push({start: match.index!, end: match.index! + match[0].length, kind: "value"});
    return terms;
}
