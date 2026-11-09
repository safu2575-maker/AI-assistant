import {CashAllocation} from './cashFlow';

export function cashAllocationLabel(group: CashAllocation[]): string {
    if (group.some(a=>a.status==='Estimated')) return 'Estimated · Proportional';
    if (group.every(a=>a.status==='Resolved')) return group.some(a=>a.groupId) ? 'Verified · Destination only' : 'Verified';
    const status=group.find(a=>a.status!=='Resolved')?.status || 'Unresolved';
    if(status.startsWith('Unverified'))return 'Unverified';
    if(status==='Not processed')return status;
    return 'Unresolved · '+status;
}

export function cashStatusAppearance(label: string): {tone:string;description:string} {
    if(label==='Verified · Destination only')return {tone:'verified',description:'Destination GL and amount are verified. Individual payment-to-invoice pairing is not established.'};
    if(label==='Verified')return {tone:'verified',description:'Destination and allocated amount are supported by the loaded relationships.'};
    if(label.startsWith('Estimated'))return {tone:'estimated',description:'Proportional allocation is an estimate, not a verified historical settlement.'};
    if(label.startsWith('Unverified')||label==='Error')return {tone:'error',description:'Conflicting or invalid data prevents confirmation. Review troubleshooting details.'};
    if(label==='Not processed')return {tone:'pending',description:'Processing has not reached or completed this posting.'};
    return {tone:'unresolved',description:label==='Partially verified'?'Some allocations are verified; other amounts remain unresolved, estimated or unverified.':label};
}

export function cashStatusBadges(column: string, labels: string[]) {
    return {[column]:Object.fromEntries([...new Set(labels)].filter(Boolean).map(label=>[label,cashStatusAppearance(label)]))};
}
