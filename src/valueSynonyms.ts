export interface ValueSynonym { field:string; value:string; aliases:string[]; enabled?:boolean }
const escape=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const pattern=(text:string)=>new RegExp(`(?<![\\w])${escape(text)}(?![\\w])`,'gi');
/** Resolve aliases to explicit field filters without rewriting canonical names. */
export function resolveValueSynonyms(question:string,rules:ValueSynonym[]|undefined,fields:Array<{name:string;aliases?:string[];values?:string[]}>,measures:string[]):string {
    if(!rules?.length||/;\s*(analysisState|answerFilters|modelScope|transactions):/i.test(question))return question;
    const active=rules.filter(r=>r.enabled!==false);
    const where=/\b(?:where|with)\s+(.+)$/i.exec(question);
    let head=where?question.slice(0,where.index):question;
    let tail=where?where[1]:'';
    if(tail)tail=tail.split(/;|\s+and\s+(?=[^=;]+\s*=)/i).map(clause=>{
        const match=/^\s*(.+?)\s*=\s*(.+?)\s*$/.exec(clause);if(!match)return clause;
        const field=fields.find(f=>[f.name,...(f.aliases||[])].some(n=>n.toLowerCase()===match[1].trim().toLowerCase()));if(!field)return clause;
        const values=match[2].split('|').map(raw=>{
            const value=raw.trim().replace(/^"|"$/g,'');
            if(field.values?.some(v=>v.toLowerCase()===value.toLowerCase()))return raw;
            const matches=active.filter(r=>r.field===field.name&&r.aliases.some(a=>a.toLowerCase()===value.toLowerCase()));
            if(new Set(matches.map(r=>r.value)).size>1)throw new Error(`Ambiguous value synonym ${value}. Use the full value for ${field.name}.`);
            return matches[0]?.value||raw;
        });return `${match[1]} = ${values.join(' | ')}`;
    }).join('; ');
    let mask=head;
    const protectedNames=[...measures,...fields.flatMap(f=>[f.name,...(f.aliases||[]),...(f.values||[])]),...active.map(r=>r.value)].sort((a,b)=>b.length-a.length);
    for(const name of protectedNames)if(name)mask=mask.replace(pattern(name),m=>' '.repeat(m.length));
    mask=mask.replace(/"[^"]*"/g,m=>' '.repeat(m.length));
    const additions=new Map<string,string>();
    const aliases=[...new Set(active.flatMap(r=>r.aliases))].filter(Boolean).sort((a,b)=>b.length-a.length);
    const edits:Array<{start:number;length:number}>=[];
    for(const alias of aliases){
        const hits=[...mask.matchAll(pattern(alias))];if(!hits.length)continue;
        const matches=active.filter(r=>r.aliases.some(a=>a.toLowerCase()===alias.toLowerCase()));
        const targets=new Map(matches.map(r=>[JSON.stringify([r.field,r.value]),r]));
        if(targets.size!==1)throw new Error(`Ambiguous value synonym ${alias}. Specify the field, for example where Tenant = ${alias}.`);
        const rule=[...targets.values()][0];if(!fields.some(f=>f.name===rule.field))throw new Error(`Value synonym field ${rule.field} is unavailable. Review Synonyms settings.`);
        if(additions.has(rule.field)&&additions.get(rule.field)!==rule.value)throw new Error(`Specify alternative values for ${rule.field} using an explicit filter.`);
        additions.set(rule.field,rule.value);
        for(const hit of hits){edits.push({start:hit.index!,length:hit[0].length});mask=mask.slice(0,hit.index)+' '.repeat(hit[0].length)+mask.slice(hit.index!+hit[0].length);}
    }
    for(const edit of edits.sort((a,b)=>b.start-a.start))head=head.slice(0,edit.start)+' '.repeat(edit.length)+head.slice(edit.start+edit.length);
    const clauses=[tail,...[...additions].map(([field,value])=>`${field} = ${value}`)].filter(Boolean);
    return head.trim()+(clauses.length?' where '+clauses.join('; '):'');
}
