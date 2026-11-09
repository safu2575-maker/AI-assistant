import { readCalculationQuote } from '../calculationFormula';
/** Pair delimiters only in syntax, never inside quoted values or comments. */
export function pairFormulaDelimiter(editor: HTMLTextAreaElement, event: KeyboardEvent): boolean {
 if(event.ctrlKey||event.metaKey||event.altKey||event.isComposing)return false;
 const source=editor.value,start=editor.selectionStart,end=editor.selectionEnd;
 let quote='',comment=false,field=false;
 for(let i=0;i<start;i++){
  const c=source[i];
  if(comment){if(c==='\n')comment=false;continue;}
  if(quote){if(c===quote){if(source[i+1]===quote&&i+1<start)i++;else quote='';}continue;}
  if(field){if(c===']')field=false;continue;}
  if(c==='/'&&source[i+1]==='/'){comment=true;i++;}
  else if(c==="'"||c==='"'){const quoted=readCalculationQuote(source.slice(0,start),i);if(!quoted.closed)quote=c;i=quoted.end-1;}
  else if(c==='[')field=true;
 }
 if(comment)return false;
 const key=event.key,next=source[start];
 if(start===end&&next===key&&((quote===key)||(field&&key===']')||(!quote&&!field&&key===')'))){event.preventDefault();editor.setSelectionRange(start+1,start+1);return true;}
 if(quote||field)return false;
 const close:Record<string,string>={'(':')','[':']',"'":"'",'"':'"'};
 if(!close[key])return false;
 // Do not insert a closing quote/bracket into the middle of existing text.
 if(start===end&&next&&!/[\s),\]+\-*/=<>]/.test(next))return false;
 event.preventDefault();const selected=source.slice(start,end);
 editor.setRangeText(key+selected+close[key],start,end,'end');
 editor.setSelectionRange(start+1,start+1+selected.length);
 editor.dispatchEvent(new Event('input',{bubbles:true}));return true;
}
