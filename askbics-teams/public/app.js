const conversation = document.querySelector('#conversation');
const form = document.querySelector('#ask');
const input = document.querySelector('#question');
const send = document.querySelector('#send');
const add = (tag, text, parent, className) => { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; parent.append(el); return el; };
async function ask(question) {
  if (!question.trim() || send.disabled) return;
  send.disabled = true;
  add('div', question, conversation, 'question');
  const reply = add('article', '', conversation, 'answer');
  add('small', 'askBICS · Demo', reply);
  const waiting = add('p', 'Preparing your answer…', reply);
  conversation.scrollTop = conversation.scrollHeight;
  try {
    const response = await fetch('/api/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
    const answer = await response.json(); waiting.remove();
    if (!response.ok) throw new Error(answer.error || 'The request failed.');
    add('h2', answer.title, reply); add('p', answer.context, reply);
    const table = add('table', '', reply), head = add('tr', '', add('thead', '', table));
    answer.columns.forEach(c => { const th = add('th', c, head); th.scope = 'col'; });
    const body = add('tbody', '', table);
    answer.rows.forEach(row => { const tr = add('tr', '', body); row.forEach(v => add('td', typeof v === 'number' ? v.toLocaleString() : v ?? '—', tr)); });
    add('small', `Source: ${answer.model}`, reply);
  } catch (error) { waiting.remove(); reply.classList.add('error'); add('h2', 'Let’s refine that question', reply); add('p', error.message, reply); }
  finally { send.disabled = false; input.focus(); conversation.scrollTop = conversation.scrollHeight; }
}
form.addEventListener('submit', event => { event.preventDefault(); const question = input.value; input.value = ''; void ask(question); });
document.querySelectorAll('[data-question]').forEach(button => button.addEventListener('click', () => void ask(button.dataset.question)));
