/*
 * order.js - cart, EmailJS order email, manual payment wait, payment claim.
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
    emailjs: {
      serviceId: '',
      orderTemplateId: '',
      paymentTemplateId: '',
      receiptTemplateId: '',
      publicKey: ''
    },
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

  /* Treats unfilled EmailJS placeholders as unset. */
  function isReal(value) {
    return typeof value === 'string' &&
      value.length > 0 &&
      !/X{3,}|YOUR[_-]?NAME|PLACEHOLDER/i.test(value);
  }

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

  function emailReady() {
    return isReal(config.emailjs.serviceId) &&
      isReal(config.emailjs.orderTemplateId) &&
      isReal(config.emailjs.publicKey);
  }

  function paymentReady() {
    return emailReady() && isReal(config.emailjs.paymentTemplateId);
  }

  function receiptReady() {
    return emailReady() && isReal(config.emailjs.receiptTemplateId);
  }

  /* Exactly which values are unset, naming the site-config.js key for each.

     The customer only needs to be told ordering is off. The person actually
    fixing it needs to be told WHICH line to edit. The detail goes to the
    console, where the person debugging will find it, and stays off-screen. */
  function configProblem() {
    var e = config.emailjs || {};
    var missing = [];
    if (!isReal(e.serviceId)) missing.push('emailjs.serviceId');
    if (!isReal(e.orderTemplateId)) missing.push('emailjs.orderTemplateId');
    if (!isReal(e.paymentTemplateId)) missing.push('emailjs.paymentTemplateId');
    if (!isReal(e.publicKey)) missing.push('emailjs.publicKey');
    if (!sdkReady()) missing.push('the emailjs SDK script tag');
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

  function sdkReady() {
    return Boolean(typeof window !== 'undefined' && window.emailjs &&
      typeof window.emailjs.send === 'function');
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
    return demo || (paymentReady() && sdkReady());
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
    return 'ORD-' + stamp + '-' + (salt || randomChunk(4));
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

  /*
   * The order email must reach the owner, so its To field is a fixed address
   * set in the EmailJS template. There is deliberately no to_email here: if the
   * owner ever pointed the template at {{to_email}}, the order would be
   * delivered to the customer instead of the cafe.
   */
  function orderEmailParams(order) {
    var count = (order.lines || []).reduce(function (sum, line) { return sum + line.qty; }, 0);
    return {
      order_id: order.id,
      customer_email: order.email,
      reply_to: order.email,
      order_lines: orderLinesText(order.lines),
      order_count: String(count),
      order_total: (order.totalPaise / 100).toFixed(2),
      order_total_display: money(order.totalPaise),
      currency: config.currency,
      subject: 'New order ' + order.id + ' - ' + money(order.totalPaise),
      placed_at: new Date(order.createdAt).toISOString()
    };
  }

  /* owner alert: "a customer says they paid". To is fixed in the template. */
  function paymentEmailParams(order, claimedAt) {
    return {
      order_id: order.id,
      customer_email: order.email,
      order_total: (order.totalPaise / 100).toFixed(2),
      order_total_display: money(order.totalPaise),
      currency: config.currency,
      order_lines: orderLinesText(order.lines),
      claimed_at: new Date(claimedAt).toISOString(),
      subject: 'Payment Claimed - Order ' + order.id
    };
  }

  /* customer receipt. This template's To field must be {{to_email}}. */
  function receiptEmailParams(order, claimedAt) {
    var params = paymentEmailParams(order, claimedAt);
    params.to_email = order.email;
    params.subject = 'Your order ' + order.id + ' - paid, being confirmed';
    return params;
  }

  /* ------------------------------------------------------------------ *
   * state
   * ------------------------------------------------------------------ */

  var IDS = [
    'menu', 'cartBar', 'cartBarCount', 'cartBarTotal', 'cart', 'cartClose',
    'stepCart', 'cartLines', 'cartEmpty', 'cartTotal', 'cartNotice', 'cartStart',
    'cartClear', 'stepEmail', 'orderForm', 'orderEmail', 'orderWebsite',
    'orderSubmit', 'orderStatus', 'stepPay', 'payTotal', 'payId',
    'claimBtn', 'payStatus', 'orderAgain', 'cartLive'
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
        order: order && (phase === 'awaiting-payment' || phase === 'claiming') ? {
          id: order.id,
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
      phase = 'awaiting-payment';
    }
  }

  function isValidOrder(saved) {
    var createdAt = Number(saved && saved.createdAt);
    var declaredTotal = Number(saved && saved.totalPaise);
    if (!saved || typeof saved.id !== 'string' || !/^ORD-[A-Z0-9-]+$/.test(saved.id) ||
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
    return phase === 'sending' || phase === 'awaiting-payment' || phase === 'claiming';
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
    dom.cartBar.hidden = count === 0;
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

    var busy = phase === 'sending' || phase === 'claiming';

    if (dom.orderSubmit) {
      dom.orderSubmit.disabled = busy;
      dom.orderSubmit.textContent = phase === 'sending' ? 'Sending\u2026' : 'Send order';
    }
    if (dom.orderEmail) dom.orderEmail.disabled = busy;

    if (dom.payTotal) dom.payTotal.textContent = order ? money(order.totalPaise) : money(totalPaise());
    if (dom.payId) dom.payId.textContent = order ? order.id : '';

    if (dom.claimBtn) {
      dom.claimBtn.disabled = phase !== 'awaiting-payment';
      dom.claimBtn.textContent = phase === 'claiming' ? 'Sending\u2026' : "I've paid";
    }
    if (dom.orderAgain) dom.orderAgain.hidden = phase !== 'placed';
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

  function friendlyError(err) {
    var text = err && (err.text || err.message) ? String(err.text || err.message) : '';
    if (/limit|quota|rate/i.test(text)) {
      return 'The cafe cannot receive order emails right now. Please try again later or tell a staff member.';
    }
    if (/not found|template|service|invalid/i.test(text)) {
      return 'The order email could not be sent. Please tell a staff member your order instead.';
    }
    return 'That did not send. Please try once more, or tell a staff member.';
  }

  function snapshot() {
    return {
      id: makeOrderId(),
      email: '',
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

  async function sendWithEmailJs(templateId, params) {
    if (typeof window.emailjs.init === 'function') window.emailjs.init(config.emailjs.publicKey);
    return window.emailjs.send(config.emailjs.serviceId, templateId, params);
  }

  function simulate() {
    return new Promise(function (resolve) { setTimeout(resolve, 300); });
  }

  async function submitOrder(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (phase === 'sending' || phase === 'claiming') return;
    if (phase === 'awaiting-payment') {
      say(dom.payStatus, 'Your order is already sent. Complete payment before starting another order.', 'warn');
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
    if (!isEmail(email)) {
      say(dom.orderStatus, 'Please enter a valid email address, like name@example.com.', 'warn');
      render();
      if (dom.orderEmail && typeof dom.orderEmail.focus === 'function') dom.orderEmail.focus();
      return;
    }

    if (!demo) {
      if (!paymentReady() || !sdkReady()) {
        sayNotConfigured();
        return;
      }
    }

    phase = 'sending';
    say(dom.orderStatus, 'Sending your order\u2026', null);
    render();

    order = snapshot();
    order.email = email;

    try {
      if (demo) {
        await simulate();
        console.info('[cafe demo] order email not sent', orderEmailParams(order));
      } else {
        await sendWithEmailJs(config.emailjs.orderTemplateId, orderEmailParams(order));
      }
    } catch (err) {
      console.error('Order email failed:', err);
      phase = 'error';
      say(dom.orderStatus, friendlyError(err), 'warn');
      render();
      return;
    }

    phase = 'awaiting-payment';
    save();
    say(dom.orderStatus, '', null);
    showStep('pay');
    render();
    say(dom.payStatus,
      'Order sent! Please check your email. The cafe will reply with a payment QR code shortly.', 'ok');
    announce('Order ' + order.id + ' sent. Check your email for a payment QR from the cafe.');
  }

  /* ------------------------------------------------------------------ *
   * payment claim
   * ------------------------------------------------------------------ */

  async function claimPayment(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (phase !== 'awaiting-payment' || !order) return;

    phase = 'claiming';
    say(dom.payStatus, 'Sending your payment confirmation to the cafe\u2026', null);
    render();

    var claimedAt = Date.now();
    order.claimedAt = claimedAt;

    try {
      if (demo) {
        await simulate();
        console.info('[cafe demo] payment email not sent', paymentEmailParams(order, claimedAt));
        if (config.copyToCustomer && receiptReady()) {
          console.info('[cafe demo] receipt not sent', receiptEmailParams(order, claimedAt));
        }
      } else {
        if (!paymentReady()) throw new Error('payment template is not configured');
        await sendWithEmailJs(config.emailjs.paymentTemplateId, paymentEmailParams(order, claimedAt));

        /* the owner already has the alert, so a failed receipt is not fatal */
        if (config.copyToCustomer && receiptReady()) {
          try {
            await sendWithEmailJs(config.emailjs.receiptTemplateId, receiptEmailParams(order, claimedAt));
          } catch (err) {
            console.warn('Receipt to customer failed:', err);
          }
        }
      }
    } catch (err) {
      console.error('Payment email failed:', err);
      phase = 'awaiting-payment';
      say(dom.payStatus,
        friendlyError(err) + ' Your cart is safe - press the button again once you have paid.', 'warn');
      render();
      return;
    }

    phase = 'placed';
    lines = [];
    notice = '';
    clearStorage();
    showStep('pay');
    say(dom.payStatus,
      'Thanks! Your payment notice was sent. The cafe will verify the payment before preparing your order.', 'ok');
    render();
    announce('Thanks. Order ' + order.id + ' is being confirmed by the cafe.');
  }

  function startNewOrder() {
    resetOrder();
    clearStorage();
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
    if (dom.claimBtn) dom.claimBtn.addEventListener('click', claimPayment);
    if (dom.orderAgain) dom.orderAgain.addEventListener('click', startNewOrder);
    document.addEventListener('keydown', onKeyDown);

    /* the drawer tells the stylesheet and the tests whether ordering is live */
    dom.cart.setAttribute('data-ready', orderable() ? 'true' : 'false');

    load();
    if (order && phase === 'awaiting-payment') {
      showStep('pay');
      say(dom.payStatus,
        'Your order was sent. Check your email for the cafe\'s payment QR, then come back here to confirm payment.', 'ok');
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
    orderEmailParams: orderEmailParams,
    paymentEmailParams: paymentEmailParams,
    receiptEmailParams: receiptEmailParams,
    isReal: isReal,

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
    emailReady: emailReady,
    paymentReady: paymentReady,
    receiptReady: receiptReady,
    sdkReady: sdkReady,
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
    claimPayment: claimPayment,
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
