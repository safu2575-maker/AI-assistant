const $ = id => document.getElementById(id);
let session = '', model, inTeams = false, generation = 0;
const ready = microsoftTeams.app.initialize().then(() => { inTeams = true; microsoftTeams.app.notifySuccess(); }).catch(() => {});
function status(text, error = false) { $('status').textContent = text; $('status').className = error ? 'error' : ''; }
async function api(path, body = {}) {
  const response = await fetch(`/ask/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session}` } : {}) }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) { if (response.status === 401 && session) reset(); throw Error(result.error || 'Request failed.'); }
  return result;
}
function reset() { session = ''; model = undefined; generation++; $('workspace').hidden = true; $('welcome').hidden = false; $('signout').hidden = true; $('answers').replaceChildren(); $('question').value = ''; $('filter-value').value = ''; }
$('signout').onclick = async () => { try { await api('signout'); } finally { reset(); status('Signed out of the Ask tab.'); } };
$('signin').onclick = async () => {
  $('signin').disabled = true;
  let popup;
  try {
    // Open synchronously for the standalone-browser fallback to avoid popup blocking.
    if (!inTeams) popup = window.open('about:blank', 'askbics-signin', 'width=600,height=700');
    const login = await api('login');
    if (inTeams) microsoftTeams.authentication.authenticate({ url: login.url, width: 600, height: 700 }).catch(() => {});
    else if (popup) popup.location.replace(login.url); else throw Error('Allow the sign-in popup, then retry.');
    status('Complete Microsoft sign-in in the popup.');
    for (let i = 0; i < 150; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const result = await api('login-result', { state: login.state, proof: login.proof });
      if (!result.session) continue;
      session = result.session; if (popup) popup.close();
      model = await api('model');
      populate(); $('welcome').hidden = true; $('workspace').hidden = false; $('signout').hidden = false; status('Ready. Start typing a measure or use the question builder.'); return;
    }
    throw Error('Sign-in timed out. Please try again.');
  } catch (e) { status(e.message, true); } finally { $('signin').disabled = false; }
};
function option(select, name, value) { const o = document.createElement('option'); o.textContent = name; o.value = value; select.append(o); }
function populate() {
  $('model').textContent = model.name;
  for (const id of ['measure', 'dimension', 'filter-field']) $(id).replaceChildren();
  for (const m of model.measures) option($('measure'), m.name, m.name);
  option($('dimension'), 'Total (no breakdown)', ''); option($('filter-field'), 'No filter', '');
  for (const d of model.dimensions) { option($('dimension'), d.name, d.name); option($('filter-field'), d.name, d.name); }
  $('year-label').hidden = !model.hasYear;
}
function listbox(input, list) {
  let entries = [], active = -1;
  function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
  function mark() { [...list.children].forEach((e, i) => e.setAttribute('aria-selected', String(i === active))); if (active >= 0) { input.setAttribute('aria-activedescendant', list.children[active].id); list.children[active].scrollIntoView({ block: 'nearest' }); } }
  function pick(i) { if (!entries[i]) return; input.value = entries[i].value; close(); input.focus(); input.dispatchEvent(new Event('input')); }
  input.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); return; } if (list.hidden) return; if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length; mark(); } else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(active); } });
  input.addEventListener('blur', () => setTimeout(close, 150));
  return { close, show(values) { entries = values; active = -1; list.replaceChildren(); for (const [i, entry] of entries.entries()) { const li = document.createElement('li'); li.id = `${list.id}-${i}`; li.role = 'option'; li.textContent = entry.title; li.setAttribute('aria-selected', 'false'); li.onmousedown = e => { e.preventDefault(); pick(i); }; list.append(li); } list.hidden = !entries.length; input.setAttribute('aria-expanded', String(!!entries.length)); } };
}
const questions = listbox($('question'), $('suggestions')), values = listbox($('filter-value'), $('values'));
let questionTimer, valueTimer, questionSeq = 0, valueSeq = 0;
async function suggest() {
  if (!model) return;
  const seq = ++questionSeq, epoch = generation, q = $('question').value;
  const filter = /^(.*?)\s+where\s+(.+?)\s*=\s*"?([^"\n]*)$/i.exec(q);
  if (filter) {
    const field = model.dimensions.find(d => d.name.toLowerCase() === filter[2].trim().toLowerCase());
    if (!field) { questions.close(); return; }
    try { const results = await api('values', { field: field.name, search: filter[3] }); if (seq !== questionSeq || epoch !== generation || $('question').value !== q) return; questions.show(results.map(r => ({ title: `${field.name}: ${r.title}`, value: `${filter[1]} where ${field.name} = ${field.numeric ? Number(r.value) : JSON.stringify(r.value)}` }))); } catch (e) { if (seq === questionSeq) status(e.message, true); } return;
  }
  const where = /^(.*?)\s+where\s*(.*)$/i.exec(q);
  if (where) { questions.show(model.dimensions.filter(d => d.name.toLowerCase().startsWith(where[2].toLowerCase())).map(d => ({ title: d.name, value: `${where[1]} where ${d.name} = ` }))); return; }
  const candidates = model.measures.flatMap(m => [`Show total ${m.name}`, ...model.dimensions.flatMap(d => [`Show ${m.name} by ${d.name}`, `Show top 5 ${d.name} by ${m.name}`])]);
  const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const found = candidates.filter(c => words.every(w => c.toLowerCase().includes(w))).slice(0, 8);
  if (/^(show )?(total .+|.+ by .+)$/i.test(q) && !/\swhere\s/i.test(q)) found.unshift(`${q} where `);
  questions.show(found.slice(0, 8).map(c => ({ title: c, value: c })));
}
$('question').addEventListener('input', () => { questionSeq++; clearTimeout(questionTimer); questionTimer = setTimeout(suggest, 450); });
$('question').addEventListener('focus', suggest);
$('filter-field').onchange = () => { valueSeq++; clearTimeout(valueTimer); $('filter-value').value = ''; $('filter-value').disabled = !$('filter-field').value; values.close(); };
$('filter-value').addEventListener('input', () => { const seq = ++valueSeq, epoch = generation; clearTimeout(valueTimer); valueTimer = setTimeout(async () => { try { const r = await api('values', { field: $('filter-field').value, search: $('filter-value').value }); if (seq === valueSeq && epoch === generation) values.show(r); } catch(e) { status(e.message, true); } }, 500); });
async function ask(body) {
  const epoch = generation; const buttons = [...document.querySelectorAll('button[type=submit]')]; buttons.forEach(b => b.disabled = true); questions.close(); values.close(); status('Querying your Power BI model…');
  try { const answer = await api('query', body); if (epoch !== generation) return; render(answer); status('Answer ready.'); } catch(e) { status(e.message, true); } finally { buttons.forEach(b => b.disabled = false); }
}
$('question-form').onsubmit = e => { e.preventDefault(); ask({ question: $('question').value }); };
$('guided').onsubmit = e => { e.preventDefault(); ask({ measure: $('measure').value, dimension: $('dimension').value, year: $('year').value, filterField: $('filter-field').value, filterValue: $('filter-value').value }); };
function el(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
function render(answer) {
  const card = el('article'); card.append(el('h2', answer.title), el('p', answer.context, 'context'));
  const table = el('table'), head = el('tr'); answer.columns.forEach(c => head.append(el('th', c))); const thead = el('thead'); thead.append(head); table.append(thead); const tbody = el('tbody');
  answer.rows.forEach(row => { const tr = el('tr'); row.forEach(v => tr.append(el('td', typeof v === 'number' ? v.toLocaleString() : v ?? '—'))); tbody.append(tr); }); table.append(tbody);
  if (!answer.rows.length) card.append(el('p', 'No results for these selections.'));
  const wrap = el('div', undefined, 'table-scroll'); wrap.append(table); card.append(wrap);
  if (answer.columns.length === 2 && answer.rows.length && answer.rows.every(r => typeof r[1] === 'number' && r[1] >= 0)) {
    const max = Math.max(...answer.rows.map(r => r[1]), 1), chart = el('div', undefined, 'chart'); chart.setAttribute('aria-hidden', 'true');
    answer.rows.forEach(([label, value]) => { const row = el('div', undefined, 'bar-row'), track = el('div', undefined, 'bar-track'), bar = el('div', undefined, 'bar'); bar.style.width = `${value / max * 100}%`; track.append(bar); row.append(el('span', label ?? '—'), track, el('span', value.toLocaleString())); chart.append(row); }); card.append(chart);
  }
  card.append(el('p', `${answer.model} · Queried ${new Date(answer.generatedAt).toLocaleString()}`, 'context')); $('answers').prepend(card);
}
