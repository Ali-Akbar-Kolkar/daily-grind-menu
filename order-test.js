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
  'orderPhone', 'whatsappOptIn',
  'orderStatus', 'stepPay', 'payTotal', 'payId', 'payStatus', 'paymentPageLink', 'whatsappOrder',
  'upiPayment', 'upiOpen', 'upiQrDisplay', 'upiQr', 'upiQrDownload', 'upiQrDownloadStatus',
  'upiQrFallback', 'upiAmount', 'upiOrderId',
  'upiIdText', 'upiCopy', 'upiCopyStatus', 'orderAgain', 'cartLive',
  'profileEdit', 'profileDialog', 'profileForm', 'profileName', 'profileEmail',
  'profilePhone', 'profileStatus', 'profileSkip', 'profileForget'
];
const CONFIG = {
  appsScriptUrl: 'https://script.google.com/macros/s/test-deployment/exec',
  whatsappNumber: '919876543210',
  upiId: '6363728679-3@ybl',
  payeeName: 'The Daily Grind',
  cafeName: 'The Daily Grind',
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
        child.parentNode = node;
        child.parent = node;
        node.children.push(child);
      }
      return child;
    };
    node.removeChild = (child) => {
      node.children = node.children.filter((entry) => entry !== child);
      child.parentNode = null;
      return child;
    };
    node.select = () => {};
    node.remove = () => {
      if (node.parentNode) node.parentNode.removeChild(node);
    };
    node.setAttribute = (name, value) => { node.attrs[name] = String(value); };
    Object.defineProperty(node, 'innerHTML', {
      get() { return node._html || ''; },
      set(value) { node._html = String(value); node.children = []; }
    });
    node.getAttribute = (name) => (node.attrs[name] === undefined ? null : node.attrs[name]);
    node.hasAttribute = (name) => node.attrs[name] !== undefined;
    node.addEventListener = (type, listener) => { (node.listeners[type] = node.listeners[type] || []).push(listener); };
    node.focus = () => { document.activeElement = node; };
    node.showModal = () => { node.open = true; };
    node.close = () => { node.open = false; };
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
  document.body = makeNode('body');
  document.createElement = (tag) => {
    const node = makeNode(tag);
    if (String(tag).toLowerCase() === 'canvas') {
      node.getContext = () => ({
        fillRect() {},
        drawImage() {},
        set fillStyle(value) { node._fillStyle = value; }
      });
      node.toDataURL = (type) => type === 'image/jpeg' ? 'data:image/jpeg;base64,VEVTVA==' : 'data:,';
    }
    return node;
  };
  document.createDocumentFragment = () => makeNode('#fragment');
  document.createTextNode = (text) => ({ textContent: String(text), children: [] });
  document.getElementById = (id) => byId[id] || null;
  document.addEventListener = (type, listener) => { (document.listeners[type] = document.listeners[type] || []).push(listener); };
  document.execCommand = () => true;
  IDS.forEach((id) => { byId[id] = makeNode(id); });
  byId.orderWebsite.setAttribute('tabindex', '-1');
  byId.orderEmail.type = 'email';
  byId.whatsappOptIn.checked = false;
  byId.cart.setAttribute('role', 'dialog');
  byId.cart.setAttribute('aria-modal', 'true');
  byId.cart.setAttribute('data-ready', 'false');
  byId.cart.hidden = true;
  byId.cartBar.hidden = true;
  byId.stepEmail.hidden = true;
  byId.stepPay.hidden = true;
  byId.cartLive.setAttribute('role', 'status');
  byId.cartLive.setAttribute('aria-live', 'polite');
  byId.profileDialog.open = false;
  byId.orderStatus.setAttribute('role', 'status');
  byId.payStatus.setAttribute('role', 'status');
  [
    ['stepCart', ['cartEmpty', 'cartLines', 'cartNotice', 'cartTotal', 'cartStart', 'cartClear']],
    ['stepEmail', ['orderForm', 'orderStatus']],
    ['stepPay', ['payTotal', 'payId', 'payStatus', 'paymentPageLink', 'whatsappOrder', 'upiPayment', 'orderAgain']]
  ].forEach(([parent, children]) => children.forEach((id) => byId[parent].appendChild(byId[id])));
  ['upiOpen', 'upiQrDisplay', 'upiQrDownload', 'upiQrDownloadStatus', 'upiQrFallback', 'upiAmount',
    'upiOrderId', 'upiIdText', 'upiCopy', 'upiCopyStatus']
    .forEach((id) => byId.upiPayment.appendChild(byId[id]));
  byId.upiQrDisplay.appendChild(byId.upiQr);
  ['orderName', 'orderEmail', 'orderPhone', 'whatsappOptIn', 'orderWebsite', 'orderSubmit']
    .forEach((id) => byId.orderForm.appendChild(byId[id]));
  ['profileName', 'profileEmail', 'profilePhone', 'profileStatus', 'profileSkip', 'profileForget']
    .forEach((id) => byId.profileForm.appendChild(byId[id]));
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
  const clipboardWrites = [];
  let copyCommands = 0;
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
    Image: function () {
      Object.defineProperty(this, 'src', {
        set(value) {
          this._src = value;
          if (options.jpeg === false) {
            if (this.onerror) this.onerror(new Error('Image conversion unavailable'));
          } else if (this.onload) {
            this.onload();
          }
        },
        get() { return this._src; }
      });
    },
    navigator: {
      clipboard: options.clipboard === false ? null : {
        writeText: async (text) => {
          if (options.clipboard === 'reject') throw new Error('Clipboard unavailable');
          clipboardWrites.push(text);
        }
      }
    },
    console: {
      info: (...args) => logs.info.push(args),
      warn: (...args) => logs.warn.push(args),
      error: (...args) => logs.error.push(args)
    },
    document, localStorage: store, fetch: fetchImpl,
    qrcode: options.qrcode === undefined
      ? function () {
        return {
          addData(data) { this.data = data; },
          make() {},
          createSvgTag() { return '<svg><path /></svg>'; }
        };
      }
      : options.qrcode
  };
  document.execCommand = (command) => {
    if (command === 'copy') copyCommands += 1;
    return command === 'copy';
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.CAFE_ORDER = Object.assign({}, CONFIG, options.config || {});
  const context = vm.createContext(sandbox);
  vm.runInContext(TRANSPORT, context, { filename: 'submit-order.js' });
  vm.runInContext(ORDER, context, { filename: 'order.js' });
  (document.listeners.DOMContentLoaded || []).forEach((listener) => listener());
  return { order: sandbox.CafeOrder, dom: byId, document, requests, logs, store, clipboardWrites, copyCommands: () => copyCommands };
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
  check('WhatsApp phone validation requires E.164 format',
    cart.order.isWhatsAppPhone('+919876543210') && !cart.order.isWhatsAppPhone('9876543210'));
  check('Indian mobile numbers normalize to +91 E.164',
    cart.order.normalizePhone('9876543210') === '+919876543210' &&
    cart.order.normalizePhone('91 98765 43210') === '+919876543210' &&
    cart.order.normalizePhone('+91 98765-43210') === '+919876543210' &&
    cart.order.normalizePhone('+91') === '');
  check('web app URL enables ordering', cart.order.orderable() === true);
  check('drawer is marked ready', cart.dom.cart.getAttribute('data-ready') === 'true');

  const emptyCart = await boot();
  emptyCart.order.setMenu(MENU);
  emptyCart.order.openCart('cart');
  check('empty cart offers an enabled continue-shopping action',
    emptyCart.dom.cartStart.disabled === false &&
    emptyCart.dom.cartStart.textContent === 'Continue shopping');
  emptyCart.dom.cartStart.listeners.click[0]();
  check('continue shopping closes empty cart and returns focus to menu',
    emptyCart.dom.cart.hidden === true &&
    emptyCart.document.activeElement === emptyCart.dom.menu);

  const firstVisit = await boot();
  check('first visit asks to save name, email, and mobile number',
    firstVisit.dom.profileDialog.open === true && firstVisit.dom.profilePhone.value === '+91 ');
  firstVisit.dom.profileName.value = 'A Customer';
  firstVisit.dom.profileEmail.value = 'customer@example.com';
  firstVisit.dom.profilePhone.value = '9876543210';
  firstVisit.dom.profileForm.listeners.submit[0]({ preventDefault() {} });
  check('valid details are saved under a separate customer-profile key',
    JSON.parse(firstVisit.store.getItem('cafecustomer.v1')).name === 'A Customer' &&
    JSON.parse(firstVisit.store.getItem('cafecustomer.v1')).phone === '+919876543210' &&
    firstVisit.store.getItem('cafecart.v1') === null);
  check('saving details prefills checkout and closes the prompt',
    firstVisit.dom.orderName.value === 'A Customer' &&
    firstVisit.dom.orderEmail.value === 'customer@example.com' &&
    firstVisit.dom.orderPhone.value === '+919876543210' &&
    firstVisit.dom.profileDialog.open === false);
  check('saved profile offers an edit action', firstVisit.dom.profileEdit.textContent === 'Edit my details');
  firstVisit.order.startNewOrder();
  check('starting a new order keeps the saved details and profile storage',
    firstVisit.dom.orderName.value === 'A Customer' &&
    firstVisit.dom.orderEmail.value === 'customer@example.com' &&
    firstVisit.dom.orderPhone.value === '+919876543210' &&
    firstVisit.dom.whatsappOptIn.checked === false &&
    firstVisit.store.getItem('cafecustomer.v1') !== null);
  const returningVisit = await boot({ storage: firstVisit.store });
  check('saved details are restored on a later visit without prompting',
    returningVisit.dom.orderName.value === 'A Customer' &&
    returningVisit.dom.orderEmail.value === 'customer@example.com' &&
    returningVisit.dom.orderPhone.value === '+919876543210' &&
    returningVisit.dom.profileDialog.open === false);
  returningVisit.dom.profileEdit.listeners.click[0]();
  returningVisit.dom.profileName.value = 'Updated Customer';
  returningVisit.dom.profileEmail.value = 'updated@example.com';
  returningVisit.dom.profilePhone.value = '+91 98765 00001';
  returningVisit.dom.profileForm.listeners.submit[0]({ preventDefault() {} });
  check('edited details replace the saved profile and checkout values',
    JSON.parse(firstVisit.store.getItem('cafecustomer.v1')).name === 'Updated Customer' &&
    JSON.parse(firstVisit.store.getItem('cafecustomer.v1')).phone === '+919876500001' &&
    returningVisit.dom.orderEmail.value === 'updated@example.com' &&
    returningVisit.dom.orderPhone.value === '+919876500001');
  returningVisit.dom.profileEdit.listeners.click[0]();
  returningVisit.dom.profileName.value = 'Bad Update';
  returningVisit.dom.profileEmail.value = 'invalid';
  returningVisit.dom.profileForm.listeners.submit[0]({ preventDefault() {} });
  check('invalid email does not overwrite a valid saved profile',
    JSON.parse(firstVisit.store.getItem('cafecustomer.v1')).name === 'Updated Customer' &&
    returningVisit.dom.profileDialog.open === true);
  returningVisit.dom.profileForget.listeners.click[0]();
  check('forget details removes only the profile and clears checkout fields',
    firstVisit.store.getItem('cafecustomer.v1') === null &&
    returningVisit.dom.orderName.value === '' &&
    returningVisit.dom.orderEmail.value === '' &&
    returningVisit.dom.orderPhone.value === '+91 ');

  const legacyProfile = await boot({
    storage: fakeStorage({
      'cafecustomer.v1': JSON.stringify({ name: 'Legacy Customer', email: 'legacy@example.com' })
    })
  });
  check('existing saved profiles are prompted once to add a mobile number',
    legacyProfile.dom.profileDialog.open === true &&
    legacyProfile.dom.profilePhone.value === '+91 ');
  legacyProfile.dom.profilePhone.value = '9876543210';
  legacyProfile.dom.profileForm.listeners.submit[0]({ preventDefault() {} });
  check('existing saved profile keeps its details and saves the new number',
    JSON.parse(legacyProfile.store.getItem('cafecustomer.v1')).name === 'Legacy Customer' &&
    JSON.parse(legacyProfile.store.getItem('cafecustomer.v1')).phone === '+919876543210' &&
    legacyProfile.dom.profileDialog.open === false);

  const invalidProfile = await boot();
  invalidProfile.dom.profileName.value = '';
  invalidProfile.dom.profileEmail.value = 'customer@example.com';
  invalidProfile.dom.profileForm.listeners.submit[0]({ preventDefault() {} });
  check('missing name is not stored', invalidProfile.store.getItem('cafecustomer.v1') === null);
  invalidProfile.dom.profileName.value = 'A Customer';
  invalidProfile.dom.profileEmail.value = 'invalid';
  invalidProfile.dom.profilePhone.value = '9876543210';
  invalidProfile.dom.profileForm.listeners.submit[0]({ preventDefault() {} });
  check('invalid first-visit email is not stored', invalidProfile.store.getItem('cafecustomer.v1') === null);
  invalidProfile.dom.profileEmail.value = 'customer@example.com';
  invalidProfile.dom.profilePhone.value = '+91';
  invalidProfile.dom.profileForm.listeners.submit[0]({ preventDefault() {} });
  check('invalid first-visit phone is not stored',
    invalidProfile.store.getItem('cafecustomer.v1') === null &&
    /valid mobile number/i.test(invalidProfile.dom.profileStatus.textContent));
  invalidProfile.dom.profileSkip.listeners.click[0]();
  check('first-time visitor can continue without saving', invalidProfile.dom.profileDialog.open === false);

  cart.order.setMenu(MENU);
  cart.order.add(itemKey(cart.order, 'Flat White'), 2);
  cart.order.add(itemKey(cart.order, 'Croissant'), 1);
  cart.dom.orderName.value = 'A Customer';
  cart.dom.orderEmail.value = 'customer@example.com';
  cart.dom.orderPhone.value = '9876543210';
  cart.dom.whatsappOptIn.checked = true;
  cart.order.openCart('email');
  await cart.order.submitOrder({ preventDefault() {} });

  check('one Apps Script request is sent', cart.requests.length === 1);
  check('request uses configured deployment URL', cart.requests[0].url === CONFIG.appsScriptUrl);
  check('request avoids CORS preflight', cart.requests[0].init.mode === 'no-cors');
  check('request uses text/plain content type', /text\/plain/.test(cart.requests[0].init.headers['Content-Type']));
  const payload = JSON.parse(cart.requests[0].init.body);
  check('payload includes customer details', payload.customerName === 'A Customer' && payload.customerEmail === 'customer@example.com');
  check('payload includes the opted-in WhatsApp number and consent',
    payload.customerPhone === '+919876543210' && payload.whatsappOptIn === true);
  check('payload includes item quantities and unit prices', payload.items.length === 2 && payload.items[0].qty === 2 && payload.items[0].pricePaise === 475);
  check('payload total matches the cart', payload.totalPaise === 1275);
  check('payload includes a retry-safe order ID', payload.orderId === cart.order.order().id && /^ORD-/.test(payload.orderId));
  check('order moves to payment pending', cart.order.phase() === 'awaiting-payment');
  check('total and order ID remain visible', cart.dom.payTotal.textContent === '₹12.75' && cart.dom.payId.textContent === payload.orderId);
  check('payment-page fallback opens the matching Apps Script payment page',
    cart.dom.paymentPageLink.hidden === false &&
    cart.dom.paymentPageLink.getAttribute('href') === CONFIG.appsScriptUrl +
      '?action=pay&orderId=' + encodeURIComponent(payload.orderId));
  check('customer is told to wait for payment email', /check your email.*before paying/i.test(cart.dom.payStatus.textContent));
  check('on-page UPI QR appears with order-specific payment details',
    cart.dom.upiPayment.hidden === false &&
    cart.dom.upiOpen.getAttribute('href').startsWith('upi://pay?') &&
    cart.dom.upiQrDisplay.hidden === false &&
    cart.dom.upiQr.innerHTML.includes('<svg') &&
    cart.dom.upiQr.getAttribute('aria-label').includes(payload.orderId) &&
    cart.dom.upiQrDownload.hidden === false &&
    cart.dom.upiQrDownload.getAttribute('href').startsWith('data:image/jpeg;base64,') &&
    cart.dom.upiQrDownload.getAttribute('download') === 'upi-payment-' + payload.orderId + '.jpg' &&
    cart.dom.upiAmount.textContent === '₹12.75' &&
    cart.dom.upiOrderId.textContent === payload.orderId &&
    cart.dom.upiIdText.textContent === CONFIG.upiId);
  check('cart clears after submission', cart.order.itemCount() === 0);
  const storedPendingOrder = JSON.parse(cart.store.getItem('cafecart.v1')).order;
  check('pending order ID, WhatsApp number, and consent are stored for retry',
    storedPendingOrder.id === payload.orderId &&
    storedPendingOrder.phone === '+919876543210' &&
    storedPendingOrder.whatsappOptIn === true);
  check('customer can start another order', cart.dom.orderAgain.hidden === false);
  check('pending order remains reachable from the sticky bar',
    cart.dom.cartBar.hidden === false && cart.dom.cartBarCount.textContent === 'Order pending');
  const pendingResume = await boot({ storage: cart.store });
  check('successful pending order restores in payment-pending state',
    pendingResume.order.phase() === 'awaiting-payment' && pendingResume.order.step() === 'pay');
  check('payment page link is restored for a pending order',
    pendingResume.dom.paymentPageLink.hidden === false &&
    pendingResume.dom.paymentPageLink.getAttribute('href') === cart.dom.paymentPageLink.getAttribute('href'));
  check('UPI QR block is restored for a pending order',
    pendingResume.dom.upiPayment.hidden === false &&
    pendingResume.dom.upiOpen.getAttribute('href') === cart.dom.upiOpen.getAttribute('href') &&
    pendingResume.dom.upiQrDisplay.hidden === false &&
    pendingResume.dom.upiQrDownload.hidden === false);
  check('WhatsApp button href is restored for a pending order',
    pendingResume.dom.whatsappOrder.hidden === false &&
    pendingResume.dom.whatsappOrder.getAttribute('href').startsWith('https://wa.me/919876543210?text='));
  check('pending order bar is visible after refresh', pendingResume.dom.cartBar.hidden === false);
  pendingResume.dom.cartBar.listeners.click[0]();
  check('sticky bar opens the pending-order drawer', pendingResume.dom.cart.hidden === false && pendingResume.order.step() === 'pay');
  check('start-new-order action is accessible in the drawer', pendingResume.dom.orderAgain.hidden === false);
  pendingResume.dom.orderAgain.listeners.click[0]();
  check('starting a new order unlocks menu items', pendingResume.order.phase() === 'cart' && pendingResume.dom.cartBar.hidden === true);
  check('starting a new order clears the UPI payment block',
    pendingResume.dom.upiPayment.hidden === true &&
    pendingResume.dom.upiQrDisplay.hidden === true &&
    pendingResume.dom.upiQrDownload.hidden === true &&
    pendingResume.dom.upiOpen.getAttribute('href') === '');
  check('starting a new order clears the payment page link',
    pendingResume.dom.paymentPageLink.hidden === true &&
    pendingResume.dom.paymentPageLink.getAttribute('href') === '');
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

  const invalidWhatsApp = await boot();
  invalidWhatsApp.order.setMenu(MENU);
  invalidWhatsApp.order.add(itemKey(invalidWhatsApp.order, 'Flat White'), 1);
  invalidWhatsApp.dom.orderName.value = 'A Customer';
  invalidWhatsApp.dom.orderEmail.value = 'customer@example.com';
  invalidWhatsApp.dom.orderPhone.value = '12345';
  invalidWhatsApp.dom.whatsappOptIn.checked = true;
  await invalidWhatsApp.order.submitOrder({ preventDefault() {} });
  check('invalid or missing international phone blocks WhatsApp opt-in',
    invalidWhatsApp.requests.length === 0 && /valid mobile number.*\+91/i.test(invalidWhatsApp.dom.orderStatus.textContent));

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
  retry.dom.orderPhone.value = 'not-used-without-consent';
  await retry.order.submitOrder({ preventDefault() {} });
  const retryId = retry.order.order().id;
  check('network failure retains the cart and retry ID', retry.order.phase() === 'error' && retry.order.itemCount() === 1);
  check('email-only checkout neither validates nor sends an unconsented phone number',
    JSON.parse(retry.requests[0].init.body).customerPhone === '' &&
    JSON.parse(retry.requests[0].init.body).whatsappOptIn === false);
  const failedResume = await boot({ storage: retry.store });
  check('failed request restores in retry state', failedResume.order.phase() === 'error' && failedResume.order.order().id === retryId);
  check('failed request restores customer details', failedResume.dom.orderName.value === 'A Customer' && failedResume.dom.orderEmail.value === 'customer@example.com');
  await retry.order.submitOrder({ preventDefault() {} });
  check('retry reuses the same order ID', JSON.parse(retry.requests[1].init.body).orderId === retryId);
  check('retry advances and clears the cart', retry.order.phase() === 'awaiting-payment' && retry.order.itemCount() === 0);

  const successfulResume = await boot({ storage: retry.store });
  check('successful retry restores as payment pending',
    successfulResume.order.phase() === 'awaiting-payment' && successfulResume.order.order().id === retryId);

  const waOrder = {
    id: 'ORD-WA123456',
    customerName: 'A Customer',
    lines: [
      { qty: 2, name: 'Flat White' },
      { qty: 1, name: 'Croissant' }
    ],
    totalPaise: 1275
  };
  const waUrl = cart.order.buildWhatsAppUrl(waOrder, CONFIG);
  const waMessage = decodeURIComponent(waUrl.split('?text=')[1]);
  check('valid WhatsApp number creates a wa.me URL with order ID, total, and items',
    waUrl.startsWith('https://wa.me/919876543210?text=') &&
    waMessage.includes('ORD-WA123456') &&
    waMessage.includes('Cafe: The Daily Grind') &&
    waMessage.includes('₹12.75') &&
    waMessage.includes('2 x Flat White') &&
    waMessage.includes('1 x Croissant') &&
    waMessage.includes('Please send the UPI payment details.'));
  const builtPaymentPageUrl = cart.order.buildPaymentPageUrl(waOrder.id, CONFIG);
  check('payment page URL uses the email link format and order ID only',
    builtPaymentPageUrl === CONFIG.appsScriptUrl + '?action=pay&orderId=ORD-WA123456' &&
    !/[?&](?:am|pa|pn|token|signature)=/.test(builtPaymentPageUrl));
  check('payment page URL rejects invalid IDs and missing Apps Script URL',
    cart.order.buildPaymentPageUrl('bad-id', CONFIG) === '' &&
    cart.order.buildPaymentPageUrl(waOrder.id, Object.assign({}, CONFIG, { appsScriptUrl: '' })) === '');
  const noWhatsApp = await boot({ config: { whatsappNumber: '' } });
  const invalidWhatsAppNumber = await boot({ config: { whatsappNumber: '+919876543210' } });
  check('missing or invalid WhatsApp number returns empty URL and keeps button hidden',
    cart.order.buildWhatsAppUrl(waOrder) === '' &&
    cart.order.buildWhatsAppUrl(waOrder, { whatsappNumber: '' }) === '' &&
    cart.order.buildWhatsAppUrl(waOrder, { whatsappNumber: '+919876543210' }) === '' &&
    noWhatsApp.dom.whatsappOrder.hidden &&
    invalidWhatsAppNumber.dom.whatsappOrder.hidden);
  noWhatsApp.order.setMenu(MENU);
  noWhatsApp.order.add(itemKey(noWhatsApp.order, 'Flat White'), 1);
  noWhatsApp.dom.orderName.value = 'A Customer';
  noWhatsApp.dom.orderEmail.value = 'customer@example.com';
  await noWhatsApp.order.submitOrder({ preventDefault() {} });
  check('Pay with UPI remains available while WhatsApp stays hidden without a number',
    noWhatsApp.dom.paymentPageLink.hidden === false &&
    noWhatsApp.dom.whatsappOrder.hidden === true);
  const longOrder = Object.assign({}, waOrder, {
    lines: Array.from({ length: 30 }, (_, index) => ({
      qty: index + 1,
      name: 'Special item ' + index + ' ' + 'x'.repeat(80)
    }))
  });
  const longMessage = decodeURIComponent(cart.order.buildWhatsAppUrl(longOrder, CONFIG).split('?text=')[1]);
  check('long WhatsApp item lists are truncated while retaining order ID and total',
    longMessage.length <= 1000 &&
    longMessage.includes('ORD-WA123456') &&
    longMessage.includes('₹12.75') &&
    /\+\d+ more items/.test(longMessage));
  const specialOrder = Object.assign({}, waOrder, {
    customerName: 'A & B #1 😀\nSecond line',
    lines: [{ qty: 1, name: 'Tea & Cake #2 😀\nSpecial' }]
  });
  const specialUrl = cart.order.buildWhatsAppUrl(specialOrder, CONFIG);
  const specialMessage = decodeURIComponent(specialUrl.split('?text=')[1]);
  check('WhatsApp URL safely encodes ampersand, hash, emoji, and newline',
    specialUrl.includes('%26') &&
    specialUrl.includes('%23') &&
    specialUrl.includes('%F0%9F%98%80') &&
    specialUrl.includes('%0A') &&
    specialMessage.includes('A & B #1 😀\nSecond line') &&
    specialMessage.includes('1 x Tea & Cake #2 😀\nSpecial'));

  const upiOrder = {
    id: 'ORD-UPI123456',
    totalPaise: 1275
  };
  const upiLink = cart.order.buildUpiLink(upiOrder, CONFIG);
  const upiParams = Object.fromEntries(upiLink.slice('upi://pay?'.length).split('&').map((part) => {
    const splitAt = part.indexOf('=');
    return [part.slice(0, splitAt), decodeURIComponent(part.slice(splitAt + 1))];
  }));
  check('UPI link matches Apps Script parameters and formatting',
    upiLink.startsWith('upi://pay?') &&
    upiParams.pa === CONFIG.upiId &&
    upiParams.pn === CONFIG.payeeName &&
    upiParams.am === '12.75' &&
    upiParams.cu === 'INR' &&
    upiParams.tn === upiOrder.id &&
    upiParams.tr === upiOrder.id &&
    Object.keys(upiParams).length === 6 &&
    BACKEND.includes("'pa=' + encodeURIComponent(CONFIG.UPI_ID)") &&
    BACKEND.includes("'pn=' + encodeURIComponent(CONFIG.CAFE_NAME)") &&
    BACKEND.includes("'am=' + (order.totalPaise / 100).toFixed(2)") &&
    BACKEND.includes("'tn=' + encodeURIComponent(order.orderId)") &&
    BACKEND.includes("'tr=' + encodeURIComponent(order.orderId)"));
  check('invalid or missing UPI ID and zero amount produce no payment link',
    cart.order.buildUpiLink(upiOrder, Object.assign({}, CONFIG, { upiId: '' })) === '' &&
    cart.order.buildUpiLink(upiOrder, Object.assign({}, CONFIG, { upiId: 'not-a-upi-id' })) === '' &&
    cart.order.buildUpiLink(Object.assign({}, upiOrder, { totalPaise: 0 }), CONFIG) === '');
  const specialUpiLink = cart.order.buildUpiLink(
    { id: 'ORD #1&A', totalPaise: 1234 },
    Object.assign({}, CONFIG, { payeeName: 'Cafe & Bakery #1' })
  );
  check('UPI link safely encodes special payee and order reference characters',
    specialUpiLink.includes('pn=Cafe%20%26%20Bakery%20%231') &&
    specialUpiLink.includes('tn=ORD%20%231%26A') &&
    specialUpiLink.includes('tr=ORD%20%231%26A') &&
    decodeURIComponent(specialUpiLink).includes('Cafe & Bakery #1'));
  await cart.dom.upiCopy.listeners.click[0]();
  check('Copy UPI ID button uses the clipboard when available',
    cart.clipboardWrites[0] === CONFIG.upiId &&
    /copied/i.test(cart.dom.upiCopyStatus.textContent));
  const fallbackCopy = await boot({ clipboard: 'reject' });
  fallbackCopy.order.setMenu(MENU);
  fallbackCopy.order.add(itemKey(fallbackCopy.order, 'Flat White'), 1);
  fallbackCopy.dom.orderName.value = 'A Customer';
  fallbackCopy.dom.orderEmail.value = 'customer@example.com';
  await fallbackCopy.order.submitOrder({ preventDefault() {} });
  await fallbackCopy.dom.upiCopy.listeners.click[0]();
  check('Copy UPI ID falls back when clipboard access is unavailable',
    fallbackCopy.copyCommands() === 1 &&
    /copied/i.test(fallbackCopy.dom.upiCopyStatus.textContent));
  const noQrLibrary = await boot({ qrcode: null });
  noQrLibrary.order.setMenu(MENU);
  noQrLibrary.order.add(itemKey(noQrLibrary.order, 'Flat White'), 1);
  noQrLibrary.dom.orderName.value = 'A Customer';
  noQrLibrary.dom.orderEmail.value = 'customer@example.com';
  await noQrLibrary.order.submitOrder({ preventDefault() {} });
  check('QR library failure keeps UPI app button and ID available',
    noQrLibrary.dom.upiPayment.hidden === false &&
    noQrLibrary.dom.upiQrDisplay.hidden === true &&
    noQrLibrary.dom.upiQrDownload.hidden === true &&
    noQrLibrary.dom.upiQrFallback.hidden === false &&
    noQrLibrary.dom.upiOpen.getAttribute('href').startsWith('upi://pay?') &&
    noQrLibrary.dom.upiIdText.textContent === CONFIG.upiId);
  const noJpegSupport = await boot({ jpeg: false });
  noJpegSupport.order.setMenu(MENU);
  noJpegSupport.order.add(itemKey(noJpegSupport.order, 'Flat White'), 1);
  noJpegSupport.dom.orderName.value = 'A Customer';
  noJpegSupport.dom.orderEmail.value = 'customer@example.com';
  await noJpegSupport.order.submitOrder({ preventDefault() {} });
  check('JPEG conversion failure keeps the QR visible and explains the fallback',
    noJpegSupport.dom.upiQrDisplay.hidden === false &&
    noJpegSupport.dom.upiQrDownload.hidden === true &&
    noJpegSupport.dom.upiQrDownloadStatus.hidden === false &&
    /could not prepare a JPG/i.test(noJpegSupport.dom.upiQrDownloadStatus.textContent) &&
    noJpegSupport.logs.error.some((args) => /Could not prepare a JPG payment QR download/.test(args[0])));
  const noUpiConfig = await boot({ config: { upiId: '' } });
  noUpiConfig.order.setMenu(MENU);
  noUpiConfig.order.add(itemKey(noUpiConfig.order, 'Flat White'), 1);
  noUpiConfig.dom.orderName.value = 'A Customer';
  noUpiConfig.dom.orderEmail.value = 'customer@example.com';
  await noUpiConfig.order.submitOrder({ preventDefault() {} });
  check('missing UPI ID leaves the QR block hidden after order submission',
    noUpiConfig.dom.upiPayment.hidden === true &&
    noUpiConfig.dom.upiQrDisplay.hidden === true &&
    noUpiConfig.dom.upiQrDownload.hidden === true);

  check('WhatsApp button href is set after submission',
    cart.dom.whatsappOrder.hidden === false &&
    cart.dom.whatsappOrder.getAttribute('href').startsWith('https://wa.me/919876543210?text='));

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
  check('demo payment step shows WhatsApp click-to-chat without sending automatically',
    demo.dom.whatsappOrder.hidden === false &&
    demo.dom.whatsappOrder.getAttribute('href').startsWith('https://wa.me/919876543210?text='));
  check('demo payment step builds the same order-specific payment-page URL',
    demo.dom.paymentPageLink.hidden === false &&
    demo.dom.paymentPageLink.getAttribute('href') === CONFIG.appsScriptUrl +
      '?action=pay&orderId=' + encodeURIComponent(demo.order.order().id));

  check('page has no EmailJS dependency or customer paid-claim button', !/@emailjs\/browser|id="claimBtn"/.test(HTML));
  check('page loads Apps Script transport and customer profile controls',
    /src="submit-order\.js"/.test(HTML) && /id="orderName"/.test(HTML) &&
    /id="orderPhone"/.test(HTML) && /id="whatsappOptIn"/.test(HTML) &&
    /id="profileDialog"/.test(HTML) && /id="profileEdit"/.test(HTML));
  check('payment QR is static and has a local JPG download',
    /<div id="upiQrDisplay"[^>]*hidden>/.test(HTML) &&
    !/<a id="upiQr(Link|Display)"/.test(HTML) &&
    /id="upiQrDownload"[^>]*download[^>]*hidden>Download QR \(JPG\)<\/a>/.test(HTML) &&
    /Scan the QR with another device/.test(HTML));
  check('profile saves a mobile number and checkout starts with +91',
    /id="profilePhone"[^>]*value="\+91 "/.test(HTML) &&
    /id="orderPhone"[^>]*value="\+91 "/.test(HTML) &&
    /id="profilePhone"/.test(HTML) &&
    /Saved contact details stay in this browser/.test(HTML));
  check('pinned QR library loads before order.js',
    HTML.indexOf('https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js') !== -1 &&
    HTML.indexOf('qrcode-generator/1.4.4/qrcode.min.js') < HTML.indexOf('src="order.js?v='));
  check('profile and developer updates use cache-busted assets',
    /href="style\.css\?v=20261025-developer-credit"/.test(HTML) &&
    /src="order\.js\?v=20261025-developer-credit"[^>]*defer/.test(HTML));
  check('WhatsApp link opens safely and explains the manual backup confirmation',
    /id="whatsappOrder"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*hidden/.test(HTML) &&
    /Optional: send your order to the cafe on WhatsApp\./.test(HTML));
  check('payment page fallback link opens safely',
    /id="paymentPageLink"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*hidden/.test(HTML) &&
    /Having trouble\? Open payment page/.test(HTML) &&
    !/id="paymentPageLink"[^>]*class="btn/.test(HTML));
  check('developer credit appears on menu and payment screens',
    (HTML.match(/Designed &amp; developed by/g) || []).length === 2 &&
    (HTML.match(/src="developer-avatar\.png" alt="" width="28" height="28"/g) || []).length === 2 &&
    (HTML.match(/class="developer-credit__link" href="https:\/\/ali-akbar-k\.github\.io\/PORTFOLIO\/"/g) || []).length === 2);
  const STYLES = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  check('payment links have clean styling with underline only on interaction',
    /\.upi-payment__download\s*\{[^}]*text-decoration:\s*none/s.test(STYLES) &&
    /\.pay__payment-link\s*\{[^}]*text-decoration:\s*none/s.test(STYLES) &&
    /\.developer-credit__link\s*\{[^}]*text-decoration:\s*none/s.test(STYLES) &&
    /\.developer-credit__link:hover,\s*\.developer-credit__link:focus-visible\s*\{[^}]*text-decoration:\s*underline/s.test(STYLES));
  check('backend validates IDs and totals', BACKEND.includes('ORDER_ID_PATTERN') && BACKEND.includes('Number(data.totalPaise) !== totalPaise'));
  check('backend throttles rapid repeat orders', BACKEND.includes('CacheService.getScriptCache') && BACKEND.includes('cache.put(cooldownKey, order.orderId, 15)'));
  const sentEmails = [];
  const qrRequests = [];
  const whatsappRequests = [];
  const backendErrors = [];
  let qrServiceFails = false;
  let whatsappApiFails = false;
  const scriptProperties = {
    WHATSAPP_ACCESS_TOKEN: 'test-access-token',
    WHATSAPP_PHONE_NUMBER_ID: '123456789',
    WHATSAPP_API_VERSION: 'v22.0',
    WHATSAPP_ORDER_TEMPLATE: 'order_received',
    WHATSAPP_PAYMENT_TEMPLATE: 'payment_confirmed',
    WHATSAPP_TEMPLATE_LANGUAGE: 'en_US'
  };
  const qrImage = {
    getContentType() { return 'image/png'; },
    getName() { return this.name; },
    setName(name) { this.name = name; return this; },
    copyBlob() {
      return {
        getName() { return this.name; },
        setName(name) { this.name = name; return this; }
      };
    }
  };
  const logoImage = {
    getContentType() { return 'image/png'; },
    setName(name) { this.name = name; return this; }
  };
  const backendContext = vm.createContext({
    encodeURIComponent,
    MailApp: { sendEmail(message) { sentEmails.push(message); } },
    UrlFetchApp: {
      fetch(url, options) {
        if (url.includes('graph.facebook.com')) {
          whatsappRequests.push({ url, options });
          return {
            getResponseCode() { return whatsappApiFails ? 400 : 200; },
            getContentText() {
              return whatsappApiFails
                ? JSON.stringify({ error: { message: 'Invalid template' } })
                : JSON.stringify({ messages: [{ id: 'wamid.test' }] });
            }
          };
        }
        qrRequests.push({ url, options });
        return {
          getResponseCode() {
            return qrServiceFails && !url.includes('Alifivacon.ico.png') ? 503 : 200;
          },
          getBlob() { return url.includes('Alifivacon.ico.png') ? logoImage : qrImage; }
        };
      }
    },
    PropertiesService: {
      getScriptProperties() {
        return { getProperty(name) { return scriptProperties[name] || ''; } };
      }
    },
    console: {
      error(message) { backendErrors.push(message); },
      log(message) { backendErrors.push(message); }
    },
    HtmlService: { createHtmlOutput(html) { return { html }; } }
  });
  vm.runInContext(BACKEND, backendContext, { filename: 'payment-backend/Code.gs' });
  vm.runInContext('authorizeQrImageService()', backendContext);
  check('QR authorization helper makes a harmless test request',
    qrRequests.length === 1 &&
    qrRequests[0].url.includes(encodeURIComponent('ORD-QRTEST123')) &&
    backendErrors.some((message) => message.includes('QR image service authorized')));
  const validationOrder = {
    orderId: 'ORD-WHATSAPP123',
    customerName: 'A Customer',
    customerEmail: 'customer@example.com',
    customerPhone: '+919876543210',
    whatsappOptIn: true,
    items: [{ name: 'Test item', qty: 1, pricePaise: 575 }],
    totalPaise: 575
  };
  const validatedOrder = vm.runInContext(
    'validateOrder_(' + JSON.stringify(validationOrder) + ')',
    backendContext
  );
  check('backend validates and retains WhatsApp consent and phone',
    validatedOrder.customerPhone === '+919876543210' && validatedOrder.whatsappOptIn === true);
  const invalidOptIn = Object.assign({}, validationOrder, { customerPhone: '' });
  check('backend rejects WhatsApp opt-in without a phone number',
    vm.runInContext(
      'try { validateOrder_(' + JSON.stringify(invalidOptIn) + '); false; } catch (error) { /WhatsApp number/.test(error.message); }',
      backendContext
    ));
  const unconsentedPhone = Object.assign({}, validationOrder, {
    customerPhone: '+919876543210',
    whatsappOptIn: false
  });
  check('backend discards a WhatsApp number when consent was not given',
    vm.runInContext(
      'validateOrder_(' + JSON.stringify(unconsentedPhone) + ').customerPhone === ""',
      backendContext
    ));
  vm.runInContext(
    "sendWhatsAppOrderMessage_({ orderId: 'ORD-TEST123', customerName: 'A Customer', customerPhone: '+919876543210', itemsText: '1 x Test item', totalPaise: 575 })",
    backendContext
  );
  const whatsappOrderRequest = whatsappRequests[0];
  const whatsappOrderPayload = JSON.parse(whatsappOrderRequest.options.payload);
  check('WhatsApp order template includes the phone, payment link, and template data',
    whatsappOrderRequest.url === 'https://graph.facebook.com/v22.0/123456789/messages' &&
    whatsappOrderRequest.options.headers.Authorization === 'Bearer test-access-token' &&
    whatsappOrderPayload.to === '919876543210' &&
    whatsappOrderPayload.template.name === 'order_received' &&
    whatsappOrderPayload.template.components[0].parameters.length === 7 &&
    whatsappOrderPayload.template.components[0].parameters[6].text.includes('action=pay'));
  check('WhatsApp order is skipped when customer did not opt in',
    vm.runInContext(
      "attemptWhatsAppOrderMessage_({ orderId: 'ORD-TEST124', whatsappOptIn: false })",
      backendContext
    ) === 'Not opted in' && whatsappRequests.length === 1);
  check('payment-confirmed WhatsApp template is sent independently',
    vm.runInContext(
      "attemptWhatsAppPaymentMessage_('+919876543210', true, 'A Customer', 'ORD-TEST123')",
      backendContext
    ) === 'Accepted' &&
    JSON.parse(whatsappRequests[1].options.payload).template.name === 'payment_confirmed');
  check('WhatsApp setup checker verifies properties without sending a message',
    vm.runInContext('checkWhatsAppConfiguration()', backendContext).includes('No message was sent') &&
    whatsappRequests.length === 2);
  const savedApiVersion = scriptProperties.WHATSAPP_API_VERSION;
  delete scriptProperties.WHATSAPP_API_VERSION;
  check('WhatsApp setup checker names missing Script Properties without revealing secrets',
    vm.runInContext('checkWhatsAppConfiguration()', backendContext).includes('WHATSAPP_API_VERSION') &&
    !vm.runInContext('checkWhatsAppConfiguration()', backendContext).includes('test-access-token'));
  scriptProperties.WHATSAPP_API_VERSION = savedApiVersion;
  whatsappApiFails = true;
  check('WhatsApp API errors are logged and returned as a failed channel status',
    vm.runInContext(
      "attemptWhatsAppPaymentMessage_('+919876543210', true, 'A Customer', 'ORD-TEST123')",
      backendContext
    ).startsWith('Failed: WhatsApp API returned HTTP 400: Invalid template') &&
    backendErrors.some((message) => message.includes('Invalid template')));
  whatsappApiFails = false;
  const upiUrl = vm.runInContext("upiPaymentUrl_({ totalPaise: 575, orderId: 'ORD-TEST123' })", backendContext);
  check('customer email UPI link includes amount and order reference',
    /upi:\/\/pay\?.*am=5\.75.*cu=INR.*tn=ORD-TEST123.*tr=ORD-TEST123/.test(upiUrl));
  vm.runInContext("sendCustomerOrderEmail_({ orderId: 'ORD-TEST123', customerName: 'A Customer', customerEmail: 'customer@example.com', itemsText: 'Test item', totalPaise: 575 })", backendContext);
  const paymentPageUrl = vm.runInContext("paymentPageUrl_('ORD-TEST123')", backendContext);
  const qrDownloadUrl = vm.runInContext(
    "generateUpiQrUrl_({ totalPaise: 575, orderId: 'ORD-TEST123' })",
    backendContext
  );
  const escapedUpiUrl = upiUrl.replace(/&/g, '&amp;');
  const escapedPaymentPageUrl = paymentPageUrl.replace(/&/g, '&amp;');
  const escapedQrDownloadUrl = qrDownloadUrl.replace(/&/g, '&amp;');
  check('customer email embeds a QR for the direct UPI URL',
    sentEmails[0].inlineImages.paymentQr === qrImage &&
    sentEmails[0].attachments[0] !== sentEmails[0].inlineImages.paymentQr &&
    sentEmails[0].attachments[0].name === 'upi-payment-ORD-TEST123.png' &&
    sentEmails[0].htmlBody.includes('src="cid:paymentQr"') &&
    sentEmails[0].htmlBody.includes('download the attached') &&
    sentEmails[0].htmlBody.includes('upi-payment-ORD-TEST123.png') &&
    sentEmails[0].body.includes('Download the attached QR image: upi-payment-ORD-TEST123.png') &&
    sentEmails[0].htmlBody.includes('href="' + escapedQrDownloadUrl + '"') &&
    sentEmails[0].htmlBody.includes('>Download QR Code</a>') &&
    sentEmails[0].body.includes('View/download the QR image: ' + qrDownloadUrl) &&
    sentEmails[0].body.includes('Scan the attached QR code') &&
    qrRequests[1].url.endsWith('data=' + encodeURIComponent(upiUrl)) &&
    qrRequests[1].options.muteHttpExceptions === true);
  check('customer order email includes a linked developer logo and portfolio',
    sentEmails[0].inlineImages.developerLogo === logoImage &&
    sentEmails[0].htmlBody.includes('src="cid:developerLogo"') &&
    sentEmails[0].htmlBody.includes('href="https://ali-akbar-k.github.io/PORTFOLIO/"') &&
    sentEmails[0].body.includes('Portfolio: https://ali-akbar-k.github.io/PORTFOLIO/'));
  check('customer email button uses an HTTPS payment page and retains UPI fallback',
    paymentPageUrl.startsWith('https://') &&
    sentEmails[0].htmlBody.includes('href="' + escapedPaymentPageUrl + '"') &&
    sentEmails[0].htmlBody.includes('href="' + escapedUpiUrl + '">standard UPI link</a>') &&
    sentEmails[0].body.includes('Pay with UPI: ' + paymentPageUrl) &&
    sentEmails[0].body.includes('Standard UPI link: ' + upiUrl));
  qrServiceFails = true;
  vm.runInContext("sendCustomerOrderEmail_({ orderId: 'ORD-TEST456', customerName: 'A Customer', customerEmail: 'customer@example.com', itemsText: 'Test item', totalPaise: 575 })", backendContext);
  check('QR service failure is logged and email retains payment fallbacks',
    !sentEmails[1].inlineImages.paymentQr &&
    !sentEmails[1].attachments &&
    sentEmails[1].inlineImages.developerLogo === logoImage &&
    sentEmails[1].htmlBody.includes('>Download QR Code</a>') &&
    sentEmails[1].body.includes('QR image is loaded directly in this email') &&
    sentEmails[1].htmlBody.includes('api.qrserver.com/v1/create-qr-code/') &&
    sentEmails[1].htmlBody.includes('alt="UPI payment QR code"') &&
    sentEmails[1].htmlBody.includes('standard UPI link') &&
    backendErrors.some((message) => message.includes('Payment QR generation failed for ORD-TEST456')));
  const paymentPageHtml = vm.runInContext("paymentPageHtml_('ORD-TEST123', 575, upiPaymentUrl_({ totalPaise: 575, orderId: 'ORD-TEST123' }))", backendContext);
  check('payment page gives the customer an explicit UPI app action',
    paymentPageHtml.includes('Open UPI app') &&
    paymentPageHtml.includes('target="_top" href="upi://pay?') &&
    paymentPageHtml.includes('api.qrserver.com/v1/create-qr-code/') &&
    paymentPageHtml.includes('alt="UPI payment QR code"') &&
    paymentPageHtml.includes('INR 5.75') &&
    BACKEND.includes("params.action === 'pay'"));
  vm.runInContext("sendOwnerNotifyEmail_({ orderId: 'ORD-TEST123', customerName: 'A Customer', customerEmail: 'customer@example.com', itemsText: 'Test item', totalPaise: 575 }, 'token-123')", backendContext);
  const ownerEmail = sentEmails[sentEmails.length - 1];
  const ownerConfirmationUrl = vm.runInContext("CONFIG.WEB_APP_URL + '?orderId=ORD-TEST123&token=token-123'", backendContext);
  check('owner email has a styled confirmation button and a plain-text fallback',
    ownerEmail.to === 'PASTE_YOUR_EMAIL_HERE' &&
    ownerEmail.htmlBody.includes('>Review and confirm payment</a>') &&
    ownerEmail.htmlBody.includes('href="' + ownerConfirmationUrl.replace(/&/g, '&amp;') + '"') &&
    ownerEmail.body.includes('verify payment in your banking app') &&
    ownerEmail.body.includes(ownerConfirmationUrl));
  check('owner notification includes the linked developer logo',
    ownerEmail.inlineImages.developerLogo === logoImage &&
    ownerEmail.htmlBody.includes('src="cid:developerLogo"') &&
    ownerEmail.body.includes('Portfolio: https://ali-akbar-k.github.io/PORTFOLIO/'));
  vm.runInContext(
    "sendPaymentConfirmedEmail_('customer@example.com', 'A Customer', 'ORD-TEST123')",
    backendContext
  );
  const confirmationEmail = sentEmails[sentEmails.length - 1];
  check('payment confirmation email includes the linked developer logo',
    confirmationEmail.inlineImages.developerLogo === logoImage &&
    confirmationEmail.htmlBody.includes('href="https://ali-akbar-k.github.io/PORTFOLIO/"') &&
    confirmationEmail.htmlBody.includes('src="cid:developerLogo"') &&
    confirmationEmail.body.includes('Portfolio: https://ali-akbar-k.github.io/PORTFOLIO/'));
  const gmailReturnPage = vm.runInContext(
    "gmailReturnResponse_('Payment confirmed for order ORD-TEST123.')",
    backendContext
  ).html;
  check('payment result page has a top-level Back to Gmail button',
    gmailReturnPage.includes('>Back to Gmail</a>') &&
    gmailReturnPage.includes('target="_top" href="https://mail.google.com/mail/u/0/#sent"') &&
    gmailReturnPage.includes('http-equiv="refresh" content="3;url=https://mail.google.com/mail/u/0/#sent"') &&
    gmailReturnPage.includes('Payment confirmed for order ORD-TEST123.'));
  check('payment confirmation form submits at the top level',
    BACKEND.includes('" target="_top">'));
  check('success and already-paid responses offer return to Gmail',
    BACKEND.includes("return gmailReturnResponse_('This order is already marked as paid.')") &&
    /return gmailReturnResponse_\('Payment confirmed for order '\s*\+\s*escapeHtml_\(orderId\)/.test(BACKEND));
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
