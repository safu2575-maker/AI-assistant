import { settingsPopup } from './settingsPopup';
/** Explicit swatch trigger: descriptive labels never open the colour picker. */
export function settingsColour(label:string,value:string) {
 const element=document.createElement('div');element.className='askbics-settings-colour';
 const caption=document.createElement('span');caption.textContent=label;
 const input=document.createElement('input');input.type='hidden';input.value=value;
 const host=document.createElement('div');host.className='askbics-settings-select';host.dataset.popupMinWidth='224';
 const trigger=document.createElement('button');trigger.type='button';trigger.className='askbics-settings-select__trigger';trigger.setAttribute('aria-label',`Choose ${label.toLowerCase()} colour`);trigger.setAttribute('aria-haspopup','dialog');
 const swatch=document.createElement('span');swatch.className='askbics-colour-swatch';swatch.setAttribute('aria-hidden','true');const code=document.createElement('span');trigger.append(swatch,code);
 const popup=document.createElement('div');popup.className='askbics-settings-select__popup askbics-colour-popup';popup.hidden=true;popup.setAttribute('role','dialog');popup.setAttribute('aria-label',`${label} colour`);
 const palette=document.createElement('div');palette.className='askbics-colour-palette';
 const hex=document.createElement('input');hex.type='text';hex.maxLength=7;hex.setAttribute('aria-label',`${label} hex colour`);
 hex.autocomplete='off';hex.spellcheck=false;
 const pickerLabel=document.createElement('label');pickerLabel.className='askbics-colour-custom';pickerLabel.textContent='Custom colour';
 const picker=document.createElement('input');picker.type='color';picker.value=value;picker.setAttribute('aria-label',`${label} colour picker`);pickerLabel.append(picker);
 picker.oninput=()=>{hex.value=picker.value.toUpperCase();error.textContent='';hex.removeAttribute('aria-invalid');};
 hex.oninput=()=>{error.textContent='';hex.removeAttribute('aria-invalid');if(/^#[0-9a-f]{6}$/i.test(hex.value))picker.value=hex.value;};
 const error=document.createElement('span');error.className='askbics-colour-error';error.setAttribute('role','alert');
 const apply=document.createElement('button');apply.type='button';apply.className='askbics-settings-action';apply.textContent='Apply colour';
 const close=()=>{popup.hidden=true;trigger.setAttribute('aria-expanded','false');};
 const update=()=>{swatch.style.backgroundColor=input.value;code.textContent=input.value.toUpperCase();palette.querySelectorAll<HTMLButtonElement>('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.colour===input.value.toLowerCase())));};
 const commit=(colour:string)=>{input.value=colour.toLowerCase();update();input.dispatchEvent(new Event('change',{bubbles:true}));close();trigger.focus();};
 for(const colour of ['#10b981','#16a34a','#84cc16','#ef4444','#dc2626','#f97316','#2563eb','#0ea5e9','#7c3aed','#eab308','#64748b','#1e293b']){const button=document.createElement('button');button.type='button';button.dataset.colour=colour;button.style.backgroundColor=colour;button.setAttribute('aria-label',`Use ${colour}`);button.addEventListener('pointerdown',event=>event.preventDefault());button.onclick=()=>commit(colour);palette.append(button);}
 apply.addEventListener('pointerdown',event=>event.preventDefault());
 apply.onclick=()=>{const colour=hex.value.trim();if(!/^#[0-9a-f]{6}$/i.test(colour)){error.textContent='Enter a hex colour, for example #2563EB.';hex.setAttribute('aria-invalid','true');hex.focus();return;}commit(colour);};
 trigger.onclick=()=>{if(!popup.hidden){close();return;}hex.value=input.value.toUpperCase();error.textContent='';hex.removeAttribute('aria-invalid');popup.hidden=false;trigger.setAttribute('aria-expanded','true');palette.querySelector<HTMLButtonElement>('button')?.focus();};
 host.addEventListener('keydown',event=>{if(event.key==='Escape'&&!popup.hidden){event.preventDefault();event.stopPropagation();close();trigger.focus();}if(event.key==='Enter'&&event.target===hex){event.preventDefault();apply.click();}});
 // Native pickers temporarily take focus outside the document. Outside-pointer
 // dismissal is handled by settingsPopup; focus loss must not discard editing.
 popup.addEventListener('keydown',event=>{if(event.key!=='Escape'&&event.key!=='Enter')event.stopPropagation();});
 trigger.addEventListener('click',()=>{picker.value=input.value;});
 popup.append(palette,pickerLabel,hex,error,apply);host.append(trigger,popup);element.append(caption,host,input);settingsPopup(host,close);update();close();
 return {element,input};
}
