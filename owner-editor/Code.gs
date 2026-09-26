const SHEET_ID = 'PASTE_YOUR_GOOGLE_SHEET_ID_HERE';
const SHEET_NAME = 'menu';
const OWNER_EMAIL = 'owner@example.com';

const FIELDS = ['id', 'category', 'name', 'description', 'price', 'available', 'tags', 'image'];

const HEADER_LABELS = {
  id: 'Item ID',
  category: 'Category',
  name: 'Item Name',
  description: 'Description',
  price: 'Price',
  available: 'Available',
  tags: 'Tags',
  image: 'Image'
};

const HEADER_ALIASES = {
  id: ['itemid', 'id', 'uid', 'rowkey'],
  category: ['category', 'categories', 'section', 'group', 'menucategory'],
  name: ['itemname', 'item', 'name', 'title', 'product'],
  description: ['description', 'desc', 'details', 'detail', 'info', 'notes'],
  price: ['price', 'cost', 'amount', 'rate'],
  available: ['available', 'availability', 'isavailable', 'instock', 'status', 'soldout'],
  tags: ['tags', 'tag', 'dietary', 'diet', 'labels'],
  image: ['image', 'imageurl', 'imagelink', 'photo', 'photourl', 'picture', 'thumbnail', 'img', 'imageid']
};

const NO_VALUES = ['no', 'n', 'false', '0', 'off', 'unavailable', 'soldout', 'x'];

