import { settingsCombobox } from "./settingsCombobox";
import { settingsSelect } from "./settingsSelect";
import { revenueChildFields } from "../revenue";
export function revenueSettings(current: { field: string; value: string; childFields?: string[] } | undefined, fields: string[], values: (field: string) => string[], load: (field: string) => Promise<string[]>) {
    const element = document.createElement('fieldset'); element.className = 'askbics-qna__config-section askbics-qna__revenue-settings';
    const field = document.createElement('select'), value = document.createElement('input'), status = document.createElement('p');
    field.setAttribute('aria-label', 'Revenue field'); value.setAttribute('aria-label', 'Revenue value'); value.placeholder = 'Type or choose a value, e.g. Revenue';
    value.value = current?.value || ''; status.setAttribute('role', 'status');
    for (const name of ['', ...new Set([...fields, ...(current?.field ? [current.field] : [])])]) { const option = document.createElement('option'); option.value = name; option.textContent = name || 'Not configured'; field.append(option); }
    field.value = current?.field || '';
    const label = (text: string, control: HTMLElement) => { const node = document.createElement('label'); node.style.display = 'flex'; node.style.flexDirection = 'column'; node.style.gap = '8px'; node.style.marginBottom = '18px'; control.style.width = '100%'; node.append(text, control); return node; };
    const children = document.createElement("fieldset");
    const selectedChildren = new Set(current ? revenueChildFields(current, fields) : []);
    const renderChildren = () => {
        children.replaceChildren(); children.hidden = !field.value;
        const title = document.createElement("legend"); title.textContent = "Accounting hierarchy children";
        const note = document.createElement("p"); note.textContent = "Exclude these row groupings and question filters from the revenue denominator. Keep dates, company, property and other independent dimensions unchecked. For LineItem, Details and GL Description are selected by default.";
        children.append(title, note);
        for (const name of fields.filter(name => name !== field.value)) {
            const row = document.createElement("label"), checkbox = document.createElement("input");
            checkbox.type = "checkbox"; checkbox.checked = selectedChildren.has(name);
            checkbox.setAttribute("aria-label", `Revenue hierarchy child: ${name}`);
            checkbox.onchange = () => { if (checkbox.checked) selectedChildren.add(name); else selectedChildren.delete(name); };
            row.append(checkbox, document.createTextNode(` ${name}`)); row.style.display = "block"; row.style.margin = "8px 0"; children.append(row);
        }
    };
    const help = document.createElement('p'); help.textContent = 'Ask “Amount by Line Item as percentage of revenue”. The denominator uses the configured revenue value without accounting-child restrictions. Period and unrelated filters are retained. Missing or zero revenue displays —. Clear the field to disable this setting.';
    const refresh = async () => { const selected = field.value; value.disabled = !selected; picker.update([]); if (!selected) return; const fill = (items: string[]) => { picker.update(items); }; fill(values(selected)); try { const items = await load(selected); if (field.value === selected) fill([...values(selected), ...items]); } catch { if (field.value === selected) status.textContent = 'Values could not be loaded. You can still enter the exact revenue value.'; } };
    field.onchange = () => { value.value = ''; status.textContent = ''; selectedChildren.clear(); revenueChildFields({field: field.value}, fields).forEach(name => selectedChildren.add(name)); renderChildren(); void refresh(); };
    element.append(label('Revenue field', field), label('Revenue value', value), children, help, status); renderChildren(); settingsSelect(field); const picker = settingsCombobox(value); void refresh();
    return { element, read: () => field.value ? { field: field.value, value: value.value.trim(), ...(selectedChildren.size || revenueChildFields({field:field.value},fields).length ? {childFields:[...selectedChildren]} : {}) } : undefined, validate: () => { const valid = !field.value || (fields.includes(field.value) && !!value.value.trim()); status.textContent = valid ? '' : 'Choose an available field and enter its revenue value.'; return valid; } };
}
