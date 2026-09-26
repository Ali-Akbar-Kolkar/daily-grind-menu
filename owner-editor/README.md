# Owner editor — one webpage that writes back to the sheet

A private web page the cafe owner opens on their phone, edits the menu, and saves straight
into the Google Sheet in Drive. The public menu page keeps reading the published CSV, so
nothing about the customer-facing site changes.

```
owner  ->  editor web app  ->  Google Sheet in Drive
customer ->  public page  ->  published CSV of the same sheet
```

## Why Apps Script and not the static page

A static page can read a published Sheet with no credentials. It cannot write: that needs
OAuth, and a static page has nowhere safe to keep a refresh token. Google Apps Script is the
no-server answer — it is Google's own runtime, it stores the credentials for you, and it
returns JSON to the page. No API keys, no billing, no hosting.

## Files

| File | What it is |
|------|------------|
| `Code.gs` | The backend: reads the tab, patches one row, deletes, checks the owner. |
| `Index.html` | The whole editor UI, style and script inlined (Apps Script serves one HTML file). |
| `appsscript.json` | Manifest. Sets the runtime and the single `spreadsheets.currentonly` scope. |
| `smoke-test.js` | 77 checks against a fake Apps Script, plus structural checks on `Index.html`. |

## Try the interface before deploying

Open `Index.html` in a browser and add `?demo=1` to the address:

```
file:///.../poc-image-menu/owner-editor/Index.html?demo=1
```

Demo mode runs the real interface against sample data in memory. Add, edit, delete, tick
availability and press *Check photo* — nothing is written anywhere. This is the fastest way to
check you actually want this shape before you create an Apps Script project.

## Deploy it

1. Open your Google Sheet, then **Extensions → Apps Script**. A project bound to the sheet opens.
2. Replace the contents of the placeholder `Code.gs` with this folder's `Code.gs`.
3. Set the two constants at the top of that file:
   - `OWNER_EMAIL` — the cafe Google account. **Required.** Saves fail closed until it is a real
     address, and only that account can write.
   - `SHEET_NAME` — the tab holding the menu, currently `menu`. If no tab has that name the first
     tab is used, so a wrong value here degrades rather than breaks.
   - `SHEET_ID` — leave the placeholder. Because the script is bound to the sheet it is not needed.
4. Add the page: click **+ → HTML**, name it exactly `Index`, and paste this folder's
   `Index.html`. The name must be `Index` with no spaces, because `doGet` asks for it by name.
5. Paste the manifest: in the editor, enable **Project Settings → Show "appsscript.json" manifest
   file in editor"**, then replace its contents with this folder's `appsscript.json`.
6. **Deploy → New deployment → Web app.**
   - Execute as: **Me**
   - Who has access: **Only myself**
7. Copy the Web app URL. That single URL is the owner's webpage — bookmark it on their phone.
8. Open it once. Google shows an unverified-app warning for your own script; choose
   **Advanced → Go to (unsafe) → Allow**. It then asks for permission to edit the spreadsheet.
   Approve it.

### If you would rather use a standalone script

Create the project from `script.google.com` instead of from the sheet, set `SHEET_ID` to the
id from the sheet URL (`.../spreadsheets/d/<THIS_PART>/edit`), and widen the manifest scope to
`https://www.googleapis.com/auth/spreadsheets`. The narrow `spreadsheets.currentonly` scope only
works for a bound script.

## How saving works

The first time the editor opens, it adds an **`Item ID`** column to the tab and fills a unique id
into every existing row. That column is what makes saving safe:

- The page sends the id of the row it is editing, plus the values it read when it loaded.
- The backend writes **only that row**. Nothing else in the sheet is touched, so a save can never
  quietly undo a change made in Sheets.
- Only the fields that actually changed are compared. If one of *those* fields was changed in
  Sheets after the page loaded, the save is refused with a "reload and reapply" message instead of
  overwriting the other edit.
- New items get a fresh id and are appended below the last row. Deletes remove exactly one row.
- Every write happens under a script lock, so two taps cannot interleave.

Price is written as a number with currency symbols stripped, so Sheets can format the column as
currency. Availability is normalised to `Yes` or `No`, which is what the public menu reads to
decide whether to show an item.

## Photos

The photo field takes a Drive share link, a bare file ID, or any https image URL. **Check photo**
probes the same five URL forms as the main image POC and tells you which one loads, so you find
out immediately whether the file is shared *Anyone with the link*. The stored value is whatever you
typed, and the public page resolves it at display time.

The URL logic here is a trimmed copy of `../image-urls.js`. If you change the candidate chain
there, mirror it in `Index.html` and in `Code.gs`'s sibling `photoUrls`/`photoId` pair.

## How the public menu sees the change

The sheet is already published to the web, so the CSV updates on its own. Google's published
feeds cache for roughly one to five minutes, so a price change is not visible to customers
instantly. The editor does not touch the publishing setting.

## Checks

```
node smoke-test.js
```

77 checks with no browser and no network. `Code.gs` runs in a `vm` sandbox against a fake
`SpreadsheetApp` / `LockService` / `Session` / `Utilities` / `ContentService` / `HtmlService`, so
the tests cover the parts that are easy to get wrong: the title row above the header, the 0-based
to 1-based column conversion in `writeRow`, the `Item ID` backfill and its idempotence, patching
exactly one row byte-for-byte, refusing an outside edit, tolerating a reformat of an untouched
field, appending a new row below the last one, deleting one row, owner-only enforcement for read
and write, both the bound and standalone sheet paths, and the request router. `Index.html` is
checked for scriptlet delimiters that would break templating, for a script that parses, and for
every `getElementById` name actually existing in the markup.

## What is deliberately not here

- **Reordering.** Dragging rows in Sheets is the supported way; the public menu follows sheet order.
- **A password or a second factor.** Protection is Google sign-in plus the `OWNER_EMAIL` check in
  the code. The web app URL is not a secret, so do not treat it as one.
- **Photo uploads.** Uploading straight to Drive needs the Drive scope and a file picker. The
  owner can add a photo in the Drive app and paste its link, which needs no extra permission.
