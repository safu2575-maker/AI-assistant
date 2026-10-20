import { settingsSelect } from './settingsSelect';
import { QnaLayoutSettings } from './types';

export function startupSettings(current: QnaLayoutSettings['startup'], fields: string[], measures: string[]) {
    const element = document.createElement('fieldset'); element.className = 'askbics-qna__config-section askbics-qna__startup-settings';
    const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = !!current?.enabled;
    const label = document.createElement('label'); label.append(enabled, 'Use a small startup query'); element.append(label);
    const help = document.createElement('p'); help.textContent = 'Choose one to three fields and one measure. Other parameter fields are requested when a question or value search needs them. Save the report after configuring this selection. Power BI controls the first host query; directly bound fields and measures cannot be unloaded by the visual. Use field and measure parameters for selective loading.'; element.append(help);
    const pick = (title: string, choices: string[], selected: string) => { const label = document.createElement('label'), select = document.createElement('select'); select.setAttribute('aria-label', title); label.style.display = 'block'; label.style.margin = '14px 0'; label.style.maxWidth = '320px'; label.append(title, select); for (const name of ['', ...new Set([...choices, ...(selected ? [selected] : [])])]) { const option = document.createElement('option'); option.value = name; option.textContent = name || 'None'; select.append(option); } select.value = selected; element.append(label); const refresh = settingsSelect(select); return { select, refresh }; };
    const groups = [0, 1, 2].map(index => pick(`Startup field ${index + 1}`, fields, current?.fields[index] || ''));
    const measure = pick('Startup measure', measures, current?.measure || '');
    const status = document.createElement('p'); status.setAttribute('role', 'status'); element.append(status);
    const update = () => [...groups, measure].forEach(picker => { picker.select.disabled = !enabled.checked; picker.refresh(); }); enabled.onchange = update; update();
    return { element, read: () => ({ enabled: enabled.checked, fields: groups.map(picker => picker.select.value).filter(Boolean), measure: measure.select.value }), validate: () => { const selected = groups.map(picker => picker.select.value).filter(Boolean); const valid = !enabled.checked || (selected.length > 0 && new Set(selected).size === selected.length && selected.every(name => fields.includes(name)) && measures.includes(measure.select.value)); status.textContent = valid ? '' : 'Choose 1–3 different available fields and one available measure.'; return valid; } };
}
