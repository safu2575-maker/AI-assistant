import { AssistantIntent, ParsedAssistantBreakdown, ParsedAssistantFilter, ParsedAssistantMatrix, ParsedAssistantQuestion, ParsedAssistantScope, ParsedTopBottomQuery } from "./assistantTypes";
import { normalizeMatrixQuery } from "./matrixQueryBuilder";

const STOP_WORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "between", "by", "can", "for", "from", "give", "has",
    "have", "having", "i", "in", "is", "me", "of", "on", "or", "please", "show", "tell", "than", "the", "to",
    "unit", "units", "what", "which", "with"
]);

const LOOKUP_WORDS = new Set(["what", "show", "tell", "get", "find", "value", "amount", "answer", "ask"]);
const COMPARE_WORDS = new Set(["compare", "versus", "vs", "against", "difference", "better"]);
const RANK_TOP_WORDS = new Set(["top", "highest", "largest", "biggest", "maximum", "max", "best", "most", "leading", "main"]);
const RANK_BOTTOM_WORDS = new Set(["bottom", "lowest", "smallest", "minimum", "min", "least", "worst", "weakest", "poorest"]);
const LIST_WORDS = new Set(["list", "vacant", "occupied"]);
const SUMMARY_WORDS = new Set(["summary", "summarize", "overview", "describe", "profile"]);
const FORMULA_WORDS = new Set(["formula", "calculation", "calculate", "calculated", "definition", "defined", "depends", "dependency", "dependencies", "uses", "used"]);
const TREND_WORDS = new Set(["trend", "history", "historical", "overtime", "progress", "trajectory", "evolution"]);
const EXPLAIN_WORDS = new Set(["why", "explain", "highlighted", "highlight", "meaning", "reason"]);
const FILTER_WORDS = new Set(["filter", "only", "just", "smaller", "larger", "bigger", "range", "between"]);
const CHART_WORDS = new Set(["chart", "graph", "visual", "visualize", "plot"]);
const CHART_TYPE_WORDS = new Set(["bar", "column", "line", "pie", "donut", "doughnut"]);
const METRIC_WORDS = new Set<string>([
    "area", "sqm", "m2", "size", "rent", "rental", "lease",
    "sales", "sale", "revenue", "turnover", "income", "earning", "earnings",
    "ocr", "occupancy", "vacancy", "vacant", "occupied",
    "units", "unit", "amount", "value", "gla", "sqft"
]);
const TOKEN_CORRECTIONS: Record<string, string> = {
    teh: "the",
    hte: "the",
    taht: "that",
    tht: "that",
    tis: "this",
    dis: "this",
    ahve: "have",
    hvae: "have",
    hve: "have",
    hav: "have",
    ahs: "has",
    hsa: "has",
    hs: "has",
    adn: "and",
    nad: "and",
    nd: "and",
    n: "and",
    ro: "or",
    wich: "which",
    whcih: "which",
    whch: "which",
    wht: "what",
    waht: "what",
    wat: "what",
    cn: "can",
    cna: "can",
    tye: "type",
    tipe: "type",
    typ: "type",
    ehile: "while",
    por: "",
    pls: "please",
    plz: "please",
    shw: "show",
    sho: "show",
    shwo: "show",
    tel: "tell",
    tlel: "tell",
    fnd: "find",
    fidn: "find",
    fni: "find",
    serch: "search",
    searh: "search",
    quetsion: "question",
    qustion: "question",
    langauge: "language",
    langue: "language",
    compar: "compare",
    compair: "compare",
    compaare: "compare",
    comapre: "compare",
    comapring: "comparing",
    diffrence: "difference",
    diference: "difference",
    betwen: "between",
    beetween: "between",
    higest: "highest",
    heighest: "highest",
    hihgest: "highest",
    highst: "highest",
    hieghest: "highest",
    largst: "largest",
    laregst: "largest",
    largets: "largest",
    largestt: "largest",
    bigest: "largest",
    biggist: "biggest",
    maxium: "maximum",
    botom: "bottom",
    lowst: "lowest",
    smalest: "smallest",
    minimun: "minimum",
    minimium: "minimum",
    vacent: "vacant",
    vaccant: "vacant",
    empy: "empty",
    avilable: "available",
    ocupied: "occupied",
    occuped: "occupied",
    sumarize: "summarize",
    summerize: "summarize",
    summery: "summary",
    overveiw: "overview",
    profle: "profile",
    fomula: "formula",
    formla: "formula",
    calulation: "calculation",
    calculaton: "calculation",
    calclated: "calculated",
    definiton: "definition",
    defintion: "definition",
    dependecy: "dependency",
    dependncy: "dependency",
    grahp: "graph",
    grap: "graph",
    visul: "visual",
    visulaize: "visualize",
    barchrt: "bar chart",
    matrx: "matrix",
    matix: "matrix",
    matirx: "matrix",
    pivit: "pivot",
    pivt: "pivot",
    colum: "column",
    colums: "columns",
    cloum: "column",
    cloumn: "column",
    cloumns: "columns",
    colunm: "column",
    colunms: "columns",
    colomn: "column",
    colomns: "columns",
    cols: "columns",
    col: "column",
    roow: "row",
    roows: "rows",
    raws: "rows",
    roww: "row",
    doughnut: "donut",
    dounut: "donut",
    areachrt: "area chart",
    aera: "area",
    arrea: "area",
    arae: "area",
    salse: "sales",
    sale: "sales",
    seles: "sales",
    saless: "sales",
    revenus: "revenue",
    revnue: "revenue",
    revenu: "revenue",
    turnoverr: "turnover",
    turnovr: "turnover",
    rennt: "rent",
    rnet: "rent",
    rents: "rent",
    rental: "rent",
    leese: "lease",
    leas: "lease",
    ocrr: "ocr",
    occr: "ocr",
    orc: "ocr",
    ocupancy: "occupancy",
    occpancy: "occupancy",
    occupncy: "occupancy",
    occupany: "occupancy",
    catogery: "category",
    catogory: "category",
    catagory: "category",
    categroy: "category",
    categery: "category",
    catgry: "category",
    catgory: "category",
    cat: "category",
    categry: "category",
    categ: "category",
    departmnet: "department",
    departmnets: "departments",
    deparment: "department",
    deparments: "departments",
    departmnt: "department",
    departmet: "department",
    gruop: "group",
    groupe: "group",
    grouo: "group",
    grooup: "group",
    grop: "group",
    zoon: "zone",
    zome: "zone",
    zne: "zone",
    flor: "floor",
    florr: "floor",
    flooor: "floor",
    levle: "level",
    unt: "unit",
    unti: "unit",
    untis: "units",
    tenent: "tenant",
    tanent: "tenant",
    tennant: "tenant",
    tennants: "tenants",
    tenannt: "tenant",
    tenannts: "tenants",
    tennat: "tenant",
    tenats: "tenants",
    tenat: "tenant",
    teantsnt: "tenant",
    teantsnts: "tenants",
    teanant: "tenant",
    teanants: "tenants",
    assinged: "assigned",
    assigend: "assigned",
    assgined: "assigned",
    assined: "assigned",
    shope: "shop",
    shp: "shop",
    shopp: "shop",
    stroe: "store",
    stor: "store",
    brnad: "brand",
    bardn: "brand",
    brnd: "brand",
    footware: "footwear",
    footweat: "footwear",
    fpptweeat: "footwear",
    previus: "previous",
    previos: "previous",
    priveous: "previous",
    detcteion: "detection",
    grammer: "grammar",
    spelkig: "spelling",
    speling: "spelling",
    impreve: "improve",
    evn: "even"
};
const CONTROL_WORDS = new Set<string>([
    ...Array.from(LOOKUP_WORDS),
    ...Array.from(COMPARE_WORDS),
    ...Array.from(RANK_TOP_WORDS),
    ...Array.from(RANK_BOTTOM_WORDS),
    ...Array.from(LIST_WORDS),
    ...Array.from(SUMMARY_WORDS),
    ...Array.from(FORMULA_WORDS),
    ...Array.from(CHART_WORDS),
    ...Array.from(CHART_TYPE_WORDS),
    ...Array.from(METRIC_WORDS),
    ...Array.from(TREND_WORDS),
    ...Array.from(EXPLAIN_WORDS),
    ...Array.from(FILTER_WORDS),
    "above", "name", "names", "same", "those", "these", "previous", "last", "both", "all", "total", "actual"
]);
const FUZZY_CONTROL_WORDS = new Set<string>([
    ...Array.from(STOP_WORDS),
    ...Array.from(CONTROL_WORDS),
    "empty", "available", "search", "select", "zoom", "focus", "level", "sales", "revenue", "turnover",
    "rent", "lease", "ocr", "occupancy", "category", "group", "zone", "floor", "tenant", "area"
]);

