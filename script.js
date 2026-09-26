(function () {
  'use strict';

  const CONFIG = {
    csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vToUFJhDlT8H5SQG8CqSxfFzhYQ_KNmx9dL1SAIcOXNZiSI4I7CyD7zgjYOlbPt3ZtWWQEYjlglybPN/pub?gid=810010135&single=true&output=csv',
    localSample: 'menu.csv',
    currency: 'USD',
    locale: undefined,
    timeoutMs: 15000,
    bustCache: true
  };

  const PLACEHOLDER = 'PASTE_YOUR_PUBLISHED_CSV_URL_HERE';

  const configured = String(CONFIG.csvUrl || '').trim();
  const dataSource = configured && configured !== PLACEHOLDER ? configured : CONFIG.localSample;
  const isRemote = /^https?:/i.test(dataSource);

  const COLUMN_ALIASES = {
    category: ['category', 'categories', 'section', 'group', 'menucategory'],
    name: ['itemname', 'item', 'name', 'title', 'product'],
    description: ['description', 'desc', 'details', 'detail', 'info', 'notes'],
    price: ['price', 'cost', 'amount', 'rate'],
    available: ['available', 'availability', 'isavailable', 'instock', 'status', 'soldout'],
    tags: ['tags', 'tag', 'dietary', 'diet', 'labels']
  };

  const UNAVAILABLE = new Set(['no', 'n', 'false', '0', 'off', 'unavailable', 'soldout', 'x']);
  const AVAILABLE = new Set(['yes', 'y', 'true', '1', 'on', 'available', 'instock', 'instockonly']);

  let money = null;
  try {
    money = new Intl.NumberFormat(CONFIG.locale || undefined, {
      style: 'currency',
      currency: CONFIG.currency
    });
  } catch (err) {
    money = null;
  }

  const dom = {};

  function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function normalizeKey(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  function parseDelimited(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;

    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quoted) {
        if (ch !== '"') field += ch;
        else if (text[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch !== '\r') field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function parseCsv(text) {
    if (window.Papa && typeof window.Papa.parse === 'function') {
      const result = window.Papa.parse(text, { skipEmptyLines: true });
      return result && Array.isArray(result.data) ? result.data : [];
    }
    return parseDelimited(text);
  }

  function resolveColumns(row) {
    const map = {};
    row.forEach((cell, index) => {
      const key = normalizeKey(cell);
      if (!key) return;
      Object.keys(COLUMN_ALIASES).forEach((field) => {
        if (map[field] === undefined && COLUMN_ALIASES[field].indexOf(key) !== -1) {
          map[field] = index;
        }
      });
    });
    return map;
  }

  function isHeaderRow(row) {
    const map = resolveColumns(row);
    if (map.name === undefined) return false;
    return map.price !== undefined || map.category !== undefined || map.description !== undefined;
  }

  function parsePrice(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return null;
    const value = parseFloat(text.replace(/[^0-9.]/g, ''));
    return Number.isFinite(value) ? value : null;
  }

  function formatPrice(value) {
    if (money) return money.format(value);
    return value.toFixed(2);
  }

  function isAvailable(raw) {
    const value = normalizeKey(raw);
    if (!value) return true;
    if (UNAVAILABLE.has(value)) return false;
    if (AVAILABLE.has(value)) return true;
    return true;
  }

  function parseTags(raw) {
    return String(raw == null ? '' : raw)
      .split(/[|;,/]+/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  function buildItems(matrix) {
    const headerIndex = matrix.findIndex(isHeaderRow);
    if (headerIndex === -1) return [];

    const columns = resolveColumns(matrix[headerIndex]);
    const items = [];

    for (let i = headerIndex + 1; i < matrix.length; i += 1) {
      const row = matrix[i];
      const cell = (field) => (columns[field] === undefined ? '' : String(row[columns[field]] || '').trim());
      const name = cell('name');
      if (!name) continue;
      if (!isAvailable(cell('available'))) continue;

      items.push({
        category: cell('category') || 'Menu',
        name,
        description: cell('description'),
        price: parsePrice(cell('price')),
        tags: parseTags(cell('tags'))
      });
    }
    return items;
  }

  function buildCard(item) {
    const card = el('article', 'card');
    const head = el('div', 'card__head');
    const name = el('h3', 'card__name');
    name.textContent = item.name;
    head.appendChild(name);

    if (item.price !== null) {
      const price = el('p', 'card__price');
      price.textContent = formatPrice(item.price);
      head.appendChild(price);
    }
    card.appendChild(head);

    if (item.description) {
      const desc = el('p', 'card__desc');
      desc.textContent = item.description;
      card.appendChild(desc);
    }
    if (item.tags.length) {
      const tag = el('p', 'card__tag');
      tag.textContent = item.tags.join(' \u00b7 ');
      card.appendChild(tag);
    }
    return card;
  }

  function render(items) {
    const groups = new Map();
    items.forEach((item) => {
      if (!groups.has(item.category)) groups.set(item.category, []);
      groups.get(item.category).push(item);
    });

    const fragment = document.createDocumentFragment();

    groups.forEach((groupItems, category) => {
      const section = el('section', 'group');
      const heading = el('h2', 'group__title');
      heading.appendChild(document.createTextNode(category));

      const count = el('span', 'group__count');
      count.textContent = groupItems.length + (groupItems.length === 1 ? ' item' : ' items');
      heading.appendChild(count);

      const grid = el('div', 'menu-grid');
      groupItems.forEach((item) => grid.appendChild(buildCard(item)));

      section.appendChild(heading);
      section.appendChild(grid);
      fragment.appendChild(section);
    });

    dom.menu.textContent = '';
    dom.menu.appendChild(fragment);
  }

  function announce(message) {
    dom.status.textContent = message;
    dom.status.className = 'status status--sr';
    dom.status.hidden = false;
  }

  function showError(message) {
    dom.skeletons.hidden = true;
    dom.menu.setAttribute('aria-busy', 'false');
    dom.menu.textContent = '';
    dom.refresh.hidden = true;
    dom.count.textContent = '';
    dom.updated.textContent = '';

    dom.status.hidden = false;
    dom.status.className = 'status status--error';
    dom.status.textContent = '';

    const text = el('p', 'status__text');
    text.textContent = message;
    dom.status.appendChild(text);

    const actions = el('div', 'status__actions');
    const retry = el('button', 'btn');
    retry.type = 'button';
    retry.textContent = 'Try again';
    retry.addEventListener('click', load);
    actions.appendChild(retry);
    dom.status.appendChild(actions);
  }

  function setLoading() {
    dom.menu.setAttribute('aria-busy', 'true');
    dom.skeletons.hidden = false;
    dom.status.hidden = true;
    dom.status.textContent = '';
    dom.refresh.hidden = true;
  }

  function showMenu(items, loadedAt) {
    dom.skeletons.hidden = true;
    dom.menu.setAttribute('aria-busy', 'false');
    render(items);

    const plural = items.length === 1 ? 'item' : 'items';
    dom.count.textContent = items.length + ' ' + plural;
    dom.updated.textContent = 'Updated ' + loadedAt.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit'
    });
    dom.refresh.hidden = false;
    announce('Menu updated: ' + items.length + ' ' + plural + ' available.');
  }

  function withCacheBuster(url) {
    const joiner = url.indexOf('?') === -1 ? '?' : '&';
    return url + joiner + '_=' + Date.now();
  }

  async function fetchText(url) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), CONFIG.timeoutMs) : null;
    try {
      const response = await fetch(url, {
        signal: controller ? controller.signal : undefined,
        cache: 'no-store',
        redirect: 'follow'
      });
      if (!response.ok) throw new Error('Request failed with status ' + response.status);
      return await response.text();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function load() {
    setLoading();

    const urls = isRemote && CONFIG.bustCache ? [withCacheBuster(dataSource), dataSource] : [dataSource];
    let text;
    let lastError = null;

    for (let i = 0; i < urls.length; i += 1) {
      try {
        text = await fetchText(urls[i]);
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (text === undefined) {
      console.error('Menu fetch failed:', lastError);
      showError('We could not reach the menu just now. Please refresh in a moment.');
      return;
    }

    let items = [];
    try {
      items = buildItems(parseCsv(text));
    } catch (err) {
      console.error('Menu parse failed:', err);
    }

    if (!items.length) {
      showError('The menu is empty or unreadable right now. Please try again shortly.');
      return;
    }

    showMenu(items, new Date());
  }

  function init() {
    dom.status = document.getElementById('status');
    dom.skeletons = document.getElementById('skeletons');
    dom.menu = document.getElementById('menu');
    dom.count = document.getElementById('itemCount');
    dom.updated = document.getElementById('lastUpdated');
    dom.refresh = document.getElementById('refresh');

    dom.refresh.addEventListener('click', load);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', load);
    } else {
      load();
    }
  }

  init();
}());
