const fs = require('fs');
const vm = require('vm');
const path = require('path');

const POC = __dirname;
const SCRIPT = fs.readFileSync(path.join(POC, 'script.js'), 'utf8');
const IMAGE_URLS = fs.readFileSync(path.join(POC, 'image-urls.js'), 'utf8');
const SAMPLE_FILE = fs.existsSync(path.join(POC, '1menu-images.csv')) ? '1menu-images.csv' : 'menu-images.csv';
const CSV = fs.readFileSync(path.join(POC, SAMPLE_FILE), 'utf8');
const Images = require(path.join(POC, 'image-urls.js'));

const DATA_LINES = CSV.split(/\r?\n/).filter((line) => line.trim()).slice(1);
const photoCell = (line) => line.split(',').pop().trim();
const NO_PHOTO_ROWS = DATA_LINES.filter((line) => !photoCell(line)).length;
const BROKEN_ROWS = DATA_LINES.filter((line) => /example\.invalid/.test(photoCell(line))).length;
const FLAT_WHITE_LINE = DATA_LINES.find((line) => line.startsWith('Coffee,Flat White,'));
const FLAT_WHITE_IMAGE = photoCell(FLAT_WHITE_LINE || '');
const GSTATIC_IMAGE = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQb1OxoJy8BKWqmm-fMc9BGM2zEjlW45DaZLiHuWYbCKQ&s=10';

const FILE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const DRIVE_LINK = 'https://drive.google.com/file/d/' + FILE_ID + '/view?usp=sharing';

const DRIVE_CSV = [
  'Category,Item Name,Description,Price,Available,Tags,Image URL',
  'Bakery,Croissant,Butter laminated over three days.,4.25,Yes,,' + DRIVE_LINK
].join('\n');

const BROKEN_CSV = [
  'Category,Item Name,Description,Price,Available,Tags,Image',
  'Dessert,Mystery Cake,Test photo failure.,3,Yes,,https://example.invalid/not-a-real-image.jpg'
].join('\n');

const DIET_CSV = [
  'Category,Item Name,Description,Price,Available,Tags,Image',
  'Kitchen,Paneer Bowl,Vegetarian bowl.,10,Yes,V,',
  'Kitchen,Chicken Wrap,Grilled chicken wrap.,12,Yes,NV,',
  'Kitchen,Chicken Salad,Chicken with greens.,13,Yes,"NV, GF",',
  'Kitchen,Garden Salad,Greens and herbs.,9,Yes,GF,'
].join('\n');

function makeNode(tag) {
  const node = {
    tagName: tag,
    className: '',
    _text: '',
    children: [],
    attrs: {},
    hidden: false,
    type: '',
    value: '',
    listeners: {},
    set textContent(value) {
      this._text = String(value);
      this.children = [];
    },
    get textContent() {
      return this._text + this.children.map((child) => child.textContent).join('');
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    remove() {
      this.removed = true;
      this.listeners = {};
      return this;
    },
    setAttribute(key, value) {
      this.attrs[key] = String(value);
    },
    getAttribute(key) {
      return this.attrs[key];
    },
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    }
  };
  Object.defineProperty(node, 'src', {
    get() {
      return this.attrs.src || '';
    },
    set(value) {
      this.attrs.src = String(value);
    }
  });
  ['alt', 'loading', 'decoding', 'referrerPolicy', 'title'].forEach((prop) => {
    const key = prop.toLowerCase();
    Object.defineProperty(node, prop, {
      get() {
        return this.attrs[key] === undefined ? '' : this.attrs[key];
      },
      set(value) {
        this.attrs[key] = String(value);
      }
    });
  });
  return node;
}

function serialize(node) {
  if (node.tagName === undefined) return node._text;
  const cls = node.className ? ' class="' + node.className + '"' : '';
  const rest = Object.keys(node.attrs)
    .map((key) => ' ' + key + '="' + node.attrs[key] + '"')
    .join('');
  const inner = (node._text ? node._text : '') + node.children.map((child) => serialize(child)).join('');
  return '<' + node.tagName + cls + rest + '>' + inner + '</' + node.tagName + '>';
}

const ELEMENT_IDS = [
  'status', 'skeletons', 'menu', 'itemCount', 'lastUpdated', 'imageSummary', 'refresh',
  'bench', 'useFirstPhoto', 'testInput', 'testWidth', 'testRun', 'testResults', 'testVerdict',
  'testEmbed', 'testEmbedCode', 'testCopy'
];