function normalizeKey(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function isNo(value) {
  return NO_VALUES.indexOf(normalizeKey(value)) !== -1;
}

function cellText(row, index) {
  if (index === undefined || row === null) return '';
  return String(row[index] == null ? '' : row[index]).trim();
}

function currentEmail() {
  const user = Session.getActiveUser();
  return user ? String(user.getEmail() || '').trim() : '';
}

function assertWritable() {
  const email = currentEmail();
  if (!email) {
    throw new Error('Sign in with the cafe Google account, then reload this page. The editor refuses to run without a signed-in owner.');
  }
  if (OWNER_EMAIL.indexOf('@') === -1) {
    throw new Error('Set OWNER_EMAIL at the top of Code.gs to the cafe Google account before saving. Nothing has been written.');
  }
  if (email.toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
    throw new Error('This editor is limited to ' + OWNER_EMAIL + '. You are signed in as ' + email + '.');
  }
  return email;
}

function openSheet() {
  const bound = SpreadsheetApp.getActiveSpreadsheet();
  if (bound) return pickTab(bound);
  if (!SHEET_ID || SHEET_ID.indexOf('PASTE_') === 0) {
    throw new Error('Set SHEET_ID at the top of Code.gs to your Google Sheet, or create this script from inside the sheet with Extensions > Apps Script. Nothing has been written.');
  }
  return pickTab(SpreadsheetApp.openById(SHEET_ID));
}

function pickTab(book) {
  if (SHEET_NAME) {
    const named = book.getSheetByName(SHEET_NAME);
    if (named) return named;
  }
  const sheets = book.getSheets();
  if (!sheets.length) throw new Error('That spreadsheet has no tabs.');
  return sheets[0];
}

function mapColumns(headerRow) {
  const map = {};
  headerRow.forEach((cell, index) => {
    const key = normalizeKey(cell);
    if (!key) return;
    FIELDS.forEach((field) => {
      if (map[field] === undefined && HEADER_ALIASES[field].indexOf(key) !== -1) map[field] = index;
    });
  });
  return map;
}

function readGrid(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (!lastRow || !lastCol) throw new Error('That tab is empty.');

  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  let headerRow = 0;
  let columns = null;

  for (let r = 0; r < values.length; r += 1) {
    const found = mapColumns(values[r]);
    if (found.name === undefined) continue;
    if (found.price === undefined && found.category === undefined && found.description === undefined) continue;
    headerRow = r + 1;
    columns = found;
    break;
  }

  if (!columns) {
    throw new Error('Could not find the header row. It needs an item name column plus at least one of price, category or description.');
  }

  const rows = [];
  for (let r = headerRow; r < values.length; r += 1) {
    if (!cellText(values[r], columns.name)) continue;
    rows.push({ rowNumber: r + 1, values: values[r].slice() });
  }

  return { headerRow, columns, rows, lastRow, lastCol };
}

function ensureItemIdColumn(sheet) {
  const grid = readGrid(sheet);
  if (grid.columns.id !== undefined) return grid;

  const column = grid.lastCol + 1;
  sheet.getRange(grid.headerRow, column).setValue(HEADER_LABELS.id);

  const missing = [];
  grid.rows.forEach((row) => {
    if (cellText(row.values, column - 1)) return;
    missing.push([row.rowNumber, Utilities.getUuid()]);
  });
  missing.forEach((pair) => {
    sheet.getRange(pair[0], column).setValue(pair[1]);
  });

  return readGrid(sheet);
}

function rowToItem(row, columns) {
  const raw = {};
  FIELDS.forEach((field) => {
    raw[field] = cellText(row, columns[field]);
  });
  if (columns.price !== undefined) {
    const value = row[columns.price];
    raw.price = (typeof value === 'number' || value === '') ? value : String(value).trim();
  }
  raw.available = raw.available || 'Yes';
  raw.rowNumber = row.rowNumber;
  return raw;
}

function findRowById(grid, id) {
  const column = grid.columns.id;
  if (column === undefined) return null;
  for (let i = 0; i < grid.rows.length; i += 1) {
    if (cellText(grid.rows[i].values, column) === id) return grid.rows[i];
  }
  return null;
}

function fold(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function changedFields(values, base) {
  const changed = [];
  FIELDS.forEach((field) => {
    if (values[field] === undefined) return;
    if (base && base[field] !== undefined && fold(values[field]) === fold(base[field])) return;
    changed.push(field);
  });
  return changed;
}

function assertNoConflict(row, columns, base, changed) {
  if (!base) return;
  for (let i = 0; i < changed.length; i += 1) {
    const field = changed[i];
    if (field === 'id') continue;
    if (base[field] === undefined) continue;
    const column = columns[field];
    if (column === undefined) continue;
    if (fold(cellText(row, column)) === fold(base[field])) continue;
    throw new Error('“' + (base.name || 'That item') + '” changed in the sheet after you opened this page, so your edit was not saved. Reload to see the newer version, then reapply your change.');
  }
}

function coerce(field, value) {
  if (field === 'price') {
    if (value === '' || value === null || value === undefined) return '';
    const parsed = parseFloat(String(value).replace(/[^0-9.]/g, ''));
    return isFinite(parsed) ? parsed : '';
  }
  if (field === 'available') return isNo(value) ? 'No' : 'Yes';
  if (field === 'id') return String(value).trim();
  return String(value == null ? '' : value);
}

function writeRow(sheet, rowNumber, columns, values) {
  FIELDS.forEach((field) => {
    const column = columns[field];
    if (column === undefined) return;
    if (values[field] === undefined) return;
    sheet.getRange(rowNumber, column + 1).setValue(coerce(field, values[field]));
  });
}

function nextFreeRow(grid) {
  let last = grid.headerRow;
  grid.rows.forEach((row) => {
    if (row.rowNumber > last) last = row.rowNumber;
  });
  return last + 1;
}

function getState() {
  assertWritable();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = openSheet();
    const grid = ensureItemIdColumn(sheet);
    return {
      ok: true,
      sheetName: sheet.getName(),
      owner: currentEmail(),
      itemIdColumn: grid.columns.id !== undefined,
      items: grid.rows.map((row) => rowToItem(row.values, grid.columns))
    };
  } finally {
    lock.releaseLock();
  }
}

function saveItem(payload) {
  assertWritable();
  const data = payload || {};
  const values = data.values || {};
  const id = fold(data.id);

  if (!id && !fold(values.name)) {
    throw new Error('A new item needs a name. Nothing has been written.');
  }
  if (id && values.name !== undefined && !fold(values.name)) {
    throw new Error('An item cannot be saved with a blank name. Nothing has been written.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = openSheet();
    const grid = ensureItemIdColumn(sheet);

    if (id) {
      const existing = findRowById(grid, id);
      if (!existing) {
        throw new Error('That item is no longer in the sheet, so nothing was saved. Reload the editor and try again.');
      }
      const changed = changedFields(values, data.base);
      assertNoConflict(existing.values, grid.columns, data.base, changed);
      writeRow(sheet, existing.rowNumber, grid.columns, values);
      return { ok: true, id, rowNumber: existing.rowNumber, mode: 'patched', fields: changed };
    }

    const rowNumber = nextFreeRow(grid);
    const newId = Utilities.getUuid();
    const row = Object.assign({}, values, { id: newId });
    writeRow(sheet, rowNumber, grid.columns, row);
    return { ok: true, id: newId, rowNumber, mode: 'created', fields: changedFields(values, null) };
  } finally {
    lock.releaseLock();
  }
}

function deleteItem(payload) {
  assertWritable();
  const id = fold(payload && payload.id);
  if (!id) throw new Error('Missing item id. Nothing has been written.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = openSheet();
    const grid = ensureItemIdColumn(sheet);
    const existing = findRowById(grid, id);
    if (!existing) return { ok: true, mode: 'already-gone' };
    const name = cellText(existing.values, grid.columns.name);
    sheet.deleteRow(existing.rowNumber);
    return { ok: true, mode: 'deleted', name };
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Menu editor')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  let payload = {};
  try {
    const raw = (e && e.parameter && e.parameter.payload) ||
      (e && e.postData && e.postData.contents) || '';
    payload = raw ? JSON.parse(raw) : {};
  } catch (err) {
    return json({ ok: false, error: 'Could not read the request. Reload the page and try again.' });
  }

  try {
    const action = String(payload.action || '');
    if (!action) return json({ ok: false, error: 'No action in the request. Reload the page and try again.' });
    if (action === 'getState') return json(getState());
    if (action === 'saveItem') return json(saveItem(payload));
    if (action === 'deleteItem') return json(deleteItem(payload));
    return json({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return json({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

function json(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
