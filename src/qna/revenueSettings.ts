import { settingsCombobox } from "./settingsCombobox";
import { settingsSelect } from "./settingsSelect";
export function revenueSettings(current: { field: string; value: string } | undefined, fields: string[], values: (field: string) => string[], load: (field: string) => Promise<string[]>) {
    const element = document.createElement('fieldset'); element.className = 'askbics-qna__config-section askbics-qna__revenue-settings';
    const field = document.createElement('select'), value = document.createElement('input'), status = document.createElement('p');
    field.setAttribute('aria-label', 'Revenue field'); value.setAttribute('aria-label', 'Revenue value'); value.placeholder = 'Type or choose a value, e.g. Revenue';
    value.value = current?.value || ''; status.setAttribute('role', 'status');
    for (const name of ['', ...new Set([...fields, ...(current?.field ? [current.field] : [])])]) { const option = document.createElement('option'); option.value = name; option.textContent = name || 'Not configured'; field.append(option); }
    field.value = current?.field || '';
    const label = (text: string, control: HTMLElement) => { const node = document.createElement('label'); node.style.display = 'flex'; node.style.flexDirection = 'column'; node.style.gap = '8px'; node.style.marginBottom = '18px'; control.style.width = '100%'; node.append(text, control); return node; };
    const help = document.createElement('p'); help.textContent = 'Ask “Amount by Line Item as percentage of revenue”. Other filters are retained. Missing or zero revenue displays —. Clear the field to disable this setting.';
    const refresh = async () => { const selected = field.value; value.disabled = !selected; picker.update([]); if (!selected) return; const fill = (items: string[]) => { picker.update(items); }; fill(values(selected)); try { const items = await load(selected); if (field.value === selected) fill([...values(selected), ...items]); } catch { if (field.value === selected) status.textContent = 'Values could not be loaded. You can still enter the exact revenue value.'; } };
    field.onchange = () => { value.value = ''; status.textContent = ''; void refresh(); };
    element.append(label('Revenue field', field), label('Revenue value', value), help, status); settingsSelect(field); const picker = settingsCombobox(value); void refresh();
    return { element, read: () => field.value ? { field: field.value, value: value.value.trim() } : undefined, validate: () => { const valid = !field.value || (fields.includes(field.value) && !!value.value.trim()); status.textContent = valid ? '' : 'Choose an available field and enter its revenue value.'; return valid; } };
}
