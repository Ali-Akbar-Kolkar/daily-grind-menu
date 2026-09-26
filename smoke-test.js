const fs = require('fs');
const vm = require('vm');
const path = require('path');

const POC = __dirname;
const SCRIPT = fs.readFileSync(path.join(POC, 'script.js'), 'utf8');
const CSV = `Category,Item Name,Description,Price,Available,Tags
Coffee,Espresso,A double shot of our house blend. Sweet and balanced.,4.5,Yes,
Coffee,Flat White,Double ristretto with steamed milk and a thin layer of foam.,4.75,Yes,
Coffee,Cortado,Equal parts espresso and warm milk. Small and serious.,4,Yes,
Coffee,Filter of the Day,Rotating single origin brewed every twenty minutes.,4.25,Yes,V
Coffee,Cold Brew,Twelve hours in the fridge. Smooth and low acid.,5,Yes,V
Coffee,Seasonal Mocha,Maple and sea salt espresso. Ask if it is still on.,5.75,No,
Tea & Infusions,Masala Chai,House masala steeped with black tea and steamed milk.,4.75,Yes,V
Tea & Infusions,Sencha,Steamed Japanese green tea. Grassy and clean.,4,Yes,V
Tea & Infusions,Peppermint,"Loose leaf, naturally caffeine free.",3.5,Yes,caffeine free
Bakery,Croissant,Butter laminated over three days. Best before ten.,4.25,Yes,V
Bakery,Pain au Chocolat,"Baked with dark chocolate batons, 70% Valrhona.",4.75,Yes,V
Bakery,Almond Danish,Almond frangipane with a citrus glaze.,5.25,Yes,V
Bakery,Olive Oil Focaccia,Sea salt and rosemary. Warm from the tray.,4,Yes,V
Kitchen,Avocado Toast,"Sourdough, smashed avocado, pickled shallot, chilli oil.",11.5,Yes,V
Kitchen,Shakshuka,"Two baked eggs in a spiced tomato and pepper stew, with feta.",12,Yes,"V, GF"
Kitchen,Grilled Cheese,Three cheeses and honey mustard on country loaf.,10.5,Yes,V
Kitchen,Lentil Bowl,"Roasted squash, Puy lentils and tahini dressing. Add feta for 1.50.",13,Yes,"V, GF"
Kitchen,Chef's Sandwich,Whatever is left in the fridge. Ask before you order.,45,Yes,
Kitchen,Chef's Sandwich 1,Whatever is left in the fridge. Ask before you order to order,243,yes,`;

