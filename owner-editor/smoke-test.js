const fs = require('fs');
const vm = require('vm');
const path = require('path');

const POC = __dirname;
const CODE = fs.readFileSync(path.join(POC, 'Code.gs'), 'utf8');
const HTML = fs.readFileSync(path.join(POC, 'Index.html'), 'utf8');

const OWNER = 'owner@example.com';

function sampleGrid() {
  return [
    ['The Daily Grind - menu'],
    ['Category', 'Item Name', 'Description', 'Price', 'Available', 'Tags', 'Image'],
    ['Coffee', 'Espresso', 'A double shot of our house blend.', 4.5, 'Yes', '', ''],
    ['Coffee', 'Flat White', 'Double ristretto with steamed milk.', 4.75, 'yes', '', ''],
    ['Tea & Infusions', 'Sencha', 'Steamped Japanese green tea.', 4, 'Yes', 'V', ''],
    ['Bakery', 'Croissant', 'Butter laminated over three days.', 4.25, 'Yes', 'V',
      'https://lh3.googleusercontent.com/d/1AbCdEfGhIjKlMnOpQrSt=w800'],
    ['Coffee', 'Seasonal Mocha', 'Maple and sea salt.', 5.75, 'No', '', '']
  ];
}

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }

  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r += 1) {
      const line = [];
      for (let c = 0; c < this.numCols; c += 1) {
        line.push(this.sheet.at(this.row + r, this.col + c));
      }
      out.push(line);
    }
    return out;
  }

  setValues(matrix) {
    for (let r = 0; r < this.numRows; r += 1) {
      for (let c = 0; c < this.numCols; c += 1) {
        const value = matrix[r] && matrix[r][c] !== undefined ? matrix[r][c] : '';
        this.sheet.put(this.row + r, this.col + c, value);
      }
    }
    this.sheet.writes += 1;
  }

  getValue() {
    return this.getValues()[0][0];
  }

  setValue(value) {
    this.setValues([[value]]);
  }
}

class FakeSheet {
  constructor(values, name) {
    this.name = name || 'Sheet1';
    this.values = (values || []).map((row) => row.slice());
    this.writes = 0;
  }

  at(row, col) {
    const line = this.values[row - 1];
    if (!line) return '';
    const value = line[col - 1];
    return value === undefined ? '' : value;
  }

  put(row, col, value) {
    while (this.values.length < row) this.values.push([]);
    const line = this.values[row - 1];
    while (line.length < col) line.push('');
    line[col - 1] = value;
  }

  getName() {
    return this.name;
  }

  getLastRow() {
    return this.values.length;
  }

  getLastColumn() {
    let width = 0;
    this.values.forEach((line) => {
      if (line.length > width) width = line.length;
    });
    return width;
  }

  getRange(row, col, numRows, numCols) {
    return new FakeRange(this, row, col, numRows || 1, numCols || 1);
  }

  deleteRow(row) {
    this.values.splice(row - 1, 1);
  }
}

class FakeBook {
  constructor(id, sheets) {
    this.id = id;
    this.sheets = sheets;
  }

  getId() {
    return this.id;
  }

  getSheets() {
    return this.sheets;
  }

  getSheetByName(name) {
    return this.sheets.filter((sheet) => sheet.name === name)[0] || null;
  }
}

function buildSource(patch) {
  const options = patch || {};
  return CODE
    .replace(/const SHEET_ID = '.*?';/,
      "const SHEET_ID = '" + (options.sheetId === undefined ? 'sheet-abc' : options.sheetId) + "';")
    .replace(/const SHEET_NAME = '.*?';/,
      "const SHEET_NAME = '" + (options.sheetName === undefined ? 'menu' : options.sheetName) + "';")
    .replace(/const OWNER_EMAIL = '.*?';/,
      "const OWNER_EMAIL = '" + (options.owner === undefined ? OWNER : options.owner) + "';");
}

