import { ModelField } from '../parameterQuery';
import { settingsSelect } from './settingsSelect';
import { settingsActionIcon } from './settingsActionIcon';
export interface SetupCatalogState {
 fields: ModelField[]; measures: string[]; detectedFields: ModelField[]; detectedMeasures: string[];
 sources: Array<{kind:'field'|'measure';table:string;column:string;options:string[]}>;
 fieldSource: string; measureSource: string;
}
/** Editing stays in the settings draft; the dialog owns save/cancel. */
export function setupCatalog(read:()=>SetupCatalogState, saveField:(field:ModelField,original?:string)=>void,
 saveMeasure:(name:string,original?:string)=>void, refresh:()=>void,
 chooseSource:(kind:'field'|'measure',table:string,column:string)=>void) {
 const element=document.createElement('section');element.className='askbics-setup-catalog';
 const actions=document.createElement('div');actions.className='askbics-setup-actions';
 const button=(text:string,action:()=>void)=>{const b=document.createElement('button');b.type='button';b.className='askbics-settings-action';b.textContent=text;b.onclick=action;return b;};
 const status=document.createElement('p');status.setAttribute('role','status');
 const search=document.createElement('input');search.type='search';search.placeholder='Search fields and measures…';search.setAttribute('aria-label','Search data setup');
 const sources=document.createElement('div'),list=document.createElement('div'),editor=document.createElement('div');editor.hidden=true;
 const error=document.createElement('p');error.setAttribute('role','alert');
 const draw=()=>{try{const state=read();status.textContent=`${state.fields.length} fields · ${state.measures.length} measures available`;list.replaceChildren();sources.replaceChildren();
 for(const kind of ['field','measure'] as const){const choices=state.sources.filter(s=>s.kind===kind);if(!choices.length){if(kind==='field'){const note=document.createElement('p');note.setAttribute('role','status');let saved='';try{saved=JSON.parse(state.fieldSource)[0]||'';}catch{}note.textContent='Field parameter not detected in current Power BI metadata.'+(saved?' Saved setup: '+saved+'.':'')+' In the Fields well, open the parameter menu and enable Show selected field, then Refresh detection. Advanced setup remains available for manual configuration.';sources.append(note);}continue;}
 const label=document.createElement('label');label.textContent=kind==='field'?'Field parameter':'Measure parameter';const select=document.createElement('select');select.setAttribute('aria-label',label.textContent);
 const empty=document.createElement('option');empty.value='';empty.textContent='Choose a detected parameter…';select.append(empty);
 for(const source of choices){const o=document.createElement('option');o.value=JSON.stringify([source.table,source.column]);o.textContent=source.table+' · '+source.column;select.append(o);}
 select.value=kind==='field'?state.fieldSource:state.measureSource;select.onchange=()=>{if(select.value){const [table,column]=JSON.parse(select.value);chooseSource(kind,table,column);draw();}};label.append(select);sources.append(label);settingsSelect(select);
 }
 const term=search.value.trim().toLowerCase();
 for(const kind of ['field','measure'] as const){
 const section=document.createElement('details');section.className='askbics-settings-disclosure';const title=document.createElement('summary');title.textContent=kind==='field'?'Available fields':'Available measures';section.append(title);
 const options=kind==='field'?state.fields.map(f=>f.name):state.measures;
 const select=document.createElement('select');select.setAttribute('aria-label',kind==='field'?'Loaded field':'Loaded measure');
 const empty=document.createElement('option');empty.value='';empty.textContent='Choose…';select.append(empty);
 for(const name of options.filter(name=>name.toLowerCase().includes(term))){const o=document.createElement('option');o.value=name;o.textContent=name;select.append(o);}
 const detail=document.createElement('p'),action=button('Edit mapping',()=>{const field=state.fields.find(f=>f.name===select.value);if(field)open('field',field,field.name);});action.hidden=true;
 select.onchange=()=>{const field=kind==='field'?state.fields.find(f=>f.name===select.value):undefined;
 const detected=field&&state.detectedFields.some(d=>d.name===field.name&&d.table===field.table&&d.column===field.column);
 detail.textContent=field ? field.table+'['+field.column+'] · '+(detected?'Detected':'Configured; verify the source if needed.') : select.value?'Configured measure. Edit its DAX or name in Power BI.':'';
 action.hidden=!field||!!detected;
 const mismatch=field&&state.detectedFields.some(d=>d.name===field.name&&(d.table!==field.table||d.column!==field.column));
 settingsActionIcon(action,'edit',mismatch?'Fix mapping':'Edit mapping');
 };
 section.append(select,detail,action);list.append(section);settingsSelect(select);if(term)section.open=true;
 }
 }catch(e){status.textContent=(e as Error).message;}};
 const open=(kind:'field'|'measure',field?:ModelField,original?:string)=>{
 editor.replaceChildren();editor.hidden=false;const title=document.createElement('h4');title.textContent=(original?'Edit ':'Add ')+kind;editor.append(title);
 const state=read();const controls:Record<string,HTMLInputElement>={};
 const input=(labelText:string,value:string,choices:string[]=[])=>{const label=document.createElement('label');label.textContent=labelText;const input=document.createElement('input');input.value=value;input.setAttribute('aria-label',labelText);label.append(input);editor.append(label);controls[labelText]=input;
 if(choices.length){const values=document.createElement('datalist');values.id='setup-'+kind+'-'+labelText.replace(/\s/g,'');[...new Set(choices)].forEach(value=>{const o=document.createElement('option');o.value=value;values.append(o);});input.setAttribute('list',values.id);editor.append(values);}return input;};
 const name=input(kind==='field'?'Field name':'Measure name',original||'',kind==='field'?state.detectedFields.map(f=>f.name):state.detectedMeasures);
 let type:HTMLSelectElement|undefined;
 if(kind==='field'){input('Source table',field?.table||'',state.detectedFields.map(f=>f.table));input('Source column',field?.column||'',state.detectedFields.map(f=>f.column));const label=document.createElement('label');label.textContent='Data type';type=document.createElement('select');type.setAttribute('aria-label','Data type');for(const value of ['text','number','date']){const o=document.createElement('option');o.value=value;o.textContent=value;type.append(o);}type.value=field?.type||'text';label.append(type);editor.append(label);settingsSelect(type);
 name.onchange=()=>{const match=state.detectedFields.find(f=>f.name===name.value);if(match){controls['Source table'].value=match.table;controls['Source column'].value=match.column;type!.value=match.type||'text';type!.dispatchEvent(new Event('change'));}};
 }else{const note=document.createElement('p');note.textContent='Enter the exact measure label from the bound measure parameter. This does not create a Power BI measure.';editor.append(note);}
 const buttons=document.createElement('div');buttons.className='askbics-setup-actions';buttons.append(button('Apply to draft',()=>{try{const value=name.value.trim();if(!value)throw new Error('Enter a name.');if(kind==='field'){const table=controls['Source table'].value.trim(),column=controls['Source column'].value.trim();if(!table||!column)throw new Error('Enter the source table and column.');saveField({...field,name:value,table,column,type:type!.value as ModelField['type']},original);}else saveMeasure(value,original);editor.hidden=true;error.textContent='';draw();}catch(e){error.textContent=(e as Error).message;}}),button('Cancel edit',()=>{editor.hidden=true;error.textContent='';}));editor.append(buttons,error);name.focus();
 };
 const toolbar=document.createElement('div');toolbar.className='askbics-detection-toolbar';
 const refreshButton=button('Refresh detection',()=>{try{refreshButton.disabled=true;status.textContent='Requesting current metadata from Power BI…';refresh();draw();status.textContent+=' · Refresh requested. Waiting for Power BI updates.';}catch(e){status.textContent=(e as Error).message;}finally{refreshButton.disabled=false;}});
 const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1');icon.append(path);refreshButton.prepend(icon);toolbar.append(refreshButton,status);
 const addChoices=document.createElement('div');addChoices.className='askbics-setup-actions';addChoices.hidden=true;
 const add=button('Add',()=>{addChoices.hidden=!addChoices.hidden;});
 addChoices.append(button('Field',()=>{addChoices.hidden=true;open('field');}),button('Measure',()=>{addChoices.hidden=true;open('measure');}));
 actions.append(add);search.oninput=draw;element.append(actions,addChoices,sources,search,editor,list);return {element,toolbar,refresh:draw};
}
