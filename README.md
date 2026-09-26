# Eco-Friendly, Paperless & Plastic-Free Menu

A digital cafe menu that helps reduce repeated paper printing and plastic menu sleeves. Cafe staff update menu items, prices, and availability in a Google Sheet; customers scan a QR code to view the current menu on their phones.

## How It Works

![Diagram showing the cafe team updating a Google Sheet that syncs to a live digital menu for customers](image.png)

1. Cafe staff update the menu in the Google Sheet.
2. The published sheet feeds the live menu webpage.
3. Customers scan the cafe's QR code and view the menu on their phones. No app download is required.
4. Customers can add items to a cart, order by email, and pay by UPI QR code.

The menu is publicly viewable. Only people authorized by the cafe can edit the Google Sheet.

## Demo

[View the live menu](https://ali-akbar-kolkar.github.io/daily-grind-menu/)

## Diagram Source

[Open or download the editable Draw.io diagram](eco-friendly-paperless-menu.drawio)

---

# Development notes

Everything below is for whoever maintains this, not for customers.

## How the site is built

No build step, no bundler, no server. It is plain files deployed by GitHub Actions
(`.github/workflows/pages.yml`) to GitHub Pages.

| File | Role |
|------|------|
| `site-config.js` | The only file you edit to go live. Sheet URL, currency, ordering keys. |
| `index.html` | Page shell, cart drawer, order form, and the image URL test bench. |
| `script.js` | Fetches the CSV, renders menu cards. |
| `image-urls.js` | Works out a loadable photo URL from whatever the `Image` column holds. |
| `order.js` | Cart, totals, UPI link, EmailJS, QR code, payment claim. |
| `style.css` | All styling. |
| `menu-images.csv` | Bundled sample sheet, used when `MENU_CSV_URL` is blank. |
| `owner-editor/` | Private Google Apps Script editor so the owner can change the sheet from a phone. |

Scripts load with `defer` in dependency order, so `order.js` is in place before `script.js`
runs. If `order.js` fails to load, the menu still renders and there is simply no cart.

Third-party code is loaded from jsDelivr: PapaParse, EmailJS and QRCode.js. There is no npm
install and no lockfile; if a CDN breaks, the page loses that one feature and says so rather
than failing silently.

## Photos come from the sheet

Add an `Image` column to the sheet and put either a full URL or a bare Google Drive file ID in
it. `image-urls.js` turns that into something a browser will actually load, trying several URL
forms in order.

`=IMAGE()` in a Google Sheet exports a usable `encrypted-tbn0.gstatic.com` thumbnail URL — it was
verified returning HTTP 200 `image/jpeg`. But it is an undocumented, small `s=10` cache token, so
it may rotate or expire. Hosted images on Cloudflare R2, imgur or this repo are more reliable.

There is also a test bench on the page for checking which forms still work: paste a Drive URL
into it, or use one of the bench presets. It is a developer tool, so it is **hidden by default** and
only appears with `?bench=1` (or when you open `index.html` straight off disk). Customers never see
it.

## Ordering: cart, email, UPI QR

1. Each card gets an **Add** button.
2. A drawer collects quantities, with the total always in rupees.
3. **Continue** asks for an email address, then emails the order to the cafe via EmailJS.
4. A **UPI QR code** appears immediately, encoded with the exact order total.
5. The customer pays in any UPI app, presses **I've paid**, and the cafe is emailed again.

### Try it without credentials

Open `index.html?demo=1`. The whole flow runs and **sends nothing** — the would-be emails are
written to the browser console so you can inspect the exact payloads.

With the placeholders still in `site-config.js`, the cart works but **Send order refuses**, so a
half-configured deploy never looks like it is taking money. The on-screen message stays vague on
purpose; the console names every value still unset by its exact key, so you are not left guessing
which line to edit.

### Enabling it for real

Fill in `window.CAFE_ORDER` in `site-config.js`:

```js
window.CAFE_ORDER = {
  emailjs: {
    serviceId:         'service_XXXXXXX',
    orderTemplateId:   'template_XXXXXXX',
    paymentTemplateId: 'template_XXXXXXX',
    receiptTemplateId: '',              // optional
    publicKey:         'PUBLIC_KEY_XXXXXXX'
  },
  upi: { vpa: '', payeeName: 'The Daily Grind', merchantCode: '' }
};
```

Leave `upi.vpa` **empty** until you have the real UPI ID. This is not a style preference: anything
filled in there becomes a real, scannable QR code and a real payment link in the order email, so a
plausible-looking placeholder like `yourname@okaxis` means a customer who scans it pays whoever
owns that UPI ID. `order.js` treats obvious placeholder shapes as not-configured and refuses, and
`upiLink()` re-checks independently of the UI, so no path hands out a QR built from a placeholder.

### EmailJS templates

Each template's **To** field decides who receives the mail, so the fields differ per template:

| Template | To | Cc | Required |
|----------|----|----|----------|
| New order | **the cafe address, typed in** | — | yes |
| Payment claimed | **the cafe address, typed in** | — | yes |
| Customer receipt | `{{to_email}}` | cafe address | no |

New order body:

```
Order {{order_id}} — {{order_total_display}}
From: {{customer_email}}
Placed: {{placed_at}}

{{order_lines}}

Total: {{order_total_display}} ({{order_count}} items)
Pay by UPI: {{pay_link}}
```

Reply-to is set to `{{reply_to}}`, so replying reaches the customer. The order email deliberately
has **no** `to_email` variable: if its To field were ever pointed at `{{to_email}}`, the order would
go to the customer instead of the cafe.

Then add the site domain under **EmailJS → Account → Security → Allowed Origins**, or every send
from the browser is rejected.

### The UPI QR

```
upi://pay?pa=<your UPI ID>&pn=<payee name>&am=<total>&cu=INR&tn=Order <id>&tr=<id>
```

Totals are held as **integer paise** end to end, so `am=` is never `9.900000000000001`. The same
string is used in the email, the QR, the "Open UPI app" button and the clipboard copy, and the
tests assert all four match — a QR showing one amount while the email says another is the failure
mode that loses money.

If the QR library fails to load, the page says so and still offers the working "Open UPI app"
button, so a CDN outage cannot stop someone paying.

### What ordering does not do

- **It does not verify payment.** "I've paid" is the customer's claim. Check your UPI app before
  making the drink, and check the amount matches — the total is computed in the browser, so someone
  with devtools could change it.
- **No login.** Anyone with the link can order, which suits a table QR code.
- **The receipt is not stored.** After paying, a refresh empties the cart, but the cafe has both
  emails.
- **EmailJS free tier is ~200 emails a month**, and each completed order sends two, so roughly 100
  orders.
- **Real verification needs a gateway** (Razorpay, PayU, Cashfree) with merchant KYC and a
  server-side webhook. That is a different build, and it reintroduces the backend this avoids.

### Guard rails

EmailJS keys in browser JavaScript are public by design; what protects the account is the
dashboard settings plus these client-side limits:

- a hidden **honeypot** field, so naive bots see a success and send nothing. It is clipped out of
  existence with `clip-path`, not parked off-screen, so it cannot show up in a screenshot
- a **15 second cooldown** between orders from the same browser
- caps of **20 per item** and **30 different items**, which also bounds email size
- the **cart is never cleared on failure** — it is only emptied once the cafe's payment alert has
  actually gone out, so a failed send is always retryable

## Deployment

`pages.yml` checks out the repo, optionally rewrites the `window.MENU_CSV_URL` line in
`site-config.js` from the `MENU_CSV_URL` repository variable, then publishes.

It replaces **only that one line**, on purpose. An earlier version rewrote the whole file, which
silently deleted the currency and the entire ordering config on every deploy.

If the `MENU_CSV_URL` variable is not set, the URL committed in `site-config.js` is used as-is, so
the site still deploys correctly. If the line is missing entirely the deploy fails loudly rather
than publishing a broken config.

## Running the checks

```
node smoke-test.js
node order-test.js
```

- `smoke-test.js` — 83 checks on file-ID extraction, URL candidates, card rendering, the tally,
  the parsers, the fetch failure paths, and that the developer test bench stays hidden unless
  `?bench=1` is set.
- `order-test.js` — 360 checks on money maths, UPI link format, email validation, cart guard
  rails, `localStorage` rules, sheet changes under a live cart, the full order → pay → claim path,
  every failure and retry, the unconfigured case, a missing SDK or QR library, the honeypot, the
  cooldown, keyboard focus, and that every id `order.js` looks up exists in `index.html`.

Both run the real files in a `vm` sandbox against a stub DOM, fake `localStorage`, fake EmailJS and
fake QRCode, so no browser and no network are needed.

## Owner editor

`owner-editor/` is a private Apps Script web app the owner opens on their phone to edit the sheet
and save straight back to Drive. Add `?demo=1` to `owner-editor/Index.html` to try it against
in-memory rows. See [`owner-editor/README.md`](owner-editor/README.md).

Note that this repository is public, so the Apps Script server code and the sheet's column
structure are readable by anyone. Keeping the editor source private would need a separate private
repository.
