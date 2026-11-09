export interface AcceptedSuggestion {start:number;end:number;text:string;kind:'field'|'measure'|'value';name:string;field?:string;canonical:string}
/** Transient composer choices. Editing a selected span revokes its identity. */
export class AcceptedSuggestions {
 private text=''; private choices:AcceptedSuggestion[]=[];
 sync(next:string):void {
  if(next===this.text)return;
  let left=0;while(left<next.length&&left<this.text.length&&next[left]===this.text[left])left++;
  let right=0;while(right<this.text.length-left&&right<next.length-left&&this.text[this.text.length-1-right]===next[next.length-1-right])right++;
  const oldEnd=this.text.length-right,delta=next.length-this.text.length;
  this.choices=this.choices.filter(c=>c.end<=left||c.start>=oldEnd).map(c=>c.start>=oldEnd?{...c,start:c.start+delta,end:c.end+delta}:c);
  this.text=next;
 }
 accept(next:string,choice:AcceptedSuggestion):void {this.sync(next);this.choices=this.choices.filter(c=>c.end<=choice.start||c.start>=choice.end);this.choices.push(choice);}
 resolve(next:string):string {this.sync(next);let result=next;for(const c of [...this.choices].sort((a,b)=>b.start-a.start)){if(next.slice(c.start,c.end)===c.text)result=result.slice(0,c.start)+c.canonical+result.slice(c.end);}return result;}
 snapshot():AcceptedSuggestion[]{return this.choices.map(c=>({...c}));}
}
