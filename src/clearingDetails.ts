export interface ClearingSettings { enabled:boolean; referenceField:string; companyField:string; yearField:string; measure:string; columns:string[] }
export function validateClearing(c:ClearingSettings|undefined,fields:string[],measures:string[],transactionFields:string[]=[]){
 if(!c?.enabled)return;
 const keys=[c.referenceField,c.companyField,c.yearField];
 if(new Set(keys).size!==3||keys.some(n=>!fields.includes(n)))throw new Error('Clearing details: choose separate clearing reference, company and clearing fiscal year fields.');
 const missing=keys.filter(n=>!transactionFields.includes(n));
 if(missing.length)throw new Error('Include clearing reference, company and clearing fiscal year in Transaction fields. Missing: '+missing.join(', ')+'. Open Filters & transactions → Transactions → Add transaction field.');
 if(!measures.includes(c.measure))throw new Error('Choose an available clearing amount measure.');
 if(!Array.isArray(c.columns)||c.columns.length>10||new Set(c.columns).size!==c.columns.length||c.columns.some(n=>!fields.includes(n)))throw new Error('Choose up to ten available clearing detail columns.');
}

export function validateDocument(c:ClearingSettings|undefined,fields:string[],measures:string[],transactionFields:string[]=[]){
 try{validateClearing(c,fields,measures,transactionFields);}catch(error){throw new Error((error as Error).message.replace(/Clearing/g,'Document').replace(/clearing reference/g,'document number').replace(/clearing fiscal year/g,'document fiscal year').replace(/clearing/g,'document'));}
}
