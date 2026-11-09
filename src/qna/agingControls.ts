import {settingsSelect} from './settingsSelect';
import {settingsPopup} from './settingsPopup';
export function agingControls(view:{name:string;group:string;date:string;display:string},run:(question:string)=>void):HTMLElement {
 const controls=document.createElement('div');controls.className='askbics-aging-controls';
 const button=(title:string,path:string)=>{const b=document.createElement('button');b.type='button';b.title=title;b.setAttribute('aria-label',title);b.className='askbics-aging-icon';const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',path);svg.append(p);b.append(svg);return b;};
 let selected=view.date;let month=new Date(selected+'T12:00:00');
 const host=document.createElement('div');host.className='askbics-settings-select askbics-aging-calendar';host.dataset.popupMinWidth='224';
 const calendar=button('Select aging date','M8 3v4m8-4v4M4 10h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm2 9h2m4 0h2m-8 3h2');calendar.classList.add('askbics-settings-select__trigger');calendar.setAttribute('aria-haspopup','dialog');calendar.setAttribute('aria-expanded','false');
 const popup=document.createElement('div');popup.className='askbics-settings-select__popup askbics-aging-calendar__popup';popup.hidden=true;popup.setAttribute('role','dialog');popup.setAttribute('aria-label','Select aging date');host.append(calendar,popup);controls.append(host);
 const close=()=>{popup.hidden=true;calendar.setAttribute('aria-expanded','false');};settingsPopup(host,close);
 const iso=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 const choose=(date:string)=>{selected=date;calendar.title='As-of date: '+date;close();calendar.focus();};
 const draw=()=>{
  popup.replaceChildren();const nav=document.createElement('div');nav.className='askbics-aging-calendar__nav';
  const prev=button('Previous month','m15 5-7 7 7 7'),next=button('Next month','m9 5 7 7-7 7');const title=document.createElement('strong');title.textContent=month.toLocaleDateString(undefined,{month:'long',year:'numeric'});title.setAttribute('aria-live','polite');
  prev.onclick=()=>{month=new Date(month.getFullYear(),month.getMonth()-1,1);draw();(popup.querySelector('[aria-label="Previous month"]') as HTMLElement).focus();};next.onclick=()=>{month=new Date(month.getFullYear(),month.getMonth()+1,1);draw();(popup.querySelector('[aria-label="Next month"]') as HTMLElement).focus();};nav.append(prev,title,next);popup.append(nav);
  const grid=document.createElement('div');grid.className='askbics-aging-calendar__grid';for(const day of ['Su','Mo','Tu','We','Th','Fr','Sa']){const label=document.createElement('span');label.textContent=day;grid.append(label);}
  const first=new Date(month.getFullYear(),month.getMonth(),1);for(let i=0;i<first.getDay();i++)grid.append(document.createElement('span'));
  const count=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();for(let day=1;day<=count;day++){const value=iso(new Date(month.getFullYear(),month.getMonth(),day));const b=document.createElement('button');b.type='button';b.textContent=String(day);b.setAttribute('aria-label',value);b.setAttribute('aria-pressed',String(value===selected));b.onclick=()=>choose(value);grid.append(b);}popup.append(grid);
  const today=document.createElement('button');today.type='button';today.textContent='Today';today.onclick=()=>choose(iso(new Date()));popup.append(today);
 };
 calendar.title='As-of date: '+selected;calendar.onclick=()=>{const opening=popup.hidden;close();if(opening){month=new Date(selected+'T12:00:00');draw();popup.hidden=false;calendar.setAttribute('aria-expanded','true');(popup.querySelector('[aria-pressed="true"]') as HTMLElement)?.focus();}};
 host.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();calendar.focus();}});
 const mode=document.createElement('select');mode.setAttribute('aria-label','Aging display');for(const value of ['detailed','summary']){const o=document.createElement('option');o.value=value;o.textContent=value==='detailed'?'Detailed':'Summary';mode.append(o);}mode.value=view.display;controls.append(mode);settingsSelect(mode,false);
 const apply=button('Update aging','M20 4v6h-6M20 10a8 8 0 1 0 0 5');apply.classList.add('askbics-aging-controls__apply');apply.onclick=()=>run(`Show ${view.name} aging${view.group?` by ${view.group}`:''} as of ${selected} ${mode.value}`);controls.append(apply);return controls;
}
