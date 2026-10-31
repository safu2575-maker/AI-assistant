/** Match only complete, unambiguous one-to-one document pairs inside the supplied scope. */
export type DocumentMatchRow = { id:string; document:string|number|boolean|null; reversal:string|number|boolean|null; partitions:Array<string|number|boolean|null>; amount:number|null };
export function matchReversalPairs(rows:DocumentMatchRow[]) {
    const excluded=new Set<string>(),review=new Map<string,string>();
    const blank=(v:unknown)=>v===null||v===undefined||v==='';
    type Doc={rows:DocumentMatchRow[];refs:Set<string>;amount:number;invalid:boolean};
    const docs=new Map<string,Doc>();
    const key=(row:DocumentMatchRow,value:unknown)=>JSON.stringify([...row.partitions,value]);
    for(const row of rows){
        if(blank(row.document)||row.partitions.some(blank)){review.set(row.id,'Missing document number or matching scope value.');continue;}
        const token=key(row,row.document),doc=docs.get(token)||{rows:[],refs:new Set<string>(),amount:0,invalid:false};
        doc.rows.push(row);if(!blank(row.reversal))doc.refs.add(key(row,row.reversal));
        if(row.amount===null||!Number.isFinite(row.amount))doc.invalid=true;else doc.amount+=row.amount;
        docs.set(token,doc);
    }
    const incoming=new Map<string,string[]>();
    for(const [token,doc] of docs)for(const ref of doc.refs)incoming.set(ref,[...(incoming.get(ref)||[]),token]);
    const flag=(doc:Doc,message:string)=>doc.rows.forEach(row=>review.set(row.id,message));
    for(const [token,doc] of docs){
        if(!doc.refs.size)continue;
        const ref=[...doc.refs][0],original=docs.get(ref);
        if(doc.refs.size!==1||ref===token||incoming.has(token)||original?.refs.size||(incoming.get(ref)?.length||0)!==1){
            flag(doc,'Ambiguous reversal chain or multiple reversal documents; retained for review.');
            for(const r of doc.refs){const other=docs.get(r);if(other)flag(other,'Ambiguous reversal relationship; retained for review.');}continue;
        }
        if(!original){flag(doc,'Original document not found within the current period and filters.');continue;}
        const tolerance=Math.min(1e-8,Number.EPSILON*Math.max(1,Math.abs(doc.amount),Math.abs(original.amount))*16);
        if(doc.invalid||original.invalid||doc.amount===0||original.amount===0||Math.sign(doc.amount)===Math.sign(original.amount)||Math.abs(doc.amount+original.amount)>tolerance){
            flag(doc,'Partial or non-offsetting reversal; both documents retained.');flag(original,'Partial or non-offsetting reversal; both documents retained.');continue;
        }
        for(const row of [...doc.rows,...original.rows])excluded.add(row.id);
    }
    // Any ambiguity wins over a candidate match.
    for(const id of review.keys())excluded.delete(id);
    return {excluded,review};
}

/** Excel-style exact reference lookup. Membership, not amount reconciliation. */
export function matchReversalReferences(rows:DocumentMatchRow[]) {
    const excluded=new Set<string>(),review=new Map<string,string>();
    const blank=(v:unknown)=>v===null||v===undefined||v===''||v==='—'||v==='-';
    const key=(row:DocumentMatchRow,value:unknown)=>JSON.stringify([...row.partitions,value]);
    const documents=new Set(rows.filter(r=>!blank(r.document)&&!r.partitions.some(blank)).map(r=>key(r,r.document)));
    for(const row of rows){
        if(row.partitions.some(blank)){review.set(row.id,'Missing matching scope value.');continue;}
        if(blank(row.reversal))continue;
        if(documents.has(key(row,row.reversal)))excluded.add(row.id);
        else review.set(row.id,'Reversal reference not found within the current period and filters; retained.');
    }
    return {excluded,review};
}