function makeEnv(patch) {
  const options = patch || {};
  const sheet = new FakeSheet(options.grid || sampleGrid(), options.tabName || 'menu');
  const book = new FakeBook('sheet-abc', [sheet]);
  let uuids = 0;
  let locks = 0;

  const sandbox = {
    console,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Math,
    isFinite,
    parseFloat,
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return options.bound ? book : null;
      },
      openById(id) {
        sandbox.opened.push(id);
        return book;
      }
    },
    LockService: {
      getScriptLock() {
        locks += 1;
        let held = false;
        return {
          waitLock() {
            held = true;
          },
          tryLock() {
            held = true;
            return true;
          },
          releaseLock() {
            held = false;
          },
          isHeld() {
            return held;
          }
        };
      }
    },
    Session: {
      getActiveUser() {
        return {
          getEmail() {
            return options.email === undefined ? OWNER : options.email;
          }
        };
      }
    },
    Utilities: {
      getUuid() {
        uuids += 1;
        return 'uuid-' + uuids;
      }
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(content) {
        return {
          content,
          mime: '',
          setMimeType(value) {
            this.mime = value;
            return this;
          },
          getContent() {
            return this.content;
          }
        };
      }
    },
    HtmlService: {
      createHtmlOutputFromFile(file) {
        return {
          file,
          title: '',
          meta: {},
          setTitle(value) {
            this.title = value;
            return this;
          },
          addMetaTag(key, value) {
            this.meta[key] = value;
            return this;
          }
        };
      }
    },
    opened: []
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(buildSource(options), context, { filename: 'Code.gs' });

  return {
    context,
    sheet,
    book,
    uuids: () => uuids,
    locks: () => locks,
    opened: sandbox.opened,
    call(payload) {
      const out = context.doPost({ parameter: {}, postData: { contents: JSON.stringify(payload) } });
      return { mime: out.mime, data: JSON.parse(out.getContent()) };
    },
    raw(body) {
      const out = context.doPost({ parameter: {}, postData: { contents: body } });
      return JSON.parse(out.getContent());
    }
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

function findItem(env, name) {
  const state = env.call({ action: 'getState' }).data;
  return (state.items || []).filter((item) => item.name === name)[0];
}

(async function main() {
  section('getState: reading the sheet');
  const env = makeEnv();
  const first = env.call({ action: 'getState' });
  check('responds as json', first.mime === 'application/json', first.mime);
  check('opens the configured sheet', env.opened[0] === 'sheet-abc', env.opened.join(','));
  check('reports the tab name', first.data.sheetName === 'menu', first.data.sheetName);
  check('reports the signed-in owner', first.data.owner === OWNER, first.data.owner);
  check('title row above the header is ignored', first.data.items.length === 5,
    first.data.items.length + ' items');
  check('item id column created', first.data.itemIdColumn === true);
  check('id column header written to the sheet',
    env.sheet.at(2, 8) === 'Item ID', String(env.sheet.at(2, 8)));
  check('one uuid minted per existing row', env.uuids() === 5, String(env.uuids()));
  check('raw availability preserved, not normalised',
    first.data.items[1].available === 'yes', first.data.items[1].available);
  check('price comes back as a number', first.data.items[0].price === 4.5, String(first.data.items[0].price));
  check('image column read through', first.data.items[3].image.indexOf('googleusercontent') !== -1);
  check('every item has an id',
    first.data.items.every((item) => /^uuid-\d+$/.test(item.id)));

  const ids = first.data.items.map((item) => item.id);
  const writesAfterFirst = env.sheet.writes;
  const second = env.call({ action: 'getState' }).data;
  check('reopening is idempotent',
    second.items.map((item) => item.id).join() === ids.join() &&
      env.uuids() === 5 &&
      env.sheet.writes === writesAfterFirst,
    env.uuids() + ' uuids, ' + (env.sheet.writes - writesAfterFirst) + ' extra writes');

  section('saveItem: patching one row');
  const patch = makeEnv();
  const espresso = findItem(patch, 'Espresso');
  const before = JSON.parse(JSON.stringify(patch.sheet.values));

  const saved = patch.call({
    action: 'saveItem',
    id: espresso.id,
    base: espresso,
    values: { name: 'Espresso', price: '5.25', description: 'Now with a double origin.' }
  }).data;

  check('reports a patch, not a create', saved.mode === 'patched', saved.mode);
  check('reports the row it touched', saved.rowNumber === 3, String(saved.rowNumber));
  check('lists only the fields that changed',
    saved.fields.sort().join() === 'description,price', saved.fields.join());
  check('new price written as a number', patch.sheet.at(3, 4) === 5.25, String(patch.sheet.at(3, 4)));
  check('new description written', patch.sheet.at(3, 3) === 'Now with a double origin.');
  check('item id left alone', patch.sheet.at(3, 8) === espresso.id);
  check('untouched fields left alone', patch.sheet.at(3, 5) === 'Yes' && patch.sheet.at(3, 1) === 'Coffee');
  check('no rows added', patch.sheet.values.length === before.length,
    before.length + ' -> ' + patch.sheet.values.length);
  check('other rows byte-identical',
    patch.sheet.values.filter((_, i) => i !== 2).join('|') ===
      before.filter((_, i) => i !== 2).join('|'));

  section('saveItem: conflict detection');
  const conflict = makeEnv();
  const stale = findItem(conflict, 'Espresso');
  conflict.sheet.at(3, 4);
  conflict.sheet.put(3, 4, 6);
  const clash = conflict.call({
    action: 'saveItem',
    id: stale.id,
    base: stale,
    values: { price: '5.25' }
  }).data;
  check('refuses to overwrite an outside edit',
    clash.ok === false && /changed in the sheet/.test(clash.error), clash.error);
  check('the outside edit survives', conflict.sheet.at(3, 4) === 6, String(conflict.sheet.at(3, 4)));
  check('the error tells the owner to reload', /Reload/.test(clash.error), clash.error);

  const noisy = makeEnv();
  const sencha = findItem(noisy, 'Sencha');
  const relaxed = noisy.call({
    action: 'saveItem',
    id: sencha.id,
    base: Object.assign({}, sencha, { tags: 'V, GF' }),
    values: { tags: 'V, GF', price: '4.5' }
  }).data;
  check('reformatting an untouched field is not a conflict', relaxed.ok === true, relaxed.error);
  check('only the price was written', relaxed.fields.join() === 'price', relaxed.fields.join());

  section('saveItem: creating a row');
  const create = makeEnv();
  const added = create.call({
    action: 'saveItem',
    base: null,
    values: {
      category: 'Bakery',
      name: 'Almond Danish',
      description: 'Almond frangipane with a citrus glaze.',
      price: '£5.25',
      available: 'no',
      tags: 'V',
      image: '1AbCdEfGhIjKlMnOpQrStUvWxYz012345'
    }
  }).data;
  check('reports a create', added.mode === 'created', added.mode);
  check('appends below the last row', added.rowNumber === 8, String(added.rowNumber));
  check('mints an id for the new row', /^uuid-\d+$/.test(added.id), added.id);
  check('name written', create.sheet.at(8, 2) === 'Almond Danish', String(create.sheet.at(8, 2)));
  check('currency symbols stripped from the price', create.sheet.at(8, 4) === 5.25, String(create.sheet.at(8, 4)));
  check('availability normalised to No', create.sheet.at(8, 5) === 'No', String(create.sheet.at(8, 5)));
  check('bare file id accepted as the photo', create.sheet.at(8, 7) === '1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
  check('blank price stays blank',
    create.call({ action: 'saveItem', base: null, values: { name: 'Water', price: '' } }).data.ok === true &&
      create.sheet.at(9, 4) === '', String(create.sheet.at(9, 4)));
  check('availability normalises anything truthy to Yes',
    create.call({ action: 'saveItem', base: null, values: { name: 'Kettle', available: 'maybe' } }).data.ok === true &&
      create.sheet.at(10, 5) === 'Yes', String(create.sheet.at(10, 5)));

  const nameless = makeEnv();
  const rowsBefore = nameless.sheet.values.length;
  const noName = nameless.call({ action: 'saveItem', base: null, values: { price: '3' } }).data;
  check('refuses an item with no name', noName.ok === false && /needs a name/.test(noName.error), noName.error);
  check('nothing written on a rejected save', nameless.sheet.values.length === rowsBefore);

  section('deleteItem');
  const cut = makeEnv();
  const croissant = findItem(cut, 'Croissant');
  const survivors = cut.call({ action: 'getState' }).data.items
    .filter((item) => item.id !== croissant.id).map((item) => item.id);
  const removed = cut.call({ action: 'deleteItem', id: croissant.id }).data;
  check('reports a delete', removed.mode === 'deleted' && removed.name === 'Croissant', removed.mode);
  const afterCut = cut.call({ action: 'getState' }).data.items;
  check('row removed', afterCut.length === 4 && !afterCut.some((item) => item.name === 'Croissant'),
    afterCut.length + ' items');
  check('surviving ids unchanged', afterCut.map((item) => item.id).join() === survivors.join());
  check('unknown id is a no-op',
    cut.call({ action: 'deleteItem', id: 'uuid-999' }).data.mode === 'already-gone');
  check('missing id rejected',
    cut.call({ action: 'deleteItem' }).data.ok === false);
  check('deleting the last row does not break later reads',
    cut.call({ action: 'getState' }).data.items.length === 4);

  section('locking');
  const locked = makeEnv();
  locked.call({ action: 'getState' });
  check('a script lock is taken and released per action', locked.locks() === 1, String(locked.locks()));
  locked.call({ action: 'saveItem', base: null, values: { name: 'Toast' } });
  check('writes take the lock too', locked.locks() === 2, String(locked.locks()));

  section('tab selection');
  const named = makeEnv({ tabName: 'Menu v2' });
  check('falls back to the first tab when the name does not match',
    named.call({ action: 'getState' }).data.sheetName === 'Menu v2');
  const blank = makeEnv({ tabName: 'Sheet1', sheetName: '' });
  check('blank SHEET_NAME uses the first tab',
    blank.call({ action: 'getState' }).data.sheetName === 'Sheet1');

  section('owner-only access');
  const anon = makeEnv({ email: '' });
  const anonRead = anon.call({ action: 'getState' }).data;
  check('anonymous read refused',
    anonRead.ok === false && /Sign in/.test(anonRead.error), anonRead.error);
  const anonWrite = anon.call({ action: 'saveItem', base: null, values: { name: 'Hack' } }).data;
  check('anonymous write refused', anonWrite.ok === false);
  check('anonymous write wrote nothing', anon.sheet.values.length === sampleGrid().length);

  const other = makeEnv({ email: 'stranger@gmail.com' });
  check('a different signed-in account is refused',
    /limited to/.test(other.call({ action: 'getState' }).data.error));
  check('the refusal names the owner',
    other.call({ action: 'getState' }).data.error.indexOf(OWNER) !== -1);
  check('a different account cannot delete either',
    other.call({ action: 'deleteItem', id: 'uuid-1' }).data.ok === false);

  const unconfigured = makeEnv({ owner: 'owner' });
  check('unconfigured OWNER_EMAIL blocks writes with instructions',
    /Set OWNER_EMAIL/.test(unconfigured.call({ action: 'saveItem', base: null, values: { name: 'X' } }).data.error));

  const noSheet = makeEnv({ sheetId: 'PASTE_YOUR_GOOGLE_SHEET_ID_HERE' });
  check('unconfigured SHEET_ID blocks with instructions',
    /Set SHEET_ID/.test(noSheet.call({ action: 'getState' }).data.error));
  check('unconfigured sheet opened nothing', noSheet.opened.length === 0);

  const bound = makeEnv({ bound: true, sheetId: 'PASTE_YOUR_GOOGLE_SHEET_ID_HERE' });
  check('a bound script needs no sheet id',
    bound.call({ action: 'getState' }).data.items.length === 5);
  check('a bound script never calls openById', bound.opened.length === 0);
  const boundItems = bound.call({ action: 'getState' }).data.items;
  const boundPatch = bound.call({
    action: 'saveItem',
    id: boundItems[0].id,
    base: boundItems[0],
    values: { price: '4.75' }
  }).data;
  check('a bound script can save', boundPatch.ok === true, boundPatch.error);
  check('bound writes land on the parent sheet', bound.sheet.at(3, 4) === 4.75, String(bound.sheet.at(3, 4)));

  section('request routing');
  const router = makeEnv();
  check('unknown action rejected',
    router.call({ action: 'launchMissiles' }).data.error.indexOf('Unknown action') === 0);
  check('missing action rejected',
    router.call({}).data.error.indexOf('No action') === 0, router.call({}).data.error);
  check('malformed body handled',
    /Could not read the request/.test(router.raw('{not json').error));
  check('empty body handled', router.raw('').ok === false);
  const form = router.context.doPost({
    parameter: { payload: JSON.stringify({ action: 'getState' }) },
    postData: undefined
  });
  check('urlencoded payload path also works', JSON.parse(form.getContent()).items.length === 5);
  const page = router.context.doGet();
  check('doGet serves the editor', page.file === 'Index', page.file);
  check('doGet sets a viewport for phones', page.meta.viewport === 'width=device-width, initial-scale=1',
    page.meta.viewport);

  section('Index.html structure');
  check('no Apps Script scriptlet delimiters', HTML.indexOf('<?') === -1);
  const inline = HTML.slice(HTML.lastIndexOf('<script>') + 8, HTML.lastIndexOf('</script>'));
  let parses = true;
  try {
    new vm.Script(inline);
  } catch (err) {
    parses = false;
    console.log('       ' + err.message);
  }
  check('inline script parses', parses);
  const wanted = [];
  const idPattern = /getElementById\('([^']+)'\)/g;
  let hit;
  while ((hit = idPattern.exec(inline)) !== null) wanted.push(hit[1]);
  const missing = wanted.filter((id) => HTML.indexOf('id="' + id + '"') === -1);
  check('every id the script looks up exists in the markup (' + wanted.length + ' checked)',
    missing.length === 0, missing.join(', '));
  check('no external script or stylesheet to go missing',
    /<script src=/.test(HTML) === false && /<link rel="stylesheet"/.test(HTML) === false);
  check('photo helper mirrors the image poc chain',
    inline.indexOf('lh3.googleusercontent.com/d/') !== -1 &&
      inline.indexOf('drive.google.com/thumbnail?id=') !== -1 &&
      inline.indexOf('uc?export=view&id=') !== -1);
  check('posts back to the same app origin', inline.indexOf('location.origin + location.pathname') !== -1);
  check('demo mode is wired behind a query flag',
    inline.indexOf('demo=1') !== -1 && inline.indexOf('seedDemo()') !== -1);
  check('demo mode never calls the app',
    /if \(DEMO\) return demoApi\(action, payload\);/.test(inline));
  check('demo data matches the sample menu',
    (function count() {
      const block = inline.slice(inline.indexOf('const DEMO_ROWS'), inline.indexOf('function seedDemo'));
      return (block.match(/\['/g) || []).length;
    })() === 16,
    'demo rows: ' + (function count() {
      const block = inline.slice(inline.indexOf('const DEMO_ROWS'), inline.indexOf('function seedDemo'));
      return (block.match(/\['/g) || []).length;
    })());

  console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'all checks passed'));
  process.exitCode = failures ? 1 : 0;
}()).catch((err) => {
  console.error('harness crashed:', err);
  process.exitCode = 1;
});
