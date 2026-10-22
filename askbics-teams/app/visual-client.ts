import { GlobalQnaUi } from '../../src/qna/ui';
import { GlobalQnaEngine } from '../../src/qna/engine';
import { formatPowerBiValue } from '../../src/dataAdapter';
import { settingsSelect } from '../../src/qna/settingsSelect';
import { analysisBinding } from '../../src/analysisTemplates';
import { openConnections } from './connections-ui';
declare const microsoftTeams: any;
declare global { interface Window { askbicsTeamsReady?: Promise<boolean>; askbicsVisualReady?: boolean } }
let session = '', inTeams = false, ui: GlobalQnaUi | undefined, engine: GlobalQnaEngine, model: any;
let revision = 0, controller: AbortController | undefined, saveTimer: ReturnType<typeof setTimeout>;
let time: any = {}, dictionary = new Map<string, string[]>(), stateRevision = 0;
let stateReady = false;
let crossSelections: any[] = [];
let pendingQuestion = '';
async function openLinkedAnswer() {
  if (!await teamsReady || !microsoftTeams.app.getContext) return;
  const ctx = await microsoftTeams.app.getContext(), id = ctx.page?.subPageId;
  if (!id || sessionStorage.getItem('askbics.handoff') === id) return;
  const link = await api('handoff', { id });
  await api('select-connection', { datasetId: link.datasetId });
  pendingQuestion = link.question;
  sessionStorage.setItem('askbics.handoff', id);
}
const host = document.getElementById('visual')!, status = document.getElementById('status')!, login = document.getElementById('signin') as HTMLButtonElement;
host.classList.add('askbics-host');
window.askbicsVisualReady = true;
const teamsReady = window.askbicsTeamsReady || Promise.resolve(false);
void teamsReady.then(ready => inTeams = ready);
const rememberKey = 'askbics.remembered.v1', tabKey = 'askbics.tab-session.v1';
let remembered: { secret: string; expires: number } | undefined, resuming: Promise<void> | undefined;
try { remembered = JSON.parse(localStorage.getItem(rememberKey) || 'null') || undefined; session = sessionStorage.getItem(tabKey) || ''; } catch {}
if (remembered && remembered.expires <= Date.now()) { remembered = undefined; try { localStorage.removeItem(rememberKey); } catch {} }
function saveSession() { try { sessionStorage.setItem(tabKey, session); } catch {} }
function signedOut() {
  remembered = undefined; session = ''; clearTimeout(saveTimer); ui?.cancelQuestion?.();
  try { localStorage.removeItem(rememberKey); sessionStorage.removeItem(tabKey); } catch {}
  host.hidden = true; document.getElementById('welcome')!.hidden = false;
}
window.addEventListener('storage', e => { if (e.key === rememberKey && !e.newValue) { signedOut(); notice('You signed out in another window.'); } });
function notice(message: string) { status.textContent = message; }
function failure(message: string) { notice(message); document.getElementById('recovery')!.hidden = false; }
async function request(path: string, body: object, signal?: AbortSignal) {
  const timeout = new AbortController(), abort = () => timeout.abort();
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  const timer = setTimeout(abort, path === 'visual-query' ? 85000 : 35000);
  try {
    const response = await fetch(`/ask/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session}` } : {}) }, body: JSON.stringify(body), signal: timeout.signal });
    const result = await response.json(); return { response, result };
  } catch (e) { throw Error(timeout.signal.aborted ? 'The request timed out. Check the app server connection and retry.' : 'Could not reach askBICS. Check your connection and retry.'); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
async function resumeSession() {
  if (!remembered || remembered.expires <= Date.now()) throw Error('Please sign in again.');
  if (!resuming) resuming = (async () => {
    const { response, result } = await request('resume', { secret: remembered!.secret, datasetId: model?.datasetId });
    if (!response.ok) { if (response.status === 401) signedOut(); throw Error(result.error || 'Could not restore sign-in. Try Reload app.'); }
    session = result.session; saveSession();
  })().finally(() => resuming = undefined);
  return resuming;
}
async function api(path: string, body: object = {}, signal?: AbortSignal) {
  if (['state', 'dictionary', 'visual-query'].includes(path) && model?.datasetId) body = { ...body, datasetId: model.datasetId };
  let { response, result } = await request(path, body, signal);
  if (response.status === 401 && remembered && !['login', 'login-result', 'signout'].includes(path)) {
    await resumeSession(); ({ response, result } = await request(path, body, signal));
  }
  if (!response.ok) {
    if (response.status === 401 && session) signedOut();
    throw Error(result.error || 'The request did not complete.');
  }
  return result;
}
login.onclick = async () => {
  login.disabled = true; let popup: Window | null = null;
  try {
    // Never open a second window just because the Teams handshake is still pending.
    const embedded = window.parent !== window;
    if (embedded && !inTeams) inTeams = await Promise.race([teamsReady, new Promise<boolean>(r => setTimeout(() => r(false), 5000))]);
    if (embedded && !inTeams) throw Error('Teams has not finished opening the app. Use Reload app and try again.');
    if (!inTeams) popup = window.open('about:blank', 'askbics-signin', 'width=600,height=700');
    const auth = await api('login', { remember: (document.getElementById('remember') as HTMLInputElement)?.checked === true });
    let popupError = '';
    if (inTeams) microsoftTeams.authentication.authenticate({ url: auth.url, width: 600, height: 700 }).catch((e: any) => { popupError = String(e?.message || e || 'Sign-in window was closed.'); });
    else if (popup) popup.location.replace(auth.url); else throw Error('Allow the sign-in popup and retry.');
    notice('Complete Microsoft sign-in in the popup.');
    for (let i = 0; i < 150; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const result = await api('login-result', { state: auth.state, proof: auth.proof });
      if (!result.session) { if (popupError || popup?.closed) throw Error(popupError || 'Sign-in window was closed. Try again.'); continue; }
      session = result.session; popup?.close();
      saveSession();
      if (result.remembered) {
        remembered = result.remembered;
        try { localStorage.setItem(rememberKey, JSON.stringify(remembered)); } catch { notice('Device storage is blocked. Sign-in can only be kept in this open window.'); }
      } else { remembered = undefined; try { localStorage.removeItem(rememberKey); } catch {} }
      let warning = '';
      try { const saved = await api('connections'); if (saved.lastSelected && saved.lastSelected !== saved.selected) await api('select-connection', { datasetId: saved.lastSelected }); } catch (e) { warning = (e as Error).message; }
      await openLinkedAnswer(); model = await api('model'); await mount(); if (warning) notice(warning); return;
    }
    throw Error('Sign-in timed out. Please retry.');
  } catch (e) { popup?.close(); failure(e instanceof Error ? e.message : 'Sign-in failed.'); } finally { login.disabled = false; }
};
function context() {
  return { rowCount: 0, selectedIndices: [], fields: model.dimensions.map((d: any) => ({ key: d.name, name: d.name, values: [], uniqueValues: (dictionary.get(d.name) || []).map(label => ({ label, indices: [] })) })), measures: model.measures.map((m: any) => ({ key: m.name, name: m.name, values: [], formatHint: 'number', formatString: m.formatString })), formatValue: (m: any, value: number) => formatPowerBiValue(value, m.formatString, m.formatHint) } as any;
}
async function mount() {
  stateReady = false;
  crossSelections = [];
  document.getElementById('welcome')!.hidden = true; host.hidden = false; host.replaceChildren(); dictionary = new Map();
  time = { ...(model.time || {}) };
  engine = new GlobalQnaEngine(context());
  const scheduleSave = () => {
    if (!stateReady) return;
    const version = ++stateRevision; clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (session && version === stateRevision) void api('state', { state: { ...ui!.getState(), time } }).catch(e => notice(e.message)); }, 700);
  };
  ui = new GlobalQnaUi(host, engine, undefined, scheduleSave);
  ui.hostMode = 'teams';
  host.querySelector('.askbics-qna__input')?.addEventListener('input', scheduleSave);
  ui.automaticGroupingEnabled = () => true;
  ui.measureOptions = () => model.measures.map((m: any) => m.name);
  ui.groupingOptions = () => model.dimensions.map((d: any) => d.name);
  ui.analysisModelBinding = hierarchy => analysisBinding(model.dimensions,hierarchy);
  ui.valueOptions = () => [...dictionary].flatMap(([detail, values]) => values.map(label => ({ label, detail })));
  const loads = new Map<string, Promise<void>>();
  ui.loadSuggestionValues = async fields => {
    for (const field of fields) {
      if (dictionary.has(field)) continue;
      if (!loads.has(field)) loads.set(field, api('dictionary', { field }).then(result => {
        dictionary.set(field, result.values); engine.updateContext(context()); ui?.refreshValueSuggestions();
        if (result.limited) notice(`${field}: first 2,000 values loaded. Use an explicit field = value filter for other values.`);
      }).catch(e => { notice(e.message); }).finally(() => loads.delete(field)));
      await loads.get(field);
    }
  };
  ui.prepareQuestion = async (question, refresh) => {
    const current = revision;
    ui!.setLoadingStage('Querying your Power BI model…');
    // Saved-report dashboards may ask several questions at once. The server serializes them per session.
    const result = await api('visual-query', { question, refresh, settings: engine.getLayoutSettings(), time, selections: ui!.getState().activeView === 'conversation' ? crossSelections : [] });
    if (current !== revision) throw Error('Question cancelled.');
    return result;
  };
  ui.cancelQuestion = () => { revision++; controller?.abort(); };
  ui.timeSettings = () => time;
  ui.analysisDateFields = () => model.dimensions.filter(field => field.type === 'date').map(field => field.name);
  const controls = new Map<string, HTMLSelectElement>();
  let savedTime = { ...time };
  ui.mountTimeSettings = container => {
    container.classList.add('askbics-time-setup');
    controls.clear(); savedTime = { ...time };
    const keys = { dateField: 'Calendar date', yearField: 'Year', monthField: 'Month label', monthIndexField: 'Continuous MonthIndex' };
    for (const [key, label] of Object.entries(keys)) {
      const wrap = document.createElement('label'); wrap.textContent = label;
      const select = document.createElement('select'); select.setAttribute('aria-label', label);
      for (const name of ['', ...model.dimensions.filter((d: any) => key === 'dateField' ? d.type === 'date' : key === 'monthIndexField' ? d.numeric || d.type === 'number' : true).map((d: any) => d.name)]) { const o = document.createElement('option'); o.value = name; o.textContent = name || 'Not configured'; select.append(o); }
      select.value = time[key] || ''; select.onchange = () => { time = { ...time, [key]: select.value || undefined }; }; controls.set(key, select); wrap.append(select); container.append(wrap); settingsSelect(select);
    }
    const orderLabel = document.createElement('label'); orderLabel.textContent = 'Ambiguous numeric periods (for example 06/07)';
    const order = document.createElement('select'); order.setAttribute('aria-label', orderLabel.textContent);
    for (const [value, label] of [['auto', 'Ask for a clearer period'], ['month-year', 'Month / year → June 2007'], ['year-month', 'Year / month → July 2006']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; order.append(option); }
    order.value = time.numericOrder || 'auto'; order.onchange = () => { time.numericOrder = order.value; }; orderLabel.append(order); container.append(orderLabel); settingsSelect(order);
    const yearLabel = document.createElement('label'); yearLabel.textContent = 'Two-digit year window starts at';
    const year = document.createElement('input'); year.type = 'number'; year.min = '1900'; year.max = '9899'; year.value = String(time.twoDigitYearStart ?? 2000); year.onchange = () => { time.twoDigitYearStart = Math.max(1900, Math.min(9899, Number(year.value) || 2000)); }; yearLabel.append(year); container.append(yearLabel);
    const note = document.createElement('p'); note.textContent = 'MonthIndex must be continuous across years: January 2024 = 24289. YTD and TTM require this mapping. June 2026, Jun 26 and 06-26 use the same period parser as the Power BI visual. Ratios and averages are evaluated by the model.'; container.append(note);
  };
  ui.mountDataSettings = container => {
    const title = document.createElement('h3'); title.textContent = model.name;
    const p = document.createElement('p'); p.textContent = 'Connected using your Power BI permissions. Use Connect data in the header to add or switch models.';
    const list = document.createElement('ul'); [...model.measures.map((m: any) => `Measure: ${m.name}`), ...model.dimensions.map((d: any) => `Field: ${d.name}`)].forEach(text => { const li = document.createElement('li'); li.textContent = text; list.append(li); }); container.append(title, p, list);
  };
  ui.saveDataSettings = () => { savedTime = { ...time }; ui!.invalidateModelAnswers(); scheduleSave(); return true; };
  ui.cancelDataSettings = () => { time = { ...savedTime }; };
  const crossToggle = document.createElement('button'); crossToggle.className = 'askbics-qna__clear'; crossToggle.textContent = 'Filter other answers'; crossToggle.setAttribute('aria-pressed', 'false');
  const applyCrossFilter = (rows: any[]) => {
    if (JSON.stringify(rows) === JSON.stringify(crossSelections)) return;
    crossSelections = rows;
    const labels = rows.map(row => row.map((v: any) => `${model.dimensions.find((d: any) => d.table === v.table && d.column === v.column)?.name || v.column}: ${v.value}`).join(' + '));
    ui!.setFilterChips([...new Set(labels)], () => { ui!.clearModelSelection(); if (crossSelections.length) applyCrossFilter([]); });
    const selections = structuredClone(rows);
    ui!.refreshOtherAnswers(question => api('visual-query', { question, settings: engine.getLayoutSettings(), time, selections }), rows.length ? ui!.selectionSource : undefined);
  };
  crossToggle.onclick = () => {
    ui!.crossFilterEnabled = !ui!.crossFilterEnabled;
    crossToggle.setAttribute('aria-pressed', String(ui!.crossFilterEnabled));
    ui!.clearModelSelection(); applyCrossFilter([]);
    notice(ui!.crossFilterEnabled ? 'Select a row, value cell or chart item to filter other answers. New questions use these filters too.' : 'Cross-filtering is off.');
  };
  ui.selectModelRows = rows => { if (ui!.crossFilterEnabled) applyCrossFilter(rows); };
  host.querySelector('.askbics-qna__head-actions')?.prepend(crossToggle);
  ui.resetQuestionSelection = () => {};
  ui.downloadPdf = async (base64, filename) => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0)); const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000); return 'PDF download requested. Check your browser or Teams downloads.';
  };
  const subtitle = host.querySelector('.askbics-qna__subtitle'); if (subtitle) subtitle.textContent = model.name;
  const signout = document.createElement('button'); signout.className = 'askbics-qna__clear'; signout.textContent = 'Sign out';
  signout.onclick = async () => {
    signout.disabled = true; clearTimeout(saveTimer);
    try {
      await api('state', { state: { ...ui!.getState(), time } }).catch(() => {});
      await api('signout', { secret: remembered?.secret }); signedOut(); location.reload();
    } catch (e) { notice((e as Error).message); signout.disabled = false; }
  };
  host.querySelector('.askbics-qna__head-actions')?.append(signout);
  const connections = document.createElement('button'); connections.className = 'askbics-qna__clear'; connections.textContent = 'Connect data';
  connections.onclick = () => openConnections(api, async (action, body) => {
    clearTimeout(saveTimer);
    await api('state', { state: { ...ui!.getState(), time } });
    const result = await api(action, body);
    if (result.name) sessionStorage.setItem('askbics.connectionNotice', `Connected to ${result.name}. Your questions in Ask and personal Chat will now use this model.`);
    // A clean reload disposes the old visual's listeners and in-flight UI state.
    saveSession(); location.reload();
  });
  host.querySelector('.askbics-qna__head-actions')?.prepend(connections);
  const stored = await api('state', {});
  if (stored.state) { time = stored.state.time || time; savedTime = { ...time }; ui.restoreState(stored.state); }
  document.getElementById('recovery')!.hidden = true;
  // First-time users get a clear connection entry point without interrupting returning users.
  if (!stored.state) {
    try {
      const saved = await api('connections');
      if (!saved.lastSelected && saved.connections.every((c: any) => c.sample)) {
        const banner = document.createElement('section'); banner.className = 'connection-onboarding';
        const text = document.createElement('div'), title = document.createElement('strong'), description = document.createElement('p');
        title.textContent = 'Connect your Power BI data'; description.textContent = 'Choose a workspace and model to start exploring your own data.';
        text.append(title, description);
        const connect = document.createElement('button'); connect.className = 'askbics-qna__clear'; connect.textContent = 'Choose your data'; connect.onclick = () => connections.click();
        banner.append(text, connect); host.prepend(banner);
      }
    } catch (e) { notice((e as Error).message); }
  }
  notice('');
  if (pendingQuestion) { const question = pendingQuestion; pendingQuestion = ''; await ui.resumeLatestQuestion({ ...(stored.state || {}), questions: [question] }); }
  else if (stored.state) await ui.resumeLatestQuestion(stored.state);
  stateReady = true;
  const connectionNotice = sessionStorage.getItem('askbics.connectionNotice');
  if (connectionNotice) { sessionStorage.removeItem('askbics.connectionNotice'); notice(connectionNotice); }
}
function flushOnLeave() {
  if (!session || !ui || !stateReady) return;
  clearTimeout(saveTimer);
  const body = JSON.stringify({ state: { ...ui.getState(), time }, datasetId: model?.datasetId });
  if (new Blob([body]).size < 60000) void fetch('/ask/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` }, body, keepalive: true }).catch(() => {});
}
window.addEventListener('pagehide', flushOnLeave);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushOnLeave(); });
async function start() {
  if (!session && !remembered) return;
  login.disabled = true; notice('Restoring your workspace…');
  try {
    if (!session) await resumeSession();
    await openLinkedAnswer(); model = await api('model'); await mount();
  } catch (e) { failure((e as Error).message); }
  finally { login.disabled = false; }
}
void start();
