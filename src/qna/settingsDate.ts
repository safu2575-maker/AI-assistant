import { settingsPopup } from './settingsPopup';
/** Compact calendar with an explicit trigger and shared popup dismissal/positioning. */
export function settingsDate(name:string) {
 const element=document.createElement('div');element.className='askbics-settings-select askbics-settings-date';element.dataset.popupMinWidth='280';
 const input=document.createElement('input');input.type='hidden';
 const trigger=document.createElement('button');trigger.type='button';trigger.className='askbics-settings-select__trigger';trigger.setAttribute('aria-label',name);trigger.setAttribute('aria-haspopup','dialog');
 const popup=document.createElement('div');popup.className='askbics-settings-select__popup askbics-calendar';popup.hidden=true;popup.setAttribute('role','dialog');popup.setAttribute('aria-label',name+' calendar');
 const header=document.createElement('div');header.className='askbics-calendar__header';
 const month=document.createElement('select');month.setAttribute('aria-label','Calendar month');
 for(let m=0;m<12;m++){const o=document.createElement('option');o.value=String(m);o.textContent=new Date(2020,m,1).toLocaleString(undefined,{month:'long'});month.append(o);}
 const year=document.createElement('select');year.setAttribute('aria-label','Calendar year');
 for(let y=1900;y<=9999;y++){const option=document.createElement('option');option.value=String(y);option.textContent=String(y);year.append(option);}
 header.append(month,year);
 const days=document.createElement('div');days.className='askbics-calendar__days';
 const footer=document.createElement('div');footer.className='askbics-calendar__footer';
 const close=()=>{popup.hidden=true;trigger.setAttribute('aria-expanded','false');};
 const refresh=()=>{trigger.textContent=input.value?new Date(input.value+'T00:00:00').toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}):'Today (automatic)';};
 const choose=(value:string)=>{input.value=value;refresh();input.dispatchEvent(new Event('change',{bubbles:true}));close();trigger.focus();};
 const draw=()=>{days.replaceChildren();const y=Number(year.value),m=Number(month.value);if(!Number.isInteger(y)||y<1900||y>9999)return;for(const d of ['Su','Mo','Tu','We','Th','Fr','Sa']){const h=document.createElement('span');h.textContent=d;days.append(h);}for(let i=0;i<new Date(y,m,1).getDay();i++)days.append(document.createElement('span'));for(let d=1;d<=new Date(y,m+1,0).getDate();d++){const value=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const b=document.createElement('button');b.type='button';b.textContent=String(d);b.setAttribute('aria-label',value);b.setAttribute('aria-pressed',String(input.value===value));b.onpointerdown=event=>event.preventDefault();b.onclick=()=>choose(value);days.append(b);}};
 month.onchange=draw;year.onchange=draw;
 const reset=document.createElement('button');reset.type='button';reset.className='askbics-settings-action';reset.textContent='Use today automatically';reset.onclick=()=>choose('');footer.append(reset);
 trigger.onclick=()=>{if(!popup.hidden){close();return;}document.querySelectorAll('.askbics-settings-select').forEach(el=>el.dispatchEvent(new Event('askbics-close-popup')));const date=input.value?new Date(input.value+'T00:00:00'):new Date();month.value=String(date.getMonth());year.value=String(date.getFullYear());draw();popup.hidden=false;trigger.setAttribute('aria-expanded','true');month.focus();};
 element.addEventListener('keydown',event=>{if(event.key==='Escape'&&!popup.hidden){event.preventDefault();event.stopPropagation();close();trigger.focus();}});
 element.addEventListener('focusout',()=>queueMicrotask(()=>{if(!element.contains(document.activeElement))close();}));
 popup.append(header,days,footer);element.append(input,trigger,popup);settingsPopup(element,close);refresh();close();return {element,input,refresh};
}
