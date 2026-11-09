/** Compare repeat query values only; never round or change stored posting amounts. */
export function sameCashPostingAmount(a: number, b: number): boolean {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (a === b) return true;
    if (a !== 0 && b !== 0 && Math.sign(a) !== Math.sign(b)) return false;
    // A few floating-point rounding steps, capped so large balances cannot hide real changes.
    const tolerance = Math.min(1e-7, 8 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)));
    return Math.abs(a - b) <= tolerance;
}
