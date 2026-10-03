(function () {
  'use strict';

  const CONFIG = {
    csvUrl: '',
    localSample: 'menu-images.csv',
    currency: window.MENU_CURRENCY || 'USD',
    locale: undefined,
    timeoutMs: 15000,
    bustCache: true,
    imageWidth: 800,
    imageTimeoutMs: 8000
  };

  const MenuImages = window.MenuImages || null;
  /* order.js is optional: the menu must still render if it fails to load */
  const CafeOrder = window.CafeOrder || null;

  const configured = String(window.MENU_CSV_URL || CONFIG.csvUrl || '').trim();
  const dataSource = configured || CONFIG.localSample;
  const isRemote = /^https?:/i.test(dataSource);

  const COLUMN_ALIASES = {
    category: ['category', 'categories', 'section', 'group', 'menucategory'],
    name: ['itemname', 'item', 'name', 'title', 'product'],
    description: ['description', 'desc', 'details', 'detail', 'info', 'notes'],
    price: ['price', 'cost', 'amount', 'rate'],
    available: ['available', 'availability', 'isavailable', 'instock', 'status', 'soldout'],
    tags: ['tags', 'tag', 'dietary', 'diet', 'labels'],
    image: ['image', 'imageurl', 'imagelink', 'photo', 'photourl', 'picture', 'thumbnail', 'img', 'imageid'],
    driveid: ['driveid', 'drivefileid', 'fileid', 'gdriveid']
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
  const imageCache = new Map();
  let imageStats = { attempted: 0, loaded: 0, failed: 0, noPhoto: 0 };
  let pendingImages = 0;
  let lastItems = [];

  function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function now() {
    return typeof performance === 'object' && performance && performance.now
      ? performance.now()
      : Date.now();
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
    const value = String(raw == null ? '' : raw).trim();
    if (!value) return null;
    const parsed = parseFloat(value.replace(/[^0-9.]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
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

  function dietaryType(tags) {
    for (let i = 0; i < tags.length; i += 1) {
      const code = normalizeKey(tags[i]);
      if (code === 'v') return 'veg';
      if (code === 'nv') return 'non-veg';
    }
    return '';
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
        tags: parseTags(cell('tags')),
        image: cell('image') || cell('driveid')
      });
    }
    return items;
  }

  function resetImageStats() {
    imageCache.clear();
    imageStats = { attempted: 0, loaded: 0, failed: 0, noPhoto: 0 };
    pendingImages = 0;
    updateImageSummary();
  }

  function updateImageSummary() {
    if (!dom.imageSummary) return;
    if (!imageStats.attempted) {
      dom.imageSummary.textContent = imageStats.noPhoto
        ? imageStats.noPhoto + (imageStats.noPhoto === 1 ? ' item has no photo' : ' items have no photo')
        : '';
      return;
    }
    if (pendingImages > 0) {
      dom.imageSummary.textContent = 'checking photos…';
      return;
    }
    const parts = [imageStats.loaded + '/' + imageStats.attempted + ' photos loaded'];
    if (imageStats.failed) parts.push(imageStats.failed + ' failed');
    dom.imageSummary.textContent = parts.join(' · ');
  }

  async function paintImage(media, img, list) {
    const key = list[0] + '|' + list.length;
    let pending = imageCache.get(key);
    if (!pending) {
      pending = MenuImages.resolveFirst(list, (url) => MenuImages.probeImage(url, CONFIG.imageTimeoutMs));
      imageCache.set(key, pending);
    }
    const settled = await pending;

    if (settled.url) {
      img.src = settled.url;
      img.addEventListener('load', () => {
        media.className = 'card__media card__media--ready';
      });
      img.addEventListener('error', () => {
        media.className = 'card__media card__media--failed';
        media.title = 'Probed OK but failed to paint: ' + settled.url;
      });
    } else {
      media.className = 'card__media card__media--failed';
      media.title = 'No Drive URL form loaded. Tried:\n' +
        settled.attempts.map((attempt) => ' - ' + attempt.url).join('\n');
    }

    imageStats.loaded += settled.url ? 1 : 0;
    imageStats.failed += settled.url ? 0 : 1;
    pendingImages -= 1;
    updateImageSummary();
  }

  function buildMedia(item) {
    const media = el('figure', 'card__media');
    const list = MenuImages.candidates(item.image, { width: CONFIG.imageWidth });

    if (!list.length) {
      media.className = 'card__media card__media--none';
      const note = el('span', 'card__media-note');
      note.textContent = MenuImages.classify(item.image).kind === 'folder'
        ? 'Drive folder link'
        : 'No photo';
      media.appendChild(note);
      imageStats.noPhoto += 1;
      return media;
    }

    const placeholder = el('span', 'card__media-ph');
    placeholder.setAttribute('aria-hidden', 'true');
    media.appendChild(placeholder);

    const img = el('img', 'card__photo');
    img.alt = item.name;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    media.appendChild(img);

    imageStats.attempted += 1;
    pendingImages += 1;
    paintImage(media, img, list);
    return media;
  }

  function buildCard(item) {
    const card = el('article', 'card');
    card.appendChild(buildMedia(item));

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

    const diet = dietaryType(item.tags);
    if (diet) {
      const badge = el('span', 'card__diet card__diet--' + diet);
      badge.setAttribute('role', 'img');
      badge.setAttribute('aria-label', diet === 'veg' ? 'Vegetarian' : 'Non-vegetarian');

      const mark = el('span', 'card__diet-mark');
      mark.setAttribute('aria-hidden', 'true');
      badge.appendChild(mark);

      const label = el('span', 'card__diet-label');
      label.textContent = diet === 'veg' ? 'Veg' : 'Non-veg';
      badge.appendChild(label);
      card.appendChild(badge);
    }

    if (item.description) {
      const desc = el('p', 'card__desc');
      desc.textContent = item.description;
      card.appendChild(desc);
    }
    const otherTags = item.tags.filter((tag) => {
      const code = normalizeKey(tag);
      return code !== 'v' && code !== 'nv';
    });
    if (otherTags.length) {
      const tag = el('p', 'card__tag');
      tag.textContent = otherTags.join(' \u00b7 ');
      card.appendChild(tag);
    }
    if (CafeOrder && item.price !== null) {
      const actions = el('div', 'card__actions');
      actions.appendChild(CafeOrder.makeAddButton(item));
      card.appendChild(actions);
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
    updateImageSummary();
    /* order.js re-prices anything already in the cart against this menu */
    if (CafeOrder) CafeOrder.setMenu(items);
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
    dom.imageSummary.textContent = '';

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
    lastItems = items;
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
    resetImageStats();

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

  function probeRow(url) {
    const row = el('li', 'probe');
    const thumb = el('img', 'probe__thumb');
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.referrerPolicy = 'no-referrer';
    row.appendChild(thumb);

    const body = el('div', 'probe__body');
    const labelNode = el('p', 'probe__url');
    labelNode.textContent = url;
    const chip = el('p', 'probe__chip');
    chip.textContent = 'testing…';
    body.appendChild(labelNode);
    body.appendChild(chip);
    row.appendChild(body);

    dom.testResults.appendChild(row);
    return { row, thumb, chip };
  }

  function showEmbed(fileId) {
    if (!dom.testEmbed) return;
    const snippet = MenuImages.iframeSnippet(fileId, 640, 400);
    if (!snippet) {
      dom.testEmbed.hidden = true;
      return;
    }
    dom.testEmbed.hidden = false;
    dom.testEmbedCode.textContent = snippet;
  }

  async function runTester() {
    const raw = String(dom.testInput.value || '').trim();
    const width = Number(dom.testWidth.value) || CONFIG.imageWidth;
    const info = MenuImages.classify(raw);

    dom.testResults.textContent = '';
    dom.testVerdict.textContent = '';
    dom.testEmbed.hidden = true;

    const list = MenuImages.candidates(raw, { width });
    if (info.kind === 'drive') showEmbed(info.fileId);

    if (!raw) {
      dom.testVerdict.textContent = 'Paste a Drive share link, a bare file ID, or any https image URL.';
      return;
    }
    if (/^\s*</.test(raw)) {
      dom.testVerdict.textContent = 'That is pasted HTML, not a URL. Put only the link or the file ID in the cell.';
      return;
    }
    if (!list.length) {
      dom.testVerdict.textContent = 'No usable image URL found in that value. Detected: ' +
        MenuImages.label(raw) + '.';
      return;
    }

    let firstOk = -1;
    for (let i = 0; i < list.length; i += 1) {
      const probe = probeRow(list[i]);
      const started = now();
      const ok = await MenuImages.probeImage(list[i], CONFIG.imageTimeoutMs);
      const ms = Math.max(0, Math.round(now() - started));
      probe.thumb.src = list[i];
      probe.row.className = 'probe probe--' + (ok ? 'ok' : 'fail');
      probe.chip.textContent = ok ? 'loaded in ' + ms + ' ms' : 'failed after ' + ms + ' ms';
      if (ok && firstOk === -1) firstOk = i;
    }

    if (firstOk === -1) {
      dom.testVerdict.textContent = 'None of the ' + list.length + ' URL forms loaded. If this is your file, ' +
        'open Share and set "Anyone with the link" to Viewer, then retest. If it is already shared, Drive is ' +
        'refusing cross-site <img> loads — use the embed iframe above or host the photo outside Drive.';
      return;
    }

    dom.testVerdict.textContent = 'Works. Candidate ' + (firstOk + 1) + ' of ' + list.length + ': ' +
      list[firstOk] + (firstOk === 0
        ? ' — first choice, nothing else needed.'
        : ' — candidates 1 to ' + firstOk + ' failed, so keep the fallback chain.');
  }

  async function copyEmbed() {
    const snippet = dom.testEmbedCode.textContent;
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
      dom.testCopy.textContent = 'Copied';
    } catch (err) {
      dom.testCopy.textContent = 'Copy failed — select the code manually';
    }
    setTimeout(() => {
      dom.testCopy.textContent = 'Copy iframe';
    }, 2000);
  }

  function fillTesterWith(item) {
    const first = items.find((entry) => entry.image);
    if (!first) return;
    dom.testInput.value = first.image;
    runTester();
  }

  /* The bench is a developer tool, so it is hidden on the live page and only
     revealed with ?bench=1. A cafe's customers should not be shown a form for
     pasting Drive URLs. It stays fully wired up either way. */
  function initBench() {
    dom.bench = document.getElementById('bench');
    dom.testInput = document.getElementById('testInput');
    dom.testWidth = document.getElementById('testWidth');
    dom.testRun = document.getElementById('testRun');
    dom.testResults = document.getElementById('testResults');
    dom.testVerdict = document.getElementById('testVerdict');
    dom.testEmbed = document.getElementById('testEmbed');
    dom.testEmbedCode = document.getElementById('testEmbedCode');
    dom.testCopy = document.getElementById('testCopy');

    if (!benchWanted()) {
      if (dom.bench) dom.bench.remove();
      return;
    }
    if (dom.bench) dom.bench.hidden = false;

    dom.testRun.addEventListener('click', runTester);
    dom.testInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') runTester();
    });
    dom.testCopy.addEventListener('click', copyEmbed);
  }

  function benchWanted() {
    const loc = window.location || {};
    if (/[?&]bench=1/.test(loc.search || '')) return true;
    /* opening the file locally is unambiguously a developer, so show it there */
    return loc.protocol === 'file:';
  }

  function init() {
    dom.status = document.getElementById('status');
    dom.skeletons = document.getElementById('skeletons');
    dom.menu = document.getElementById('menu');
    dom.count = document.getElementById('itemCount');
    dom.updated = document.getElementById('lastUpdated');
    dom.imageSummary = document.getElementById('imageSummary');
    dom.refresh = document.getElementById('refresh');
    dom.useFirstPhoto = document.getElementById('useFirstPhoto');

    dom.refresh.addEventListener('click', load);
    dom.useFirstPhoto.addEventListener('click', () => fillTesterWith(lastItems));
    initBench();

    if (!MenuImages) {
      showError('image-urls.js did not load, so photos cannot be resolved. Check the file is deployed.');
      return;
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', load);
    } else {
      load();
    }
  }

  init();
}());