function buildSandbox({ respond, search = '?bench=1', protocol = 'https:' }) {
  const byId = {};
  ELEMENT_IDS.forEach((id) => {
    byId[id] = makeNode('div');
  });
  byId.testInput.value = '';
  byId.testWidth.value = '800';

  const documentListeners = {};
  const sandbox = {
    console,
    Intl,
    Date,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    AbortController,
    navigator: { clipboard: { writeText: async () => {} } },
    /* The image test bench is opt-in on the live page (?bench=1), so the
       harness asks for it the way a developer would. Without this the bench
       nodes are torn out of the DOM and the bench checks cannot run. */
    window: { location: { search, protocol } },
    document: {
      readyState: 'loading',
      createElement: makeNode,
      createTextNode: (text) => ({ _text: String(text), textContent: String(text) }),
      createDocumentFragment: () => makeNode('#fragment'),
      getElementById: (id) => byId[id],
      addEventListener: (type, fn) => {
        (documentListeners[type] = documentListeners[type] || []).push(fn);
      }
    },
    fetch: async (url) => respond(url)
  };

  return { context: vm.createContext(sandbox), byId, documentListeners };
}

function probeStub(matcher) {
  return async (url) => Boolean(matcher(url));
}

const flush = async (ticks = 12) => {
  for (let i = 0; i < ticks; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

async function runCase({ respond, papaSource, configuredUrl, probe, loadImageUrls = true, search, protocol }) {
  const { context, byId, documentListeners } = buildSandbox({ respond, search, protocol });
  context.window.MENU_CSV_URL = configuredUrl || '';
  if (loadImageUrls) {
    vm.runInContext(IMAGE_URLS, context, { filename: 'image-urls.js' });
    if (probe) context.window.MenuImages.probeImage = probeStub(probe);
  }
  if (papaSource) {
    context.window.Papa = vm.runInNewContext(papaSource, { window: {} });
  }

  vm.runInContext(SCRIPT, context, { filename: 'script.js' });
  await flush();

  const ready = documentListeners.DOMContentLoaded;
  if (!ready) {
    return {
      name: 'no-bootstrap',
      dom: byId,
      html: serialize(byId.menu),
      status: serialize(byId.status)
    };
  }
  await ready[0]();
  await flush();
  return {
    name: 'loaded',
    dom: byId,
    html: serialize(byId.menu),
    status: serialize(byId.status)
  };
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

const okResponse = async () => ({ ok: true, status: 200, text: async () => CSV });
const CATEGORIES = ['Coffee', 'Tea & Infusions', 'Bakery', 'Kitchen'];
const HAPPY_PROBE = (url) => !/example\.invalid/.test(url);

(async function main() {
  section('image-urls.js: extractFileId');
  [
    [FILE_ID, FILE_ID],
    ['https://drive.google.com/file/d/' + FILE_ID + '/view?usp=sharing', FILE_ID],
    ['https://drive.google.com/file/d/' + FILE_ID + '/preview', FILE_ID],
    ['https://drive.google.com/uc?export=view&id=' + FILE_ID, FILE_ID],
    ['https://drive.google.com/thumbnail?id=' + FILE_ID + '&sz=w800', FILE_ID],
    ['https://lh3.googleusercontent.com/d/' + FILE_ID + '=w800', FILE_ID],
    ['  ' + FILE_ID + '  ', FILE_ID]
  ].forEach((pair) => {
    check('id from ' + JSON.stringify(pair[0]).slice(0, 52),
      Images.extractFileId(pair[0]) === pair[1], String(Images.extractFileId(pair[0])));
  });
  check('folder link yields no file id',
    Images.extractFileId('https://drive.google.com/drive/folders/' + FILE_ID) === null);
  check('foreign url yields no file id',
    Images.extractFileId('https://picsum.photos/seed/x/640/420') === null);
  check('blank yields no file id', Images.extractFileId('') === null);

  section('image-urls.js: classify');
  check('blank cell is empty', Images.classify('').kind === 'empty');
  check('foreign https url is direct', Images.classify('https://picsum.photos/seed/x/640/420').kind === 'direct');
  check('drive share link is a drive file',
    Images.classify(DRIVE_LINK).kind === 'drive' && Images.classify(DRIVE_LINK).fileId === FILE_ID);
  check('bare id is a drive file', Images.classify(FILE_ID).fileId === FILE_ID);
  check('drive folder is flagged', Images.classify('https://drive.google.com/drive/folders/' + FILE_ID).kind === 'folder');
  check('pasted html is unknown', Images.classify('<img src="x.jpg">').kind === 'unknown');
  check('drive host with no id is unknown',
    Images.classify('https://drive.google.com/about').kind === 'unknown');

  section('image-urls.js: what =IMAGE() publishes');
  check('a published gstatic thumbnail is classified as direct',
    Images.classify(GSTATIC_IMAGE).kind === 'direct');
  check('a gstatic thumbnail is used exactly as published',
    Images.candidates(GSTATIC_IMAGE)[0] === GSTATIC_IMAGE, Images.candidates(GSTATIC_IMAGE)[0]);
  check('query strings and ampersands survive',
    Images.candidates('https://example.com/a.jpg?w=600&h=400').join() === 'https://example.com/a.jpg?w=600&h=400');

  section('image-urls.js: candidate chain');
  const chain = Images.candidates(DRIVE_LINK);
  check('five forms offered for a drive file', chain.length === 5, String(chain.length));
  check('cdn form is first and sized',
    chain[0] === 'https://lh3.googleusercontent.com/d/' + FILE_ID + '=w800', chain[0]);
  check('thumbnail form is second',
    chain[1] === 'https://drive.google.com/thumbnail?id=' + FILE_ID + '&sz=w800', chain[1]);
  check('classic uc form is last',
    chain[4] === 'https://drive.google.com/uc?export=view&id=' + FILE_ID, chain[4]);
  check('width is honoured',
    Images.candidates(DRIVE_LINK, { width: 400 })[0].indexOf('=w400') !== -1);
  check('direct url is passed through untouched',
    Images.candidates('https://picsum.photos/seed/x/640/420').length === 1);
  check('empty cell offers nothing', Images.candidates('').length === 0);
  check('folder offers nothing', Images.candidates('https://drive.google.com/drive/folders/' + FILE_ID).length === 0);
  check('pasted html offers nothing', Images.candidates('<img src="x.jpg">').length === 0);
  check('embed url built from id',
    Images.embedUrl(FILE_ID) === 'https://drive.google.com/file/d/' + FILE_ID + '/preview');
  check('iframe snippet wraps the embed url',
    Images.iframeSnippet(DRIVE_LINK).indexOf('/preview" width="640"') !== -1);

  section('image-urls.js: resolveFirst');
  const tries = [];
  const second = await Images.resolveFirst(chain, async (url) => {
    tries.push(url);
    return url === chain[2];
  });
  check('stops at the first form that loads',
    second.url === chain[2] && second.index === 2, JSON.stringify(second.index));
  check('does not probe past the winner', tries.length === 3, String(tries.length));

  const none = await Images.resolveFirst(chain, async () => false);
  check('all failures report no url', none.url === null && none.index === -1);
  check('all failures are still recorded', none.attempts.length === 5, String(none.attempts.length));

  const threw = await Images.resolveFirst(chain, async (url) => {
    if (url === chain[0]) throw new Error('boom');
    return true;
  });
  check('a throwing probe is treated as a miss', threw.url === chain[1], String(threw.index));

  section('menu rendering with photos');
  const menu = await runCase({ respond: okResponse, probe: HAPPY_PROBE });
  const html = menu.html;
  const cards = (html.match(/class="card"/g) || []).length;
  const positions = CATEGORIES.map((name) => html.indexOf('>' + name + '<'));

  const counted = (html.match(/class="group__count">(\d+) items?/g) || []).reduce(
    (sum, chunk) => sum + parseInt(chunk.replace(/\D+/g, ''), 10), 0);
  const attempted = cards - NO_PHOTO_ROWS;
  const expectedTally = (attempted - BROKEN_ROWS) + '/' + attempted + ' photos loaded' +
    (BROKEN_ROWS ? ' \u00b7 ' + BROKEN_ROWS + ' failed' : '');

  check('every category heading adds up to the card count', counted === cards, counted + ' vs ' + cards);
  check('both unavailable rows are hidden', cards === DATA_LINES.length - 2,
    cards + ' of ' + DATA_LINES.length + ' sheet rows');
  check('4 category sections', (html.match(/class="group"/g) || []).length === 4);
  check('category order preserved',
    positions.every((p) => p !== -1) && positions.every((p, i) => i === 0 || p > positions[i - 1]),
    JSON.stringify(positions));
  check('unavailable row hidden', html.indexOf('Seasonal Mocha') === -1);
  check('price formatted as currency', /class="card__price">\$4\.75</.test(html));
  check('quoted comma field parsed whole',
    html.indexOf('Roasted squash, Puy lentils and tahini dressing. Add feta for 1.50.') !== -1);
  check('sample image URL is rendered from the CSV unchanged',
    Boolean(FLAT_WHITE_IMAGE) && html.indexOf('src="' + FLAT_WHITE_IMAGE + '"') !== -1);
  check('photo alt text uses the item name', html.indexOf('alt="Flat White"') !== -1);
  check('photo is lazy loaded', html.indexOf('loading="lazy"') !== -1);
  check('rows without a photo get a placeholder',
    (html.match(/card__media card__media--none/g) || []).length === NO_PHOTO_ROWS,
    (html.match(/card__media card__media--none/g) || []).length + ' vs ' + NO_PHOTO_ROWS + ' blank cells');
  check('photo tally reported in masthead',
    menu.dom.imageSummary.textContent === expectedTally, menu.dom.imageSummary.textContent);
  check('menu status and count still correct',
    menu.dom.itemCount.textContent === cards + ' items' && menu.dom.menu.getAttribute('aria-busy') === 'false',
    menu.dom.itemCount.textContent);
  check('skeletons hidden', menu.dom.skeletons.hidden === true);
  check('refresh revealed', menu.dom.refresh.hidden === false);

  const brokenImageMenu = await runCase({
    respond: async () => ({ ok: true, status: 200, text: async () => BROKEN_CSV }),
    probe: () => false
  });
  check('unavailable image is marked failed',
    brokenImageMenu.html.indexOf('card__media card__media--failed') !== -1);
  check('failed image records what it tried',
    /title="No Drive URL form loaded[^\"]*example\.invalid/.test(brokenImageMenu.html));

  const dietMenu = await runCase({
    respond: async () => ({ ok: true, status: 200, text: async () => DIET_CSV }),
    probe: HAPPY_PROBE
  });
  check('V tag displays the vegetarian mark',
    /class="card__diet card__diet--veg"[^>]*aria-label="Vegetarian"/.test(dietMenu.html));
  check('NV tag displays the non-vegetarian mark',
    /class="card__diet card__diet--non-veg"[^>]*aria-label="Non-vegetarian"/.test(dietMenu.html));
  check('V and NV codes are not repeated in the general tag text',
    !/class="card__tag">(?:V|NV)(?: ·|<)/.test(dietMenu.html));
  check('other tags remain visible alongside the non-vegetarian mark',
    /class="card__tag">GF</.test(dietMenu.html));
  check('unmarked items do not receive a food-type mark',
    (dietMenu.html.match(/class="card__diet card__diet--/g) || []).length === 3);

  section('fallback chain in the rendered card');
  const fallback = await runCase({
    respond: async () => ({ ok: true, status: 200, text: async () => DRIVE_CSV }),
    probe: (url) => /drive\.google\.com\/thumbnail\?/.test(url)
  });
  check('falls through to the thumbnail form',
    fallback.html.indexOf('src="https://drive.google.com/thumbnail?id=' + FILE_ID + '&sz=w800"') !== -1,
    fallback.html.slice(0, 400));
  check('failed forms are not left on the card',
    fallback.html.indexOf('lh3.googleusercontent.com') === -1);
  check('tally counts the single successful photo',
    fallback.dom.imageSummary.textContent === '1/1 photos loaded',
    fallback.dom.imageSummary.textContent);

  section('the bench is hidden from customers');
  {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

    check('the bench ships hidden, so a cafe customer never sees it',
      /<section[^>]*id="bench"[^>]*\bhidden\b/.test(html) ||
      /<section[^>]*\bhidden\b[^>]*id="bench"/.test(html),
      (/<section[^>]*id="bench"[^>]*>/.exec(html) || ['(no bench section)'])[0]);
    check('the menu markup is unaffected by the bench being hidden',
      /id="menu"/.test(html) && /id="cartBar"/.test(html));
  }

  section('test bench');
  const bench = await runCase({ respond: okResponse, probe: HAPPY_PROBE });
  check('?bench=1 brings it back for a developer',
    bench.dom.bench && bench.dom.bench.hidden === false,
    bench.dom.bench ? 'hidden=' + bench.dom.bench.hidden : 'no bench node');

  {
    /* and confirm the gate really does hide it, rather than the bench merely
       starting hidden and being shown unconditionally */
    const noFlag = await runCase({
      respond: okResponse,
      probe: HAPPY_PROBE,
      search: ''
    });
    check('without ?bench=1 the bench node is removed from the page',
      noFlag.dom.bench === undefined || noFlag.dom.bench.removed === true,
      noFlag.dom.bench ? 'still present' : 'removed');
    check('and the menu still renders with the bench gone',
      noFlag.dom.menu && noFlag.dom.menu.children.length > 0,
      String(noFlag.dom.menu && noFlag.dom.menu.children.length));
  }

  const setInput = (value) => {
    bench.dom.testInput.value = value;
    return bench.dom.testRun.listeners.click[0]();
  };

  await setInput(DRIVE_LINK);
  check('all five forms probed',
    (serialize(bench.dom.testResults).match(/class="probe /g) || []).length === 5,
    serialize(bench.dom.testResults).split('<li').length - 1 + ' rows');
  check('verdict names the winning candidate',
    bench.dom.testVerdict.textContent.indexOf('Works. Candidate 1 of 5') === 0,
    bench.dom.testVerdict.textContent);
  check('probe rows record timing',
    /loaded in \d+ ms/.test(serialize(bench.dom.testResults)));
  check('embed snippet offered for a drive file',
    bench.dom.testEmbed.hidden === false &&
      bench.dom.testEmbedCode.textContent.indexOf('/preview') !== -1);
  check('empty input is explained',
    (await setInput(''), bench.dom.testVerdict.textContent.indexOf('Paste a Drive share link') === 0),
    bench.dom.testVerdict.textContent);
  check('pasted html is called out',
    (await setInput('<img src="x.jpg">'), /pasted HTML/.test(bench.dom.testVerdict.textContent)),
    bench.dom.testVerdict.textContent);
  check('folder link is called out',
    (await setInput('https://drive.google.com/drive/folders/' + FILE_ID), /folder/.test(bench.dom.testVerdict.textContent)),
    bench.dom.testVerdict.textContent);

  const dead = await runCase({ respond: okResponse, probe: () => false });
  dead.dom.testInput.value = DRIVE_LINK;
  await dead.dom.testRun.listeners.click[0]();
  check('total failure is explained',
    dead.dom.testVerdict.textContent.indexOf('None of the 5 URL forms loaded') === 0,
    dead.dom.testVerdict.textContent);
  check('total failure still offers the iframe',
    dead.dom.testEmbed.hidden === false);

  section('papaparse path');
  try {
    const res = await fetch('https://cdn.jsdelivr.net/npm/papaparse@5/papaparse.min.js');
    const withPapa = await runCase({ respond: okResponse, probe: HAPPY_PROBE, papaSource: await res.text() });
    check('same result with papaparse',
      (withPapa.html.match(/class="card"/g) || []).length === cards &&
        withPapa.dom.imageSummary.textContent === expectedTally,
      withPapa.dom.imageSummary.textContent);
  } catch (err) {
    console.log('SKIP  papaparse path (CDN unreachable: ' + err.message + ')');
  }

  section('failure paths');
  const broken = await runCase({
    respond: async () => {
      throw new Error('network down');
    },
    probe: HAPPY_PROBE
  });
  check('network failure is friendly', /could not reach the menu/i.test(broken.status), broken.status);
  check('retry offered', /Try again/.test(broken.status));
  check('menu cleared and idle',
    broken.html.indexOf('class="card"') === -1 && broken.dom.menu.getAttribute('aria-busy') === 'false');

  const empty = await runCase({
    respond: async () => ({ ok: true, status: 200, text: async () => 'a,b,c\n1,2,3\n' }),
    probe: HAPPY_PROBE
  });
  check('unreadable data reported', /empty or unreadable/i.test(empty.status), empty.status);

  const notFound = await runCase({
    respond: async () => ({ ok: false, status: 404, text: async () => '' }),
    probe: HAPPY_PROBE
  });
  check('404 treated as failure', /could not reach the menu/i.test(notFound.status), notFound.status);

  const noHelper = await runCase({ respond: okResponse, loadImageUrls: false });
  check('missing image-urls.js is reported',
    /image-urls\.js did not load/.test(noHelper.status), noHelper.status);

  const seen = [];
  let call = 0;
  const remote = await runCase({
    configuredUrl: 'https://docs.google.com/spreadsheets/d/e/FAKE/pub?gid=0&single=true&output=csv',
    respond: async (url) => {
      seen.push(url);
      call += 1;
      if (call === 1) return { ok: false, status: 500, text: async () => '' };
      return { ok: true, status: 200, text: async () => CSV };
    },
    probe: HAPPY_PROBE
  });
  check('cache-buster appended with &', seen.length === 2 && /output=csv&_=\d+$/.test(seen[0]), seen[0]);
  check('retries the original url', seen.length === 2 && seen[1].indexOf('_=') === -1, seen.join(' | '));
  check('recovers on the second attempt',
    (remote.html.match(/class="card"/g) || []).length === cards,
    (remote.html.match(/class="card"/g) || []).length + ' cards');

  console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'all checks passed'));
  process.exitCode = failures ? 1 : 0;
}()).catch((err) => {
  console.error('harness crashed:', err);
  process.exitCode = 1;
});
