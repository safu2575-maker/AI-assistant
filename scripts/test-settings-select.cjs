const assert = require('node:assert/strict');
const { settingsSelect } = require('../.tmp/test/qna/settingsSelect');
const previousDocument = global.document;
function element() {
  return {
    children: [], attrs: {}, handlers: {}, dataset: {}, value: '',
    append(...children) { this.children.push(...children); },
    replaceChildren() { this.children = []; },
    setAttribute(key,value) { this.attrs[key] = value; },
    getAttribute(key) { return this.attrs[key]; },
    removeAttribute(key) { delete this.attrs[key]; },
    addEventListener(key,handler) { this.handlers[key] = handler; },
    contains(node) { return node === this || this.children.some(child => child.contains?.(node)); },
    focus() { global.document.activeElement = this; }
  };
}
try {
  global.document = { createElement: element, activeElement: null };
  const select = element();
  select.options = [{value:'',textContent:'Not configured'},{value:'MonthIndex',textContent:'MonthIndex'}];
  Object.defineProperty(select,'selectedOptions',{get(){return select.options.filter(option=>option.value===select.value);}});
  select.after = host => { select.host = host; };
  const changes = [];
  select.dispatchEvent = event => changes.push([event.type, select.value]);
  const refresh = settingsSelect(select);
  const [trigger,popup] = select.host.children;
  const event = () => ({preventDefault(){this.prevented=true;},stopPropagation(){}});
  trigger.onclick(event());
  const option = popup.children[1].children[1];
  const down = event(); option.handlers.pointerdown(down);
  assert.equal(down.prevented,true,'option pointerdown must not blur search before click');
  option.onclick(event());
  assert.equal(select.value,'MonthIndex');
  assert.equal(trigger.children[0].textContent,'MonthIndex');
  assert.equal(popup.hidden,true);
  assert.deepEqual(changes,[['input','MonthIndex'],['change','MonthIndex']]);
  refresh();
  assert.equal(trigger.children[0].textContent,'MonthIndex','refresh preserves selected caption');
  trigger.onclick(event()); trigger.onclick(event());
  assert.equal(popup.hidden,true,'second trigger click closes');
} finally { global.document = previousDocument; }
console.log('Settings dropdown interaction checks passed.');
