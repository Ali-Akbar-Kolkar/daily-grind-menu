/*
 * order.js - cart, Apps Script order submission, manual UPI payment.
 *
 * Loaded before script.js and owns everything about ordering. script.js only
 * hands it the parsed menu items and asks it for an "Add" button per card, so
 * the CSV fetching and card rendering are untouched.
 *
 * Money is held as integer paise everywhere. Floating point rupees are how a
 * cafe ends up quoting 449.99999999 and getting a payment mismatch.
 *
 * Nothing here builds HTML from sheet or email data - every value goes in via
 * textContent, so a menu row called <img onerror=...> stays a string.
 */
(function () {
  'use strict';

  var STORAGE_VERSION = 2;

  var DEFAULTS = {
    appsScriptUrl: '',
    currency: 'INR',
    locale: 'en-IN',
    maxQtyPerLine: 20,
    maxLines: 30,
    copyToCustomer: true,
    storageKey: 'cafecart.v1',
    demoMode: false
  };

  /* ------------------------------------------------------------------ *
   * config
   * ------------------------------------------------------------------ */

  function merge(base, override) {
    var out = {};
    Object.keys(base).forEach(function (key) {
      var value = base[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        out[key] = merge(value, (override && override[key]) || {});
      } else {
        out[key] = override && override[key] !== undefined ? override[key] : value;
      }
    });
    return out;
  }

  var config = merge(DEFAULTS, (typeof window !== 'undefined' && window.CAFE_ORDER) || {});

  function configProblem() {
    var missing = [];
    if (!backendReady()) missing.push('CAFE_ORDER.appsScriptUrl or submit-order.js');
    return missing;
  }

  function sayNotConfigured() {
    var missing = configProblem();
    say(dom.orderStatus,
      'Ordering is not switched on yet. Please tell a staff member, and they can sort it out.',
      'warn');
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('[cafe] ordering is not configured. Still unset in site-config.js:\n  - ' +
        (missing.length ? missing.join('\n  - ') : '(nothing looks unset - check the values are real)'));
    }
  }

  function backendReady() {
    return Boolean(typeof window !== 'undefined' && window.CafeOrderBackend &&
      typeof window.CafeOrderBackend.submit === 'function' &&
      typeof window.CafeOrderBackend.configuredUrl === 'function' &&
      window.CafeOrderBackend.configuredUrl());
  }

  function demoForced() {
    if (config.demoMode) return true;
    try {
      return typeof location !== 'undefined' && /[?&]demo=1\b/.test(location.search || '');
    } catch (err) {
      return false;
    }
  }

  /* demo mode walks the whole flow with no credentials and no sends */
  var demo = demoForced();

  function orderable() {
    return demo || backendReady();
  }

  /* ------------------------------------------------------------------ *
   * pure helpers (exported for the test suite)
   * ------------------------------------------------------------------ */

  function toPaise(amount) {
    var value = typeof amount === 'number' ? amount : parseFloat(amount);
    if (!isFinite(value)) return null;
    return Math.round(value * 100);
  }

  function fromPaise(paise) {
    return paise / 100;
  }

  var formatter = null;
  try {
    formatter = new Intl.NumberFormat(config.locale || 'en-IN', {
      style: 'currency',
      currency: config.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  } catch (err) {
    formatter = null;
  }

  function money(paise) {
    var value = fromPaise(paise);
    if (formatter) return formatter.format(value);
    return config.currency + ' ' + value.toFixed(2);
  }

  function slug(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function itemKey(item, index, taken) {
    var base = slug(item.name) + '|' + slug(item.category || 'menu');
    if (!taken || !taken.has(base)) return base;
    var candidate = base + '#' + index;
    while (taken.has(candidate)) {
      index += 1;
      candidate = base + '#' + index;
    }
    return candidate;
  }

  function isEmail(value) {
    var text = String(value == null ? '' : value).trim();
    if (!text || text.length > 254) return false;
    if (/\s/.test(text)) return false;
    /* one @, non-empty local part, dotted domain, 2+ char tld */
    return /^[^@]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/.test(text);
  }

  var ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

  function randomChunk(length) {
    var out = '';
    var i;
    var crypto = (typeof window !== 'undefined' && window.crypto) || null;
    if (crypto && typeof crypto.getRandomValues === 'function' && typeof Uint8Array === 'function') {
      var bytes = new Uint8Array(length);
      crypto.getRandomValues(bytes);
      for (i = 0; i < length; i += 1) out += ALPHABET.charAt(bytes[i] % ALPHABET.length);
      return out;
    }
    for (i = 0; i < length; i += 1) {
      out += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
    }
    return out;
  }

  function makeOrderId(now, salt) {
    var stamp = (now || Date.now()).toString(36).toUpperCase();
    return 'ORD-' + stamp + '-' + (salt || randomChunk(8));
  }

  function lineText(line) {
    return line.qty + ' x ' + line.name + ' @ ' + money(line.pricePaise) +
      ' = ' + money(line.pricePaise * line.qty);
  }

  function orderLinesText(lines) {
    return (lines || [])
      .filter(function (line) { return !line.gone; })
      .map(lineText)
      .join('\n');
  }

  /* ------------------------------------------------------------------ *
   * state
   * ------------------------------------------------------------------ */

  var IDS = [
    'menu', 'cartBar', 'cartBarCount', 'cartBarTotal', 'cart', 'cartClose',
    'stepCart', 'cartLines', 'cartEmpty', 'cartTotal', 'cartNotice', 'cartStart',
    'cartClear', 'stepEmail', 'orderForm', 'orderName', 'orderEmail', 'orderWebsite',
    'orderSubmit', 'orderStatus', 'stepPay', 'payTotal', 'payId',
    'payStatus', 'orderAgain', 'cartLive'
  ];

  var dom = {};
  var menuItems = new Map();
  var lines = [];
  var rowIndex = new Map();
  var notice = '';
  var order = null;
  var phase = 'cart';
  var step = 'cart';
  var storageOk = true;
  var lastFocus = null;

  function storage() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return null;
      return window.localStorage;
    } catch (err) {
      storageOk = false;
      return null;
    }
  }

  function save() {
    var store = storage();
    if (!store) return;
    try {
      store.setItem(config.storageKey, JSON.stringify({
        v: STORAGE_VERSION,
        updated: Date.now(),
        phase: phase,
        order: order && (phase === 'sending' || phase === 'error' || phase === 'awaiting-payment') ? {
          id: order.id,
          customerName: order.customerName,
          email: order.email,
          totalPaise: order.totalPaise,
          lines: order.lines,
          createdAt: order.createdAt
        } : null,
        lines: lines.map(function (line) {
          return {
            key: line.key,
            name: line.name,
            pricePaise: line.pricePaise,
            qty: line.qty,
            gone: !!line.gone
          };
        })
      }));
    } catch (err) {
      storageOk = false;
    }
  }

  function load() {
    var store = storage();
    if (!store) return;

    var raw;
    try {
      raw = store.getItem(config.storageKey);
    } catch (err) {
      storageOk = false;
      return;
    }
    if (!raw) return;

    var data = null;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      data = null;
    }

    /* corrupt, or written by a different version: drop it rather than half load */
    if (!data || (data.v !== 1 && data.v !== STORAGE_VERSION) || !Array.isArray(data.lines)) {
      try { store.removeItem(config.storageKey); } catch (ignored) { /* ignore */ }
      return;
    }

    data.lines.forEach(function (entry) {
      if (!entry || typeof entry.key !== 'string') return;
      var qty = Math.floor(Number(entry.qty));
      var paise = Math.floor(Number(entry.pricePaise));
      if (!isFinite(qty) || qty < 1 || qty > config.maxQtyPerLine) return;
      if (!isFinite(paise) || paise < 0) return;
      lines.push({
        key: entry.key,
        name: String(entry.name || ''),
        pricePaise: paise,
        qty: qty,
        gone: false
      });
    });

    if (data.v === STORAGE_VERSION && isValidOrder(data.order)) {
      order = data.order;
      phase = data.phase === 'awaiting-payment' ? 'awaiting-payment' : 'error';
    }
  }

  function isValidOrder(saved) {
    var createdAt = Number(saved && saved.createdAt);
    var declaredTotal = Number(saved && saved.totalPaise);
    if (!saved || typeof saved.id !== 'string' || !/^ORD-[A-Z0-9-]+$/.test(saved.id) ||
      (saved.customerName != null && (typeof saved.customerName !== 'string' || saved.customerName.length > 100)) ||
        !isEmail(saved.email) || !Array.isArray(saved.lines) || !saved.lines.length ||
        saved.lines.length > config.maxLines || !isFinite(createdAt) || createdAt <= 0 ||
        !isFinite(declaredTotal) || declaredTotal < 0 || Math.floor(declaredTotal) !== declaredTotal) return false;

    var total = 0;
    var valid = saved.lines.every(function (line) {
      var price = Number(line && line.pricePaise);
      var qty = Number(line && line.qty);
      if (!line || typeof line.key !== 'string' || typeof line.name !== 'string' ||
          !line.name || line.name.length > 200 ||
          !isFinite(price) || price < 0 || Math.floor(price) !== price ||
          !isFinite(qty) || qty < 1 || qty > config.maxQtyPerLine || Math.floor(qty) !== qty) return false;
      total += price * qty;
      return true;
    });
    return valid && total === declaredTotal;
  }

  function clearStorage() {
    var store = storage();
    if (!store) return;
    try {
      store.removeItem(config.storageKey);
    } catch (err) {
      storageOk = false;
    }
  }

  /* ------------------------------------------------------------------ *
   * cart maths
   * ------------------------------------------------------------------ */

  function activeLines() {
    return lines.filter(function (line) { return !line.gone; });
  }

  function orderLocked() {
    return phase === 'sending' || phase === 'awaiting-payment';
  }

  function totalPaise() {
    return activeLines().reduce(function (sum, line) { return sum + line.pricePaise * line.qty; }, 0);
  }

  function itemCount() {
    return activeLines().reduce(function (sum, line) { return sum + line.qty; }, 0);
  }

  function qtyOf(key) {
    var found = null;
    lines.forEach(function (line) { if (line.key === key) found = line; });
    return found ? found.qty : 0;
  }

  function findLine(key) {
    var found = null;
    lines.forEach(function (line) { if (line.key === key) found = line; });
    return found;
  }

  function add(key, stepCount) {
    if (orderLocked()) {
      return { ok: false, reason: 'An order is already in progress. Finish it before changing the cart.' };
    }
    var item = menuItems.get(key);
    if (!item) return { ok: false, reason: 'That item is not on the menu any more.' };

    var paise = toPaise(item.price);
    if (paise === null) {
      return { ok: false, reason: item.name + ' has no price, so it cannot be ordered.' };
    }

    var existing = findLine(key);
    var wanted = (existing ? existing.qty : 0) + (stepCount || 1);

    if (wanted > config.maxQtyPerLine) {
      return { ok: false, reason: 'Maximum ' + config.maxQtyPerLine + ' of ' + item.name + ' per order.' };
    }
    if (!existing && lines.length >= config.maxLines) {
      return { ok: false, reason: 'Maximum ' + config.maxLines + ' different items per order.' };
    }

    if (existing) {
      existing.qty = wanted;
      existing.gone = false;
    } else {
      lines.push({ key: key, name: item.name, pricePaise: paise, qty: wanted, gone: false });
    }

    notice = '';
    save();
    render();
    return { ok: true, qty: wanted, name: item.name };
  }

  function setQty(key, qty) {
    if (orderLocked()) return;
    var line = findLine(key);
    if (!line) return;

    var next = Math.floor(Number(qty));
    if (!isFinite(next) || next < 0) return;
    if (next === 0) {
      remove(key);
      return;
    }
    line.qty = Math.min(next, config.maxQtyPerLine);
    save();
    /* the rows are left alone so the +/- button keeps keyboard focus */
    paintQty(key);
    render(true);
  }

  function paintQty(key) {
    var entry = rowIndex.get(key);
    var line = findLine(key);
    if (entry && line) entry.qty.textContent = String(line.qty);
  }

  function remove(key) {
    if (orderLocked()) return;
    /* if the row being removed is the thing being focused on, move focus
       somewhere real rather than dropping it on the body */
    var hadFocus = false;
    if (typeof document !== 'undefined' && document.activeElement &&
        typeof document.activeElement.closest === 'function') {
      hadFocus = Boolean(document.activeElement.closest('[data-line="' + key + '"]'));
    }

    lines = lines.filter(function (line) { return line.key !== key; });
    notice = '';
    if (!activeLines().length) resetOrder();
    save();
    render();

    if (hadFocus) {
      var survivors = dom.cartLines ? dom.cartLines.querySelectorAll('[data-remove]') : [];
      var target = survivors[0] || dom.cartClose;
      if (target && typeof target.focus === 'function') target.focus();
    }
  }

  function clearCart() {
    if (orderLocked()) return;
    lines = [];
    notice = '';
    resetOrder();
    clearStorage();
    render();
  }

  function resetOrder() {
    order = null;
    phase = 'cart';
  }

  function blockedByMenuChange() {
    return lines.some(function (line) { return line.gone; });
  }

  /* ------------------------------------------------------------------ *
   * menu bridge, used by script.js
   * ------------------------------------------------------------------ */

  function setMenu(items) {
    var taken = new Set();
    menuItems = new Map();

    (items || []).forEach(function (item, index) {
      var key = itemKey(item, index, taken);
      taken.add(key);
      item.cartKey = key;
      menuItems.set(key, item);
    });

    var repriced = 0;
    var gone = 0;

    lines.forEach(function (line) {
      var item = menuItems.get(line.key);
      if (!item) {
        line.gone = true;
        gone += 1;
        return;
      }
      line.gone = false;
      line.name = item.name;
      var paise = toPaise(item.price);
      if (paise !== null && paise !== line.pricePaise) {
        line.pricePaise = paise;
        repriced += 1;
      }
    });

    var parts = [];
    if (repriced) parts.push(repriced + (repriced === 1 ? ' price changed' : ' prices changed'));
    if (gone) parts.push(gone + (gone === 1 ? ' item is' : ' items are') + ' no longer on the menu');
    notice = parts.join(' and ');
    if (notice) save();

    syncCards();
    render();
  }

  function makeAddButton(item) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'card__add';
    button.setAttribute('data-add', item.cartKey || itemKey(item, 0, null));
    return button;
  }

  function syncCards() {
    if (!dom.menu || typeof dom.menu.querySelectorAll !== 'function') return;

    Array.prototype.forEach.call(dom.menu.querySelectorAll('[data-add]'), function (button) {
      var key = button.getAttribute('data-add');
      var item = menuItems.get(key);
      var name = item ? item.name : 'Item';
      var qty = qtyOf(key);

      if (orderLocked()) {
        button.disabled = true;
        button.className = qty > 0 ? 'card__add card__add--in' : 'card__add';
        button.textContent = qty > 0 ? 'Ordered \u00b7 ' + qty : 'Order pending';
        button.setAttribute('aria-label', 'An order is already in progress. Finish it before starting another.');
        return;
      }
      button.disabled = false;

      if (qty > 0) {
        button.className = 'card__add card__add--in';
        button.textContent = 'In cart \u00b7 ' + qty;
        button.setAttribute('aria-label', name + ': ' + qty + ' in your order. Change quantity in the cart.');
      } else {
        button.className = 'card__add';
        button.textContent = 'Add';
        button.setAttribute('aria-label', 'Add ' + name + ' to your order');
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * rendering
   * ------------------------------------------------------------------ */

  function say(node, message, tone) {
    if (!node) return;
    node.textContent = message || '';
    node.className = tone ? 'note note--' + tone : 'note';
    node.hidden = !message;
  }

  function announce(message) {
    if (dom.cartLive) dom.cartLive.textContent = message;
  }

  function renderBar() {
    if (!dom.cartBar) return;
    var count = itemCount();
    var pendingOrder = phase === 'awaiting-payment' && order;
    dom.cartBar.hidden = count === 0 && !pendingOrder;
    if (pendingOrder) {
      if (dom.cartBarCount) dom.cartBarCount.textContent = 'Order pending';
      if (dom.cartBarTotal) dom.cartBarTotal.textContent = money(order.totalPaise);
      return;
    }
    if (dom.cartBarCount) dom.cartBarCount.textContent = count + (count === 1 ? ' item' : ' items');
    if (dom.cartBarTotal) dom.cartBarTotal.textContent = money(totalPaise());
  }

  function renderLines() {
    if (!dom.cartLines) return;
    dom.cartLines.textContent = '';
    rowIndex = new Map();

    if (!lines.length) {
      if (dom.cartEmpty) dom.cartEmpty.hidden = false;
      return;
    }
    if (dom.cartEmpty) dom.cartEmpty.hidden = true;

    var fragment = document.createDocumentFragment();

    lines.forEach(function (line) {
      var row = document.createElement('li');
      row.className = 'line' + (line.gone ? ' line--gone' : '');
      row.setAttribute('data-line', line.key);

      var name = document.createElement('p');
      name.className = 'line__name';
      name.textContent = line.name;
      row.appendChild(name);

      var each = document.createElement('p');
      each.className = 'line__each';
      each.textContent = money(line.pricePaise) + ' each';
      row.appendChild(each);

      if (line.gone) {
        var gone = document.createElement('p');
        gone.className = 'line__gone';
        gone.textContent = 'No longer on the menu';
        row.appendChild(gone);
      }

      var controls = document.createElement('div');
      controls.className = 'line__controls';

      var minus = document.createElement('button');
      minus.type = 'button';
      minus.className = 'step';
      minus.textContent = '\u2212';
      minus.setAttribute('data-step', line.key);
      minus.setAttribute('data-delta', '-1');
      minus.setAttribute('aria-label', 'One fewer ' + line.name);
      controls.appendChild(minus);

      var qty = document.createElement('span');
      qty.className = 'line__qty';
      qty.textContent = String(line.qty);
      qty.setAttribute('aria-label', line.name + ' quantity');
      controls.appendChild(qty);

      var plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'step';
      plus.textContent = '+';
      plus.setAttribute('data-step', line.key);
      plus.setAttribute('data-delta', '1');
      plus.setAttribute('aria-label', 'One more ' + line.name);
      controls.appendChild(plus);

      var drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'line__drop';
      drop.textContent = 'Remove';
      drop.setAttribute('data-remove', line.key);
      drop.setAttribute('aria-label', 'Remove ' + line.name + ' from your order');
      controls.appendChild(drop);

      row.appendChild(controls);
      fragment.appendChild(row);
      rowIndex.set(line.key, { row: row, qty: qty });
    });

    dom.cartLines.appendChild(fragment);
  }

  function showStep(next) {
    step = next;
    if (dom.stepCart) dom.stepCart.hidden = next !== 'cart';
    if (dom.stepEmail) dom.stepEmail.hidden = next !== 'email';
    if (dom.stepPay) dom.stepPay.hidden = next !== 'pay';
  }

  function render(keepRows) {
    if (!keepRows) renderLines();
    renderBar();
    syncCards();

    var count = itemCount();
    var blocked = blockedByMenuChange();

    if (dom.cartTotal) dom.cartTotal.textContent = money(totalPaise());
    if (dom.cartClear) {
      dom.cartClear.hidden = !count;
      dom.cartClear.disabled = orderLocked();
    }

    if (notice) {
      say(dom.cartNotice, notice + ' since you added them. Review the total before sending.', 'warn');
    } else {
      say(dom.cartNotice, '', null);
    }

    if (dom.cartStart) {
      dom.cartStart.disabled = count === 0 || blocked || orderLocked();
      dom.cartStart.textContent = blocked
        ? 'Remove unavailable items to continue'
        : orderLocked() ? 'Order in progress' : 'Continue';
    }

    var busy = phase === 'sending';

    if (dom.orderSubmit) {
      dom.orderSubmit.disabled = busy;
      dom.orderSubmit.textContent = phase === 'sending' ? 'Sending\u2026' : 'Send order';
    }
    if (dom.orderName) dom.orderName.disabled = busy;
    if (dom.orderEmail) dom.orderEmail.disabled = busy;

    if (dom.payTotal) dom.payTotal.textContent = order ? money(order.totalPaise) : money(totalPaise());
    if (dom.payId) dom.payId.textContent = order ? order.id : '';

    if (dom.orderAgain) {
      dom.orderAgain.hidden = phase !== 'placed' && phase !== 'awaiting-payment';
      dom.orderAgain.textContent = phase === 'awaiting-payment' ? 'Start a new order' : 'Order again';
    }
  }

  /* ------------------------------------------------------------------ *
   * drawer
   * ------------------------------------------------------------------ */

  function lockScroll(on) {
    var root = typeof document !== 'undefined' ? document.documentElement : null;
    if (!root) return;
    if (root.classList && typeof root.classList.toggle === 'function') {
      root.classList.toggle('is-locked', !!on);
    } else {
      root.className = on ? 'is-locked' : '';
    }
  }

  function openCart(nextStep) {
    if (!dom.cart) return;
    lastFocus = (typeof document !== 'undefined' && document.activeElement) || null;
    dom.cart.hidden = false;
    lockScroll(true);
    showStep(orderLocked() ? (phase === 'sending' ? 'email' : 'pay') : (nextStep || step));
    render();
    if (dom.cartClose && typeof dom.cartClose.focus === 'function') dom.cartClose.focus();
  }

  function closeCart() {
    if (!dom.cart) return;
    dom.cart.hidden = true;
    lockScroll(false);
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  function trapFocus(event) {
    if (!dom.cart || dom.cart.hidden || event.key !== 'Tab') return;
    if (typeof dom.cart.querySelectorAll !== 'function') return;

    var nodes = Array.prototype.filter.call(
      dom.cart.querySelectorAll('button, a[href], input, [tabindex]'),
      function (node) { return !node.disabled && node.getAttribute('tabindex') !== '-1'; }
    );
    if (!nodes.length) return;

    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    var active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      if (typeof last.focus === 'function') last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      if (typeof first.focus === 'function') first.focus();
    }
  }

  /* ------------------------------------------------------------------ *
   * order flow
   * ------------------------------------------------------------------ */

  function friendlyError() {
    return 'The order request could not be sent. Your cart is safe; please try again or ask a staff member.';
  }

  function snapshot(customerName, email) {
    return {
      id: makeOrderId(),
      customerName: customerName,
      email: email,
      totalPaise: totalPaise(),
      lines: lines.map(function (line) {
        return {
          key: line.key,
          name: line.name,
          pricePaise: line.pricePaise,
          qty: line.qty,
          gone: !!line.gone
        };
      }),
      createdAt: Date.now()
    };
  }

  function sameOrderRequest(saved, candidate) {
    if (!saved || saved.customerName !== candidate.customerName || saved.email !== candidate.email ||
        saved.totalPaise !== candidate.totalPaise || saved.lines.length !== candidate.lines.length) return false;
    return saved.lines.every(function (line, index) {
      var next = candidate.lines[index];
      return line.key === next.key && line.qty === next.qty && line.pricePaise === next.pricePaise;
    });
  }

  function backendPayload(order, website) {
    return {
      orderId: order.id,
      customerName: order.customerName,
      customerEmail: order.email,
      items: order.lines.map(function (line) {
        return { name: line.name, qty: line.qty, pricePaise: line.pricePaise };
      }),
      totalPaise: order.totalPaise,
      website: String(website || '')
    };
  }

  function simulate() {
    return new Promise(function (resolve) { setTimeout(resolve, 300); });
  }

  async function submitOrder(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (phase === 'sending') return;
    if (phase === 'awaiting-payment') {
      say(dom.payStatus, 'This order request was already sent. Check your email, or start a new order.', 'warn');
      return;
    }

    /* a bot fills every field it can see */
    if (dom.orderWebsite && String(dom.orderWebsite.value || '').trim()) {
      phase = 'placed';
      showStep('pay');
      say(dom.orderStatus, 'Order received. Please check your email for next steps.', 'ok');
      render();
      return;
    }

    var customerName = String((dom.orderName && dom.orderName.value) || '').trim();
    var email = String((dom.orderEmail && dom.orderEmail.value) || '').trim();

    /* checked before the empty-cart case, so an item the cafe removed is not
       reported back to the customer as "your cart is empty" */
    if (blockedByMenuChange()) {
      say(dom.orderStatus,
        'Something in your order is no longer on the menu. Please review your cart and remove it.',
        'warn');
      showStep('cart');
      render();
      return;
    }
    if (!itemCount()) {
      say(dom.orderStatus, 'Your cart is empty.', 'warn');
      showStep('cart');
      render();
      return;
    }
    if (!customerName || customerName.length > 100) {
      say(dom.orderStatus, 'Please enter your name (up to 100 characters).', 'warn');
      render();
      if (dom.orderName && typeof dom.orderName.focus === 'function') dom.orderName.focus();
      return;
    }
    if (!isEmail(email)) {
      say(dom.orderStatus, 'Please enter a valid email address, like name@example.com.', 'warn');
      render();
      if (dom.orderEmail && typeof dom.orderEmail.focus === 'function') dom.orderEmail.focus();
      return;
    }

    if (!demo && !backendReady()) {
      sayNotConfigured();
      return;
    }

    var candidate = snapshot(customerName, email);
    if (phase !== 'error' || !sameOrderRequest(order, candidate)) order = candidate;

    phase = 'sending';
    say(dom.orderStatus, 'Sending your order\u2026', null);
    render();
    try {
      var payload = backendPayload(order, dom.orderWebsite && dom.orderWebsite.value);
      if (demo) {
        await simulate();
        console.info('[cafe demo] Apps Script request not sent', payload);
      } else {
        await window.CafeOrderBackend.submit(payload);
      }
    } catch (err) {
      console.error('Order request failed:', err);
      phase = 'error';
      save();
      say(dom.orderStatus, friendlyError(), 'warn');
      render();
      return;
    }

    phase = demo ? 'placed' : 'awaiting-payment';
    lines = [];
    notice = '';
    if (demo) clearStorage();
    else save();
    say(dom.orderStatus, '', null);
    showStep('pay');
    render();
    say(dom.payStatus, demo
      ? 'Demo only: no order was sent and no email was sent. Configure Apps Script before accepting payment.'
      : 'Order request sent. Check your email for the order confirmation and UPI payment details before paying. Use the order ID as the payment reference.', 'ok');
    announce(demo
      ? 'Demo complete. No order was sent.'
      : 'Order request ' + order.id + ' sent. Check your email for confirmation and UPI payment details.');
  }

  function startNewOrder() {
    resetOrder();
    clearStorage();
    if (dom.orderName) dom.orderName.value = '';
    if (dom.orderEmail) dom.orderEmail.value = '';
    if (dom.orderWebsite) dom.orderWebsite.value = '';
    say(dom.payStatus, '', null);
    say(dom.orderStatus, '', null);
    showStep('cart');
    render();
  }

  /* ------------------------------------------------------------------ *
   * events
   * ------------------------------------------------------------------ */

  function onMenuClick(event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    var node = target.closest('[data-add]');
    if (!node) return;

    var result = add(node.getAttribute('data-add'), 1);
    if (result.ok) {
      announce(result.name + ' added. ' + result.qty + ' in your order.');
      openCart('cart');
    } else {
      announce(result.reason);
      say(dom.cartNotice, result.reason, 'warn');
    }
  }

  function onCartClick(event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    if (target.closest('[data-close]')) {
      closeCart();
      return;
    }

    var stepper = target.closest('[data-step]');
    if (stepper) {
      var key = stepper.getAttribute('data-step');
      var delta = parseInt(stepper.getAttribute('data-delta'), 10);
      var next = qtyOf(key) + (isFinite(delta) ? delta : 0);
      if (next > config.maxQtyPerLine) {
        announce('Maximum ' + config.maxQtyPerLine + ' of an item per order.');
        return;
      }
      setQty(key, next);
      return;
    }

    var drop = target.closest('[data-remove]');
    if (drop) remove(drop.getAttribute('data-remove'));
  }

  function onKeyDown(event) {
    if (!dom.cart || dom.cart.hidden) return;
    if (event.key === 'Escape') {
      closeCart();
      return;
    }
    trapFocus(event);
  }

  /* ------------------------------------------------------------------ *
   * boot
   * ------------------------------------------------------------------ */

  function init() {
    IDS.forEach(function (id) { dom[id] = document.getElementById(id); });
    if (!dom.cart) return;

    if (dom.cartBar) dom.cartBar.addEventListener('click', function () { openCart('cart'); });
    if (dom.cartClose) dom.cartClose.addEventListener('click', closeCart);
    if (dom.menu) dom.menu.addEventListener('click', onMenuClick);
    if (dom.cart) dom.cart.addEventListener('click', onCartClick);
    if (dom.cartStart) {
      dom.cartStart.addEventListener('click', function () {
        showStep('email');
        if (dom.orderEmail && typeof dom.orderEmail.focus === 'function') dom.orderEmail.focus();
      });
    }
    if (dom.cartClear) dom.cartClear.addEventListener('click', clearCart);
    if (dom.orderForm) dom.orderForm.addEventListener('submit', submitOrder);
    if (dom.orderAgain) dom.orderAgain.addEventListener('click', startNewOrder);
    document.addEventListener('keydown', onKeyDown);

    /* the drawer tells the stylesheet and the tests whether ordering is live */
    dom.cart.setAttribute('data-ready', orderable() ? 'true' : 'false');

    load();
    if (order && phase === 'awaiting-payment') {
      showStep('pay');
      say(dom.payStatus,
        'Your order request was sent. Check your email for the cafe\'s payment instructions. The cafe will email you after payment is verified.', 'ok');
    } else if (order && phase === 'error') {
      showStep('email');
      if (dom.orderName) dom.orderName.value = order.customerName || '';
      if (dom.orderEmail) dom.orderEmail.value = order.email;
      say(dom.orderStatus, 'The last request may not have reached the cafe. Retry to use the same order ID, or start a new order.', 'warn');
    }
    render();
  }

  /* ------------------------------------------------------------------ *
   * public surface
   * ------------------------------------------------------------------ */

  var api = {
    version: STORAGE_VERSION,

    /* pure, for the test suite */
    toPaise: toPaise,
    fromPaise: fromPaise,
    money: money,
    slug: slug,
    itemKey: itemKey,
    isEmail: isEmail,
    makeOrderId: makeOrderId,
    lineText: lineText,
    orderLinesText: orderLinesText,
    backendPayload: backendPayload,

    /* state, for the test suite */
    lines: function () { return lines.slice(); },
    totalPaise: totalPaise,
    itemCount: itemCount,
    qtyOf: qtyOf,
    phase: function () { return phase; },
    step: function () { return step; },
    order: function () { return order; },
    config: config,
    demoMode: function () { return demo; },
    backendReady: backendReady,
    orderable: orderable,
    storageAvailable: function () { return storageOk; },

    /* wiring used by script.js */
    setMenu: setMenu,
    makeAddButton: makeAddButton,
    syncCards: syncCards,
    add: add,
    setQty: setQty,
    remove: remove,
    clearCart: clearCart,
    openCart: openCart,
    closeCart: closeCart,
    submitOrder: submitOrder,
    startNewOrder: startNewOrder
  };

  if (typeof window !== 'undefined') {
    window.CafeOrder = api;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
}());
