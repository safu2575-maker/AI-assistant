export function settingsSectionApply(page:HTMLElement,label:string,validate:()=>boolean) {
 const bar=document.createElement('div');bar.className='askbics-settings-section-apply';bar.hidden=true;
 const button=document.createElement('button');button.type='button';button.className='askbics-settings-action is-primary';button.textContent='Apply section';button.setAttribute('aria-label','Apply '+label+' section');button.title='Validate this section and keep its changes in this dialog. Save all & close saves them permanently. Cancel discards the dialog edits.';
 const status=document.createElement('span');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 bar.append(button,status);page.append(bar);
 const dirty=(event:Event)=>{const target=event.target as HTMLElement;if(target.closest('.askbics-settings-select__trigger')||target.matches('.askbics-settings-select__popup input[type=search]'))return;if(event.type==='click'&&(!target.closest('button')||target.closest('.askbics-settings-help-icon')))return;if(!bar.contains(target)){bar.hidden=false;button.hidden=false;status.textContent='Changes not applied';status.classList.remove('is-error');}};
 page.addEventListener('input',dirty);page.addEventListener('change',dirty);page.addEventListener('click',dirty);
 const apply=()=>{try{
  const invalid=Array.from(page.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea')).find(control=>!control.disabled&&!control.checkValidity());
  if(invalid){invalid.reportValidity();throw new Error(invalid.validationMessage||'Review the highlighted setting.');}
  if(!validate())throw new Error('Review the errors in this section before applying.');
  bar.hidden=false;button.hidden=true;status.textContent='Applied · not saved yet';status.classList.remove('is-error');return true;
 }catch(error){bar.hidden=false;button.hidden=false;status.textContent=(error as Error).message;status.classList.add('is-error');return false;}};
 button.onclick=apply;
 return {apply,dispose:()=>{page.removeEventListener('input',dirty);page.removeEventListener('change',dirty);page.removeEventListener('click',dirty);bar.remove();}};
}


