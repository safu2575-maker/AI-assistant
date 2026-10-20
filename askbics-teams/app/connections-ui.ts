type Api = (path: string, body?: any) => Promise<any>;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => { const e = document.createElement(tag); e.textContent = text; return e; };
const button = (text: string, action: () => void) => { const b = el('button', text); b.type = 'button'; b.onclick = action; return b; };
const input = (label: string, value = '') => { const i = el('input'); i.value = value; i.setAttribute('aria-label', label); return i; };
const select = (label: string, options: Array<{ id: string; name: string }>) => { const s = el('select'); s.setAttribute('aria-label', label); for (const o of options) { const option = el('option', o.name); option.value = o.id; s.append(option); } return s; };
const field = (label: string, control: HTMLElement) => { const l = el('label', label); l.append(control); return l; };
export function openConnections(api: Api, change: (action: string, body: any) => Promise<void>) {
  const dialog = el('dialog'); dialog.className = 'connections-dialog'; dialog.setAttribute('aria-label', 'Power BI connections');
  const heading = el('div'); heading.className = 'connections-heading';
  const close = button('Close', () => { dialog.close(); dialog.remove(); });
  heading.append(el('h2', 'Connect your Power BI data'), close);
  const message = el('p'); message.className = 'connections-message'; message.setAttribute('role', 'status');
  const body = el('div'); body.className = 'connections-body';
  dialog.append(heading, el('p', 'Choose your own model. Other users’ connections are not changed.'), message, body); document.body.append(dialog); dialog.showModal();
  let busy = false;
  dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); else dialog.remove(); });
  const run = async (fn: () => Promise<void>) => {
    if (busy) return; busy = true; message.textContent = 'Working…'; dialog.setAttribute('aria-busy', 'true');
    const disabled = new Map<HTMLInputElement | HTMLButtonElement | HTMLSelectElement, boolean>();
    dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('button,input,select').forEach(c => { disabled.set(c, c.disabled); c.disabled = true; });
    try { await fn(); message.textContent = ''; } catch (e) { message.textContent = e instanceof Error ? e.message : 'The connection could not complete.'; }
    finally { busy = false; dialog.removeAttribute('aria-busy'); disabled.forEach((was, c) => c.disabled = was); }
  };
  const activate = async (action: string, data: any) => { await change(action, data); dialog.close(); dialog.remove(); };
  async function home() {
    const data = await api('connections'); body.replaceChildren(el('h3', 'Your saved connections'));
    for (const c of data.connections) {
      const row = el('div'); row.className = 'connection-row';
      row.append(el('span', `${c.name}${c.datasetId === data.selected ? ' · Current' : ''}${c.sample ? ' · Demo data' : ''}`));
      if (c.datasetId === data.selected) row.append(el('strong', 'Active'));
      else row.append(button('Switch to this model', () => void run(() => activate('select-connection', { datasetId: c.datasetId }))));
      if (!c.sample) row.append(button('Remove', () => {
        if (confirm(`Remove the saved connection to ${c.name}? Your Power BI data and saved reports will not be deleted.`)) void run(() => activate('disconnect', { datasetId: c.datasetId }));
      }));
      body.append(row);
    }
    body.append(button('Connect another model', () => void run(browse)));
    body.append(el('p', 'Your active model is used for new questions in Ask and personal Chat.'));
  }
  async function browse() {
    body.replaceChildren(el('h3', 'Choose a semantic model'));
    const workspace = select('Workspace', [{ id: '', name: 'Choose a workspace' }, { id: 'me', name: 'My workspace' }]);
    const models = select('Semantic model', [{ id: '', name: 'Choose a workspace first' }]);
    const next = button('Discover fields', () => void run(async () => { if (!workspace.value || !models.value) throw Error('Choose a workspace and semantic model.'); await setup(workspace.value, models.value, models.selectedOptions[0].textContent || 'My model'); }));
    workspace.onchange = () => void run(async () => {
      models.replaceChildren(); if (!workspace.value) return;
      const data = await api('datasets', { workspaceId: workspace.value });
      for (const m of data.models) { const o = el('option', m.name); o.value = m.id; models.append(o); }
      if (!data.models.length) throw Error('No models were found here. Try another workspace or paste a model link.');
    });
    body.append(field('Workspace', workspace), field('Semantic model', models), next);
    const link = input('Power BI model link'); link.placeholder = 'https://app.powerbi.com/groups/…/modeling/…/modelView';
    body.append(el('h3', 'Or paste a Power BI model link'), field('Model link', link), button('Use model link', () => void run(async () => {
      let url: URL; try { url = new URL(link.value.trim()); } catch { throw Error('Paste the model view link from Power BI Service.'); }
      const match = /^\/groups\/([^/]+)\/(?:modeling|datasets)\/([\da-f-]{36})(?:\/|$)/i.exec(url.pathname);
      if (url.protocol !== 'https:' || url.hostname !== 'app.powerbi.com' || !match) throw Error('Open your semantic model in Power BI and copy its model view or dataset link.');
      await setup(match[1], match[2], 'My Power BI model');
    })), button('Back to saved connections', () => void run(home)));
    try {
      const data = await api('workspaces'); workspace.replaceChildren();
      for (const w of [{ id: '', name: 'Choose a workspace' }, ...data.workspaces]) { const o = el('option', w.name); o.value = w.id; workspace.append(o); }
    } catch (e) { body.append(el('p', `${(e as Error).message} You can still choose My workspace or paste a model link.`)); }
  }
  async function setup(workspaceId: string, datasetId: string, name: string) {
    let model: any;
    try { model = (await api('discover', { workspaceId, datasetId })).model; }
    catch (e) {
      body.replaceChildren(el('h3', 'Set up model fields'), el('p', (e as Error).message), el('p', 'You can enter the exact measure, table and column names from Power BI below. The app will validate them before saving.'));
      body.append(button('Enter fields manually', () => review({ name, workspaceId, datasetId, measures: [], dimensions: [] })), button('Back', () => void run(browse))); return;
    }
    review(model);
  }
  function review(model: any) {
    body.replaceChildren(el('h3', 'Review your connection'));
    const name = input('Connection name', model.name); body.append(field('Connection name', name));
    const advanced = el('details'); advanced.className = 'connection-advanced'; advanced.open = !model.measures.length; advanced.append(el('summary', 'Review fields and advanced settings'));
    const summary = el('p', `${model.measures.length} measures · ${model.dimensions.length} fields detected. Ready to connect.`); body.append(summary, advanced);
    advanced.append(el('p', 'Keep the measures and fields you want to ask about. Display names must be unique. Measures must already exist in Power BI; numeric columns are not automatically summed.'));
    const measureRows: any[] = [], dimensionRows: any[] = [];
    const measures = el('div'), dimensions = el('div'); measures.className = dimensions.className = 'connection-fields';
    const date = select('Calendar date', [{ id: '', name: 'Not configured' }]);
    const year = select('Year field', [{ id: '', name: 'Not configured' }]);
    const updateTime = () => {
      for (const [s, type] of [[date, 'date'], [year, 'number']] as const) {
        const current = s.value; s.replaceChildren(); const empty = el('option', 'Not configured'); empty.value = ''; s.append(empty);
        dimensionRows.filter(r => r.use.checked && r.type.value === type).forEach(r => { const o = el('option', r.name.value); o.value = r.name.value; s.append(o); }); s.value = current;
      }
    };
    function addMeasure(m: any = {}) {
      const row = el('div'); row.className = 'connection-field'; const use = input('Include measure'); use.type = 'checkbox'; use.checked = true;
      const name = input('Measure display name', m.name || ''), modelName = input('Power BI measure name', m.modelName || '');
      row.append(field('Use', use), field('Display name', name), field('Power BI measure name', modelName)); measures.append(row); measureRows.push({ use, name, modelName, formatString: m.formatString });
    }
    function addDimension(d: any = {}) {
      const row = el('div'); row.className = 'connection-field'; const use = input('Include field'); use.type = 'checkbox'; use.checked = true;
      const name = input('Field display name', d.name || ''), table = input('Power BI table', d.table || ''), column = input('Power BI column', d.column || '');
      const type = select('Field type', [{ id: 'text', name: 'Text' }, { id: 'number', name: 'Number' }, { id: 'date', name: 'Date' }]); type.value = d.type || 'text';
      for (const c of [use, name, type]) c.onchange = updateTime;
      row.append(field('Use', use), field('Display name', name), field('Table', table), field('Column', column), field('Type', type)); dimensions.append(row); dimensionRows.push({ use, name, table, column, type }); updateTime();
    }
    for (const m of model.measures) addMeasure(m); for (const d of model.dimensions) addDimension(d);
    advanced.append(el('h3', 'Measures'), measures, button('Add measure', () => addMeasure()), el('h3', 'Fields'), dimensions, button('Add field', () => addDimension()));
    advanced.append(el('h3', 'Time fields (optional)'), field('Calendar date', date), field('Numeric year', year));
    const dates = model.dimensions.filter((d: any) => d.type === 'date');
    const years = model.dimensions.filter((d: any) => d.type === 'number' && /^year$/i.test(d.name));
    date.value = model.time?.dateField || (dates.length === 1 ? dates[0].name : '');
    year.value = model.time?.yearField || (years.length === 1 ? years[0].name : '');
    body.append(el('p', `Time fields: ${date.value || 'date not selected'} · ${year.value || 'year not selected'}. Review advanced settings to change or resolve ambiguous fields.`));
    const search = input('Search fields'); search.placeholder = 'Search measures and fields';
    search.oninput = () => { for (const row of [...measures.children, ...dimensions.children] as HTMLElement[]) row.hidden = !Array.from(row.querySelectorAll('input')).some(i => i.value.toLowerCase().includes(search.value.toLowerCase())); };
    advanced.insertBefore(search, advanced.children[1]);
    const footer = el('div'); footer.className = 'connection-footer'; body.append(footer);
    footer.append(button('Test and connect', () => void run(async () => {
      const choice = { name: name.value, datasetId: model.datasetId, workspaceId: model.workspaceId,
        measures: measureRows.filter(r => r.use.checked).map(r => ({ name: r.name.value, modelName: r.modelName.value, formatString: r.formatString })),
        dimensions: dimensionRows.filter(r => r.use.checked).map(r => ({ name: r.name.value, table: r.table.value, column: r.column.value, type: r.type.value })),
        time: { dateField: date.value || undefined, yearField: year.value || undefined } };
      if (!choice.measures.length) throw Error('Select at least one measure.');
      await activate('connect', { model: choice });
    })), button('Back', () => void run(browse)));
  }
  void run(home);
}
