export function timeFieldOrder(name: string): number {
    return /\byear\b/i.test(name) ? 0 : /\bmonth\b/i.test(name) ? 1 : -1;
}

export function compareTimeLabels(left: string, right: string): number {
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const parts = (value: string) => value.split(/\s*[·>]\s*/).map(part => {
        const month = months.indexOf(part.trim().slice(0,3).toLowerCase());
        return month >= 0 ? String(month + 1).padStart(2,'0') : part;
    });
    const a = parts(left), b = parts(right);
    for (let i=0;i<Math.max(a.length,b.length);i++) {
        const comparison = (a[i] || '').localeCompare(b[i] || '',undefined,{numeric:true});
        if (comparison) return comparison;
    }
    return 0;
}
