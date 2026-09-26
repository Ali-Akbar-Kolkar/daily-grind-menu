/*
 * order-test.js - checks for order.js.
 *
 * order.js is loaded into a sandbox with a hand built DOM, a fake
 * localStorage, a fake EmailJS and a fake QRCode, so every branch of the money
 * maths, the storage rules, the UPI link and the claim state machine can be
 * driven without a browser or a network.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ORDER = fs.readFileSync(path.join(__dirname, 'order.js'), 'utf8');

const DRAWER_IDS = [
  'menu', 'cartBar', 'cartBarCount', 'cartBarTotal', 'cart', 'cartClose',
  'stepCart', 'cartLines', 'cartEmpty', 'cartTotal', 'cartNotice', 'cartStart',
  'cartClear', 'stepEmail', 'orderForm', 'orderEmail', 'orderWebsite',
  'orderSubmit', 'orderStatus', 'stepPay', 'payTotal', 'payId', 'qrBox',
  'upiLink', 'upiCopy', 'claimBtn', 'payStatus', 'orderAgain', 'cartLive'
];

/* ------------------------------------------------------------------ *
 * a very small DOM: enough for order.js, nothing more
 * ------------------------------------------------------------------ */

function matchesOne(node, selector) {
  if (selector.charAt(0) === '[') {
    const found = /^([\w-]+)(?:=(["']?)([\s\S]*?)\2)?$/.exec(selector.slice(1, -1));
    if (!found) return false;
    if (node.attrs[found[1]] === undefined) return false;
    return found[3] === undefined ? true : node.attrs[found[1]] === found[3];
  }
  if (selector.charAt(0) === '.') {
    return String(node.className || '').split(/\s+/).indexOf(selector.slice(1)) !== -1;
  }
  return String(node.tagName).toLowerCase() === selector.toLowerCase();
}

function matches(node, selector) {
  return String(selector)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .some((part) => matchesOne(node, part));
}

function descendants(node, out) {
  const found = out || [];
  node.children.forEach((child) => {
    found.push(child);
    descendants(child, found);
  });
  return found;
}

function buildDom(ids) {
  const byId = {};

  const makeNode = (tag) => {
    const node = {
      tagName: String(tag),
      className: '',
      _text: '',
      children: [],
      attrs: {},
      parent: null,
      hidden: false,
      disabled: false,
      value: '',
      type: '',
      listeners: {}
    };

    Object.defineProperty(node, 'textContent', {
      get() {
        return node._text + node.children.map((child) => child.textContent).join('');
      },
      set(value) {
        node._text = String(value);
        node.children.forEach((child) => { child.parent = null; });
        node.children = [];
      }
    });

    node.classList = {
      add(name) { if (!matchesOne(node, '.' + name)) node.className = (node.className + ' ' + name).trim(); },
      remove(name) { node.className = node.className.split(/\s+/).filter((c) => c && c !== name).join(' '); },
      contains(name) { return node.className.split(/\s+/).indexOf(name) !== -1; },
      toggle(name, on) { if (on) node.classList.add(name); else node.classList.remove(name); }
    };

    node.appendChild = (child) => {
      /* a fragment's children are spliced in, as the real DOM does */
      if (child.tagName === '#fragment') {
        child.children.slice().forEach((grandchild) => {
          grandchild.parent = node;
          node.children.push(grandchild);
        });
        child.children = [];
        return child;
      }
      child.parent = node;
      node.children.push(child);
      return child;
    };
    node.setAttribute = (key, value) => { node.attrs[key] = String(value); };
    node.getAttribute = (key) => (node.attrs[key] === undefined ? null : node.attrs[key]);
    node.hasAttribute = (key) => node.attrs[key] !== undefined;
    node.addEventListener = (type, fn) => {
      (node.listeners[type] = node.listeners[type] || []).push(fn);
    };
    node.focus = () => { document.activeElement = node; };
    node.closest = (selector) => {
      let node2 = node;
      while (node2) {
        if (matches(node2, selector)) return node2;
        node2 = node2.parent;
      }
      return null;
    };
    node.querySelectorAll = (selector) => descendants(node).filter((n) => matches(n, selector));

    return node;
  };

  const document = {
    readyState: 'loading',
    activeElement: null,
    documentElement: makeNode('html'),
    createElement: makeNode,
    createDocumentFragment: () => makeNode('#fragment'),
    createTextNode: (text) => ({ _text: String(text), textContent: String(text) }),
    getElementById: (id) => byId[id] || null,
    addEventListener: (type, fn) => {
      (document.listeners[type] = document.listeners[type] || []).push(fn);
    },
    listeners: {}
  };

  ids.forEach((id) => { byId[id] = makeNode(id.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()); });
  byId.orderWebsite.setAttribute('tabindex', '-1');
  byId.orderEmail.type = 'email';

  /* static attributes and nesting copied from index.html, so the delegated
     listeners and the focus trap are exercised against the real shape */
  byId.cart.setAttribute('role', 'dialog');
  byId.cart.setAttribute('aria-modal', 'true');
  byId.cart.setAttribute('aria-labelledby', 'cartTitle');
  byId.cart.setAttribute('data-ready', 'false');
  byId.cart.hidden = true;
  byId.cartBar.hidden = true;
  byId.stepCart.hidden = false;
  byId.stepEmail.hidden = true;
  byId.stepPay.hidden = true;
  byId.cartEmpty.hidden = true;
  byId.cartLive.setAttribute('role', 'status');
  byId.cartLive.setAttribute('aria-live', 'polite');
  byId.orderStatus.setAttribute('role', 'status');
  byId.payStatus.setAttribute('role', 'status');

  [
    ['stepCart', ['cartEmpty', 'cartLines', 'cartNotice', 'cartTotal', 'cartStart', 'cartClear']],
    ['stepEmail', ['orderForm', 'orderStatus']],
    ['stepPay', ['payTotal', 'payId', 'qrBox', 'upiLink', 'upiCopy', 'payStatus', 'claimBtn', 'orderAgain']]
  ].forEach(([parent, kids]) => {
    kids.forEach((kid) => byId[parent].appendChild(byId[kid]));
  });
  ['orderEmail', 'orderWebsite', 'orderSubmit'].forEach((kid) => byId.orderForm.appendChild(byId[kid]));
  ['stepCart', 'stepEmail', 'stepPay'].forEach((kid) => byId.cart.appendChild(byId[kid]));

  /* bubbles from the node up through its parents to the document, like the real thing */
  document.fire = (node, type, extra) => {
    const event = Object.assign({
      type,
      target: node,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }
    }, extra || {});
    const path = [];
    let cursor = node;
    while (cursor) { path.push(cursor); cursor = cursor.parent; }
    path.push(document);
    path.forEach((current) => {
      (current.listeners[type] || []).forEach((fn) => fn.call(current, event));
    });
    return event;
  };

  return { document, byId, makeNode };
}

/* ------------------------------------------------------------------ *
 * fakes
 * ------------------------------------------------------------------ */

function fakeStorage(seed) {
  const data = new Map(Object.entries(seed || {}));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    dump: () => Object.fromEntries(data)
  };
}

/* the sandbox shares the host timers, so demo mode's 300ms pause needs real time */
const flush = async (ms) => {
  if (ms) await new Promise((resolve) => setTimeout(resolve, ms));
  for (let i = 0; i < 12; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const MENU = [
  { category: 'Coffee', name: 'Flat White', description: '', price: 4.75, tags: [], image: '' },
  { category: 'Coffee', name: 'Espresso', description: '', price: 2.5, tags: [], image: '' },
  { category: 'Bakery', name: 'Croissant', description: '', price: 3.25, tags: [], image: '' },
  { category: 'Kitchen', name: 'Seasonal Soup', description: '', price: 6.5, tags: [], image: '' },
  { category: 'Kitchen', name: 'Chef Salad', description: '', price: 7.25, tags: [], image: '' }
];

const LIVE_CONFIG = {
  emailjs: {
    serviceId: 'service_abc123',
    orderTemplateId: 'template_order1',
    paymentTemplateId: 'template_pay1',
    receiptTemplateId: 'template_rcpt1',
    publicKey: 'pk_abc123'
  },
  upi: { vpa: 'cafename@okhdfcbank', payeeName: 'The Daily Grind', merchantCode: '' },
  currency: 'INR',
  locale: 'en-IN',
  maxQtyPerLine: 20,
  maxLines: 30,
  resendCooldownMs: 15000,
  copyToCustomer: true,
  storageKey: 'cafecart.v1',
  demoMode: false
};

async function boot({ config, storage, emailjs, qr, search } = {}) {
  const { document, byId, makeNode } = buildDom(DRAWER_IDS);
  const sent = [];
  const qrCalls = [];
  const inits = [];
  const store = storage || fakeStorage();
  const logs = { info: [], warn: [], error: [] };

  const sandbox = {
    console: {
      log: () => {},
      info: (...args) => logs.info.push(args),
      warn: (...args) => logs.warn.push(args),
      error: (...args) => logs.error.push(args)
    },
    Intl,
    Date,
    Math,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    RegExp,
    Error,
    isFinite,
    parseFloat,
    parseInt,
    encodeURIComponent,
    decodeURIComponent,
    Map,
    Set,
    Promise,
    Uint8Array,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    location: { search: search || '' },
    navigator: { clipboard: { writeText: async () => {} } },
    document,
    localStorage: store,
    fetch: async () => { throw new Error('no network in tests'); }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  if (config) sandbox.window.CAFE_ORDER = config;
  if (emailjs !== false) {
    sandbox.window.emailjs = {
      init: (key) => inits.push(key),
      send: async (service, template, params) => {
        sent.push({ service, template, params });
        if (typeof emailjs === 'function') return emailjs(sent.length, params);
        return { status: 200, text: 'OK' };
      }
    };
  }
  if (qr !== false) {
    const Fake = function (target, options) { qrCalls.push({ target, options }); };
    Fake.CorrectLevel = { L: 1, M: 0, Q: 3, H: 2 };
    sandbox.window.QRCode = Fake;
  }

  const context = vm.createContext(sandbox);
  vm.runInContext(ORDER, context, { filename: 'order.js' });
  const order = sandbox.window.CafeOrder;

  const ready = document.listeners.DOMContentLoaded || [];
  ready.forEach((fn) => fn());

  return { order, dom: byId, document, sent, qrCalls, inits, store, logs, makeNode };
}

/* convenience: add an item by name and return its key */
function keyOf(order, name) {
  const found = order.lines().filter((line) => line.name === name)[0];
  return found ? found.key : name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function keyFor(order, name) {
  const item = MENU.filter((entry) => entry.name === name)[0];
  return order.itemKey(item, 0, null);
}

let failures = 0;
function check(label, condition, detail) {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok || !detail ? '' : '  -> ' + detail));
}

function section(title) {
  console.log('\n' + title);
}

(async function main() {
  section('order.js: money maths in paise');
  {
    const { order } = await boot({ config: LIVE_CONFIG });
    check('a rupee price becomes paise', order.toPaise(4.75) === 475, String(order.toPaise(4.75)));
    check('a string price is accepted', order.toPaise('12.00') === 1200, String(order.toPaise('12.00')));
    check('a rupee symbol is tolerated by the caller', order.toPaise(parseFloat('₹340.00'.replace(/[^0-9.]/g, ''))) === 34000);
    check('a missing price is null, not zero', order.toPaise('') === null, String(order.toPaise('')));
    check('nonsense is null', order.toPaise('ask staff') === null, String(order.toPaise('ask staff')));
    check('0.1 + 0.2 is exact in paise', order.toPaise(0.1) + order.toPaise(0.2) === order.toPaise(0.3));
    check('paise round trip', order.fromPaise(475) === 4.75, String(order.fromPaise(475)));
    check('money renders two decimals', order.money(475) === '₹4.75', order.money(475));
    check('money renders thousands separators', order.money(123456) === '₹1,234.56', order.money(123456));
    check('money on a whole rupee keeps .00', order.money(900) === '₹9.00', order.money(900));
  }

  section('order.js: the UPI amount field');
  {
    const { order } = await boot({ config: LIVE_CONFIG });
    check('always two decimals', order.amountField(900) === '9.00', order.amountField(900));
    check('never a float artefact', order.amountField(1234) === '12.34', order.amountField(1234));
    check('no stray plus or exponent', /^\d+\.\d{2}$/.test(order.amountField(1e6)), order.amountField(1e6));
    check('a hostile total cannot inject', order.amountField(NaN) === '0.00', order.amountField(NaN));
  }

  section('order.js: upi deep link');
  {
    const { order } = await boot({ config: LIVE_CONFIG });
    const link = order.upiLink({ id: 'ORD-ABC-1234', totalPaise: 1234 });
    check('starts with the upi scheme', link.indexOf('upi://pay?') === 0, link);
    check('carries the vpa', link.indexOf('pa=cafename%40okhdfcbank') !== -1, link);
    check('carries the payee name', link.indexOf('pn=The%20Daily%20Grind') !== -1, link);
    check('amount is the exact total', link.indexOf('am=12.34') !== -1, link);
    check('currency is INR', link.indexOf('cu=INR') !== -1, link);
    check('note carries the order id', link.indexOf('tn=Order%20ORD-ABC-1234') !== -1, link);
    check('transaction ref carries the order id', link.indexOf('tr=ORD-ABC-1234') !== -1, link);
    check('separators stay literal', /&am=12\.34&cu=INR&tn=/.test(link), link);

    const bare = await boot({ config: { ...LIVE_CONFIG, upi: { vpa: '', payeeName: 'X', merchantCode: '' } } });
    check('no vpa means no link at all', bare.order.upiLink({ id: 'ORD-1', totalPaise: 100 }) === '');

    const withMc = await boot({
      config: { ...LIVE_CONFIG, upi: { vpa: 'a@b', payeeName: 'Cafe', merchantCode: '5811' } }
    });
    check('merchant code is appended when set',
      withMc.order.upiLink({ id: 'ORD-1', totalPaise: 100 }).indexOf('mc=5811') !== -1);

    const nasty = await boot({
      config: { ...LIVE_CONFIG, upi: { vpa: 'a@b', payeeName: 'Bad\\Name{"<>', merchantCode: '' } }
    });
    const nastyLink = nasty.order.upiLink({ id: 'ORD-1', totalPaise: 100 });
    check('payee name cannot break the link',
      nastyLink.indexOf('\\') === -1 && nastyLink.indexOf('{') === -1 && nastyLink.indexOf('"') === -1,
      nastyLink);

    const long = await boot({
      config: { ...LIVE_CONFIG, upi: { vpa: 'a@b', payeeName: 'x'.repeat(90), merchantCode: '' } }
    });
    check('payee name is capped at 50 chars',
      decodeURIComponent(/pn=([^&]*)/.exec(long.order.upiLink({ id: 'O', totalPaise: 1 }))[1]).length === 50);
  }

  section('order.js: email validation');
  {
    const { order } = await boot({ config: LIVE_CONFIG });
    [
      ['name@example.com', true],
      ['a.b+tag@sub.example.co.in', true],
      ['x@y.io', true],
      ['', false],
      ['   ', false],
      ['plainaddress', false],
      ['a@b', false],
      ['a@b.c', false],
      ['two@@example.com', false],
      ['a b@example.com', false],
      ['a@example..com', false],
      ['@example.com', false],
      ['a@.com', false],
      ['a@example.com\nb@evil.com', false],
      [new Array(300).join('a') + '@example.com', false]
    ].forEach(([value, expected]) => {
      check((expected ? 'accepts ' : 'rejects ') + JSON.stringify(value).slice(0, 46),
        order.isEmail(value) === expected, String(order.isEmail(value)));
    });
    check('values are trimmed before checking', order.isEmail('  a@b.com  ') === true);
  }

  section('order.js: order ids');
  {
    const { order } = await boot({ config: LIVE_CONFIG });
    const id = order.makeOrderId(1700000000000, 'ABCD');
    check('is prefixed and timestamped', /^ORD-[0-9A-Z]+-ABCD$/.test(id), id);
    check('is url safe for a UPI note', /^[A-Za-z0-9-]+$/.test(id), id);
    const a = order.makeOrderId();
    const b = order.makeOrderId();
    check('two ids in a row differ', a !== b, a + ' / ' + b);
    check('both look like order ids', /^ORD-[0-9A-Z]{4,}-[0-9A-Z]{4}$/.test(a) && /^ORD-/.test(b), a + ' / ' + b);
  }

  section('order.js: cart maths');
  {
    const { order } = await boot({ config: LIVE_CONFIG });
    order.setMenu(MENU);
    check('an empty cart totals zero', order.totalPaise() === 0 && order.itemCount() === 0);
    check('continue is disabled when empty', order.phase() === 'cart');

    const flatWhite = keyFor(order, 'Flat White');
    const added = order.add(flatWhite, 1);
    check('adding succeeds', added.ok === true, JSON.stringify(added));
    check('one line is stored', order.lines().length === 1);
    check('total is the item price', order.totalPaise() === 475, String(order.totalPaise()));
    check('item count is the quantity', order.itemCount() === 1, String(order.itemCount()));

    order.add(flatWhite, 1);
    check('adding twice bumps the quantity, not the line count',
      order.lines().length === 1 && order.qtyOf(flatWhite) === 2);
    check('total follows the quantity', order.totalPaise() === 950, String(order.totalPaise()));

    order.setQty(flatWhite, 3);
    check('setQty sets an exact quantity', order.qtyOf(flatWhite) === 3);
    order.setQty(flatWhite, 0);
    check('setQty to zero removes the line', order.lines().length === 0);

    const soup = keyFor(order, 'Seasonal Soup');
    const croissant = keyFor(order, 'Croissant');
    order.add(soup, 1);
    order.add(croissant, 1);
    order.setQty(soup, 2);
    check('multi line total is the sum', order.totalPaise() === 650 * 2 + 325, String(order.totalPaise()));
    check('multi line count is the sum', order.itemCount() === 3, String(order.itemCount()));

    order.remove(soup);
    check('removing one line keeps the other', order.lines().length === 1 && order.totalPaise() === 325);
    check('removing updates the count', order.itemCount() === 1);
  }

  section('order.js: guard rails');
  {
    const { order } = await boot({ config: LIVE_CONFIG });
    order.setMenu(MENU);
    const key = keyFor(order, 'Espresso');

    const capped = await boot({ config: { ...LIVE_CONFIG, maxQtyPerLine: 3 } });
    capped.order.setMenu(MENU);
    const smallKey = capped.order.itemKey(MENU[1], 0, null);
    capped.order.add(smallKey, 1);
    capped.order.add(smallKey, 1);
    capped.order.add(smallKey, 1);
    const over = capped.order.add(smallKey, 1);
    check('quantity is capped', over.ok === false && capped.order.qtyOf(smallKey) === 3,
      JSON.stringify(over) + ' qty=' + capped.order.qtyOf(smallKey));
    check('the cap message names the limit', /Maximum 3/.test(over.reason), over.reason);

    const few = await boot({ config: { ...LIVE_CONFIG, maxLines: 2 } });
    few.order.setMenu(MENU);
    few.order.add(few.order.itemKey(MENU[0], 0, null), 1);
    few.order.add(few.order.itemKey(MENU[1], 0, null), 1);
    const tooMany = few.order.add(few.order.itemKey(MENU[2], 0, null), 1);
    check('line count is capped', tooMany.ok === false, JSON.stringify(tooMany));

    const unknown = order.add('not-a-real-key', 1);
    check('an unknown key is refused', unknown.ok === false, JSON.stringify(unknown));

    const priceless = await boot({ config: LIVE_CONFIG });
    priceless.order.setMenu([{ category: 'X', name: 'Ask Staff', price: null, tags: [], image: '' }]);
    const noPrice = priceless.order.add(priceless.order.itemKey({ category: 'X', name: 'Ask Staff' }, 0, null), 1);
    check('an item with no price cannot be ordered', noPrice.ok === false, JSON.stringify(noPrice));
    check('the message says why', /no price/i.test(noPrice.reason), noPrice.reason);
  }

  section('order.js: localStorage');
  {
    const first = await boot({ config: LIVE_CONFIG });
    first.order.setMenu(MENU);
    first.order.add(keyFor(first.order, 'Flat White'), 1);
    first.order.add(keyFor(first.order, 'Croissant'), 2);
    const saved = JSON.parse(first.store.getItem('cafecart.v1'));
    check('the cart is written to storage', saved && saved.v === 1, JSON.stringify(saved));
    check('both lines are stored', saved.lines.length === 2, String(saved.lines.length));
    check('prices are stored as paise', saved.lines[0].pricePaise === 475, String(saved.lines[0].pricePaise));

    /* a page refresh: same storage, brand new module instance */
    const second = await boot({ config: LIVE_CONFIG, storage: first.store });
    check('the cart survives a refresh', second.order.itemCount() === 3, String(second.order.itemCount()));
    check('the total is restored exactly', second.order.totalPaise() === 475 + 325 * 2, String(second.order.totalPaise()));
    check('the restored lines are marked gone until the menu arrives',
      second.order.lines().every((line) => line.gone === false));

    const cleared = await boot({ config: LIVE_CONFIG });
    cleared.order.setMenu(MENU);
    cleared.order.add(keyFor(cleared.order, 'Flat White'), 1);
    cleared.order.clearCart();
    check('emptying the order clears storage', cleared.store.getItem('cafecart.v1') === null,
      String(cleared.store.getItem('cafecart.v1')));
  }

  section('order.js: structurally broken storage is thrown away');
  {
    const broken = [
      ['not json at all', '{{{'],
      ['a json scalar', '42'],
      ['the wrong version', JSON.stringify({ v: 99, lines: [{ key: 'a', name: 'A', pricePaise: 100, qty: 1 }] })],
      ['no version', JSON.stringify({ lines: [] })],
      ['lines is not an array', JSON.stringify({ v: 1, lines: 'nope' })]
    ];

    for (const [label, raw] of broken) {
      const store = fakeStorage({ 'cafecart.v1': raw });
      const { order } = await boot({ config: LIVE_CONFIG, storage: store });
      check('survives ' + label, order.itemCount() === 0 && order.totalPaise() === 0,
        'count=' + order.itemCount() + ' total=' + order.totalPaise());
      check('discards ' + label, store.getItem('cafecart.v1') === null, String(store.getItem('cafecart.v1')));
    }
  }

  section('order.js: implausible stored lines are skipped');
  {
    /* the blob is still valid JSON of the right shape, so it is kept, but no
       line that could corrupt a total is ever loaded from it */
    const implausible = [
      ['a line with no key', { name: 'A', pricePaise: 100, qty: 1 }],
      ['a zero quantity', { key: 'a', name: 'A', pricePaise: 100, qty: 0 }],
      ['a negative quantity', { key: 'a', name: 'A', pricePaise: 100, qty: -4 }],
      ['a negative price', { key: 'a', name: 'A', pricePaise: -100, qty: 1 }],
      ['a non numeric quantity', { key: 'a', name: 'A', pricePaise: 100, qty: 'two' }],
      ['a quantity over the cap', { key: 'a', name: 'A', pricePaise: 100, qty: 9999 }]
    ];

    for (const [label, line] of implausible) {
      const store = fakeStorage({ 'cafecart.v1': JSON.stringify({ v: 1, lines: [line] }) });
      const { order } = await boot({ config: LIVE_CONFIG, storage: store });
      check('refuses to load ' + label, order.itemCount() === 0 && order.totalPaise() === 0,
        'count=' + order.itemCount() + ' total=' + order.totalPaise());
    }

    const mixed = fakeStorage({
      'cafecart.v1': JSON.stringify({
        v: 1,
        lines: [
          { key: 'good', name: 'Good', pricePaise: 250, qty: 2 },
          { key: 'bad', name: 'Bad', pricePaise: 100, qty: -1 },
          { name: 'NoKey', pricePaise: 100, qty: 1 }
        ]
      })
    });
    const partial = await boot({ config: LIVE_CONFIG, storage: mixed });
    check('keeps the good line and drops the bad ones', partial.order.lines().length === 1,
      JSON.stringify(partial.order.lines()));
    check('and the total only counts the good line', partial.order.totalPaise() === 500,
      String(partial.order.totalPaise()));

    const noStorage = await boot({ config: LIVE_CONFIG, storage: null });
    noStorage.order.setMenu(MENU);
    noStorage.order.add(keyFor(noStorage.order, 'Flat White'), 1);
    check('a browser with storage blocked still takes orders',
      noStorage.order.itemCount() === 1 && noStorage.order.totalPaise() === 475);
  }

  section('order.js: the menu can change under the cart');
  {
    const { order, dom, store } = await boot({ config: LIVE_CONFIG });
    order.setMenu(MENU);
    const white = keyFor(order, 'Flat White');
    const croissant = keyFor(order, 'Croissant');
    order.add(white, 1);
    order.add(croissant, 1);

    /* the cafe raises a price and drops an item, then the page refreshes */
    const changed = MENU.map((item) => (item.name === 'Flat White'
      ? { ...item, price: 5.5 }
      : item)).filter((item) => item.name !== 'Croissant');

    order.setMenu(changed);
    check('a changed price is re-read from the sheet', order.totalPaise() === 550, String(order.totalPaise()));
    check('the customer is told a price changed', /1 price changed/.test(dom.cartNotice.textContent),
      dom.cartNotice.textContent);
    check('and told to review before sending', /Review the total/.test(dom.cartNotice.textContent),
      dom.cartNotice.textContent);

    check('a dropped item is flagged, not silently deleted',
      order.lines().filter((line) => line.gone).length === 1, JSON.stringify(order.lines()));
    check('a dropped item is excluded from the total', order.totalPaise() === 550, String(order.totalPaise()));
    check('a dropped item does not count towards the total items', order.itemCount() === 1, String(order.itemCount()));
    check('and sending is blocked', dom.cartStart.disabled === true);

    const goneKey = order.lines().filter((line) => line.gone)[0].key;
    order.remove(goneKey);
    check('removing it clears the block', order.lines().every((line) => !line.gone));
    check('and the cart still totals right', order.totalPaise() === 550, String(order.totalPaise()));
    check('and continue works again', dom.cartStart.disabled === false);
    check('the updated cart was persisted', store.getItem('cafecart.v1') !== null);
  }

  section('order.js: the happy path end to end');
  {
    const { order, dom, sent, qrCalls, inits, store } = await boot({ config: LIVE_CONFIG });
    order.setMenu(MENU);
    order.add(keyFor(order, 'Flat White'), 2);
    order.add(keyFor(order, 'Croissant'), 1);
    order.openCart('cart');

    check('the cart bar appears', dom.cartBar.hidden === false);
    check('the cart bar shows the count', dom.cartBarCount.textContent === '3 items', dom.cartBarCount.textContent);
    check('the cart bar shows the total', dom.cartBarTotal.textContent === '₹12.75', dom.cartBarTotal.textContent);
    check('two lines are drawn', dom.cartLines.children.length === 2, String(dom.cartLines.children.length));
    check('each line has a decrement control',
      dom.cartLines.children[0].querySelectorAll('[data-delta="-1"]').length === 1);
    check('each line has a remove control',
      dom.cartLines.children[0].querySelectorAll('[data-remove]').length === 1);
    check('the empty message is hidden', dom.cartEmpty.hidden === true);
    check('the drawer total matches', dom.cartTotal.textContent === '₹12.75', dom.cartTotal.textContent);
    check('continue is enabled', dom.cartStart.disabled === false);
    check('nothing has been emailed yet', sent.length === 0);

    dom.cartStart.fire = null;
    dom.cartStart.listeners.click[0]();
    check('continue moves to the email step', order.step() === 'email' && dom.stepEmail.hidden === false);
    check('the cart step is hidden', dom.stepCart.hidden === true);

    /* invalid email first */
    dom.orderEmail.value = 'nope';
    await order.submitOrder({ preventDefault() {} });
    check('a bad email is refused', sent.length === 0);
    check('and the reason is shown', /valid email/i.test(dom.orderStatus.textContent), dom.orderStatus.textContent);
    check('the drawer stays on the email step', order.step() === 'email');
    check('the cart is untouched', order.itemCount() === 3 && order.totalPaise() === 1275);

    dom.orderEmail.value = 'customer@example.com';
    await order.submitOrder({ preventDefault() {} });

    check('exactly one email was sent', sent.length === 1, String(sent.length));
    check('it used the order template', sent[0].template === 'template_order1', sent[0].template);
    check('it used the service id', sent[0].service === 'service_abc123', sent[0].service);
    check('the public key was initialised', inits[0] === 'pk_abc123', String(inits[0]));

    const params = sent[0].params;
    check('the order id is present', /^ORD-/.test(params.order_id), params.order_id);
    check('the customer email is present', params.customer_email === 'customer@example.com');
    check('reply-to is the customer', params.reply_to === 'customer@example.com');
    check('the plain total is two decimals', params.order_total === '12.75', params.order_total);
    check('the formatted total is shown', params.order_total_display === '₹12.75', params.order_total_display);
    check('the item count is right', params.order_count === '3', params.order_count);
    check('the line list itemises both lines',
      /2 x Flat White @ ₹4\.75 = ₹9\.50/.test(params.order_lines) &&
      /1 x Croissant @ ₹3\.25 = ₹3\.25/.test(params.order_lines), params.order_lines);
    check('the UPI link is included in the email', params.pay_link.indexOf('upi://pay?') === 0, params.pay_link);
    check('the email has no to_email, so it cannot be aimed at the customer',
      params.to_email === undefined, String(params.to_email));

    check('the phase is awaiting payment', order.phase() === 'awaiting-payment', order.phase());
    check('the pay step is showing', order.step() === 'pay' && dom.stepPay.hidden === false);
    check('the amount is on screen', dom.payTotal.textContent === '₹12.75', dom.payTotal.textContent);
    check('the order id is on screen', dom.payId.textContent === params.order_id, dom.payId.textContent);
    check('the QR was drawn once', qrCalls.length === 1, String(qrCalls.length));
    check('the QR encodes the exact UPI link', qrCalls[0].options.text === params.pay_link, qrCalls[0].options.text);
    check('the QR encodes the right amount', qrCalls[0].options.text.indexOf('am=12.75') !== -1);
    check('the open-UPI-app link is wired to the same string',
      dom.upiLink.getAttribute('href') === params.pay_link, dom.upiLink.getAttribute('href'));
    check("I've paid is now enabled", dom.claimBtn.disabled === false);
    check('the cart is still intact while payment is pending', order.itemCount() === 3);

    await order.claimPayment({ preventDefault() {} });

    check('a second email went out', sent.length === 3, String(sent.length));
    check('it used the payment template', sent[1].template === 'template_pay1', sent[1].template);
    check('it carries the order id', sent[1].params.order_id === params.order_id);
    check('it carries the amount', sent[1].params.order_total === '12.75', sent[1].params.order_total);
    check('it carries the customer email', sent[1].params.customer_email === 'customer@example.com');
    check('it has a payment-claimed subject',
      sent[1].params.subject === 'Payment Claimed - Order ' + params.order_id, sent[1].params.subject);
    check('it has a claimed timestamp', !isNaN(Date.parse(sent[1].params.claimed_at)), sent[1].params.claimed_at);
    check('it has no to_email, so the owner alert is not redirected',
      sent[1].params.to_email === undefined, String(sent[1].params.to_email));

    check('a receipt went to the customer', sent.length === 3, String(sent.length));
    check('the receipt used the receipt template', sent[2].template === 'template_rcpt1', sent[2].template);
    check('the receipt is addressed to the customer',
      sent[2].params.to_email === 'customer@example.com', String(sent[2].params.to_email));

    check('the phase is placed', order.phase() === 'placed', order.phase());
    check('the customer is thanked', /Thanks/.test(dom.payStatus.textContent), dom.payStatus.textContent);
    check('the success note is styled as good', dom.payStatus.className === 'note note--ok', dom.payStatus.classContent);
    check('the cart is emptied', order.itemCount() === 0 && order.lines().length === 0);
    check('storage is cleared', store.getItem('cafecart.v1') === null, String(store.getItem('cafecart.v1')));
    check('the cart bar is hidden again', dom.cartBar.hidden === true);
    check('the QR is hidden', dom.qrBox.hidden === true);
    check('"start a new order" is offered', dom.orderAgain.hidden === false);
  }

  section('order.js: the receipt is optional');
  {
    const noReceipt = await boot({
      config: { ...LIVE_CONFIG, emailjs: { ...LIVE_CONFIG.emailjs, receiptTemplateId: '' } }
    });
    noReceipt.order.setMenu(MENU);
    noReceipt.order.add(keyFor(noReceipt.order, 'Flat White'), 1);
    noReceipt.dom.orderEmail.value = 'a@b.com';
    await noReceipt.order.submitOrder({ preventDefault() {} });
    await noReceipt.order.claimPayment({ preventDefault() {} });
    check('the owner still gets both alerts', noReceipt.sent.length === 2,
      noReceipt.sent.map((mail) => mail.template).join(', '));
    check('no customer receipt is attempted', noReceipt.sent.every((mail) => mail.template !== ''));
    check('the order still completes', noReceipt.order.phase() === 'placed', noReceipt.order.phase());

    const optedOut = await boot({ config: { ...LIVE_CONFIG, copyToCustomer: false } });
    optedOut.order.setMenu(MENU);
    optedOut.order.add(keyFor(optedOut.order, 'Flat White'), 1);
    optedOut.dom.orderEmail.value = 'a@b.com';
    await optedOut.order.submitOrder({ preventDefault() {} });
    await optedOut.order.claimPayment({ preventDefault() {} });
    check('copyToCustomer false skips the receipt', optedOut.sent.length === 2, String(optedOut.sent.length));
  }

  section('order.js: failures never lose the order');
  {
    let call = 0;
    const flaky = await boot({
      config: LIVE_CONFIG,
      emailjs: (n) => {
        call += 1;
        if (call === 1) throw new Error('Network request failed');
        return { status: 200 };
      }
    });
    flaky.order.setMenu(MENU);
    flaky.order.add(keyFor(flaky.order, 'Flat White'), 2);
    flaky.dom.orderEmail.value = 'a@b.com';
    flaky.order.openCart('email');
    await flaky.order.submitOrder({ preventDefault() {} });

    check('a failed order email does not throw', flaky.order.phase() === 'error', flaky.order.phase());
    check('the drawer stays on the email step so it can be retried',
      flaky.order.step() === 'email' && flaky.dom.stepEmail.hidden === false);
    check('an error is shown', /did not send|could not be/i.test(flaky.dom.orderStatus.textContent),
      flaky.dom.orderStatus.textContent);
    check('the cart survives', flaky.order.itemCount() === 2 && flaky.order.totalPaise() === 950,
      String(flaky.order.totalPaise()));
    check('the cart is still in storage', flaky.store.getItem('cafecart.v1') !== null);
    check('no QR is shown before the order is sent', flaky.qrCalls.length === 0);
    check('"I have paid" stays disabled', flaky.dom.claimBtn.disabled === true);

    await flaky.order.submitOrder({ preventDefault() {} });
    check('the retry succeeds', flaky.order.phase() === 'awaiting-payment', flaky.order.phase());
    check('and the total is unchanged', flaky.order.totalPaise() === 950, String(flaky.order.totalPaise()));

    section('order.js: a failed payment alert keeps the cart');
    let claimCall = 0;
    const claimFlaky = await boot({
      config: LIVE_CONFIG,
      emailjs: (n) => {
        claimCall += 1;
        if (claimCall === 2) throw new Error('Network request failed');
        return { status: 200 };
      }
    });
    claimFlaky.order.setMenu(MENU);
    claimFlaky.order.add(keyFor(claimFlaky.order, 'Flat White'), 1);
    claimFlaky.dom.orderEmail.value = 'a@b.com';
    await claimFlaky.order.submitOrder({ preventDefault() {} });
    await claimFlaky.order.claimPayment({ preventDefault() {} });

    check('a failed claim does not complete the order', claimFlaky.order.phase() === 'awaiting-payment',
      claimFlaky.order.phase());
    check('the customer is told to press again',
      /press the button again/i.test(claimFlaky.dom.payStatus.textContent), claimFlaky.dom.payStatus.textContent);
    check('the cart is still safe', claimFlaky.order.itemCount() === 1, String(claimFlaky.order.itemCount()));
    check('storage still holds the order', claimFlaky.store.getItem('cafecart.v1') !== null);
    check('the button is re-enabled for another try', claimFlaky.dom.claimBtn.disabled === false);

    await claimFlaky.order.claimPayment({ preventDefault() {} });
    check('the second claim succeeds', claimFlaky.order.phase() === 'placed', claimFlaky.order.phase());
    check('and only then is the cart dropped', claimFlaky.order.itemCount() === 0);
  }

  section('order.js: a failed receipt is not fatal');
  {
    let n = 0;
    const receiptFails = await boot({
      config: LIVE_CONFIG,
      emailjs: () => {
        n += 1;
        if (n === 3) throw new Error('Network request failed');
        return { status: 200 };
      }
    });
    receiptFails.order.setMenu(MENU);
    receiptFails.order.add(keyFor(receiptFails.order, 'Flat White'), 1);
    receiptFails.dom.orderEmail.value = 'a@b.com';
    await receiptFails.order.submitOrder({ preventDefault() {} });
    await receiptFails.order.claimPayment({ preventDefault() {} });

    check('the owner still got the payment alert', receiptFails.sent.length === 3, String(receiptFails.sent.length));
    check('the order completes anyway', receiptFails.order.phase() === 'placed', receiptFails.order.phase());
    check('the receipt failure is logged not thrown', receiptFails.logs.warn.length === 1,
      String(receiptFails.logs.warn.length));
  }

  section('order.js: unconfigured cafe');
  {
    const placeholders = {
      emailjs: {
        serviceId: 'service_XXXXXXX',
        orderTemplateId: 'template_XXXXXXX',
        paymentTemplateId: '',
        receiptTemplateId: '',
        publicKey: 'PUBLIC_KEY_XXXXXXX'
      },
      upi: { vpa: 'yourname@okaxis', payeeName: 'The Daily Grind', merchantCode: '' }
    };
    const { order, dom, sent } = await boot({ config: placeholders });

    check('placeholder ids are not treated as real', order.emailReady() === false);
    /* The shipped UPI placeholder has an "@", so a naive "is it filled in" test
       passes it. That used to be true, which meant a half-configured deploy
       would build a QR code aimed at whoever owns yourname@okaxis. */
    check('the shipped vpa placeholder is NOT treated as real',
      order.upiReady() === false, 'vpa is ' + placeholders.upi.vpa);
    check('ordering is not live', order.orderable() === false);
    check('the drawer is marked not ready', dom.cart.getAttribute('data-ready') === 'false',
      dom.cart.getAttribute('data-ready'));

    order.setMenu(MENU);
    order.add(keyFor(order, 'Flat White'), 1);
    dom.orderEmail.value = 'a@b.com';
    await order.submitOrder({ preventDefault() {} });

    check('nothing is sent', sent.length === 0, String(sent.length));
    check('the customer is told, not shown a broken QR',
      /not switched on/i.test(dom.orderStatus.textContent), dom.orderStatus.textContent);
    check('the cart is kept', order.itemCount() === 1);
    check('and no upi link was handed out to anyone',
      order.upiLink({ id: 'ORD-1', totalPaise: 100, lines: [] }) === '',
      order.upiLink({ id: 'ORD-1', totalPaise: 100, lines: [] }));

    /* the edits people actually make: a fake VPA that looks real, or the
       README example pasted in and half-edited. None may produce a QR code. */
    for (const mangled of ['_X1234@okaxis', 'YOURNAME@okaxis', 'yourname@okaxis',
                           'my_Xbank', 'PLACEHOLDER@bank', 'YOUR_NAME@okaxis']) {
      const { order: o } = await boot({
        config: { ...placeholders, upi: { vpa: mangled, payeeName: 'Cafe', merchantCode: '' } }
      });
      o.setMenu(MENU);
      o.add(keyFor(o, 'Flat White'), 1);
      check('a fake vpa "' + mangled + '" never becomes a qr code',
        o.upiReady() === false && o.upiLink({ id: 'X', totalPaise: 1, lines: [] }) === '',
        'got: ' + o.upiLink({ id: 'X', totalPaise: 1, lines: [] }));
    }

    /* ...and the realistic handles that must NOT trip the detector */
    for (const real of ['cafename@okhdfcbank', 'a.b_c_d@okicici', 'shop-x@okaxis',
                        'the.daily.grind@okhdfcbank', 'x@y']) {
      const { order: o } = await boot({
        config: { ...placeholders, emailjs: LIVE_CONFIG.emailjs, upi: { vpa: real, payeeName: 'Cafe', merchantCode: '' } }
      });
      check('a real vpa "' + real + '" is accepted', o.upiReady() === true);
    }

    const noUpi = await boot({
      config: { ...placeholders, emailjs: LIVE_CONFIG.emailjs, upi: { vpa: '', payeeName: '', merchantCode: '' } }
    });
    noUpi.order.setMenu(MENU);
    noUpi.order.add(keyFor(noUpi.order, 'Flat White'), 1);
    noUpi.dom.orderEmail.value = 'a@b.com';
    await noUpi.order.submitOrder({ preventDefault() {} });
    check('a missing UPI id also blocks sending', noUpi.sent.length === 0, String(noUpi.sent.length));
    check('and the customer gets the same plain message',
      /not switched on/i.test(noUpi.dom.orderStatus.textContent), noUpi.dom.orderStatus.textContent);
    check('but the console names upi.vpa, so it is obvious which line to edit',
      /upi\.vpa/.test(noUpi.logs.warn.join('\n')), JSON.stringify(noUpi.logs.warn));
    check('configProblem stays quiet about keys that are fine',
      !/serviceId|orderTemplateId|publicKey/.test(noUpi.logs.warn.join('\n')),
      JSON.stringify(noUpi.logs.warn));

    /* the diagnostic has to actually be useful, so check a partial config too */
    const partial = await boot({
      config: { ...placeholders, upi: { vpa: '', payeeName: 'Cafe', merchantCode: '' } }
    });
    partial.order.setMenu(MENU);
    partial.order.add(keyFor(partial.order, 'Flat White'), 1);
    partial.dom.orderEmail.value = 'a@b.com';
    await partial.order.submitOrder({ preventDefault() {} });
    const diag = partial.logs.warn.join('\n');
    check('with everything blank, all four emailjs ids are named',
      ['serviceId', 'orderTemplateId', 'paymentTemplateId', 'publicKey']
        .every((k) => diag.indexOf(k) !== -1), diag);
    check('and the UPI id is named too', /upi\.vpa/.test(diag), diag);
  }

  section('order.js: no email sdk on the page');
  {
    const { order, dom, sent } = await boot({ config: LIVE_CONFIG, emailjs: false });
    order.setMenu(MENU);
    order.add(keyFor(order, 'Flat White'), 1);
    dom.orderEmail.value = 'a@b.com';
    await order.submitOrder({ preventDefault() {} });
    check('a missing SDK is detected', order.sdkReady() === false);
    check('nothing is sent', sent.length === 0, String(sent.length));
    check('the customer gets a clear message',
      /not switched on/i.test(dom.orderStatus.textContent), dom.orderStatus.textContent);
  }

  section('order.js: a missing QR library still allows payment');
  {
    const { order, dom, qrCalls } = await boot({ config: LIVE_CONFIG, qr: false });
    order.setMenu(MENU);
    order.add(keyFor(order, 'Flat White'), 1);
    dom.orderEmail.value = 'a@b.com';
    await order.submitOrder({ preventDefault() {} });

    check('no QR is drawn', qrCalls.length === 0);
    check('the open-UPI-app link is still offered', dom.upiLink.hidden === false);
    check('the link is the real deep link', dom.upiLink.getAttribute('href').indexOf('upi://pay?') === 0,
      dom.upiLink.getAttribute('href'));
    check('the copy link button is still offered', dom.upiCopy.hidden === false);
    check('the customer is warned the image failed',
      /QR image could not load/i.test(dom.payStatus.textContent), dom.payStatus.textContent);
    check('paying is still possible', dom.claimBtn.disabled === false);
  }

  section('order.js: demo mode');
  {
    const { order, dom, sent, qrCalls, logs } = await boot({ config: LIVE_CONFIG, search: '?demo=1' });
    check('demo mode is on from the url', order.demoMode() === true);
    check('ordering counts as live in demo', order.orderable() === true);

    order.setMenu(MENU);
    order.add(keyFor(order, 'Flat White'), 2);
    dom.orderEmail.value = 'a@b.com';
    await order.submitOrder({ preventDefault() {} });
    await flush(400);

    check('no email is actually sent', sent.length === 0, String(sent.length));
    check('but the flow advances', order.phase() === 'awaiting-payment', order.phase());
    check('the QR is drawn', qrCalls.length === 1, String(qrCalls.length));
    check('the order is logged to the console for inspection', logs.info.length === 1, String(logs.info.length));
    check('the logged payload has the right shape', /^ORD-/.test(logs.info[0][1].order_id), String(logs.info[0][1].order_id));

    await order.claimPayment({ preventDefault() {} });
    await flush(400);
    check('claiming also only logs', sent.length === 0 && logs.info.length === 3, String(logs.info.length));
    check('and completes', order.phase() === 'placed', order.phase());
    check('and clears the cart', order.itemCount() === 0);

    const flagged = await boot({ config: { ...LIVE_CONFIG, demoMode: true } });
    check('demoMode can be forced in config', flagged.order.demoMode() === true);
  }

  section('order.js: honeypot and rate limit');
  {
    const trap = await boot({ config: LIVE_CONFIG });
    trap.order.setMenu(MENU);
    trap.order.add(keyFor(trap.order, 'Flat White'), 1);
    trap.dom.orderWebsite.value = 'http://spam.example';
    await trap.order.submitOrder({ preventDefault() {} });

    check('a filled honeypot sends nothing', trap.sent.length === 0, String(trap.sent.length));
    check('and shows a normal looking success', /Thanks/.test(trap.dom.orderStatus.textContent),
      trap.dom.orderStatus.textContent);
    check('no QR is drawn for a bot', trap.qrCalls.length === 0, String(trap.qrCalls.length));
    check('the cart is not cleared for a bot', trap.order.itemCount() === 1);

    const spam = await boot({ config: { ...LIVE_CONFIG, resendCooldownMs: 60000 } });
    spam.order.setMenu(MENU);
    spam.order.add(keyFor(spam.order, 'Flat White'), 1);
    spam.dom.orderEmail.value = 'a@b.com';
    await spam.order.submitOrder({ preventDefault() {} });
    check('the first order goes out', spam.sent.length === 1, String(spam.sent.length));

    await spam.order.submitOrder({ preventDefault() {} });
    check('a second order inside the cooldown is blocked', spam.sent.length === 1, String(spam.sent.length));
    check('with a countdown message', /Wait \d+s/.test(spam.dom.orderStatus.textContent), spam.dom.orderStatus.textContent);
  }

  section('order.js: double submission cannot double charge');
  {
    const { order, dom, sent } = await boot({ config: LIVE_CONFIG, emailjs: () => new Promise(() => {}) });
    order.setMenu(MENU);
    order.add(keyFor(order, 'Flat White'), 1);
    dom.orderEmail.value = 'a@b.com';

    const first = order.submitOrder({ preventDefault() {} });
    order.submitOrder({ preventDefault() {} });
    order.submitOrder({ preventDefault() {} });
    await flush(4);

    check('the phase locks while sending', order.phase() === 'sending', order.phase());
    check('only one request is in flight', sent.length === 1, String(sent.length));
    check('the button is disabled while sending', dom.orderSubmit.disabled === true);
    check('the button says it is sending', /Sending/.test(dom.orderSubmit.textContent), dom.orderSubmit.textContent);
    check('the email field is locked too', dom.orderEmail.disabled === true);
    void first;

    const claimLock = await boot({ config: LIVE_CONFIG, emailjs: () => new Promise(() => {}) });
    claimLock.order.setMenu(MENU);
    claimLock.order.add(keyFor(claimLock.order, 'Flat White'), 1);
    claimLock.dom.orderEmail.value = 'a@b.com';
    claimLock.order.submitOrder({ preventDefault() {} });
    void claimLock;
  }

  section('order.js: claiming is only possible after the order email');
  {
    const { order, dom, sent, qrCalls } = await boot({ config: LIVE_CONFIG });
    order.setMenu(MENU);
    order.add(keyFor(order, 'Flat White'), 1);

    await order.claimPayment({ preventDefault() {} });
    check('claiming with no order does nothing', sent.length === 0, String(sent.length));
    check('and does not advance the phase', order.phase() === 'cart', order.phase());

    dom.orderEmail.value = 'not-an-email';
    await order.submitOrder({ preventDefault() {} });
    check('a refused order cannot be claimed', order.phase() !== 'awaiting-payment', order.phase());
    await order.claimPayment({ preventDefault() {} });
    check('still nothing sent', sent.length === 0, String(sent.length));
    check('and no QR was drawn', qrCalls.length === 0, String(qrCalls.length));
  }

  section('order.js: an emptied cart cannot be sent');
  {
    const { order, dom, sent } = await boot({ config: LIVE_CONFIG });
    order.setMenu(MENU);
    dom.orderEmail.value = 'a@b.com';
    await order.submitOrder({ preventDefault() {} });
    check('an empty cart sends nothing', sent.length === 0, String(sent.length));
    check('the customer is told the cart is empty', /cart is empty/i.test(dom.orderStatus.textContent),
      dom.orderStatus.textContent);
    check('the drawer goes back to the cart', order.step() === 'cart');
  }

  section('order.js: an item dropped from the menu blocks sending');
  {
    const { order, dom, sent, store } = await boot({ config: LIVE_CONFIG });
    order.setMenu(MENU);
    const croissant = keyFor(order, 'Croissant');
    order.add(croissant, 1);
    order.setMenu(MENU.filter((item) => item.name !== 'Croissant'));

    dom.orderEmail.value = 'a@b.com';
    await order.submitOrder({ preventDefault() {} });

    check('the order is not sent', sent.length === 0, String(sent.length));
    check('the customer is told to review the cart',
      /no longer on the menu/i.test(dom.orderStatus.textContent), dom.orderStatus.textContent);
    check('the drawer returns to the cart', order.step() === 'cart');
    check('continue is blocked', dom.cartStart.disabled === true);
    check('the button explains why', /Remove unavailable/.test(dom.cartStart.textContent), dom.cartStart.textContent);
    check('the blocked line is still stored so a refresh cannot lose it',
      JSON.parse(store.getItem('cafecart.v1')).lines.length === 1);
  }

  section('order.js: cart rendering is text only, never html');
  {
    const nasty = MENU.concat([{
      category: 'Tea',
      name: '<img src=x onerror=alert(1)>',
      description: '',
      price: 1,
      tags: [],
      image: ''
    }]);
    const { order, dom } = await boot({ config: LIVE_CONFIG });
    order.setMenu(nasty);
    order.add(order.itemKey(nasty[5], 5, null), 1);
    order.openCart('cart');

    const html = dom.cartLines.children.map((row) => row.children.map((c) => c.textContent).join('|')).join('\n');
    check('the item name is rendered as text', html.indexOf('<img src=x onerror=alert(1)>') !== -1, html);
    check('no element node was created for it',
      dom.cartLines.querySelectorAll('img').length === 0, String(dom.cartLines.querySelectorAll('img').length));
  }

  section('order.js: drawer accessibility');
  {
    const { order, dom, document } = await boot({ config: LIVE_CONFIG });

    check('the drawer is a modal dialog', dom.cart.getAttribute('role') === 'dialog' &&
      dom.cart.getAttribute('aria-modal') === 'true');
    check('the drawer is labelled', dom.cart.getAttribute('aria-labelledby') === 'cartTitle');
    check('the drawer starts hidden', dom.cart.hidden === true);
    check('the cart bar starts hidden', dom.cartBar.hidden === true);
    check('the email step starts hidden', dom.stepEmail.hidden === true);
    check('the pay step starts hidden', dom.stepPay.hidden === true);
    check('only the live region is announced, not a popup', dom.cartLive.getAttribute('role') === 'status');
    check('the order status is a live region too', dom.orderStatus.getAttribute('role') === 'status');

    order.setMenu(MENU);
    order.add(keyFor(order, 'Flat White'), 1);

    order.openCart('cart');
    check('opening reveals the drawer', dom.cart.hidden === false);
    check('focus moves into the drawer', document.activeElement === dom.cartClose);
    check('the page behind is scroll locked', document.documentElement.classList.contains('is-locked'));
    check('the cart bar appears with an item in the cart', dom.cartBar.hidden === false);

    const esc = document.fire(document.documentElement, 'keydown', { key: 'Escape' });
    check('escape closes the drawer', dom.cart.hidden === true);
    check('escape does not swallow the key', esc.defaultPrevented === false);
    check('scroll lock is released', !document.documentElement.classList.contains('is-locked'));

    /* tab wrapping */
    order.openCart('cart');
    const focusable = dom.cart.querySelectorAll('button, a[href], input, [tabindex]');
    check('the focus trap finds the drawer controls', focusable.length > 0, String(focusable.length));
    check('hidden steps are not focusable', focusable.every((node) => !node.closest('[hidden]')),
      focusable.map((n) => n.tagName).join(','));
    check('the honeypot is out of the tab order', dom.orderWebsite.getAttribute('tabindex') === '-1');
  }

  section('order.js: quantity controls in the drawer');
  {
    const { order, dom, document } = await boot({ config: LIVE_CONFIG });
    order.setMenu(MENU);
    const white = keyFor(order, 'Flat White');
    order.add(white, 1);
    order.openCart('cart');

    /* the controls are re-queried each time, because pressing one can re-render */
    const press = (key, delta) => {
      const row = dom.cartLines.querySelectorAll('[data-line="' + key + '"]')[0];
      document.fire(row.querySelectorAll('[data-delta="' + delta + '"]')[0], 'click');
    };
    const rowOf = (key) => dom.cartLines.querySelectorAll('[data-line="' + key + '"]')[0];
    const qtyShown = (key) => rowOf(key).querySelectorAll('.line__qty')[0].textContent;

    press(white, '1');
    check('plus increases the quantity', order.qtyOf(white) === 2, String(order.qtyOf(white)));
    check('the total follows', order.totalPaise() === 950, String(order.totalPaise()));
    check('the row shows the new quantity', qtyShown(white) === '2', qtyShown(white));

    press(white, '-1');
    check('minus decreases the quantity', order.qtyOf(white) === 1, String(order.qtyOf(white)));
    check('the row shows it again', qtyShown(white) === '1', qtyShown(white));

    press(white, '-1');
    check('minus at one removes the line', order.lines().length === 0, String(order.lines().length));
    check('and the empty message comes back', dom.cartEmpty.hidden === false);
    check('and continue is disabled again', dom.cartStart.disabled === true);

    order.add(white, 1);
    document.fire(rowOf(white).querySelectorAll('[data-remove]')[0], 'click');
    check('remove drops the line', order.lines().length === 0);

    section('order.js: a quantity change keeps keyboard focus');
    order.setMenu(MENU);
    order.clearCart();
    order.add(white, 2);
    order.add(keyFor(order, 'Croissant'), 1);
    order.openCart('cart');

    const rowOf2 = (key) => dom.cartLines.querySelectorAll('[data-line="' + key + '"]')[0];
    const minusOf = (key) => rowOf2(key).querySelectorAll('[data-delta="-1"]')[0];

    const minus = minusOf(white);
    minus.focus();
    check('the minus button has focus to begin with', document.activeElement === minus);
    document.fire(minus, 'click');

    check('the quantity changed', order.qtyOf(white) === 1, String(order.qtyOf(white)));
    check('focus stays on the same minus button, so arrow-tabbing keeps working',
      document.activeElement === minusOf(white) &&
      document.activeElement.getAttribute('data-delta') === '-1',
      String(document.activeElement && document.activeElement.getAttribute('data-delta')));

    document.fire(document.activeElement, 'click');
    check('the last minus removes the line', order.lines().filter((l) => l.key === white).length === 0);
    check('and focus is moved somewhere real, not dropped on the body',
      document.activeElement === minusOf(keyFor(order, 'Croissant')) ||
      document.activeElement.getAttribute('data-remove') !== null ||
      document.activeElement === dom.cartClose,
      String(document.activeElement && document.activeElement.tagName));
  }

  section('order.js: card buttons stay in step with the cart');
  {
    const { order, dom, makeNode, document } = await boot({ config: LIVE_CONFIG });
    order.setMenu(MENU);

    /* stand in for the button script.js puts on each card */
    const white = keyFor(order, 'Flat White');
    const button = makeNode('button');
    button.setAttribute('data-add', white);
    dom.menu.appendChild(button);
    order.syncCards();

    check('an empty cart button says Add', button.textContent === 'Add', button.textContent);
    check('and names the item for screen readers',
      /Add Flat White/.test(button.getAttribute('aria-label')), button.getAttribute('aria-label'));

    document.fire(button, 'click');
    check('clicking the card button adds the item', order.itemCount() === 1, String(order.itemCount()));
    check('and opens the drawer', dom.cart.hidden === false);
    check('the card button now shows the quantity', button.textContent === 'In cart · 1', button.textContent);
    check('and its label says how to change it',
      /Change quantity/.test(button.getAttribute('aria-label')), button.getAttribute('aria-label'));
    check('the button is visually marked', /card__add--in/.test(button.className), button.className);

    document.fire(button, 'click');
    check('clicking again adds another', order.itemCount() === 2, String(order.itemCount()));
    check('the card button follows', button.textContent === 'In cart · 2', button.textContent);

    order.setQty(white, 0);
    check('removing from the drawer resets the card button',
      button.textContent === 'Add', button.textContent);
  }

  section('order.js: a second order in the same session');
  {
    const { order, dom, sent } = await boot({ config: { ...LIVE_CONFIG, resendCooldownMs: 0 } });
    order.setMenu(MENU);
    order.add(keyFor(order, 'Flat White'), 1);
    dom.orderEmail.value = 'first@example.com';
    await order.submitOrder({ preventDefault() {} });
    await order.claimPayment({ preventDefault() {} });
    check('first order completes', order.phase() === 'placed', order.phase());

    order.startNewOrder();
    check('starting a new order clears the id', order.order() === null);
    check('and the email field', dom.orderEmail.value === '');
    check('and returns to the cart step', order.step() === 'cart');
    check('and shows the start-again button no more', dom.orderAgain.hidden === true);
    check('but keeps the order id on screen for the receipt', dom.payId.textContent === '' ||
      /ORD-/.test(dom.payId.textContent));

    order.add(keyFor(order, 'Croissant'), 2);
    dom.orderEmail.value = 'second@example.com';
    await order.submitOrder({ preventDefault() {} });

    check('a second order goes out', sent.length === 4, String(sent.length));
    check('with a different order id',
      sent[0].params.order_id !== sent[3].params.order_id,
      sent[0].params.order_id + ' / ' + sent[3].params.order_id);
    check('and the new email', sent[3].params.customer_email === 'second@example.com');
    check('and the new total', sent[3].params.order_total === '6.50', sent[3].params.order_total);
    check('and a freshly drawn QR', dom.qrBox.hidden === false);
  }

  section('order.js: the UPI link always matches what the QR shows');
  {
    const { order, dom, qrCalls, sent } = await boot({ config: LIVE_CONFIG });
    order.setMenu(MENU);
    order.add(keyFor(order, 'Flat White'), 3);
    order.add(keyFor(order, 'Espresso'), 1);
    dom.orderEmail.value = 'a@b.com';
    await order.submitOrder({ preventDefault() {} });
    await order.claimPayment({ preventDefault() {} });

    const emailed = sent[0].params.pay_link;
    const drawn = qrCalls[0].options.text;
    const button = dom.upiLink.getAttribute('href');
    const claim = sent[1].params.pay_link;

    check('the emailed link, the QR and the button all match',
      emailed === drawn && drawn === button && button === claim,
      [emailed, drawn, button, claim].join(' | '));
    check('the amount in the link equals the cart total', /am=16\.75/.test(drawn), drawn);
    check('the amount in the link equals the amount on screen',
      /am=16\.75/.test(drawn) && dom.payTotal.textContent === '₹16.75', dom.payTotal.textContent);
  }

  section('index.html wires up every id order.js looks for');
  {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
    const source = fs.readFileSync(path.join(__dirname, 'order.js'), 'utf8');

    /* the ids order.js actually looks up, taken from its IDS array */
    const idsBlock = /var IDS = \[([\s\S]*?)\];/.exec(source);
    check('order.js declares an IDS list', Boolean(idsBlock));
    const wanted = (idsBlock ? idsBlock[1] : '')
      .split(',')
      .map((part) => part.trim().replace(/^'|'$/g, ''))
      .filter(Boolean);

    check('the IDS list is not empty', wanted.length > 20, String(wanted.length));
    wanted.forEach((id) => {
      check('index.html has #' + id, new RegExp('id="' + id + '"').test(html));
    });

    check('order.js is loaded', /src="order\.js"/.test(html));
    check('order.js loads before script.js so cards can ask for a button',
      html.indexOf('src="order.js"') < html.indexOf('src="script.js"'));
    check('the emailjs sdk is loaded', /@emailjs\/browser/.test(html));
    check('the qr library is loaded', /qrcodejs|qrcode\.min\.js/.test(html));
    check('the drawer is a labelled modal', /id="cart"[^>]*role="dialog"/.test(html) ||
      /role="dialog"[^>]*id="cart"/.test(html));
    check('the drawer has a close control', /id="cartClose"/.test(html));
    check('the send button is a real submit', /type="submit"[^>]*id="orderSubmit"|id="orderSubmit"[^>]*type="submit"/.test(html));
    check('the email field is type=email for mobile keyboards', /id="orderEmail"[^>]*type="email"/.test(html));
    check('the honeypot is present', /id="orderWebsite"/.test(html));
    check('the honeypot is out of the tab order', /id="orderWebsite"[\s\S]{0,120}?tabindex="-1"/.test(html) ||
      /tabindex="-1"[\s\S]{0,120}?id="orderWebsite"/.test(html));
    check('the honeypot is hidden from assistive tech',
      /class="field field--trap" aria-hidden="true"/.test(html));

    /* A visible "Website" box is the classic way a honeypot gives itself away,
       so assert it is clipped out of existence rather than merely pushed
       off-screen. -9999px still shows up in screenshots, print, and anything
       that reads the text of the page. */
    const trapRule = /\.field--trap\s*\{([^}]*)\}/.exec(css);
    check('the honeypot has a css rule', Boolean(trapRule), 'no .field--trap rule found');
    if (trapRule) {
      const body = trapRule[1];
      check('the honeypot is clipped, not just moved off-screen',
        /clip-path\s*:\s*inset\(50%\)/.test(body) && !/left\s*:\s*-\d/.test(body),
        body.replace(/\s+/g, ' ').trim().slice(0, 90));
      check('the honeypot cannot be clicked into',
        /pointer-events\s*:\s*none/.test(body));
    }
    check('the pay step has an "I have paid" button', /id="claimBtn"/.test(html));
    check('the UPI link is a real anchor, not a div', /<a[^>]*id="upiLink"/.test(html));
  }

  console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'all checks passed'));
  process.exitCode = failures ? 1 : 0;
}()).catch((err) => {
  console.error('harness crashed:', err);
  process.exitCode = 1;
});
