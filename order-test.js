const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ORDER = fs.readFileSync(path.join(__dirname, 'order.js'), 'utf8');
const TRANSPORT = fs.readFileSync(path.join(__dirname, 'submit-order.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const BACKEND = fs.readFileSync(path.join(__dirname, 'payment-backend', 'Code.gs'), 'utf8');

const IDS = [
  'menu', 'cartBar', 'cartBarCount', 'cartBarTotal', 'cart', 'cartClose', 'stepCart',
  'cartLines', 'cartEmpty', 'cartTotal', 'cartNotice', 'cartStart', 'cartClear',
  'stepEmail', 'orderForm', 'orderName', 'orderEmail', 'orderWebsite', 'orderSubmit',
  'orderStatus', 'stepPay', 'payTotal', 'payId', 'payStatus', 'orderAgain', 'cartLive'
];
const CONFIG = {
  appsScriptUrl: 'https://script.google.com/macros/s/test-deployment/exec',
  currency: 'INR', locale: 'en-IN', maxQtyPerLine: 20, maxLines: 30,
  storageKey: 'cafecart.v1', demoMode: false
};
const MENU = [
  { category: 'Coffee', name: 'Flat White', description: '', price: 4.75, tags: [], image: '' },
  { category: 'Bakery', name: 'Croissant', description: '', price: 3.25, tags: [], image: '' }
];

function matchesOne(node, selector) {
  if (selector.charAt(0) === '[') {
    const found = /^([\w-]+)(?:=(["']?)([\s\S]*?)\2)?$/.exec(selector.slice(1, -1));
    if (!found || node.attrs[found[1]] === undefined) return false;
    return found[3] === undefined || node.attrs[found[1]] === found[3];
  }
  if (selector.charAt(0) === '.') return String(node.className || '').split(/\s+/).includes(selector.slice(1));
  return String(node.tagName).toLowerCase() === selector.toLowerCase();
}
function matches(node, selector) {
  return String(selector).split(',').map((part) => part.trim()).some((part) => matchesOne(node, part));
}
function descendants(node, found = []) {
  node.children.forEach((child) => {
    found.push(child);
    if (child.children) descendants(child, found);
  });
  return found;
}
function buildDom() {
  const byId = {};
  const document = { readyState: 'loading', activeElement: null, listeners: {} };
  const makeNode = (tag) => {
    const node = {
      tagName: String(tag), className: '', _text: '', children: [], attrs: {}, parent: null,
      hidden: false, disabled: false, value: '', type: '', listeners: {}
    };
    Object.defineProperty(node, 'textContent', {
      get() { return node._text + node.children.map((child) => child.textContent || '').join(''); },
      set(value) { node._text = String(value); node.children = []; }
    });
    node.classList = {
      add(name) { if (!matchesOne(node, '.' + name)) node.className = (node.className + ' ' + name).trim(); },
      remove(name) { node.className = node.className.split(/\s+/).filter((item) => item && item !== name).join(' '); },
      contains(name) { return node.className.split(/\s+/).includes(name); },
      toggle(name, enabled) { if (enabled) node.classList.add(name); else node.classList.remove(name); }
    };
    node.appendChild = (child) => {
      if (child.tagName === '#fragment') {
        child.children.slice().forEach((part) => node.appendChild(part));
        child.children = [];
      } else {
        child.parent = node;
        node.children.push(child);
      }
      return child;
    };
    node.setAttribute = (name, value) => { node.attrs[name] = String(value); };
    node.getAttribute = (name) => (node.attrs[name] === undefined ? null : node.attrs[name]);
    node.hasAttribute = (name) => node.attrs[name] !== undefined;
    node.addEventListener = (type, listener) => { (node.listeners[type] = node.listeners[type] || []).push(listener); };
    node.focus = () => { document.activeElement = node; };
    node.closest = (selector) => {
      let current = node;
      while (current) {
        if (matches(current, selector)) return current;
        current = current.parent;
      }
      return null;
    };
    node.querySelectorAll = (selector) => descendants(node).filter((child) => matches(child, selector));
    return node;
  };
  document.documentElement = makeNode('html');
  document.createElement = makeNode;
  document.createDocumentFragment = () => makeNode('#fragment');
  document.createTextNode = (text) => ({ textContent: String(text), children: [] });
  document.getElementById = (id) => byId[id] || null;
  document.addEventListener = (type, listener) => { (document.listeners[type] = document.listeners[type] || []).push(listener); };
  IDS.forEach((id) => { byId[id] = makeNode(id); });
  byId.orderWebsite.setAttribute('tabindex', '-1');
  byId.orderEmail.type = 'email';
  byId.cart.setAttribute('role', 'dialog');
  byId.cart.setAttribute('aria-modal', 'true');
  byId.cart.setAttribute('data-ready', 'false');
  byId.cart.hidden = true;
  byId.cartBar.hidden = true;
  byId.stepEmail.hidden = true;
  byId.stepPay.hidden = true;
  byId.cartLive.setAttribute('role', 'status');
  byId.cartLive.setAttribute('aria-live', 'polite');
  byId.orderStatus.setAttribute('role', 'status');
  byId.payStatus.setAttribute('role', 'status');
  [
    ['stepCart', ['cartEmpty', 'cartLines', 'cartNotice', 'cartTotal', 'cartStart', 'cartClear']],
    ['stepEmail', ['orderForm', 'orderStatus']],
    ['stepPay', ['payTotal', 'payId', 'payStatus', 'orderAgain']]
  ].forEach(([parent, children]) => children.forEach((id) => byId[parent].appendChild(byId[id])));
  ['orderName', 'orderEmail', 'orderWebsite', 'orderSubmit'].forEach((id) => byId.orderForm.appendChild(byId[id]));
  ['stepCart', 'stepEmail', 'stepPay'].forEach((id) => byId.cart.appendChild(byId[id]));
  return { document, byId };
}
function fakeStorage(seed) {
  const data = new Map(Object.entries(seed || {}));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key)
  };
}
async function boot(options = {}) {
  const { document, byId } = buildDom();
  const requests = [];
  const logs = { info: [], warn: [], error: [] };
  const store = options.storage || fakeStorage();
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    if (options.fetch) return options.fetch(url, init, requests.length);
    return { type: 'opaque', ok: false, status: 0 };
  };
  const sandbox = {
    Intl, Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Error,
    isFinite, parseFloat, parseInt, encodeURIComponent, decodeURIComponent, Map, Set,
    Promise, Uint8Array, setTimeout, clearTimeout, setInterval, clearInterval,
    location: { search: options.search || '' },
    navigator: { clipboard: { writeText: async () => {} } },
    console: {
      info: (...args) => logs.info.push(args),
      warn: (...args) => logs.warn.push(args),
      error: (...args) => logs.error.push(args)
    },
    document, localStorage: store, fetch: fetchImpl
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.CAFE_ORDER = Object.assign({}, CONFIG, options.config || {});
  const context = vm.createContext(sandbox);
  vm.runInContext(TRANSPORT, context, { filename: 'submit-order.js' });
  vm.runInContext(ORDER, context, { filename: 'order.js' });
  (document.listeners.DOMContentLoaded || []).forEach((listener) => listener());
  return { order: sandbox.CafeOrder, dom: byId, requests, logs, store };
}
function itemKey(order, itemName) {
  const item = MENU.find((entry) => entry.name === itemName);
  return order.itemKey(item, 0, null);
}
let failures = 0;
function check(label, condition, detail) {
  const passed = Boolean(condition);
  if (!passed) failures += 1;
  console.log((passed ? 'PASS  ' : 'FAIL  ') + label + (passed || !detail ? '' : '  -> ' + detail));
}

(async function main() {
  const cart = await boot();
  check('rupee prices convert to paise', cart.order.toPaise(4.75) === 475);
  check('email validation remains available', cart.order.isEmail('customer@example.com'));
  check('web app URL enables ordering', cart.order.orderable() === true);
  check('drawer is marked ready', cart.dom.cart.getAttribute('data-ready') === 'true');

  cart.order.setMenu(MENU);
  cart.order.add(itemKey(cart.order, 'Flat White'), 2);
  cart.order.add(itemKey(cart.order, 'Croissant'), 1);
  cart.dom.orderName.value = 'A Customer';
  cart.dom.orderEmail.value = 'customer@example.com';
  cart.order.openCart('email');
  await cart.order.submitOrder({ preventDefault() {} });

  check('one Apps Script request is sent', cart.requests.length === 1);
  check('request uses configured deployment URL', cart.requests[0].url === CONFIG.appsScriptUrl);
  check('request avoids CORS preflight', cart.requests[0].init.mode === 'no-cors');
  check('request uses text/plain content type', /text\/plain/.test(cart.requests[0].init.headers['Content-Type']));
  const payload = JSON.parse(cart.requests[0].init.body);
  check('payload includes customer details', payload.customerName === 'A Customer' && payload.customerEmail === 'customer@example.com');
  check('payload includes item quantities and unit prices', payload.items.length === 2 && payload.items[0].qty === 2 && payload.items[0].pricePaise === 475);
  check('payload total matches the cart', payload.totalPaise === 1275);
  check('payload includes a retry-safe order ID', payload.orderId === cart.order.order().id && /^ORD-/.test(payload.orderId));
  check('order moves to payment pending', cart.order.phase() === 'awaiting-payment');
  check('total and order ID remain visible', cart.dom.payTotal.textContent === '₹12.75' && cart.dom.payId.textContent === payload.orderId);
  check('customer is told to wait for payment email', /check your email.*before paying/i.test(cart.dom.payStatus.textContent));
  check('cart clears after submission', cart.order.itemCount() === 0);
  check('pending order is stored for refresh', JSON.parse(cart.store.getItem('cafecart.v1')).order.id === payload.orderId);
  check('customer can start another order', cart.dom.orderAgain.hidden === false);
  const pendingResume = await boot({ storage: cart.store });
  check('successful pending order restores in payment-pending state',
    pendingResume.order.phase() === 'awaiting-payment' && pendingResume.order.step() === 'pay');
  await cart.order.submitOrder({ preventDefault() {} });
  check('pending order is not submitted twice', cart.requests.length === 1);

  const missingName = await boot();
  missingName.order.setMenu(MENU);
  missingName.order.add(itemKey(missingName.order, 'Flat White'), 1);
  missingName.dom.orderEmail.value = 'customer@example.com';
  await missingName.order.submitOrder({ preventDefault() {} });
  check('missing name blocks submission', missingName.requests.length === 0 && /enter your name/i.test(missingName.dom.orderStatus.textContent));

  const missingEmail = await boot();
  missingEmail.order.setMenu(MENU);
  missingEmail.order.add(itemKey(missingEmail.order, 'Flat White'), 1);
  missingEmail.dom.orderName.value = 'A Customer';
  missingEmail.dom.orderEmail.value = 'not-an-email';
  await missingEmail.order.submitOrder({ preventDefault() {} });
  check('invalid email blocks submission', missingEmail.requests.length === 0 && /valid email/i.test(missingEmail.dom.orderStatus.textContent));

  const missingConfig = await boot({ config: { appsScriptUrl: '' } });
  missingConfig.order.setMenu(MENU);
  missingConfig.order.add(itemKey(missingConfig.order, 'Flat White'), 1);
  missingConfig.dom.orderName.value = 'A Customer';
  missingConfig.dom.orderEmail.value = 'customer@example.com';
  await missingConfig.order.submitOrder({ preventDefault() {} });
  check('missing deployment URL blocks sending and preserves cart', missingConfig.requests.length === 0 && missingConfig.order.itemCount() === 1);

  let retryCount = 0;
  const retry = await boot({ fetch: async () => {
    retryCount += 1;
    if (retryCount === 1) throw new Error('offline');
    return { type: 'opaque', ok: false, status: 0 };
  } });
  retry.order.setMenu(MENU);
  retry.order.add(itemKey(retry.order, 'Flat White'), 1);
  retry.dom.orderName.value = 'A Customer';
  retry.dom.orderEmail.value = 'customer@example.com';
  await retry.order.submitOrder({ preventDefault() {} });
  const retryId = retry.order.order().id;
  check('network failure retains the cart and retry ID', retry.order.phase() === 'error' && retry.order.itemCount() === 1);
  const failedResume = await boot({ storage: retry.store });
  check('failed request restores in retry state', failedResume.order.phase() === 'error' && failedResume.order.order().id === retryId);
  check('failed request restores customer details', failedResume.dom.orderName.value === 'A Customer' && failedResume.dom.orderEmail.value === 'customer@example.com');
  await retry.order.submitOrder({ preventDefault() {} });
  check('retry reuses the same order ID', JSON.parse(retry.requests[1].init.body).orderId === retryId);
  check('retry advances and clears the cart', retry.order.phase() === 'awaiting-payment' && retry.order.itemCount() === 0);

  const successfulResume = await boot({ storage: retry.store });
  check('successful retry restores as payment pending',
    successfulResume.order.phase() === 'awaiting-payment' && successfulResume.order.order().id === retryId);

  const trap = await boot();
  trap.order.setMenu(MENU);
  trap.order.add(itemKey(trap.order, 'Flat White'), 1);
  trap.dom.orderName.value = 'A Customer';
  trap.dom.orderEmail.value = 'customer@example.com';
  trap.dom.orderWebsite.value = 'bot-filled';
  await trap.order.submitOrder({ preventDefault() {} });
  check('honeypot prevents backend submission', trap.requests.length === 0);

  const demo = await boot({ search: '?demo=1' });
  demo.order.setMenu(MENU);
  demo.order.add(itemKey(demo.order, 'Croissant'), 1);
  demo.dom.orderName.value = 'A Customer';
  demo.dom.orderEmail.value = 'customer@example.com';
  await demo.order.submitOrder({ preventDefault() {} });
  check('demo flow does not contact Apps Script or claim an order was sent',
    demo.requests.length === 0 && demo.order.phase() === 'placed' && /Demo only/.test(demo.dom.payStatus.textContent));

  check('page has no EmailJS dependency or customer paid-claim button', !/@emailjs\/browser|id="claimBtn"/.test(HTML));
  check('page loads Apps Script transport and customer-name input', /src="submit-order\.js"/.test(HTML) && /id="orderName"/.test(HTML));
  check('backend validates IDs and totals', BACKEND.includes('ORDER_ID_PATTERN') && BACKEND.includes('Number(data.totalPaise) !== totalPaise'));
  check('backend throttles rapid repeat orders', BACKEND.includes('CacheService.getScriptCache') && BACKEND.includes('cache.put(cooldownKey, order.orderId, 15)'));
  check('owner link requires a deliberate confirmation form', BACKEND.includes('value="confirmPaid"') && BACKEND.includes('Confirm payment received'));

  if (failures) {
    console.error('\n' + failures + ' check(s) failed.');
    process.exitCode = 1;
  } else {
    console.log('\nall checks passed');
  }
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
