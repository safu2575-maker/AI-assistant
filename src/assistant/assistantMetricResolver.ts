import { AssistantAnswerContext, AssistantMetric, SelectedAssistantToken } from "./assistantTypes";

export interface AssistantMetricResolverOptions {
    fallbackMatches?: (phrase: string, limit: number) => AssistantMetric[];
}

export interface AssistantMetricResolveOptions {
    limit?: number;
    allowAliases?: boolean;
    allowFallback?: boolean;
    preserveSelectedLabel?: boolean;
}

function clean(value: unknown): string {
    return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeMetricResolverText(value: unknown): string {
    return clean(value)
        .toLowerCase()
        .replace(/\b(area|rent|sales|ocr|units?|sqm|m2)of\b/g, "$1 of")
        .replace(/&/g, " and ")
        .replace(/\b(sales|revenue|turnover)\s*(?:per|\/)?\s*(sqm|sq\s*m|m2|area)\b/g, "$1/sqm")
        .replace(/\b(rent|rental|lease)\s*(?:per|\/)?\s*(sqm|sq\s*m|m2|area)\b/g, "$1/sqm")
        .replace(/[_-]+/g, " ")
        .replace(/[^a-z0-9/%]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function compact(value: unknown): string {
    return normalizeMetricResolverText(value).replace(/[^a-z0-9]+/g, "");
}

export function isDimensionMetric(metric: AssistantMetric): boolean {
    if (metric.key === "__builtin::units") return false;
    const name = normalizeMetricResolverText(metric.name || "");
    if (metric.formatHint === "text") return true;
    return /^(assigned\s+)?(tenant|tenant name|tenant names|brand|brands|shop|shops|store|stores|unit|unit id|unit name|sales category|category|categories|group|groups|zone|zones|floor|floors|layer|layers)$/.test(name)
        || /^assigned\s+(tenant|tenant name|tenant names|sales category|category|group|unit)$/.test(name);
}

function uniqueMetrics(metrics: AssistantMetric[]): AssistantMetric[] {
    const seen = new Set<string>();
    const out: AssistantMetric[] = [];
    metrics.forEach((metric) => {
        const key = String(metric?.key || "");
        if (!key || seen.has(key)) return;
        seen.add(key);
        out.push(metric);
    });
    return out;
}

function dateAllowedForPhrase(phrase: string): boolean {
    return /\b(?:date|expiry|expire|expiration|lease\s+end|earliest|latest|min|max|first|last)\b/i.test(phrase);
}

function aggregationLabels(label: string): string[] {
    const cleanLabel = normalizeMetricResolverText(label);
    return [
        cleanLabel,
        `sum of ${cleanLabel}`,
        `total of ${cleanLabel}`,
        `average of ${cleanLabel}`,
        `avg of ${cleanLabel}`,
        `min of ${cleanLabel}`,
        `minimum of ${cleanLabel}`,
        `max of ${cleanLabel}`,
        `maximum of ${cleanLabel}`,
        `earliest ${cleanLabel}`,
        `latest ${cleanLabel}`
    ].filter(Boolean);
}

export class AssistantMetricResolver {
    constructor(
        private readonly ctx: AssistantAnswerContext,
        private readonly options: AssistantMetricResolverOptions = {}
    ) {}

    resolveSelectedTokens(tokens: SelectedAssistantToken[], options: AssistantMetricResolveOptions = {}): AssistantMetric[] {
        const metrics = (tokens || [])
            .filter((token) => token.type === "metric")
            .map((token) => this.resolveSelectedToken(token, !!options.preserveSelectedLabel))
            .filter((metric): metric is AssistantMetric => !!metric && !isDimensionMetric(metric));
        return uniqueMetrics(metrics).slice(0, options.limit || 30);
    }

    resolvePhrases(phrases: string[], options: AssistantMetricResolveOptions = {}): AssistantMetric[] {
        const out: AssistantMetric[] = [];
        (phrases || []).forEach((phrase) => {
            this.resolveOnePhrase(phrase, options).forEach((metric) => {
                if (!out.some((item) => item.key === metric.key)) out.push(metric);
            });
        });
        return out.slice(0, options.limit || 30);
    }

    resolveQuestionMentions(question: string, options: AssistantMetricResolveOptions = {}): AssistantMetric[] {
        const normalizedQuestion = normalizeMetricResolverText(question);
        if (!normalizedQuestion) return [];
        const mentions: Array<{ metric: AssistantMetric; start: number; end: number; length: number; priority: number }> = [];
        this.availableMetrics().forEach((metric) => {
            const exactName = normalizeMetricResolverText(metric.name);
            const labels = [metric.name].concat(options.allowAliases === false ? [] : (metric.aliases || []))
                .map((label) => clean(label))
                .filter(Boolean)
                .filter((label, index, arr) => arr.findIndex((item) => normalizeMetricResolverText(item) === normalizeMetricResolverText(label)) === index)
                .sort((a, b) => b.length - a.length);
            labels.forEach((label) => {
                const normalizedLabel = normalizeMetricResolverText(label);
                if (!normalizedLabel || normalizedLabel.length < 3) return;
                if (metric.formatHint === "date" && !dateAllowedForPhrase(normalizedQuestion)) return;
                const index = ` ${normalizedQuestion} `.indexOf(` ${normalizedLabel} `);
                if (index < 0) return;
                const isDynamic = metric.kind === "dynamic";
                mentions.push({
                    metric,
                    start: index,
                    end: index + normalizedLabel.length,
                    length: normalizedLabel.length,
                    priority: normalizedLabel === exactName
                        ? (isDynamic ? 0 : 1)
                        : (isDynamic ? 2 : 3)
                });
            });
        });
        const kept: typeof mentions = [];
        mentions
            .sort((a, b) => a.start - b.start || a.priority - b.priority || b.length - a.length)
            .forEach((mention) => {
                if (kept.some((item) => mention.start < item.end && mention.end > item.start)) return;
                if (kept.some((item) => item.metric.key === mention.metric.key)) return;
                kept.push(mention);
            });
        return kept.map((mention) => mention.metric).slice(0, options.limit || 30);
    }

    metricExists(label: string): boolean {
        return !!this.resolveOnePhrase(label, { allowFallback: false, limit: 1 }).length;
    }

    private resolveSelectedToken(token: SelectedAssistantToken, preserveSelectedLabel: boolean): AssistantMetric | null {
        const label = clean(token.label);
        const selectedKey = clean(token.metricKey || token.id);
        const exactLabel = this.availableMetrics().find((metric) =>
            normalizeMetricResolverText(metric.name) === normalizeMetricResolverText(label)
        ) || null;
        const byKey = selectedKey
            ? this.availableMetrics().find((metric) => metric.key === selectedKey) || null
            : null;
        const byAlias = this.availableMetrics().find((metric) =>
            (metric.aliases || []).some((alias) => normalizeMetricResolverText(alias) === normalizeMetricResolverText(label))
        ) || null;
        const metric = exactLabel || byKey || byAlias;
        if (!metric) return null;
        if (!preserveSelectedLabel || !label || normalizeMetricResolverText(label) === normalizeMetricResolverText(metric.name)) return metric;
        return {
            ...metric,
            name: label,
            aliases: Array.from(new Set([metric.name].concat(metric.aliases || []))).filter(Boolean)
        };
    }

    private resolveOnePhrase(rawPhrase: string, options: AssistantMetricResolveOptions): AssistantMetric[] {
        const phrase = clean(rawPhrase)
            .replace(/\b(?:sum|total)\s+of\s+(?=(?:sum|total)\s+of\b)/gi, "")
            .replace(/\s+/g, " ")
            .trim();
        const normalized = normalizeMetricResolverText(phrase);
        if (!normalized) return [];
        const allowAliases = options.allowAliases !== false;
        const exactName = this.exactNameMatch(normalized);
        if (exactName) return [exactName];
        const aggregatedName = this.aggregatedNameMatch(normalized);
        if (aggregatedName) return [aggregatedName];
        const exactAlias = allowAliases ? this.exactAliasMatch(normalized) : null;
        if (exactAlias) return [exactAlias];
        if (options.allowFallback === false) return [];
        return (this.options.fallbackMatches ? this.options.fallbackMatches(phrase, 6) : [])
            .filter((metric) => metric && !isDimensionMetric(metric))
            .filter((metric) => metric.formatHint !== "date" || dateAllowedForPhrase(normalized))
            .slice(0, 1);
    }

    private exactNameMatch(normalizedPhrase: string): AssistantMetric | null {
        const compactPhrase = compact(normalizedPhrase);
        return this.availableMetrics().find((metric) => {
            const name = normalizeMetricResolverText(metric.name);
            if (metric.formatHint === "date" && !dateAllowedForPhrase(normalizedPhrase)) return false;
            return name === normalizedPhrase || compact(name) === compactPhrase;
        }) || null;
    }

    private aggregatedNameMatch(normalizedPhrase: string): AssistantMetric | null {
        const compactPhrase = compact(normalizedPhrase);
        return this.availableMetrics().find((metric) => {
            if (metric.formatHint === "date" && !dateAllowedForPhrase(normalizedPhrase)) return false;
            return aggregationLabels(metric.name).some((candidate) =>
                candidate === normalizedPhrase || compact(candidate) === compactPhrase
            );
        }) || null;
    }

    private exactAliasMatch(normalizedPhrase: string): AssistantMetric | null {
        const compactPhrase = compact(normalizedPhrase);
        return this.availableMetrics().find((metric) => {
            if (metric.formatHint === "date" && !dateAllowedForPhrase(normalizedPhrase)) return false;
            return (metric.aliases || []).some((alias) => {
                const normalizedAlias = normalizeMetricResolverText(alias);
                return normalizedAlias === normalizedPhrase
                    || compact(normalizedAlias) === compactPhrase
                    || aggregationLabels(alias).some((candidate) => candidate === normalizedPhrase || compact(candidate) === compactPhrase);
            });
        }) || null;
    }

    private availableMetrics(): AssistantMetric[] {
        return (this.ctx.metrics || []).filter((metric) => metric && !isDimensionMetric(metric));
    }
}