function makeNode(tag) {
  return {
    tagName: tag,
    className: '',
    _text: '',
    children: [],
    attrs: {},
    hidden: false,
    type: '',
    listeners: {},
    set textContent(value) {
      this._text = String(value);
      this.children = [];
    },
    get textContent() {
      return this._text + this.children.map((c) => c.textContent).join('');
    },
    appendChild(child) {
      this.children.push(child);
      return child;
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
}

function serialize(node) {
  if (node.tagName === undefined) return node._text;
  const cls = node.className ? ' class="' + node.className + '"' : '';
  if (node.children.length === 0 && !node._text) return '<' + node.tagName + cls + '>';
  const inner = (node._text ? node._text : '') + node.children.map((c) => serialize(c)).join('');
  return '<' + node.tagName + cls + '>' + inner + '</' + node.tagName + '>';
}

function buildSandbox({ respond }) {
  const byId = {};
  ['status', 'skeletons', 'menu', 'itemCount', 'lastUpdated', 'refresh'].forEach((id) => {
    byId[id] = makeNode('div');
  });

  const documentListeners = {};
  const sandbox = {
    console,
    Intl,
    Date,
    setTimeout,
    clearTimeout,
    AbortController,
    window: {},
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

function runCase({ name, respond, papaSource, configuredUrl }) {
  const { context, byId, documentListeners } = buildSandbox({ respond });
  context.window.MENU_CSV_URL = configuredUrl || '';
  if (papaSource) {
    context.window.Papa = vm.runInNewContext(papaSource, { window: {} });
  }

  vm.runInContext(SCRIPT, context, { filename: 'script.js' });

  const ready = documentListeners.DOMContentLoaded;
  if (!ready) throw new Error(name + ': script never registered DOMContentLoaded');
  return ready[0]().then(() => ({
    name,
    dom: byId,
    html: serialize(byId.menu),
    status: serialize(byId.status)
  }));
}

let failures = 0;
function check(label, condition, detail) {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok || !detail ? '' : '  -> ' + detail));
}

const okResponse = async () => ({ ok: true, status: 200, text: async () => CSV });
const CATEGORIES = ['Coffee', 'Tea & Infusions', 'Bakery', 'Kitchen'];

async function happyPath(name, papaSource) {
  const result = await runCase({ name, respond: okResponse, papaSource });
  const html = result.html;
  const cards = (html.match(/class="card"/g) || []).length;
  const positions = CATEGORIES.map((c) => html.indexOf('>' + c + '<'));
  const price = (html.match(/class="card__price">([^<]*)</) || [])[1];

  check(name + ': 18 available items rendered', cards === 18, cards + ' cards');
  check(name + ': 4 category sections',
    (html.match(/class="group"/g) || []).length === 4);
  check(name + ': category order preserved',
    positions.every((p) => p !== -1) && positions.every((p, i) => i === 0 || p > positions[i - 1]),
    JSON.stringify(positions));
  check(name + ': unavailable rows hidden',
    html.indexOf('Seasonal Mocha') === -1 && html.indexOf('Seasonal Galette') === -1);
  check(name + ': price formatted as currency', /^[\u00a3$€\u20ac\u00a5]?4\.50$/.test(price || ''), JSON.stringify(price));
  check(name + ': quoted comma field parsed whole',
    html.indexOf('Roasted squash, Puy lentils and tahini dressing. Add feta for 1.50.') !== -1);
  check(name + ': second quoted comma field parsed whole',
    html.indexOf('Baked with dark chocolate batons, 70% Valrhona.') !== -1);
  check(name + ': trailing unquoted comma cleaned',
    html.indexOf('Loose leaf, naturally caffeine free.') !== -1);
  check(name + ': tags rendered', html.indexOf('V \u00b7 GF') !== -1);
  check(name + ': chef specials retain their prices',
    /class="card__name">Chef's Sandwich<\/h3><p class="card__price">\$45\.00<\/p>/.test(html) &&
      /class="card__name">Chef's Sandwich 1<\/h3><p class="card__price">\$243\.00<\/p>/.test(html));
  check(name + ': count + updated line filled',
    result.dom.itemCount.textContent === '18 items' && /Updated /.test(result.dom.lastUpdated.textContent),
    result.dom.itemCount.textContent + ' | ' + result.dom.lastUpdated.textContent);
  check(name + ': aria-busy cleared', result.dom.menu.getAttribute('aria-busy') === 'false');
  check(name + ': skeletons hidden', result.dom.skeletons.hidden === true);
  check(name + ': status kept for screen readers only',
    result.dom.status.className === 'status status--sr' && result.dom.status.hidden === false,
    result.dom.status.className);
  check(name + ': refresh button revealed', result.dom.refresh.hidden === false);
  return result;
}

(async function main() {
  const fallback = await happyPath('fallback-parser');

  try {
    const res = await fetch('https://cdn.jsdelivr.net/npm/papaparse@5/papaparse.min.js');
    await happyPath('papaparse', await res.text());
  } catch (err) {
    console.log('SKIP  papaparse path (CDN unreachable: ' + err.message + ')');
  }

  const broken = await runCase({
    name: 'error-path',
    respond: async () => { throw new Error('network down'); }
  });
  check('error-path: friendly message shown', /could not reach the menu/i.test(broken.status), broken.status);
  check('error-path: retry button offered', /Try again/.test(broken.status));
  check('error-path: menu cleared and idle',
    broken.html.indexOf('class="card"') === -1 && broken.dom.menu.getAttribute('aria-busy') === 'false',
    broken.html + ' busy=' + broken.dom.menu.getAttribute('aria-busy'));
  check('error-path: skeletons hidden', broken.dom.skeletons.hidden === true);

  const empty = await runCase({
    name: 'empty-csv',
    respond: async () => ({ ok: true, status: 200, text: async () => 'a,b,c\n1,2,3\n' })
  });
  check('empty-csv: unreadable data reported', /empty or unreadable/i.test(empty.status), empty.status);

  const notFound = await runCase({
    name: 'http-404',
    respond: async () => ({ ok: false, status: 404, text: async () => '' })
  });
  check('http-404: non-ok response treated as failure',
    /could not reach the menu/i.test(notFound.status), notFound.status);

  const seen = [];
  let call = 0;
  const remote = await runCase({
    name: 'remote-cachebust',
    configuredUrl: 'https://docs.google.com/spreadsheets/d/e/FAKE/pub?gid=0&single=true&output=csv',
    respond: async (url) => {
      seen.push(url);
      call += 1;
      if (call === 1) return { ok: false, status: 500, text: async () => '' };
      return { ok: true, status: 200, text: async () => CSV };
    }
  });
  check('remote: cache-buster appended with &',
    seen.length === 2 && /output=csv&_=\d+$/.test(seen[0]), seen[0]);
  check('remote: retries original URL without buster',
    seen.length === 2 && seen[1].indexOf('_=') === -1, seen.join(' | '));
  check('remote: recovers on second attempt',
    (remote.html.match(/class="card"/g) || []).length === 18,
    (remote.html.match(/class="card"/g) || []).length + ' cards');

  if (process.env.SHOW_HTML) console.log('\n' + fallback.html.replace(/></g, '>\n<'));

  console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'all checks passed'));
  process.exitCode = failures ? 1 : 0;
}()).catch((err) => {
  console.error('harness crashed:', err);
  process.exitCode = 1;
});