export function normalizeAssistantText(value: string): string {
    return String(value || "")
        .toLowerCase()
        .replace(/\bbar\s*chart\b/g, "bar chart")
        .replace(/\bbarchart\b/g, "bar chart")
        .replace(/\bcolumnchart\b/g, "column chart")
        .replace(/\blinechart\b/g, "line chart")
        .replace(/\bpiechart\b/g, "pie chart")
        .replace(/\bdonutchart\b|\bdoughnutchart\b/g, "donut chart")
        .replace(/\bareachart\b/g, "area chart")
        .replace(/[\/\\]+/g, " ")
        .replace(/\s+-\s+/g, " ")
        .replace(/[?!.:,;()[\]{}]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeCorrectedAssistantText(value: string): string {
    const normalized = normalizeAssistantText(value);
    if (!normalized) return "";
    const corrected = normalized
        .split(/\s+/g)
        .map((token) => correctAssistantToken(token))
        .reduce((out: string[], token) => out.concat(normalizeAssistantText(token).split(/\s+/g).filter(Boolean)), [])
        .join(" ");
    return corrected
        .replace(/\b(?:a|an)\s+(area|sqm|m2|rent|sales|revenue|ocr|occupancy|tenant|unit|category|group|zone|floor)\b/g, "$1")
        .replace(/\b(?:which|what|who)\s+(?:tenant|tenants|brand|brands|shop|shops|store|stores)\s+(?:has|have|having)\s+(highest|largest|biggest|maximum|max|best|most|lowest|smallest|minimum|min|worst|least)\b/g, "$1 tenant")
        .replace(/\b(?:tenant|tenants|brand|brands|shop|shops|store|stores)\s+(?:has|have|having)\s+(highest|largest|biggest|maximum|max|best|most|lowest|smallest|minimum|min|worst|least)\b/g, "$1 tenant")
        .replace(/\b(?:who|which|what)\s+(?:has|have|having)\s+(highest|largest|biggest|maximum|max|best|most|lowest|smallest|minimum|min|worst|least)\s+(area|sqm|m2|rent|sales|revenue|ocr|occupancy|units?)\b/g, "$1 tenant by $2")
        .replace(/\bshops?\b|\bstores?\b|\bbrands?\b|\bretailers?\b/g, "tenant")
        .replace(/\bdepartment\s+tenants?\b/g, "department store")
        .replace(/\bclassifications?\b|\bsegments?\b|\btypes?\b|\bdivisions?\b/g, "category")
        .replace(/\binside\b|\bwithin\b|\bbelonging\s+to\b|\bpart\s+of\b|\bfrom\b/g, "in")
        .replace(/\bbased\s+on\b/g, "by")
        .replace(/\busing\b/g, "by")
        .replace(/\bwith\b/g, "by")
        .replace(/\bperformance\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function editDistance(a: string, b: string, maxDistance: number): number {
    if (a === b) return 0;
    if (!a || !b) return Math.max(a.length, b.length);
    if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
    let prev = new Array(b.length + 1);
    let cur = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
        cur[0] = i;
        let rowMin = cur[0];
        for (let j = 1; j <= b.length; j++) {
            const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
            const val = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            cur[j] = val;
            if (val < rowMin) rowMin = val;
        }
        if (rowMin > maxDistance) return maxDistance + 1;
        const swap = prev;
        prev = cur;
        cur = swap;
    }
    return prev[b.length];
}

function correctAssistantToken(token: string): string {
    const normalized = normalizeAssistantText(token);
    if (!normalized) return "";
    if (Object.prototype.hasOwnProperty.call(TOKEN_CORRECTIONS, normalized)) return TOKEN_CORRECTIONS[normalized];
    if (normalized.length < 4) return normalized;
    const maxDistance = normalized.length >= 8 ? 2 : 1;
    let best = "";
    let bestDistance = maxDistance + 1;
    FUZZY_CONTROL_WORDS.forEach((word) => {
        if (Math.abs(word.length - normalized.length) > maxDistance) return;
        const distance = editDistance(normalized, word, maxDistance);
        if (distance < bestDistance || (distance === bestDistance && word.length > best.length)) {
            best = word;
            bestDistance = distance;
        }
    });
    return best && bestDistance <= maxDistance ? best : normalized;
}

function detectIntent(tokens: string[], normalized: string = ""): AssistantIntent {
    if (!tokens.length) return "help";
    if (/\b(matrix|pivot|cross\s*tab|crosstab)\b/i.test(normalized)
        || (/\brows?\b/i.test(normalized) && /\bcolumns?\b/i.test(normalized))
        || /\bas\s+columns?\b/i.test(normalized)) return "matrix";
    // Explain: "why is X highlighted red", "explain why Centrepoint is red"
    if (/^\s*why\b/i.test(normalized) || /\b(explain\s+why|why\s+is|why\s+does|what\s+does.*mean|why.*highlight|explain.*highlight)\b/i.test(normalized)) return "explain";
    if (tokens.some((t) => EXPLAIN_WORDS.has(t)) && /\b(red|green|amber|orange|yellow|color|colour|heatmap|highlighted?)\b/i.test(normalized)) return "explain";
    // Trend: "how has rent changed over time", "rent trend", "yoy sales", "historical sales"
    if (/\b(how\s+(has|have|did)\b.+\b(change|grow|decline|perform|trend))\b/i.test(normalized)) return "trend";
    if (/\bwhat\s+changed\s+(?:from|since|over)\b/i.test(normalized)) return "trend";
    if (/\b(yoy|ytd|over\s+time|time\s+series|historical|trend|growth\s+rate|year\s+on\s+year|year\s+over\s+year)\b/i.test(normalized)) return "trend";
    if (tokens.some((t) => TREND_WORDS.has(t))) return "trend";
    if (/\b(top|bottom|highest|lowest|best|worst|largest|smallest|maximum|minimum|max|min)\b.+\b(?:tenants?|units?|categories|groups?|zones?|floors?|layers?)\b.+\bby\s+(area|sqm|m2|size|rent|rental|lease|sales|revenue|turnover|ocr|occupancy|units|sum\s+of\s+area)\b/i.test(normalized)) return "rank";
    if (/\b(show\s+me\s+)?(weak|poor|underperforming|bad\s+performing)\s+(tenants?|shops?|stores?|brands?)\b/i.test(normalized)) return "compare";
    if (/\b(expensive|costly|high\s+rent).+\b(low|lower|poor|weak)\s+(sales|revenue|turnover)\b/i.test(normalized)) return "compare";
    if (/\b(high|low)\s+\w+.*\b(high|low)\s+\w+/i.test(normalized)) return "compare";
    // Filter: explicit area/floor filter condition without compare/rank intent
    if (/\b(under|below|less\s+than|more\s+than|above|over|at\s+least|at\s+most|between)\s+[\d,]+\s*(sqm|sq\s*m|m2)?\b/i.test(normalized)) return "filter";
    if (/\bfilter\s+(tenants?|units?|shops?|stores?|brands?)\b/i.test(normalized)) return "filter";
    // Existing intents
    if (/\b(compare|comparison)\b.+\b(and|with|vs|versus|against)\b/i.test(normalized)) return "compare";
    if (/\b[\w&'.-]+\s+(vs|versus)\s+[\w&'.-]+\b/i.test(normalized)) return "compare";
    if (/\btop\s+\d+\b|\bbottom\s+\d+\b|\bby\s+(area|sqm|m2|size|rent|rental|lease|sales|revenue|turnover|ocr|occupancy|units)\b/i.test(normalized)
        && tokens.some((t) => RANK_TOP_WORDS.has(t) || RANK_BOTTOM_WORDS.has(t) || t === "top" || t === "bottom")) return "rank";
    if (/\b(show|display|get|give)\b.+\b(?:by|of)\s+(?:assigned\s+)?(?:tenant\s+name|tenant|unit|category|sales\s+category|group|zone|floor|layer|brand|segment|class|type)s?\b/i.test(normalized)) return "rank";
    if (/\b(show|list|which|what)\b.+\btenants?\b.+\b(in|on|within|under)\b/i.test(normalized)) return "list";
    if (/\b(who|brands?|shops?|stores?|retailers?)\b.+\b(in|inside|within|under|from)\b/i.test(normalized)) return "list";
    if (/\b(area|sqm|m2|size|rent|rental|lease|sales|revenue|turnover|ocr|occupancy|units?)\s+(of|for)\s+.+/i.test(normalized)) return "lookup";
    if (tokens.some((t) => COMPARE_WORDS.has(t))) return "compare";
    if (tokens.some((t) => RANK_TOP_WORDS.has(t) || RANK_BOTTOM_WORDS.has(t))) return "rank";
    if (tokens.some((t) => FORMULA_WORDS.has(t))) return "formula";
    if (tokens.some((t) => SUMMARY_WORDS.has(t))) return "summary";
    if (detectChartType(tokens)) return "lookup";
    if (tokens.some((t) => LIST_WORDS.has(t))) return "list";
    if (tokens.some((t) => t === "tenant" || t === "tenants" || t === "restaurant" || t === "restaurants")) return "list";
    if (tokens.some((t) => LOOKUP_WORDS.has(t))) return "lookup";
    return "lookup";
}

const WORD_NUMBERS: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
    twenty: 20, thirty: 30, forty: 40, fifty: 50
};

function detectLimit(tokens: string[]): number | undefined {
    for (const t of tokens) {
        const n = Number(t);
        if (Number.isFinite(n) && n > 0 && n <= 50) return Math.floor(n);
        const word = WORD_NUMBERS[t];
        if (word) return word;
    }
    return undefined;
}

function detectDirection(tokens: string[]): "top" | "bottom" | undefined {
    if (tokens.some((t) => RANK_BOTTOM_WORDS.has(t))) return "bottom";
    if (tokens.some((t) => RANK_TOP_WORDS.has(t))) return "top";
    return undefined;
}

function detectChartType(tokens: string[]): "bar" | "column" | "donut" | "line" | "area" | undefined {
    const set = new Set(tokens);
    if (set.has("line")) return "line";
    for (let i = 0; i < tokens.length - 1; i++) {
        if (tokens[i] === "area" && CHART_WORDS.has(tokens[i + 1])) return "area";
    }
    if (set.has("column")) return "column";
    if (set.has("pie")) return "donut";
    if (set.has("donut") || set.has("doughnut")) return "donut";
    if (set.has("bar") || tokens.some((token) => CHART_WORDS.has(token))) return "bar";
    return undefined;
}

function candidatePhrases(tokens: string[]): string[] {
    const phrases = new Set<string>();
    const useful = tokens.filter((token, index) => {
        if (!token || STOP_WORDS.has(token) || CONTROL_WORDS.has(token)) return false;
        if (token === "area" && CHART_WORDS.has(tokens[index + 1])) return false;
        return true;
    });
    useful.forEach((token) => phrases.add(token));
    for (let size = 2; size <= 3; size++) {
        for (let i = 0; i <= useful.length - size; i++) {
            phrases.add(useful.slice(i, i + size).join(" "));
        }
    }
    const sorted = Array.from(phrases)
        .filter((phrase) => !isBenchmarkFollowupPhrase(phrase))
        .sort((a, b) => b.length - a.length);
    return sorted.slice(0, 15);
}

function stripDebug(value: string): { text: string; debug: boolean } {
    const src = String(value || "").trim();
    const debug = /^\s*(debug|explain match|why match)\b/i.test(src);
    return {
        debug,
        text: debug ? src.replace(/^\s*(debug|explain match|why match)\b[:\s]*/i, "").trim() : src
    };
}

function cleanSlotText(value: string): string {
    return normalizeAssistantText(value)
        .replace(/\b(in|as)\s+(bar|column|line|pie|donut|doughnut|area)\s+(chart|graph|visual)\b/g, " ")
        .replace(/\b(bar|column|line|pie|donut|doughnut|area)\s+(chart|graph|visual)\b/g, " ")
        .replace(/\b(table|tabular|grid|rows|row)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeScopeKind(value: string): ParsedAssistantScope["kind"] | undefined {
    const clean = normalizeAssistantText(value);
    if (/^groups?$/.test(clean)) return "group";
    if (/^categor(?:y|ies)$/.test(clean)) return "category";
    if (/^zones?$/.test(clean)) return "zone";
    if (/^floors?$|^levels?$/.test(clean)) return "floor";
    if (/^layers?$/.test(clean)) return "layer";
    return undefined;
}

function cleanScopePhrase(value: string): string {
    const clean = cleanSlotText(value)
        .replace(/\b(?:excluding|exclude|except|without|not including|remove|including|include|only|just|limited to|filtered by)\b.+$/i, " ")
        .replace(/\b(?:group|groups|category|categories|zone|zones|floor|floors|level|levels|layer|layers)\b$/i, " ")
        .replace(/\b(?:tenants?|tenant|brands?|shops?|stores?|retailers?)\b/g, " ")
        .replace(/\b(?:by|with)\s+.+$/i, " ")
        .replace(/\s+/g, " ")
        .trim();
    return isBenchmarkFollowupPhrase(clean) ? "" : clean;
}

function isBenchmarkFollowupPhrase(value: string): boolean {
    const clean = normalizeAssistantText(value);
    if (!clean) return false;
    return /^(?:for\s+)?(?:yes\s+show\s+)?(?:benchmark|benchmarks|percentile|percentiles|statistics|statistic|statics|tenant concentration|concentration)(?:\s+(?:benchmark|benchmarks|percentile|percentiles|statistics|statistic|statics|tenant concentration|concentration|tenants?))*$/.test(clean)
        || /^(?:show\s+)?(?:90|75|50|25)(?:th)?\s+percentile(?:\s+tenants?)?$/.test(clean);
}

function splitScopeChain(value: string): string[] {
    const clean = cleanScopePhrase(value);
    if (!clean) return [];
    return clean
        .split(/\s+\b(?:in|inside|within|under|from)\b\s+/i)
        .map(cleanScopePhrase)
        .filter((part) => part && part.length >= 2);
}

function detectExplicitScopes(normalized: string): ParsedAssistantScope[] {
    const out: ParsedAssistantScope[] = [];
    const isChartScopePhrase = (value: string): boolean =>
        /^(?:a\s+|an\s+)?(?:(?:bar|column|line|pie|donut|doughnut|area|table)\s*)?(?:chart|graph|visual|view|table|grid|tabular)$/i.test(cleanSlotText(value));
    const push = (phrase: string, kindText?: string) => {
        const kind = normalizeScopeKind(kindText || "");
        const parts = kind ? [cleanScopePhrase(phrase)] : splitScopeChain(phrase);
        parts.forEach((clean) => {
            if (!clean || clean.length < 2) return;
            if (isChartScopePhrase(clean)) return;
            if (/^(tenant|tenants|unit|units|all|each|every|top|bottom)$/.test(clean)) return;
            const key = `${kind || ""}:${clean}`;
            if (out.some((scope) => `${scope.kind || ""}:${scope.phrase}` === key)) return;
            out.push(kind ? { kind, phrase: clean } : { phrase: clean });
        });
    };

    const scopedSubject = /\b(?:tenants?|brands?|shops?|stores?|retailers?|units?)\b.+?\b(?:in|inside|within|under|from|for)\s+(.+?)(?:\s+\b(group|groups|category|categories)\b)?(?:\s+\b(?:by|with|as)\b|$)/gi;
    let match: RegExpExecArray | null;
    while ((match = scopedSubject.exec(normalized))) {
        push(match[1] || "", match[2] || "");
    }

    const explicitKind = /\b(?:in|inside|within|under|from|for)\s+(.+?)\s+\b(group|groups|category|categories|zone|zones|floor|floors|level|levels|layer|layers)\b(?:\s+\b(?:by|with|as|on|in)\b|$)/gi;
    while ((match = explicitKind.exec(normalized))) {
        push(match[1] || "", match[2] || "");
    }

    const genericScope = /\b(?:in|inside|within|under|from|for)\s+(.+?)(?:\s+\b(?:by|with|as|on|at)\b|$)/gi;
    while ((match = genericScope.exec(normalized))) {
        const phrase = cleanScopePhrase(match[1] || "");
        if (phrase && !isChartScopePhrase(phrase)) push(phrase, "");
    }

    const prefixedKind = /\b(?:in|on|at|inside|within|under|from|for)\s+\b(zone|zones|floor|floors|level|levels|layer|layers)\s+(.+?)(?:\s+\b(?:by|with|as|on|in)\b|$)/gi;
    while ((match = prefixedKind.exec(normalized))) {
        push(match[2] || "", match[1] || "");
    }

    const floorPhrase = normalized.match(/\b(?:in|on|at)\s+(ground|first|1st|second|2nd|third|3rd|floor\s*[123]|level\s*[123])\s+floor\b/i)
        || normalized.match(/\b(ground|first|1st|second|2nd|third|3rd)\s+floor\b/i);
    if (floorPhrase?.[1]) push(floorPhrase[1], "floor");

    if (/\b(selected|selection|current\s+selection|selected\s+units?|selected\s+tenants?)\b/i.test(normalized)) {
        push("selected units", "context");
    }
    if (/\b(visible\s+map|visible\s+view|current\s+view|current\s+map|filtered\s+view)\b/i.test(normalized)) {
        push("current view", "context");
    }

    return out;
}

function normalizeBreakdownDimension(value: string): ParsedAssistantBreakdown["dimensions"][number] | null {
    const clean = normalizeAssistantText(value);
    if (/^(tenant|tenants|brand|brands|shop|shops|store|stores|retailer|retailers)$/.test(clean)) return "tenant";
    if (/^(unit|units|unitid|unit id)$/.test(clean)) return "unit";
    if (/^(category|categories|cat|assigned sales category|sales category)$/.test(clean)) return "category";
    if (/^(group|groups|assigned group)$/.test(clean)) return "group";
    if (/^(zone|zones)$/.test(clean)) return "zone";
    if (/^(floor|floors|level|levels)$/.test(clean)) return "floor";
    if (/^(layer|layers)$/.test(clean)) return "layer";
    return null;
}

function detectBreakdown(normalized: string): ParsedAssistantBreakdown | undefined {
    const byMatches = Array.from(normalized.matchAll(/\bby\s+(.+?)(?=\s+\b(?:in|inside|within|under|from|on|at|with|as)\b|$)/gi));
    const dimensions: ParsedAssistantBreakdown["dimensions"] = [];
    byMatches.forEach((match) => {
        const phrase = cleanSlotText(match[1] || "")
            .replace(/\b(?:table|chart|graph|visual)\b/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        phrase.split(/\s+(?:and|then|by)\s+|,/g)
            .map(cleanSlotText)
            .forEach((part) => {
                const dim = normalizeBreakdownDimension(part);
                if (dim && dimensions.indexOf(dim) < 0) dimensions.push(dim);
            });
    });
    const eachMatches = Array.from(normalized.matchAll(/\b(?:in|for|within)\s+each\s+(tenant|tenants|unit|units|category|categories|group|groups|zone|zones|floor|floors|layer|layers)\b/gi));
    eachMatches.forEach((match) => {
        const dim = normalizeBreakdownDimension(match[1] || "");
        if (dim && dimensions.indexOf(dim) < 0) dimensions.push(dim);
    });
    return dimensions.length ? { dimensions } : undefined;
}

function detectFilters(normalized: string): ParsedAssistantQuestion["filters"] | undefined {
    const out: NonNullable<ParsedAssistantQuestion["filters"]> = {};
    const areaBetween = normalized.match(/\bbetween\s+([0-9][0-9,]*(?:\.[0-9]+)?)\s+and\s+([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:sqm|sq\s*m|m2|area)?\b/i);
    if (areaBetween?.[1] && areaBetween?.[2]) {
        out.areaMin = Number(areaBetween[1].replace(/,/g, ""));
        out.areaMax = Number(areaBetween[2].replace(/,/g, ""));
    }
    // Require explicit area unit or area context word to avoid confusing "OCR above 10%" as an area filter
    const hasAreaContext = /\b(?:area|sqm|sq\s*m|m2|sqft|size)\b/i.test(normalized);
    const areaMin = hasAreaContext ? normalized.match(/\b(?:over|above|more than|greater than|at least)\s+([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:sqm|sq\s*m|m2|sqft|area)?\b/i) : null;
    const areaMax = hasAreaContext ? normalized.match(/\b(?:under|below|less than|at most)\s+([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:sqm|sq\s*m|m2|sqft|area)?\b/i) : null;
    if (areaMin?.[1] && out.areaMin === undefined) out.areaMin = Number(areaMin[1].replace(/,/g, ""));
    if (areaMax?.[1] && out.areaMax === undefined) out.areaMax = Number(areaMax[1].replace(/,/g, ""));
    const floorMatch = normalized.match(/\b(?:in|on|at)\s+(ground|first|1st|second|2nd|third|3rd|floor\s*[123]|level\s*[123])\s+floor\b/i)
        || normalized.match(/\b(ground|first|1st|second|2nd|third|3rd)\s+floor\b/i);
    if (floorMatch?.[1]) out.floorPhrase = floorMatch[1];
    const nearMatch = normalized.match(/\bnear\s+(.+?)(?:\s+(?:over|above|under|below|by|in|on)\b|$)/i);
    if (nearMatch?.[1]) out.nearPhrase = cleanSlotText(nearMatch[1]);
    const includeFilters = detectIncludeExcludeFilters(normalized, "include");
    const excludeFilters = detectIncludeExcludeFilters(normalized, "exclude");
    if (includeFilters.length) out.includeFilters = includeFilters;
    if (excludeFilters.length) out.excludeFilters = excludeFilters;
    return out.areaMin !== undefined || out.areaMax !== undefined || out.floorPhrase || out.nearPhrase || includeFilters.length || excludeFilters.length ? out : undefined;
}

function normalizeFilterType(phrase: string): ParsedAssistantFilter["type"] | undefined {
    const clean = normalizeAssistantText(phrase);
    if (/\b(tenant|tenants|brand|brands|shop|shops|store|stores)\b/.test(clean)) return "tenant";
    if (/\b(unit|units)\b/.test(clean)) return "unit";
    if (/\b(sales category|category|categories)\b/.test(clean)) return "category";
    if (/\b(group|groups)\b/.test(clean)) return "group";
    if (/\b(zone|zones)\b/.test(clean)) return "zone";
    if (/\b(floor|floors|level|levels)\b/.test(clean)) return "floor";
    if (/\b(layer|layers)\b/.test(clean)) return "layer";
    if (/\b(bookmark|bookmarks|saved view|saved views)\b/.test(clean)) return "bookmark";
    return undefined;
}

function parseMetricConditionFilter(phrase: string): ParsedAssistantFilter | null {
    const clean = cleanSlotText(phrase);
    const match = clean.match(/\b(.+?)\s+(above|over|greater than|more than|at least|>=|below|under|less than|lower than|at most|<=|equal to|equals?|=)\s+([0-9][0-9,]*(?:\.[0-9]+)?)(?:\s*(%|percent|k|m|million|b|billion))?\b/i);
    if (!match?.[1] || !match?.[2] || !match?.[3]) return null;
    const opText = String(match[2] || "").toLowerCase();
    const operator: ParsedAssistantFilter["metricCondition"] extends infer T
        ? T extends { operator: infer O } ? O : never
        : never = /^(above|over|greater|more|at least|>=)/i.test(opText)
        ? (opText.indexOf("least") >= 0 || opText === ">=" ? ">=" : ">")
        : /^(below|under|less|lower|at most|<=)/i.test(opText)
        ? (opText.indexOf("most") >= 0 || opText === "<=" ? "<=" : "<")
        : "=";
    const value = parseAssistantNumber(match[3], match[4] || "");
    if (!Number.isFinite(value)) return null;
    return {
        phrase: clean,
        type: "metricCondition",
        metricCondition: {
            metricPhrase: cleanSlotText(match[1]),
            operator,
            value
        }
    };
}

function splitFilterValues(value: string): string[] {
    return cleanSlotText(value)
        .replace(/\b(?:category|categories|group|groups|tenant|tenants|unit|units|zone|zones|floor|floors|layer|layers|bookmark|bookmarks)\b$/i, " ")
        .split(/\s*,\s*|\s+\band\s+|\s+\bor\s+/i)
        .map(cleanSlotText)
        .filter((part) => part && part.length >= 2 && !/^(a|an|the|all|each|every)$/.test(part));
}

function detectIncludeExcludeFilters(normalized: string, mode: "include" | "exclude"): ParsedAssistantFilter[] {
    const out: ParsedAssistantFilter[] = [];
    const seen = new Set<string>();
    const connector = mode === "exclude"
        ? "(?:excluding|exclude|except|without|not including|remove)"
        : "(?:including|include|only|just|within|limited to|filtered by)";
    const stop = mode === "exclude"
        ? "(?:including|include|only|just|within|limited to|filtered by|by|as|in|on|at|for)"
        : "(?:excluding|exclude|except|without|not including|remove|by|as|in|on|at|for)";
    const re = new RegExp(`\\b${connector}\\s+(.+?)(?=\\s+\\b${stop}\\b|$)`, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(normalized))) {
        const body = cleanSlotText(match[1] || "");
        if (!body) continue;
        const metricCondition = parseMetricConditionFilter(body);
        const values = metricCondition ? [metricCondition] : splitFilterValues(body).map((phrase) => ({
            phrase,
            type: normalizeFilterType(phrase)
        }));
        values.forEach((filter) => {
            const key = `${filter.type || ""}:${filter.phrase}`;
            if (!filter.phrase || seen.has(key)) return;
            seen.add(key);
            out.push(filter);
        });
    }
    return out;
}

function splitCompareSubjects(normalized: string): string[] {
    const body = cleanSlotText(normalized
        .replace(/\b(compare|comparison|versus|vs|against|difference|better)\b/g, " ")
        .replace(/\b(both|all|the)\b/g, " ")
        .replace(/\btenants?\b/g, " ")
        .replace(/\bby\s+.+$/g, " ")
        .replace(/\s*&\s*/g, " & "));
    const quoted: string[] = [];
    const protectedBody = body.replace(/"([^"]+)"|'([^']+)'/g, (_match, dbl, sgl) => {
        const value = cleanSlotText(dbl || sgl || "");
        const token = `__cmpq${quoted.length}__`;
        quoted.push(value);
        return token;
    });
    const parts = protectedBody
        .split(/\s+(?:and|with|vs|versus|against|&)\s+|,/g)
        .map((part) => part.replace(/__cmpq(\d+)__/g, (_token, idx) => quoted[Number(idx)] || ""))
        .map((part) => cleanSlotText(part).replace(/^["']+|["']+$/g, ""))
        .map((part) => part.replace(/\b(?:total|combined|overall)\s+(?:branches|shops|units|stores)?\b/g, " ").replace(/\s+/g, " ").trim())
        .filter((part) => part && !Array.from(METRIC_WORDS).some((metric) => part === metric));
    if (parts.length === 1) {
        const words = parts[0].split(/\s+/g).filter(Boolean);
        if (words.length === 2) return words;
    }
    return Array.from(new Set(parts));
}

function detectExplicitSlots(normalized: string, tokens: string[], intent: AssistantIntent): {
    explicitMetricPhrase?: string;
    explicitEntityPhrases?: string[];
    compareEntityPhrases?: string[];
} {
    const tokenSet = new Set(tokens);
    const metricTokens = tokens.filter((token) => METRIC_WORDS.has(token));
    const explicitMetricPhrase = metricTokens[0];
    const out: {
        explicitMetricPhrase?: string;
        explicitEntityPhrases?: string[];
        compareEntityPhrases?: string[];
    } = {};
    if (explicitMetricPhrase) out.explicitMetricPhrase = explicitMetricPhrase;
    const assignedDimensionMatch = normalized.match(/^\s*(?:show|display|get|give)?\s*(.+?)\s+(?:of|by)\s+(assigned\s+sales\s+category|sales\s+category|assigned\s+group|group|category)\s*$/i);
    if (assignedDimensionMatch?.[1] && assignedDimensionMatch?.[2]) {
        const metricPhrase = cleanRankingMetricPhrase(assignedDimensionMatch[1]);
        if (metricPhrase) out.explicitMetricPhrase = metricPhrase;
    }
    const ofMatch = assignedDimensionMatch ? null : normalized.match(/\b(.+?)\s+(?:of|for)\s+(.+)$/i);
    if (ofMatch) {
        const left = cleanSlotText(ofMatch[1] || "");
        let right = cleanSlotText(ofMatch[2] || "").replace(/\s*&\s*/g, " & ");
        const leftMetricPhrase = cleanRankingMetricPhrase(left);
        if (leftMetricPhrase && /\b(?:sum|total|average|avg)\s+(?:of\s+)?(?:area|sqm|m2|size|rent|sales|revenue|turnover|ocr|occupancy|units?)\b/i.test(leftMetricPhrase)) {
            out.explicitMetricPhrase = leftMetricPhrase;
        } else if (left && !out.explicitMetricPhrase && Array.from(METRIC_WORDS).some((metric) => left.indexOf(metric) >= 0)) {
            out.explicitMetricPhrase = left.split(/\s+/g).find((token) => METRIC_WORDS.has(token));
        }
        const nestedMetric = right.match(/^(?:sum|total|average|avg)?\s*(area|sqm|m2|size|rent|rental|lease|sales|revenue|turnover|ocr|occupancy|vacancy|vacant|occupied|units|unit|amount|value)\s+(?:of|for)\s+(.+)$/i);
        if (nestedMetric?.[1] && nestedMetric?.[2]) {
            if (!out.explicitMetricPhrase) out.explicitMetricPhrase = nestedMetric[1];
            right = cleanSlotText(nestedMetric[2]);
        }
        if (right) {
            const parts = right
                .split(/\s+(?:and|with|vs|versus|against|&)\s+|,/g)
                .map(cleanSlotText)
                .filter(Boolean);
            out.explicitEntityPhrases = parts.length > 1 ? parts : [right];
        }
    } else if (explicitMetricPhrase && tokens.length >= 2) {
        const entityTokens = tokens.filter((token) => token !== explicitMetricPhrase && !CONTROL_WORDS.has(token) && !STOP_WORDS.has(token));
        if (entityTokens.length) out.explicitEntityPhrases = [entityTokens.join(" ")];
    }
    if (!out.explicitMetricPhrase && intent === "lookup") {
        const showMatch = normalized.match(/^\s*(?:show|select|highlight|zoom|focus)\s+(?:all\s+|both\s+|each\s+|every\s+)?(.+)$/i);
        if (showMatch?.[1]) {
            const body = cleanSlotText(showMatch[1])
                .replace(/\b(on|in)\s+(?:the\s+)?map\b/ig, " ")
                .replace(/\s+/g, " ")
                .trim();
            const parts = body
                .split(/\s+(?:and|with|plus|&)\s+|,/g)
                .map(cleanSlotText)
                .filter((part) => part && !STOP_WORDS.has(part) && !CONTROL_WORDS.has(part));
            if (parts.length) out.explicitEntityPhrases = parts;
        }
    }
    if (intent === "compare") {
        const metricByMatch = normalized.match(/\bby\s+(.+?)(?:\s+(?:in|as)\s+(?:bar|column|line|pie|donut|doughnut|area)\s+(?:chart|graph|visual)|$)/i);
        const metricByPhrase = metricByMatch?.[1] ? cleanSlotText(metricByMatch[1]) : "";
        if (metricByPhrase && !out.explicitMetricPhrase) out.explicitMetricPhrase = metricByPhrase;
        const subjects = splitCompareSubjects(normalized);
        if (subjects.length) out.compareEntityPhrases = subjects;
        if (subjects.length) out.explicitEntityPhrases = subjects;
    }
    if (intent === "rank") {
        // "top N ... by [metric phrase]"
        const rankByMatch = normalized.match(/\bby\s+(.+?)(?:\s+(?:in|as)\s+(?:bar|column|line|pie|donut|doughnut|area)\s+(?:chart|graph|visual)|$)/i);
        if (rankByMatch?.[1]) {
            const phrase = cleanSlotText(rankByMatch[1]);
            if (phrase) out.explicitMetricPhrase = phrase;
        }
        // "top N ... with [high/low/...] [metric phrase]"
        if (!out.explicitMetricPhrase) {
            const withDirMatch = normalized.match(/\bwith\s+(?:high(?:est)?|most|best|largest|biggest|max(?:imum)?|low(?:est)?|least|worst|smallest|min(?:imum)?)\s+(.+?)$/i);
            if (withDirMatch?.[1]) {
                const phrase = cleanSlotText(withDirMatch[1]);
                if (phrase && !STOP_WORDS.has(phrase) && !CONTROL_WORDS.has(phrase)) out.explicitMetricPhrase = phrase;
            }
        }
        // "top N ... with [metric phrase]" (no direction word)
        if (!out.explicitMetricPhrase) {
            const withPlainMatch = normalized.match(/\bwith\s+((?!\d)[\w][\w\s]{1,40}?)$/i);
            if (withPlainMatch?.[1]) {
                const phrase = cleanSlotText(withPlainMatch[1]);
                if (phrase && !STOP_WORDS.has(phrase) && !CONTROL_WORDS.has(phrase)) out.explicitMetricPhrase = phrase;
            }
        }
        // Drop entity phrases that consist solely of metric/stop words — they are not entity names.
        // e.g. "sum of area" triggers ofMatch → explicitEntityPhrases=["area"]; that should not be treated as an entity.
        if (out.explicitEntityPhrases) {
            const purged = out.explicitEntityPhrases.filter((phrase) =>
                phrase.split(/\s+/g).filter(Boolean).some((token) => !METRIC_WORDS.has(token) && !STOP_WORDS.has(token) && !CONTROL_WORDS.has(token))
            );
            if (purged.length === 0) delete out.explicitEntityPhrases;
            else out.explicitEntityPhrases = purged;
        }
    }
    if (!out.explicitMetricPhrase && tokenSet.has("vacant")) out.explicitMetricPhrase = "vacant";
    return out;
}

function detectAverageComparison(normalized: string): { operator: "above" | "below" | "compare" } | undefined {
    if (/\babove\s+(?:the\s+)?average\b/i.test(normalized)) return { operator: "above" };
    if (/\bbelow\s+(?:the\s+)?average\b/i.test(normalized)) return { operator: "below" };
    if (/\bhigher\s+than\s+(?:the\s+)?average\b/i.test(normalized)) return { operator: "above" };
    if (/\blower\s+than\s+(?:the\s+)?average\b/i.test(normalized)) return { operator: "below" };
    if (/\bexceed[s]?\s+(?:the\s+)?average\b/i.test(normalized)) return { operator: "above" };
    if (/\b(?:compare[sd]?|vs|versus)\s+(?:the\s+)?average\b/i.test(normalized)) return { operator: "compare" };
    if (/\bhow\s+does\b.+\b(?:compare|perform|rank)\b.+\baverage\b/i.test(normalized)) return { operator: "compare" };
    return undefined;
}

function detectMetricThreshold(normalized: string): { metricPhrase: string; operator: "above" | "below"; value: number } | undefined {
    const aboveOps = "above|over|more\\s+than|greater\\s+than|at\\s+least|exceeds?";
    const belowOps = "below|under|less\\s+than|at\\s+most|not\\s+more\\s+than";
    // "[metric_word] above/below [value][%]"
    const directAbove = new RegExp(`\\b(${Array.from(METRIC_WORDS).join("|")})\\s+(?:${aboveOps})\\s+([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*(?:%|percent)?\\b`, "i");
    const directBelow = new RegExp(`\\b(${Array.from(METRIC_WORDS).join("|")})\\s+(?:${belowOps})\\s+([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*(?:%|percent)?\\b`, "i");
    let m = normalized.match(directAbove);
    if (m) return { metricPhrase: m[1].toLowerCase(), operator: "above", value: Number(m[2].replace(/,/g, "")) };
    m = normalized.match(directBelow);
    if (m) return { metricPhrase: m[1].toLowerCase(), operator: "below", value: Number(m[2].replace(/,/g, "")) };
    // "with [phrase] above/below [value][%]"
    const withAbove = new RegExp(`\\bwith\\s+([\\w\\s]{2,20}?)\\s+(?:${aboveOps})\\s+([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*(?:%|percent)?\\b`, "i");
    const withBelow = new RegExp(`\\bwith\\s+([\\w\\s]{2,20}?)\\s+(?:${belowOps})\\s+([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*(?:%|percent)?\\b`, "i");
    m = normalized.match(withAbove);
    if (m) { const ph = m[1].toLowerCase().trim(); if (Array.from(METRIC_WORDS).some((w) => ph.indexOf(w) >= 0)) return { metricPhrase: ph, operator: "above", value: Number(m[2].replace(/,/g, "")) }; }
    m = normalized.match(withBelow);
    if (m) { const ph = m[1].toLowerCase().trim(); if (Array.from(METRIC_WORDS).some((w) => ph.indexOf(w) >= 0)) return { metricPhrase: ph, operator: "below", value: Number(m[2].replace(/,/g, "")) }; }
    return undefined;
}

function detectCrossMetric(normalized: string): ParsedAssistantQuestion["crossMetric"] | undefined {
    const metricPattern = "(?:area|sqm|m2|size|rent|rental|lease|sales|revenue|turnover|ocr|occupancy|vacancy|vacant|occupied|units|unit|amount|value|gla)";
    const dimensionPattern = "(tenants?|units?|categories|category|groups?|zones?)";
    if (/\b(show\s+me\s+)?(risky|risk|weak|poor|underperforming|bad\s+performing|need\s+attention)\s+(tenants?|shops?|stores?|brands?)\b/i.test(normalized)) {
        return {
            dimensionType: "tenant",
            firstDirection: "high",
            firstMetricPhrase: "ocr",
            secondDirection: "low",
            secondMetricPhrase: "sales"
        };
    }
    if (/\b(show\s+me\s+)?(risky|risk|weak|poor|underperforming|bad\s+performing|need\s+attention)\s+(groups?|categories|category|zones?)\b/i.test(normalized)
        || /\b(which|what)\s+(groups?|categories|category|zones?)\s+need\s+attention\b/i.test(normalized)) {
        const dim = normalized.match(/\b(groups?|categories|category|zones?)\b/i)?.[1] || "groups";
        return {
            dimensionType: /^zones?/i.test(dim) ? "zone" : /^categor/i.test(dim) ? "category" : "group",
            firstDirection: "high",
            firstMetricPhrase: "ocr",
            secondDirection: "low",
            secondMetricPhrase: "growth"
        };
    }
    if (/\b(growth\s+opportunities|opportunity|opportunities|best\s+growth)\s+(tenants?|shops?|stores?|brands?|groups?|categories|category|zones?)\b/i.test(normalized)) {
        const dim = normalized.match(/\b(tenants?|shops?|stores?|brands?|groups?|categories|category|zones?)\b/i)?.[1] || "tenants";
        return {
            dimensionType: /^zones?/i.test(dim) ? "zone" : /^groups?/i.test(dim) ? "group" : /^categor/i.test(dim) ? "category" : "tenant",
            firstDirection: "high",
            firstMetricPhrase: "growth",
            secondDirection: "low",
            secondMetricPhrase: "ocr"
        };
    }
    if (/\b(expensive|costly|high\s+rent).+\b(low|lower|poor|weak)\s+(sales|revenue|turnover)\b/i.test(normalized)) {
        return {
            dimensionType: "tenant",
            firstDirection: "high",
            firstMetricPhrase: "rent",
            secondDirection: "low",
            secondMetricPhrase: "sales"
        };
    }
    const re = new RegExp(`\\b(high|higher|large|larger|low|lower|small|smaller)\\s+(${metricPattern})\\s+(?:but|and|with)\\s+(high|higher|large|larger|low|lower|small|smaller)\\s+(${metricPattern})(?:\\s+${dimensionPattern})?\\b`, "i");
    const m = normalized.match(re);
    if (!m) return undefined;
    const dir = (value: string): "high" | "low" => /low|lower|small|smaller/i.test(value) ? "low" : "high";
    const dimText = String(m[5] || "tenants").toLowerCase();
    const dimensionType =
        /^units?/.test(dimText) ? "unit" :
        /^categor/.test(dimText) ? "category" :
        /^groups?/.test(dimText) ? "group" :
        /^zones?/.test(dimText) ? "zone" :
        "tenant";
    return {
        dimensionType,
        firstDirection: dir(m[1] || ""),
        firstMetricPhrase: cleanSlotText(m[2] || ""),
        secondDirection: dir(m[3] || ""),
        secondMetricPhrase: cleanSlotText(m[4] || "")
    };
}

function detectOffset(normalized: string): number | undefined {
    const m = normalized.match(/\boffset\s+(\d+)\b/i);
    return m ? Number(m[1]) : undefined;
}

function uniqueSlotPhrases(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    values.forEach((value) => {
        const clean = cleanSlotText(value);
        const key = clean.toLowerCase();
        if (!clean || seen.has(key)) return;
        seen.add(key);
        out.push(clean);
    });
    return out;
}

function filterLabelsForSlots(filters: ParsedAssistantQuestion["filters"]): string[] {
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

function splitMatrixDimensionPhrases(value: string): string[] {
    const withFieldBoundaries = cleanSlotText(value)
        .replace(/\b(assigned\s+(?:groups?|tenant\s+names?|tenants?|sales\s+categor(?:y|ies)|categor(?:y|ies)|units?))\s+(?=assigned\s+(?:groups?|tenant\s+names?|tenants?|sales\s+categor(?:y|ies)|categor(?:y|ies)|units?)\b)/gi, "$1, ")
        .replace(/\b(assigned\s+(?:groups?|tenant\s+names?|tenants?|sales\s+categor(?:y|ies)|categor(?:y|ies)|units?))\s+(?=\b(?:tenant\s+names?|tenants?|units?|categor(?:y|ies)|groups?)\b)/gi, "$1, ");
    return withFieldBoundaries
        .replace(/\b(?:as|on|in)\s+(?:rows?|columns?|cols?)\b/gi, " ")
        .split(/\s*,\s*|\s+\band\b\s+|\s*>\s*/i)
        .map(cleanSlotText)
        .filter((part) => part && part.length >= 2 && !/^(row|rows|column|columns|col|cols)$/.test(part));
}

function dedupeMatrixPhrases(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    values.forEach((value) => {
        const clean = cleanSlotText(value);
        const key = clean.toLowerCase();
        if (!clean || seen.has(key)) return;
        seen.add(key);
        out.push(clean);
    });
    return out;
}

function isMatrixDimensionPhrase(value: string): boolean {
    const clean = cleanSlotText(value);
    return /^(?:assigned\s+)?(?:tenant\s+names?|tenants?|tenents?|brands?|shops?|stores?|retailers?|units?|unit\s+ids?|unit\s+names?|sales\s+categor(?:y|ies)|sales\s+cat(?:s)?|categor(?:y|ies)|cat(?:s)?|catg(?:ory|ry|ories)?|cathgr(?:y|ies)|segments?|classes|classifications?|types?|groups?|departments?|zones?|regions?|floors?|levels?|layers?)$/.test(clean);
}

function isTenantMatrixDimension(value: string): boolean {
    return /^(?:assigned\s+)?(?:tenant\s+names?|tenants?|tenents?|brands?|shops?|stores?|retailers?)$/.test(cleanSlotText(value));
}

function shouldUseMatrixRowHierarchy(dimensions: string[], normalized: string): boolean {
    if (dimensions.length < 2) return false;
    if (/\b(?:under|within|inside)\s+each\b|\bdrill(?:\s+down)?\b|\bexpand(?:able)?\b|\bhierarchy\b/i.test(normalized)) return true;
    return dimensions.slice(1).some(isTenantMatrixDimension);
}

function makeCanonicalMatrix(metricPhrase: string, rowPhrases: string[], columnPhrases: string[], metricPhrases?: string[], defaultValue: boolean = false, autoAxes: boolean = false): ParsedAssistantMatrix | undefined {
    const rows = dedupeMatrixPhrases(rowPhrases).slice(0, 4);
    const columns = dedupeMatrixPhrases(columnPhrases).slice(0, 4);
    const values = dedupeMatrixPhrases((metricPhrases && metricPhrases.length ? metricPhrases : [metricPhrase]).filter(Boolean)).slice(0, 6);
    const metric = values[0] || cleanSlotText(metricPhrase) || "area";
    if (!rows.length && !columns.length) return undefined;
    return {
        intent: "matrix",
        rows,
        columns,
        values: values.length ? values : [metric],
        filters: [],
        query: normalizeMatrixQuery({ rows, columns, values: values.length ? values : [metric], filters: [] }),
        defaultValue,
        autoAxes,
        metricPhrase: metric,
        metricPhrases: values.length > 1 ? values : undefined,
        rowPhrases: rows,
        columnPhrases: columns
    };
}

function parseMatrixOptions(normalized: string): Pick<ParsedAssistantMatrix, "topN" | "sortByTotal" | "hideZeros" | "valueMode" | "totalsMode"> {
    const topMatch = normalized.match(/\btop\s+(\d{1,3})\b/i);
    const bottomMatch = normalized.match(/\bbottom\s+(\d{1,3})\b/i);
    const topN = topMatch ? Number(topMatch[1]) : bottomMatch ? Number(bottomMatch[1]) : undefined;
    const sortByTotal = /\b(?:sort|order)\b.*\b(?:asc|ascending|smallest|lowest)\b/i.test(normalized)
        ? "asc"
        : (/\b(?:sort|order)\b.*\b(?:total|grand\s+total|desc|descending|largest|highest)\b/i.test(normalized)
            || /\btop\s+\d{1,3}\b/i.test(normalized))
        ? "desc"
        : bottomMatch
        ? "asc"
        : undefined;
    const hideZeros = /\b(?:hide|exclude|remove|without|non|nonzero|non-zero|no)\s+(?:zero|zeros|0)\b/i.test(normalized)
        || /\b(?:nonzero|non-zero)\b/i.test(normalized);
    const valueMode = /\b(?:percent|percentage|share|contribution)\s+(?:of\s+)?rows?\b/i.test(normalized)
        ? "percentOfRow"
        : /\b(?:percent|percentage|share|contribution)\s+(?:of\s+)?columns?\b/i.test(normalized)
        ? "percentOfColumn"
        : /\b(?:percent|percentage|share|contribution)\b/i.test(normalized)
        ? "percentOfTotal"
        : undefined;
    const totalsMode = /\b(?:without|hide|no)\s+(?:grand\s+)?totals?\b/i.test(normalized)
        ? "hide"
        : /\b(?:show|display)\s+totals?\s+only\b|\btotals?\s+only\b/i.test(normalized)
        ? "only"
        : undefined;
    return { topN: Number.isFinite(topN) ? Math.max(1, Math.min(100, Number(topN))) : undefined, sortByTotal, hideZeros, valueMode, totalsMode };
}

function withMatrixOptions(matrix: ParsedAssistantMatrix | undefined, normalized: string): ParsedAssistantMatrix | undefined {
    if (!matrix) return matrix;
    const options = parseMatrixOptions(normalized);
    const query = normalizeMatrixQuery({
        rows: matrix.rows,
        columns: matrix.columns,
        values: matrix.values,
        filters: matrix.filters,
        topN: options.topN,
        sort: options.sortByTotal ? { by: "grandTotal", direction: options.sortByTotal } : undefined,
        hideZeros: options.hideZeros,
        valueMode: options.valueMode
    });
    return { ...matrix, ...options, query };
}

function detectSimpleCanonicalMatrix(normalized: string): ParsedAssistantMatrix | undefined {
    if (/\b(?:highest|lowest|largest|smallest|best|worst|maximum|minimum|max|min|formula|definition)\b/i.test(normalized)) return undefined;
    const metricWords = "(?:sum\\s+of\\s+area|area|sqm|sq\\s*m|m2|size|gla|rent|rental|lease|sales\\s*/?\\s*sqm|sales|sale|revenue|turnover|income|ocr|occupancy|vacancy|vacant|occupied|units?|unit\\s+count|number\\s+of\\s+units|earliest\\s+lease\\s+expiry|latest\\s+lease\\s+expiry)";
    const dimWords = "(?:assigned\\s+)?(?:tenant\\s+names?|tenants?|tenents?|brands?|shops?|stores?|retailers?|units?|unit\\s+ids?|unit\\s+names?|sales\\s+categor(?:y|ies)|sales\\s+cat(?:s)?|categor(?:y|ies)|cat(?:s)?|catg(?:ory|ry|ories)?|cathgr(?:y|ies)|segments?|classes|classifications?|types?|groups?|departments?|zones?|regions?|floors?|levels?|layers?)";

    const eachByMatch = normalized.match(new RegExp(`^\\s*(?:show|display|get|give|create|build)?\\s*(.+?)\\s+for\\s+each\\s+(${dimWords})\\s+\\bby\\b\\s+(${dimWords})\\b`, "i"));
    if (eachByMatch?.[1] && eachByMatch?.[2] && eachByMatch?.[3]) {
        return withMatrixOptions(makeCanonicalMatrix(cleanSlotText(eachByMatch[1]), [eachByMatch[2]], [eachByMatch[3]]), normalized);
    }

    const wiseSplitMatch = normalized.match(new RegExp(`^\\s*(?:show|display|get|give|create|build)?\\s*(${dimWords})\\s+wise\\s+(.+?)\\s+(?:split\\s+by|by|across)\\s+(${dimWords})\\b`, "i"));
    if (wiseSplitMatch?.[1] && wiseSplitMatch?.[2] && wiseSplitMatch?.[3]) {
        return withMatrixOptions(makeCanonicalMatrix(cleanSlotText(wiseSplitMatch[2]), [wiseSplitMatch[1]], [wiseSplitMatch[3]]), normalized);
    }

    const splitByMatch = normalized.match(new RegExp(`^\\s*(?:show|display|get|give|create|build)?\\s*(.+?)\\s+\\b(?:split\\s+by|broken\\s+down\\s+by)\\b\\s+(${dimWords})\\s+(?:and|by|across)\\s+(${dimWords})\\b`, "i"));
    if (splitByMatch?.[1] && splitByMatch?.[2] && splitByMatch?.[3]) {
        return withMatrixOptions(makeCanonicalMatrix(cleanSlotText(splitByMatch[1]), [splitByMatch[2]], [splitByMatch[3]]), normalized);
    }

    const underEachMatch = normalized.match(new RegExp(`^\\s*(?:show|display|get|give|create|build)?\\s*(.+?)\\s+\\bby\\b\\s+(${dimWords})\\s+\\b(?:under|within|inside)\\s+each\\b\\s+(${dimWords})\\b`, "i"));
    if (underEachMatch?.[1] && underEachMatch?.[2] && underEachMatch?.[3]) {
        return withMatrixOptions(makeCanonicalMatrix(cleanSlotText(underEachMatch[1]), [underEachMatch[3]], [underEachMatch[2]]), normalized);
    }

    const compareUsingMatch = normalized.match(new RegExp(`^\\s*compare\\s+(${dimWords})\\s+(?:and|vs|versus|against)\\s+(${dimWords})\\s+\\b(?:using|by|with)\\b\\s+(.+?)\\s*$`, "i"));
    if (compareUsingMatch?.[1] && compareUsingMatch?.[2] && compareUsingMatch?.[3]) {
        return withMatrixOptions(makeCanonicalMatrix(cleanSlotText(compareUsingMatch[3]), [compareUsingMatch[1]], [compareUsingMatch[2]]), normalized);
    }

    const dimVsMetricMatch = normalized.match(new RegExp(`^\\s*(?:show|display|get|give|create|build)?\\s*(${dimWords})\\s+(?:vs|versus|against|x)\\s+(${dimWords})\\s+(.+?)\\s*$`, "i"));
    if (dimVsMetricMatch?.[1] && dimVsMetricMatch?.[2] && dimVsMetricMatch?.[3] && new RegExp(`\\b${metricWords}\\b`, "i").test(dimVsMetricMatch[3])) {
        return withMatrixOptions(makeCanonicalMatrix(cleanSlotText(dimVsMetricMatch[3]), [dimVsMetricMatch[1]], [dimVsMetricMatch[2]]), normalized);
    }

    const crossTabMatch = normalized.match(new RegExp(`^\\s*(?:show|display|get|give|create|build)?\\s*(.+?)\\s+(?:cross\\s*tab|crosstab|matrix|pivot)\\s+(${dimWords})\\s+(${dimWords})\\b`, "i"));
    if (crossTabMatch?.[1] && crossTabMatch?.[2] && crossTabMatch?.[3]) {
        return withMatrixOptions(makeCanonicalMatrix(cleanSlotText(crossTabMatch[1]), [crossTabMatch[2]], [crossTabMatch[3]]), normalized);
    }

    const topPerMatch = normalized.match(new RegExp(`^\\s*(?:show\\s+)?(?:top|bottom)\\s+\\d{1,3}\\s+(${dimWords})\\s+\\bby\\b\\s+(.+?)\\s+\\b(?:per|by|for\\s+each|under\\s+each)\\b\\s+(${dimWords})\\b`, "i"));
    if (topPerMatch?.[1] && topPerMatch?.[2] && topPerMatch?.[3]) {
        return withMatrixOptions(makeCanonicalMatrix(cleanSlotText(topPerMatch[2]), [topPerMatch[1]], [topPerMatch[3]]), normalized);
    }

    const sortDimMatch = normalized.match(new RegExp(`^\\s*(?:show\\s+)?(?:sort|order)\\s+(${dimWords})\\s+\\bby\\b\\s+(.+?)\\s*$`, "i"));
    if (sortDimMatch?.[1] && sortDimMatch?.[2]) {
        return withMatrixOptions(makeCanonicalMatrix(cleanSlotText(sortDimMatch[2]), [sortDimMatch[1]], []), normalized);
    }
    const tenantUnderEachMatch = normalized.match(new RegExp(`^\\s*(?:show|display|get|give|create|build)?\\s*(?:tenants?|tenant\\s+names?|brands?|shops?|stores?)\\s+\\b(?:under|within|inside)\\s+each\\b\\s+(${dimWords})\\s+\\b(?:by|using|with)\\b\\s+(.+?)\\s*$`, "i"));
    if (tenantUnderEachMatch?.[1] && tenantUnderEachMatch?.[2]) {
        return withMatrixOptions(makeCanonicalMatrix(cleanSlotText(tenantUnderEachMatch[2]), [tenantUnderEachMatch[1], "tenant"], []), normalized);
    }
    const byMatch = normalized.match(new RegExp(`^\\s*(?:show|display|get|give|create|build|summarize|summary\\s+of)?\\s*(.+?)\\s+\\b(?:by|across|grouped\\s+by|split\\s+by|per)\\b\\s+(.+?)$`, "i"));
    if (byMatch?.[1] && byMatch?.[2]) {
        const metricPhrase = cleanSlotText(byMatch[1])
            .replace(/\b(?:summary|summarize|matrix|pivot|cross\s*tab|crosstab|report|table|values?|measures?|metrics?)\b/g, " ")
            .replace(/^\s*(?:of|for)\s+/i, "")
            .replace(/\s+/g, " ")
            .trim();
        const dimensions = splitMatrixDimensionPhrases(String(byMatch[2] || "").replace(/\s+\bby\b\s+/ig, " and ")).filter(isMatrixDimensionPhrase);
        if (metricPhrase && new RegExp(`\\b${metricWords}\\b`, "i").test(metricPhrase) && dimensions.length >= 1) {
            return shouldUseMatrixRowHierarchy(dimensions, normalized)
                ? withMatrixOptions(makeCanonicalMatrix(metricPhrase, dimensions, [], undefined, false, false), normalized)
                : withMatrixOptions(makeCanonicalMatrix(metricPhrase, [dimensions[0]], dimensions.slice(1), undefined, false, dimensions.length > 1), normalized);
        }
    }

    const withDimensionMatch = normalized.match(new RegExp(`^\\s*(?:show|display|get|give|create|build)?\\s*(.+?)\\s+\\b(?:with|using)\\b\\s+(${dimWords}(?:\\s+(?:and|,|>)\\s+${dimWords})+)\\s*$`, "i"));
    if (withDimensionMatch?.[1] && withDimensionMatch?.[2]) {
        const metricPhrase = cleanSlotText(withDimensionMatch[1])
            .replace(/\b(?:summary|summarize|matrix|pivot|cross\s*tab|crosstab|report|table|values?|measures?|metrics?)\b/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        const dimensions = splitMatrixDimensionPhrases(withDimensionMatch[2]).filter(isMatrixDimensionPhrase);
        if (metricPhrase && new RegExp(`\\b${metricWords}\\b`, "i").test(metricPhrase) && dimensions.length >= 2) {
            return shouldUseMatrixRowHierarchy(dimensions, normalized)
                ? withMatrixOptions(makeCanonicalMatrix(metricPhrase, dimensions, [], undefined, false, false), normalized)
                : withMatrixOptions(makeCanonicalMatrix(metricPhrase, [dimensions[0]], dimensions.slice(1), undefined, false, true), normalized);
        }
    }

    const metricAndDimensionMatch = normalized.match(new RegExp(`^\\s*(?:show|display|get|give|create|build)?\\s*(.+?)\\s+\\band\\b\\s+(${dimWords}(?:\\s+(?:and|,|>)\\s+${dimWords})*)\\s*$`, "i"));
    if (metricAndDimensionMatch?.[1] && metricAndDimensionMatch?.[2]) {
        const metricPhrase = cleanSlotText(metricAndDimensionMatch[1])
            .replace(/\b(?:summary|summarize|matrix|pivot|cross\s*tab|crosstab|report|table|values?|measures?|metrics?)\b/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        const dimensions = splitMatrixDimensionPhrases(metricAndDimensionMatch[2]).filter(isMatrixDimensionPhrase);
        if (metricPhrase && new RegExp(`\\b${metricWords}\\b`, "i").test(metricPhrase) && dimensions.length >= 1) {
            return shouldUseMatrixRowHierarchy(dimensions, normalized)
                ? withMatrixOptions(makeCanonicalMatrix(metricPhrase, dimensions, [], undefined, false, false), normalized)
                : withMatrixOptions(makeCanonicalMatrix(metricPhrase, [dimensions[0]], dimensions.slice(1), undefined, false, dimensions.length > 1), normalized);
        }
    }

    const noMetricMatch = normalized.match(new RegExp(`^\\s*(?:show|display|get|give|create|build)?\\s*(?:matrix|pivot|report|table)\\s+(?:of|for|by|with)?\\s*(${dimWords}(?:\\s+(?:and|,|>)\\s+${dimWords})*)\\s*$`, "i"));
    if (noMetricMatch?.[1]) {
        const dimensions = splitMatrixDimensionPhrases(noMetricMatch[1]).filter(isMatrixDimensionPhrase);
        if (dimensions.length) {
            return shouldUseMatrixRowHierarchy(dimensions, normalized)
                ? withMatrixOptions(makeCanonicalMatrix("area", dimensions, [], ["area"], true, false), normalized)
                : withMatrixOptions(makeCanonicalMatrix("area", [dimensions[0]], dimensions.slice(1), ["area"], true, dimensions.length > 1), normalized);
        }
    }

    const metricInColumnsMatrix = normalized.match(new RegExp(`^\\s*(?:show|display|get|give|create|build)?\\s*(.+?)\\s+\\b(?:in|as)\\s+(?:columns?|cols?)\\s+(?:and\\s+)?(${dimWords})\\s+\\bas\\s+(?:matrix|pivot|report|table)\\b`, "i"));
    if (metricInColumnsMatrix?.[1] && metricInColumnsMatrix?.[2]) {
        const metricPhrase = cleanSlotText(metricInColumnsMatrix[1]);
        if (metricPhrase) return withMatrixOptions(makeCanonicalMatrix(metricPhrase, [metricInColumnsMatrix[2]], []), normalized);
    }

    const rowColValueMatch = normalized.match(new RegExp(`^\\s*(?:show|display|get|give|create|build)?\\s*(${dimWords})\\s+rows?\\s+(${dimWords})\\s+(?:columns?|cols?)\\s+(.+?)\\s*$`, "i"));
    if (rowColValueMatch?.[1] && rowColValueMatch?.[2] && rowColValueMatch?.[3]) {
        return withMatrixOptions(makeCanonicalMatrix(cleanSlotText(rowColValueMatch[3]), [rowColValueMatch[1]], [rowColValueMatch[2]]), normalized);
    }

    const colRowValueMatch = normalized.match(new RegExp(`^\\s*(?:show|display|get|give|create|build)?\\s*(${dimWords})\\s+(?:columns?|cols?)\\s+(${dimWords})\\s+rows?\\s+(.+?)\\s*$`, "i"));
    if (colRowValueMatch?.[1] && colRowValueMatch?.[2] && colRowValueMatch?.[3]) {
        return withMatrixOptions(makeCanonicalMatrix(cleanSlotText(colRowValueMatch[3]), [colRowValueMatch[2]], [colRowValueMatch[1]]), normalized);
    }

    const vsMatch = normalized.match(new RegExp(`^\\s*(?:show|display|get|give|create|build)?\\s*(?:matrix|pivot|report|table)?\\s*(${metricWords}(?:\\s+(?:and|plus|,)\\s+${metricWords})*)\\s+(?:matrix|pivot|report|table)?\\s+(${dimWords})\\s+(?:vs|versus|against|x|by)\\s+(${dimWords})\\b`, "i"));
    if (vsMatch?.[1] && vsMatch?.[2] && vsMatch?.[3]) {
        return withMatrixOptions(makeCanonicalMatrix(vsMatch[1], [vsMatch[2]], [vsMatch[3]], splitMatrixDimensionPhrases(vsMatch[1])), normalized);
    }

    const noMetricAxis = normalized.match(new RegExp(`\\b(${dimWords})\\s+as\\s+(?:columns?|cols?)\\s+(?:and\\s+)?(${dimWords})\\s+as\\s+rows?\\b`, "i"));
    if (noMetricAxis?.[1] && noMetricAxis?.[2]) {
        const prefix = normalized.slice(0, Math.max(0, noMetricAxis.index || 0));
        if (!new RegExp(`\\b${metricWords}\\b`, "i").test(prefix)) {
            return withMatrixOptions(makeCanonicalMatrix("area", [noMetricAxis[2]], [noMetricAxis[1]]), normalized);
        }
    }
    const noMetricRowAxis = normalized.match(new RegExp(`\\b(${dimWords})\\s+as\\s+rows?\\s+(?:and\\s+)?(${dimWords})\\s+as\\s+(?:columns?|cols?)\\b`, "i"));
    if (noMetricRowAxis?.[1] && noMetricRowAxis?.[2]) {
        const prefix = normalized.slice(0, Math.max(0, noMetricRowAxis.index || 0));
        if (!new RegExp(`\\b${metricWords}\\b`, "i").test(prefix)) {
            return withMatrixOptions(makeCanonicalMatrix("area", [noMetricRowAxis[1]], [noMetricRowAxis[2]]), normalized);
        }
    }
    return undefined;
}

function crossMetricMetricPhrases(crossMetric: ParsedAssistantQuestion["crossMetric"]): string[] {
    if (!crossMetric) return [];
    return [crossMetric.firstMetricPhrase, crossMetric.secondMetricPhrase].filter(Boolean);
}

function detectMatrix(normalized: string): ParsedAssistantQuestion["matrix"] | undefined {
    const rowAxis = "rows?|row";
    const columnAxis = "columns?|cols?|column|col";
    const simpleCanonical = detectSimpleCanonicalMatrix(normalized);
    if (simpleCanonical) return simpleCanonical;
    if (!((new RegExp(`\\b(?:${rowAxis})\\b`, "i").test(normalized) && new RegExp(`\\b(?:${columnAxis})\\b`, "i").test(normalized)) || /\b(matrix|pivot|cross\s*tab|crosstab)\b/i.test(normalized) || new RegExp(`\\bas\\s+(?:${columnAxis})\\b`, "i").test(normalized))) return undefined;
    const measureOfRowFirst = normalized.match(new RegExp(`^\\s*(?:show|display|get|give|create|build)?\\s*((?:sum|average|avg|min|max|count)\\s+of\\s+[a-z0-9&/\\s]+?)\\s+\\bof\\b\\s+(.+?)\\s+\\bas\\s+(?:${rowAxis})\\s+(?:and\\s+)?(.+?)\\s+\\bas\\s+(?:${columnAxis})\\b`, "i"));
    if (measureOfRowFirst?.[1] && measureOfRowFirst?.[2] && measureOfRowFirst?.[3]) {
        const metricPhrase = cleanSlotText(measureOfRowFirst[1]).replace(/\b(?:show|display|get|give|create|build)\b/g, " ").replace(/\s+/g, " ").trim();
        const rowPhrases = splitMatrixDimensionPhrases(measureOfRowFirst[2]);
        const columnPhrases = splitMatrixDimensionPhrases(measureOfRowFirst[3]);
        if (metricPhrase && columnPhrases.length) return withMatrixOptions(makeCanonicalMatrix(metricPhrase, rowPhrases, columnPhrases), normalized);
    }
    const rowOnlyMatrix = normalized.match(new RegExp(`^\\s*(?:show|display|get|give|create|build)?\\s*(.+?)\\s+\\b(?:matrix|pivot|report|table)\\b\\s+\\b(?:of|for|by|with)\\b\\s+(.+?)\\s+\\bas\\s+(?:${rowAxis})\\b`, "i"));
    if (rowOnlyMatrix?.[1] && rowOnlyMatrix?.[2]) {
        const metricPhrase = cleanSlotText(rowOnlyMatrix[1]).replace(/\b(?:show|display|get|give|create|build)\b/g, " ").replace(/\s+/g, " ").trim();
        const rowPhrases = splitMatrixDimensionPhrases(rowOnlyMatrix[2]);
        if (metricPhrase && rowPhrases.length) return withMatrixOptions(makeCanonicalMatrix(metricPhrase, rowPhrases, []), normalized);
    }
    const measureOfColumnFirst = normalized.match(new RegExp(`^\\s*(?:show|display|get|give|create|build)?\\s*((?:sum|average|avg|min|max|count)\\s+of\\s+[a-z0-9&/\\s]+?)\\s+\\bof\\b\\s+(.+?)\\s+\\bas\\s+(?:${columnAxis})\\s+(?:and\\s+)?(.+?)\\s+\\bas\\s+(?:${rowAxis})\\b`, "i"));
    if (measureOfColumnFirst?.[1] && measureOfColumnFirst?.[2] && measureOfColumnFirst?.[3]) {
        const metricPhrase = cleanSlotText(measureOfColumnFirst[1]).replace(/\b(?:show|display|get|give|create|build)\b/g, " ").replace(/\s+/g, " ").trim();
        const columnPhrases = splitMatrixDimensionPhrases(measureOfColumnFirst[2]);
        const rowPhrases = splitMatrixDimensionPhrases(measureOfColumnFirst[3]);
        if (metricPhrase && columnPhrases.length) return withMatrixOptions(makeCanonicalMatrix(metricPhrase, rowPhrases, columnPhrases), normalized);
    }
    const explicitColumnFirst = normalized.match(new RegExp(`^\\s*(?:show|display|get|give|create|build)?\\s*(.+?)\\s+\\b(?:for|of|by|with)\\b\\s+(.+?)\\s+\\bas\\s+(?:${columnAxis})\\s+(?:and\\s+)?(.+?)\\s+\\bas\\s+(?:${rowAxis})\\b`, "i"));
    if (explicitColumnFirst?.[1] && explicitColumnFirst?.[2] && explicitColumnFirst?.[3]) {
        const metricPhrase = cleanSlotText(explicitColumnFirst[1]).replace(/\b(?:show|display|get|give|create|build)\b/g, " ").replace(/\s+/g, " ").trim();
        const columnPhrases = splitMatrixDimensionPhrases(explicitColumnFirst[2]);
        const rowPhrases = splitMatrixDimensionPhrases(explicitColumnFirst[3]);
        if (metricPhrase && columnPhrases.length) return withMatrixOptions(makeCanonicalMatrix(metricPhrase, rowPhrases, columnPhrases), normalized);
    }
    const explicitRowFirst = normalized.match(new RegExp(`^\\s*(?:show|display|get|give|create|build)?\\s*(.+?)\\s+\\b(?:for|of|by|with)\\b\\s+(.+?)\\s+\\bas\\s+(?:${rowAxis})\\s+(?:and\\s+)?(.+?)\\s+\\bas\\s+(?:${columnAxis})\\b`, "i"));
    if (explicitRowFirst?.[1] && explicitRowFirst?.[2] && explicitRowFirst?.[3]) {
        const metricPhrase = cleanSlotText(explicitRowFirst[1]).replace(/\b(?:show|display|get|give|create|build)\b/g, " ").replace(/\s+/g, " ").trim();
        const rowPhrases = splitMatrixDimensionPhrases(explicitRowFirst[2]);
        const columnPhrases = splitMatrixDimensionPhrases(explicitRowFirst[3]);
        if (metricPhrase && columnPhrases.length) return withMatrixOptions(makeCanonicalMatrix(metricPhrase, rowPhrases, columnPhrases), normalized);
    }
    const metricMatch =
        normalized.match(new RegExp(`\\b(?:show|display|get|give|create|build)?\\s*([a-z0-9&/\\s]+?)\\s+\\b(?:for|of|by|with)\\b.+?\\b(?:${rowAxis})\\b.+?\\b(?:${columnAxis})\\b`, "i")) ||
        normalized.match(new RegExp(`\\b(?:show|display|get|give|create|build)?\\s*([a-z0-9&/\\s]+?)\\s+\\b(?:for|of|by|with)\\b.+?\\bas\\s+(?:${columnAxis})\\b`, "i")) ||
        normalized.match(/\b(?:matrix|pivot|cross\s*tab|crosstab)\s+(?:of|for)?\s*([a-z0-9&/\s]+?)\s+\b(?:by|with|for|of)\b/i);
    const metricPhrase = cleanSlotText(metricMatch?.[1] || "").replace(/\b(?:show|display|get|give|create|build)\b/g, " ").replace(/\s+/g, " ").trim();
    const metricIndex = metricPhrase ? normalized.indexOf(metricPhrase) : -1;
    const matrixBody = cleanSlotText((metricIndex >= 0 ? normalized.slice(metricIndex + metricPhrase.length) : normalized)
        .replace(/^\s*(?:for|of|by|with)\s+/i, ""));
    const rowThenColumn = matrixBody.match(new RegExp(`^(.+?)\\s+\\bas\\s+(?:${rowAxis})\\s+(?:and\\s+)?(.+?)\\s+\\bas\\s+(?:${columnAxis})\\b`, "i"));
    const columnThenRow = matrixBody.match(new RegExp(`^(.+?)\\s+\\bas\\s+(?:${columnAxis})\\s+(?:and\\s+)?(.+?)\\s+\\bas\\s+(?:${rowAxis})\\b`, "i"));
    let rowText = "";
    let columnText = "";
    if (rowThenColumn?.[1] && rowThenColumn?.[2]) {
        rowText = rowThenColumn[1];
        columnText = rowThenColumn[2];
    } else if (columnThenRow?.[1] && columnThenRow?.[2]) {
        columnText = columnThenRow[1];
        rowText = columnThenRow[2];
    } else {
        const rowMatch =
            matrixBody.match(new RegExp(`^(.+?)\\s+\\bas\\s+(?:${rowAxis})\\b`, "i")) ||
            normalized.match(new RegExp(`\\b(?:${rowAxis})\\s*(?:as|by|=|:)?\\s*(.+?)(?:\\s+\\b(?:and\\s+)?(?:${columnAxis})\\b|$)`, "i"));
        const colMatch =
            matrixBody.match(new RegExp(`\\bas\\s+(?:${rowAxis})\\s+(?:and\\s+)?(.+?)\\s+\\bas\\s+(?:${columnAxis})\\b`, "i")) ||
            matrixBody.match(new RegExp(`\\b(?:${rowAxis})\\s+(?:and\\s+)?(.+?)\\s+\\bas\\s+(?:${columnAxis})\\b`, "i")) ||
            matrixBody.match(new RegExp(`^(.+?)\\s+\\bas\\s+(?:${columnAxis})\\b`, "i")) ||
            normalized.match(new RegExp(`\\b(?:${columnAxis})\\s*(?:as|by|=|:)?\\s*(.+?)$`, "i"));
        rowText = rowMatch?.[1] || "";
        columnText = colMatch?.[1] || "";
    }
    const rowPhrases = splitMatrixDimensionPhrases(rowText);
    const columnPhrases = splitMatrixDimensionPhrases(columnText);
    if (!metricPhrase || !columnPhrases.length) return undefined;
    return withMatrixOptions(makeCanonicalMatrix(metricPhrase, rowPhrases, columnPhrases), normalized);
}

function parseAssistantNumber(value: string, multiplierText: string = ""): number {
    const raw = String(value || "").replace(/,/g, "").trim().toLowerCase();
    if (!raw) return NaN;
    const compactMatch = raw.match(/^([0-9]+(?:\.[0-9]+)?)(k|m|b)$/i);
    let base = compactMatch ? Number(compactMatch[1]) : Number(raw);
    const suffix = compactMatch ? compactMatch[2] : "";
    if (!Number.isFinite(base)) {
        base = WORD_NUMBERS[raw] || NaN;
    }
    if (!Number.isFinite(base)) return NaN;
    const mult = `${suffix} ${String(multiplierText || "").toLowerCase()}`;
    if (/\bb(?:illion)?\b/.test(mult)) return base * 1_000_000_000;
    if (/\bm(?:illion)?\b/.test(mult)) return base * 1_000_000;
    if (/\bk\b|\bthousand\b/.test(mult)) return base * 1_000;
    return base;
}

function detectTopBottomDirection(normalized: string, tokens: string[]): "top" | "bottom" | undefined {
    if (/\b(bottom|lowest|worst|smallest|minimum|min)\b/i.test(normalized)) return "bottom";
    if (/\b(top|highest|best|largest|maximum|max|biggest|most)\b/i.test(normalized)) return "top";
    return detectDirection(tokens);
}

function genericTopBottomDimension(value: string): ParsedTopBottomQuery["dimensionType"] | undefined {
    const clean = cleanSlotText(value);
    if (/^(tenants?|tenant names?|assigned tenants?|assigned tenant names?|stores?|shops?|brands?)$/.test(clean)) return "tenant";
    if (/^(units?|unit ids?|unit names?|assigned units?)$/.test(clean)) return "unit";
    if (/^(categor(?:y|ies)|assigned categor(?:y|ies)|assigned sales categor(?:y|ies)|sales categor(?:y|ies))$/.test(clean)) return "category";
    if (/^(groups?|assigned groups?)$/.test(clean)) return "group";
    if (/^(zones?|regions?)$/.test(clean)) return "zone";
    if (/^(floors?|levels?)$/.test(clean)) return "floor";
    if (/^(layers?)$/.test(clean)) return "layer";
    if (/^bookmarks?$/.test(clean)) return "bookmark";
    return undefined;
}

function detectTopBottomSubject(normalized: string, direction: "top" | "bottom"): { dimensionType: ParsedTopBottomQuery["dimensionType"]; dimensionField?: string } | undefined {
    const rankWord = direction === "top"
        ? "(?:highest|best|largest|maximum|max|biggest|top)"
        : "(?:lowest|worst|smallest|minimum|min|bottom)";
    const match = normalized.match(new RegExp(`\\b${rankWord}\\s+(?:\\d+\\s+)?(.+?)\\s+\\b(?:by|with|based on|using)\\b`, "i"));
    const subject = cleanSlotText(match?.[1] || "");
    if (!subject) return undefined;
    const scopedGeneric = subject.match(/^(tenants?|tenant names?|assigned tenants?|assigned tenant names?|stores?|shops?|brands?|units?|unit names?|assigned units?|categor(?:y|ies)|assigned sales categor(?:y|ies)|sales categor(?:y|ies)|groups?|assigned groups?|zones?|regions?|floors?|levels?|layers?)\s+\b(?:in|inside|within|under|from)\b\s+.+$/i);
    if (scopedGeneric?.[1]) {
        const generic = genericTopBottomDimension(scopedGeneric[1]);
        if (generic) return { dimensionType: generic };
    }
    const generic = genericTopBottomDimension(subject);
    if (generic) return { dimensionType: generic };
    if (/\b(?:category|group|zone|region|floor|level|layer|tenant|unit|store|shop|brand|segment|class|type)\b/i.test(subject)) {
        return { dimensionType: "filter", dimensionField: subject };
    }
    return undefined;
}

function detectTopBottomDimension(normalized: string): ParsedTopBottomQuery["dimensionType"] | undefined {
    const checks: Array<[ParsedTopBottomQuery["dimensionType"], RegExp]> = [
        ["tenant", /\b(?:assigned\s+)?(?:tenant\s+names?|tenants?|stores?|shops?|brands?)\b/i],
        ["unit", /\b(?:assigned\s+)?(?:units?|unit\s+names?|unit\s+ids?)\b/i],
        ["category", /\b(?:assigned\s+)?(?:sales\s+)?categor(?:y|ies)\b/i],
        ["group", /\b(?:assigned\s+)?groups?\b/i],
        ["zone", /\b(?:zones?|regions?)\b/i],
        ["floor", /\b(?:floors?|levels?)\b/i],
        ["layer", /\blayers?\b/i],
        ["bookmark", /\bbookmarks?\b/i]
    ];
    const found = checks.find(([, re]) => re.test(normalized));
    return found ? found[0] : undefined;
}

function cleanRankingMetricPhrase(value: string): string {
    const cleaned = cleanSlotText(value)
        .replace(/^\s*(?:show|display|get|give|tell|find)\s+/i, "")
        .replace(/\b(?:sum|total)\s+of\s+(?=(?:sum|total)\s+of\b)/g, "")
        .replace(/\b(their|its|the|value|values|metric|measure|field)\b/g, " ")
        .replace(/\b(sales|revenue|turnover)\s*(?:per|\/)?\s*(sqm|sq\s*m|m2|area)\b/gi, "$1 productivity")
        .replace(/\b(sqm|sq\s*m|m2|area)\s*(?:per|\/)?\s*(sales|revenue|turnover)\b/gi, "$2 productivity")
        .replace(/\bper\s+(?:sqm|sq\s*m|m2|area)\b/g, " ")
        .replace(/\b(above|over|greater than|more than|below|under|less than|lower than|at least|at most|equal to|equals?|=|>=|<=|>|<)\b.+$/i, " ")
        .replace(/\s+/g, " ")
        .trim();
    return cleaned;
}

function detectMetricCondition(normalized: string, metricPhrase: string): ParsedTopBottomQuery["metricCondition"] | undefined {
    const opPattern = "(above|over|greater\\s+than|more\\s+than|below|under|less\\s+than|lower\\s+than|at\\s+least|at\\s+most|equal\\s+to|equals?|>=|<=|>|<|=)";
    const numPattern = "([0-9][0-9,]*(?:\\.[0-9]+)?(?:\\s*[kmb])?|[a-z]+)";
    const suffixPattern = "\\s*(million|m|thousand|k|billion|b|%|percent|sqm|sq\\s*m|m2|sqft)?";
    const metric = metricPhrase ? metricPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+") : "";
    const candidates = [
        metric ? new RegExp(`\\b${metric}\\s+${opPattern}\\s+${numPattern}${suffixPattern}\\b`, "i") : null,
        new RegExp(`\\b${opPattern}\\s+${numPattern}${suffixPattern}\\b`, "i")
    ].filter(Boolean) as RegExp[];
    for (const re of candidates) {
        const m = normalized.match(re);
        if (!m) continue;
        const hasMetricPrefix = metric && re.source.indexOf(metric) >= 0;
        const opText = String(m[hasMetricPrefix ? 1 : 1] || "").toLowerCase();
        const numText = String(m[hasMetricPrefix ? 2 : 2] || "");
        const suffix = String(m[hasMetricPrefix ? 3 : 3] || "");
        const value = parseAssistantNumber(numText, suffix);
        if (!Number.isFinite(value)) continue;
        let operator: ">" | ">=" | "<" | "<=" | "=" = "=";
        if (/^(above|over|greater|more|>)$/.test(opText) || /greater\s+than|more\s+than/.test(opText)) operator = ">";
        else if (/^(below|under|less|lower|<)$/.test(opText) || /less\s+than|lower\s+than/.test(opText)) operator = "<";
        else if (/at\s+least|>=/.test(opText)) operator = ">=";
        else if (/at\s+most|<=/.test(opText)) operator = "<=";
        else operator = "=";
        return { operator, value, rawText: String(m[0] || "").trim() };
    }
    return undefined;
}

function detectRankingMetricPhrase(normalized: string, direction: "top" | "bottom", dimension?: string): string {
    const connector = normalized.match(/\b(?:by|with|based on|using)\s+(.+?)(?:\s+(?:above|over|greater than|more than|below|under|less than|lower than|at least|at most|equal to|equals?|>=|<=|>|<|=|in|inside|within|under|from|for)\b|$)/i);
    if (connector?.[1]) {
        const phrase = cleanRankingMetricPhrase(connector[1]);
        if (phrase) return phrase;
    }
    const rankWord = direction === "top"
        ? "(?:highest|best|largest|maximum|max|biggest|top)"
        : "(?:lowest|worst|smallest|minimum|min|bottom)";
    const afterRank = normalized.match(new RegExp(`\\b${rankWord}\\s+(.+?)(?:\\s+(?:above|over|greater than|more than|below|under|less than|lower than|at least|at most|equal to|equals?|for|in|on|$))`, "i"));
    if (afterRank?.[1]) {
        const phrase = cleanRankingMetricPhrase(afterRank[1]).replace(new RegExp(`\\b(?:${dimension || ""})s?\\b`, "i"), "").trim();
        if (phrase && !/^(tenant|unit|category|group|zone|floor|layer|bookmark)s?$/.test(phrase)) return phrase;
    }
    const metricToken = normalized.match(/\b(sales?|revenue|turnover|rent|rental|lease|ocr|occupancy|area|sqm|m2|units?)\b/i);
    return metricToken ? cleanRankingMetricPhrase(metricToken[1]) : "";
}

export function parseTopBottomQuery(question: string): ParsedTopBottomQuery | null {
    const normalized = normalizeCorrectedAssistantText(question);
    if (!normalized) return null;
    const tokens = normalized.split(/\s+/g).map(correctAssistantToken).filter(Boolean);
    const direction = detectTopBottomDirection(normalized, tokens);
    if (!direction) {
        const showBy = normalized.match(/^\s*(?:show|display|get|give|create|build)?\s*(.+)\s+\b(?:by|of)\b\s+(.+?)$/i);
        const metricPhrase = cleanRankingMetricPhrase(showBy?.[1] || "");
        const subject = cleanSlotText(showBy?.[2] || "");
        if (metricPhrase && subject && /\b(?:assigned\s+)?(?:tenant\s+name|tenant|unit|category|sales\s+category|group|zone|floor|layer|brand|segment|class|type)s?\b/i.test(subject)) {
            const generic = genericTopBottomDimension(subject);
            return {
                direction: "top",
                limit: 50,
                dimensionType: generic || "filter",
                dimensionField: generic ? undefined : subject,
                metricPhrase,
                perArea: /\bper\s+(?:sqm|sq\s*m|m2|area)\b/i.test(normalized),
                metricCondition: detectMetricCondition(normalized, metricPhrase)
            };
        }
    }
    if (!direction) return null;
    const subject = detectTopBottomSubject(normalized, direction);
    const dimensionType = subject?.dimensionType || detectTopBottomDimension(normalized) || (/\b(sales?|revenue|turnover|rent|lease|ocr|occupancy|area|sqm|m2|units?)\b/i.test(normalized) ? "tenant" : undefined);
    if (!dimensionType) return null;
    const explicitLimit = detectLimit(tokens);
    const hasSingleRankWord = /\b(highest|lowest|best|worst|largest|smallest|maximum|minimum|max|min)\b/i.test(normalized);
    const limit = Math.max(1, Math.min(50, explicitLimit || (hasSingleRankWord ? 1 : 5)));
    const metricPhrase = detectRankingMetricPhrase(normalized, direction, dimensionType);
    if (!metricPhrase) return null;
    return {
        direction,
        limit,
        dimensionType,
        dimensionField: subject?.dimensionField,
        metricPhrase,
        perArea: /\bper\s+(?:sqm|sq\s*m|m2|area)\b|\/\s*(?:sqm|sq\s*m|m2|area)\b/i.test(normalized),
        metricCondition: detectMetricCondition(normalized, metricPhrase)
    };
}

function extractPropnPhrases(normals: string[], posTags: string[]): string[] {
    const phrases: string[] = [];
    let i = 0;
    while (i < normals.length) {
        if (posTags[i] === "PROPN") {
            const chunk: string[] = [];
            while (i < normals.length && posTags[i] === "PROPN") {
                const t = normalizeAssistantText(normals[i]);
                if (t) chunk.push(t);
                i++;
            }
            if (chunk.length > 0) {
                const phrase = chunk.join(" ");
                if (!CONTROL_WORDS.has(phrase) && !STOP_WORDS.has(phrase)) {
                    phrases.push(phrase);
                    if (chunk.length > 1) {
                        chunk.forEach((t) => {
                            if (!CONTROL_WORDS.has(t) && !STOP_WORDS.has(t) && t.length >= 2) phrases.push(t);
                        });
                    }
                }
            }
        } else {
            i++;
        }
    }
    return Array.from(new Set(phrases.filter((p) => p.length >= 2)));
}

function dedupeArr(arr: string[]): string[] {
    const seen = new Set<string>();
    return arr.filter((item) => { if (seen.has(item)) return false; seen.add(item); return true; });
}

/**
 * The standalone visual only needs deterministic intent tokens. Keeping this
 * tokenizer local avoids shipping a multi-megabyte general-purpose NLP model
 * into every Power BI report.
 */
function lightweightTokens(value: string): string[] {
    return normalizeAssistantText(value)
        .split(/\s+/g)
        .map((token) => correctAssistantToken(token))
        .reduce((out: string[], token) => out.concat(normalizeAssistantText(token).split(/\s+/g).filter(Boolean)), [])
        .filter(Boolean);
}

function lightweightLemma(token: string): string {
    const clean = correctAssistantToken(token);
    const known: Record<string, string> = {
        comparing: "compare", compared: "compare", compares: "compare",
        showing: "show", shown: "show", shows: "show",
        listing: "list", listed: "list", lists: "list",
        ranking: "rank", ranked: "rank", ranks: "rank",
        filtering: "filter", filtered: "filter", filters: "filter",
        calculating: "calculate", calculated: "calculate", calculates: "calculate",
        categories: "category", companies: "company", cities: "city",
        rows: "row", columns: "column", values: "value", measures: "measure",
        metrics: "metric", charts: "chart", graphs: "graph", trends: "trend"
    };
    if (known[clean]) return known[clean];
    if (clean.length > 4 && /(?:ses|xes|zes|ches|shes)$/.test(clean)) return clean.replace(/es$/, "");
    if (clean.length > 3 && /s$/.test(clean) && !/ss$/.test(clean)) return clean.slice(0, -1);
    return clean;
}

export function parseAssistantQuestion(question: string): ParsedAssistantQuestion {
    const raw = String(question || "");
    const debugInfo = stripDebug(raw);
    const quotedPhrases = Array.from(debugInfo.text.matchAll(/["']([^"']+)["']/g))
        .map((match) => cleanSlotText(match[1] || ""))
        .filter(Boolean);
    const normalized = normalizeCorrectedAssistantText(debugInfo.text);
    const normals = lightweightTokens(normalized);
    const lemmas = normals.map(lightweightLemma);
    const posTags = normals.map(() => "NOUN");

    // Standard tokens — used for entity phrase matching (keep original surface form)
    const tokens = normals
        .map((token) => correctAssistantToken(token))
        .reduce((out: string[], token) => out.concat(normalizeAssistantText(token).split(/\s+/g).filter(Boolean)), [])
        .filter(Boolean);

    // Lemma-enriched tokens — used for intent detection and slot filling
    // VERBs and NOUNs use their base form: "comparing"→"compare", "retailers"→"retailer"
    // ADJ/ADV keep original: "highest"→"highest", "lowest"→"lowest" (so rank detection stays intact)
    const intentTokens = normals.map((token, i) => {
        const pos = String(posTags[i] || "");
        const normal = correctAssistantToken(token);
        if (pos === "VERB" || pos === "NOUN") {
            const lemma = correctAssistantToken(String(lemmas[i] || token));
            return lemma || normal;
        }
        return normal;
    }).reduce((out: string[], token) => out.concat(normalizeAssistantText(token).split(/\s+/g).filter(Boolean)), [])
      .filter(Boolean);

    // Proper noun phrases (PROPN) — brand/store names the NLP model identifies
    // These are prepended to entity phrases so entity matching prioritises them
    const propnPhrases = extractPropnPhrases(normals, posTags);

    const phrases = candidatePhrases(tokens);
    const entityPhrases = dedupeArr([...propnPhrases, ...phrases]);
    const intent = detectIntent(intentTokens, normalized);
    const detectedFilters = detectFilters(normalized);
    const matrix = detectMatrix(normalized);
    if (matrix) {
        matrix.filters = filterLabelsForSlots(detectedFilters);
        matrix.query = normalizeMatrixQuery({
            rows: matrix.rows,
            columns: matrix.columns,
            values: matrix.values,
            filters: matrix.filters,
            topN: matrix.topN,
            sort: matrix.sortByTotal ? { by: "grandTotal", direction: matrix.sortByTotal } : undefined,
            hideZeros: matrix.hideZeros,
            valueMode: matrix.valueMode
        });
    }
    const effectiveIntent: AssistantIntent = matrix ? "matrix" : intent;
    const topBottom = matrix ? undefined : parseTopBottomQuery(debugInfo.text);
    const slots = detectExplicitSlots(normalized, intentTokens, effectiveIntent);
    const explicitMetricPhrase = topBottom?.metricPhrase || slots.explicitMetricPhrase;
    const explicitScopes = detectExplicitScopes(normalized);
    const breakdown = detectBreakdown(normalized);
    const metricThreshold = detectMetricThreshold(normalized);
    const crossMetric = detectCrossMetric(normalized);
    const valueSlots = uniqueSlotPhrases(
        (matrix?.defaultValue ? [] : (matrix?.values || []))
            .concat(topBottom?.metricPhrase ? [topBottom.metricPhrase] : [])
            .concat(explicitMetricPhrase ? [explicitMetricPhrase] : [])
            .concat(crossMetricMetricPhrases(crossMetric))
            .concat(metricThreshold?.metricPhrase ? [metricThreshold.metricPhrase] : [])
    );
    const requestedFields = {
        rows: matrix?.rows || [],
        columns: matrix?.columns || [],
        values: valueSlots,
        metrics: valueSlots,
        entities: uniqueSlotPhrases((slots.compareEntityPhrases || []).concat(slots.explicitEntityPhrases || [])),
        filters: filterLabelsForSlots(detectedFilters)
    };
    const detectedIntent = {
        intent: effectiveIntent,
        confidence: matrix || topBottom || breakdown ? 0.94 : effectiveIntent === "unknown" ? 0.25 : 0.86,
        reasons: [
            matrix ? "matrix_slots" : "",
            topBottom ? "rank_slots" : "",
            breakdown ? "breakdown_slots" : "",
            detectedFilters ? "filter_slots" : ""
        ].filter(Boolean)
    };
    return {
        raw,
        normalized,
        tokens: intentTokens,
        intent: effectiveIntent,
        detectedIntent,
        requestedFields,
        metricPhrases: phrases,
        entityPhrases,
        explicitMetricPhrase,
        explicitEntityPhrases: quotedPhrases.length ? quotedPhrases.concat(slots.explicitEntityPhrases || []) : slots.explicitEntityPhrases,
        compareEntityPhrases: slots.compareEntityPhrases,
        explicitScopes,
        breakdown,
        filters: detectedFilters,
        debug: debugInfo.debug,
        limit: detectLimit(intentTokens),
        direction: detectDirection(intentTokens),
        chartType: detectChartType(intentTokens),
        averageComparison: detectAverageComparison(normalized),
        metricThreshold,
        crossMetric,
        topBottom,
        matrix,
        offset: detectOffset(normalized)
    };
}
