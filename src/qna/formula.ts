type Value = number | null;
type Expression = () => Value;

/** Numeric row formulas. Parse both branches, but evaluate only the selected branch. */
export function evaluateFormula(source: string, values: Map<string, Value>): Value {
    if (source.length > 4000) throw new Error("Formula is too long (maximum 4,000 characters).");
    const input = source.trim().replace(/^=/, "").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
    const tokens = input.match(/\[[^\]]+\]|(?:\d+(?:\.\d*)?|\.\d+)|[A-Za-z_][A-Za-z0-9_]*|>=|<=|<>|!=|==|[=<>()+\-*/,;]/g) || [];
    if (tokens.join("").replace(/\s/g, "") !== input.replace(/\s/g, "")) throw new Error("Unsupported character. Use numeric formulas and [Column] references.");
    let position = 0, depth = 0;
    const number = (value: Value): number => { if (value === null) throw new Error("Blank value. Use COALESCE([Column], 0) or ISBLANK([Column])."); return value; };
    const binary = (left: Expression, op: string, right: Expression): Expression => () => {
        const a = left(), b = right();
        if (["=", "==", "!=", "<>"].includes(op)) return Number(op === "=" || op === "==" ? a === b : a !== b);
        const x = number(a), y = number(b);
        switch (op) {
            case ">": return Number(x > y); case "<": return Number(x < y);
            case ">=": return Number(x >= y); case "<=": return Number(x <= y);
            case "+": return x + y; case "-": return x - y; case "*": return x * y;
            default: if (y === 0) throw new Error("Division by zero. Use DIVIDE(numerator, denominator, 0)."); return x / y;
        }
    };
    const comparison = (): Expression => { let node = sum(); while (["=", "==", "!=", "<>", ">", "<", ">=", "<="].includes(tokens[position])) { const op = tokens[position++]; node = binary(node, op, sum()); } return node; };
    const sum = (): Expression => { let node = product(); while (["+", "-"].includes(tokens[position])) { const op = tokens[position++]; node = binary(node, op, product()); } return node; };
    const product = (): Expression => { let node = unary(); while (["*", "/"].includes(tokens[position])) { const op = tokens[position++]; node = binary(node, op, unary()); } return node; };
    const unary = (): Expression => {
        if (++depth > 100) throw new Error("Formula nesting is too deep.");
        try {
            if (["+", "-"].includes(tokens[position])) { const op = tokens[position++], child = unary(); return () => number(child()) * (op === "-" ? -1 : 1); }
            return primary();
        } finally { depth--; }
    };
    const primary = (): Expression => {
        const token = tokens[position++];
        if (!token) throw new Error("Incomplete formula.");
        if (token === "(") { const node = comparison(); if (tokens[position++] !== ")") throw new Error("Missing closing parenthesis."); return node; }
        if (token.startsWith("[")) { const name = token.slice(1, -1).trim(); const key = [...values.keys()].find(key => key.toLowerCase() === name.toLowerCase()); if (key === undefined) throw new Error(`Unknown column: ${name}`); return () => values.get(key) ?? null; }
        if (/^[\d.]/.test(token)) return () => Number(token);
        const name = token.toUpperCase();
        if ((name === "TRUE" || name === "FALSE") && tokens[position] !== "(") return () => Number(name === "TRUE");
        const arities: Record<string, [number, number]> = { IF:[2,3], IFERROR:[2,2], ISBLANK:[1,1], BLANK:[0,0], TRUE:[0,0], FALSE:[0,0], AND:[1,100], OR:[1,100], NOT:[1,1], DIVIDE:[2,3], COALESCE:[1,100], ABS:[1,1], ROUND:[1,2], MIN:[1,100], MAX:[1,100] };
        if (!arities[name]) throw new Error(`Unknown function: ${token}. Try IF, IFERROR, ISBLANK or DIVIDE.`);
        if (tokens[position++] !== "(") throw new Error(`${name} needs parentheses. Example: IF([Column] = 0, 0, 1).`);
        const args: Expression[] = [];
        if (tokens[position] !== ")") { args.push(comparison()); while ([",", ";"].includes(tokens[position])) { position++; args.push(comparison()); } }
        if (tokens[position++] !== ")") throw new Error(`Missing closing parenthesis for ${name}.`);
        const [min, max] = arities[name];
        if (args.length < min || args.length > max) throw new Error(`${name} expects ${min === max ? min : `${min}–${max}`} arguments.`);
        return () => {
            if (name === "IF") return args[0]() ? args[1]() : args[2]?.() ?? null;
            if (name === "IFERROR") { try { const result = args[0](); if (result !== null && !Number.isFinite(result)) throw new Error(); return result; } catch { return args[1](); } }
            if (name === "ISBLANK") return Number(args[0]() === null);
            if (name === "BLANK") return null;
            if (name === "TRUE" || name === "FALSE") return Number(name === "TRUE");
            if (name === "AND") return Number(args.every(arg => !!arg()));
            if (name === "OR") return Number(args.some(arg => !!arg()));
            if (name === "NOT") return Number(!args[0]());
            if (name === "COALESCE") { for (const arg of args) { const value = arg(); if (value !== null) return value; } return null; }
            if (name === "DIVIDE") { const denominator = args[1](); if (denominator === null || denominator === 0) return args[2]?.() ?? 0; const numerator = args[0](); return numerator === null ? null : numerator / denominator; }
            const nums = args.map(arg => number(arg()));
            if (name === "ABS") return Math.abs(nums[0]);
            if (name === "MIN") return Math.min(...nums);
            if (name === "MAX") return Math.max(...nums);
            const digits = nums[1] ?? 0;
            if (!Number.isInteger(digits) || digits < -12 || digits > 12) throw new Error("ROUND digits must be an integer between -12 and 12.");
            return Number((nums[0] / 10 ** -digits).toFixed(0)) * 10 ** -digits;
        };
    };
    const expression = comparison();
    if (position !== tokens.length) throw new Error(`Unexpected token: ${tokens[position]}`);
    const result = expression();
    if (result !== null && !Number.isFinite(result)) throw new Error("The formula did not return a finite number.");
    return result;
}
