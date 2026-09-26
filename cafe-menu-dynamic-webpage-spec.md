# Dynamic Cafe Menu Webpage — Google Sheet → GitHub Pages

## Goal
A cafe menu webpage (hosted on GitHub Pages) that always shows the **latest menu items and prices**, without ever needing to redeploy the code. The cafe owner edits a Google Sheet (stored in Google Drive); the webpage fetches that data live every time someone opens it.

---

## Prerequisites

### 1. Google account & Drive setup
- [ ] One Gmail account (already have this)
- [ ] Google Sheet created with cafe menu data (NOT a raw `.xlsx` upload — convert/create as a native Google Sheet)
- [ ] Sheet columns finalized, e.g.:
  | Category | Item Name | Description | Price | Available (Yes/No) |
- [ ] Sheet sharing set to: **File → Share → General access → Anyone with the link → Viewer**
- [ ] Sheet published as CSV:
  - `File → Share → Publish to web`
  - Select the specific sheet/tab
  - Format: **Comma-separated values (.csv)**
  - Click Publish → copy the generated CSV URL

### 2. GitHub setup
- [ ] GitHub repo already created and connected to GitHub Pages (already deployed — confirmed)
- [ ] Repo has `index.html`, `style.css`, `script.js` (or equivalent structure)
- [ ] Ability to push commits and see GitHub Pages redeploy automatically

### 3. Libraries (no backend/server needed)
- [ ] [PapaParse](https://www.papaparse.com/) — CSV parsing in-browser (via CDN, no install)
- [ ] Plain JavaScript `fetch()` — built into all browsers

### 4. Skills/access needed
- [ ] Basic HTML/CSS for card layout (already exists on your deployed page)
- [ ] Enough JS to fetch a URL and loop over rows to build cards
- [ ] Google Sheet edit access for whoever updates prices (the cafe owner)

---

## How It Will Work (Flow Summary)

1. Cafe owner opens the Google Sheet and edits item name / price / availability.
2. Google's "Publish to web" CSV link **auto-reflects the edit** — no re-publish needed once it's published the first time (it stays live).
3. User opens the GitHub Pages website.
4. Page JavaScript calls `fetch(CSV_URL)` on page load.
5. PapaParse converts the CSV text into a JS array of objects.
6. JavaScript loops through the array and dynamically builds menu cards (name, price, description) into the page's HTML.
7. Page displays the **current** menu — reflecting whatever was last saved in the Sheet.

No redeploy, no backend server, no database. The "database" is the Google Sheet itself.

---

## Implementation Prompt (paste this to Claude/any AI coding assistant when you're ready to build)

```
Build a static webpage that displays a cafe menu as cards. The menu data
should NOT be hardcoded — it must be fetched live from a published Google
Sheet CSV link at runtime using JavaScript fetch() and parsed with PapaParse.

Requirements:
1. Use this CSV URL as the data source: [PASTE YOUR PUBLISHED CSV LINK HERE]
2. Expected columns: Category, Item Name, Description, Price, Available
3. Group items by Category as section headings
4. Render each item as a card: name (bold), description (smaller text),
   price (right-aligned, formatted as currency)
5. Skip/hide rows where Available = "No"
6. Handle fetch errors gracefully (show a friendly "menu loading..." or
   "unable to load menu, please refresh" message)
7. Keep it a single index.html + style.css + script.js structure suitable
   for GitHub Pages (no build step, no backend)
8. Add a loading state while the fetch is in progress
9. Make it mobile responsive (cards stack on small screens)

Style: [describe your current card design / colors / fonts so it matches
what's already deployed]
```

---

## Notes / Gotchas
- Google's published CSV can take **1–5 minutes** to reflect a fresh edit sometimes (caching) — usually instant, but don't panic if it's not immediate.
- If the Sheet is ever "unpublished" or sharing is changed to private, the fetch will start failing silently (page will just fail to update) — this is worth a fallback message.
- Do **not** use the raw Google Drive `.xlsx` file API route unless you specifically need real Excel formatting/formulas preserved — it needs an API key and more setup for no real benefit here.
- This approach has **no login, no cost, no server** — ideal for a single cafe use case.
