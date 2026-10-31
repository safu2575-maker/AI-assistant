import { CashPosting } from './cashFlow';

/** Suggest only an unambiguous, explicitly named description field; never guess from amounts. */
export function cashDescriptionField(fields: string[], used: string[]): string {
    const matches = fields.filter(field => !used.includes(field) && /^(account description|account desc|gl account description)$/i.test(field.trim()));
    return matches.length === 1 ? matches[0] : '';
}

/** Exact role labels only: e.g. Bank fees must not become a starting bank account. */
export function identifiedBankPostings(rows: CashPosting[], accounts: string[]): CashPosting[] {
    return rows.filter(p => accounts.length ? accounts.includes(p.account) :
        /^(bank|cash|bank account|cash account)$/i.test((p.accountDescription || p.account || '').trim()));
}
