import {CashSetup} from '../cashFlow';
import {settingsSelect} from './settingsSelect';
export function cashAllocationPolicy(current:CashSetup['allocationPolicy'],changed:()=>void){
 const element=document.createElement('label');element.append('Allocation policy');
 element.dataset.settingsHelp='Verified only includes fully reconciled shared groups ending at one GL, without inferring invoice pairings. Proportional estimates distribute each payment using verified complete-group destination totals. Estimates remain unverified and are labelled in results and exports. Missing or incomplete groups remain unresolved. Save and rerun cash flow to apply.';
 const select=document.createElement('select');select.setAttribute('aria-label','Allocation policy');
 for(const [value,label] of [['verified','Verified only'],['proportional','Allow proportional estimates']]){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}
 select.value=current||'verified';select.onchange=changed;element.append(select);settingsSelect(select);
 return {element,read:()=>select.value as NonNullable<CashSetup['allocationPolicy']>};
}
